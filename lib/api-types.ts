// Response shapes shared by the API routes and the browser client. Nothing here
// may carry another player's platform user ID.
import type { Game } from "./engine";

export type Asset = "demo" | "devnet";

export const STAKES = [50_000_000, 100_000_000, 1_000_000_000, 5_000_000_000, 10_000_000_000] as const;

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
  opponent_score: number | null;
  result: MatchResult | null;
  /** Settled profit or loss for this player, in lamports. */
  net: number;
};

export type Leader = { name: string; is_you: number; pnl: number; games: number };

export type LaunchStatus = { mode: string; configured: boolean; mainnetEnabled: boolean; message: string };

export type Snapshot = {
  asset: Asset;
  cashBalance: number;
  launch: LaunchStatus;
  player: { name: string; balance: number } | null;
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
