// Anti-cheat rules: pure checks, shared by the shot path and the tests. The
// sanctions that follow a finding live in lib/anti-cheat.ts.
//
// Two levels of finding:
// - proof: technical evidence that a shot did not come from a person using the
//   official client (automation browser, synthetic input, animation skipped
//   repeatedly). The player is suspended at once, their unsettled matches are
//   lost to the opponent and their live tournament runs are disqualified.
// - stat: statistical evidence (superhuman shot quality, precision or rhythm over
//   many shots). The player is suspended for review; past results are left for the admin.
// - watch: worth a look (modified page, sudden jump in results). Recorded and
//   listed for the admin, with no sanction.
import { CLIENT_TICKS_PER_SECOND, type Game } from "./engine";

/** What the official client reports with every shot, signed with the run's shot key. */
export type ShotProof = {
  v: 2;
  /** Time from the board becoming ready to the shot, in ms. */
  aimMs: number;
  /** Real (trusted) pointer and key events while aiming. */
  inputs: number;
  /** Whether the event that fired the shot was a real user event. */
  trusted: boolean;
  /** `navigator.webdriver`: set by Selenium, Playwright, Puppeteer and similar tools. */
  webdriver: boolean;
  /** The client build; a report from another build is from an outdated tab. */
  build: string;
  /** CLIENT_FLAGS: page functions the game relies on that were replaced. */
  flags: number;
  /** Script-made (untrusted) pointer and key events on the board while aiming. */
  synthetic: number;
  /** HMAC-SHA256 of reportMessage(...) with the run's shot key, hex. */
  sig: string;
};

export const CLIENT_FLAGS = { fetchPatched: 1, dispatchPatched: 2 } as const;

/** Identifies the deployed client; it changes with every deployment. */
export const CLIENT_BUILD = process.env.BOUNCE_BUILD ?? "dev";

/**
 * The exact text the client signs for a shot. Any field changed after signing
 * (the trust flag, the input counts, the aim) breaks the signature.
 */
export function reportMessage(input: { runKey: string; revision: number; angle: number; proof: Omit<ShotProof, "sig" | "v">; aim: unknown }) {
  const { runKey, revision, angle, proof, aim } = input;
  return [
    "bounce-shot-v2",
    proof.build,
    runKey,
    revision,
    angle,
    proof.aimMs,
    proof.inputs,
    proof.trusted ? 1 : 0,
    proof.webdriver ? 1 : 0,
    proof.flags,
    proof.synthetic,
    aim === undefined || aim === null ? "" : JSON.stringify(aim),
  ].join("|");
}

/** How the player aimed before a shot: [ms since the board was ready, angle]. */
export type AimTrail = [number, number][];

/** Samples the client keeps per shot; it thins longer trails to this many. */
export const MAX_AIM_SAMPLES = 120;
const AIM_MIN_ANGLE = 8;
const AIM_MAX_ANGLE = 172;

/** A valid trail, or null. A missing or malformed trail never blocks a shot; it is just not stored. */
export function parseAim(input: unknown): AimTrail | null {
  if (!Array.isArray(input) || !input.length || input.length > MAX_AIM_SAMPLES) return null;
  const trail: AimTrail = [];
  let last = 0;
  for (const sample of input) {
    if (!Array.isArray(sample) || sample.length !== 2) return null;
    const [t, angle] = sample;
    if (!Number.isSafeInteger(t) || t < last || t > 3_600_000) return null;
    if (typeof angle !== "number" || !Number.isFinite(angle) || angle < AIM_MIN_ANGLE || angle > AIM_MAX_ANGLE) return null;
    trail.push([t, Math.round(angle * 10) / 10]);
    last = t;
  }
  return trail;
}

/** Times the aim actually changed along a trail. */
export const aimMoves = (trail: AimTrail) => trail.reduce((moves, [, angle], i) => moves + (i > 0 && Math.abs(angle - trail[i - 1][1]) >= 0.1 ? 1 : 0), 0);

export type Finding = { kind: string; level: "proof" | "stat" | "watch"; detail: Record<string, unknown> };

export const OUTDATED_CLIENT = "Bounce was updated. Reload the page to keep playing.";
export const SUSPENDED_MESSAGE = "Your account is suspended while suspicious activity is reviewed. Contact support if you think this is a mistake.";

/** Client animation: the drawn tick rate (lib/engine.ts), up to 3× speed. */
const CLIENT_TICK_MS = 1000 / CLIENT_TICKS_PER_SECOND;
const MAX_CLIENT_SPEED = 3;

export const TIMING = {
  /** Only shots whose animation lasts at least this long are timed, so network jitter cannot matter. */
  minAnimationMs: 1_500,
  /** A next shot arriving before this share of the fastest possible animation is impossible from the client. */
  ratio: 0.5,
  /** Impossible gaps in one run before it counts as proof. */
  strikes: 3,
};

export const STATS = {
  windowMs: 30 * 24 * 60 * 60_000,
  maxShots: 400,
  /** A "hard" shot: at most this share of angles reaches the best result… */
  hardShare: 0.05,
  /** …and the best result is worth at least this many points. */
  minBestGain: 5,
  minHardShots: 25,
  /** Share of hard shots played perfectly that no person sustains. */
  maxHardHitRate: 0.85,
  rhythmShots: 40,
  /** Aim times this fast and this regular (coefficient of variation) are mechanical. */
  rhythmMaxMeanMs: 2_500,
  rhythmMaxCv: 0.08,
};

/**
 * Shot quality: each shot's percentile among every sampled angle, judged on the
 * board it leaves (points, cleared board, bricks close to the ground), not only
 * on immediate points. A player whose average percentile stays at the very top
 * over many shots is playing like a solver.
 */
export const QUALITY = {
  minShots: 60,
  /**
   * Without enough players to compare with, this average percentile is worth a
   * look. Simulated models (work/redteam/calibrate.mjs): random 0.65, average
   * player 0.74, careful player aiming within ±3° of a top plan 0.78, the
   * red-team bot 0.89, a points solver 0.999 — and a real strong player, on a
   * phone, over 400 shots: 0.85 to 0.86. A person and a program sit close
   * enough together up here that this figure opens a case; it never closes one
   * (see `evaluateQuality`).
   */
  absoluteMean: 0.88,
  /** With a population, the player must also be above its 99th percentile… */
  populationPercentile: 0.99,
  /** …and above this floor, so a population of weak players never makes good play suspicious. */
  floorMean: 0.86,
  minPopulation: 20,
  /**
   * The one average no person reaches: a run of 60 shots this close to the best
   * available angle every time is a search, not a hand. The red-team bot itself
   * stays below it, which is the point — below this line an average is never
   * evidence on its own.
   */
  solverMean: 0.95,
  /** Shots within this many degrees of each other count as the same shot. */
  angleBand: 5,
  /**
   * Above this share of shots inside one band, the player is repeating a shot
   * rather than answering each board, and their average percentile says nothing
   * about solving. Simulated models (work/redteam/calibrate.mjs, 14 games):
   * random 0.11, average player 0.24, careful player 0.39, the red-team bot
   * 0.54, a points solver 0.69 — and a player who always aims flat, 1.00.
   */
  maxAngleShare: 0.8,
  /** Below this many known angles there is nothing to say about variety. */
  minAngleShots: 30,
  /**
   * Ghost trap rounds a player must have met before their trap record can
   * corroborate a high average. A program reading the game data falls into
   * roughly half of them (lib/ghost-trap.ts); a person lands in one by chance
   * now and again, so a single trapped shot says nothing.
   */
  minTrapRounds: 8,
  /** Trapped shots, and the share of trap rounds they must be, to corroborate. */
  corroboratingTraps: 2,
  corroboratingTrapShare: 0.25,
};

/** Results trend: a sudden jump in real-money results, for review. */
export const TREND = {
  recentMatches: 20,
  minPreviousMatches: 20,
  recentWinRate: 0.75,
  previousWinRate: 0.45,
  scoreRatio: 2.5,
};

/** Rows run from 7 (just spawned) down to 1 (game over): bricks near the ground weigh most. */
export function boardValue(before: Game, after: Game) {
  if (after.over) return -10_000;
  const danger = after.bricks.reduce((sum, b) => sum + b.hp * (8 - b.row) ** 2, 0) / 10;
  return after.score - before.score + (after.bonus ? 30 : 0) - danger;
}

/** A shot's percentile among the sampled angles: 1 when nothing sampled is better. */
export function qualityPercentile(chosen: number, sampled: number[]) {
  if (!sampled.length) return null;
  return 1 - sampled.filter((v) => v > chosen + 1e-9).length / sampled.length;
}

/** The average quality above which a player is flagged, given other players' averages. */
export function qualityThreshold(populationMeans: number[]) {
  if (populationMeans.length < QUALITY.minPopulation) return QUALITY.absoluteMean;
  const sorted = [...populationMeans].sort((a, b) => a - b);
  const p = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * QUALITY.populationPercentile))];
  return Math.max(QUALITY.floorMean, p);
}

/**
 * How much of a player's aiming is one shot: the largest share of angles that
 * sit within `angleBand` degrees of each other. Null when too few are known.
 */
export function angleConcentration(angles: number[]) {
  if (angles.length < QUALITY.minAngleShots) return null;
  let most = 0;
  for (const centre of angles) {
    let near = 0;
    for (const angle of angles) if (Math.abs(angle - centre) <= QUALITY.angleBand) near++;
    if (near > most) most = near;
  }
  return most / angles.length;
}

/**
 * What a player's average shot quality is worth as evidence.
 *
 * On its own: very little. A strong person and a program both live in the high
 * eighties up here — the site's own best player averages 0.85 to 0.86 over 400
 * shots played by hand on a phone, and the red-team bot 0.89 — so an average in
 * that band cannot tell them apart, and taking somebody's play away on it alone
 * suspends good players for being good. Two things can make it evidence:
 *
 * - an average no hand reaches at all (`solverMean`), or
 * - the ghost traps saying the same thing. They are the one check with no
 *   overlap: a program reading the game data aims at bricks that are not on the
 *   screen, and a person does not. Chance puts a person in one now and again,
 *   so corroboration means a repeated pattern, not a single unlucky round.
 *
 * Anything else is recorded for the administrator, with the player's play left
 * alone. A high average from one repeated angle is not even that: someone who
 * plays the same flat shot every time beats most of the sampled angles without
 * computing anything — the shot is simply a good habit, and the percentile
 * rewards it.
 */
export function evaluateQuality(
  qualities: number[],
  threshold: number,
  angles: number[] = [],
  traps: { rounds: number; trapped: number } = { rounds: 0, trapped: 0 },
): Finding[] {
  if (qualities.length < QUALITY.minShots) return [];
  const mean = qualities.reduce((a, b) => a + b, 0) / qualities.length;
  if (mean < threshold) return [];
  const elite = qualities.filter((q) => q >= 0.9).length / qualities.length;
  const concentration = angleConcentration(angles);
  const detail = {
    shots: qualities.length,
    meanQuality: Math.round(mean * 1000) / 1000,
    threshold: Math.round(threshold * 1000) / 1000,
    eliteShare: Math.round(elite * 1000) / 1000,
    ...(concentration === null ? {} : { angleShare: Math.round(concentration * 1000) / 1000 }),
    ...(traps.rounds ? { trapRounds: traps.rounds, trapped: traps.trapped } : {}),
  };
  if (concentration !== null && concentration > QUALITY.maxAngleShare) {
    return [{ kind: "one_angle_quality", level: "watch", detail: { ...detail, angleBand: QUALITY.angleBand } }];
  }
  const corroborated =
    traps.rounds >= QUALITY.minTrapRounds &&
    traps.trapped >= QUALITY.corroboratingTraps &&
    traps.trapped / traps.rounds >= QUALITY.corroboratingTrapShare;
  if (mean >= QUALITY.solverMean || corroborated) return [{ kind: "superhuman_quality", level: "stat", detail }];
  return [{ kind: "unconfirmed_quality", level: "watch", detail }];
}

/** Matches newest first: `won` and the player's score. */
export function evaluateTrend(matches: { won: boolean; score: number }[]): Finding[] {
  const recent = matches.slice(0, TREND.recentMatches);
  const previous = matches.slice(TREND.recentMatches);
  if (recent.length < TREND.recentMatches || previous.length < TREND.minPreviousMatches) return [];
  const rate = (list: typeof matches) => list.filter((m) => m.won).length / list.length;
  const mean = (list: typeof matches) => list.reduce((sum, m) => sum + m.score, 0) / list.length;
  const [recentRate, previousRate, recentScore, previousScore] = [rate(recent), rate(previous), mean(recent), mean(previous)];
  const winJump = recentRate >= TREND.recentWinRate && previousRate <= TREND.previousWinRate;
  const scoreJump = previousScore > 0 && recentScore / previousScore >= TREND.scoreRatio;
  if (!winJump && !scoreJump) return [];
  return [
    {
      kind: "sudden_improvement",
      level: "watch",
      detail: { recentWinRate: Math.round(recentRate * 100) / 100, previousWinRate: Math.round(previousRate * 100) / 100, recentMeanScore: Math.round(recentScore), previousMeanScore: Math.round(previousScore) },
    },
  ];
}

/** Shape of one aim trail, for review: samples, how often the aim changed direction, and how regular the sample timing is. */
export function aimFeatures(trail: AimTrail) {
  let reversals = 0;
  let direction = 0;
  for (let i = 1; i < trail.length; i++) {
    const delta = trail[i][1] - trail[i - 1][1];
    if (Math.abs(delta) < 0.3) continue;
    const sign = Math.sign(delta);
    if (direction && sign !== direction) reversals++;
    direction = sign;
  }
  const gaps = trail.slice(1).map(([t], i) => t - trail[i][0]).filter((g) => g > 0);
  const meanGap = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;
  const gapCv = gaps.length > 2 && meanGap > 0 ? Math.sqrt(gaps.reduce((sum, g) => sum + (g - meanGap) ** 2, 0) / gaps.length) / meanGap : null;
  return { samples: trail.length, durationMs: trail.length ? trail[trail.length - 1][0] : 0, reversals, gapCv };
}

/** Angles sampled to rate a shot, every 2°. */
export const ANALYSIS_STEP = 2;

const count = (value: unknown, max: number) => (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= max ? value : null);

/** A well-formed report, or null (an outdated or foreign client). Values are checked, never clamped: they are signed. */
export function parseProof(input: unknown): ShotProof | null {
  if (!input || typeof input !== "object") return null;
  const p = input as Record<string, unknown>;
  if (p.v !== 2 || typeof p.trusted !== "boolean" || typeof p.webdriver !== "boolean") return null;
  if (typeof p.build !== "string" || p.build.length > 40 || typeof p.sig !== "string" || !/^[0-9a-f]{64}$/.test(p.sig)) return null;
  const aimMs = count(p.aimMs, 86_400_000);
  const inputs = count(p.inputs, 1_000_000);
  const flags = count(p.flags, 255);
  const synthetic = count(p.synthetic, 1_000_000);
  if (aimMs === null || inputs === null || flags === null || synthetic === null) return null;
  return { v: 2, aimMs, inputs, trusted: p.trusted, webdriver: p.webdriver, build: p.build, flags, synthetic, sig: p.sig };
}

export const minAnimationMs = (ticks: number) => (ticks * CLIENT_TICK_MS) / MAX_CLIENT_SPEED;

/**
 * Checks one shot before it is applied. From ruleset 6 the client sends a shot
 * as its balls launch and cannot send the next one before they land, so the gap
 * between two shots can never be much shorter than the previous animation.
 */
export function inspectShot(input: {
  proof: ShotProof;
  /** Whether the report's signature matches the run's shot key. */
  signed: boolean;
  ruleset: number;
  now: number;
  previousShotAt: number | null;
  previousTicks: number | null;
  timingStrikes: number;
}): Finding[] {
  const { proof, signed, ruleset, now, previousShotAt, previousTicks, timingStrikes } = input;
  const findings: Finding[] = [];
  // A report edited after the client signed it: someone rewrote the request.
  if (!signed) findings.push({ kind: "forged_report", level: "proof", detail: { signature: "invalid" } });
  // Several script-made events moved the aim: a person's input is always trusted.
  if (proof.synthetic >= 3) findings.push({ kind: "synthetic_aim", level: "proof", detail: { syntheticEvents: proof.synthetic } });
  if (proof.flags) {
    const replaced = Object.entries(CLIENT_FLAGS).filter(([, bit]) => proof.flags & bit).map(([name]) => name);
    findings.push({ kind: "tampered_client", level: "watch", detail: { replaced } });
  }
  if (proof.webdriver) findings.push({ kind: "automation_browser", level: "proof", detail: { webdriver: true } });
  if (!proof.trusted) findings.push({ kind: "synthetic_input", level: "proof", detail: { trusted: false, inputs: proof.inputs } });
  if (ruleset >= 6 && previousShotAt !== null && previousTicks !== null) {
    const fastest = minAnimationMs(previousTicks);
    const gap = now - previousShotAt;
    if (fastest >= TIMING.minAnimationMs && gap < fastest * TIMING.ratio) {
      const detail = { gapMs: gap, fastestAnimationMs: Math.round(fastest), strikes: timingStrikes + 1 };
      findings.push({ kind: timingStrikes + 1 >= TIMING.strikes ? "impossible_timing" : "timing", level: timingStrikes + 1 >= TIMING.strikes ? "proof" : "stat", detail });
    }
  }
  return findings;
}

export type AnalyzedShot = { gain: number; bestGain: number; bestShare: number; aimMs: number | null };

/** Statistical findings over a player's recent analyzed real-money shots, newest first. */
export function evaluateShots(shots: AnalyzedShot[]): Finding[] {
  const findings: Finding[] = [];
  const hard = shots.filter((s) => s.bestShare <= STATS.hardShare && s.bestGain >= STATS.minBestGain);
  const perfect = hard.filter((s) => s.gain >= s.bestGain).length;
  if (hard.length >= STATS.minHardShots && perfect / hard.length >= STATS.maxHardHitRate) {
    findings.push({ kind: "superhuman_precision", level: "stat", detail: { hardShots: hard.length, perfect, hitRate: Math.round((perfect / hard.length) * 1000) / 1000 } });
  }
  const aims = shots.map((s) => s.aimMs).filter((ms): ms is number => ms !== null).slice(0, STATS.rhythmShots);
  if (aims.length >= STATS.rhythmShots) {
    const mean = aims.reduce((sum, ms) => sum + ms, 0) / aims.length;
    const cv = mean > 0 ? Math.sqrt(aims.reduce((sum, ms) => sum + (ms - mean) ** 2, 0) / aims.length) / mean : 0;
    if (mean <= STATS.rhythmMaxMeanMs && cv <= STATS.rhythmMaxCv) {
      findings.push({ kind: "mechanical_rhythm", level: "stat", detail: { shots: aims.length, meanAimMs: Math.round(mean), cv: Math.round(cv * 1000) / 1000 } });
    }
  }
  return findings;
}

export const FINDING_LABELS: Record<string, string> = {
  ghost_trap: "Repeatedly aimed at bricks only the game data shows (ghost traps)",
  ghost_trap_watch: "Aimed at bricks only the game data shows",
  forged_report: "Shot report edited after signing (request rewritten)",
  synthetic_aim: "Aim moved by script-made events",
  tampered_client: "Game page functions replaced (extension or script)",
  superhuman_quality: "Solver-level shot quality",
  one_angle_quality: "High shot quality from one repeated angle",
  unconfirmed_quality: "High shot quality, with nothing else pointing to a program",
  sudden_improvement: "Sudden jump in real-money results",
  automation_browser: "Automation browser (webdriver)",
  synthetic_input: "Shot fired by a script, not a real input",
  impossible_timing: "Shots faster than the animation allows",
  timing: "Shot faster than the animation allows",
  superhuman_precision: "Superhuman precision on hard shots",
  mechanical_rhythm: "Mechanical aiming rhythm",
  admin: "Suspended by an administrator",
};
