import { database } from "@/db/raw";

// The one question everything else asks about a block, kept in a module of its
// own so the game, the wallet and the friends list can all ask it without
// importing each other. What a block means, and how one is made, is in
// lib/moderation.ts.

/**
 * The message a blocked interaction gets. It never says who blocked whom: a
 * player learns that they cannot reach someone, not why.
 */
export const BLOCKED_MESSAGE = "You cannot reach this player.";

/** Whether anything stands between these two, in either direction. */
export async function blockedBetween(a: string, b: string) {
  if (!a || !b || a === b) return false;
  const row = await database()
    .prepare("SELECT 1 AS x FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)")
    .bind(a, b, b, a)
    .first();
  return !!row;
}
