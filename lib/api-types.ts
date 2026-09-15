// Response shapes and game economics shared by the API routes and the browser
// client. Nothing here may carry another player's platform user ID.
import type { Game } from "./engine";

/** `gems` is the free in-game currency; `devnet` is Solana test-network SOL, in lamports. */
export type Asset = "gems" | "devnet";

export const STARTING_GEMS = 2000;

/** Smallest devnet deposit swept into the pool (0.001 SOL), in lamports. */
export const MIN_DEPOSIT = 1_000_000;

/** Entry amounts per currency: whole gems, or lamports for devnet SOL. */
export const STAKES: Record<Asset, readonly number[]> = {
  gems: [25, 50, 100, 500, 1000],
  devnet: [50_000_000, 100_000_000, 1_000_000_000, 5_000_000_000, 10_000_000_000],
};

export const isStake = (asset: Asset, stake: number) => STAKES[asset].includes(stake);

// Economics, as fractions of one entry. Every current stake gives exact
// integers; rounding down only matters for legacy gem matches, and the fee is
// always whatever the payout leaves, so nothing is created or lost.
export const winnerPayout = (stake: number) => Math.floor((stake * 176) / 100); // 88% of both entries
export const winnerFee = (stake: number) => stake * 2 - winnerPayout(stake); // 12% of both entries
export const cancelRefund = (stake: number) => Math.floor((stake * 88) / 100); // entry minus the 12% fee

export type Run = {
  id: string;
  match_id: string;
  asset: Asset;
  ruleset: number;
  state: Game;
  revision: number;
  score: number;
  done: number;
  forfeit: number;
};

export type MatchResult = "win" | "loss" | "draw" | "cancelled";

export type MatchSummary = {
  id: string;
  run_id: string;
  stake: number;
  settled: number;
  created: number;
  score: number;
  done: number;
  forfeit: number;
  /** 1 once a second player has taken the open seat. */
  joined: number;
  opponent: string | null;
  opponent_avatar: string | null;
  opponent_score: number | null;
  result: MatchResult | null;
  /** Settled profit or loss for this player, in the match currency's units. */
  net: number;
};

export type Leader = { name: string; avatar: string | null; is_you: number; pnl: number; games: number };

export type LaunchStatus = { mode: string; configured: boolean; mainnetEnabled: boolean; message: string };

export type Profile = { name: string; balance: number; avatar: string | null; created: number };

export type Snapshot = {
  asset: Asset;
  cashBalance: number;
  launch: LaunchStatus;
  player: Profile | null;
  matches: MatchSummary[];
  transactions: { kind: string; amount: number; created: number }[];
  leaders: Leader[];
  active: Run | null;
  isAdmin: boolean;
};

export type Transfer = {
  id: string;
  kind: string;
  amount: number;
  fee: number;
  destination: string;
  signature: string;
  status: string;
  error: string | null;
  created: number;
};

export type Period = "day" | "week" | "month";
export type PeriodTotals = Record<Period, number>;

export type AdminOverview = {
  players: { registered: number; online: number; offline: number; onlineNames: { name: string; avatar: string | null }[] };
  devnet: { entries: PeriodTotals; matches: PeriodTotals; deposits: PeriodTotals; withdrawals: PeriodTotals; fees: PeriodTotals };
  gems: { entries: PeriodTotals; matches: PeriodTotals; fees: PeriodTotals };
  generated: number;
};

export type TreasurySnapshot = {
  configured: boolean;
  network: string;
  /** Earned house fees plus treasury deposits, minus treasury withdrawals. */
  balance: number;
  /** What the pool owes: player balances and match pots in escrow. */
  playerBalances: number;
  escrow: number;
  /** On-chain balance of the shared pool wallet, or null when the RPC could not be read. */
  poolOnChain: number | null;
  poolAddress: string | null;
  /** Treasury deposit address and SOL waiting there to be credited. */
  address: string | null;
  detected: number;
  transfers: Transfer[];
  open: Transfer[];
};
