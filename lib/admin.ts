import { database } from "@/db/raw";
import type { AdminOverview } from "./api-types";
import { volumeHistory } from "./admin-volume";
import { avatarUrl, ONLINE_MS } from "./matches";
import { HOUSE } from "./payments/accounts";

/** Player counts and rolling volumes for the administrator dashboard. */
export async function adminOverview(now = Date.now()): Promise<AdminOverview> {
  const db = database();
  const [players, online, devEntries, devMatches, deposits, withdrawals, devFees, gemEntries, gemMatches, gemFees] = await Promise.all([
    db
      .prepare("SELECT COUNT(*) AS registered, COALESCE(SUM(CASE WHEN last_seen >= ? THEN 1 ELSE 0 END), 0) AS online FROM players")
      .bind(now - ONLINE_MS)
      .first<{ registered: number; online: number }>(),
    db.prepare("SELECT name, avatar FROM players WHERE last_seen >= ? ORDER BY last_seen DESC LIMIT 24").bind(now - ONLINE_MS).all<{ name: string; avatar: string | null }>(),
    // Devnet SOL staked into matches by players.
    volumeHistory(db, now, "cash_ledger", "-amount", "kind = 'match_entry'"),
    volumeHistory(db, now, "matches", "1", "asset = 'devnet'"),
    volumeHistory(db, now, "cash_transfers", "amount", "kind = 'deposit' AND status = 'finalized' AND user_id <> ?", "updated", [HOUSE]),
    volumeHistory(db, now, "cash_transfers", "amount", "kind = 'withdrawal' AND status = 'finalized'", "updated"),
    volumeHistory(db, now, "cash_ledger", "amount", "kind = 'house_fee'"),
    volumeHistory(db, now, "ledger", "-amount", "kind = 'entry'"),
    volumeHistory(db, now, "matches", "1", "asset = 'gems'"),
    volumeHistory(db, now, "matches", "fee", "asset = 'gems' AND settled = 1"),
  ]);
  const registered = Number(players?.registered ?? 0);
  const onlineCount = Number(players?.online ?? 0);
  return {
    players: {
      registered,
      online: onlineCount,
      offline: registered - onlineCount,
      onlineNames: online.results.map((p) => ({ name: p.name, avatar: avatarUrl(p.avatar) })),
    },
    devnet: { entries: devEntries, matches: devMatches, deposits, withdrawals, fees: devFees },
    gems: { entries: gemEntries, matches: gemMatches, fees: gemFees },
    generated: now,
  };
}
