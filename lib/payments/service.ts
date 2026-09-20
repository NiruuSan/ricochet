import { assertCanMoveMoney } from "../anti-cheat";
import { PaymentError } from "./errors";
import { assertWithdrawalsAllowed } from "../security-holds";
import { Keypair, PublicKey } from "@solana/web3.js";
import { database } from "../../db/raw";
import { notificationInsert } from "../notifications";
import { MIN_DEPOSIT, type TreasurySnapshot } from "../api-types";
import { cashAccountId, ensureCashAccount, HOUSE, POOL, settings } from "./accounts";
import { requireDevnet, validateOperationId, parseSol, launchStatus } from "./policy";
import { encryptWallet, decryptWallet } from "./vault";
import { devnetConnection, prepareTransfer, recipientAddress } from "./solana";

export { cashAccountId, ensureCashAccount, HOUSE, POOL, settings };

/**
 * A transaction whose blockhash expired can never be processed, but an RPC node
 * may lag slightly behind in reporting one that did land. Only conclude that a
 * transfer never landed once finality is this many blocks past its expiry.
 */
export const EXPIRY_MARGIN_BLOCKS = 150;
/**
 * Solana refuses a transfer that leaves an account holding lamports but less
 * than rent exemption (890,880 lamports for a plain wallet). The pool must stay
 * above it, and a deposit must be large enough to open an empty pool.
 */
export const RENT_EXEMPT_MINIMUM = 890_880;
export { MIN_DEPOSIT };
const OPEN = "('pending', 'review')";

type Wallet = { id: string; network: string; owner: string; address: string; encrypted_key: string };
export type Transfer = {
  id: string;
  network: string;
  user_id: string;
  account_id: string;
  kind: string;
  source: string;
  destination: string;
  amount: number;
  fee: number;
  signature: string;
  wire: string;
  last_valid_block_height: number;
  status: string;
  slot: number | null;
  error: string | null;
  created: number;
  updated: number;
};

const publicTransfer = (t: Transfer) => ({
  id: t.id,
  kind: t.kind,
  amount: t.amount,
  fee: t.fee,
  destination: t.destination,
  signature: t.signature,
  status: t.status,
  error: t.error,
  created: t.created,
});

export async function ensureWallet(uid: string): Promise<Wallet> {
  const s = settings();
  requireDevnet(s);
  const db = database();
  const id = `devnet:${uid}`;
  let wallet = await db.prepare("SELECT * FROM custody_wallets WHERE id = ?").bind(id).first<Wallet>();
  if (wallet) return wallet;
  const generated = Keypair.generate();
  const encrypted = await encryptWallet(generated, s.SOLANA_VAULT_KEY!, id);
  await db
    .prepare("INSERT OR IGNORE INTO custody_wallets(id, network, owner, address, encrypted_key, created) VALUES(?, ?, ?, ?, ?, ?)")
    .bind(id, "devnet", uid, generated.publicKey.toBase58(), encrypted, Date.now())
    .run();
  generated.secretKey.fill(0);
  wallet = await db.prepare("SELECT * FROM custody_wallets WHERE id = ?").bind(id).first<Wallet>();
  if (!wallet) throw new PaymentError("Wallet could not be created.");
  return wallet;
}

/**
 * Checks what can be checked without the blockchain before a withdrawal spends a
 * two-factor code: the amount, the address and the available balance.
 */
export async function precheckWithdrawal(uid: string, destinationInput: unknown, amountInput: unknown, treasury = false, now = Date.now()) {
  if (!treasury) await Promise.all([assertWithdrawalsAllowed(uid, now), assertCanMoveMoney(uid)]);
  const amount = parseSol(amountInput);
  const destination = recipientAddress(destinationInput).toBase58();
  const db = database();
  if (await db.prepare("SELECT 1 FROM custody_wallets WHERE address = ?").bind(destination).first()) {
    throw new PaymentError("Use an external wallet, not a Bounce deposit or custody address.");
  }
  const available = await db.prepare("SELECT balance FROM cash_accounts WHERE id = ?").bind(cashAccountId(treasury ? HOUSE : uid)).first<{ balance: number }>();
  if (!available || available.balance < amount) throw new PaymentError("Insufficient available balance, including the network fee.");
}

/** Whether this operation ID already started a transfer for the user (a retry moves no money twice). */
export async function transferStarted(idInput: unknown, uid: string) {
  if (typeof idInput !== "string") return false;
  return !!(await database().prepare("SELECT 1 FROM cash_transfers WHERE id = ? AND user_id = ?").bind(idInput.toLowerCase(), uid).first());
}

async function replay(id: string, uid: string, kind: string, destination?: string, amount?: number) {
  const t = await database().prepare("SELECT * FROM cash_transfers WHERE id = ?").bind(id).first<Transfer>();
  if (!t) return null;
  if (t.user_id !== uid || t.kind !== kind || (destination && t.destination !== destination) || (amount !== undefined && t.amount !== amount)) {
    throw new PaymentError("Operation ID was already used for a different request.");
  }
  return t;
}

/**
 * Only one transfer per source address may be open at a time, and every
 * withdrawal leaves from the shared pool. Before starting a new transfer,
 * resolve whatever is still open on that source, whoever started it, so one
 * abandoned transfer cannot block everyone else.
 */
async function resolveOpenTransfers(source: string) {
  const db = database();
  const open = await db
    .prepare(`SELECT id, user_id FROM cash_transfers WHERE source = ? AND status IN ${OPEN}`)
    .bind(source)
    .all<{ id: string; user_id: string }>();
  for (const t of open.results) await reconcileTransfer(t.id, t.user_id);
  if (await db.prepare(`SELECT 1 FROM cash_transfers WHERE source = ? AND status IN ${OPEN}`).bind(source).first()) {
    throw new PaymentError("Another transfer from this address is still being confirmed on-chain. Try again in about a minute.");
  }
}

export async function beginDeposit(uid: string, idInput: unknown) {
  const id = validateOperationId(idInput);
  const prior = await replay(id, uid, "deposit");
  if (prior) return publicTransfer(prior);
  const s = settings();
  requireDevnet(s);
  const connection = await devnetConnection(s.SOLANA_RPC_URL!);
  const wallet = await ensureWallet(uid);
  const pool = await ensureWallet(POOL);
  const account = await ensureCashAccount(uid);
  await resolveOpenTransfers(wallet.address);
  const balance = await connection.getBalance(new PublicKey(wallet.address), "finalized");
  if (!Number.isSafeInteger(balance) || balance <= 0) throw new PaymentError("No confirmed devnet SOL was found at your deposit address.");
  if (balance < MIN_DEPOSIT) throw new PaymentError("Deposits must be at least 0.001 devnet SOL.");
  const signer = await decryptWallet(wallet.encrypted_key, s.SOLANA_VAULT_KEY!, wallet.id);
  const prepared = await prepareTransfer(connection, signer, new PublicKey(pool.address), balance, id, true);
  signer.secretKey.fill(0);
  await insertTransfer({ id, uid, account, kind: "deposit", source: wallet.address, destination: pool.address, ...prepared }, false);
  return reconcileTransfer(id, uid);
}

export async function beginWithdrawal(uid: string, idInput: unknown, destinationInput: unknown, amountInput: unknown, treasury = false) {
  const id = validateOperationId(idInput);
  const amount = parseSol(amountInput);
  const destination = recipientAddress(destinationInput).toBase58();
  const kind = treasury ? "treasury" : "withdrawal";
  const prior = await replay(id, uid, kind, destination, amount);
  if (prior) return publicTransfer(prior);
  if (!treasury) await Promise.all([assertWithdrawalsAllowed(uid), assertCanMoveMoney(uid)]);
  const s = settings();
  requireDevnet(s);
  const db = database();
  if (await db.prepare("SELECT 1 FROM custody_wallets WHERE address = ?").bind(destination).first()) {
    throw new PaymentError("Use an external wallet, not a Bounce deposit or custody address.");
  }
  const connection = await devnetConnection(s.SOLANA_RPC_URL!);
  const pool = await ensureWallet(POOL);
  const account = await ensureCashAccount(treasury ? HOUSE : uid);
  await resolveOpenTransfers(pool.address);
  const signer = await decryptWallet(pool.encrypted_key, s.SOLANA_VAULT_KEY!, pool.id);
  const prepared = await prepareTransfer(connection, signer, new PublicKey(destination), amount, id);
  signer.secretKey.fill(0);
  const available = await db.prepare("SELECT balance FROM cash_accounts WHERE id = ?").bind(account).first<{ balance: number }>();
  if (!available || available.balance < amount + prepared.fee) throw new PaymentError("Insufficient available balance, including the network fee.");
  const remaining = (await connection.getBalance(new PublicKey(pool.address), "finalized")) - amount - prepared.fee;
  if (remaining < 0) throw new PaymentError("Custody liquidity is insufficient. No withdrawal was submitted.");
  if (remaining > 0 && remaining < RENT_EXEMPT_MINIMUM) {
    throw new PaymentError("This amount would leave the pool wallet below Solana's rent minimum. Withdraw slightly less. No withdrawal was submitted.");
  }
  await insertTransfer({ id, uid, account, kind, source: pool.address, destination, ...prepared }, true);
  return reconcileTransfer(id, uid);
}

type NewTransfer = {
  id: string;
  uid: string;
  account: string;
  kind: string;
  source: string;
  destination: string;
  amount: number;
  fee: number;
  signature: string;
  wire: string;
  lastValidBlockHeight: number;
};

async function insertTransfer(t: NewTransfer, reserve: boolean) {
  const db = database();
  const now = Date.now();
  const ops = [
    db
      .prepare(
        `INSERT INTO cash_transfers(id, network, user_id, account_id, kind, source, destination, amount, fee, signature, wire, last_valid_block_height, status, created, updated)
         VALUES(?, 'devnet', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      )
      .bind(t.id, t.uid, t.account, t.kind, t.source, t.destination, t.amount, t.fee, t.signature, t.wire, t.lastValidBlockHeight, now, now),
  ];
  if (reserve) {
    ops.push(
      db
        .prepare("INSERT INTO cash_ledger(id, account_id, kind, amount, reference, created) VALUES(?, ?, 'withdrawal_reserve', ?, ?, ?)")
        .bind(`${t.id}:reserve`, t.account, -t.amount - t.fee, t.id, now),
    );
  }
  // A player's own withdrawal is announced to them: one they did not start is
  // the first thing they should see. The treasury's own transfers are the
  // administrator's and notify nobody.
  if (t.kind === "withdrawal") {
    ops.push(notificationInsert(db, `withdrawal:${t.id}`, t.uid, "security_alert", { event: "withdrawal_started", amount: t.amount, to: t.destination }, now));
  }
  // A source-wallet uniqueness constraint serializes outgoing transactions. The
  // balance trigger and this batch make reservation and outbox creation atomic.
  try {
    await db.batch(ops);
  } catch (e) {
    // The database guard closes the race with a reset during RPC preparation.
    if (t.kind === "withdrawal") await assertWithdrawalsAllowed(t.uid, now);
    throw e;
  }
}

/**
 * Moves an open transfer to a final status and applies its ledger effect in the
 * same batch. Each ledger insert is conditioned on the status this batch set,
 * so a concurrent reconciliation can never apply a second, different effect.
 */
async function closeTransfer(t: Transfer, status: "finalized" | "failed" | "expired", slot: number | null, error: string | null) {
  const db = database();
  const now = Date.now();
  const ops = [
    db
      .prepare(`UPDATE cash_transfers SET status = ?, slot = ?, error = ?, updated = ? WHERE id = ? AND status IN ${OPEN}`)
      .bind(status, slot, error, now, t.id),
  ];
  const entry = (kind: string, amount: number, suffix: string, when: string) =>
    db
      .prepare(`INSERT OR IGNORE INTO cash_ledger(id, account_id, kind, amount, reference, created) SELECT ?, ?, '${kind}', ?, ?, ? FROM cash_transfers WHERE id = ? AND status = '${when}'`)
      .bind(`${t.id}:${suffix}`, t.account_id, amount, t.id, now, t.id);
  if (t.kind === "deposit") {
    if (status === "finalized") ops.push(entry("deposit", t.amount, "deposit", "finalized"));
  } else if (status === "failed") {
    // Landed but failed: the network fee was charged, so only principal returns.
    ops.push(entry("withdrawal_refund", t.amount, "refund", "failed"));
  } else if (status === "expired") {
    // Never landed: nothing left the pool, so principal and fee both return.
    ops.push(entry("withdrawal_refund", t.amount + t.fee, "refund", "expired"));
  }
  await db.batch(ops);
}

export async function reconcileTransfer(id: string, uid: string) {
  const db = database();
  const load = () => db.prepare("SELECT * FROM cash_transfers WHERE id = ? AND user_id = ?").bind(id, uid).first<Transfer>();
  const t = await load();
  if (!t) throw new PaymentError("Transfer not found.");
  if (t.status !== "pending" && t.status !== "review") return publicTransfer(t);

  const s = settings();
  requireDevnet(s);
  const connection = await devnetConnection(s.SOLANA_RPC_URL!);
  const status = (await connection.getSignatureStatuses([t.signature], { searchTransactionHistory: true })).value[0];
  if (status?.confirmationStatus === "finalized") {
    const success = status.err === null;
    await closeTransfer(t, success ? "finalized" : "failed", status.slot, success ? null : "Transaction failed on-chain. Any network fee remains charged.");
  } else if (!status) {
    const height = await connection.getBlockHeight("finalized");
    if (height <= t.last_valid_block_height) {
      if (t.status === "pending") {
        try {
          await connection.sendRawTransaction(Buffer.from(t.wire, "base64"), { skipPreflight: false, maxRetries: 2, preflightCommitment: "finalized" });
        } catch {
          await db
            .prepare("UPDATE cash_transfers SET error = ?, updated = ? WHERE id = ? AND status = 'pending'")
            .bind("Submission was not confirmed. Recheck status; the same signed transaction will be retried.", Date.now(), id)
            .run();
        }
      }
    } else if (height > t.last_valid_block_height + EXPIRY_MARGIN_BLOCKS) {
      // The blockhash expired long ago on the finalized chain, so this exact
      // signed transaction can never be processed. Confirm it is absent from
      // history too before releasing anything.
      const landed = await connection.getTransaction(t.signature, { commitment: "finalized", maxSupportedTransactionVersion: 0 });
      if (!landed) {
        await closeTransfer(t, "expired", null, "The transaction expired without landing. Nothing was sent and the reserved amount was returned.");
      } else if (landed.meta) {
        const success = landed.meta.err === null;
        await closeTransfer(t, success ? "finalized" : "failed", landed.slot, success ? null : "Transaction failed on-chain. Any network fee remains charged.");
      }
    } else {
      await db
        .prepare(`UPDATE cash_transfers SET error = ?, updated = ? WHERE id = ? AND status IN ${OPEN}`)
        .bind("The transaction expired unconfirmed. Recheck in about a minute to release the reserved amount.", Date.now(), id)
        .run();
    }
  }
  // A status that exists but is not finalized means the transaction landed;
  // it only needs time to finalize.
  return publicTransfer((await load())!);
}

/** Administrator sweep over every open transfer, oldest first. */
export async function reconcileOpenTransfers(limit = 20) {
  const open = await database()
    .prepare(`SELECT id, user_id FROM cash_transfers WHERE status IN ${OPEN} ORDER BY created ASC LIMIT ?`)
    .bind(limit)
    .all<{ id: string; user_id: string }>();
  let resolved = 0;
  let failed = 0;
  for (const t of open.results) {
    try {
      const result = await reconcileTransfer(t.id, t.user_id);
      if (result.status !== "pending" && result.status !== "review") resolved++;
    } catch {
      failed++;
    }
  }
  return { checked: open.results.length, resolved, failed };
}

/**
 * Finalized SOL sitting at a deposit address, waiting to be swept into the
 * pool. Zero when the RPC cannot be reached: this only drives a hint and the
 * automatic deposit check, never a balance.
 */
async function waitingAt(address: string) {
  try {
    const connection = await devnetConnection(settings().SOLANA_RPC_URL!);
    return await connection.getBalance(new PublicKey(address), "finalized");
  } catch {
    return 0;
  }
}

export async function walletSnapshot(uid: string) {
  const status = launchStatus(settings());
  if (!status.configured) return { ...status, address: null, balance: 0, detected: 0, transfers: [], activity: [] };
  const wallet = await ensureWallet(uid);
  const account = await ensureCashAccount(uid);
  const db = database();
  const [balance, transfers, activity, detected, tips] = await Promise.all([
    db.prepare("SELECT balance FROM cash_accounts WHERE id = ?").bind(account).first<{ balance: number }>(),
    db.prepare("SELECT * FROM cash_transfers WHERE account_id = ? ORDER BY created DESC LIMIT 50").bind(account).all<Transfer>(),
    db.prepare("SELECT kind, amount, reference, created FROM cash_ledger WHERE account_id = ? ORDER BY created DESC LIMIT 100").bind(account).all(),
    waitingAt(wallet.address),
    db.prepare(`SELECT l.id, l.amount, l.created, p.name FROM cash_ledger l
      JOIN cash_ledger other ON other.id = 'tip:' || l.reference || CASE WHEN l.kind = 'tip_sent' THEN ':received' ELSE ':sent' END
      JOIN cash_accounts a ON a.id = other.account_id
      JOIN players p ON p.id = a.user_id
      WHERE l.account_id = ? AND l.kind IN ('tip_sent', 'tip_received')
      ORDER BY l.created DESC LIMIT 50`).bind(account).all<{ id: string; amount: number; created: number; name: string }>(),
  ]);
  return {
    ...status,
    address: wallet.address,
    balance: balance?.balance ?? 0,
    detected,
    transfers: transfers.results.map(publicTransfer),
    activity: activity.results,
    tips: tips.results,
  };
}

/** Pool liabilities and the house position, read live for the administrator. */
export async function treasurySnapshot(): Promise<TreasurySnapshot> {
  const db = database();
  const configured = launchStatus(settings()).configured;
  await ensureCashAccount(HOUSE);
  const [balance, liabilities, transfers, open] = await Promise.all([
    db.prepare("SELECT balance FROM cash_accounts WHERE id = ?").bind(cashAccountId(HOUSE)).first<{ balance: number }>(),
    db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN user_id LIKE 'escrow:%' THEN 0 ELSE balance END), 0) AS players,
                COALESCE(SUM(CASE WHEN user_id LIKE 'escrow:%' THEN balance ELSE 0 END), 0) AS escrow
         FROM cash_accounts WHERE network = 'devnet' AND user_id <> ?`,
      )
      .bind(HOUSE)
      .first<{ players: number; escrow: number }>(),
    db.prepare("SELECT * FROM cash_transfers WHERE account_id = ? ORDER BY created DESC LIMIT 50").bind(cashAccountId(HOUSE)).all<Transfer>(),
    db.prepare(`SELECT * FROM cash_transfers WHERE status IN ${OPEN} ORDER BY created ASC LIMIT 50`).all<Transfer>(),
  ]);
  let chain: Pick<TreasurySnapshot, "poolOnChain" | "poolAddress" | "address" | "detected"> = { poolOnChain: null, poolAddress: null, address: null, detected: 0 };
  if (configured) {
    const [pool, wallet] = await Promise.all([ensureWallet(POOL), ensureWallet(HOUSE)]);
    let poolOnChain: number | null = null;
    try {
      const connection = await devnetConnection(settings().SOLANA_RPC_URL!);
      poolOnChain = await connection.getBalance(new PublicKey(pool.address), "confirmed");
    } catch {
      // Shown as unavailable; the ledger figures above are still exact.
    }
    chain = { poolOnChain, poolAddress: pool.address, address: wallet.address, detected: await waitingAt(wallet.address) };
  }
  return {
    configured,
    network: "devnet",
    balance: balance?.balance ?? 0,
    playerBalances: liabilities?.players ?? 0,
    escrow: liabilities?.escrow ?? 0,
    ...chain,
    transfers: transfers.results.map(publicTransfer),
    open: open.results.map(publicTransfer),
  };
}
