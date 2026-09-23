import { database, type Database, type Statement } from "@/db/raw";
import {
  aimMoves,
  ANALYSIS_STEP,
  boardValue,
  evaluateQuality,
  evaluateShots,
  evaluateTrend,
  FINDING_LABELS,
  QUALITY,
  qualityPercentile,
  qualityThreshold,
  RESTRICTED_MESSAGE,
  STATS,
  SUSPENDED_MESSAGE,
  TREND,
  type AimTrail,
  type Finding,
} from "./anti-cheat-rules";
import { MAX_APPEAL } from "./api-types";
import { MAX_ANGLE, MIN_ANGLE, simulate, type Game } from "./engine";
import { GameError } from "./matches";
import { PaymentError } from "./payments/errors";
import { rowsFor } from "./secret-rows";
import { weekStart } from "./weekly-race";
import { TRAP, trappedShot, type Trap } from "./ghost-trap";

// Anti-cheat sanctions and analysis. The checks themselves are in
// lib/anti-cheat-rules.ts.

export const SYSTEM = "system";

/** app_settings key of the anti-cheat switch; on unless an administrator turned it off. */
export const ANTI_CHEAT_KEY = "anti_cheat_enabled";
/** SQL: 1 while automatic sanctions are on. */
export const ANTI_CHEAT_ON_SQL = `COALESCE((SELECT value FROM app_settings WHERE key = '${ANTI_CHEAT_KEY}'), 'true') = 'true'`;

export async function antiCheatEnabled() {
  return !!(await database().prepare(`SELECT ${ANTI_CHEAT_ON_SQL} AS on_`).first<{ on_: number }>())?.on_;
}

/**
 * Administrator: turns automatic sanctions on or off. While off, every check
 * still runs and its findings are recorded, but nobody is suspended or loses a
 * match automatically. Existing suspensions and manual decisions are unchanged.
 */
export async function setAntiCheatEnabled(adminUid: string, enabled: boolean, now = Date.now()) {
  const db = database();
  await db.batch([
    db
      .prepare("INSERT INTO app_settings(key, value, updated_by, updated) VALUES(?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated = excluded.updated")
      .bind(ANTI_CHEAT_KEY, enabled ? "true" : "false", adminUid, now),
    db
      .prepare("INSERT INTO admin_audit(id, admin_id, action, target_user_id, reason, created) VALUES(?, ?, 'anti_cheat_toggle', 'anti-cheat', ?, ?)")
      .bind(crypto.randomUUID(), adminUid, enabled ? "Automatic sanctions turned on" : "Automatic sanctions turned off", now),
  ]);
}

/**
 * How far a sanction reaches.
 *
 * Technical proof and an administrator's decision close the account: nothing is
 * played, nothing moves. A statistical case is a suspicion, not a finding, and
 * the player is very often exactly what they look like — somebody good. Taking
 * their game away for days while a person gets round to the replays is a
 * punishment handed out before the verdict, so a statistical case holds the
 * money side only: no entries or prizes in SOL, no withdrawal, no tip, while
 * practice, gems and the daily board stay open. Money is what a cheat is after,
 * and none of it can leave while the case is open.
 */
/** SQL: whether `player` (an SQL expression for a player ID) may not touch real money. */
export const suspendedSql = (player: string) => `EXISTS (SELECT 1 FROM player_suspensions WHERE user_id = ${player} AND status IN ('suspended', 'banned'))`;
/** SQL: whether `player` may not play at all. A case under review is narrower than this. */
export const lockedOutSql = (player: string) =>
  `EXISTS (SELECT 1 FROM player_suspensions WHERE user_id = ${player} AND status IN ('suspended', 'banned') AND restricted = 0)`;

export async function isSuspended(uid: string) {
  return !!(await database().prepare(`SELECT ${suspendedSql("?")} AS s`).bind(uid).first<{ s: number }>())?.s;
}

/** Whether every board is closed to this player, free ones included. */
export async function isLockedOut(uid: string) {
  return !!(await database().prepare(`SELECT ${lockedOutSql("?")} AS s`).bind(uid).first<{ s: number }>())?.s;
}

/** Free play and gems are open under review; anything with money in it is not. */
export async function assertCanPlay(uid: string, asset: "gems" | "devnet" = "devnet") {
  if (asset === "devnet" ? await isSuspended(uid) : await isLockedOut(uid)) throw new GameError(await suspensionMessage(uid), 403);
}

/** The message a blocked player gets, in the words of their own case. */
export async function suspensionMessage(uid: string) {
  return (await isLockedOut(uid)) ? SUSPENDED_MESSAGE : RESTRICTED_MESSAGE;
}

export async function assertCanMoveMoney(uid: string) {
  if (await isSuspended(uid)) throw new PaymentError(await suspensionMessage(uid));
}

/**
 * The player's side of it. Every sanction here is decided by a program, and a
 * program cannot be argued with: this is the one place where the person under
 * review can say something, and it lands in front of the administrator with the
 * evidence. One per case — a second one would be a queue of the same words, not
 * new information — and a fresh case clears it.
 */
export async function submitAppeal(uid: string, textInput: unknown, now = Date.now()) {
  const text = typeof textInput === "string" ? textInput.trim().slice(0, MAX_APPEAL) : "";
  if (text.length < 10) throw new GameError("Tell us what happened, in a sentence or two.", 400);
  const row = await database()
    .prepare("SELECT status, appeal FROM player_suspensions WHERE user_id = ?")
    .bind(uid)
    .first<{ status: string; appeal: string | null }>();
  if (!row || row.status === "lifted") throw new GameError("There is nothing to appeal on your account.", 409);
  if (row.appeal) throw new GameError("Your appeal is already with the review team.", 409);
  await database().prepare("UPDATE player_suspensions SET appeal = ?, appealed_at = ? WHERE user_id = ? AND appeal IS NULL").bind(text, now, uid).run();
  return { appeal: text, appealedAt: now };
}

export function signalInsert(db: Database, uid: string, runKey: string | null, finding: Finding, now: number) {
  return db
    .prepare("INSERT INTO cheat_signals(id, user_id, run_key, kind, level, detail, created) VALUES(?, ?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), uid, runKey, finding.kind, finding.level, JSON.stringify(finding.detail), now);
}

const reasonFor = (findings: Finding[]) =>
  findings
    .filter((f) => f.level !== "watch")
    .map((f) => FINDING_LABELS[f.kind] ?? f.kind)
    .join("; ");

/** Suspends a player (unless already suspended or banned), records why, and removes them from this week's race. */
function suspensionOps(db: Database, uid: string, source: "proof" | "stats" | "admin", reason: string, evidence: unknown, now: number): Statement[] {
  const startedNow = "EXISTS (SELECT 1 FROM player_suspensions WHERE user_id = ? AND status = 'suspended' AND created = ?)";
  // Statistics open a review and hold the money; proof and an administrator
  // close the account. A new case also clears the appeal of the last one.
  const restricted = source === "stats" ? 1 : 0;
  return [
    db
      .prepare(
        `INSERT INTO player_suspensions(user_id, status, source, reason, evidence, created, restricted) VALUES(?, 'suspended', ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET status = 'suspended', source = excluded.source, reason = excluded.reason, evidence = excluded.evidence,
           created = excluded.created, restricted = excluded.restricted, reviewed_by = NULL, reviewed_at = NULL, note = NULL, appeal = NULL, appealed_at = NULL
         WHERE player_suspensions.status = 'lifted'`,
      )
      .bind(uid, source, reason, JSON.stringify(evidence), now, restricted),
    // Only when this batch started the suspension: an existing one is not repeated.
    db
      .prepare(
        `INSERT OR IGNORE INTO weekly_race_exclusions(week_start, user_id, reason, admin_id, created) SELECT ?, ?, ?, ?, ?
         WHERE NOT EXISTS (SELECT 1 FROM weekly_races WHERE week_start = ?) AND ${startedNow}`,
      )
      .bind(weekStart(now), uid, `Suspended: ${reason}`.slice(0, 200), SYSTEM, now, weekStart(now), uid, now),
    db
      .prepare(`INSERT OR IGNORE INTO notifications(id, user_id, kind, data, created) SELECT ?, ?, 'account_suspended', ?, ? WHERE ${startedNow}`)
      .bind(`suspension:${uid}:${now}`, uid, JSON.stringify({ reason, restricted: !!restricted }), now, uid, now),
  ];
}

/**
 * Proof of automated play: suspends the player, loses every unsettled match of
 * theirs to the opponent (or closes it for the house when nobody joined), and
 * disqualifies their runs in tournaments that have not been paid out.
 */
export async function disqualify(uid: string, runKey: string | null, findings: Finding[], now = Date.now()) {
  const db = database();
  const reason = reasonFor(findings);
  await db.batch([...findings.map((f) => signalInsert(db, uid, runKey, f, now)), ...suspensionOps(db, uid, "proof", reason, { runKey, findings }, now)]);

  const [{ disqualifyMatch }, { disqualifyTournamentRuns }] = await Promise.all([import("./matches"), import("./tournaments")]);
  const open = await db
    .prepare("SELECT id FROM matches WHERE settled = 0 AND (p1 = ? OR p2 = ?)")
    .bind(uid, uid)
    .all<{ id: string }>();
  for (const { id } of open.results) await disqualifyMatch(id, uid, now);
  await disqualifyTournamentRuns(uid, now);
}

/** Statistical evidence: suspends the player for review. Results already settled are left to the administrator. */
async function suspendForStats(uid: string, findings: Finding[], now: number) {
  const db = database();
  await db.batch([...findings.map((f) => signalInsert(db, uid, null, f, now)), ...suspensionOps(db, uid, "stats", reasonFor(findings), { findings }, now)]);
}

/**
 * Rates one real-money shot against every other angle on the same board, then
 * checks the player's recent shots. Runs after the response, so the player
 * never waits for it.
 */
export async function analyzeShot(input: {
  uid: string;
  runKey: string;
  revision: number;
  before: Game;
  angle: number;
  ruleset: number;
  rowKey: string | null;
  aimMs: number | null;
  aim?: AimTrail | null;
  /** The ghost trap shown with this board, if any. */
  trap?: Trap | null;
  evaluate: boolean;
  now?: number;
}) {
  const now = input.now ?? Date.now();
  const rows = rowsFor(input.ruleset, input.rowKey);
  // Each angle: its immediate points, and the value of the board it leaves.
  const outcome = (angle: number) => {
    try {
      const after = simulate(input.before, angle, input.ruleset, rows);
      return { gain: after.score - input.before.score, value: boardValue(input.before, after) };
    } catch {
      return null;
    }
  };
  const chosen = outcome(input.angle) ?? { gain: -1, value: -Infinity };
  const sampled = [];
  for (let angle = MIN_ANGLE; angle <= MAX_ANGLE; angle += ANALYSIS_STEP) {
    const result = outcome(angle);
    if (result) sampled.push(result);
  }
  const gains = sampled.map((s) => s.gain);
  const bestGain = Math.max(chosen.gain, ...gains);
  const bestShare = gains.length ? gains.filter((g) => g >= bestGain).length / gains.length : 1;
  const quality = qualityPercentile(chosen.value, sampled.map((s) => s.value));
  const trapped = input.trap ? (trappedShot(input.trap, input.before, input.angle, input.ruleset, quality) ? 1 : 0) : null;
  const db = database();
  await db
    .prepare("INSERT OR IGNORE INTO shot_analysis(run_key, revision, user_id, aim_ms, aim_moves, gain, best_gain, best_share, quality, angle, trapped, created) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(input.runKey, input.revision, input.uid, input.aimMs, input.aim ? aimMoves(input.aim) : null, chosen.gain, bestGain, bestShare, quality, input.angle, trapped, now)
    .run();
  if (trapped !== null) await evaluateTraps(input.uid, input.runKey, now);
  if (input.evaluate) await evaluatePlayer(input.uid, now);
}

/**
 * When this player's statistics start. Normally the window; after a review that
 * cleared them, the moment of the review. Evidence an administrator has already
 * looked at and rejected is never allowed to suspend the same player again —
 * without this, the shots that led to a lifted suspension are still in the
 * window and the next one they play puts them straight back under it.
 */
export async function statsSince(uid: string, now = Date.now()) {
  const row = await database()
    .prepare("SELECT reviewed_at AS at FROM player_suspensions WHERE user_id = ? AND status = 'lifted'")
    .bind(uid)
    .first<{ at: number | null }>();
  return Math.max(now - STATS.windowMs, Number(row?.at ?? 0));
}

export async function playerShotStats(uid: string, now = Date.now(), since = now - STATS.windowMs) {
  const { results } = await database()
    .prepare(
      `SELECT gain, best_gain AS bestGain, best_share AS bestShare, aim_ms AS aimMs, aim_moves AS aimMoves, quality, angle, trapped FROM shot_analysis
       WHERE user_id = ? AND created >= ? ORDER BY created DESC, revision DESC LIMIT ?`,
    )
    .bind(uid, since, STATS.maxShots)
    .all<{ gain: number; bestGain: number; bestShare: number; aimMs: number | null; aimMoves: number | null; quality: number | null; angle: number | null; trapped: number | null }>();
  return results;
}

/** Average shot quality of every player with enough recent analyzed shots, to compare one player with. */
export async function populationQuality(now = Date.now()) {
  const { results } = await database()
    .prepare(
      `SELECT AVG(quality) AS mean FROM shot_analysis
       WHERE created >= ? AND quality IS NOT NULL
       GROUP BY user_id HAVING COUNT(*) >= ? LIMIT 2000`,
    )
    .bind(now - STATS.windowMs, QUALITY.minShots)
    .all<{ mean: number }>();
  return results.map((r) => Number(r.mean));
}

/** The player's settled SOL matches, newest first, for the results trend. */
async function recentSolMatches(uid: string) {
  const { results } = await database()
    .prepare(
      `SELECT CASE WHEN m.winner = r.user_id THEN 1 ELSE 0 END AS won, r.score FROM runs r
       JOIN matches m ON m.id = r.match_id AND m.asset = 'devnet' AND m.settled = 1 AND m.cancelled = 0
       WHERE r.user_id = ? ORDER BY m.created DESC LIMIT ?`,
    )
    .bind(uid, TREND.recentMatches + 50)
    .all<{ won: number; score: number }>();
  return results.map((r) => ({ won: !!r.won, score: Number(r.score) }));
}

/** Suspends the player for review when their recent shots cross a statistical threshold. */
export async function evaluatePlayer(uid: string, now = Date.now()) {
  if (await isSuspended(uid)) return [];
  const since = await statsSince(uid, now);
  const [shots, population, matches] = await Promise.all([playerShotStats(uid, now, since), populationQuality(now), recentSolMatches(uid)]);
  const qualities = shots.map((s) => s.quality).filter((q): q is number => q !== null);
  const angles = shots.map((s) => s.angle).filter((a): a is number => a !== null);
  const trapRounds = shots.filter((s) => s.trapped !== null);
  const traps = { rounds: trapRounds.length, trapped: trapRounds.filter((s) => s.trapped).length };
  const findings = [...evaluateShots(shots), ...evaluateQuality(qualities, qualityThreshold(population), angles, traps)];
  /** Keeps the evidence without sanctioning, at most once a day per kind. */
  const note = async (recorded: Finding[], sanctioned: boolean) => {
    const db = database();
    const seen = await db.prepare("SELECT kind FROM cheat_signals WHERE user_id = ? AND created >= ?").bind(uid, now - 24 * 60 * 60_000).all<{ kind: string }>();
    const fresh = recorded.filter((f) => !seen.results.some((row) => row.kind === f.kind));
    if (fresh.length) await db.batch(fresh.map((f) => signalInsert(db, uid, null, { ...f, detail: { ...f.detail, sanctioned } }, now)));
  };
  const evidence = findings.filter((f) => f.level !== "watch");
  if (evidence.length) {
    if (await antiCheatEnabled()) await suspendForStats(uid, evidence, now);
    else await note(evidence, false);
  }
  // A finding that is only worth a look never suspends, whatever the switch says.
  const looks = findings.filter((f) => f.level === "watch");
  if (looks.length) await note(looks, false);
  // A jump in results is only put on the admin's watchlist, at most once a week.
  const watch = evaluateTrend(matches);
  if (watch.length) {
    const db = database();
    const recent = await db
      .prepare("SELECT 1 FROM cheat_signals WHERE user_id = ? AND kind = 'sudden_improvement' AND created >= ?")
      .bind(uid, now - 7 * 24 * 60 * 60_000)
      .first();
    if (!recent) await db.batch(watch.map((f) => signalInsert(db, uid, null, f, now)));
  }
  return [...findings, ...watch];
}

/**
 * Ghost traps: over a player's last trap rounds, repeatedly aiming at bricks that
 * only the game data shows means the player is not playing from the screen.
 * It suspends for review rather than sanctioning on the spot: no board is ever
 * changed for the player, but chance alone can explain one or two of them.
 */
export async function evaluateTraps(uid: string, runKey: string | null, now = Date.now()) {
  if (await isSuspended(uid)) return [];
  const db = database();
  const { results } = await db
    .prepare("SELECT trapped FROM shot_analysis WHERE user_id = ? AND trapped IS NOT NULL AND created >= ? ORDER BY created DESC, revision DESC LIMIT ?")
    .bind(uid, await statsSince(uid, now), TRAP.window)
    .all<{ trapped: number }>();
  const trapped = results.filter((r) => r.trapped).length;
  const detail = { trapped, trapRounds: results.length };
  if (trapped >= TRAP.suspectTrapped) {
    const finding: Finding = { kind: "ghost_trap", level: "stat", detail };
    if (await antiCheatEnabled()) await suspendForStats(uid, [finding], now);
    else {
      const seen = await db.prepare("SELECT 1 FROM cheat_signals WHERE user_id = ? AND kind = 'ghost_trap' AND created >= ?").bind(uid, now - 24 * 60 * 60_000).first();
      if (!seen) await db.batch([signalInsert(db, uid, runKey, { ...finding, detail: { ...detail, sanctioned: false } }, now)]);
    }
    return [finding];
  }
  if (trapped >= TRAP.watchTrapped) {
    const finding: Finding = { kind: "ghost_trap_watch", level: "watch", detail };
    const seen = await db.prepare("SELECT 1 FROM cheat_signals WHERE user_id = ? AND kind = 'ghost_trap_watch' AND created >= ?").bind(uid, now - 7 * 24 * 60 * 60_000).first();
    if (!seen) await db.batch([signalInsert(db, uid, runKey, finding, now)]);
    return [finding];
  }
  return [];
}

export { suspensionOps };
