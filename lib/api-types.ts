// Response shapes and game economics shared by the API routes and the browser
// client. Nothing here may carry another player's platform user ID.
import type { Game } from "./engine";
import type { Fairness } from "./fairness";
import type { PlayerLevel } from "./levels";

export type { PlayerLevel, RankTier } from "./levels";

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

/** What each side funds of the house fee, and what a referred player funds instead. */
export const REFERRAL_FEES = { standard: 12, discounted: 8 } as const;

/**
 * What a player on a reduced fee gets back after a match at this entry, win or
 * lose. The match itself settles exactly as it would without any of it: this is
 * the house handing back part of the fee it just took (lib/referrals.ts), so
 * the same arithmetic serves the lobby, the result screen and the ledger.
 */
export function feeRebate(stake: number, asset: Asset) {
  if (asset !== "devnet" || stake <= 0) return 0;
  const funded = Math.floor(winnerFee(stake, asset) / 2);
  return Math.floor((funded * (REFERRAL_FEES.standard - REFERRAL_FEES.discounted)) / REFERRAL_FEES.standard);
}
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
  /** Signs this run's shot reports (lib/shot-key.ts). Only ever sent to the run's player. */
  shotKey?: string;
  /** Removes the ghost bricks from `state` together with `shotKey` (lib/ghost-bricks.ts). */
  sync?: number;
  /** Set on a private match: the code its challenge link carries. */
  invite?: string | null;
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

export type Leader = { name: string; avatar: string | null; is_you: number; pnl: number; games: number; level: PlayerLevel };

export type LaunchStatus = { mode: string; configured: boolean; mainnetEnabled: boolean; message: string };

export type Profile = { publicId: string; name: string; balance: number; avatar: string | null; created: number; level: PlayerLevel };
export type PublicPlayerProfile = {
  publicId: string;
  name: string;
  avatar: string | null;
  created: number;
  isYou: boolean;
  /** Rank from devnet SOL wagered; public. */
  level: PlayerLevel;
  stats: Record<Asset, { pnl: number; games: number; wins: number }>;
  /** Where the viewer stands with this player; null when nobody is signed in. */
  friendship: Friendship | null;
};

/** What the viewer may do about this player, decided before they press anything. */
export type Friendship = "none" | "friends" | "sent" | "incoming" | "blocked";
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
/** Finished competition only: settled matches and paid-out tournaments, in one currency. */
export type ProfileStats = {
  matches: {
    played: number; wins: number; losses: number; draws: number;
    /** Wins over settled matches, 0–1; null before the first one. */
    winRate: number | null;
    /** Positive: consecutive wins up to the latest match; negative: consecutive losses. */
    streak: number;
    bestWinStreak: number;
  };
  runs: { played: number; bestScore: number; averageScore: number | null; bestRound: number; clears: number };
  tournaments: { played: number; wins: number; podiums: number; bestRank: number | null };
};

export type ProfilePerformance = {
  asset: Asset; generated: number; openEntries: number; bestWin: number; played: number;
  stats: ProfileStats;
  history: ProfileMatch[];
  series: Record<PnlRange, { total: number; points: { at: number; value: number }[] }>;
};

/** One player's side of a finished run, for the end-of-match screen. */
export type RecapSide = { name: string; avatar: string | null; level?: PlayerLevel; score: number; balls: number; clears: number; rounds: number; forfeit: boolean; board: Game };

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
  /** Lamports the house gave back on a reduced fee, win or lose. */
  rebate: number;
  you: RecapSide;
  /** The opponent's stats appear only once the match has settled; scores stay hidden until both finish. */
  opponent: { name: string; avatar: string | null; level: PlayerLevel; stats: RecapSide | null } | null;
};

export type MatchNotification = {
  matchId: string;
  asset: Asset;
  stake: number;
  /** "cancelled": an administrator closed the match and returned the entries. */
  result: MatchResult;
  net: number;
  opponent: string | null;
  score: number;
  opponentScore: number;
  /** Gems won alongside a devnet SOL win; absent on older notifications. */
  bonusGems?: number;
  /** Lamports handed back because this player is on a reduced house fee. */
  rebate?: number;
  /** Set when the match ended because a player was disqualified for automated play: true if it was the opponent. */
  disqualified?: boolean;
  /** Why an administrator cancelled the match. */
  reason?: string;
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

export type RaceNotification = { weekStart: number; rank: number; score: number; sol: number; gems: number };

/** One player's best score of the week. `watchId` links the run when others may watch it. */
export type RaceEntry = { rank: number; name: string; avatar: string | null; score: number; at: number; watchId: string | null };
/** A place's prize: SOL in lamports and gems. */
export type RacePrize = { sol: number; gems: number };
export type RaceWinner = RaceEntry & RacePrize;
export type WeeklyRace = {
  weekStart: number;
  weekEnd: number;
  prizes: RacePrize[];
  standings: RaceEntry[];
  /** Last week's top 3: paid, or awaiting the administrator's review. */
  previous: { weekStart: number; weekEnd: number; paid: boolean; winners: RaceWinner[] } | null;
  generated: number;
};
export type AdminRaceWeek = {
  weekStart: number;
  weekEnd: number;
  ended: boolean;
  standings: RaceEntry[];
  excluded: { name: string; reason: string }[];
  paid: { at: number; winners: RaceWinner[] } | null;
};

export type NotificationItem = { id: string; created: number; read: boolean } & (
  | { kind: "match_result"; data: MatchNotification }
  | { kind: "tip_received"; data: TipNotification }
  | { kind: "tournament_result"; data: TournamentNotification }
  | { kind: "security_reset"; data: { holdUntil: number } }
  | { kind: "security_alert"; data: SecurityAlertNotification }
  | { kind: "race_result"; data: RaceNotification }
  | { kind: "account_suspended"; data: { reason: string } }
  | { kind: "challenge"; data: ChallengeNotification }
  | { kind: "referral_joined"; data: { name: string; level: number } }
  | { kind: "referral_partner"; data: { level: number } }
  | { kind: "friend_request"; data: { name: string } }
  | { kind: "friend_accepted"; data: { name: string } }
);

/**
 * Something changed on the account's own protection, or money left it. These
 * are the events a player must see even when they did not cause them.
 */
export type SecurityAlertNotification = {
  event: "two_factor_disabled" | "recovery_codes_replaced" | "withdrawal_started" | "tip_sent" | "signed_out_everywhere";
  /** Lamports, for the events that moved money. */
  amount?: number;
  /** The player or address the money went to. */
  to?: string;
};

/** What a report is about. */
export type ReportKind = "cheating" | "harassment" | "spam" | "other";
export type BlockedPlayer = { name: string; avatar: string | null; since: number };
/** A report as the administrator sees it: names only, never player IDs. */
export type ReportRow = {
  id: string;
  reporter: string | null;
  target: string | null;
  kind: ReportKind;
  detail: string;
  created: number;
  status: string;
  note: string | null;
  reviewedAt: number | null;
  /** How many reports this player has had against them, all time. */
  against: number;
};

/** The longest message a friend can send; anything past it is cut, not refused. */
export const MESSAGE_MAX = 500;

/** A friend, or someone waiting on an answer either way. */
export type Friend = {
  name: string;
  avatar: string | null;
  online: boolean;
  /** When the link was made, or the request sent. */
  since: number;
  unread: number;
  lastMessage: string | null;
  lastAt: number | null;
};
export type FriendList = { friends: Friend[]; incoming: Friend[]; outgoing: Friend[]; blocked: BlockedPlayer[] };
export type FriendMessage = { id: string; mine: boolean; body: string; created: number };

/** One line of the administrator's referral roster. */
export type AdminReferral = {
  name: string;
  level: number;
  code: string | null;
  joined: number;
  earned: number;
  pending: number;
  /** All-time match fees attributable to referred players, net of rebates and commissions, in lamports. */
  siteEarned: number;
};

/** A player's own referral standing: their code, their window, and what it brought in. */
export type ReferralSummary = {
  code: string;
  /** 1: an ordinary code. 2: a partnership, which pays a share of the house fee. */
  level: number;
  /** While this is in the future, this player's house fee is reduced. */
  discountUntil: number | null;
  referredBy: string | null;
  joined: number;
  /** Lamports earned as a partner, all time, claimed or not. */
  earned: number;
  /** Lamports waiting to be claimed into the spendable balance. */
  pending: number;
};

/** A private match opened for one player: its link is the code. */
export type ChallengeNotification = { matchId: string; invite: string; asset: Asset; stake: number; from: string };

export type Snapshot = {
  /** Friend requests waiting for an answer, and messages waiting to be read. */
  friends?: { requests: number; unread: number };
  asset: Asset;
  cashBalance: number;
  launch: LaunchStatus;
  player: Profile | null;
  matches: MatchSummary[];
  active: Run | null;
  isAdmin: boolean;
  notifications: NotificationItem[];
  unreadNotifications: number;
  /** The player's tournament entries in this currency, newest first. */
  tournaments: TournamentHistoryItem[];
  /** Set while the account is suspended or banned by the anti-cheat. */
  suspension: { reason: string } | null;
  /** The free daily gems: what today pays, and whether it is still to claim. */
  daily: DailyGems;
  /** While this is in the future, this player funds a reduced house fee. */
  discountUntil: number | null;
};

/** The free gems a player can claim once a day (lib/daily.ts). */
export type DailyGems = {
  ready: boolean;
  streak: number;
  amount: number;
  nextAt: number;
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
  growth: AdminGrowth;
  players: { registered: number; online: number; offline: number; onlineNames: { name: string; avatar: string | null }[] };
  devnet: { entries: VolumeTotals; matches: VolumeTotals; deposits: VolumeTotals; withdrawals: VolumeTotals; fees: VolumeTotals };
  gems: { entries: VolumeTotals; matches: VolumeTotals; fees: VolumeTotals };
  generated: number;
};

export type AdminGrowth = {
  trackedSince: number;
  active: { day: number; week: number; month: number };
  retention: { day: number; eligible: number; returned: number; rate: number | null; from: number; to: number }[];
  deposits: {
    registered: number; converted: number; rate: number | null;
    eligible7d: number; converted7d: number; rate7d: number | null;
    cohortFrom: number; cohortTo: number;
    firstDepositors: PeriodTotals;
  };
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
  level: PlayerLevel;
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
  /** Own row even when it falls below the public standings limit. */
  yourStanding: TournamentStanding | null;
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
/** `aim` is how the player aimed before the shot, as [ms, angle] samples; null when it was not recorded. */
export type WatchShot = { revision: number; angle: number | null; aim: [number, number][] | null };

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
  /** The columns of each round's row, for rounds already reached (index 0 is round 1). */
  rows: number[][];
  /** Logged shots from the requested revision on, in order. */
  shots: WatchShot[];
  /** Every shot since the start is logged, so the run can be replayed from the beginning. */
  replayable: boolean;
  /** The board's commitment, and the key it came from once the game is over (lib/fairness.ts). */
  fairness: Fairness | null;
  /** Both runs of a match, when the viewer may watch them; empty for tournaments. */
  sides: WatchSide[];
};

/** A run being played right now, for the Live board and the lobby's Live now list. */
export type LiveGame = {
  watchId: string;
  kind: "match" | "tournament";
  asset: Asset;
  name: string;
  avatar: string | null;
  /** Hidden on a match whose seat is still open: whoever takes it must not know the score to beat. */
  score: number | null;
  round: number;
  stake: number;
  /** The tournament name, or the opponent's name for a match. Empty while a seat is open. */
  context: string;
  /** Your own run. */
  isYou: boolean;
  /** Why this run cannot be watched yet: its seat is open, or you still have to play that tournament. */
  locked: "seat" | "playing" | null;
  /** Its last shot, or its start. */
  at: number;
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

/** Whether the player protects withdrawals with an authenticator app. */
export type TwoFactorStatus = {
  enabled: boolean;
  recoveryCodesLeft: number;
  /** Set while too many wrong codes block verification. */
  lockedUntil: number | null;
};

export type AdminTournament = TournamentSummary & { played: number; finished: number };

/** A 1v1 match that has not settled, for the administrator. */
export type AdminGame = {
  id: string;
  asset: Asset;
  stake: number;
  created: number;
  /** The last shot played on either side, or null before the first one. */
  lastShot: number | null;
  /** Nobody has taken the second seat yet. */
  seatOpen: boolean;
  /** What cancelling this match would hand back in total. */
  refund: number;
  players: {
    name: string;
    avatar: string | null;
    score: number;
    round: number;
    done: boolean;
    forfeit: boolean;
    watchId: string;
    lastShot: number | null;
  }[];
};

export type SecurityStatus = TwoFactorStatus & { withdrawalHoldUntil: number | null };
export type AdminSecuritySnapshot = {
  player: (SecurityStatus & { name: string; enabledAt: number | null }) | null;
  recent: { id: string; action: string; adminName: string; playerName: string; reason: string; created: number }[];
};
