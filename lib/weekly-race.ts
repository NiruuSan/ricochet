import { database, type Statement } from "@/db/raw";
import type { AdminRaceWeek, RaceEntry, RacePrize, RaceWinner, WeeklyRace } from "./api-types";
import { avatarUrl, GameError } from "./matches";
import { notificationInsert } from "./notifications";
import { cashAccountId, ensureCashAccount, HOUSE } from "./payments/accounts";

// The weekly race: each player's best single score of the week in real-money play
// (devnet SOL 1v1 matches and paid SOL tournaments). Weeks run from Monday 00:00
// UTC. After a week ends, an administrator reviews the top places, may exclude
// suspicious players, and pays the prizes from the house balance.

export const WEEK = 7 * 24 * 60 * 60 * 1000;
// 1970-01-01 was a Thursday; the first Monday 00:00 UTC is four days later.
const FIRST_MONDAY = 4 * 24 * 60 * 60 * 1000;
const STANDINGS = 50;
const PLACES = 3;
const MAX_PRIZE_LAMPORTS = 100 * 1_000_000_000;
const MAX_PRIZE_GEMS = 1_000_000;
const PRIZES_KEY = "weekly_race_prizes";

export const DEFAULT_PRIZES: RacePrize[] = [
  { sol: 1_000_000_000, gems: 5_000 },
  { sol: 500_000_000, gems: 2_500 },
  { sol: 250_000_000, gems: 1_000 },
];

/**
 * Below the podium, the race pays in gems only.
 *
 * Three places gave 47 of the 50 players on the board no reason to look at it.
 * These tiers cost the house nothing — gems are the free currency — and give
 * everybody in the standings something to hold on to, which is the whole point
 * of a weekly table.
 */
export const TIERS: { from: number; to: number; gems: number }[] = [
  { from: 4, to: 10, gems: 1_000 },
  { from: 11, to: 25, gems: 500 },
  { from: 26, to: STANDINGS, gems: 250 },
];

/** What a rank wins: the podium's own prize, or its tier's gems. */
export function prizeFor(rank: number, prizes: RacePrize[]): RacePrize | null {
  if (rank <= prizes.length) return prizes[rank - 1];
  const tier = TIERS.find((t) => rank >= t.from && rank <= t.to);
  return tier ? { sol: 0, gems: tier.gems } : null;
}

export const weekStart = (at: number) => Math.floor((at - FIRST_MONDAY) / WEEK) * WEEK + FIRST_MONDAY;

type ScoreRow = { user_id: string; name: string; avatar: string | null; score: number; at: number; watch: string | null };

/**
 * Best finished score per player in one week, highest first; an earlier score
 * wins a tie. Only runs that cost real money count: SOL matches that were not
 * cancelled, and started runs in paid SOL tournaments that were not cancelled.
 */
async function bestScores(week: number, limit: number): Promise<ScoreRow[]> {
  const end = week + WEEK;
  const { results } = await database()
    .prepare(
      `WITH scores AS (
         SELECT r.user_id, r.score, r.finished AS at, CASE WHEN m.p2 IS NOT NULL THEN 'm-' || r.id END AS watch
         FROM runs r JOIN matches m ON m.id = r.match_id AND m.asset = 'devnet' AND m.cancelled = 0
         WHERE r.done = 1 AND r.score > 0 AND r.finished >= ? AND r.finished < ? AND (m.disqualified IS NULL OR m.disqualified <> r.user_id)
         UNION ALL
         SELECT e.user_id, e.score, e.finished, 't-' || e.id
         FROM tournament_entries e JOIN tournaments t ON t.id = e.tournament_id AND t.asset = 'devnet' AND t.entry_fee > 0 AND t.status <> 'cancelled'
         WHERE e.done = 1 AND e.state IS NOT NULL AND e.score > 0 AND e.disqualified = 0 AND e.finished >= ? AND e.finished < ?
       ), best AS (
         SELECT user_id, score, at, watch, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY score DESC, at ASC) AS n
         FROM scores
         WHERE user_id NOT IN (SELECT user_id FROM weekly_race_exclusions WHERE week_start = ?)
           AND user_id NOT IN (SELECT user_id FROM player_suspensions WHERE status IN ('suspended', 'banned'))
       )
       SELECT b.user_id, p.name, p.avatar, b.score, b.at, b.watch
       FROM best b JOIN players p ON p.id = b.user_id
       -- The house's own players never take a prize a person could have won.
       WHERE b.n = 1 AND p.bot = 0
       ORDER BY b.score DESC, b.at ASC, p.name ASC
       LIMIT ?`,
    )
    .bind(week, end, week, end, week, limit)
    .all<ScoreRow>();
  return results;
}

const entry = (row: ScoreRow, i: number, prizes?: RacePrize[]): RaceEntry => ({
  rank: i + 1,
  name: row.name,
  avatar: avatarUrl(row.avatar),
  score: Number(row.score),
  at: Number(row.at),
  watchId: row.watch,
  ...(prizes ? { reward: prizeFor(i + 1, prizes) } : {}),
});

export async function racePrizes(): Promise<RacePrize[]> {
  const row = await database().prepare("SELECT value FROM app_settings WHERE key = ?").bind(PRIZES_KEY).first<{ value: string }>();
  if (!row) return DEFAULT_PRIZES;
  try {
    return parsePrizes(JSON.parse(row.value));
  } catch {
    return DEFAULT_PRIZES;
  }
}

function parseSolPrize(value: unknown) {
  const text = typeof value === "number" ? String(value) : value;
  if (typeof text !== "string" || !/^\d{1,3}(\.\d{1,9})?$/.test(text)) throw new GameError("Enter SOL prizes with up to 9 decimal places.");
  const [whole, fraction = ""] = text.split(".");
  const lamports = Number(whole) * 1_000_000_000 + Number(fraction.padEnd(9, "0"));
  if (lamports > MAX_PRIZE_LAMPORTS) throw new GameError("A SOL prize can be at most 100 SOL.");
  return lamports;
}

/** Three places of `{ sol, gems }`; SOL in lamports when already parsed, or as a decimal string from the admin form. */
function parsePrizes(input: unknown, solIsText = false): RacePrize[] {
  if (!Array.isArray(input) || input.length !== PLACES) throw new GameError("Set a prize for each of the top 3 places.");
  return input.map((place) => {
    const p = (place ?? {}) as { sol?: unknown; gems?: unknown };
    const sol = solIsText ? parseSolPrize(p.sol) : Number(p.sol);
    const gems = Number(p.gems);
    if (!Number.isSafeInteger(sol) || sol < 0 || sol > MAX_PRIZE_LAMPORTS) throw new GameError("A SOL prize can be at most 100 SOL.");
    if (!Number.isSafeInteger(gems) || gems < 0 || gems > MAX_PRIZE_GEMS) throw new GameError("Gem prizes must be whole numbers up to 1,000,000.");
    return { sol, gems };
  });
}

/** The public race: this week's standings and last week's result. The same for every visitor. */
export async function weeklyRace(now = Date.now()): Promise<WeeklyRace> {
  const week = weekStart(now);
  const previousWeek = week - WEEK;
  const db = database();
  const [standings, prizes, paid, previousTop] = await Promise.all([
    bestScores(week, STANDINGS),
    racePrizes(),
    db.prepare("SELECT winners FROM weekly_races WHERE week_start = ?").bind(previousWeek).first<{ winners: string }>(),
    bestScores(previousWeek, STANDINGS),
  ]);
  const previousWinners: RaceWinner[] = paid
    ? (JSON.parse(paid.winners) as RaceWinner[])
    : previousTop.map((row, i) => ({ ...entry(row, i), ...(prizeFor(i + 1, prizes) ?? { sol: 0, gems: 0 }) })).filter((w) => w.sol || w.gems);
  return {
    weekStart: week,
    weekEnd: week + WEEK,
    prizes,
    tiers: TIERS,
    standings: standings.map((row, i) => entry(row, i, prizes)),
    previous: previousWinners.length ? { weekStart: previousWeek, weekEnd: week, paid: !!paid, winners: previousWinners } : null,
    generated: now,
  };
}

/** Administrator: this week and the last weeks that had scores, with their top places, exclusions and payment. */
export async function adminRaces(now = Date.now(), weeks = 6): Promise<{ prizes: RacePrize[]; weeks: AdminRaceWeek[] }> {
  const db = database();
  const current = weekStart(now);
  const starts = Array.from({ length: weeks }, (_, i) => current - i * WEEK);
  const [prizes, ...rows] = await Promise.all([
    racePrizes(),
    ...starts.map((start) =>
      Promise.all([
        bestScores(start, 10),
        db.prepare("SELECT winners, paid_at FROM weekly_races WHERE week_start = ?").bind(start).first<{ winners: string; paid_at: number }>(),
        db
          .prepare("SELECT p.name, x.reason FROM weekly_race_exclusions x JOIN players p ON p.id = x.user_id WHERE x.week_start = ? ORDER BY x.created")
          .bind(start)
          .all<{ name: string; reason: string }>(),
      ]),
    ),
  ]);
  return {
    prizes,
    weeks: rows
      .map(([top, paid, excluded], i) => ({
        weekStart: starts[i],
        weekEnd: starts[i] + WEEK,
        ended: starts[i] + WEEK <= now,
        standings: top.map((row, n) => entry(row, n)),
        excluded: excluded.results,
        paid: paid ? { at: paid.paid_at, winners: JSON.parse(paid.winners) as RaceWinner[] } : null,
      }))
      .filter((w, i) => i === 0 || w.standings.length || w.excluded.length || w.paid),
  };
}

function parseWeek(value: unknown, now: number) {
  const week = Number(value);
  if (!Number.isSafeInteger(week) || weekStart(week) !== week || week > weekStart(now)) throw new GameError("Unknown race week.");
  return week;
}

async function unpaid(week: number) {
  const paid = await database().prepare("SELECT 1 AS paid FROM weekly_races WHERE week_start = ?").bind(week).first();
  if (paid) throw new GameError("This week's prizes were already paid.", 409);
}

const audit = (adminUid: string, action: string, target: string, reason: string, now: number) =>
  database()
    .prepare("INSERT INTO admin_audit(id, admin_id, action, target_user_id, reason, created) VALUES(?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), adminUid, action, target, reason, now);

/** Administrator: sets the prizes of future payouts. SOL arrives as decimal text. */
export async function setRacePrizes(adminUid: string, input: unknown, now = Date.now()) {
  const prizes = parsePrizes(input, true);
  const value = JSON.stringify(prizes);
  await database().batch([
    database()
      .prepare("INSERT INTO app_settings(key, value, updated_by, updated) VALUES(?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated = excluded.updated")
      .bind(PRIZES_KEY, value, adminUid, now),
    audit(adminUid, "weekly_race_prizes", "weekly-race", value, now),
  ]);
  return prizes;
}

/** Administrator: removes a player from one week's race, or puts them back. */
export async function setRaceExclusion(adminUid: string, input: { week?: unknown; name?: unknown; reason?: unknown; excluded?: unknown }, now = Date.now()) {
  const week = parseWeek(input.week, now);
  await unpaid(week);
  const name = String(input.name ?? "");
  const db = database();
  const player = await db.prepare("SELECT id, name FROM players WHERE lower(name) = lower(?)").bind(name).first<{ id: string; name: string }>();
  if (!player) throw new GameError("Player not found.", 404);
  if (input.excluded === false) {
    await db.batch([
      db.prepare("DELETE FROM weekly_race_exclusions WHERE week_start = ? AND user_id = ?").bind(week, player.id),
      audit(adminUid, "weekly_race_include", player.id, `Week of ${new Date(week).toISOString().slice(0, 10)}`, now),
    ]);
    return;
  }
  const reason = String(input.reason ?? "").trim().slice(0, 200);
  if (reason.length < 3) throw new GameError("Give a short reason for the exclusion.");
  await db.batch([
    db
      .prepare("INSERT OR REPLACE INTO weekly_race_exclusions(week_start, user_id, reason, admin_id, created) VALUES(?, ?, ?, ?, ?)")
      .bind(week, player.id, reason, adminUid, now),
    audit(adminUid, "weekly_race_exclude", player.id, `Week of ${new Date(week).toISOString().slice(0, 10)}: ${reason}`, now),
  ]);
}

/**
 * Administrator: pays an ended week's top 3 with the current prizes. SOL comes
 * from the house balance; gems are credited. The week's row, every credit and
 * the notifications are written in one batch, so a week is paid once or not at all.
 */
export async function payWeeklyRace(adminUid: string, weekInput: unknown, now = Date.now()): Promise<RaceWinner[]> {
  const week = parseWeek(weekInput, now);
  if (week + WEEK > now) throw new GameError("This week's race has not ended yet.", 409);
  await unpaid(week);
  const [board, prizes] = await Promise.all([bestScores(week, STANDINGS), racePrizes()]);
  if (!board.length) throw new GameError("Nobody scored in this week's race.", 409);
  // Everyone a prize or a tier reaches, podium first.
  const top = board.filter((_, i) => prizeFor(i + 1, prizes));
  const winners: RaceWinner[] = top.map((row, i) => ({ ...entry(row, i), ...prizeFor(i + 1, prizes)! }));
  const totalSol = winners.reduce((sum, w) => sum + w.sol, 0);
  const db = database();
  if (totalSol) await Promise.all([ensureCashAccount(HOUSE), ...top.map((row) => ensureCashAccount(row.user_id))]);
  const reference = `race:${week}`;
  const ops: Statement[] = [
    db.prepare("INSERT INTO weekly_races(week_start, winners, paid_by, paid_at) VALUES(?, ?, ?, ?)").bind(week, JSON.stringify(winners), adminUid, now),
  ];
  top.forEach((row, i) => {
    const { sol, gems } = winners[i];
    if (sol) {
      ops.push(
        db
          .prepare("INSERT INTO cash_ledger(id, account_id, kind, amount, reference, created) VALUES(?, ?, 'weekly_race_prize', ?, ?, ?)")
          .bind(`${reference}:${i + 1}:house`, cashAccountId(HOUSE), -sol, reference, now),
        db
          .prepare("INSERT INTO cash_ledger(id, account_id, kind, amount, reference, created) VALUES(?, ?, 'weekly_race_prize', ?, ?, ?)")
          .bind(`${reference}:${i + 1}:sol`, cashAccountId(row.user_id), sol, reference, now),
      );
    }
    if (gems) {
      ops.push(
        db
          .prepare("INSERT INTO ledger(id, user_id, match_id, kind, amount, created) VALUES(?, ?, NULL, 'weekly_race_prize', ?, ?)")
          .bind(`${reference}:${i + 1}:gems`, row.user_id, gems, now),
      );
    }
    ops.push(notificationInsert(db, `${reference}:${i + 1}`, row.user_id, "race_result", { weekStart: week, rank: i + 1, score: winners[i].score, sol, gems }, now));
  });
  ops.push(audit(adminUid, "weekly_race_pay", reference, `Paid ${winners.map((w) => `#${w.rank} ${w.name}`).join(", ")}`, now));
  try {
    await db.batch(ops);
  } catch (e) {
    if (e instanceof Error && /cash balance insufficient/.test(e.message)) throw new GameError("The treasury balance cannot cover these prizes.", 409);
    if (e instanceof Error && /UNIQUE|PRIMARY KEY/i.test(e.message)) throw new GameError("This week's prizes were already paid.", 409);
    throw e;
  }
  return winners;
}
