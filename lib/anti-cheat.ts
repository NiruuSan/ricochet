import { database, type Database, type Statement } from "@/db/raw";
import { aimMoves, ANALYSIS_STEP, evaluateShots, FINDING_LABELS, STATS, SUSPENDED_MESSAGE, type AimTrail, type Finding } from "./anti-cheat-rules";
import { MAX_ANGLE, MIN_ANGLE, simulate, type Game } from "./engine";
import { GameError } from "./matches";
import { PaymentError } from "./payments/errors";
import { rowsFor } from "./secret-rows";
import { weekStart } from "./weekly-race";

// Anti-cheat sanctions and analysis. The checks themselves are in
// lib/anti-cheat-rules.ts.

export const SYSTEM = "system";

/** SQL: whether `player` (an SQL expression for a player ID) may not play or move money. */
export const suspendedSql = (player: string) => `EXISTS (SELECT 1 FROM player_suspensions WHERE user_id = ${player} AND status IN ('suspended', 'banned'))`;

export async function isSuspended(uid: string) {
  return !!(await database().prepare(`SELECT ${suspendedSql("?")} AS s`).bind(uid).first<{ s: number }>())?.s;
}

export async function assertCanPlay(uid: string) {
  if (await isSuspended(uid)) throw new GameError(SUSPENDED_MESSAGE, 403);
}

export async function assertCanMoveMoney(uid: string) {
  if (await isSuspended(uid)) throw new PaymentError(SUSPENDED_MESSAGE);
}

export function signalInsert(db: Database, uid: string, runKey: string | null, finding: Finding, now: number) {
  return db
    .prepare("INSERT INTO cheat_signals(id, user_id, run_key, kind, level, detail, created) VALUES(?, ?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), uid, runKey, finding.kind, finding.level, JSON.stringify(finding.detail), now);
}

const reasonFor = (findings: Finding[]) => findings.map((f) => FINDING_LABELS[f.kind] ?? f.kind).join("; ");

/** Suspends a player (unless already suspended or banned), records why, and removes them from this week's race. */
function suspensionOps(db: Database, uid: string, source: "proof" | "stats" | "admin", reason: string, evidence: unknown, now: number): Statement[] {
  const startedNow = "EXISTS (SELECT 1 FROM player_suspensions WHERE user_id = ? AND status = 'suspended' AND created = ?)";
  return [
    db
      .prepare(
        `INSERT INTO player_suspensions(user_id, status, source, reason, evidence, created) VALUES(?, 'suspended', ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET status = 'suspended', source = excluded.source, reason = excluded.reason, evidence = excluded.evidence,
           created = excluded.created, reviewed_by = NULL, reviewed_at = NULL, note = NULL
         WHERE player_suspensions.status = 'lifted'`,
      )
      .bind(uid, source, reason, JSON.stringify(evidence), now),
    // Only when this batch started the suspension: an existing one is not repeated.
    db
      .prepare(
        `INSERT OR IGNORE INTO weekly_race_exclusions(week_start, user_id, reason, admin_id, created) SELECT ?, ?, ?, ?, ?
         WHERE NOT EXISTS (SELECT 1 FROM weekly_races WHERE week_start = ?) AND ${startedNow}`,
      )
      .bind(weekStart(now), uid, `Suspended: ${reason}`.slice(0, 200), SYSTEM, now, weekStart(now), uid, now),
    db
      .prepare(`INSERT OR IGNORE INTO notifications(id, user_id, kind, data, created) SELECT ?, ?, 'account_suspended', ?, ? WHERE ${startedNow}`)
      .bind(`suspension:${uid}:${now}`, uid, JSON.stringify({ reason }), now, uid, now),
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
  evaluate: boolean;
  now?: number;
}) {
  const now = input.now ?? Date.now();
  const rows = rowsFor(input.ruleset, input.rowKey);
  const gainAt = (angle: number) => {
    try {
      return simulate(input.before, angle, input.ruleset, rows).score - input.before.score;
    } catch {
      return -1;
    }
  };
  const gain = gainAt(input.angle);
  const sampled: number[] = [];
  for (let angle = MIN_ANGLE; angle <= MAX_ANGLE; angle += ANALYSIS_STEP) sampled.push(gainAt(angle));
  const bestGain = Math.max(gain, ...sampled);
  const bestShare = sampled.filter((g) => g >= bestGain).length / sampled.length;
  const db = database();
  await db
    .prepare("INSERT OR IGNORE INTO shot_analysis(run_key, revision, user_id, aim_ms, aim_moves, gain, best_gain, best_share, created) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(input.runKey, input.revision, input.uid, input.aimMs, input.aim ? aimMoves(input.aim) : null, gain, bestGain, bestShare, now)
    .run();
  if (input.evaluate) await evaluatePlayer(input.uid, now);
}

export async function playerShotStats(uid: string, now = Date.now()) {
  const { results } = await database()
    .prepare(
      `SELECT gain, best_gain AS bestGain, best_share AS bestShare, aim_ms AS aimMs, aim_moves AS aimMoves FROM shot_analysis
       WHERE user_id = ? AND created >= ? ORDER BY created DESC, revision DESC LIMIT ?`,
    )
    .bind(uid, now - STATS.windowMs, STATS.maxShots)
    .all<{ gain: number; bestGain: number; bestShare: number; aimMs: number | null; aimMoves: number | null }>();
  return results;
}

/** Suspends the player for review when their recent shots cross a statistical threshold. */
export async function evaluatePlayer(uid: string, now = Date.now()) {
  if (await isSuspended(uid)) return [];
  const findings = evaluateShots(await playerShotStats(uid, now));
  if (findings.length) await suspendForStats(uid, findings, now);
  return findings;
}

export { suspensionOps };
