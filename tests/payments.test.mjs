import assert from "node:assert/strict";
import { Keypair, Transaction, SystemInstruction } from "@solana/web3.js";
import bs58 from "bs58";
import { createDatabase } from "./helpers/test-env.mjs";

// Exercise the real payment service and SQL batches. Only platform bindings and
// the network are replaced; no request can leave this test process.
const testEnv = {
  SOLANA_NETWORK: "devnet",
  SOLANA_RPC_URL: "https://rpc.invalid/secret-token",
  SOLANA_VAULT_KEY: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64"),
};
Object.assign(process.env, testEnv);
const { sqlite, close } = await createDatabase();

const statuses = new Map();
const landed = new Map();
const balances = new Map();
const sent = [];
let height = 10;
let fee = 5000;
let genesis = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
let rpcFailure = false;
const blockhash = Keypair.generate().publicKey.toBase58();
globalThis.fetch = async (_url, init) => {
  if (rpcFailure) throw new Error("RPC failed at https://rpc.invalid/secret-token");
  const q = JSON.parse(init.body);
  let result;
  switch (q.method) {
    case "getGenesisHash":
      result = genesis;
      break;
    case "getLatestBlockhash":
      result = { context: { slot: 10 }, value: { blockhash, lastValidBlockHeight: height + 90 } };
      break;
    case "getFeeForMessage":
      result = { context: { slot: 10 }, value: fee };
      break;
    case "getBalance":
      result = { context: { slot: 10 }, value: balances.get(q.params[0]) ?? 0 };
      break;
    case "getSignatureStatuses":
      result = { context: { slot: 10 }, value: q.params[0].map((id) => statuses.get(id) ?? null) };
      break;
    case "getTransaction":
      result = landed.get(q.params[0]) ?? null;
      break;
    case "getBlockHeight":
      result = height;
      break;
    case "sendTransaction": {
      const tx = Transaction.from(Buffer.from(q.params[0], "base64"));
      assert.ok(tx.verifySignatures());
      sent.push(q.params[0]);
      result = bs58.encode(tx.signature);
      break;
    }
    default:
      throw new Error("Unexpected RPC: " + q.method);
  }
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: q.id, result }), { headers: { "Content-Type": "application/json" } });
};

const service = await import("../lib/payments/service.ts");
const { settle } = await import("../lib/matches.ts");
const { parseSol, requireDevnet, launchStatus } = await import("../lib/payments/policy.ts");
const { encryptWallet, decryptWallet } = await import("../lib/payments/vault.ts");
const { devnetConnection } = await import("../lib/payments/solana.ts");
const { safePaymentError } = await import("../lib/payments/errors.ts");

const account = (uid) => service.cashAccountId(uid);
const balance = (uid) => sqlite.prepare("SELECT balance FROM cash_accounts WHERE id=?").get(account(uid)).balance;
const status = (id) => sqlite.prepare("SELECT status FROM cash_transfers WHERE id=?").get(id).status;
const credit = (uid, amount) => sqlite.prepare("INSERT INTO cash_ledger VALUES(?,?,'fixture',?,'fixture',0)").run(crypto.randomUUID(), account(uid), amount);
const finalized = (signature, err = null) => statuses.set(signature, { slot: 20, confirmations: null, err, confirmationStatus: "finalized" });

// Amounts, cluster gates and wallet encryption.
assert.equal(parseSol("0.000000001"), 1);
assert.equal(parseSol("10.123456789"), 10123456789);
for (const value of ["0", "-1", "NaN", "1e2", "0.1234567891", "100001", 0.1]) assert.throws(() => parseSol(value));
assert.throws(() => requireDevnet({ ...testEnv, SOLANA_NETWORK: "mainnet" }));
assert.equal(launchStatus({ ...testEnv, SOLANA_NETWORK: "mainnet" }).mainnetEnabled, false);
genesis = Keypair.generate().publicKey.toBase58();
await assert.rejects(() => devnetConnection("https://rpc.invalid"), /cluster mismatch/);
genesis = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const key = testEnv.SOLANA_VAULT_KEY;
const wallet = Keypair.generate();
const encrypted = await encryptWallet(wallet, key, "owner");
assert.equal((await decryptWallet(encrypted, key, "owner")).publicKey.toBase58(), wallet.publicKey.toBase58());
assert.equal(wallet.secretKey.some((b) => b !== 0), true, "Encrypting must not zero the caller's keypair");
await assert.rejects(() => decryptWallet(encrypted, key, "another-owner"));
await assert.rejects(() => decryptWallet(encrypted, Buffer.alloc(32, 1).toString("base64"), "owner"));
const tampered = JSON.parse(encrypted);
tampered.data = Buffer.alloc(80, 1).toString("base64");
await assert.rejects(() => decryptWallet(JSON.stringify(tampered), key, "owner"));

// Deposits credit only after finality, once.
for (const uid of ["a", "b", service.HOUSE]) {
  sqlite.prepare("INSERT INTO players(id,name,created) VALUES(?,?,0)").run(uid, uid);
  await service.ensureCashAccount(uid);
}
const depositWallet = await service.ensureWallet("a");
const pool = await service.ensureWallet(service.POOL);
assert.equal((await service.ensureWallet("a")).address, depositWallet.address);
balances.set(depositWallet.address, 1_000_000_000);
balances.set(pool.address, 10_000_000_000);
const depositId = crypto.randomUUID();
const deposit = await service.beginDeposit("a", depositId);
assert.equal(balance("a"), 0, "Unconfirmed deposits must not fund games");
assert.equal(deposit.status, "pending");
const decoded = SystemInstruction.decodeTransfer(Transaction.from(Buffer.from(sent[0], "base64")).instructions[0]);
assert.equal(decoded.toPubkey.toBase58(), pool.address);
assert.equal(Number(decoded.lamports), 999995000);
await service.beginDeposit("a", depositId);
assert.equal(sent.length, 1, "Replay must not create a second deposit transaction");
finalized(deposit.signature);
await service.reconcileTransfer(deposit.id, "a");
await service.reconcileTransfer(deposit.id, "a");
assert.equal(balance("a"), 999995000);
await assert.rejects(() => service.reconcileTransfer(deposit.id, "b"), /not found/);

// Withdrawals reserve atomically, replay identically and serialize on the pool.
const destination = Keypair.generate().publicKey.toBase58();
const withdrawId = crypto.randomUUID();
const withdrawal = await service.beginWithdrawal("a", withdrawId, destination, "0.1");
assert.equal(balance("a"), 899990000);
const sendsBefore = sent.length;
await service.beginWithdrawal("a", withdrawId, destination, "0.1");
assert.equal(sent.length, sendsBefore);
await assert.rejects(() => service.beginWithdrawal("a", withdrawId, destination, "0.2"), /different request/);
await assert.rejects(() => service.beginWithdrawal("b", crypto.randomUUID(), destination, "0.1"), /still being confirmed/);
assert.equal(balance("a"), 899990000, "A blocked transfer must not reserve again");
// The database constraint still backstops two requests racing past the check.
assert.throws(
  () =>
    sqlite
      .prepare("INSERT INTO cash_transfers(id,network,user_id,account_id,kind,source,destination,amount,fee,signature,wire,last_valid_block_height,status,created,updated) VALUES(?,'devnet','b','x','withdrawal',?,?,1,1,?,'',1,'pending',0,0)")
      .run(crypto.randomUUID(), pool.address, destination, "race-signature"),
  /UNIQUE/,
);
await service.reconcileTransfer(withdrawId, "a");
assert.equal(sent.at(-1), sent.at(-2), "Retries submit the exact same signed bytes");

// Expired but possibly landed: hold within the margin, then settle from history.
height = 101;
await service.reconcileTransfer(withdrawId, "a");
assert.equal(status(withdrawId), "pending", "Just past expiry the reserve stays held");
assert.equal(balance("a"), 899990000);
finalized(withdrawal.signature);
await service.reconcileTransfer(withdrawId, "a");
assert.equal(status(withdrawId), "finalized");
assert.equal(balance("a"), 899990000);

// Failed on-chain: principal refunded once, fee kept.
height = 10;
const failed = await service.beginWithdrawal("a", crypto.randomUUID(), destination, "0.1");
finalized(failed.signature, { InstructionError: [0, "InsufficientFunds"] });
await service.reconcileTransfer(failed.id, "a");
await service.reconcileTransfer(failed.id, "a");
assert.equal(balance("a"), 899985000, "Failed withdrawal refunds principal once; fee remains charged");

// An abandoned transfer no longer freezes the pool: the next withdrawal, even by
// another player, resolves it first. Expired and absent from history means it
// can never land, so principal and fee both return, exactly once.
const abandoned = await service.beginWithdrawal("a", crypto.randomUUID(), destination, "0.1");
assert.equal(balance("a"), 799980000);
height = 100 + service.EXPIRY_MARGIN_BLOCKS + 1;
credit("b", 500_000_000);
const unblocked = await service.beginWithdrawal("b", crypto.randomUUID(), destination, "0.1");
assert.equal(status(abandoned.id), "expired");
assert.equal(balance("a"), 899985000, "Expired transfer returns principal and fee");
await service.reconcileTransfer(abandoned.id, "a");
assert.equal(balance("a"), 899985000, "Expiry refund applies once");
assert.equal(unblocked.status, "pending");
// A transfer that landed but whose status the RPC no longer reports is settled from history, not refunded.
landed.set(unblocked.signature, {
  slot: 30,
  blockTime: null,
  version: "legacy",
  meta: { err: null, fee: 5000, preBalances: [], postBalances: [], innerInstructions: null, logMessages: [], preTokenBalances: null, postTokenBalances: null, loadedAddresses: { readonly: [], writable: [] }, status: { Ok: null } },
  transaction: {
    signatures: [unblocked.signature],
    message: { accountKeys: [pool.address], header: { numRequiredSignatures: 1, numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: 0 }, instructions: [], recentBlockhash: blockhash },
  },
});
height += 90 + service.EXPIRY_MARGIN_BLOCKS + 1;
await service.reconcileTransfer(unblocked.id, "b");
assert.equal(status(unblocked.id), "finalized");
assert.equal(balance("b"), 500_000_000 - 100_000_000 - 5000);
// Legacy `review` rows resolve the same way.
const legacy = await (async () => {
  height = 10;
  const t = await service.beginWithdrawal("a", crypto.randomUUID(), destination, "0.1");
  sqlite.prepare("UPDATE cash_transfers SET status='review' WHERE id=?").run(t.id);
  return t;
})();
height = 100 + service.EXPIRY_MARGIN_BLOCKS + 1;
const sweep = await service.reconcileOpenTransfers();
assert.deepEqual(sweep, { checked: 1, resolved: 1, failed: 0 });
assert.equal(status(legacy.id), "expired");
assert.equal(balance("a"), 899985000);
assert.equal((await service.treasurySnapshot()).open.length, 0);
height = 10;

await assert.rejects(() => service.beginWithdrawal("a", crypto.randomUUID(), depositWallet.address, "0.1"), /external wallet/);
await assert.rejects(() => service.beginWithdrawal("a", crypto.randomUUID(), destination, "100"), /Insufficient/);
fee = null;
await assert.rejects(() => service.beginWithdrawal("a", crypto.randomUUID(), destination, "0.1"), /network fee/);
fee = 5000;
rpcFailure = true;
try {
  await service.beginWithdrawal("a", crypto.randomUUID(), destination, "0.1");
  assert.fail("Expected RPC failure");
} catch (e) {
  assert.ok(!safePaymentError(e).includes("secret-token"));
}
rpcFailure = false;

// Real settlement implementation: conservation, escrow, fee split, ties,
// repeat calls, and rollback if a pot cannot back its payouts.
credit("a", 3_000_000_000);
credit("b", 3_000_000_000);
async function match(id, tie = false, underfunded = false) {
  await service.ensureCashAccount("escrow:" + id);
  sqlite.prepare("INSERT INTO matches(id,seed,stake,asset,p1,p2,created) VALUES(?,1,1000000000,'devnet','a','b',0)").run(id);
  for (const [uid, score] of [
    ["a", 10],
    ["b", tie ? 10 : 5],
  ]) {
    sqlite.prepare("INSERT INTO runs(id,match_id,user_id,state,score,done,created) VALUES(?,?,?,'{}',?,1,0)").run(id + uid, id, uid, score);
    sqlite.prepare("INSERT INTO cash_ledger VALUES(?,?,'match_entry',-1000000000,?,0)").run(id + uid + "entry", account(uid), id);
  }
  credit("escrow:" + id, underfunded ? 1_000_000_000 : 2_000_000_000);
}
const houseBefore = balance(service.HOUSE);
await match("win");
const beforeA = balance("a");
const beforeB = balance("b");
await settle("win");
await settle("win");
assert.equal(balance("a"), beforeA + 1_760_000_000);
assert.equal(balance("b"), beforeB);
assert.equal(balance(service.HOUSE), houseBefore + 240_000_000);
assert.equal(balance("escrow:win"), 0);
await match("tie", true);
const tieA = balance("a");
const tieB = balance("b");
await settle("tie");
await settle("tie");
assert.equal(balance("a"), tieA + 1_000_000_000);
assert.equal(balance("b"), tieB + 1_000_000_000);
assert.equal(balance(service.HOUSE), houseBefore + 240_000_000);
await match("short", false, true);
const shortA = balance("a");
await assert.rejects(() => settle("short"), /insufficient/);
assert.equal(balance("a"), shortA);
assert.equal(sqlite.prepare("SELECT settled FROM matches WHERE id='short'").get().settled, 0);
assert.equal(sqlite.prepare("SELECT balance FROM players WHERE id='a'").get().balance, 20_000_000_000, "Devnet must not affect demo credits");
const treasury = await service.beginWithdrawal("admin", crypto.randomUUID(), destination, "0.1", true);
assert.equal(balance(service.HOUSE), houseBefore + 240_000_000 - 100_005_000);
assert.equal(balance("a"), shortA);
finalized(treasury.signature);
await service.reconcileTransfer(treasury.id, "admin");
assert.ok(!JSON.stringify(await service.walletSnapshot("a")).includes("encrypted_key"));
assert.ok(!JSON.stringify(await service.walletSnapshot("a")).includes("wire"));
console.log(
  "PASS: decimal precision, mainnet/cluster gates, encrypted wallet integrity, finalized-only deposits, replay safety, pool serialization, expiry holds, provable-expiry refunds, abandoned-transfer unblocking, failed-transfer refunds, secret redaction, escrow conservation, 12% fees, ties, atomic settlement rollback, demo isolation, treasury isolation.",
);
close();
