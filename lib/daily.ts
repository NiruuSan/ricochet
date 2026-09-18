import { database } from "@/db/raw";
import type { DailyGems } from "./api-types";
import { isSuspended } from "./anti-cheat";
import { GameError } from "./matches";

// Free gems, once a day. A player who runs out of gems has nothing left to play
// with and no reason to come back, so every day brings a fresh entry, and days
// in a row are worth more. Gems are the free currency: this never touches SOL.

export const DAILY = {
  /** The first day of a streak. */
  base: 200,
  /** Every further day in a row adds this… */
  step: 50,
  /** …up to this, from the seventh day on. */
  cap: 500,
};

const DAY_MS = 86_400_000;

/** Days since the epoch, UTC: the day a claim belongs to, wherever the player is. */
export const dayOf = (now: number) => Math.floor(now / DAY_MS);

/** What a streak of `streak` consecutive days is worth. */
export const gemsFor = (streak: number) => Math.min(DAILY.cap, DAILY.base + Math.max(0, streak - 1) * DAILY.step);

/** The player's last claim up to `day`, which is today's or the one that carries a streak. */
const streakRow = (uid: string, day: number) =>
  database().prepare("SELECT day, streak, amount FROM daily_claims WHERE user_id = ? AND day <= ? ORDER BY day DESC LIMIT 1").bind(uid, day).first<{ day: number; streak: number; amount: number }>();

/** The player's daily gems: what they can claim, or what today already paid. */
export async function dailyGems(uid: string, now = Date.now()): Promise<DailyGems> {
  const day = dayOf(now);
  const [last, suspended] = await Promise.all([streakRow(uid, day), isSuspended(uid)]);
  const nextAt = (day + 1) * DAY_MS;
  if (last?.day === day) return { ready: false, streak: last.streak, amount: last.amount, nextAt };
  // Yesterday's claim carries the streak on; anything older starts again.
  const streak = last?.day === day - 1 ? last.streak + 1 : 1;
  return { ready: !suspended, streak, amount: gemsFor(streak), nextAt };
}

/**
 * Pays today's gems, once. The claim row is the lock: its primary key is the
 * player and the day, so two taps land one payment.
 */
export async function claimDailyGems(uid: string, now = Date.now()): Promise<DailyGems> {
  const db = database();
  const day = dayOf(now);
  const state = await dailyGems(uid, now);
  if (!state.ready) {
    if (await isSuspended(uid)) throw new GameError("Your account is suspended. Contact support if you think this is a mistake.", 403);
    throw new GameError("You have already claimed today's gems. Come back tomorrow.", 409);
  }
  const [claimed] = await db.batch([
    db.prepare("INSERT OR IGNORE INTO daily_claims(user_id, day, streak, amount, created) VALUES(?, ?, ?, ?, ?)").bind(uid, day, state.streak, state.amount, now),
    // The gems only exist if this call is the one that took today's slot.
    db
      .prepare("INSERT OR IGNORE INTO ledger(id, user_id, match_id, kind, amount, created) SELECT ?, ?, NULL, 'daily_gems', ?, ? FROM daily_claims WHERE user_id = ? AND day = ? AND created = ?")
      .bind(`daily:${uid}:${day}`, uid, state.amount, now, uid, day, now),
  ]);
  if (!claimed.meta.changes) throw new GameError("You have already claimed today's gems. Come back tomorrow.", 409);
  return { ready: false, streak: state.streak, amount: state.amount, nextAt: state.nextAt };
}
