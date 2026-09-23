import { database } from "@/db/raw";

const WINDOW_MS = 60_000;

/** Per-minute request budgets, keyed by authenticated user (or client IP for public reads). */
export const LIMITS = {
  gameRead: 120,
  gameWrite: 120,
  walletRead: 60,
  walletWrite: 30,
  treasuryWrite: 60,
  profileWrite: 20,
  /** Buying or changing a skin: a handful of taps, never a stream. */
  themeWrite: 20,
  bugReportWrite: 5,
  bugAttachmentWrite: 20,
  tournamentWrite: 30,
  /** Two-factor setup and changes; wrong codes are also locked out after five tries. */
  securityWrite: 20,
  /** Public pages polled by visitors and players: arena, spectating, tournaments, profiles. */
  publicRead: 300,
} as const;

/**
 * Counts one request against a fixed one-minute window and reports whether the
 * caller is over budget. The counter is a single atomic upsert, so concurrent
 * requests cannot slip past the limit together.
 */
export async function rateLimited(scope: keyof typeof LIMITS, userId: string, now = Date.now()) {
  const db = database();
  const window = Math.floor(now / WINDOW_MS);
  const row = await db
    .prepare(
      `INSERT INTO rate_limits(key, "window", count) VALUES(?, ?, 1)
       ON CONFLICT(key, "window") DO UPDATE SET count = count + 1
       RETURNING count`,
    )
    .bind(`${scope}:${userId}`, window)
    .first<{ count: number }>();
  // Old windows are never read again; prune them occasionally.
  if (Math.random() < 0.01) await db.prepare(`DELETE FROM rate_limits WHERE "window" < ?`).bind(window - 1).run();
  return (row?.count ?? 0) > LIMITS[scope];
}

export const TOO_MANY_REQUESTS = "Too many requests. Wait a minute before trying again.";
