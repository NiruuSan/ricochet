import { database } from "@/db/raw";
import type { Quest, QuestBoard, QuestScope } from "./api-types";
import { isLockedOut } from "./anti-cheat";
import { dayOf } from "./daily";
import { GameError } from "./matches";
import { WEEK, weekStart } from "./weekly-race";

/**
 * Something to come back for.
 *
 * Every player gets the same three quests a day and the same three a week, and
 * which three rotates with the period, so the board is never the same two days
 * running and nobody's is easier than anybody else's. Nothing is assigned in
 * advance: the period decides the quests, and the player's own finished runs
 * decide the progress, so there is no state to keep in step with the play.
 *
 * Only matches somebody else sat down for count. Practice is free and endless,
 * and a challenge nobody joined is practice with a link, so counting either
 * would turn the quests into a way of printing gems alone in a room.
 *
 * A finished quest does not go away: it comes back asking for more. Every rung
 * claimed raises the bar and the gems with it, so a good day keeps giving a
 * player something to aim at instead of an empty board — and the whole ladder
 * drops back to its first rung when the period turns over.
 *
 * The reward is gems, the free currency, paid the way the daily gems are paid:
 * the claim row is the lock, and the ledger line only exists if this call is
 * the one that took the slot.
 */

const DAY_MS = 86_400_000;
/** How many of the catalogue are live in one period. */
const ACTIVE = 3;
/** What each further rung adds to the gems, and where that stops. */
const REWARD_STEP = 0.5;
const REWARD_CAP = 3;

/** What a quest counts, taken from the player's finished runs in the window. */
type Counter = "played" | "won" | "cleared" | "points" | "best";

type Definition = {
  id: string;
  counter: Counter;
  /** The first rung's target and gems, per scope. */
  daily: [target: number, reward: number];
  weekly: [target: number, reward: number];
  /** Each rung asks for this much more than the one below it. */
  growth: number;
  title: (target: number) => string;
  detail: string;
};

/**
 * The catalogue. Targets are set against how a game actually goes: an ordinary
 * run scores a few hundred, a good one over a thousand, and clearing the board
 * outright is a moment rather than a routine.
 */
const CATALOGUE: Definition[] = [
  {
    id: "play",
    counter: "played",
    daily: [3, 150],
    weekly: [15, 900],
    growth: 2,
    title: (n) => `Play ${n} ${n === 1 ? "match" : "matches"}`,
    detail: "Any entry, gems or devnet SOL. The match counts once your rival has taken the seat.",
  },
  {
    id: "win",
    counter: "won",
    daily: [2, 200],
    weekly: [8, 1_200],
    growth: 2,
    title: (n) => `Win ${n} ${n === 1 ? "match" : "matches"}`,
    detail: "Outscore your rival on the same board.",
  },
  {
    id: "score",
    counter: "best",
    daily: [400, 200],
    weekly: [900, 1_200],
    growth: 2.4,
    title: (n) => `Score ${n.toLocaleString("en")} in one match`,
    detail: "Your best single run of the period. One good angle is worth a hundred.",
  },
  {
    id: "points",
    counter: "points",
    daily: [1_200, 150],
    weekly: [7_000, 900],
    growth: 2.2,
    title: (n) => `Score ${n.toLocaleString("en")} points in all`,
    detail: "Every brick you break in a match adds to it, win or lose.",
  },
  {
    id: "clear",
    counter: "cleared",
    daily: [2, 200],
    weekly: [10, 1_200],
    growth: 2.2,
    title: (n) => `Clear the board ${n} ${n === 1 ? "time" : "times"}`,
    detail: "Leave a round with nothing standing and take the bonus balls.",
  },
];

/**
 * A target a player can hold in their head. Small counts stay exact; larger
 * numbers land on something round, so a rung reads as "2,000 points" rather
 * than "1,987".
 */
function readable(value: number) {
  const step = value < 40 ? 1 : value < 200 ? 5 : value < 2_000 ? 50 : value < 20_000 ? 500 : 2_500;
  return Math.max(1, Math.round(value / step) * step);
}

/**
 * One rung of a quest's ladder. Each one asks for more than the last and pays
 * better, but the reward grows more slowly than the work and stops climbing
 * after a while: the fourth board cleared in a day should be worth taking, not
 * worth farming.
 */
export function rung(definition: Definition, scope: QuestScope, tier: number) {
  const [target, reward] = definition[scope];
  return {
    target: readable(target * definition.growth ** tier),
    reward: Math.round((reward * Math.min(REWARD_CAP, 1 + tier * REWARD_STEP)) / 10) * 10,
  };
}

/** A small stable hash, so a period always draws the same quests. */
function hash(key: string) {
  let h = 2_166_136_261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16_777_619);
  }
  return h >>> 0;
}

/** The period a moment belongs to: the UTC day, or the week's start in ms. */
export const periodOf = (scope: QuestScope, now: number) => (scope === "daily" ? dayOf(now) : weekStart(now));
/** When the period closes and the next set of quests takes over. */
export const periodEnd = (scope: QuestScope, now: number) => (scope === "daily" ? (dayOf(now) + 1) * DAY_MS : weekStart(now) + WEEK);

/** Which quests are live in this period. The same three for everybody. */
export function questsFor(scope: QuestScope, period: number): Definition[] {
  return [...CATALOGUE].sort((a, b) => hash(`${scope}:${period}:${a.id}`) - hash(`${scope}:${period}:${b.id}`)).slice(0, ACTIVE);
}

type Counters = Record<Counter, number>;
type Row = Record<string, number>;

/**
 * What the player has done in each window, in one pass. The day always falls
 * inside the week, so the same rows answer both.
 */
async function progress(uid: string, now: number): Promise<{ daily: Counters; weekly: Counters }> {
  const day = dayOf(now) * DAY_MS;
  const week = weekStart(now);
  const row = await database()
    .prepare(
      `SELECT
         COUNT(*) AS weekPlayed,
         COALESCE(SUM(CASE WHEN m.winner = r.user_id THEN 1 ELSE 0 END), 0) AS weekWon,
         COALESCE(SUM(r.clears), 0) AS weekCleared,
         COALESCE(SUM(r.score), 0) AS weekPoints,
         COALESCE(MAX(r.score), 0) AS weekBest,
         COALESCE(SUM(CASE WHEN r.finished >= ? THEN 1 ELSE 0 END), 0) AS dayPlayed,
         COALESCE(SUM(CASE WHEN r.finished >= ? AND m.winner = r.user_id THEN 1 ELSE 0 END), 0) AS dayWon,
         COALESCE(SUM(CASE WHEN r.finished >= ? THEN r.clears ELSE 0 END), 0) AS dayCleared,
         COALESCE(SUM(CASE WHEN r.finished >= ? THEN r.score ELSE 0 END), 0) AS dayPoints,
         COALESCE(MAX(CASE WHEN r.finished >= ? THEN r.score ELSE 0 END), 0) AS dayBest
       FROM runs r JOIN matches m ON m.id = r.match_id
       WHERE r.user_id = ? AND r.done = 1 AND r.finished >= ? AND r.finished < ?
         AND m.p2 IS NOT NULL AND m.cancelled = 0`,
    )
    .bind(day, day, day, day, day, uid, week, week + WEEK)
    .first<Row>();
  const read = (prefix: "day" | "week"): Counters => ({
    played: Number(row?.[`${prefix}Played`] ?? 0),
    won: Number(row?.[`${prefix}Won`] ?? 0),
    cleared: Number(row?.[`${prefix}Cleared`] ?? 0),
    points: Number(row?.[`${prefix}Points`] ?? 0),
    best: Number(row?.[`${prefix}Best`] ?? 0),
  });
  return { daily: read("day"), weekly: read("week") };
}

/** Everything the quests page shows, and the count the rest of the site badges. */
export async function questBoard(uid: string, now = Date.now()): Promise<QuestBoard> {
  const [counters, claimed] = await Promise.all([
    progress(uid, now),
    database()
      .prepare(
        `SELECT scope, quest, COUNT(*) AS taken FROM quest_claims
         WHERE user_id = ? AND ((scope = 'daily' AND period = ?) OR (scope = 'weekly' AND period = ?))
         GROUP BY scope, quest`,
      )
      .bind(uid, dayOf(now), weekStart(now))
      .all<{ scope: string; quest: string; taken: number }>(),
  ]);
  const board = (scope: QuestScope): Quest[] =>
    questsFor(scope, periodOf(scope, now)).map((definition) => {
      // Every rung taken moves this quest up one. What the player has already
      // done carries over: the same work is never asked for twice.
      const tier = Number(claimed.results.find((row) => row.scope === scope && row.quest === definition.id)?.taken ?? 0);
      const { target, reward } = rung(definition, scope, tier);
      return {
        id: definition.id,
        scope,
        tier,
        title: definition.title(target),
        detail: definition.detail,
        target,
        progress: Math.min(counters[scope][definition.counter], target),
        reward,
      };
    });
  const daily = board("daily");
  const weekly = board("weekly");
  return {
    daily,
    weekly,
    dailyEndsAt: periodEnd("daily", now),
    weeklyEndsAt: periodEnd("weekly", now),
    ready: [...daily, ...weekly].filter((quest) => quest.progress >= quest.target).length,
  };
}

/** How many finished quests are waiting to be claimed, for the badge. */
export const questsReady = async (uid: string, now = Date.now()) => (await questBoard(uid, now)).ready;

/**
 * Pays one finished rung, once, and leaves the next one standing. The claim
 * row's key is the player, the period, the quest and the rung, so two taps land
 * one payment while the rung above is a different row entirely.
 */
export async function claimQuest(uid: string, scopeInput: unknown, questInput: unknown, now = Date.now()) {
  const scope = scopeInput === "daily" || scopeInput === "weekly" ? scopeInput : null;
  if (!scope) throw new GameError("Unknown quest.", 404);
  const period = periodOf(scope, now);
  const definition = questsFor(scope, period).find((quest) => quest.id === questInput);
  if (!definition) throw new GameError("That quest is not running.", 404);
  if (await isLockedOut(uid)) throw new GameError("Your account is suspended. Contact support if you think this is a mistake.", 403);
  const db = database();
  const taken = await db
    .prepare("SELECT COUNT(*) AS n FROM quest_claims WHERE user_id = ? AND scope = ? AND period = ? AND quest = ?")
    .bind(uid, scope, period, definition.id)
    .first<{ n: number }>();
  const tier = Number(taken?.n ?? 0);
  const { target, reward } = rung(definition, scope, tier);
  const counters = await progress(uid, now);
  if (counters[scope][definition.counter] < target) throw new GameError("This quest is not finished yet.", 409);
  const [claim] = await db.batch([
    db
      .prepare("INSERT OR IGNORE INTO quest_claims(user_id, scope, period, quest, tier, amount, created) VALUES(?, ?, ?, ?, ?, ?, ?)")
      .bind(uid, scope, period, definition.id, tier, reward, now),
    // The gems only exist if this call is the one that took the rung.
    db
      .prepare(
        `INSERT OR IGNORE INTO ledger(id, user_id, match_id, kind, amount, created)
         SELECT ?, ?, NULL, 'quest_reward', ?, ? FROM quest_claims
         WHERE user_id = ? AND scope = ? AND period = ? AND quest = ? AND tier = ? AND created = ?`,
      )
      .bind(`quest:${uid}:${scope}:${period}:${definition.id}:${tier}`, uid, reward, now, uid, scope, period, definition.id, tier, now),
  ]);
  if (!claim.meta.changes) throw new GameError("You have already claimed this quest.", 409);
  return { quest: definition.id, scope, tier, reward, next: rung(definition, scope, tier + 1).target };
}
