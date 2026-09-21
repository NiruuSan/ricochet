import { database } from "@/db/raw";
import type { Quest, QuestBoard, QuestScope } from "./api-types";
import { isSuspended } from "./anti-cheat";
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
 * The reward is gems, the free currency, paid the way the daily gems are paid:
 * the claim row is the lock, and the ledger line only exists if this call is
 * the one that took the slot.
 */

const DAY_MS = 86_400_000;
/** How many of the catalogue are live in one period. */
const ACTIVE = 3;

/** What a quest counts, taken from the player's finished runs in the window. */
type Counter = "played" | "won" | "cleared" | "points" | "best";

type Definition = {
  id: string;
  counter: Counter;
  /** The target and the gems, per scope. */
  daily: [target: number, reward: number];
  weekly: [target: number, reward: number];
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
    title: (n) => `Play ${n} ${n === 1 ? "match" : "matches"}`,
    detail: "Any entry, gems or devnet SOL. The match counts once your rival has taken the seat.",
  },
  {
    id: "win",
    counter: "won",
    daily: [2, 200],
    weekly: [8, 1_200],
    title: (n) => `Win ${n} ${n === 1 ? "match" : "matches"}`,
    detail: "Outscore your rival on the same board.",
  },
  {
    id: "score",
    counter: "best",
    daily: [400, 200],
    weekly: [900, 1_200],
    title: (n) => `Score ${n.toLocaleString("en")} in one match`,
    detail: "Your best single run of the period. One good angle is worth a hundred.",
  },
  {
    id: "points",
    counter: "points",
    daily: [1_200, 150],
    weekly: [7_000, 900],
    title: (n) => `Score ${n.toLocaleString("en")} points in all`,
    detail: "Every brick you break in a match adds to it, win or lose.",
  },
  {
    id: "clear",
    counter: "cleared",
    daily: [2, 200],
    weekly: [10, 1_200],
    title: (n) => `Clear the board ${n} ${n === 1 ? "time" : "times"}`,
    detail: "Leave a round with nothing standing and take the bonus balls.",
  },
];

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
      .prepare("SELECT scope, quest FROM quest_claims WHERE user_id = ? AND ((scope = 'daily' AND period = ?) OR (scope = 'weekly' AND period = ?))")
      .bind(uid, dayOf(now), weekStart(now))
      .all<{ scope: string; quest: string }>(),
  ]);
  const board = (scope: QuestScope): Quest[] =>
    questsFor(scope, periodOf(scope, now)).map((definition) => {
      const [target, reward] = definition[scope];
      const done = Math.min(counters[scope][definition.counter], target);
      return {
        id: definition.id,
        scope,
        title: definition.title(target),
        detail: definition.detail,
        target,
        progress: done,
        reward,
        claimed: claimed.results.some((row) => row.scope === scope && row.quest === definition.id),
      };
    });
  const daily = board("daily");
  const weekly = board("weekly");
  return {
    daily,
    weekly,
    dailyEndsAt: periodEnd("daily", now),
    weeklyEndsAt: periodEnd("weekly", now),
    ready: [...daily, ...weekly].filter((quest) => quest.progress >= quest.target && !quest.claimed).length,
  };
}

/** How many finished quests are waiting to be claimed, for the badge. */
export const questsReady = async (uid: string, now = Date.now()) => (await questBoard(uid, now)).ready;

/**
 * Pays one finished quest, once. The claim row's primary key is the player, the
 * period and the quest, so two taps land one payment.
 */
export async function claimQuest(uid: string, scopeInput: unknown, questInput: unknown, now = Date.now()) {
  const scope = scopeInput === "daily" || scopeInput === "weekly" ? scopeInput : null;
  if (!scope) throw new GameError("Unknown quest.", 404);
  const period = periodOf(scope, now);
  const definition = questsFor(scope, period).find((quest) => quest.id === questInput);
  if (!definition) throw new GameError("That quest is not running.", 404);
  if (await isSuspended(uid)) throw new GameError("Your account is suspended. Contact support if you think this is a mistake.", 403);
  const [target, reward] = definition[scope];
  const counters = await progress(uid, now);
  if (counters[scope][definition.counter] < target) throw new GameError("This quest is not finished yet.", 409);
  const db = database();
  const [claim] = await db.batch([
    db.prepare("INSERT OR IGNORE INTO quest_claims(user_id, scope, period, quest, amount, created) VALUES(?, ?, ?, ?, ?, ?)").bind(uid, scope, period, definition.id, reward, now),
    // The gems only exist if this call is the one that took the slot.
    db
      .prepare(
        `INSERT OR IGNORE INTO ledger(id, user_id, match_id, kind, amount, created)
         SELECT ?, ?, NULL, 'quest_reward', ?, ? FROM quest_claims WHERE user_id = ? AND scope = ? AND period = ? AND quest = ? AND created = ?`,
      )
      .bind(`quest:${uid}:${scope}:${period}:${definition.id}`, uid, reward, now, uid, scope, period, definition.id, now),
  ]);
  if (!claim.meta.changes) throw new GameError("You have already claimed this quest.", 409);
  return { quest: definition.id, scope, reward };
}
