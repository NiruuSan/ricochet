import { database, type Statement } from "@/db/raw";
import { aimFeatures, evaluateShots, FINDING_LABELS, qualityThreshold, STATS, type AimTrail } from "./anti-cheat-rules";
import { antiCheatEnabled, playerShotStats, populationQuality, suspensionOps } from "./anti-cheat";
import type { Finding } from "./anti-cheat-rules";
import { adminAudit, adminNote } from "./admin";
import { GameError } from "./matches";
import { cashAccountId, ensureCashAccount, HOUSE } from "./payments/accounts";

// Administrator review of anti-cheat cases: evidence, recent winnings, and the
// decision to lift a suspension or ban the player and seize their balance.

export type CheatSignalView = { kind: string; label: string; level: string; detail: Record<string, unknown>; runKey: string | null; created: number };
export type CheatCase = {
  name: string;
  /** `watch`: not suspended, on the watchlist for a signal worth a look. */
  status: "suspended" | "banned" | "lifted" | "watch";
  source: string;
  reason: string;
  created: number;
  reviewedAt: number | null;
  note: string | null;
  signals: CheatSignalView[];
  stats: {
    analyzedShots: number;
    hardShots: number;
    hardHitRate: number | null;
    meanAimMs: number | null;
    /** Share of shots with an aim trail where the aim never moved before the shot. */
    stillAimRate: number | null;
    /** Average shot quality percentile, and the level that gets a player flagged right now. */
    meanQuality: number | null;
    qualityThreshold: number;
    /** Medians over recent aim trails: samples, direction changes, and sample timing regularity. */
    aim: { trails: number; samples: number | null; reversals: number | null; gapCv: number | null };
    /** Ghost trap rounds the player met, and how many they aimed into. */
    traps: { rounds: number; trapped: number };
  };
  /** Last 30 days, in lamports except the match count. */
  winnings: { solMatchesWon: number; solMatchNet: number; tournamentPrizes: number; racePrizes: number };
  balances: { sol: number; gems: number };
};
export type AntiCheatOverview = {
  /** Whether automatic sanctions are on. */
  enabled: boolean;
  cases: CheatCase[];
  /** Players with a watch signal in the last 30 days who are not suspended. */
  watchlist: CheatCase[];
  recentSignals: (CheatSignalView & { name: string })[];
  thresholds: typeof STATS;
};

const MONTH = 30 * 24 * 60 * 60_000;

const signalView = (row: { kind: string; level: string; detail: string; run_key: string | null; created: number }): CheatSignalView => ({
  kind: row.kind,
  label: FINDING_LABELS[row.kind] ?? row.kind,
  level: row.level,
  detail: JSON.parse(row.detail) as Record<string, unknown>,
  runKey: row.run_key,
  created: row.created,
});

const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

type CaseRow = { user_id: string; name: string; status: CheatCase["status"]; source: string; reason: string; created: number; reviewed_at: number | null; note: string | null };

async function caseFor(row: CaseRow, now: number, threshold: number): Promise<CheatCase> {
  const db = database();
  const uid = row.user_id;
  const since = now - MONTH;
  const [signals, shots, won, prizes, balances, trails] = await Promise.all([
    db.prepare("SELECT kind, level, detail, run_key, created FROM cheat_signals WHERE user_id = ? ORDER BY created DESC LIMIT 20").bind(uid).all<{ kind: string; level: string; detail: string; run_key: string | null; created: number }>(),
    playerShotStats(uid, now),
    db
      .prepare(
        `SELECT COUNT(DISTINCT m.id) AS n, COALESCE(SUM(l.amount), 0) AS net FROM matches m
         JOIN cash_ledger l ON l.reference = m.id AND l.account_id = ? AND l.kind IN ('match_entry', 'match_payout', 'match_refund')
         WHERE m.asset = 'devnet' AND m.settled = 1 AND m.winner = ? AND m.created >= ?`,
      )
      .bind(cashAccountId(uid), uid, since)
      .first<{ n: number; net: number }>(),
    db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN kind = 'tournament_prize' THEN amount ELSE 0 END), 0) AS tournaments,
                COALESCE(SUM(CASE WHEN kind = 'weekly_race_prize' THEN amount ELSE 0 END), 0) AS races
         FROM cash_ledger WHERE account_id = ? AND created >= ?`,
      )
      .bind(cashAccountId(uid), since)
      .first<{ tournaments: number; races: number }>(),
    db
      .prepare("SELECT (SELECT balance FROM cash_accounts WHERE id = ?) AS sol, (SELECT balance FROM players WHERE id = ?) AS gems")
      .bind(cashAccountId(uid), uid)
      .first<{ sol: number | null; gems: number | null }>(),
    db
      .prepare(
        `SELECT s.aim FROM shot_analysis a JOIN run_shots s ON s.run_key = a.run_key AND s.revision = a.revision
         WHERE a.user_id = ? AND a.created >= ? AND s.aim IS NOT NULL ORDER BY a.created DESC LIMIT 100`,
      )
      .bind(uid, since)
      .all<{ aim: string }>(),
  ]);
  const features = trails.results.map((t) => aimFeatures(JSON.parse(t.aim) as AimTrail));
  const qualities = shots.map((s) => s.quality).filter((q): q is number => q !== null);
  const trapRounds = shots.filter((s) => s.trapped !== null);
  const hard = shots.filter((s) => s.bestShare <= STATS.hardShare && s.bestGain >= STATS.minBestGain);
  const aims = shots.map((s) => s.aimMs).filter((ms): ms is number => ms !== null);
  const withTrail = shots.filter((s) => s.aimMoves !== null);
  return {
    name: row.name,
    status: row.status,
    source: row.source,
    reason: row.reason,
    created: row.created,
    reviewedAt: row.reviewed_at,
    note: row.note,
    signals: signals.results.map(signalView),
    stats: {
      analyzedShots: shots.length,
      hardShots: hard.length,
      hardHitRate: hard.length ? hard.filter((s) => s.gain >= s.bestGain).length / hard.length : null,
      meanAimMs: aims.length ? Math.round(aims.reduce((a, b) => a + b, 0) / aims.length) : null,
      stillAimRate: withTrail.length ? withTrail.filter((s) => s.aimMoves === 0).length / withTrail.length : null,
      meanQuality: qualities.length ? qualities.reduce((a, b) => a + b, 0) / qualities.length : null,
      qualityThreshold: threshold,
      aim: {
        trails: features.length,
        samples: median(features.map((f) => f.samples)),
        reversals: median(features.map((f) => f.reversals)),
        gapCv: median(features.map((f) => f.gapCv).filter((cv): cv is number => cv !== null)),
      },
      traps: { rounds: trapRounds.length, trapped: trapRounds.filter((s) => s.trapped).length },
    },
    winnings: { solMatchesWon: Number(won?.n ?? 0), solMatchNet: Number(won?.net ?? 0), tournamentPrizes: Number(prizes?.tournaments ?? 0), racePrizes: Number(prizes?.races ?? 0) },
    balances: { sol: Number(balances?.sol ?? 0), gems: Number(balances?.gems ?? 0) },
  };
}

export async function antiCheatOverview(now = Date.now()): Promise<AntiCheatOverview> {
  const db = database();
  const [cases, recent, watched, population, enabled] = await Promise.all([
    db
      .prepare(
        `SELECT s.user_id, p.name, s.status, s.source, s.reason, s.created, s.reviewed_at, s.note
         FROM player_suspensions s JOIN players p ON p.id = s.user_id
         ORDER BY CASE s.status WHEN 'suspended' THEN 0 WHEN 'banned' THEN 1 ELSE 2 END, s.created DESC LIMIT 50`,
      )
      .all<{ user_id: string; name: string; status: CheatCase["status"]; source: string; reason: string; created: number; reviewed_at: number | null; note: string | null }>(),
    db
      .prepare(
        `SELECT c.kind, c.level, c.detail, c.run_key, c.created, p.name FROM cheat_signals c JOIN players p ON p.id = c.user_id
         ORDER BY c.created DESC LIMIT 50`,
      )
      .all<{ kind: string; level: string; detail: string; run_key: string | null; created: number; name: string }>(),
    db
      .prepare(
        `SELECT c.user_id, p.name, 'watch' AS status, 'watch' AS source, GROUP_CONCAT(DISTINCT c.kind) AS reason, MAX(c.created) AS created, NULL AS reviewed_at, NULL AS note
         FROM cheat_signals c JOIN players p ON p.id = c.user_id
         WHERE c.level = 'watch' AND c.created >= ?
           AND NOT EXISTS (SELECT 1 FROM player_suspensions s WHERE s.user_id = c.user_id AND s.status IN ('suspended', 'banned'))
         GROUP BY c.user_id ORDER BY created DESC LIMIT 30`,
      )
      .bind(now - MONTH)
      .all<CaseRow>(),
    populationQuality(now),
    antiCheatEnabled(),
  ]);
  const threshold = qualityThreshold(population);
  return {
    enabled,
    cases: await Promise.all(cases.results.map((row) => caseFor(row, now, threshold))),
    watchlist: await Promise.all(
      watched.results.map((row) => caseFor({ ...row, reason: row.reason.split(",").map((kind) => FINDING_LABELS[kind] ?? kind).join("; ") }, now, threshold)),
    ),
    recentSignals: recent.results.map((row) => ({ ...signalView(row), name: row.name })),
    thresholds: STATS,
  };
}

async function findPlayer(nameInput: unknown) {
  const player = await database().prepare("SELECT id, name FROM players WHERE lower(name) = lower(?)").bind(String(nameInput ?? "")).first<{ id: string; name: string }>();
  if (!player) throw new GameError("Player not found.", 404);
  return player;
}

/** A direct review lookup remains available even when the case leaves the overview's latest 50. */
export async function antiCheatCase(name: string, now = Date.now()): Promise<CheatCase> {
  const player = await findPlayer(name);
  const db = database();
  let row = await db.prepare(
    `SELECT s.user_id, p.name, s.status, s.source, s.reason, s.created, s.reviewed_at, s.note
     FROM player_suspensions s JOIN players p ON p.id = s.user_id WHERE s.user_id = ?`,
  ).bind(player.id).first<CaseRow>();
  if (!row) {
    row = await db.prepare(
      `SELECT c.user_id, p.name, 'watch' AS status, 'watch' AS source, GROUP_CONCAT(DISTINCT c.kind) AS reason,
              MAX(c.created) AS created, NULL AS reviewed_at, NULL AS note
       FROM cheat_signals c JOIN players p ON p.id = c.user_id
       WHERE c.user_id = ? AND c.level = 'watch' AND c.created >= ? GROUP BY c.user_id`,
    ).bind(player.id, now - MONTH).first<CaseRow>();
    if (row) row.reason = row.reason.split(",").map((kind) => FINDING_LABELS[kind] ?? kind).join("; ");
  }
  if (!row) throw new GameError("No anti-cheat case found for this player.", 404);
  return caseFor(row, now, qualityThreshold(await populationQuality(now)));
}

/** Administrator: suspends a player by hand, e.g. after a report. */
export async function adminSuspend(adminUid: string, nameInput: unknown, reasonInput: unknown, now = Date.now()) {
  const player = await findPlayer(nameInput);
  const reason = adminNote(reasonInput, true);
  const db = database();
  const finding: Finding = { kind: "admin", level: "stat", detail: { reason } };
  await db.batch([...suspensionOps(db, player.id, "admin", reason, { findings: [finding] }, now), adminAudit(adminUid, "anti_cheat_suspend", player.id, reason, now)]);
}

/** Administrator: the detection was wrong. The player can play again; this week's automatic race exclusion is removed. */
export async function adminLift(adminUid: string, nameInput: unknown, noteInput: unknown, now = Date.now()) {
  const player = await findPlayer(nameInput);
  const text = adminNote(noteInput, true);
  const db = database();
  const current = await db.prepare("SELECT status FROM player_suspensions WHERE user_id = ?").bind(player.id).first<{ status: string }>();
  if (current?.status !== "suspended" && current?.status !== "banned") throw new GameError("This player is not suspended.", 409);
  const [result] = await db.batch([
    db
      .prepare("UPDATE player_suspensions SET status = 'lifted', reviewed_by = ?, reviewed_at = ?, note = ? WHERE user_id = ? AND status IN ('suspended', 'banned')")
      .bind(adminUid, now, text, player.id),
    db
      .prepare("DELETE FROM weekly_race_exclusions WHERE user_id = ? AND admin_id = 'system' AND week_start NOT IN (SELECT week_start FROM weekly_races)")
      .bind(player.id),
    adminAudit(adminUid, "anti_cheat_lift", player.id, text, now),
  ]);
  if (!result.meta.changes) throw new GameError("This player is not suspended.", 409);
}

/**
 * Administrator: confirms cheating. The player stays locked out, loses their
 * unsettled matches and live tournament runs, and their SOL balance moves to the
 * house while their gems are removed.
 */
export async function adminBan(adminUid: string, nameInput: unknown, noteInput: unknown, now = Date.now()) {
  const player = await findPlayer(nameInput);
  const text = adminNote(noteInput, true);
  const db = database();
  const current = await db.prepare("SELECT status FROM player_suspensions WHERE user_id = ?").bind(player.id).first<{ status: string }>();
  if (current?.status !== "suspended") throw new GameError("Only a suspended player can be banned.", 409);

  const [{ disqualifyMatch }, { disqualifyTournamentRuns }] = await Promise.all([import("./matches"), import("./tournaments")]);
  const open = await db.prepare("SELECT id FROM matches WHERE settled = 0 AND (p1 = ? OR p2 = ?)").bind(player.id, player.id).all<{ id: string }>();
  for (const { id } of open.results) await disqualifyMatch(id, player.id, now);
  await disqualifyTournamentRuns(player.id, now);

  await ensureCashAccount(HOUSE);
  const balances = await db
    .prepare("SELECT (SELECT balance FROM cash_accounts WHERE id = ?) AS sol, (SELECT balance FROM players WHERE id = ?) AS gems")
    .bind(cashAccountId(player.id), player.id)
    .first<{ sol: number | null; gems: number | null }>();
  const sol = Number(balances?.sol ?? 0);
  const gems = Number(balances?.gems ?? 0);
  const reference = `seizure:${player.id}:${now}`;
  const ops: Statement[] = [
    db
      .prepare("UPDATE player_suspensions SET status = 'banned', reviewed_by = ?, reviewed_at = ?, note = ? WHERE user_id = ? AND status = 'suspended'")
      .bind(adminUid, now, text, player.id),
  ];
  if (sol > 0) {
    ops.push(
      db.prepare("INSERT INTO cash_ledger(id, account_id, kind, amount, reference, created) VALUES(?, ?, 'cheat_seizure', ?, ?, ?)").bind(`${reference}:player`, cashAccountId(player.id), -sol, reference, now),
      db.prepare("INSERT INTO cash_ledger(id, account_id, kind, amount, reference, created) VALUES(?, ?, 'cheat_seizure', ?, ?, ?)").bind(`${reference}:house`, cashAccountId(HOUSE), sol, reference, now),
    );
  }
  if (gems > 0) {
    ops.push(db.prepare("INSERT INTO ledger(id, user_id, match_id, kind, amount, created) VALUES(?, ?, NULL, 'cheat_seizure', ?, ?)").bind(`${reference}:gems`, player.id, -gems, now));
  }
  ops.push(adminAudit(adminUid, "anti_cheat_ban", player.id, `${text} · seized ${sol} lamports and ${gems} gems`, now));
  await db.batch(ops);
  return { sol, gems };
}

/** Re-runs the statistical checks on a player's recent shots without sanctioning, for review. */
export async function previewStats(nameInput: unknown, now = Date.now()) {
  const player = await findPlayer(nameInput);
  return evaluateShots(await playerShotStats(player.id, now));
}
