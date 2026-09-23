import { database, type Statement } from "@/db/raw";
import { isLockedOut, suspensionMessage } from "./anti-cheat";
import { REFERRAL_FEES } from "./api-types";
import { playerLevel } from "./experience";
import type { PlayerLevel, RankTier } from "./levels";
import { GameError } from "./matches";
import { cashAccountId, ensureCashAccount, HOUSE } from "./payments/accounts";
import { WEEK, weekStart } from "./weekly-race";

// Cashback: part of the house fee, handed back to the players who paid it.
//
// The house keeps 12% of everything wagered, so every point given back here is
// a point of revenue. Three things keep that bounded:
//
// - it is a share of the *fee the player funded*, never of what they wagered,
//   so the cost is legible: 6% of the fee is 6% of the revenue on that player;
// - the share is set by the player's rank, which is earned slowly from lifetime
//   wagering: the bottom three ranks are paid in gems, which cost nothing, and
//   a newcomer with one enormous week is still on the bottom rung;
// - only the period that just ended can be claimed, and only until the next one
//   ends. Nothing accrues forever, and nothing is owed to somebody who left.
//
// A claim row is the lock, as everywhere else money is paid out: the ledger line
// only exists if this call is the one that took the row.

const MONTH_SCOPE = "monthly";
const WEEK_SCOPE = "weekly";
export type RewardScope = typeof WEEK_SCOPE | typeof MONTH_SCOPE;

const SOL = 1_000_000_000;
/** Gems given instead of SOL in the entry tiers: 0.01 SOL of cashback is 500 gems. */
const LAMPORTS_PER_GEM = 20_000;
/** Nothing below this much wagered in the period is worth a claim row. */
const MIN_VOLUME = SOL / 10;
/** However good a week was, one player takes at most this much back. */
const MAX_WEEKLY = 5 * SOL;
const MAX_MONTHLY = 15 * SOL;

/**
 * What comes back, by rank.
 *
 * Rank is earned from everything a player has ever wagered and nothing takes it
 * away (lib/levels.ts), so tying the cashback to it gives the climb a reason
 * beyond the badge: every rank is permanently worth more. It also costs the
 * house less than a grid read off a single week, because a newcomer with one
 * big week is still on the bottom rung.
 */
export const TIERS: { tier: RankTier; share: number; gems: boolean }[] = [
  { tier: "iron", share: 3, gems: true },
  { tier: "bronze", share: 4, gems: true },
  { tier: "silver", share: 5, gems: true },
  { tier: "gold", share: 6, gems: false },
  { tier: "platinum", share: 8, gems: false },
  { tier: "diamond", share: 11, gems: false },
  { tier: "bouncer", share: 14, gems: false },
];

/** The monthly bonus, for coming back rather than for playing big. */
export const MONTHLY = {
  /** Share of the month's fees, on top of the weekly cashback. */
  share: 4,
  /** Distinct weeks of the month a player must have played in to earn it. */
  weeks: 3,
};

export const tierFor = (rank: RankTier) => TIERS.find((t) => t.tier === rank) ?? TIERS[0];

/** UTC month boundaries: the month a moment belongs to, and the one before it. */
export const monthStart = (at: number) => Date.UTC(new Date(at).getUTCFullYear(), new Date(at).getUTCMonth(), 1);
const monthEnd = (start: number) => Date.UTC(new Date(start).getUTCFullYear(), new Date(start).getUTCMonth() + 1, 1);

/** The period that has just ended, which is the only one a player may claim. */
export const lastPeriod = (scope: RewardScope, now: number) =>
  scope === WEEK_SCOPE ? { start: weekStart(now) - WEEK, end: weekStart(now) } : { start: monthStart(monthStart(now) - 1), end: monthStart(now) };

type Window = { start: number; end: number };

/**
 * What a player actually funded of the house fee in a window: 12% of the stakes
 * they put up on settled 1v1 SOL matches, less anything a referral discount
 * already gave back. Cancelled matches are refunded in full, so they never count.
 */
async function funded(uid: string, { start, end }: Window) {
  const db = database();
  const account = cashAccountId(uid);
  const [entries, rebates, weeks] = await Promise.all([
    db
      .prepare(
        `SELECT COALESCE(SUM(-l.amount), 0) AS volume FROM cash_ledger l JOIN matches m ON m.id = l.reference
         WHERE l.account_id = ? AND l.kind = 'match_entry' AND l.created >= ? AND l.created < ?
           AND m.settled = 1 AND m.cancelled = 0`,
      )
      .bind(account, start, end)
      .first<{ volume: number }>(),
    db
      .prepare(
        `SELECT COALESCE(SUM(l.amount), 0) AS given FROM cash_ledger l
         WHERE l.account_id = ? AND l.kind = 'referral_rebate' AND l.amount > 0 AND l.created >= ? AND l.created < ?`,
      )
      .bind(account, start, end)
      .first<{ given: number }>(),
    db
      .prepare(
        `SELECT COUNT(DISTINCT CAST((l.created - ?) / ? AS INTEGER)) AS weeks FROM cash_ledger l JOIN matches m ON m.id = l.reference
         WHERE l.account_id = ? AND l.kind = 'match_entry' AND l.created >= ? AND l.created < ?
           AND m.settled = 1 AND m.cancelled = 0`,
      )
      .bind(weekStart(start), WEEK, account, start, end)
      .first<{ weeks: number }>(),
  ]);
  const volume = Number(entries?.volume ?? 0);
  const fees = Math.max(0, Math.floor((volume * REFERRAL_FEES.standard) / 100) - Number(rebates?.given ?? 0));
  return { volume, fees, weeks: Number(weeks?.weeks ?? 0) };
}

export type Reward = {
  scope: RewardScope;
  period: number;
  endedAt: number;
  /** Claimable until this moment; after it the period is gone. */
  closesAt: number;
  /** What the player gets, in lamports when `asset` is devnet, in whole gems otherwise. */
  amount: number;
  asset: "devnet" | "gems";
  /** The rank that set the share, and the share itself. */
  rank: PlayerLevel;
  share: number;
  claimed: boolean;
};

const gemsFor = (lamports: number) => Math.floor(lamports / LAMPORTS_PER_GEM);

/** One period's cashback, whether or not it has been taken. */
export async function rewardFor(uid: string, scope: RewardScope, now = Date.now()): Promise<Reward | null> {
  const { start, end } = lastPeriod(scope, now);
  const { volume, fees, weeks } = await funded(uid, { start, end });
  if (volume < MIN_VOLUME || fees <= 0) return null;
  const weekly = scope === WEEK_SCOPE;
  if (!weekly && weeks < MONTHLY.weeks) return null;
  // The rank as it stands now, so climbing pays from the next claim on.
  const rank = await playerLevel(uid);
  const tier = tierFor(rank.tier);
  const share = weekly ? tier.share : MONTHLY.share;
  const inGems = tier.gems;
  const lamports = Math.min(weekly ? MAX_WEEKLY : MAX_MONTHLY, Math.floor((fees * share) / 100));
  const amount = inGems ? gemsFor(lamports) : lamports;
  if (amount <= 0) return null;
  const claimed = !!(await database()
    .prepare("SELECT 1 AS yes FROM reward_claims WHERE user_id = ? AND scope = ? AND period = ?")
    .bind(uid, scope, start)
    .first());
  return {
    scope,
    period: start,
    endedAt: end,
    closesAt: scope === WEEK_SCOPE ? end + WEEK : monthEnd(end),
    amount,
    asset: inGems ? "gems" : "devnet",
    rank,
    share,
    claimed,
  };
}

/** Both periods a player could take right now, newest first. */
export async function rewards(uid: string, now = Date.now()) {
  const [week, month] = await Promise.all([rewardFor(uid, WEEK_SCOPE, now), rewardFor(uid, MONTH_SCOPE, now)]);
  return [week, month].filter((r): r is Reward => r !== null);
}

/** How many are waiting, for the badge the rest of the site shows. */
export const rewardsReady = async (uid: string, now = Date.now()) => (await rewards(uid, now)).filter((r) => !r.claimed).length;

/**
 * Pays one period, once. The claim row's key is the player, the scope and the
 * period, so two taps land one payment; the ledger lines only exist if this call
 * is the one that wrote the row.
 */
export async function claimReward(uid: string, scopeInput: unknown, now = Date.now()) {
  const scope = scopeInput === WEEK_SCOPE || scopeInput === MONTH_SCOPE ? scopeInput : null;
  if (!scope) throw new GameError("Unknown reward.", 404);
  if (await isLockedOut(uid)) throw new GameError(await suspensionMessage(uid), 403);
  const reward = await rewardFor(uid, scope, now);
  if (!reward) throw new GameError("There is nothing to claim for that period.", 409);
  if (reward.claimed) throw new GameError("You have already claimed this one.", 409);

  const db = database();
  const reference = `reward:${uid}:${scope}:${reward.period}`;
  const ops: Statement[] = [
    db
      .prepare("INSERT OR IGNORE INTO reward_claims(user_id, scope, period, asset, amount, created) VALUES(?, ?, ?, ?, ?, ?)")
      .bind(uid, scope, reward.period, reward.asset, reward.amount, now),
  ];
  const taken = "FROM reward_claims WHERE user_id = ? AND scope = ? AND period = ? AND created = ?";
  if (reward.asset === "devnet") {
    await Promise.all([ensureCashAccount(uid), ensureCashAccount(HOUSE)]);
    ops.push(
      db
        .prepare(`INSERT INTO cash_ledger(id, account_id, kind, amount, reference, created) SELECT ?, ?, 'cashback', ?, ?, ? ${taken}`)
        .bind(`${reference}:house`, cashAccountId(HOUSE), -reward.amount, reference, now, uid, scope, reward.period, now),
      db
        .prepare(`INSERT INTO cash_ledger(id, account_id, kind, amount, reference, created) SELECT ?, ?, 'cashback', ?, ?, ? ${taken}`)
        .bind(`${reference}:player`, cashAccountId(uid), reward.amount, reference, now, uid, scope, reward.period, now),
    );
  } else {
    ops.push(
      db
        .prepare(`INSERT INTO ledger(id, user_id, match_id, kind, amount, created) SELECT ?, ?, NULL, 'cashback', ?, ? ${taken}`)
        .bind(reference, uid, reward.amount, now, uid, scope, reward.period, now),
    );
  }
  const [claim] = await db.batch(ops);
  if (!claim.meta.changes) throw new GameError("You have already claimed this one.", 409);
  return { ...reward, claimed: true };
}
