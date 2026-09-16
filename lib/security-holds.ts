import { database } from "@/db/raw";
import { PaymentError } from "./payments/errors";

export const SECURITY_RESET_HOLD_MS = 72 * 60 * 60_000;

/** Independent of enrolment: setting up a new authenticator never clears a hold. */
export async function withdrawalHold(uid: string, now = Date.now()) {
  const row = await database().prepare('SELECT "until" FROM security_holds WHERE user_id = ? AND "until" > ?').bind(uid, now).first<{ until: number }>();
  return row?.until ?? null;
}

export async function assertWithdrawalsAllowed(uid: string, now = Date.now()) {
  const until = await withdrawalHold(uid, now);
  if (until !== null) throw new PaymentError(`Withdrawals are paused until ${new Date(until).toISOString()} after a security reset.`);
}
