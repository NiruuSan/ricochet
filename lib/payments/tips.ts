import { assertCanMoveMoney } from "../anti-cheat";
import { BLOCKED_MESSAGE, blockedBetween } from "../blocks";
import { database } from "@/db/raw";
import type { TipReceipt } from "../api-types";
import { notificationInsert } from "../notifications";
import { twoFactorEnabled, verifySecondFactor } from "../two-factor";
import { cashAccountId, ensureCashAccount, settings } from "./accounts";
import { PaymentError } from "./errors";
import { parseSol, requireDevnet, validateOperationId } from "./policy";

export class TipNotSentError extends PaymentError {}

/**
 * A tip is the one way funds leave an account without a withdrawal, so it is
 * gated like one. Small tips stay a one-tap gesture; past a day's worth of them
 * the second factor is asked for. There is no ceiling beyond that: with the
 * code in hand a player may tip whatever they hold.
 */
export const TIP_LIMITS = {
  /** Tips in a day that need nothing but the session. */
  free: 100_000_000,
};

/** Asked for when a tip crosses the free daily allowance; `enrolled` says whether a code can be given at all. */
export class TipCodeRequiredError extends PaymentError {
  readonly enrolled: boolean;
  constructor(message: string, enrolled: boolean) {
    super(message);
    this.enrolled = enrolled;
  }
}

const DAY_MS = 86_400_000;
/** The UTC day a moment belongs to, as the daily gems count them. */
const dayStart = (now: number) => Math.floor(now / DAY_MS) * DAY_MS;

/** What this account has already tipped away today, in lamports. */
async function tippedToday(accountId: string, now: number) {
  const row = await database()
    .prepare("SELECT COALESCE(SUM(-amount), 0) AS sent FROM cash_ledger WHERE account_id = ? AND kind = 'tip_sent' AND created >= ? AND created < ?")
    .bind(accountId, dayStart(now), dayStart(now) + DAY_MS)
    .first<{ sent: number }>();
  return Number(row?.sent ?? 0);
}

/** Move funded SOL balances atomically. The pool's total liabilities do not change. */
export async function sendTip(uid: string, idInput: unknown, recipientInput: unknown, amountInput: unknown, codeInput?: unknown, now = Date.now()): Promise<TipReceipt> {
  requireDevnet(settings());
  const id = validateOperationId(idInput);
  const amount = parseSol(amountInput);
  if (typeof recipientInput !== "string" || !/^[a-f0-9]{32}$/.test(recipientInput)) throw new PaymentError("Choose a valid player to tip.");
  const db = database();
  const [sender, recipient] = await Promise.all([
    db.prepare("SELECT name FROM players WHERE id = ?").bind(uid).first<{ name: string }>(),
    db.prepare("SELECT id, name FROM players WHERE public_id = ?").bind(recipientInput).first<{ id: string; name: string }>(),
  ]);
  if (!sender) throw new PaymentError("Create your player profile first.");
  if (!recipient) throw new PaymentError("This player is no longer available.");
  if (recipient.id === uid) throw new PaymentError("You cannot tip yourself.");
  if (await blockedBetween(uid, recipient.id)) throw new PaymentError(BLOCKED_MESSAGE);
  await assertCanMoveMoney(uid);
  const sentId = `tip:${id}:sent`, receivedId = `tip:${id}:received`;
  const replay = async (): Promise<TipReceipt | null> => {
    const rows = await db.prepare("SELECT id, account_id, amount, created FROM cash_ledger WHERE id IN (?, ?)")
      .bind(sentId, receivedId).all<{ id: string; account_id: string; amount: number; created: number }>();
    if (!rows.results.length) return null;
    const sent = rows.results.find((row) => row.id === sentId);
    const received = rows.results.find((row) => row.id === receivedId);
    if (!sent || !received || sent.account_id !== cashAccountId(uid) || received.account_id !== cashAccountId(recipient.id)
      || sent.amount !== -amount || received.amount !== amount) throw new PaymentError("Operation ID was already used for a different request.");
    return { id, amount, recipient: recipient.name, created: sent.created };
  };
  const prior = await replay();
  if (prior) return prior;
  const [source, destination] = await Promise.all([ensureCashAccount(uid), ensureCashAccount(recipient.id)]);

  // The balance and the second factor are both settled before any code is
  // spent: a tip refused here costs the player nothing.
  const funded = await db.prepare("SELECT balance FROM cash_accounts WHERE id = ?").bind(source).first<{ balance: number }>();
  if (!funded || funded.balance < amount) throw new TipNotSentError("Not enough available devnet SOL. Fund your wallet or choose a smaller tip.");
  const already = await tippedToday(source, now);
  if (already + amount > TIP_LIMITS.free) {
    if (!codeInput) {
      const enrolled = await twoFactorEnabled(uid);
      throw new TipCodeRequiredError(
        enrolled
          ? "Tips above the daily free allowance need your authentication code."
          : "Turn on two-factor authentication to send tips this large. Small tips stay one tap.",
        enrolled,
      );
    }
    await verifySecondFactor(uid, codeInput, now);
  }
  try {
    // Plain INSERT makes concurrent reuse roll back the whole batch; replay then
    // verifies both accounts and the amount. The ledger trigger rejects overdrafts.
    await db.batch([
      db.prepare("INSERT INTO cash_ledger(id, account_id, kind, amount, reference, created) VALUES(?, ?, 'tip_sent', ?, ?, ?)")
        .bind(sentId, source, -amount, id, now),
      db.prepare("INSERT INTO cash_ledger(id, account_id, kind, amount, reference, created) VALUES(?, ?, 'tip_received', ?, ?, ?)")
        .bind(receivedId, destination, amount, id, now),
      notificationInsert(db, `tip:${id}:notify`, recipient.id, "tip_received", { amount, from: sender.name }, now),
      // The sender hears about their own money leaving, so a tip they did not send stands out.
      notificationInsert(db, `tip:${id}:sent`, uid, "security_alert", { event: "tip_sent", amount, to: recipient.name }, now),
    ]);
  } catch (error) {
    const completed = await replay();
    if (completed) return completed;
    if (error instanceof Error && /cash balance insufficient|cash_balance_nonnegative/.test(error.message)) {
      throw new TipNotSentError("Not enough available devnet SOL. Fund your wallet or choose a smaller tip.");
    }
    throw error;
  }
  return { id, amount, recipient: recipient.name, created: now };
}
