// Player ranks. Experience comes from devnet SOL wagered on finished competition:
// 1 XP for every 0.01 SOL of entries in settled matches and closed tournaments.
// Gems are free, so they earn no experience. Pure data, shared by the server and
// the browser.

export const RANK_TIERS = ["iron", "bronze", "silver", "gold", "platinum", "diamond", "bouncer"] as const;
export type RankTier = (typeof RANK_TIERS)[number];

/** Lamports of wagered entries per experience point (0.01 SOL). */
export const LAMPORTS_PER_XP = 10_000_000;

export type PlayerLevel = {
  tier: RankTier;
  /** 1 to 3 inside a tier; null for Bouncer, the last rank. */
  division: 1 | 2 | 3 | null;
  /** Display name, e.g. "Gold 2". */
  name: string;
  xp: number;
  /** Experience at which this rank starts. */
  floor: number;
  /** Experience needed for the next rank; null at the top. */
  next: number | null;
  nextName: string | null;
};

const TIER_NAMES: Record<RankTier, string> = {
  iron: "Iron",
  bronze: "Bronze",
  silver: "Silver",
  gold: "Gold",
  platinum: "Platinum",
  diamond: "Diamond",
  bouncer: "Bouncer",
};

/**
 * Experience needed for each rank, lowest first. 100 XP is 1 SOL wagered, so
 * Bronze 1 is 3 SOL, Gold 1 is 35 SOL, Platinum 1 is 100 SOL, Diamond 1 is 300 SOL
 * and Bouncer is 1,000 SOL. Each step asks a little more than the one before.
 */
export const RANKS: { tier: RankTier; division: 1 | 2 | 3 | null; xp: number }[] = [
  { tier: "iron", division: 1, xp: 0 },
  { tier: "iron", division: 2, xp: 50 },
  { tier: "iron", division: 3, xp: 150 },
  { tier: "bronze", division: 1, xp: 300 },
  { tier: "bronze", division: 2, xp: 500 },
  { tier: "bronze", division: 3, xp: 800 },
  { tier: "silver", division: 1, xp: 1_200 },
  { tier: "silver", division: 2, xp: 1_700 },
  { tier: "silver", division: 3, xp: 2_500 },
  { tier: "gold", division: 1, xp: 3_500 },
  { tier: "gold", division: 2, xp: 5_000 },
  { tier: "gold", division: 3, xp: 7_000 },
  { tier: "platinum", division: 1, xp: 10_000 },
  { tier: "platinum", division: 2, xp: 14_000 },
  { tier: "platinum", division: 3, xp: 20_000 },
  { tier: "diamond", division: 1, xp: 30_000 },
  { tier: "diamond", division: 2, xp: 42_000 },
  { tier: "diamond", division: 3, xp: 60_000 },
  { tier: "bouncer", division: null, xp: 100_000 },
];

export const rankName = (tier: RankTier, division: number | null) => (division ? `${TIER_NAMES[tier]} ${division}` : TIER_NAMES[tier]);

export const experienceFromWagered = (lamports: number) => Math.max(0, Math.floor(Number(lamports) / LAMPORTS_PER_XP));

export function levelFor(xpInput: number): PlayerLevel {
  const xp = Math.max(0, Math.floor(Number(xpInput) || 0));
  let i = 0;
  while (i + 1 < RANKS.length && xp >= RANKS[i + 1].xp) i++;
  const rank = RANKS[i];
  const next = RANKS[i + 1] ?? null;
  return {
    tier: rank.tier,
    division: rank.division,
    name: rankName(rank.tier, rank.division),
    xp,
    floor: rank.xp,
    next: next?.xp ?? null,
    nextName: next ? rankName(next.tier, next.division) : null,
  };
}
