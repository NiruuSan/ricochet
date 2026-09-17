import { createHmac } from "node:crypto";
import type { Run } from "./api-types";
import { boardValue } from "./anti-cheat-rules";
import { COLS, MAX_ANGLE, MIN_ANGLE, random, simulate, type Brick, type Game } from "./engine";
import { ghostHp, syncFor } from "./ghost-bricks";
import { serverSecret, shotKeyFor } from "./shot-key";

// Ghost traps (server only). On some rounds of real-money runs the server
// places ghost bricks (lib/ghost-bricks.ts) so that, on the board the game data
// shows, a narrow band of angles looks excellent, while on the real board those
// angles are poor. A person sees the real board and has no reason to aim there;
// a bot planning on the data does. The real board is never changed: every
// simulation that counts runs without ghosts.

export const TRAP = {
  /** Share of eligible rounds that get a trap. */
  chance: 0.35,
  minRound: 3,
  /** Planning simulates a few dozen shots on the response path; very long runs are left alone. */
  maxBalls: 150,
  attempts: 8,
  /** Angles are sampled every 6° while searching… */
  step: 6,
  /** …and every degree to confirm a candidate, so no angle in between escapes the trap. */
  fineStep: 1,
  /** The trap band: angles worth nearly as much as the best one on the ghost board… */
  fakeTolerance: 0.05,
  /** The trap must beat every genuinely good angle on the ghost board by this margin, so a solver cannot miss it. */
  margin: 1.25,
  /** …and in the bottom half on the real board… */
  realPercentile: 0.5,
  /** …covering at most this share of all angles, so a person lands there by chance rarely. */
  maxShare: 0.08,
  /**
   * Of a player's recent trap rounds: this many trapped shots suspends for review.
   * A bot does not fall into every trap (the board changes sharply between
   * neighbouring angles), so the window is wide and the sanction is a review,
   * never an automatic loss.
   */
  window: 12,
  suspectTrapped: 4,
  /** …and this many puts them on the watchlist. */
  watchTrapped: 2,
  /** A shot counts as trapped when it ranks this high among the angles of the ghost board… */
  trappedFakeQuality: 0.9,
  /** …and no higher than this on the real one. */
  trappedRealQuality: 0.5,
};

export type Trap = {
  revision: number;
  sync: number;
  ghosts: Brick[];
  /** Share of sampled angles that the trap makes attractive, i.e. how often a random shot lands in it. */
  share: number;
};

const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
};

const seedFor = (label: string) => createHmac("sha256", serverSecret()).update(`bounce-ghost:${label}`).digest().readUInt32LE(0);

/**
 * Values every sampled angle on `board`. Nobody, person or program, knows the
 * next row, so it is left out of both sides of a trap: the only difference
 * between them is the ghost bricks.
 */
const noRows = () => [];

function valuesOver(before: Game, board: Game, ruleset: number, step = TRAP.step) {
  const values: number[] = [];
  for (let angle = MIN_ANGLE; angle <= MAX_ANGLE; angle += step) {
    try {
      values.push(boardValue(before, simulate(board, angle, ruleset, noRows)));
    } catch {
      values.push(-Infinity);
    }
  }
  return values;
}

/** A trap for the board a run shows at `revision`, or null (most rounds). Deterministic for a run and revision. */
export function planTrap(runKey: string, revision: number, state: Game, ruleset: number): Trap | null {
  if (ruleset < 6 || state.over || state.round < TRAP.minRound || state.balls > TRAP.maxBalls || state.bricks.length < 2) return null;
  const rng = random(seedFor(`${runKey}:${revision}`));
  if (rng() >= TRAP.chance) return null;

  const key = shotKeyFor(runKey);
  const sync = syncFor(key, revision, state.bricks);
  const real = valuesOver(state, state, ruleset);
  const realMax = percentile(real.filter(Number.isFinite), TRAP.realPercentile);
  const taken = new Set(state.bricks.map((b) => `${b.col}:${b.row}`));
  // Ghosts go where good shots do not pass: the side columns and the low rows.
  const empty: [number, number][] = [];
  for (let row = 2; row <= 5; row++) {
    for (const col of [0, COLS - 1, 1, COLS - 2]) if (!taken.has(`${col}:${row}`)) empty.push([col, row]);
  }
  if (!empty.length) return null;
  const strongest = Math.max(...state.bricks.map((b) => b.hp));

  // Long runs simulate slowly: fewer placements are tried on them.
  const attempts = state.balls > 60 ? Math.ceil(TRAP.attempts / 2) : TRAP.attempts;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const ghosts: Brick[] = [];
    const count = 1 + Math.floor(rng() * 2);
    for (let i = 0; i < count && empty.length; i++) {
      const [col, row] = empty[Math.floor(rng() * empty.length)];
      if (ghosts.some((g) => g.col === col && g.row === row)) continue;
      // Ghosts are worth far more than anything real: a solver reading the data cannot resist them.
      // Worth more than anything real, but not so much that good angles gain from them too.
      const hp = ghostHp(key, sync, col, row, Math.ceil(strongest * (2 + rng() * 2)));
      if (hp !== null) ghosts.push({ col, row, hp });
    }
    if (!ghosts.length) continue;
    const fake = valuesOver(state, { ...state, bricks: [...state.bricks, ...ghosts] }, ruleset);
    const fakeBest = Math.max(...fake.filter(Number.isFinite));
    // Angles a solver on the ghost board would consider, that the real board does not reward.
    const fakeMin = fakeBest - Math.max(2, Math.abs(fakeBest) * TRAP.fakeTolerance);
    const band = fake.map((f, i) => Number.isFinite(f) && f >= fakeMin && real[i] <= realMax);
    const share = band.filter(Boolean).length / band.length;
    const bestIndex = fake.indexOf(fakeBest);
    // On the ghost board, every angle the real board rewards must stay well below the trap.
    const bestHonest = Math.max(...fake.filter((f, i) => Number.isFinite(f) && real[i] > realMax), 0);
    if (share > 0 && share <= TRAP.maxShare && band[bestIndex] && fakeBest >= bestHonest * TRAP.margin) {
      const confirmed = confirm(state, ghosts, ruleset);
      if (confirmed) return { revision, sync, ghosts, share: confirmed.share };
    }
  }
  return null;
}

/**
 * Re-checks a candidate degree by degree: the best angle of the ghost board must
 * still be one the real board does not reward, whatever resolution a program searches at.
 */
function confirm(state: Game, ghosts: Brick[], ruleset: number) {
  const step = state.balls > 80 ? 2 : TRAP.fineStep;
  const real = valuesOver(state, state, ruleset, step);
  const fake = valuesOver(state, { ...state, bricks: [...state.bricks, ...ghosts] }, ruleset, step);
  const finite = real.filter(Number.isFinite);
  if (!finite.length) return null;
  const realMax = percentile(finite, TRAP.realPercentile);
  const fakeBest = Math.max(...fake.filter(Number.isFinite));
  const fakeMin = fakeBest - Math.max(2, Math.abs(fakeBest) * TRAP.fakeTolerance);
  const band = fake.map((f, i) => Number.isFinite(f) && f >= fakeMin && real[i] <= realMax);
  const share = band.filter(Boolean).length / band.length;
  const bestHonest = Math.max(...fake.filter((f, i) => Number.isFinite(f) && real[i] > realMax), 0);
  // Every near-best angle of the ghost board has to be a trap, or a solver escapes it.
  const baited = fake.every((f, i) => !Number.isFinite(f) || f < fakeMin || band[i]);
  if (!baited || share <= 0 || share > TRAP.maxShare || fakeBest < bestHonest * TRAP.margin) return null;
  return { share: Math.round(share * 1000) / 1000 };
}

export const parseTrap = (json: string | null | undefined): Trap | null => {
  if (!json) return null;
  try {
    return JSON.parse(json) as Trap;
  } catch {
    return null;
  }
};

/**
 * The run as sent to its player: with the round's ghosts mixed into the board
 * and the `sync` the client needs to remove them. `run.state` must be the real board.
 */
export function presentRun(run: Run, runKey: string, trapJson: string | null | undefined): Run {
  const trap = parseTrap(trapJson);
  const key = run.shotKey ?? shotKeyFor(runKey);
  if (!trap || trap.revision !== run.revision) return { ...run, shotKey: key, sync: syncFor(key, run.revision, run.state.bricks) };
  const bricks = [...run.state.bricks];
  const rng = random(seedFor(`${runKey}:${run.revision}:order`));
  for (const ghost of trap.ghosts) bricks.splice(Math.floor(rng() * (bricks.length + 1)), 0, ghost);
  return { ...run, shotKey: key, sync: trap.sync, state: { ...run.state, bricks } };
}

/**
 * Whether the shot was aimed into the round's trap: among the best angles of the
 * board the data showed, and not of the real one. Ranks, not values, so that the
 * sharp changes between neighbouring angles cannot hide a trapped shot.
 * `realQuality` is the shot's rank on the real board (lib/anti-cheat.ts).
 */
export function trappedShot(trap: Trap, before: Game, angle: number, ruleset: number, realQuality: number | null) {
  if (realQuality === null || realQuality > TRAP.trappedRealQuality) return false;
  const ghostBoard = { ...before, bricks: [...before.bricks, ...trap.ghosts] };
  try {
    const chosen = boardValue(before, simulate(ghostBoard, angle, ruleset, noRows));
    const sampled = valuesOver(before, ghostBoard, ruleset, TRAP.step).filter(Number.isFinite);
    if (!sampled.length) return false;
    const better = sampled.filter((v) => v > chosen).length / sampled.length;
    return 1 - better >= TRAP.trappedFakeQuality;
  } catch {
    return false;
  }
}
