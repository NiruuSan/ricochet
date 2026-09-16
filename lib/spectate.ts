import { database } from "@/db/raw";
import { initial, seedRows, type Game, type RowSource } from "./engine";
import { rowsFor } from "./secret-rows";
import type { Asset, LiveGame, WatchData, WatchShot, WatchSide } from "./api-types";
import { avatarUrl, GameError } from "./matches";
import { tournamentStatus } from "./tournament-history";

// Spectator mode for match and tournament runs.
//
// Everyone on a match or tournament plays the same seed, so watching a run can
// reveal good angles. The rules keep that from helping anyone who still has to
// play on the same board:
// - a match with an open seat cannot be watched until it settles, or a viewer
//   could study the run and then take the seat;
// - a player whose own run on that seed is unfinished can watch only their own
//   run until they finish (or the match settles, or the tournament closes).

/** A run with no shot for this long no longer shows as live. */
const LIVE_WINDOW = 10 * 60_000;

export const matchWatchId = (runId: string) => `m-${runId}`;
export const entryWatchId = (entryId: string) => `t-${entryId}`;

type MatchRunRow = {
  id: string;
  user_id: string;
  state: string;
  revision: number;
  score: number;
  done: number;
  forfeit: number;
  match_id: string;
  asset: Asset;
  ruleset: number;
  stake: number;
  seed: number;
  row_key: string | null;
  p2: string | null;
  settled: number;
};

type EntryRow = {
  id: string;
  user_id: string;
  state: string | null;
  revision: number;
  score: number;
  done: number;
  forfeit: number;
  tournament_id: string;
  name: string;
  asset: Asset;
  ruleset: number;
  entry_fee: number;
  seed: number;
  row_key: string | null;
  status: string;
  starts_at: number;
  ends_at: number;
};

async function shotsFor(runKey: string, since: number) {
  const db = database();
  const [rows, count] = await Promise.all([
    db.prepare("SELECT revision, angle FROM run_shots WHERE run_key = ? AND revision >= ? ORDER BY revision").bind(runKey, since).all<WatchShot>(),
    db.prepare("SELECT COUNT(*) AS n FROM run_shots WHERE run_key = ?").bind(runKey).first<{ n: number }>(),
  ]);
  return { shots: rows.results, logged: count?.n ?? 0 };
}

/**
 * The board before the first shot and the rows of every round reached so far.
 * Rows of later rounds are never revealed.
 */
function board(seed: number, ruleset: number, rowKey: string | null, state: Game) {
  const source: RowSource = rowsFor(ruleset, rowKey) ?? seedRows(seed);
  return { start: initial(seed, source), rows: Array.from({ length: state.round }, (_, i) => source(i + 1)) };
}

const player = async (uid: string, viewer: string | null) => {
  const p = await database().prepare("SELECT name, avatar FROM players WHERE id = ?").bind(uid).first<{ name: string; avatar: string | null }>();
  return { name: p?.name ?? "Player", avatar: avatarUrl(p?.avatar ?? null), isYou: uid === viewer };
};

async function watchMatchRun(viewer: string | null, runId: string, since: number): Promise<WatchData> {
  const db = database();
  const runs = await db
    .prepare(
      `SELECT r.id, r.user_id, r.state, r.revision, r.score, r.done, r.forfeit,
         m.id AS match_id, m.asset, m.ruleset, m.stake, m.seed, m.row_key, m.p2, m.settled
       FROM runs r JOIN matches m ON m.id = r.match_id
       WHERE r.match_id = (SELECT match_id FROM runs WHERE id = ?)`,
    )
    .bind(runId)
    .all<MatchRunRow>();
  const target = runs.results.find((r) => r.id === runId);
  if (!target) throw new GameError("Game not found.", 404);
  const settled = !!target.settled;
  if (!target.p2 && !settled && target.user_id !== viewer) throw new GameError("This match is waiting for an opponent. It can be watched once someone takes the seat.", 403);
  const mine = runs.results.find((r) => r.user_id === viewer);
  const blocked = !settled && !!mine && !mine.done;
  if (blocked && target.user_id !== viewer) throw new GameError("Finish your own run before watching this match.", 403);

  const key = matchWatchId(target.id);
  const state = JSON.parse(target.state) as Game;
  const [{ shots, logged }, who, sides] = await Promise.all([
    shotsFor(key, since),
    player(target.user_id, viewer),
    blocked
      ? Promise.resolve([] as WatchSide[])
      : Promise.all(
          runs.results.map(async (r): Promise<WatchSide> => {
            const p = await player(r.user_id, viewer);
            return { watchId: matchWatchId(r.id), name: p.name, avatar: p.avatar, score: r.score, done: !!r.done, isYou: p.isYou };
          }),
        ),
  ]);
  return {
    watchId: key,
    kind: "match",
    asset: target.asset,
    ruleset: target.ruleset,
    stake: target.stake,
    tournament: null,
    player: who,
    state,
    revision: target.revision,
    score: target.score,
    done: !!target.done,
    forfeit: !!target.forfeit,
    final: settled,
    ...board(target.seed, target.ruleset, target.row_key, state),
    shots,
    replayable: logged === target.revision,
    sides,
  };
}

async function watchTournamentRun(viewer: string | null, entryId: string, since: number, now: number): Promise<WatchData> {
  const db = database();
  const target = await db
    .prepare(
      `SELECT e.id, e.user_id, e.state, e.revision, e.score, e.done, e.forfeit,
         t.id AS tournament_id, t.name, t.asset, t.ruleset, t.entry_fee, t.seed, t.row_key, t.status, t.starts_at, t.ends_at
       FROM tournament_entries e JOIN tournaments t ON t.id = e.tournament_id
       WHERE e.id = ?`,
    )
    .bind(entryId)
    .first<EntryRow>();
  if (!target) throw new GameError("Game not found.", 404);
  if (!target.state) throw new GameError("This player has not started their run yet.", 409);
  const status = tournamentStatus(target, now);
  const final = status === "settled" || status === "cancelled";
  if (viewer && viewer !== target.user_id && status === "live") {
    const mine = await db
      .prepare("SELECT done FROM tournament_entries WHERE tournament_id = ? AND user_id = ?")
      .bind(target.tournament_id, viewer)
      .first<{ done: number }>();
    if (mine && !mine.done) throw new GameError("Finish your own run in this tournament before watching the others.", 403);
  }
  const key = entryWatchId(target.id);
  const state = JSON.parse(target.state!) as Game;
  const [{ shots, logged }, who] = await Promise.all([shotsFor(key, since), player(target.user_id, viewer)]);
  return {
    watchId: key,
    kind: "tournament",
    asset: target.asset,
    ruleset: target.ruleset,
    stake: target.entry_fee,
    tournament: { id: target.tournament_id, name: target.name },
    player: who,
    state,
    revision: target.revision,
    score: target.score,
    done: !!target.done,
    forfeit: !!target.forfeit,
    final,
    ...board(target.seed, target.ruleset, target.row_key, state),
    shots,
    replayable: logged === target.revision,
    sides: [],
  };
}

/** A run in spectator mode, with the shots logged from revision `since` on. */
export async function watchRun(viewer: string | null, watchIdInput: unknown, sinceInput: unknown = 0, now = Date.now()): Promise<WatchData> {
  const watchId = String(watchIdInput ?? "");
  const since = Math.max(0, Math.floor(Number(sinceInput) || 0));
  const match = /^([mt])-([0-9a-f-]{36})$/.exec(watchId);
  if (!match) throw new GameError("Game not found.", 404);
  return match[1] === "m" ? watchMatchRun(viewer, match[2], since) : watchTournamentRun(viewer, match[2], since, now);
}

type LiveRow = { id: string; asset: Asset; name: string; avatar: string | null; score: number; round: number; stake: number; context: string | null };

/** Runs with a shot in the last few minutes that the viewer is allowed to watch, best score first. */
export async function liveGames(viewer: string | null, now = Date.now()): Promise<LiveGame[]> {
  const db = database();
  const since = now - LIVE_WINDOW;
  const [matches, entries] = await Promise.all([
    db
      .prepare(
        `SELECT r.id, m.asset, p.name, p.avatar, r.score, json_extract(r.state, '$.round') AS round, m.stake,
           (SELECT o.name FROM players o WHERE o.id = CASE WHEN m.p1 = r.user_id THEN m.p2 ELSE m.p1 END) AS context
         FROM runs r
         JOIN matches m ON m.id = r.match_id
         JOIN players p ON p.id = r.user_id
         WHERE r.done = 0 AND m.settled = 0 AND m.p2 IS NOT NULL
           AND COALESCE(?, '') NOT IN (m.p1, m.p2)
           AND COALESCE((SELECT MAX(s.created) FROM run_shots s WHERE s.run_key = 'm-' || r.id), r.created) >= ?
         ORDER BY r.score DESC LIMIT 12`,
      )
      .bind(viewer, since)
      .all<LiveRow>(),
    db
      .prepare(
        `SELECT e.id, t.asset, p.name, p.avatar, e.score, json_extract(e.state, '$.round') AS round, t.entry_fee AS stake, t.name AS context
         FROM tournament_entries e
         JOIN tournaments t ON t.id = e.tournament_id
         JOIN players p ON p.id = e.user_id
         WHERE e.state IS NOT NULL AND e.done = 0 AND t.status = 'scheduled' AND t.starts_at <= ? AND t.ends_at > ?
           AND e.user_id <> COALESCE(?, '')
           AND NOT EXISTS (SELECT 1 FROM tournament_entries mine WHERE mine.tournament_id = t.id AND mine.user_id = ? AND mine.done = 0)
           AND COALESCE((SELECT MAX(s.created) FROM run_shots s WHERE s.run_key = 't-' || e.id), e.started) >= ?
         ORDER BY e.score DESC LIMIT 12`,
      )
      .bind(now, now, viewer, viewer, since)
      .all<LiveRow>(),
  ]);
  const toLive = (kind: LiveGame["kind"], watchId: (id: string) => string) => (r: LiveRow): LiveGame => ({
    watchId: watchId(r.id),
    kind,
    asset: r.asset,
    name: r.name,
    avatar: avatarUrl(r.avatar),
    score: r.score,
    round: r.round,
    stake: r.stake,
    context: r.context ?? "",
  });
  return [...entries.results.map(toLive("tournament", entryWatchId)), ...matches.results.map(toLive("match", matchWatchId))]
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);
}
