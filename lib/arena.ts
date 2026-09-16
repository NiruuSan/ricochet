import { database } from "@/db/raw";
import type { ArenaOverview, Asset, BestRun, MatchResult, RecentGame } from "./api-types";
import { avatarUrl, netResult, ONLINE_MS, openSeats } from "./matches";
import { entryWatchId, liveGames, matchWatchId } from "./spectate";
import { tournamentStatus } from "./tournament-history";
import { listTournaments } from "./tournaments";

const DAY = 86_400_000;

type MatchRow = {
  id: string;
  asset: Asset;
  stake: number;
  fee: number;
  run_id: string;
  score: number;
  result: MatchResult | null;
  opponent: string | null;
  opponent_avatar: string | null;
  opponent_score: number | null;
  at: number;
};

type EntryRow = {
  entry_id: string;
  id: string;
  name: string;
  asset: Asset;
  entry_fee: number;
  status: string;
  starts_at: number;
  ends_at: number;
  score: number;
  rank: number | null;
  payout: number;
  players: number;
  at: number;
};

/** The player's last three finished runs, matches and tournaments together, newest first. */
async function recentGames(uid: string, now: number): Promise<RecentGame[]> {
  const db = database();
  const [matches, entries] = await Promise.all([
    db
      .prepare(
        `SELECT m.id, m.asset, m.stake, m.fee, r.id AS run_id, r.score, r.created AS at,
           CASE WHEN m.settled = 0 THEN NULL WHEN m.cancelled = 1 THEN 'cancelled'
                WHEN m.winner IS NULL THEN 'draw' WHEN m.winner = r.user_id THEN 'win' ELSE 'loss' END AS result,
           o.name AS opponent, o.avatar AS opponent_avatar,
           CASE WHEN m.settled = 1 THEN other.score END AS opponent_score
         FROM runs r
         JOIN matches m ON m.id = r.match_id
         LEFT JOIN runs other ON other.match_id = m.id AND other.user_id <> r.user_id
         LEFT JOIN players o ON o.id = other.user_id
         WHERE r.user_id = ? AND r.done = 1
         ORDER BY r.created DESC LIMIT 3`,
      )
      .bind(uid)
      .all<MatchRow>(),
    db
      .prepare(
        `SELECT e.id AS entry_id, t.id, t.name, t.asset, t.entry_fee, t.status, t.starts_at, t.ends_at,
           e.score, e.rank, e.payout, e.started AS at,
           (SELECT COUNT(*) FROM tournament_entries x WHERE x.tournament_id = t.id AND x.state IS NOT NULL) AS players
         FROM tournament_entries e JOIN tournaments t ON t.id = e.tournament_id
         WHERE e.user_id = ? AND e.state IS NOT NULL AND e.done = 1
         ORDER BY e.started DESC LIMIT 3`,
      )
      .bind(uid)
      .all<EntryRow>(),
  ]);
  const games: RecentGame[] = [
    ...matches.results.map((m): RecentGame => ({
      kind: "match",
      id: m.id,
      asset: m.asset,
      title: m.opponent ?? "Open seat",
      avatar: avatarUrl(m.opponent_avatar),
      outcome: m.result ?? "waiting",
      rank: null,
      players: null,
      score: m.score,
      opponentScore: m.opponent_score,
      net: m.result ? netResult(m.result, m.stake, m.fee) : null,
      // An open seat cannot be watched by others, but the player may replay their own run.
      watchId: matchWatchId(m.run_id),
      at: m.at,
    })),
    ...entries.results.map((e): RecentGame => {
      const status = tournamentStatus(e, now);
      const settled = status === "settled";
      return {
        kind: "tournament",
        id: e.id,
        asset: e.asset,
        title: e.name,
        avatar: null,
        outcome: status === "cancelled" ? "cancelled" : settled ? (e.payout > 0 ? "win" : "loss") : "waiting",
        rank: settled ? e.rank : null,
        players: e.players,
        score: e.score,
        opponentScore: null,
        net: status === "cancelled" ? 0 : settled ? e.payout - e.entry_fee : null,
        watchId: entryWatchId(e.entry_id),
        at: e.at,
      };
    }),
  ];
  return games.sort((a, b) => b.at - a.at).slice(0, 3);
}

/** The highest-scoring run started in the last day that spectators may open (no unjoined open seats). */
async function bestToday(now: number): Promise<BestRun | null> {
  const db = database();
  const since = now - DAY;
  const [match, entry] = await Promise.all([
    db
      .prepare(
        `SELECT r.id, p.name, p.avatar, r.score, m.asset
         FROM runs r JOIN matches m ON m.id = r.match_id JOIN players p ON p.id = r.user_id
         WHERE r.created >= ? AND r.score > 0 AND (m.p2 IS NOT NULL OR m.settled = 1)
         ORDER BY r.score DESC, r.created ASC LIMIT 1`,
      )
      .bind(since)
      .first<{ id: string; name: string; avatar: string | null; score: number; asset: Asset }>(),
    db
      .prepare(
        `SELECT e.id, p.name, p.avatar, e.score, t.asset, t.name AS tournament
         FROM tournament_entries e JOIN tournaments t ON t.id = e.tournament_id JOIN players p ON p.id = e.user_id
         WHERE e.started >= ? AND e.score > 0
         ORDER BY e.score DESC, e.started ASC LIMIT 1`,
      )
      .bind(since)
      .first<{ id: string; name: string; avatar: string | null; score: number; asset: Asset; tournament: string }>(),
  ]);
  const fromMatch: BestRun | null = match && {
    name: match.name,
    avatar: avatarUrl(match.avatar),
    score: match.score,
    asset: match.asset,
    context: match.asset === "gems" ? "Gem match" : "Solana match",
    watchId: matchWatchId(match.id),
  };
  const fromEntry: BestRun | null = entry && {
    name: entry.name,
    avatar: avatarUrl(entry.avatar),
    score: entry.score,
    asset: entry.asset,
    context: entry.tournament,
    watchId: entryWatchId(entry.id),
  };
  if (!fromMatch || !fromEntry) return fromMatch ?? fromEntry;
  return fromEntry.score > fromMatch.score ? fromEntry : fromMatch;
}

/**
 * The arena lobby: the tournament most worth your attention, your latest
 * results, and what is happening right now. Signed-out visitors get everything
 * except their own results.
 */
export async function arenaOverview(uid: string | null, now = Date.now()): Promise<ArenaOverview> {
  const [tournaments, recent, online, seats, best, live] = await Promise.all([
    listTournaments(uid, now),
    uid ? recentGames(uid, now) : Promise.resolve([]),
    database().prepare("SELECT COUNT(*) AS n FROM players WHERE last_seen >= ?").bind(now - ONLINE_MS).first<{ n: number }>(),
    openSeats(uid),
    bestToday(now),
    liveGames(uid, now),
  ]);
  // Your own live run first, then any live tournament, then the next to open.
  const tournament =
    tournaments.find((t) => t.status === "live" && t.you && !t.you.done) ??
    tournaments.find((t) => t.status === "live") ??
    tournaments.filter((t) => t.status === "registration").sort((a, b) => a.startsAt - b.startsAt)[0] ??
    null;
  return { tournament, recent, online: online?.n ?? 0, openSeats: seats, bestToday: best, live: live.slice(0, 3) };
}
