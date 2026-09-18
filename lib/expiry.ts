import { database } from "@/db/raw";
import { settle } from "./matches";
import { refundMatch } from "./refunds";

// Nothing should stay open forever. A run whose player never came back ends at
// the score they left, so their opponent is paid instead of waiting; a seat
// nobody took hands the entry back.
//
// The sweep runs whenever a player loads the arena, behind a short lease, which
// is what keeps it prompt: a waiting opponent triggers it themselves. The
// scheduled call (app/api/cron) is only the backstop for a quiet site, and it is
// daily because that is all a Vercel Hobby project may schedule.

export const EXPIRY = {
  /** A run with no shot for this long ends where it is, as a forfeit would. */
  runIdleMs: 24 * 60 * 60_000,
  /** A match nobody joined in this long closes and the entry goes back in full. */
  seatIdleMs: 48 * 60 * 60_000,
  /** Matches handled per sweep: enough for the daily backstop, still one quick call. */
  batch: 25,
};

export const SEAT_EXPIRED_REASON = "No opponent took the seat in time. Your entry is back in your balance.";

/** How often the sweep may run off the back of a player's request. */
const LEASE_MS = 5 * 60_000;
const LEASE_KEY = "sweep_at";

/**
 * The sweep, but at most once every few minutes across the whole site. The lease
 * is the write itself: whoever updates the row runs, everyone else moves on, so
 * two requests landing together never sweep twice.
 */
export async function sweepIfDue(now = Date.now()) {
  const claimed = await database()
    .prepare(
      `INSERT INTO app_settings(key, value, updated_by, updated) VALUES(?, ?, 'system', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated = excluded.updated
       WHERE CAST(app_settings.value AS INTEGER) <= ?`,
    )
    .bind(LEASE_KEY, String(now), now, now - LEASE_MS)
    .run();
  if (!claimed.meta.changes) return null;
  return sweepStaleMatches(now);
}

/** The last thing that happened on a run: its last shot, or its start. */
const lastShotSql = (runId: string) => `COALESCE((SELECT MAX(s.created) FROM run_shots s WHERE s.run_key = 'm-' || ${runId}), r.created)`;

/**
 * Ends runs left unfinished and closes seats nobody took, oldest first.
 * Idempotent: settling and refunding are both keyed by the match.
 */
export async function sweepStaleMatches(now = Date.now()): Promise<{ forfeited: number; expired: number }> {
  const db = database();
  const abandoned = await db
    .prepare(
      `SELECT r.id, r.match_id FROM runs r
       JOIN matches m ON m.id = r.match_id
       WHERE r.done = 0 AND m.settled = 0 AND ${lastShotSql("r.id")} <= ?
       ORDER BY r.created LIMIT ?`,
    )
    .bind(now - EXPIRY.runIdleMs, EXPIRY.batch)
    .all<{ id: string; match_id: string }>();
  for (const run of abandoned.results) {
    const ended = await db
      .prepare("UPDATE runs SET done = 1, forfeit = 1, finished = COALESCE(finished, ?) WHERE id = ? AND done = 0")
      .bind(now, run.id)
      .run();
    if (ended.meta.changes) await settle(run.match_id);
  }

  // A seat is only expired once the creator can no longer be waiting on an
  // opponent: the match has waited long enough and nobody has taken it.
  const stale = await db
    .prepare(
      `SELECT m.id FROM matches m
       WHERE m.settled = 0 AND m.p2 IS NULL AND m.created <= ?
         AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.match_id = m.id AND r.done = 0 AND ${lastShotSql("r.id")} > ?)
       ORDER BY m.created LIMIT ?`,
    )
    .bind(now - EXPIRY.seatIdleMs, now - EXPIRY.runIdleMs, EXPIRY.batch)
    .all<{ id: string }>();
  let expired = 0;
  for (const { id } of stale.results) {
    try {
      await refundMatch(id, SEAT_EXPIRED_REASON, now);
      expired++;
    } catch (e) {
      // A seat taken or settled in the meantime is not an error; anything else is.
      if ((e as { status?: number }).status !== 409 && (e as { status?: number }).status !== 404) throw e;
    }
  }
  return { forfeited: abandoned.results.length, expired };
}
