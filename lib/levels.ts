// Two ladders, kept apart on purpose. Pure data, shared by the server and the
// browser.
//
// The account level is everything a player has ever staked: 1 XP for every
// 0.1 SOL of entries in settled matches and closed tournaments. Gems are free,
// so they earn none. It only ever goes up, and it is what sets the cashback
// (lib/rewards.ts): a share of the fee, once reached, is kept for good.
//
// The rank is how well a player plays this season: a rating won and lost in
// ranked SOL matches (lib/ranked.ts), shown as the insignia from Iron 1 to
// Diamond 3, with Bouncer for the fifty best. It starts again every season.

export const RANK_TIERS = ["iron", "bronze", "silver", "gold", "platinum", "diamond", "bouncer"] as const;
export type RankTier = (typeof RANK_TIERS)[number];

/** Lamports of wagered entries per experience point (0.1 SOL). */
export const LAMPORTS_PER_XP = 100_000_000;

const TIER_NAMES: Record<RankTier, string> = {
  iron: "Iron",
  bronze: "Bronze",
  silver: "Silver",
  gold: "Gold",
  platinum: "Platinum",
  diamond: "Diamond",
  bouncer: "Bouncer",
};

export const rankName = (tier: RankTier, division: number | null) => (division ? `${TIER_NAMES[tier]} ${division}` : TIER_NAMES[tier]);

export const experienceFromWagered = (lamports: number) => Math.max(0, Math.floor(Number(lamports) / LAMPORTS_PER_XP));

// ------------------------------------------------------------ account level

/** The last level. */
export const LEVEL_CAP = 60;

/**
 * XP at levels 1, 10, 20, 30, 40, 50 and 60. These are the points where the
 * cashback steps up (lib/rewards.ts), and they are exactly where the old ranks
 * started, so nobody's share changed when the levels came in: 5 SOL staked is
 * level 10, 40 SOL level 20, 300 SOL level 30, 2,500 SOL level 40, 20,000 SOL
 * level 50 and 100,000 SOL level 60.
 */
const MILESTONES = [0, 50, 400, 3_000, 25_000, 200_000, 1_000_000];

/** XP at which `level` starts: even steps to level 10, then a steady ratio within each ten. */
export function levelStart(level: number) {
  const l = Math.max(1, Math.min(LEVEL_CAP, Math.floor(level)));
  if (l <= 10) return Math.round((MILESTONES[1] * (l - 1)) / 9);
  const band = Math.min(5, Math.floor(l / 10));
  const from = MILESTONES[band];
  const to = MILESTONES[band + 1];
  return Math.round(from * Math.pow(to / from, (l - band * 10) / 10));
}

export type AccountLevel = {
  level: number;
  xp: number;
  /** XP at which this level started, and the next one starts; null at the cap. */
  floor: number;
  next: number | null;
};

/**
 * The cashback each level earns (lib/rewards.ts pays it). The steps fall exactly
 * where the old ranks started — level 10 is 5 SOL staked, level 30 is 300 SOL,
 * level 60 is 100,000 — so nobody's share moved when levels replaced them. The
 * first three are paid in gems, which cost the house nothing. A level only goes
 * up, so every step reached is kept for good.
 */
export const CASHBACK_STEPS: { from: number; share: number; gems: boolean }[] = [
  { from: 1, share: 3, gems: true },
  { from: 10, share: 4, gems: true },
  { from: 20, share: 5, gems: true },
  { from: 30, share: 6, gems: false },
  { from: 40, share: 8, gems: false },
  { from: 50, share: 11, gems: false },
  { from: 60, share: 14, gems: false },
];
export const cashbackFor = (level: number) => [...CASHBACK_STEPS].reverse().find((step) => level >= step.from) ?? CASHBACK_STEPS[0];

export function accountLevelFor(xpInput: number): AccountLevel {
  const xp = Math.max(0, Math.floor(Number(xpInput) || 0));
  let level = 1;
  while (level < LEVEL_CAP && xp >= levelStart(level + 1)) level++;
  return { level, xp, floor: levelStart(level), next: level < LEVEL_CAP ? levelStart(level + 1) : null };
}

// ------------------------------------------------------------- ranked rank

/** Rating points (RR) in one division. */
export const DIVISION_RR = 100;

/**
 * Where each division starts, in RR: Iron 1 at 0, a hundred more for each
 * division, Diamond 3 from 1,700 up. Bouncer is not a threshold but a place —
 * the fifty best this season at Diamond 3 or above (lib/ranked.ts) — so it is
 * listed at Diamond 3's floor, the least it takes.
 */
export const RANKS: { tier: RankTier; division: 1 | 2 | 3 | null; rating: number }[] = [
  ...(["iron", "bronze", "silver", "gold", "platinum", "diamond"] as const).flatMap((tier, t) =>
    ([1, 2, 3] as const).map((division) => ({ tier, division, rating: (t * 3 + division - 1) * DIVISION_RR })),
  ),
  { tier: "bouncer", division: null, rating: 17 * DIVISION_RR },
];
export const BOUNCER_FLOOR = 17 * DIVISION_RR;

export type PlayerRank = {
  /** "unranked" until the placement games are played. */
  tier: RankTier | "unranked";
  division: 1 | 2 | 3 | null;
  /** e.g. "Gold 2", "Bouncer", "Unranked". */
  name: string;
  rating: number;
  /** RR into the division, 0–99 (past 100 only at Diamond 3 and Bouncer). */
  points: number;
  placed: boolean;
  placementsLeft: number;
  /** Place among this season's ranked players, when among the best fifty. */
  position: number | null;
  season: number;
};

/** The division a rating falls in, from 0 (Iron 1) to 17 (Diamond 3). */
export const divisionIndex = (rating: number) => Math.max(0, Math.min(17, Math.floor(Math.max(0, rating) / DIVISION_RR)));
/** Tier index, 0 (Iron) to 5 (Diamond), and 6 for Bouncer. */
export const tierIndex = (rating: number, bouncer = false) => (bouncer ? 6 : Math.floor(divisionIndex(rating) / 3));

/** The rank a rating reads as. `position` is the player's place when among the best fifty. */
export function rankFor(rating: number, { placementsLeft = 0, position = null, season = 1, bouncer = false }: { placementsLeft?: number; position?: number | null; season?: number; bouncer?: boolean } = {}): PlayerRank {
  const r = Math.max(0, Math.round(rating));
  const placed = placementsLeft <= 0;
  if (!placed) return { tier: "unranked", division: null, name: "Unranked", rating: r, points: 0, placed, placementsLeft, position: null, season };
  if (bouncer) return { tier: "bouncer", division: null, name: "Bouncer", rating: r, points: r - BOUNCER_FLOOR, placed, placementsLeft: 0, position, season };
  const index = divisionIndex(r);
  const { tier, division } = RANKS[index];
  return { tier, division, name: rankName(tier, division), rating: r, points: r - index * DIVISION_RR, placed, placementsLeft: 0, position, season };
}
