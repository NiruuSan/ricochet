import { database } from "@/db/raw";
import type { TipReceipt } from "../api-types";
import { cashAccountId, ensureCashAccount, settings } from "./accounts";
import { PaymentError } from "./errors";
import { parseSol, requireDevnet, validateOperationId } from "./policy";

export class TipNotSentError extends PaymentError {}

/** Move funded SOL balances atomically. The pool's total liabilities do not change. */
export async function sendTip(uid: string, idInput: unknown, recipientInput: unknown, amountInput: unknown): Promise<TipReceipt> {
  requireDevnet(settings());
  const id = validateOperationId(idInput);
  const amount = parseSol(amountInput);
  if (typeof recipientInput !== "string" || !/^[a-f0-9]{32}$/.test(recipientInput)) throw new PaymentError("Choose a valid player to tip.");
  const db = database();
  const [sender, recipient] = await Promise.all([
    db.prepare("SELECT 1 FROM players WHERE id = ?").bind(uid).first(),
    db.prepare("SELECT id, name FROM players WHERE public_id = ?").bind(recipientInput).first<{ id: string; name: string }>(),
  ]);
  if (!sender) throw new PaymentError("Create your player profile first.");
  if (!recipient) throw new PaymentError("This player is no longer available.");
  if (recipient.id === uid) throw new PaymentError("You cannot tip yourself.");
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
  const now = Date.now();
  try {
    // Plain INSERT makes concurrent reuse roll back the whole batch; replay then
    // verifies both accounts and the amount. The ledger trigger rejects overdrafts.
    await db.batch([
      db.prepare("INSERT INTO cash_ledger(id, account_id, kind, amount, reference, created) VALUES(?, ?, 'tip_sent', ?, ?, ?)")
        .bind(sentId, source, -amount, id, now),
      db.prepare("INSERT INTO cash_ledger(id, account_id, kind, amount, reference, created) VALUES(?, ?, 'tip_received', ?, ?, ?)")
        .bind(receivedId, destination, amount, id, now),
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
