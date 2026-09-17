// Anti-cheat rules: pure checks, shared by the shot path and the tests. The
// sanctions that follow a finding live in lib/anti-cheat.ts.
//
// Two levels of finding:
// - proof: technical evidence that a shot did not come from a person using the
//   official client (automation browser, synthetic input, animation skipped
//   repeatedly). The player is suspended at once, their unsettled matches are
//   lost to the opponent and their live tournament runs are disqualified.
// - stat: statistical evidence (superhuman precision or rhythm over many shots).
//   The player is suspended for review; past results are left for the admin.

/** What the official client reports with every shot. */
export type ShotProof = {
  v: 1;
  /** Time from the board becoming ready to the shot, in ms. */
  aimMs: number;
  /** Real (trusted) pointer and key events while aiming. */
  inputs: number;
  /** Whether the event that fired the shot was a real user event. */
  trusted: boolean;
  /** `navigator.webdriver`: set by Selenium, Playwright, Puppeteer and similar tools. */
  webdriver: boolean;
};

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

export type Finding = { kind: string; level: "proof" | "stat"; detail: Record<string, unknown> };

export const OUTDATED_CLIENT = "Bounce was updated. Reload the page to keep playing.";
export const SUSPENDED_MESSAGE = "Your account is suspended while suspicious activity is reviewed. Contact support if you think this is a mistake.";

/** Client animation: 120 simulation ticks per second, up to 3× speed. */
const CLIENT_TICK_MS = 1000 / 120;
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

/** Angles sampled to rate a shot, every 2°. */
export const ANALYSIS_STEP = 2;

export function parseProof(input: unknown): ShotProof | null {
  if (!input || typeof input !== "object") return null;
  const p = input as Record<string, unknown>;
  if (p.v !== 1 || typeof p.trusted !== "boolean" || typeof p.webdriver !== "boolean") return null;
  const aimMs = Number(p.aimMs);
  const inputs = Number(p.inputs);
  if (!Number.isSafeInteger(aimMs) || aimMs < 0 || !Number.isSafeInteger(inputs) || inputs < 0) return null;
  return { v: 1, aimMs: Math.min(aimMs, 86_400_000), inputs: Math.min(inputs, 1_000_000), trusted: p.trusted, webdriver: p.webdriver };
}

export const minAnimationMs = (ticks: number) => (ticks * CLIENT_TICK_MS) / MAX_CLIENT_SPEED;

/**
 * Checks one shot before it is applied. From ruleset 6 the client sends a shot
 * as its balls launch and cannot send the next one before they land, so the gap
 * between two shots can never be much shorter than the previous animation.
 */
export function inspectShot(input: {
  proof: ShotProof;
  ruleset: number;
  now: number;
  previousShotAt: number | null;
  previousTicks: number | null;
  timingStrikes: number;
}): Finding[] {
  const { proof, ruleset, now, previousShotAt, previousTicks, timingStrikes } = input;
  const findings: Finding[] = [];
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
  automation_browser: "Automation browser (webdriver)",
  synthetic_input: "Shot fired by a script, not a real input",
  impossible_timing: "Shots faster than the animation allows",
  timing: "Shot faster than the animation allows",
  superhuman_precision: "Superhuman precision on hard shots",
  mechanical_rhythm: "Mechanical aiming rhythm",
  admin: "Suspended by an administrator",
};
