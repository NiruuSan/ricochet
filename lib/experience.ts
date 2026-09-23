import { database } from "@/db/raw";
import { experienceFromWagered, levelFor, type PlayerLevel } from "./levels";

/**
 * Lamports a player has wagered on finished competition, as a scalar subquery on
 * `player` (a SQL expression for the player ID). It reads the player's devnet
 * ledger through its account index:
 * - match entries once the match is settled; cancelled matches do not count;
 * - tournament entries once the tournament is settled, cancelled or deleted,
 *   minus refunds, so a refunded entry counts for nothing.
 * Ledger rows are never deleted, so experience never goes down.
 *
 * `since` counts only what was wagered from that moment: the rank shown around
 * the game is the season's (lib/seasons.ts), while the profile also shows the
 * career one, which is this with no `since` at all.
 */
export const wageredSql = (player: string, since = 0) => `(
  SELECT COALESCE(SUM(-l.amount), 0) FROM cash_ledger l
  LEFT JOIN matches m ON l.kind = 'match_entry' AND m.id = l.reference
  LEFT JOIN tournaments t ON l.kind IN ('tournament_entry', 'tournament_refund') AND t.id = l.reference
  WHERE l.account_id = 'devnet:' || ${player} AND l.created >= ${Math.max(0, Math.floor(Number(since) || 0))}
    AND ((l.kind = 'match_entry' AND m.settled = 1 AND m.cancelled = 0)
      OR (l.kind IN ('tournament_entry', 'tournament_refund') AND (t.id IS NULL OR t.status IN ('settled', 'cancelled'))))
)`;

export async function playerLevel(playerId: string, since = 0): Promise<PlayerLevel> {
  const row = await database().prepare(`SELECT ${wageredSql("?", since)} AS wagered`).bind(playerId).first<{ wagered: number }>();
  return levelFor(experienceFromWagered(row?.wagered ?? 0));
}
