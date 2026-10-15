import { divisionIndex, DIVISION_RR } from "./levels";

// The rules of ranked play, as arithmetic. No database here: the browser shows
// these numbers (the rules page, a match's rating change) and the server
// applies them (lib/ranked.ts), so they live where both can read them.
//
// It is Elo. Each player has a rating; before a match, the gap between the two
// says how likely each is to win. Win, and you gain what you were not expected
// to get; lose, and you give up what you were. A favourite who wins gains
// little and one who loses drops a lot — beating a Gold 1 as a Gold 3 is worth
// less than the reverse. The score gap scales it: a narrow result moves the
// ratings as Elo says, a rout moves them by up to half as much again. It is
// read relative to the scores, because one board makes thousands of points and
// another a few hundred.

const MINUTE = 60_000;
const DAY = 86_400_000;
const WEEK = 7 * DAY;

export const RANKED = {
  /** Where a new player's hidden rating starts: the middle of Silver. */
  start: 750,
  /** How far a result moves a rating, and twice that while being placed. */
  k: 32,
  placementK: 64,
  /** Ranked games before a rank shows: five the first time, three in a season after one played. */
  placements: 5,
  returningPlacements: 3,
  /** The score gap's weight: a rout counts this much more than a narrow result. */
  margin: 0.5,
  /** Losses after reaching a division that cannot take the player back out of it. */
  shield: 3,
  /** Bouncer is the best this many, at Diamond 3 or above. */
  bouncers: 50,
  /** Seasons run eight weeks from the first, which began on Monday 12 October 2026. */
  seasonMs: 8 * WEEK,
  epoch: Date.UTC(2026, 9, 12),
  /** A new season pulls every rating this much of the way back to the start. */
  softReset: 0.5,
  /** Past this many ranked matches between the same two players in a day, a match moves nothing. */
  repeatLimit: 2,
  repeatWindowMs: DAY,
  /** From Diamond up, two weeks without a ranked match costs this much a day, never below Diamond 1. */
  decayFloor: 15 * DIVISION_RR,
  decayIdleMs: 14 * DAY,
  decayPerDay: 25,
  /**
   * Who an open seat may be taken by, by how long it has waited: tiers either
   * side of the player who opened it. Matches are played in each player's own
   * time, so a seat can wait — but it should not wait for ever.
   */
  widen: [
    { afterMs: 0, tiers: 1 },
    { afterMs: 15 * MINUTE, tiers: 2 },
    { afterMs: 60 * MINUTE, tiers: 6 },
  ],
  /** The house's players hold a fixed rating by skill: Bronze, Gold, Platinum. */
  bots: { rookie: 450, steady: 950, sharp: 1450 } as Record<string, number>,
};

export const seasonAt = (now: number) => Math.max(1, Math.floor((now - RANKED.epoch) / RANKED.seasonMs) + 1);
export const seasonStart = (season: number) => RANKED.epoch + (season - 1) * RANKED.seasonMs;
export const seasonEnd = (season: number) => seasonStart(season + 1);

/** The chance Elo gives a player of beating an opponent. */
export const expectedScore = (rating: number, opponent: number) => 1 / (1 + 10 ** ((opponent - rating) / 400));

/** How one-sided a result was, 0 (level) to 1 (the loser scored nothing). */
export const scoreGap = (score: number, other: number) => Math.abs(score - other) / Math.max(score, other, 1);

/**
 * RR won or lost in one ranked match. `result` is 1 for a win, 0 for a loss
 * and ½ for a draw, which moves nobody. A win is always worth at least one
 * point and a loss always costs one.
 */
export function ratingChange({ rating, opponent, result, score, opponentScore, placement }: { rating: number; opponent: number; result: 0 | 0.5 | 1; score: number; opponentScore: number; placement: boolean }) {
  if (result === 0.5) return 0;
  const k = placement ? RANKED.placementK : RANKED.k;
  const weight = 1 + RANKED.margin * scoreGap(score, opponentScore);
  const delta = Math.round(k * weight * (result - expectedScore(rating, opponent)));
  return result === 1 ? Math.max(1, delta) : Math.min(-1, delta);
}

/**
 * A rating after a change, with the promotion shield: reaching a new division
 * arms it, and while it lasts each loss uses one charge and cannot take the
 * player below the division's floor.
 */
export function withShield(before: number, delta: number, shield: number) {
  let after = Math.max(0, before + delta);
  let left = shield;
  if (delta < 0 && left > 0) {
    left--;
    const floor = divisionIndex(before) * DIVISION_RR;
    if (after < floor) after = floor;
  }
  if (divisionIndex(after) > divisionIndex(before)) left = RANKED.shield;
  return { after, shield: left };
}

/** Where a player starts a season from the one before. */
export const softReset = (rating: number) => Math.round(RANKED.start + (rating - RANKED.start) * RANKED.softReset);

/** Tiers either side an open seat accepts, after waiting `ageMs`. */
export const tierReach = (ageMs: number) => RANKED.widen.filter((step) => ageMs >= step.afterMs).at(-1)?.tiers ?? 1;
