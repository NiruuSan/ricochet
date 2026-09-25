import { database } from "@/db/raw";
import type { AdminOverview } from "./api-types";
import { GameError } from "./matches";
import { volumeHistory } from "./admin-volume";
import { adminGrowth } from "./admin-growth";
import { avatarUrl, ONLINE_MS } from "./matches";
import { HOUSE } from "./payments/accounts";

/** The note an administrator writes on a decision, trimmed and, where it is the record, required. */
export const adminNote = (value: unknown, required: boolean) => {
  const text = String(value ?? "").trim().slice(0, 300);
  if (required && text.length < 3) throw new GameError("Write a short note explaining the decision.");
  return text;
};

/** An audit row for an administrator action, for an existing batch. */
export const adminAudit = (adminUid: string, action: string, target: string, reason: string, now: number) =>
  database()
    .prepare("INSERT INTO admin_audit(id, admin_id, action, target_user_id, reason, created) VALUES(?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), adminUid, action, target, reason, now);

/**
 * Every game opened on the site, as one stream of creation times: a tournament
 * is one game here, the same way the leaderboard counts it.
 */
const GAMES_OPENED = "(SELECT asset, created FROM matches UNION ALL SELECT asset, created FROM tournaments)";

/** Player counts and rolling volumes for the administrator dashboard. */
export async function adminOverview(now = Date.now()): Promise<AdminOverview> {
  const db = database();
  const [players, online, queues, devEntries, devGames, deposits, withdrawals, devFees, gemEntries, gemGames, gemFees] = await Promise.all([
    db
      .prepare("SELECT COUNT(*) AS registered, COALESCE(SUM(CASE WHEN last_seen >= ? THEN 1 ELSE 0 END), 0) AS online FROM players")
      .bind(now - ONLINE_MS)
      .first<{ registered: number; online: number }>(),
    db.prepare("SELECT name, avatar FROM players WHERE last_seen >= ? ORDER BY last_seen DESC LIMIT 24").bind(now - ONLINE_MS).all<{ name: string; avatar: string | null }>(),
    // What is waiting to be dealt with, for the badges on the admin rail.
    db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM matches WHERE settled = 0) AS games,
                (SELECT COUNT(*) FROM player_suspensions WHERE status = 'suspended') AS cases,
                (SELECT COUNT(*) FROM reports WHERE status = 'open') AS reports,
                (SELECT COUNT(*) FROM bug_reports WHERE status = 'open') AS bugs`,
      )
      .first<{ games: number; cases: number; reports: number; bugs: number }>(),
    // Devnet SOL staked by players, in matches and in tournaments alike.
    volumeHistory(db, now, "cash_ledger", "-amount", "kind IN ('match_entry', 'tournament_entry')"),
    volumeHistory(db, now, GAMES_OPENED, "1", "asset = 'devnet'"),
    volumeHistory(db, now, "cash_transfers", "amount", "kind = 'deposit' AND status = 'finalized' AND user_id <> ?", "updated", [HOUSE]),
    volumeHistory(db, now, "cash_transfers", "amount", "kind = 'withdrawal' AND status = 'finalized'", "updated"),
    volumeHistory(db, now, "cash_ledger", "amount", "kind = 'house_fee'"),
    volumeHistory(db, now, "ledger", "-amount", "kind IN ('entry', 'tournament_entry')"),
    volumeHistory(db, now, GAMES_OPENED, "1", "asset = 'gems'"),
    volumeHistory(db, now, "matches", "fee", "asset = 'gems' AND settled = 1"),
  ]);
  const registered = Number(players?.registered ?? 0);
  const onlineCount = Number(players?.online ?? 0);
  return {
    growth: await adminGrowth(now),
    players: {
      registered,
      online: onlineCount,
      offline: registered - onlineCount,
      onlineNames: online.results.map((p) => ({ name: p.name, avatar: avatarUrl(p.avatar) })),
    },
    queues: {
      games: Number(queues?.games ?? 0),
      cases: Number(queues?.cases ?? 0),
      reports: Number(queues?.reports ?? 0),
      bugs: Number(queues?.bugs ?? 0),
    },
    devnet: { entries: devEntries, games: devGames, deposits, withdrawals, fees: devFees },
    gems: { entries: gemEntries, games: gemGames, fees: gemFees },
    generated: now,
  };
}
