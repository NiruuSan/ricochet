import { database, type Statement } from "@/db/raw";
import type { RatingChange, SeasonBoard } from "./api-types";
import { BOUNCER_FLOOR, divisionIndex, rankFor, tierIndex, type PlayerRank } from "./levels";
import { RANKED, ratingChange, seasonAt, seasonEnd, seasonStart, softReset, tierReach, withShield } from "./ranked-rules";

// Ranked play: every public SOL match moves both players' rating
// (lib/ranked-rules.ts has the arithmetic). Friend challenges, tournaments and
// gem matches never do — losing on purpose to sink a rating, then playing
// weaker players for money, would otherwise cost nothing.
//
// One row per player per season. A season's row is made the first time it is
// needed, from the last season's, pulled halfway back to the start; nothing has
// to run at midnight for a season to turn over. The house's players hold a
// fixed rating for their skill and never move.

type Row = {
  user_id: string;
  season: number;
  rating: number;
  games: number;
  wins: number;
  placements: number;
  peak: number;
  shield: number;
  last_played: number | null;
  created: number;
};

const placementsLeft = (row: Pick<Row, "games" | "placements">) => Math.max(0, row.placements - row.games);

/** A season's row before it exists: from the previous season's, or a first one. */
function freshRow(uid: string, season: number, previous: Row | undefined, now: number): Row {
  const played = !!previous && previous.games > 0;
  const rating = played ? softReset(previous.rating) : (previous?.rating ?? RANKED.start);
  return { user_id: uid, season, rating, games: 0, wins: 0, placements: played ? RANKED.returningPlacements : RANKED.placements, peak: rating, shield: 0, last_played: null, created: now };
}

/** A player's row for the season, made on first need. */
export async function seasonRow(uid: string, now = Date.now()): Promise<Row> {
  const db = database();
  const season = seasonAt(now);
  const found = await db.prepare("SELECT * FROM ranked_ratings WHERE user_id = ? AND season = ?").bind(uid, season).first<Row>();
  if (found) return found;
  const previous = await db.prepare("SELECT * FROM ranked_ratings WHERE user_id = ? AND season < ? ORDER BY season DESC LIMIT 1").bind(uid, season).first<Row>();
  const row = freshRow(uid, season, previous ?? undefined, now);
  await db
    .prepare("INSERT OR IGNORE INTO ranked_ratings(user_id, season, rating, games, wins, placements, peak, shield, created) VALUES(?, ?, ?, 0, 0, ?, ?, 0, ?)")
    .bind(uid, season, row.rating, row.placements, row.peak, now)
    .run();
  return (await db.prepare("SELECT * FROM ranked_ratings WHERE user_id = ? AND season = ?").bind(uid, season).first<Row>()) ?? row;
}

// ------------------------------------------------------------- the top fifty

let top: { season: number; at: number; places: Map<string, number> } | null = null;
const TOP_FOR_MS = 30_000;

/** The best fifty placed players this season, by rating: their places. Kept half a minute. */
export async function topPlaces(now = Date.now()) {
  const season = seasonAt(now);
  if (top && top.season === season && now - top.at < TOP_FOR_MS) return top.places;
  const { results } = await database()
    .prepare(
      `SELECT r.user_id FROM ranked_ratings r JOIN players p ON p.id = r.user_id
       WHERE r.season = ? AND p.bot = 0 AND p.deleted IS NULL AND r.games >= r.placements
       ORDER BY r.rating DESC, r.last_played ASC LIMIT ?`,
    )
    .bind(season, RANKED.bouncers)
    .all<{ user_id: string }>();
  top = { season, at: now, places: new Map(results.map((row, i) => [row.user_id, i + 1])) };
  return top.places;
}
const forgetTop = () => void (top = null);

// ---------------------------------------------------------- reading ranks

/** Ranks for many players at once, without writing anything. */
export async function ranksFor(uids: string[], now = Date.now()): Promise<Map<string, PlayerRank>> {
  const ids = [...new Set(uids.filter(Boolean))];
  const out = new Map<string, PlayerRank>();
  if (!ids.length) return out;
  const season = seasonAt(now);
  const rows: Row[] = [];
  // A few hundred at a time keeps every statement well inside SQLite's limits.
  for (let i = 0; i < ids.length; i += 400) {
    const chunk = ids.slice(i, i + 400);
    // This season's row, or the last one played before it, as seasonRow() would start from.
    const { results } = await database()
      .prepare(
        `SELECT r.* FROM ranked_ratings r WHERE r.user_id IN (${chunk.map(() => "?").join(", ")})
           AND r.season = (SELECT MAX(x.season) FROM ranked_ratings x WHERE x.user_id = r.user_id AND x.season <= ?)`,
      )
      .bind(...chunk, season)
      .all<Row>();
    rows.push(...results);
  }
  const places = await topPlaces(now);
  const latest = new Map(rows.map((r) => [r.user_id, r]));
  for (const uid of ids) {
    const found = latest.get(uid);
    const row = found?.season === season ? found : freshRow(uid, season, found, now);
    const position = places.get(uid) ?? null;
    out.set(uid, rankFor(row.rating, { placementsLeft: placementsLeft(row), position, season, bouncer: position !== null && row.rating >= BOUNCER_FLOOR }));
  }
  return out;
}

export async function rankOf(uid: string, now = Date.now()) {
  return (await ranksFor([uid], now)).get(uid)!;
}

// ---------------------------------------------------------- matchmaking

/**
 * The first open seat this player may take: one opened by somebody within a
 * tier of their own, or further the longer the seat has waited. `seats` come
 * oldest first, as matchmaking always hands them out.
 */
export async function eligibleSeat<T extends { p1: string; created: number }>(uid: string, seats: T[], now = Date.now()): Promise<T | null> {
  if (!seats.length) return null;
  const ranks = await ranksFor([uid, ...seats.map((s) => s.p1)], now);
  const tierOf = (rank: PlayerRank) => tierIndex(rank.rating, rank.tier === "bouncer");
  const mine = tierOf(ranks.get(uid)!);
  return seats.find((seat) => Math.abs(tierOf(ranks.get(seat.p1)!) - mine) <= tierReach(now - seat.created)) ?? null;
}

// ---------------------------------------------------------- after a match

/**
 * Moves both ratings for a settled ranked match, once: the rows of
 * `rating_changes` are keyed by match and player, so a second call writes
 * nothing. Called right after settlement (lib/matches.ts).
 */
export async function applyRankedResult(matchId: string, now = Date.now()) {
  const db = database();
  const m = await db
    .prepare("SELECT id, p1, p2, ranked, settled, cancelled, winner FROM matches WHERE id = ?")
    .bind(matchId)
    .first<{ id: string; p1: string; p2: string | null; ranked: number; settled: number; cancelled: number; winner: string | null }>();
  if (!m?.ranked || !m.settled || m.cancelled || !m.p2) return;
  if (await db.prepare("SELECT 1 AS yes FROM rating_changes WHERE match_id = ? LIMIT 1").bind(matchId).first()) return;
  const [runs, people] = await Promise.all([
    db.prepare("SELECT user_id, score FROM runs WHERE match_id = ?").bind(matchId).all<{ user_id: string; score: number }>(),
    db.prepare("SELECT id, bot FROM players WHERE id IN (?, ?)").bind(m.p1, m.p2).all<{ id: string; bot: number }>(),
  ]);
  const score = (uid: string) => Number(runs.results.find((r) => r.user_id === uid)?.score ?? 0);
  const isBot = (uid: string) => !!people.results.find((p) => p.id === uid)?.bot;
  const [a, b] = await Promise.all([seasonRow(m.p1, now), seasonRow(m.p2, now)]);
  // The same two players again and again moves nothing past the limit: that is how ratings are traded.
  // Matches, not rows: a match between two people writes one row for each, and one against the house only the person's.
  const met = await db
    .prepare("SELECT COUNT(DISTINCT match_id) AS n FROM rating_changes WHERE ((user_id = ? AND opponent_id = ?) OR (user_id = ? AND opponent_id = ?)) AND created > ?")
    .bind(m.p1, m.p2, m.p2, m.p1, now - RANKED.repeatWindowMs)
    .first<{ n: number }>();
  const unrated = Number(met?.n ?? 0) >= RANKED.repeatLimit ? "repeat" : null;
  const ops: Statement[] = [];
  for (const [me, other] of [
    [a, b],
    [b, a],
  ]) {
    if (isBot(me.user_id)) continue;
    const result: 0 | 0.5 | 1 = m.winner === null ? 0.5 : m.winner === me.user_id ? 1 : 0;
    const placement = me.games < me.placements;
    const delta = unrated ? 0 : ratingChange({ rating: me.rating, opponent: other.rating, result, score: score(me.user_id), opponentScore: score(other.user_id), placement });
    // While being placed there is no rank to protect yet.
    const moved = placement ? { after: Math.max(0, me.rating + delta), shield: 0 } : withShield(me.rating, delta, me.shield);
    ops.push(
      db
        .prepare(
          `INSERT INTO rating_changes(match_id, user_id, season, opponent_id, before, after, delta, opponent_rating, score, opponent_score, unrated, created)
           VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(matchId, me.user_id, me.season, other.user_id, me.rating, moved.after, moved.after - me.rating, other.rating, score(me.user_id), score(other.user_id), unrated, now),
      db
        .prepare(
          `UPDATE ranked_ratings SET rating = MAX(0, rating + ?), games = games + 1, wins = wins + ?, peak = MAX(peak, rating + ?), shield = ?, last_played = ?
           WHERE user_id = ? AND season = ?`,
        )
        .bind(moved.after - me.rating, result === 1 ? 1 : 0, moved.after - me.rating, moved.shield, now, me.user_id, me.season),
    );
  }
  if (!ops.length) return;
  try {
    await db.batch(ops);
  } catch (e) {
    // Another settlement got there first: the ratings have already moved.
    if (!(e instanceof Error) || !/UNIQUE|PRIMARY KEY/i.test(e.message)) throw e;
  }
  forgetTop();
}

/** What a ranked match did to one player's rating, for their result screen. */
export async function ratingChangeFor(matchId: string, uid: string): Promise<RatingChange | null> {
  const db = database();
  // Games played up to and including this one: the season's count, less the
  // ranked matches recorded after it (rows are numbered in the order written).
  const row = await db
    .prepare(
      `SELECT c.before, c.after, c.unrated, c.season, r.placements,
         r.games - (SELECT COUNT(*) FROM rating_changes x WHERE x.user_id = c.user_id AND x.season = c.season AND x.rowid > c.rowid) AS played
       FROM rating_changes c JOIN ranked_ratings r ON r.user_id = c.user_id AND r.season = c.season
       WHERE c.match_id = ? AND c.user_id = ?`,
    )
    .bind(matchId, uid)
    .first<{ before: number; after: number; unrated: string | null; season: number; placements: number; played: number }>();
  if (!row) return null;
  const leftBefore = Math.max(0, row.placements - (row.played - 1));
  const leftAfter = Math.max(0, row.placements - row.played);
  return {
    before: row.before,
    after: row.after,
    delta: row.after - row.before,
    unrated: row.unrated === "repeat" ? "repeat" : null,
    placement: leftBefore > 0,
    rankBefore: rankFor(row.before, { placementsLeft: leftBefore, season: row.season }),
    rankAfter: rankFor(row.after, { placementsLeft: leftAfter, season: row.season }),
  };
}

// ---------------------------------------------------------- the house's players

/** Gives the house's players their fixed rating for the season, by skill. */
export async function setBotRatings(bots: { id: string; skill: string }[], now = Date.now()) {
  if (!bots.length) return;
  const db = database();
  const season = seasonAt(now);
  const ops = bots.map((bot) => {
    const rating = RANKED.bots[bot.skill] ?? RANKED.start;
    return db
      .prepare(
        `INSERT INTO ranked_ratings(user_id, season, rating, games, wins, placements, peak, shield, created) VALUES(?, ?, ?, 0, 0, 0, ?, 0, ?)
         ON CONFLICT(user_id, season) DO UPDATE SET rating = excluded.rating, peak = excluded.peak, placements = 0`,
      )
      .bind(bot.id, season, rating, rating, now);
  });
  for (let i = 0; i < ops.length; i += 40) await db.batch(ops.slice(i, i + 40));
}

/** The skill a house player should bring to a seat opened by somebody of this rating. */
export const botSkillFor = (rating: number) => (rating < 600 ? "rookie" : rating < 1200 ? "steady" : "sharp");

// ---------------------------------------------------------- inactivity

/**
 * From Diamond up, a player who has not played ranked for two weeks loses some
 * RR each day, down to Diamond 1: nobody keeps a top place by not defending
 * it. Run once a day by the scheduled sweep; `decayed` keeps a day from being
 * charged twice.
 */
export async function decayInactive(now = Date.now()) {
  const season = seasonAt(now);
  const result = await database()
    .prepare(
      `UPDATE ranked_ratings SET rating = MAX(?, rating - ?), decayed = ?
       WHERE season = ? AND rating > ? AND games >= placements
         AND COALESCE(last_played, created) < ? AND (decayed IS NULL OR decayed < ?)
         AND user_id IN (SELECT id FROM players WHERE bot = 0)`,
    )
    .bind(RANKED.decayFloor, RANKED.decayPerDay, now, season, RANKED.decayFloor, now - RANKED.decayIdleMs, now - 20 * 3_600_000)
    .run();
  if (result.meta.changes) forgetTop();
  return result.meta.changes ?? 0;
}

// ---------------------------------------------------------- the season table

/** The season's best players, and the viewer's own line. Names, never ids. */
export async function seasonStandings(viewer: string | null, now = Date.now(), limit = RANKED.bouncers, avatarUrl: (key: string | null) => string | null = (k) => k): Promise<SeasonBoard> {
  const season = seasonAt(now);
  const { results } = await database()
    .prepare(
      `SELECT r.user_id, r.games, r.wins, p.name, p.avatar FROM ranked_ratings r JOIN players p ON p.id = r.user_id
       WHERE r.season = ? AND p.bot = 0 AND p.deleted IS NULL AND r.games >= r.placements
       ORDER BY r.rating DESC, r.last_played ASC LIMIT ?`,
    )
    .bind(season, limit)
    .all<{ user_id: string; games: number; wins: number; name: string; avatar: string | null }>();
  const ranks = await ranksFor([...results.map((r) => r.user_id), ...(viewer ? [viewer] : [])], now);
  const standings = results.map((row) => ({ name: row.name, avatar: avatarUrl(row.avatar), rank: ranks.get(row.user_id)!, games: row.games, wins: row.wins, isYou: row.user_id === viewer }));
  let you: SeasonBoard["you"] = null;
  if (viewer) {
    const [row, player] = await Promise.all([
      database().prepare("SELECT games, wins, peak FROM ranked_ratings WHERE user_id = ? AND season = ?").bind(viewer, season).first<{ games: number; wins: number; peak: number }>(),
      database().prepare("SELECT name, avatar FROM players WHERE id = ?").bind(viewer).first<{ name: string; avatar: string | null }>(),
    ]);
    const rank = ranks.get(viewer)!;
    if (player) you = { name: player.name, avatar: avatarUrl(player.avatar), rank, games: row?.games ?? 0, wins: row?.wins ?? 0, isYou: true, peak: row?.peak ?? rank.rating, placementsLeft: rank.placementsLeft };
  }
  return { season, startsAt: seasonStart(season), endsAt: seasonEnd(season), standings, you };
}

/** How the season's placed players spread over the divisions, for the administrator. */
export async function rankDistribution(now = Date.now()) {
  const season = seasonAt(now);
  const { results } = await database()
    .prepare(
      `SELECT r.user_id, r.rating, r.games, r.placements FROM ranked_ratings r JOIN players p ON p.id = r.user_id
       WHERE r.season = ? AND p.bot = 0 AND p.deleted IS NULL`,
    )
    .bind(season)
    .all<{ user_id: string; rating: number; games: number; placements: number }>();
  const places = await topPlaces(now);
  const divisions = Array.from({ length: 18 }, () => 0);
  let bouncers = 0;
  let unranked = 0;
  for (const row of results) {
    if (row.games < row.placements) unranked++;
    else if ((places.get(row.user_id) ?? Infinity) <= RANKED.bouncers && row.rating >= BOUNCER_FLOOR) bouncers++;
    else divisions[divisionIndex(row.rating)]++;
  }
  return { season, startsAt: seasonStart(season), endsAt: seasonEnd(season), divisions, bouncers, unranked, placed: results.length - unranked };
}
