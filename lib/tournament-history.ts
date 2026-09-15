import { database } from "@/db/raw";
import type { Asset, TournamentHistoryItem, TournamentStatus } from "./api-types";
import { cashAccountId } from "./payments/accounts";

type Timing = { status: string; starts_at: number; ends_at: number };

export function tournamentStatus(t: Timing, now = Date.now()): TournamentStatus {
  if (t.status === "settled" || t.status === "cancelled") return t.status;
  return now < t.starts_at ? "registration" : now < t.ends_at ? "live" : "closing";
}

type HistoryRow = Timing & {
  id: string;
  entry_id: string;
  name: string;
  entry_fee: number;
  registered: number;
  score: number;
  started: number;
  done: number;
  rank: number | null;
  payout: number;
  players: number;
  ledger_net: number;
};

/**
 * A player's tournament entries in one currency, newest first. Net is what the
 * entry, prize and any refund came to, and only counts once the tournament is
 * paid out or cancelled.
 */
export async function tournamentHistory(uid: string, asset: Asset, limit = 50, now = Date.now()): Promise<TournamentHistoryItem[]> {
  const gems = asset === "gems";
  const ledger = gems
    ? "SELECT SUM(l.amount) FROM ledger l WHERE l.user_id = ? AND l.match_id = t.id"
    : "SELECT SUM(l.amount) FROM cash_ledger l WHERE l.account_id = ? AND l.reference = t.id";
  const { results } = await database()
    .prepare(
      `SELECT t.id, e.id AS entry_id, t.name, t.entry_fee, t.status, t.starts_at, t.ends_at,
         e.registered, e.score, e.state IS NOT NULL AS started, e.done, e.rank, e.payout,
         (SELECT COUNT(*) FROM tournament_entries x WHERE x.tournament_id = t.id AND x.state IS NOT NULL) AS players,
         COALESCE((${ledger} AND l.kind IN ('tournament_entry', 'tournament_prize', 'tournament_refund')), 0) AS ledger_net
       FROM tournament_entries e JOIN tournaments t ON t.id = e.tournament_id
       WHERE e.user_id = ? AND t.asset = ?
       ORDER BY e.registered DESC LIMIT ?`,
    )
    .bind(gems ? uid : cashAccountId(uid), uid, asset, limit)
    .all<HistoryRow>();
  return results.map((row) => {
    const status = tournamentStatus(row, now);
    const closed = status === "settled" || status === "cancelled";
    return {
      id: row.id,
      name: row.name,
      entryFee: row.entry_fee,
      status,
      registered: row.registered,
      ended: row.ends_at,
      score: row.score,
      started: !!row.started,
      done: !!row.done,
      rank: row.rank,
      players: row.players,
      payout: row.payout,
      net: closed ? row.ledger_net : 0,
      watchId: row.started ? `t-${row.entry_id}` : null,
    };
  });
}
