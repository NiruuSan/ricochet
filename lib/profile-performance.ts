import { database } from "@/db/raw";
import type { Asset, PnlRange, ProfileMatch, ProfilePerformance } from "./api-types";
import { avatarUrl } from "./matches";
import { cashAccountId } from "./payments/accounts";
import { profileStats } from "./profile-stats";
import { findPlayer, type PlayerRef } from "./public-profile";
import { tournamentHistory } from "./tournament-history";

const DAY = 86_400_000;

/** Cumulative settled PNL within each range, with a zero baseline. */
export function pnlSeries(history: ProfileMatch[], now: number): ProfilePerformance["series"] {
  const settled = history.filter((match) => match.settled && match.ended <= now);
  const earliest = settled.reduce((start, match) => Math.min(start, match.ended), now - DAY);
  const windows: Record<PnlRange, [number, number]> = {
    day: [now - DAY, 24], week: [now - 7 * DAY, 28], month: [now - 30 * DAY, 60],
    year: [now - 365 * DAY, 100], all: [earliest, 100],
  };
  const series = {} as ProfilePerformance["series"];
  for (const range of Object.keys(windows) as PnlRange[]) {
    const [start, count] = windows[range];
    const step = (now - start) / count;
    const buckets = Array<number>(count).fill(0);
    for (const match of settled) {
      if (match.ended < start) continue;
      const index = Math.min(count - 1, Math.floor((match.ended - start) / step));
      buckets[index] += match.net;
    }
    let value = 0;
    const points = [{ at: start, value: 0 }, ...buckets.map((delta, i) => ({ at: start + (i + 1) * step, value: value += delta }))];
    series[range] = { total: value, points };
  }
  return series;
}

/** Public history of matches and tournament entries. Wallet balances, tips and scores stay private. */
export async function profilePerformance(ref: PlayerRef | { id: string; public_id: string }, asset: Asset, now = Date.now()): Promise<ProfilePerformance> {
  const db = database();
  const player = typeof ref === "object" && "public_id" in ref ? ref : await findPlayer(ref);
  const gems = asset === "gems";
  const table = gems ? "ledger" : "cash_ledger";
  const reference = gems ? "match_id" : "reference";
  const owner = gems ? "user_id" : "account_id";
  const kinds = gems ? "'entry', 'payout', 'refund'" : "'match_entry', 'match_payout', 'match_refund'";
  const [{ results }, entries, stats] = await Promise.all([db.prepare(`
    SELECT m.id, m.stake, m.created, m.settled, p.name AS opponent, p.avatar AS opponentAvatar,
      CASE WHEN m.p2 IS NOT NULL OR m.settled = 1 THEN (SELECT 'm-' || r.id FROM runs r WHERE r.match_id = m.id AND r.user_id = ?) END AS watchId,
      CASE WHEN m.settled = 0 THEN NULL WHEN m.cancelled = 1 THEN 'cancelled'
        WHEN m.winner IS NULL THEN 'draw' WHEN m.winner = ? THEN 'win' ELSE 'loss' END AS result,
      CASE WHEN m.settled = 1 THEN COALESCE(SUM(CASE WHEN l.${owner} = ? THEN l.amount ELSE 0 END), 0) ELSE 0 END AS net,
      COALESCE(MAX(l.created), m.created) AS ended
    FROM matches m
    LEFT JOIN ${table} l ON l.${reference} = m.id AND l.kind IN (${kinds})
    LEFT JOIN players p ON p.id = CASE WHEN m.p1 = ? THEN m.p2 ELSE m.p1 END
    WHERE m.id IN (SELECT id FROM matches WHERE p1 = ? AND asset = ? UNION ALL SELECT id FROM matches WHERE p2 = ? AND asset = ?)
    GROUP BY m.id ORDER BY m.created DESC, m.id DESC
  `).bind(player.id, player.id, gems ? player.id : cashAccountId(player.id), player.id, player.id, asset, player.id, asset).all<ProfileMatch>(),
    tournamentHistory(player.id, asset, 100, now), profileStats(player.id, asset)]);
  const tournaments: ProfileMatch[] = entries.map((t) => ({
    id: t.id, stake: t.entryFee, created: t.registered, settled: t.status === "settled" || t.status === "cancelled" ? 1 : 0,
    opponent: null, opponentAvatar: null, result: t.status === "cancelled" ? "cancelled" : null, net: t.net, ended: t.ended,
    tournament: { name: t.name, status: t.status, rank: t.rank, players: t.players }, watchId: t.watchId,
  }));
  const history = [...results.map((match) => ({ ...match, opponentAvatar: avatarUrl(match.opponentAvatar), tournament: null })), ...tournaments]
    .sort((a, b) => b.created - a.created || (a.id < b.id ? 1 : -1));
  return {
    asset, generated: now, played: history.length, stats,
    openEntries: history.reduce((sum, match) => sum + (match.settled ? 0 : match.stake), 0),
    bestWin: history.reduce((best, match) => Math.max(best, match.net), 0),
    history: history.slice(0, 100),
    series: pnlSeries(history, now),
  };
}
