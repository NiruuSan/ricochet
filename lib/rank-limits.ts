// Tournaments limited by rank. Pure data, shared by the server and the browser.
//
// A limit is a step on the ranked ladder: Iron 1 is 0, each division one more,
// Diamond 3 is 17 and Bouncer 18. A tournament may set a lowest step, a highest
// one, both or neither. The rank that counts is the one the player holds when
// they register: a player who climbs past a cup's highest rank afterwards keeps
// their seat. A player still playing their placement matches has no rank yet,
// so no limited cup takes them.

import { divisionIndex, RANKS, rankName, type PlayerRank, type RankTier } from "./levels";

export const RANK_STEPS = RANKS.map((rank, step) => ({ step, tier: rank.tier as RankTier, division: rank.division, name: rankName(rank.tier, rank.division) }));
/** Bouncer, the last step. */
export const TOP_STEP = RANK_STEPS.length - 1;

export type RankLimits = { min: number | null; max: number | null };
export const NO_LIMITS: RankLimits = { min: null, max: null };

export const isLimited = (limits: RankLimits | null | undefined) => !!limits && (limits.min !== null || limits.max !== null);

/** Where a rank stands on the ladder; null before the placement matches are played. */
export function rankStep(rank: PlayerRank | null | undefined): number | null {
  if (!rank || !rank.placed || rank.tier === "unranked") return null;
  return rank.tier === "bouncer" ? TOP_STEP : divisionIndex(rank.rating);
}

const tierName = (step: number) => rankName(RANK_STEPS[step].tier, null);
/** A lowest rank in words: a tier's first division reads as the tier. */
const from = (step: number) => (RANK_STEPS[step].division === 1 ? tierName(step) : RANK_STEPS[step].name);
/** A highest rank in words: a tier's last division reads as the tier. */
const upTo = (step: number) => (RANK_STEPS[step].division === 3 || step === TOP_STEP ? tierName(step) : RANK_STEPS[step].name);

/** "Gold – Platinum", "Silver and above", "Up to Bronze 2", "Bouncers only"; null for an open cup. */
export function rankLimitLabel(limits: RankLimits | null | undefined): string | null {
  if (!limits || !isLimited(limits)) return null;
  const { min, max } = limits;
  if (min === TOP_STEP) return "Bouncers only";
  if ((min ?? 0) === 0 && (max ?? TOP_STEP) === TOP_STEP) return "Ranked players only";
  if (min !== null && max !== null) {
    if (min === max) return `${RANK_STEPS[min].name} only`;
    if (RANK_STEPS[min].tier === RANK_STEPS[max].tier && RANK_STEPS[min].division === 1 && RANK_STEPS[max].division === 3) return `${tierName(min)} only`;
    return `${from(min)} – ${upTo(max)}`;
  }
  return min !== null ? `${from(min)} and above` : `Up to ${upTo(max!)}`;
}

/** Why this rank may not enter, in words for the player; null when it may. */
export function rankBlock(rank: PlayerRank | null | undefined, limits: RankLimits | null | undefined): string | null {
  if (!limits || !isLimited(limits)) return null;
  const label = rankLimitLabel(limits)!;
  const step = rankStep(rank);
  if (step === null) return `This cup is for ranked players (${label}). Finish your placement matches to enter it.`;
  if ((limits.min !== null && step < limits.min) || (limits.max !== null && step > limits.max)) return `This cup is for ${label}, and you are ${rank!.name}.`;
  return null;
}
