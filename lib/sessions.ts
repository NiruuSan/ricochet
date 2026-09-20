import { database } from "@/db/raw";
import { notificationInsert } from "./notifications";

/**
 * Signing out everywhere. Sessions are stateless cookies, so there is nothing to
 * delete: the moment is recorded instead, and any session that proved who it was
 * before that moment is refused from then on. A cookie copied off a shared
 * computer, or lifted from a device that was lost, stops working.
 *
 * Every signed-in request asks this question, so the answer is held in memory
 * for a moment rather than read from the database each time. The reset is
 * immediate on the instance that performed it and reaches the others within
 * CACHE_MS, which is the price of not adding a query to every request.
 */
const CACHE_MS = 30_000;
/** A rough ceiling; the map is per running instance and holds one small entry per player. */
const CACHE_MAX = 5_000;
const cache = new Map<string, { invalidBefore: number; at: number }>();

async function invalidBefore(uid: string, now: number) {
  const known = cache.get(uid);
  if (known && now - known.at < CACHE_MS) return known.invalidBefore;
  const row = await database().prepare("SELECT invalid_before FROM session_resets WHERE user_id = ?").bind(uid).first<{ invalid_before: number }>();
  const moment = Number(row?.invalid_before ?? 0);
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(uid, { invalidBefore: moment, at: now });
  return moment;
}

/**
 * Whether a session that last proved who it was at `authTime` may still be
 * used. Sessions issued before this was recorded at all count as older than any
 * reset, so they go too.
 */
export async function sessionCurrent(uid: string, authTime: number | null, now = Date.now()) {
  const moment = await invalidBefore(uid, now);
  if (!moment) return true;
  return authTime !== null && authTime >= moment;
}

/** Ends every session of this player, including the one asking. */
export async function signOutEverywhere(uid: string, now = Date.now()) {
  const db = database();
  await db.batch([
    db
      .prepare(
        `INSERT INTO session_resets(user_id, invalid_before, created) VALUES(?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET invalid_before = excluded.invalid_before, created = excluded.created`,
      )
      .bind(uid, now, now),
    notificationInsert(db, `signed-out:${now}`, uid, "security_alert", { event: "signed_out_everywhere" }, now),
  ]);
  cache.set(uid, { invalidBefore: now, at: now });
  return { signedOutAt: now };
}

/** Test hook: the cache is per instance and outlives a test's database otherwise. */
export const forgetSessionCache = () => cache.clear();
