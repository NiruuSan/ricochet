// Response shapes and game economics shared by the API routes and the browser
// client. Nothing here may carry another player's platform user ID.
import type { Game } from "./engine";

/** `gems` is the free in-game currency; `devnet` is Solana test-network SOL, in lamports. */
export type Asset = "gems" | "devnet";

export const STARTING_GEMS = 2000;

/** Gems the winner of a devnet SOL match receives on top of the SOL payout. */
export const SOL_WIN_GEM_BONUS = 100;

/** Smallest devnet deposit swept into the pool (0.001 SOL), in lamports. */
export const MIN_DEPOSIT = 1_000_000;

/** Entry amounts per currency: whole gems, or lamports for devnet SOL. */
export const STAKES: Record<Asset, readonly number[]> = {
  gems: [25, 50, 100, 500, 1000],
  devnet: [50_000_000, 100_000_000, 1_000_000_000, 5_000_000_000, 10_000_000_000],
};

export const isStake = (asset: Asset, stake: number) => STAKES[asset].includes(stake);

// Gem matches are fee-free. Devnet fees are the part of the pot not paid out.
export const winnerPayout = (stake: number, asset: Asset) => asset === "gems" ? stake * 2 : Math.floor((stake * 176) / 100); // 88% of both entries
export const winnerFee = (stake: number, asset: Asset) => stake * 2 - winnerPayout(stake, asset); // 12% of both entries
export const cancelRefund = (stake: number, asset: Asset) => asset === "gems" ? stake : Math.floor((stake * 88) / 100); // entry minus the 12% fee

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
  /** Boards fully cleared so far. */
  clears: number;
  /** Set when this is a tournament run rather than a 1v1 match. */
  tournamentId?: string;
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

export type Profile = { publicId: string; name: string; balance: number; avatar: string | null; created: number };
export type PublicPlayerProfile = {
  publicId: string;
  name: string;
  avatar: string | null;
  created: number;
  isYou: boolean;
  stats: Record<Asset, { pnl: number; games: number; wins: number }>;
};
export type TipReceipt = { id: string; amount: number; recipient: string; created: number };
export type PnlRange = "day" | "week" | "month" | "year" | "all";
export type ProfileMatch = {
  id: string; stake: number; created: number; settled: number;
  opponent: string | null; opponentAvatar: string | null;
  result: MatchResult | null; net: number; ended: number;
  /** Set when the row is a tournament entry; `id` is then the tournament's ID and `stake` its entry fee. */
  tournament: { name: string; status: TournamentStatus; rank: number | null; players: number } | null;
  /** Spectator link to this player's run: joined matches and started tournament runs. */
  watchId: string | null;
};
export type ProfilePerformance = {
  asset: Asset; generated: number; openEntries: number; bestWin: number; played: number;
  history: ProfileMatch[];
  series: Record<PnlRange, { total: number; points: { at: number; value: number }[] }>;
};

/** One player's side of a finished run, for the end-of-match screen. */
export type RecapSide = { name: string; avatar: string | null; score: number; balls: number; clears: number; rounds: number; forfeit: boolean; board: Game };

export type MatchRecap = {
  matchId: string;
  asset: Asset;
  stake: number;
  /**
   * playing: your run is not over. waiting: nobody has taken the second seat.
   * opponent_playing: your opponent has not finished. settled: final result known.
   */
  status: "playing" | "waiting" | "opponent_playing" | "settled";
  result: MatchResult | null;
  /** Profit or loss once settled, in the match currency's units. */
  net: number | null;
  /** Gems awarded for winning this devnet SOL match. */
  bonusGems: number;
  you: RecapSide;
  /** The opponent's stats appear only once the match has settled; scores stay hidden until both finish. */
  opponent: { name: string; avatar: string | null; stats: RecapSide | null } | null;
};

export type MatchNotification = {
  matchId: string;
  asset: Asset;
  stake: number;
  result: Exclude<MatchResult, "cancelled">;
  net: number;
  opponent: string | null;
  score: number;
  opponentScore: number;
  /** Gems won alongside a devnet SOL win; absent on older notifications. */
  bonusGems?: number;
};
export type TipNotification = { amount: number; from: string };
export type TournamentNotification = {
  tournamentId: string;
  name: string;
  asset: Asset;
  /** Null when the entrant did not play, or the tournament was cancelled. */
  rank: number | null;
  players: number;
  payout: number;
  /** An entry fee returned because the tournament was cancelled or nobody played. */
  refund: number;
};

export type NotificationItem = { id: string; created: number; read: boolean } & (
  | { kind: "match_result"; data: MatchNotification }
  | { kind: "tip_received"; data: TipNotification }
  | { kind: "tournament_result"; data: TournamentNotification }
);

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
  notifications: NotificationItem[];
  unreadNotifications: number;
  /** The player's tournament entries in this currency, newest first. */
  tournaments: TournamentHistoryItem[];
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
export type VolumePoint = { start: number; end: number; value: number };
export type VolumeTotals = PeriodTotals & { series: Record<Period, VolumePoint[]> };

export type AdminOverview = {
  players: { registered: number; online: number; offline: number; onlineNames: { name: string; avatar: string | null }[] };
  devnet: { entries: VolumeTotals; matches: VolumeTotals; deposits: VolumeTotals; withdrawals: VolumeTotals; fees: VolumeTotals };
  gems: { entries: VolumeTotals; matches: VolumeTotals; fees: VolumeTotals };
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

/** How a tournament pot is split. Shares are percentages by rank, strictly decreasing. */
export type PayoutPreset = "winner" | "top3" | "top10";
export const PAYOUT_SHARES: Record<PayoutPreset, readonly number[]> = {
  winner: [100],
  top3: [50, 30, 20],
  top10: [20, 17, 14, 12, 10, 8, 7, 5, 4, 3],
};
/** The house keeps this share of paid tournament entries, as it does for matches. */
export const TOURNAMENT_FEE_PERCENT: Record<Asset, number> = { devnet: 12, gems: 0 };

/** registration: before the start. live: runs can be played. closing: ended, not paid out yet. */
export type TournamentStatus = "registration" | "live" | "closing" | "settled" | "cancelled";

export type TournamentYou = { score: number; done: boolean; started: boolean; rank: number | null; payout: number };

export type TournamentSummary = {
  id: string;
  name: string;
  asset: Asset;
  /** 0 for a free tournament. */
  entryFee: number;
  payout: PayoutPreset;
  places: number;
  entrants: number;
  /** The pot as it stands: paid by the house, or entries after the house share. */
  pot: number;
  /** The pot once every place is taken. */
  maxPot: number;
  startsAt: number;
  endsAt: number;
  status: TournamentStatus;
  /** The signed-in player's entry, if registered. */
  you: TournamentYou | null;
};

export type TournamentStanding = {
  rank: number | null;
  name: string;
  avatar: string | null;
  score: number;
  done: boolean;
  started: boolean;
  payout: number;
  isYou: boolean;
  /** Set when the viewer may watch this run. */
  watchId: string | null;
};

export type TournamentDetail = TournamentSummary & {
  /** Amount per rank if the tournament ended now with every ranked player distinct. */
  prizes: number[];
  standings: TournamentStanding[];
};

/** One of a player's tournament entries, shown alongside their matches. */
export type TournamentHistoryItem = {
  id: string;
  name: string;
  entryFee: number;
  status: TournamentStatus;
  registered: number;
  /** When the tournament ended, or is scheduled to. */
  ended: number;
  score: number;
  started: boolean;
  done: boolean;
  /** Final rank; null until paid out, or when the player never played. */
  rank: number | null;
  /** Entrants who played a run. */
  players: number;
  payout: number;
  /** Prize and refunds minus the entry, once paid out or cancelled; 0 before. */
  net: number;
  /** Spectator link to this run, once it has started. */
  watchId: string | null;
};

/** A shot as spectators see it: the run revision it was taken from, and its angle (null for a forfeit). */
export type WatchShot = { revision: number; angle: number | null };

/** One player's run in a match, for switching sides while watching. */
export type WatchSide = { watchId: string; name: string; avatar: string | null; score: number; done: boolean; isYou: boolean };

/** A match or tournament run opened in spectator mode. Never carries player IDs. */
export type WatchData = {
  watchId: string;
  kind: "match" | "tournament";
  asset: Asset;
  ruleset: number;
  /** Match entry, or tournament entry fee. */
  stake: number;
  tournament: { id: string; name: string } | null;
  player: { name: string; avatar: string | null; isYou: boolean };
  state: Game;
  revision: number;
  score: number;
  done: boolean;
  forfeit: boolean;
  /** The match is settled or the tournament has closed. */
  final: boolean;
  /** The board before the first shot. */
  start: Game;
  /** Logged shots from the requested revision on, in order. */
  shots: WatchShot[];
  /** Every shot since the start is logged, so the run can be replayed from the beginning. */
  replayable: boolean;
  /** Both runs of a match, when the viewer may watch them; empty for tournaments. */
  sides: WatchSide[];
};

/** A run being played right now, for the lobby's Live now list. */
export type LiveGame = {
  watchId: string;
  kind: "match" | "tournament";
  asset: Asset;
  name: string;
  avatar: string | null;
  score: number;
  round: number;
  stake: number;
  /** The tournament name, or the opponent's name for a match. */
  context: string;
};

/** One of the player's recently finished games, for the arena. */
export type RecentGame = {
  kind: "match" | "tournament";
  /** The match ID, or the tournament ID. */
  id: string;
  asset: Asset;
  /** The opponent's name, or the tournament name. */
  title: string;
  avatar: string | null;
  /** "waiting" until the opponent finishes or the tournament closes. */
  outcome: "win" | "loss" | "draw" | "cancelled" | "waiting";
  rank: number | null;
  players: number | null;
  score: number;
  opponentScore: number | null;
  net: number | null;
  watchId: string | null;
  at: number;
};

/** The best run started in the last 24 hours. */
export type BestRun = { name: string; avatar: string | null; score: number; asset: Asset; context: string; watchId: string };

/** Everything the arena lobby shows below the game modes. */
export type ArenaOverview = {
  tournament: TournamentSummary | null;
  recent: RecentGame[];
  online: number;
  /** Open seats by currency and entry, not counting the viewer's own. */
  openSeats: Record<Asset, Record<number, number>>;
  bestToday: BestRun | null;
  live: LiveGame[];
};

export type AdminTournament = TournamentSummary & { played: number; finished: number };
