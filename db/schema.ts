import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, real, index, uniqueIndex, check, primaryKey } from "drizzle-orm/sqlite-core";

export const players = sqliteTable(
  "players",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    // Stable public recipient identity; never exposes an authentication provider ID.
    publicId: text("public_id"),
    // Gems: the free in-game currency. Whole units, never tied to real money.
    balance: integer("balance").notNull().default(2000),
    created: integer("created").notNull(),
    // Last authenticated request, for the administrator's online count.
    lastSeen: integer("last_seen").notNull().default(0),
    // Key of the player's current picture in `avatars`, if any.
    avatar: text("avatar"),
    // When the player deleted their account. The row stays, with its identity
    // scrubbed, because the ledger and both sides of every match refer to it.
    deleted: integer("deleted"),
    // The code this player shares. Made on demand, never reused.
    referralCode: text("referral_code"),
    // 1: anyone's code, a day of reduced fees for whoever signs up with it.
    // 2: a partnership, granted by an administrator (lib/referrals.ts).
    referralLevel: integer("referral_level").notNull().default(1),
  },
  (t) => [
    check("balance_nonnegative", sql`${t.balance} >= 0`),
    uniqueIndex("player_name_unique").on(sql`lower(${t.name})`),
    uniqueIndex("player_public_id_unique").on(t.publicId),
    uniqueIndex("player_referral_code").on(t.referralCode),
    index("player_presence").on(t.lastSeen),
    index("player_created").on(t.created),
  ],
);

export const playerActivity = sqliteTable("player_activity", {
  userId: text("user_id").notNull().references(() => players.id, { onDelete: "cascade" }),
  day: integer("day").notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.day] }), index("activity_day").on(t.day)]);

export const analyticsMetadata = sqliteTable("analytics_metadata", {
  key: text("key").primaryKey(),
  value: integer("value").notNull(),
});

export const pushSubscriptions = sqliteTable("push_subscriptions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => players.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  created: integer("created").notNull(),
}, (t) => [uniqueIndex("push_endpoint").on(t.endpoint), index("push_owner").on(t.userId)]);

export const pushDeliveries = sqliteTable("push_deliveries", {
  id: text("id").primaryKey(),
  subscriptionId: text("subscription_id").notNull().references(() => pushSubscriptions.id, { onDelete: "cascade" }),
  matchId: text("match_id").notNull(),
  created: integer("created").notNull(),
  attempts: integer("attempts").notNull().default(0),
  nextAttempt: integer("next_attempt").notNull().default(0),
  sent: integer("sent"),
}, (t) => [index("push_pending").on(t.sent, t.nextAttempt)]);

// Profile pictures, already resized by the browser. The key is random, so
// serving a picture never reveals whose it is.
export const avatars = sqliteTable(
  "avatars",
  {
    key: text("key").primaryKey(),
    userId: text("user_id").notNull(),
    type: text("type").notNull(),
    data: text("data").notNull(),
    created: integer("created").notNull(),
  },
  (t) => [index("avatar_owner").on(t.userId)],
);

export const matches = sqliteTable(
  "matches",
  {
    id: text("id").primaryKey(),
    seed: integer("seed").notNull(),
    stake: integer("stake").notNull(),
    asset: text("asset").notNull().default("gems"),
    p1: text("p1").notNull(),
    p2: text("p2"),
    settled: integer("settled").notNull().default(0),
    winner: text("winner"),
    fee: integer("fee").notNull().default(0),
    created: integer("created").notNull(),
    // Engine ruleset both runs are simulated with (see lib/engine.ts). Rows that
    // predate this column were created under ruleset 2.
    ruleset: integer("ruleset").notNull().default(2),
    // Ruleset 6+: secret key new rows are generated from (lib/secret-rows.ts). Never sent to a browser.
    rowKey: text("row_key"),
    // 1 when the creator forfeited before anyone joined; see lib/matches.ts.
    cancelled: integer("cancelled").notNull().default(0),
    // Player removed for automated play (lib/anti-cheat.ts); the other player wins.
    disqualified: text("disqualified"),
    // A private match: set on a challenge, and the code its link carries. Never
    // handed out by public matchmaking (lib/matches.ts).
    invite: text("invite"),
    // The only player who may take the seat, when the challenge names one.
    invited: text("invited"),
  },
  (t) => [
    uniqueIndex("match_invite").on(t.invite),
    index("match_queue").on(t.stake, t.settled, t.p2, t.created),
    // A player's matches, from either seat.
    index("match_p1").on(t.p1, t.created),
    index("match_p2").on(t.p2, t.created),
  ],
);

export const runs = sqliteTable(
  "runs",
  {
    id: text("id").primaryKey(),
    matchId: text("match_id").notNull(),
    userId: text("user_id").notNull(),
    state: text("state").notNull(),
    revision: integer("revision").notNull().default(0),
    score: integer("score").notNull().default(0),
    done: integer("done").notNull().default(0),
    forfeit: integer("forfeit").notNull().default(0),
    created: integer("created").notNull(),
    // Boards fully cleared during the run, for the end-of-match recap.
    clears: integer("clears").notNull().default(0),
    // When the run ended; places the score in a weekly race.
    finished: integer("finished"),
    // JSON ghost trap of the current round (lib/ghost-trap.ts); never part of the real board.
    trap: text("trap"),
  },
  (t) => [
    uniqueIndex("one_run_per_player_match").on(t.matchId, t.userId),
    uniqueIndex("one_active_run_per_player").on(t.userId).where(sql`${t.done}=0`),
    index("runs_history").on(t.userId, t.created),
    index("runs_recent").on(t.created),
    index("runs_finished").on(t.finished),
  ],
);

export const ledger = sqliteTable(
  "ledger",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    matchId: text("match_id"),
    kind: text("kind").notNull(),
    amount: integer("amount").notNull(),
    created: integer("created").notNull(),
  },
  (t) => [index("ledger_user").on(t.userId, t.created), index("ledger_match").on(t.matchId)],
);

// On-chain balances never share the demo-credit tables.
export const cashAccounts = sqliteTable(
  "cash_accounts",
  {
    id: text("id").primaryKey(),
    network: text("network").notNull(),
    userId: text("user_id").notNull(),
    balance: integer("balance").notNull().default(0),
    created: integer("created").notNull(),
  },
  (t) => [uniqueIndex("cash_account_owner").on(t.network, t.userId), check("cash_balance_nonnegative", sql`${t.balance} >= 0`)],
);

export const custodyWallets = sqliteTable(
  "custody_wallets",
  {
    id: text("id").primaryKey(),
    network: text("network").notNull(),
    owner: text("owner").notNull(),
    address: text("address").notNull(),
    encryptedKey: text("encrypted_key").notNull(),
    created: integer("created").notNull(),
  },
  (t) => [uniqueIndex("custody_owner").on(t.network, t.owner), uniqueIndex("custody_address").on(t.address)],
);

export const cashLedger = sqliteTable(
  "cash_ledger",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => cashAccounts.id),
    kind: text("kind").notNull(),
    amount: integer("amount").notNull(),
    reference: text("reference").notNull(),
    created: integer("created").notNull(),
  },
  (t) => [index("cash_ledger_account").on(t.accountId, t.created), index("cash_ledger_reference").on(t.reference)],
);

export const transfers = sqliteTable(
  "cash_transfers",
  {
    id: text("id").primaryKey(),
    network: text("network").notNull(),
    userId: text("user_id").notNull(),
    accountId: text("account_id").notNull(),
    kind: text("kind").notNull(),
    source: text("source").notNull(),
    destination: text("destination").notNull(),
    amount: integer("amount").notNull(),
    fee: integer("fee").notNull(),
    signature: text("signature").notNull(),
    wire: text("wire").notNull(),
    lastValidBlockHeight: integer("last_valid_block_height").notNull(),
    // pending → finalized | failed | expired. `review` is a legacy state that
    // reconciliation still resolves.
    status: text("status").notNull().default("pending"),
    slot: integer("slot"),
    error: text("error"),
    created: integer("created").notNull(),
    updated: integer("updated").notNull(),
  },
  (t) => [
    uniqueIndex("transfer_signature").on(t.signature),
    uniqueIndex("one_pending_source").on(t.source).where(sql`${t.status} IN ('pending','review')`),
    index("transfer_owner").on(t.userId, t.created),
    index("transfer_status").on(t.status, t.created),
  ],
);

// Fixed-window request counters; see lib/rate-limit.ts.
export const rateLimits = sqliteTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    window: integer("window").notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.window] })],
);

// Things that happened to a player, such as a match settling or a tip arriving.
// IDs are deterministic per event, so writing one twice is a harmless no-op.
export const notifications = sqliteTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    kind: text("kind").notNull(),
    data: text("data").notNull(),
    created: integer("created").notNull(),
    readAt: integer("read_at"),
  },
  (t) => [index("notification_owner").on(t.userId, t.created)],
);

// Score tournaments created by the administrator. Every entrant plays one run
// on the tournament's seed between starts_at and ends_at; the pot is paid out
// by rank when the tournament closes. See lib/tournaments.ts.
export const tournaments = sqliteTable(
  "tournaments",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    asset: text("asset").notNull(),
    // Paid tournaments: the entry each player pays. 0 for a free tournament.
    entryFee: integer("entry_fee").notNull().default(0),
    // Free tournaments: the prize the house puts up. Paid pots are computed from entries.
    prize: integer("prize").notNull().default(0),
    payout: text("payout").notNull(),
    places: integer("places").notNull(),
    seed: integer("seed").notNull(),
    ruleset: integer("ruleset").notNull(),
    // Ruleset 6+: secret key new rows are generated from. Never sent to a browser.
    rowKey: text("row_key"),
    startsAt: integer("starts_at").notNull(),
    endsAt: integer("ends_at").notNull(),
    // scheduled → settled | cancelled
    status: text("status").notNull().default("scheduled"),
    created: integer("created").notNull(),
  },
  (t) => [index("tournament_schedule").on(t.status, t.endsAt)],
);

export const tournamentEntries = sqliteTable(
  "tournament_entries",
  {
    id: text("id").primaryKey(),
    tournamentId: text("tournament_id").notNull(),
    userId: text("user_id").notNull(),
    // Null until the entrant starts their one run.
    state: text("state"),
    revision: integer("revision").notNull().default(0),
    score: integer("score").notNull().default(0),
    clears: integer("clears").notNull().default(0),
    done: integer("done").notNull().default(0),
    forfeit: integer("forfeit").notNull().default(0),
    registered: integer("registered").notNull(),
    started: integer("started"),
    finished: integer("finished"),
    rank: integer("rank"),
    payout: integer("payout").notNull().default(0),
    // 1 when removed for automated play: no rank and no prize.
    disqualified: integer("disqualified").notNull().default(0),
    // JSON ghost trap of the current round (lib/ghost-trap.ts).
    trap: text("trap"),
  },
  (t) => [
    uniqueIndex("one_entry_per_player").on(t.tournamentId, t.userId),
    index("tournament_entry_owner").on(t.userId, t.registered),
    index("tournament_entry_finished").on(t.finished),
  ],
);

// Every shot of a match run or tournament run, so spectators can animate live
// shots and replay a run from the start. `run_key` is the watch ID: `m-<run id>`
// for a match run, `t-<entry id>` for a tournament entry. `revision` is the run
// revision the shot was taken from; `angle` is null for a forfeit.
export const runShots = sqliteTable(
  "run_shots",
  {
    runKey: text("run_key").notNull(),
    revision: integer("revision").notNull(),
    angle: real("angle"),
    created: integer("created").notNull(),
    // Simulation ticks of the shot: how long its animation must at least take.
    ticks: integer("ticks"),
    // JSON [ms, angle][]: how the player aimed before the shot, replayed to spectators.
    aim: text("aim"),
  },
  (t) => [primaryKey({ columns: [t.runKey, t.revision] })],
);

// Two-factor authentication (TOTP) protecting withdrawals. The secret is
// encrypted with a key derived from the wallet vault key (lib/two-factor.ts).
export const twoFactor = sqliteTable("two_factor", {
  userId: text("user_id").primaryKey(),
  // AES-GCM ciphertext of the TOTP secret, bound to the user ID.
  secret: text("secret").notNull(),
  // 0 while the player is still scanning the QR code; 1 once a code confirmed it.
  enabled: integer("enabled").notNull().default(0),
  // Highest TOTP time step accepted, so a code cannot be used twice.
  lastStep: integer("last_step").notNull().default(0),
  failures: integer("failures").notNull().default(0),
  lockedUntil: integer("locked_until").notNull().default(0),
  created: integer("created").notNull(),
  enabledAt: integer("enabled_at"),
});

// Single-use recovery codes, stored as keyed hashes only.
export const twoFactorRecovery = sqliteTable(
  "two_factor_recovery",
  {
    codeHash: text("code_hash").primaryKey(),
    userId: text("user_id").notNull(),
    usedAt: integer("used_at"),
  },
  (t) => [index("two_factor_recovery_owner").on(t.userId)],
);

export const securityHolds = sqliteTable("security_holds", {
  userId: text("user_id").primaryKey(),
  reason: text("reason").notNull(),
  until: integer("until").notNull(),
  createdBy: text("created_by").notNull(),
  created: integer("created").notNull(),
});

// Every referral code that has ever existed, and who owns it. A player's code
// can be changed; the old one stays theirs, so a link already shared keeps
// working and nobody can ever pick up a code someone else was handing out.
export const referralCodes = sqliteTable(
  "referral_codes",
  {
    code: text("code").primaryKey(),
    userId: text("user_id").notNull(),
    created: integer("created").notNull(),
  },
  (t) => [index("referral_code_owner").on(t.userId)],
);

// Who brought a player in. One row per referred player, written once when the
// profile is created and never changed: a player has one referrer, for good.
export const referrals = sqliteTable(
  "referrals",
  {
    userId: text("user_id").primaryKey(),
    referrerId: text("referrer_id").notNull(),
    // The level the code carried when it was used, which set the window below.
    level: integer("level").notNull(),
    // Until when this player's house fee is reduced.
    discountUntil: integer("discount_until").notNull(),
    created: integer("created").notNull(),
  },
  (t) => [index("referral_referrer").on(t.referrerId)],
);

// Friends. One row per pair, whoever asked: the lower ID is always first, so a
// pair cannot exist twice, in either direction.
export const friendLinks = sqliteTable(
  "friend_links",
  {
    lowId: text("low_id").notNull(),
    highId: text("high_id").notNull(),
    requestedBy: text("requested_by").notNull(),
    // pending until the other player answers; a refusal deletes the row.
    status: text("status").notNull(),
    created: integer("created").notNull(),
    answered: integer("answered"),
  },
  (t) => [primaryKey({ columns: [t.lowId, t.highId] }), index("friend_low").on(t.lowId, t.status), index("friend_high").on(t.highId, t.status)],
);

// What friends say to each other. Keyed by the pair, so a conversation is one
// index lookup, and only friends can write to one.
export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    lowId: text("low_id").notNull(),
    highId: text("high_id").notNull(),
    fromId: text("from_id").notNull(),
    body: text("body").notNull(),
    created: integer("created").notNull(),
    readAt: integer("read_at"),
  },
  (t) => [index("message_thread").on(t.lowId, t.highId, t.created), index("message_unread").on(t.fromId, t.readAt)],
);

// Who a player refuses to hear from. Directional: one row per blocker, and
// either direction is enough to stop everything between the two.
export const blocks = sqliteTable(
  "blocks",
  {
    blockerId: text("blocker_id").notNull(),
    blockedId: text("blocked_id").notNull(),
    created: integer("created").notNull(),
  },
  (t) => [primaryKey({ columns: [t.blockerId, t.blockedId] }), index("block_blocked").on(t.blockedId)],
);

// What a player tells the house about another one. Kept whatever happens next:
// a report is the record that a decision was asked for.
export const reports = sqliteTable(
  "reports",
  {
    id: text("id").primaryKey(),
    reporterId: text("reporter_id").notNull(),
    targetId: text("target_id").notNull(),
    // cheating | harassment | spam | other
    kind: text("kind").notNull(),
    detail: text("detail").notNull(),
    created: integer("created").notNull(),
    // open until an administrator has looked at it.
    status: text("status").notNull().default("open"),
    reviewedBy: text("reviewed_by"),
    reviewedAt: integer("reviewed_at"),
    note: text("note"),
  },
  (t) => [index("report_open").on(t.status, t.created), index("report_target").on(t.targetId), index("report_reporter").on(t.reporterId)],
);

// One row per player who signed out everywhere: sessions issued before this
// moment are refused, whatever cookie carries them.
export const sessionResets = sqliteTable("session_resets", {
  userId: text("user_id").primaryKey(),
  invalidBefore: integer("invalid_before").notNull(),
  created: integer("created").notNull(),
});

export const adminAudit = sqliteTable("admin_audit", {
  id: text("id").primaryKey(),
  adminId: text("admin_id").notNull(),
  action: text("action").notNull(),
  targetUserId: text("target_user_id").notNull(),
  reason: text("reason").notNull(),
  created: integer("created").notNull(),
}, (t) => [index("admin_audit_recent").on(t.created)]);

// Weekly race: best real-money score of the week (Monday 00:00 UTC). A row exists
// once an administrator has paid the week's prizes; its primary key makes paying
// a week twice impossible.
export const weeklyRaces = sqliteTable("weekly_races", {
  weekStart: integer("week_start").primaryKey(),
  // JSON: the paid places with name, score and prizes.
  winners: text("winners").notNull(),
  paidBy: text("paid_by").notNull(),
  paidAt: integer("paid_at").notNull(),
});

// Players an administrator removed from one week's race, e.g. for a suspicious score.
export const weeklyRaceExclusions = sqliteTable(
  "weekly_race_exclusions",
  {
    weekStart: integer("week_start").notNull(),
    userId: text("user_id").notNull(),
    reason: text("reason").notNull(),
    adminId: text("admin_id").notNull(),
    created: integer("created").notNull(),
  },
  (t) => [primaryKey({ columns: [t.weekStart, t.userId] })],
);

// Administrator-editable settings, one JSON value per key.
// The free daily gems, one row per player and UTC day. The primary key is the
// claim: a second attempt on the same day inserts nothing (lib/daily.ts).
export const dailyClaims = sqliteTable(
  "daily_claims",
  {
    userId: text("user_id").notNull(),
    // Days since the epoch, UTC.
    day: integer("day").notNull(),
    // Consecutive days claimed up to and including this one.
    streak: integer("streak").notNull(),
    amount: integer("amount").notNull(),
    created: integer("created").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.day] })],
);

export const questClaims = sqliteTable(
  "quest_claims",
  {
    userId: text("user_id").notNull(),
    // "daily" or "weekly".
    scope: text("scope").notNull(),
    // The UTC day number for a daily quest, the week's start in ms for a weekly one.
    period: integer("period").notNull(),
    quest: text("quest").notNull(),
    // Which rung of the quest's ladder this claim paid for: 0 is the first.
    tier: integer("tier").notNull().default(0),
    amount: integer("amount").notNull(),
    created: integer("created").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.scope, t.period, t.quest, t.tier] })],
);

export const bugReportAttachments = sqliteTable(
  "bug_report_attachments",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    reportId: text("report_id"),
    pathname: text("pathname").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    size: integer("size").notNull(),
    created: integer("created").notNull(),
  },
  (t) => [index("bug_attachment_user").on(t.userId), index("bug_attachment_report").on(t.reportId), index("bug_attachment_created").on(t.created)],
);

export const bugReports = sqliteTable(
  "bug_reports",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    links: text("links").notNull().default("[]"),
    page: text("page").notNull().default(""),
    status: text("status").notNull().default("open"),
    created: integer("created").notNull(),
    updated: integer("updated").notNull(),
  },
  (t) => [index("bug_report_user").on(t.userId), index("bug_report_created").on(t.created, t.id), check("bug_report_status", sql`${t.status} IN ('open', 'resolved')`)],
);

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedBy: text("updated_by").notNull(),
  updated: integer("updated").notNull(),
});

// Anti-cheat (lib/anti-cheat.ts). A suspended or banned player cannot play,
// withdraw or tip. `source` is "proof" (automatic, technical evidence), "stats"
// (automatic, statistical) or "admin".
export const playerSuspensions = sqliteTable("player_suspensions", {
  userId: text("user_id").primaryKey(),
  status: text("status").notNull(), // suspended | banned | lifted
  source: text("source").notNull(),
  reason: text("reason").notNull(),
  evidence: text("evidence").notNull(),
  created: integer("created").notNull(),
  reviewedBy: text("reviewed_by"),
  reviewedAt: integer("reviewed_at"),
  note: text("note"),
});

// Every anti-cheat observation, including those below a sanction threshold.
export const cheatSignals = sqliteTable(
  "cheat_signals",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    runKey: text("run_key"),
    kind: text("kind").notNull(),
    level: text("level").notNull(), // proof | stat
    detail: text("detail").notNull(),
    created: integer("created").notNull(),
  },
  (t) => [index("cheat_signal_user").on(t.userId, t.created), index("cheat_signal_run").on(t.runKey, t.kind), index("cheat_signal_recent").on(t.created)],
);

// Per real-money shot: how the chosen angle compares with every other angle.
export const shotAnalysis = sqliteTable(
  "shot_analysis",
  {
    runKey: text("run_key").notNull(),
    revision: integer("revision").notNull(),
    userId: text("user_id").notNull(),
    aimMs: integer("aim_ms"),
    // Times the aim changed before the shot; null when the client sent no trail.
    aimMoves: integer("aim_moves"),
    gain: integer("gain").notNull(),
    bestGain: integer("best_gain").notNull(),
    // Share of the sampled angles that reach the best gain: small means a hard shot.
    bestShare: real("best_share").notNull(),
    // Percentile of the shot among every sampled angle, judged on the board it leaves (lib/anti-cheat-rules.ts).
    quality: real("quality"),
    // The angle played, in degrees. A player repeating one shot is not solving each board.
    angle: real("angle"),
    // On a ghost trap round: 1 when the shot fell into the trap, 0 when it did not; null otherwise.
    trapped: integer("trapped"),
    created: integer("created").notNull(),
  },
  (t) => [primaryKey({ columns: [t.runKey, t.revision] }), index("shot_analysis_user").on(t.userId, t.created)],
);
