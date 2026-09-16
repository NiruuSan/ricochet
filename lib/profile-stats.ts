import { database } from "@/db/raw";
import type { Asset, ProfileStats } from "./api-types";

type MatchRun = { score: number; clears: number; round: number; result: "win" | "loss" | "draw" };
type TournamentRun = { score: number; clears: number; round: number; rank: number | null };

/**
 * Skill and results statistics for one currency. Only finished competition
 * counts: settled matches (cancelled ones excluded) and tournaments that have
 * paid out. A score still in play is never revealed through these numbers.
 */
export async function profileStats(playerId: string, asset: Asset): Promise<ProfileStats> {
  const db = database();
  const [matches, tournaments] = await Promise.all([
    db
      .prepare(
        `SELECT r.score, r.clears, json_extract(r.state, '$.round') AS round,
           CASE WHEN m.winner IS NULL THEN 'draw' WHEN m.winner = r.user_id THEN 'win' ELSE 'loss' END AS result
         FROM runs r JOIN matches m ON m.id = r.match_id
         WHERE r.user_id = ? AND m.asset = ? AND m.settled = 1 AND m.cancelled = 0
         ORDER BY m.created ASC, m.id ASC`,
      )
      .bind(playerId, asset)
      .all<MatchRun>(),
    db
      .prepare(
        `SELECT e.score, e.clears, json_extract(e.state, '$.round') AS round, e.rank
         FROM tournament_entries e JOIN tournaments t ON t.id = e.tournament_id
         WHERE e.user_id = ? AND t.asset = ? AND t.status = 'settled' AND e.state IS NOT NULL`,
      )
      .bind(playerId, asset)
      .all<TournamentRun>(),
  ]);

  const played = matches.results;
  const wins = played.filter((m) => m.result === "win").length;
  const losses = played.filter((m) => m.result === "loss").length;
  const draws = played.length - wins - losses;

  // Streaks run over matches in the order they were created; a draw ends any streak.
  let bestWinStreak = 0;
  let run = 0;
  for (const m of played) {
    run = m.result === "win" ? run + 1 : 0;
    bestWinStreak = Math.max(bestWinStreak, run);
  }
  let streak = 0;
  const last = played.at(-1)?.result;
  if (last === "win" || last === "loss") {
    for (let i = played.length - 1; i >= 0 && played[i].result === last; i--) streak++;
    if (last === "loss") streak = -streak;
  }

  const runs = [...played, ...tournaments.results];
  const ranked = tournaments.results.filter((t) => t.rank !== null);
  return {
    matches: {
      played: played.length,
      wins,
      losses,
      draws,
      winRate: played.length ? wins / played.length : null,
      streak,
      bestWinStreak,
    },
    runs: {
      played: runs.length,
      bestScore: runs.reduce((best, r) => Math.max(best, r.score), 0),
      averageScore: runs.length ? Math.round(runs.reduce((sum, r) => sum + r.score, 0) / runs.length) : null,
      bestRound: runs.reduce((best, r) => Math.max(best, Number(r.round) || 0), 0),
      clears: runs.reduce((sum, r) => sum + r.clears, 0),
    },
    tournaments: {
      played: tournaments.results.length,
      wins: ranked.filter((t) => t.rank === 1).length,
      podiums: ranked.filter((t) => t.rank! <= 3).length,
      bestRank: ranked.length ? Math.min(...ranked.map((t) => t.rank!)) : null,
    },
  };
}
