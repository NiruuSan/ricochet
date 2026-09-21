import { adminId, database, type Statement } from "@/db/raw";
import { wageredSql } from "./experience";
import { experienceFromWagered, levelFor } from "./levels";
import { initial, isSupportedRuleset, RULESET, ShotError, simulateShot, SUPPORTED_RULESETS, validAngle, type Game } from "./engine";
import { inspectShot, reportMessage, SUSPENDED_MESSAGE, type AimTrail, type Finding, type ShotProof } from "./anti-cheat-rules";
import { shotKeyFor, validSignature } from "./shot-key";
import { parseTrap, planTrap, presentRun } from "./ghost-trap";
import { analyzeShot, ANTI_CHEAT_ON_SQL, isSuspended, signalInsert, suspendedSql } from "./anti-cheat";
import type { ChallengeNotification, Asset, Leader, MatchNotification, MatchRecap, MatchResult, MatchSummary, Profile, RecapSide, Run, Snapshot } from "./api-types";
import { cancelRefund, isStake, SOL_WIN_GEM_BONUS, winnerFee, winnerPayout } from "./api-types";
import { referralCredits } from "./referrals";
import { cashAccountId, ensureCashAccount, HOUSE, settings } from "./payments/accounts";
import { launchStatus, requireDevnet } from "./payments/policy";
import { dailyGems } from "./daily";
import { BLOCKED_MESSAGE, blockedBetween } from "./blocks";
import { friendAlerts } from "./friends";
import { listNotifications, notificationInsert } from "./notifications";
import { newRowKey, rowsFor } from "./secret-rows";
import { shotInsert } from "./spectate-shots";
import { tournamentHistory } from "./tournament-history";

/** An error whose message is safe to show and carries an HTTP status. */
export class GameError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

type RunRow = { user_id: string; done: number; forfeit: number; score: number };
type MatchRow = { id: string; seed: number; stake: number; asset: Asset; p1: string; p2: string | null; settled: number; ruleset: number; row_key: string | null; disqualified?: string | null };

const PUBLIC_RUN = "r.id, r.match_id, r.state, r.revision, r.score, r.done, r.forfeit, r.clears, m.asset, m.ruleset, m.invite, r.trap";

export const AUTOMATION_DETECTED = "Automated play was detected. This game is lost and your account is suspended pending review.";

/** Anti-cheat inputs for a shot: the client's report, and where to run work after the response. */
export type ShotGuard = {
  proof?: ShotProof;
  aim?: AimTrail | null;
  /** The aim exactly as the client sent it, which is what it signed. */
  signedAim?: unknown;
  defer?: (task: () => Promise<unknown>) => void;
};

/** Whether a shot report carries a valid signature for this run and shot. */
export const reportSigned = (runKey: string, revision: number, angle: number, guard: ShotGuard) =>
  !!guard.proof && validSignature(runKey, reportMessage({ runKey, revision, angle, proof: guard.proof, aim: guard.signedAim }), guard.proof.sig);

/** The last logged shot of a run (for timing) and the run's timing strikes so far. `key` is the run's shot-log key as SQL. */
export const SHOT_HISTORY_SQL = (key: string) => `
  (SELECT s.created FROM run_shots s WHERE s.run_key = ${key} ORDER BY s.revision DESC LIMIT 1) AS previous_at,
  (SELECT s.ticks FROM run_shots s WHERE s.run_key = ${key} ORDER BY s.revision DESC LIMIT 1) AS previous_ticks,
  (SELECT COUNT(*) FROM cheat_signals c WHERE c.run_key = ${key} AND c.kind = 'timing') AS timing_strikes,
  ${ANTI_CHEAT_ON_SQL} AS anti_cheat_on`;
export type ShotHistory = { previous_at: number | null; previous_ticks: number | null; timing_strikes: number; anti_cheat_on: number };

/** Findings to record for a shot: with the anti-cheat off, proof is kept as evidence and marked as not sanctioned. */
export const recordedFindings = (findings: Finding[], sanctioning: boolean) =>
  sanctioning ? findings : findings.map((f) => (f.level === "proof" ? { ...f, detail: { ...f.detail, sanctioned: false } } : f));
type RunRecord = Omit<Run, "state"> & { state: string; trap: string | null };
/** The run with its real board, for the server's own use. */
const parseRun = ({ trap: _trap, ...row }: RunRecord): Run => ({ ...row, state: JSON.parse(row.state) as Game, shotKey: shotKeyFor(`m-${row.id}`) });
/** The run as sent to its player, with this round's ghost bricks (lib/ghost-trap.ts). */
const publicRun = (row: RunRecord) => presentRun(parseRun(row), `m-${row.id}`, row.trap);

/** Public URL of a stored profile picture. Keys are random, never user IDs. */
export const avatarUrl = (key: string | null) => (key ? `/api/avatars/${key}` : null);

// Before ruleset 4, a match whose creator forfeited before anyone joined is
// (or is about to be) cancelled, so nobody may join it. From ruleset 4 a forfeit
// only ends that run: its score stands and the seat stays open.
const JOINABLE = "(matches.ruleset >= 4 OR NOT EXISTS (SELECT 1 FROM runs f WHERE f.match_id = matches.id AND f.forfeit = 1))";
/** Public matchmaking never hands out a private match: only its link does. */
const PUBLIC_SEAT = "matches.invite IS NULL";

/** Ruleset 4+: the higher score wins, forfeit or not. Earlier: a single forfeit loses. */
function decideWinner(ruleset: number, a: RunRow, b: RunRow) {
  if (ruleset < 4 && a.forfeit !== b.forfeit) return a.forfeit ? b.user_id : a.user_id;
  return a.score === b.score ? null : a.score > b.score ? a.user_id : b.user_id;
}

export async function settle(matchId: string) {
  const db = database();
  const m = await db.prepare("SELECT * FROM matches WHERE id = ?").bind(matchId).first<MatchRow>();
  if (!m || m.settled) return;
  const runs = (await db.prepare("SELECT * FROM runs WHERE match_id = ?").bind(matchId).all<RunRow>()).results;
  if (!m.p2) return m.ruleset < 4 ? cancelUnjoined(m, runs) : undefined;
  // A player disqualified for automated play loses at once, even mid-run.
  const disqualified = m.disqualified ?? null;
  if (runs.length !== 2 || (!disqualified && runs.some((r) => !r.done))) return;

  const [a, b] = runs;
  const winner = disqualified ? (a.user_id === disqualified ? b.user_id : a.user_id) : decideWinner(m.ruleset, a, b);
  const now = Date.now();
  const payout = winner ? winnerPayout(m.stake, m.asset) : m.stake;
  const fee = winner ? winnerFee(m.stake, m.asset) : 0;
  const recipients = winner ? [winner] : [a.user_id, b.user_id];
  const ops: Statement[] = [];
  if (m.stake === 0) {
    // A friendly: the result is the whole of it.
  } else if (m.asset === "devnet") {
    await ensureCashAccount(HOUSE);
    for (const uid of recipients) {
      ops.push(
        db
          .prepare("INSERT OR IGNORE INTO cash_ledger(id, account_id, kind, amount, reference, created) VALUES(?, ?, 'match_payout', ?, ?, ?)")
          .bind(`${matchId}:cash:payout:${uid}`, cashAccountId(uid), payout, matchId, now),
      );
    }
    if (fee) {
      ops.push(
        db
          .prepare("INSERT OR IGNORE INTO cash_ledger(id, account_id, kind, amount, reference, created) VALUES(?, ?, 'house_fee', ?, ?, ?)")
          .bind(`${matchId}:cash:fee`, cashAccountId(HOUSE), fee, matchId, now),
      );
    }
    ops.push(
      db
        .prepare("INSERT OR IGNORE INTO cash_ledger(id, account_id, kind, amount, reference, created) VALUES(?, ?, 'escrow_release', ?, ?, ?)")
        .bind(`${matchId}:cash:release`, cashAccountId("escrow:" + matchId), -m.stake * 2, matchId, now),
    );
    // What the house gives back to a player it brought in at a reduced fee, and
    // what it owes the partner who brought them. Both come out of the fee just
    // taken, which is why they follow it (lib/referrals.ts).
    ops.push(...(await referralCredits(db, { id: matchId, asset: m.asset, fee }, [a.user_id, b.user_id], now)));
  } else {
    for (const uid of recipients) {
      ops.push(
        db
          .prepare("INSERT OR IGNORE INTO ledger(id, user_id, match_id, kind, amount, created) VALUES(?, ?, ?, 'payout', ?, ?)")
          .bind(`${matchId}:payout:${uid}`, uid, matchId, payout, now),
      );
    }
  }
  // Winning a real SOL match also earns gems. The ID makes it once per match.
  const bonusGems = m.asset === "devnet" && winner ? SOL_WIN_GEM_BONUS : 0;
  if (bonusGems) {
    ops.push(
      db
        .prepare("INSERT OR IGNORE INTO ledger(id, user_id, match_id, kind, amount, created) VALUES(?, ?, ?, 'sol_win_bonus', ?, ?)")
        .bind(`${matchId}:gem-bonus:${winner}`, winner, matchId, bonusGems, now),
    );
  }
  ops.push(db.prepare("UPDATE matches SET settled = 1, winner = ?, fee = ? WHERE id = ? AND settled = 0").bind(winner, fee, matchId));
  // The opponent's run ends with the match; their score so far stands.
  if (disqualified) ops.push(db.prepare("UPDATE runs SET done = 1, finished = ? WHERE match_id = ? AND done = 0").bind(now, matchId));
  // Tell both players how it ended, including one who has since gone offline.
  const names = await db
    .prepare("SELECT id, name FROM players WHERE id IN (?, ?)")
    .bind(a.user_id, b.user_id)
    .all<{ id: string; name: string }>();
  const nameOf = (uid: string) => names.results.find((p) => p.id === uid)?.name ?? null;
  for (const [me, other] of [
    [a, b],
    [b, a],
  ]) {
    const result = winner === null ? "draw" : winner === me.user_id ? "win" : "loss";
    const data: MatchNotification = {
      matchId,
      asset: m.asset,
      stake: m.stake,
      result,
      net: netResult(result, m.stake, fee),
      opponent: nameOf(other.user_id),
      score: me.score,
      opponentScore: other.score,
      bonusGems: result === "win" ? bonusGems : 0,
      ...(disqualified ? { disqualified: other.user_id === disqualified } : {}),
    };
    // The ID names the seat, not the player: notification IDs reach the browser.
    ops.push(notificationInsert(db, `${matchId}:result:${me.user_id === m.p1 ? "p1" : "p2"}`, me.user_id, "match_result", data, now));
  }
  await db.batch(ops);
}

/**
 * The creator forfeited before anyone joined. Letting a stranger take the seat
 * would hand them a free win, so the match closes instead. The creator gets
 * their full gem entry back. Devnet entries retain the usual 12% fee.
 */
async function cancelUnjoined(m: MatchRow, runs: RunRow[]) {
  if (runs.length !== 1 || !runs[0].done || !runs[0].forfeit) return;
  const db = database();
  const uid = runs[0].user_id;
  const refund = cancelRefund(m.stake, m.asset);
  const fee = m.stake - refund;
  const now = Date.now();
  // Every ledger insert selects from the match row, so it only applies if this
  // batch's UPDATE actually cancelled the match.
  const cancelled = "FROM matches WHERE id = ? AND cancelled = 1";
  const ops: Statement[] = [
    db.prepare("UPDATE matches SET settled = 1, cancelled = 1, fee = ? WHERE id = ? AND p2 IS NULL AND settled = 0").bind(fee, m.id),
  ];
  if (m.asset === "devnet") {
    await ensureCashAccount(HOUSE);
    ops.push(
      db
        .prepare(`INSERT OR IGNORE INTO cash_ledger(id, account_id, kind, amount, reference, created) SELECT ?, ?, 'match_refund', ?, ?, ? ${cancelled}`)
        .bind(`${m.id}:cash:refund:${uid}`, cashAccountId(uid), refund, m.id, now, m.id),
      db
        .prepare(`INSERT OR IGNORE INTO cash_ledger(id, account_id, kind, amount, reference, created) SELECT ?, ?, 'house_fee', ?, ?, ? ${cancelled}`)
        .bind(`${m.id}:cash:fee`, cashAccountId(HOUSE), fee, m.id, now, m.id),
      db
        .prepare(`INSERT OR IGNORE INTO cash_ledger(id, account_id, kind, amount, reference, created) SELECT ?, ?, 'escrow_release', ?, ?, ? ${cancelled}`)
        .bind(`${m.id}:cash:release`, cashAccountId("escrow:" + m.id), -m.stake, m.id, now, m.id),
    );
  } else {
    ops.push(
      db
        .prepare(`INSERT OR IGNORE INTO ledger(id, user_id, match_id, kind, amount, created) SELECT ?, ?, ?, 'refund', ?, ? ${cancelled}`)
        .bind(`${m.id}:refund:${uid}`, uid, m.id, refund, now, m.id),
    );
  }
  await db.batch(ops);
}

/**
 * Anti-cheat: `uid` loses this unsettled match. Their run ends. With an opponent,
 * the opponent wins as in a normal match. Without one, the match closes and the
 * house keeps the entry.
 */
export async function disqualifyMatch(matchId: string, uid: string, now = Date.now()) {
  const db = database();
  const m = await db.prepare("SELECT * FROM matches WHERE id = ? AND settled = 0 AND (p1 = ? OR p2 = ?)").bind(matchId, uid, uid).first<MatchRow>();
  if (!m) return;
  const endRun = db.prepare("UPDATE runs SET done = 1, forfeit = 1, finished = COALESCE(finished, ?) WHERE match_id = ? AND user_id = ? AND done = 0").bind(now, matchId, uid);
  if (m.p2) {
    await db.batch([db.prepare("UPDATE matches SET disqualified = ? WHERE id = ? AND settled = 0").bind(uid, matchId), endRun]);
    return settle(matchId);
  }
  const closed = "FROM matches WHERE id = ? AND cancelled = 1 AND disqualified IS NOT NULL";
  const ops: Statement[] = [
    db.prepare("UPDATE matches SET settled = 1, cancelled = 1, disqualified = ?, fee = stake WHERE id = ? AND settled = 0 AND p2 IS NULL").bind(uid, matchId),
    endRun,
  ];
  if (m.asset === "devnet") {
    await ensureCashAccount(HOUSE);
    ops.push(
      db
        .prepare(`INSERT OR IGNORE INTO cash_ledger(id, account_id, kind, amount, reference, created) SELECT ?, ?, 'house_fee', ?, ?, ? ${closed}`)
        .bind(`${matchId}:cash:fee`, cashAccountId(HOUSE), m.stake, matchId, now, matchId),
      db
        .prepare(`INSERT OR IGNORE INTO cash_ledger(id, account_id, kind, amount, reference, created) SELECT ?, ?, 'escrow_release', ?, ?, ? ${closed}`)
        .bind(`${matchId}:cash:release`, cashAccountId("escrow:" + matchId), -m.stake, matchId, now, matchId),
    );
  }
  await db.batch(ops);
}

/** Settles this player's finished matches that are still waiting on settlement. */
export async function settleFinishedMatches(uid: string) {
  const pending = await database()
    .prepare("SELECT r.match_id FROM runs r JOIN matches m ON m.id = r.match_id WHERE r.user_id = ? AND r.done = 1 AND m.settled = 0")
    .bind(uid)
    .all<{ match_id: string }>();
  for (const { match_id } of pending.results) await settle(match_id);
}

/** Open seats another player could take right now, by currency and entry. Excludes the viewer's own matches. */
export async function openSeats(viewer: string | null) {
  const rulesets = SUPPORTED_RULESETS.map(Number).join(", ");
  const { results } = await database()
    .prepare(
      `SELECT asset, stake, COUNT(*) AS n FROM matches
       WHERE p2 IS NULL AND settled = 0 AND p1 <> COALESCE(?, '') AND ruleset IN (${rulesets}) AND ${JOINABLE}
       GROUP BY asset, stake`,
    )
    .bind(viewer)
    .all<{ asset: Asset; stake: number; n: number }>();
  const seats: Record<Asset, Record<number, number>> = { gems: {}, devnet: {} };
  for (const row of results) seats[row.asset][row.stake] = row.n;
  return seats;
}

export function netResult(result: MatchResult | null, stake: number, fee: number) {
  switch (result) {
    case "win":
      return stake - fee;
    case "loss":
      return -stake;
    case "cancelled":
      return fee ? -fee : 0;
    default:
      return 0;
  }
}

async function activeRun(uid: string) {
  const row = await database()
    .prepare(`SELECT ${PUBLIC_RUN} FROM runs r JOIN matches m ON m.id = r.match_id WHERE r.user_id = ? AND r.done = 0`)
    .bind(uid)
    .first<RunRecord>();
  return row ? publicRun(row) : null;
}

/** Players seen within this window count as online. The client polls every 15 seconds. */
export const ONLINE_MS = 60_000;

/** Records that the player is here. Writes at most once every 20 seconds per player. */
export async function touchPlayer(uid: string, now = Date.now()) {
  await database().prepare("UPDATE players SET last_seen = ? WHERE id = ? AND last_seen < ?").bind(now, uid, now - 20_000).run();
}

/** Top 50 players by settled match P&L in one currency. `viewer` only marks the viewer's own row; it may be null. */
export async function leaderboard(viewer: string | null, asset: Asset): Promise<Leader[]> {
  const sql =
    asset === "gems"
      ? `SELECT p.name, p.avatar, COALESCE(p.id = ?, 0) AS is_you, COALESCE(SUM(l.amount), 0) AS pnl, COUNT(DISTINCT m.id) AS games, ${wageredSql("p.id")} AS wagered
         FROM players p
         JOIN ledger l ON l.user_id = p.id
         JOIN matches m ON m.id = l.match_id AND m.settled = 1 AND m.asset = 'gems'
         WHERE p.deleted IS NULL
         GROUP BY p.id ORDER BY pnl DESC, p.name ASC LIMIT 50`
      : `SELECT p.name, p.avatar, COALESCE(p.id = ?, 0) AS is_you, SUM(l.amount) AS pnl, COUNT(DISTINCT m.id) AS games, ${wageredSql("p.id")} AS wagered
         FROM players p
         JOIN cash_accounts a ON a.user_id = p.id AND a.network = 'devnet'
         JOIN cash_ledger l ON l.account_id = a.id
         JOIN matches m ON m.id = l.reference AND m.settled = 1 AND m.asset = 'devnet'
         WHERE l.kind IN ('match_entry', 'match_payout', 'match_refund') AND p.deleted IS NULL
         GROUP BY p.id ORDER BY pnl DESC, p.name ASC LIMIT 50`;
  const { results } = await database().prepare(sql).bind(viewer).all<Omit<Leader, "level"> & { wagered: number }>();
  return results.map(({ wagered, ...l }) => ({ ...l, avatar: avatarUrl(l.avatar), level: levelFor(experienceFromWagered(wagered)) }));
}

export async function playerSnapshot(uid: string, asset: Asset): Promise<Snapshot> {
  const db = database();
  await settleFinishedMatches(uid);
  const [player, history, active, cash, inbox, tournaments, daily, friends] = await Promise.all([
    db
      .prepare(
        `SELECT public_id AS publicId, name, balance, avatar, created, ${wageredSql("players.id")} AS wagered,
           (SELECT reason FROM player_suspensions s WHERE s.user_id = players.id AND s.status IN ('suspended', 'banned')) AS suspension
         FROM players WHERE id = ? AND deleted IS NULL`,
      )
      .bind(uid)
      .first<Profile & { suspension: string | null; wagered: number }>(),
    db
      .prepare(
        `SELECT m.id, m.stake, m.fee, m.settled, m.created,
           r.id AS run_id, r.score, r.done, r.forfeit,
           CASE WHEN m.p2 IS NULL THEN 0 ELSE 1 END AS joined,
           CASE WHEN m.p1 = r.user_id THEN p2.name ELSE p1.name END AS opponent,
           CASE WHEN m.p1 = r.user_id THEN p2.avatar ELSE p1.avatar END AS opponent_avatar,
           CASE WHEN m.settled = 1 THEN other.score ELSE NULL END AS opponent_score,
           CASE WHEN m.settled = 0 THEN NULL
                WHEN m.cancelled = 1 THEN 'cancelled'
                WHEN m.winner IS NULL THEN 'draw'
                WHEN m.winner = r.user_id THEN 'win'
                ELSE 'loss' END AS result
         FROM runs r
         JOIN matches m ON r.match_id = m.id
         LEFT JOIN players p1 ON p1.id = m.p1
         LEFT JOIN players p2 ON p2.id = m.p2
         LEFT JOIN runs other ON other.match_id = m.id AND other.user_id <> r.user_id
         WHERE r.user_id = ? AND m.asset = ?
         ORDER BY m.created DESC LIMIT 50`,
      )
      .bind(uid, asset)
      .all<Omit<MatchSummary, "net"> & { fee: number }>(),
    activeRun(uid),
    db.prepare("SELECT balance FROM cash_accounts WHERE id = ?").bind(cashAccountId(uid)).first<{ balance: number }>(),
    listNotifications(uid),
    tournamentHistory(uid, asset),
    dailyGems(uid),
    friendAlerts(uid),
  ]);
  const admin = adminId();
  return {
    asset,
    cashBalance: cash?.balance ?? 0,
    launch: launchStatus(settings()),
    player: player && { publicId: player.publicId, name: player.name, balance: player.balance, avatar: avatarUrl(player.avatar), created: player.created, level: levelFor(experienceFromWagered(player.wagered)) },
    suspension: player?.suspension ? { reason: player.suspension } : null,
    daily,
    matches: history.results.map(({ fee, ...m }) => ({ ...m, opponent_avatar: avatarUrl(m.opponent_avatar), net: netResult(m.result, m.stake, fee) })),
    active,
    isAdmin: !!admin && uid === admin,
    notifications: inbox.items,
    unreadNotifications: inbox.unread,
    tournaments,
    friends,
  };
}

type RecapRow = {
  stake: number;
  asset: Asset;
  p2: string | null;
  settled: number;
  cancelled: number;
  winner: string | null;
  fee: number;
  me: string;
  state: string;
  clears: number;
  done: number;
  forfeit: number;
  name: string;
  avatar: string | null;
  other_state: string | null;
  other_clears: number | null;
  other_done: number | null;
  other_forfeit: number | null;
  wagered: number;
  other_wagered: number;
  other_name: string | null;
  other_avatar: string | null;
  bonus: number | null;
};

function recapSide(name: string, avatar: string | null, stateJson: string, clears: number, forfeit: number): RecapSide {
  const board = JSON.parse(stateJson) as Game;
  return { name, avatar: avatarUrl(avatar), score: board.score, balls: board.balls, clears, rounds: board.round, forfeit: !!forfeit, board };
}

/**
 * The end-of-match recap for one of the player's matches. Settles the match
 * first when both runs are over. The opponent's score and board are revealed
 * only once the match has settled, so an unfinished opponent learns nothing.
 */
export async function matchRecap(uid: string, matchIdInput: unknown): Promise<MatchRecap> {
  const matchId = String(matchIdInput ?? "");
  const db = database();
  const load = () =>
    db
      .prepare(
        `SELECT m.stake, m.asset, m.p2, m.settled, m.cancelled, m.winner, m.fee,
           r.user_id AS me, r.state, r.clears, r.done, r.forfeit, p.name, p.avatar,
           o.state AS other_state, o.clears AS other_clears, o.done AS other_done, o.forfeit AS other_forfeit,
           op.name AS other_name, op.avatar AS other_avatar,
           ${wageredSql("p.id")} AS wagered, ${wageredSql("op.id")} AS other_wagered,
           (SELECT amount FROM ledger WHERE id = ?) AS bonus
         FROM runs r
         JOIN matches m ON m.id = r.match_id
         JOIN players p ON p.id = r.user_id
         LEFT JOIN players op ON op.id = CASE WHEN m.p1 = r.user_id THEN m.p2 ELSE m.p1 END
         LEFT JOIN runs o ON o.match_id = m.id AND o.user_id = op.id
         WHERE r.match_id = ? AND r.user_id = ?`,
      )
      .bind(`${matchId}:gem-bonus:${uid}`, matchId, uid)
      .first<RecapRow>();
  let row = await load();
  if (!row) throw new GameError("Match not found.", 404);
  if (row.done && !row.settled) {
    await settle(matchId);
    row = (await load())!;
  }
  const settled = !!row.settled;
  const result: MatchResult | null = !settled ? null : row.cancelled ? "cancelled" : row.winner === null ? "draw" : row.winner === uid ? "win" : "loss";
  const status = !row.done ? "playing" : settled ? "settled" : !row.p2 ? "waiting" : "opponent_playing";
  const reveal = settled && !row.cancelled && row.other_state !== null;
  return {
    matchId,
    asset: row.asset,
    stake: row.stake,
    status,
    result,
    net: settled ? netResult(result, row.stake, row.fee) : null,
    bonusGems: row.bonus ?? 0,
    you: { ...recapSide(row.name, row.avatar, row.state, row.clears, row.forfeit), level: levelFor(experienceFromWagered(row.wagered)) },
    opponent: row.other_name
      ? {
          name: row.other_name,
          level: levelFor(experienceFromWagered(row.other_wagered)),
          avatar: avatarUrl(row.other_avatar),
          stats: reveal ? recapSide(row.other_name, row.other_avatar, row.other_state!, row.other_clears ?? 0, row.other_forfeit ?? 0) : null,
        }
      : null,
  };
}

/** Rejects anything that should stop a player entering a match, and returns the entry. */
async function assertCanEnter(uid: string, stakeInput: unknown, assetInput: unknown, free = false) {
  const db = database();
  const asset = assetInput ?? "gems";
  if (asset !== "gems" && asset !== "devnet") throw new GameError("Unsupported match currency.");
  if (asset === "devnet") {
    requireDevnet(settings());
    await ensureCashAccount(uid);
  }
  const [active, suspended] = await Promise.all([activeRun(uid), isSuspended(uid)]);
  if (suspended) throw new GameError(SUSPENDED_MESSAGE, 403);

  const stake = Number(stakeInput);
  // A friendly game between friends is the one entry outside the barème.
  if (!(free && stake === 0) && !isStake(asset, stake)) throw new GameError("Choose one of the five entry amounts.");
  const available =
    asset === "gems"
      ? ((await db.prepare("SELECT balance FROM players WHERE id = ?").bind(uid).first<{ balance: number }>())?.balance ?? 0)
      : ((await db.prepare("SELECT balance FROM cash_accounts WHERE id = ?").bind(cashAccountId(uid)).first<{ balance: number }>())?.balance ?? 0);
  if (available < stake) {
    throw new GameError(asset === "gems" ? "Not enough gems. Practice is always free." : "Not enough deposited devnet SOL. Open your wallet to fund it.");
  }
  return { asset: asset as Asset, stake, active };
}

/**
 * Takes a seat: the second one of `joining`, or the first of a new match.
 * `invite` makes that new match private, so only its link — and the player it
 * names, when it names one — can take the other seat.
 */
async function enterMatch(uid: string, stake: number, asset: Asset, joining: MatchRow | null, invite: { code: string; invited: string | null } | null): Promise<Run> {
  const db = database();
  const runId = crypto.randomUUID();
  const now = Date.now();
  const ops: Statement[] = [];
  let match = joining;
  if (match) {
    ops.push(db.prepare(`UPDATE matches SET p2 = ? WHERE id = ? AND p2 IS NULL AND settled = 0 AND (invited IS NULL OR invited = ?) AND ${JOINABLE}`).bind(uid, match.id, uid));
  } else {
    match = { id: crypto.randomUUID(), seed: crypto.getRandomValues(new Uint32Array(1))[0], stake, asset, p1: uid, p2: null, settled: 0, ruleset: RULESET, row_key: newRowKey() };
    ops.push(
      db
        .prepare("INSERT INTO matches(id, seed, stake, asset, p1, created, ruleset, row_key, invite, invited) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(match.id, match.seed, stake, asset, uid, now, RULESET, match.row_key, invite?.code ?? null, invite?.invited ?? null),
    );
  }
  // The run and the entry only exist if this player really holds a seat, which
  // makes losing a race for the open seat a harmless no-op.
  ops.push(
    db
      .prepare("INSERT INTO runs(id, match_id, user_id, state, created) SELECT ?, ?, ?, ?, ? FROM matches WHERE id = ? AND (p1 = ? OR p2 = ?)")
      .bind(runId, match.id, uid, JSON.stringify(initial(match.seed, rowsFor(match.ruleset, match.row_key))), now, match.id, uid, uid),
  );
  // A friendly game (no entry at all) moves nothing, so it writes no ledger line.
  if (stake === 0) {
    // Nothing to charge.
  } else if (asset === "devnet") {
    await ensureCashAccount("escrow:" + match.id);
    ops.push(
      db
        .prepare("INSERT INTO cash_ledger(id, account_id, kind, amount, reference, created) SELECT ?, ?, 'match_entry', ?, ?, ? FROM runs WHERE id = ?")
        .bind(`${runId}:cash:entry`, cashAccountId(uid), -stake, match.id, now, runId),
      db
        .prepare("INSERT INTO cash_ledger(id, account_id, kind, amount, reference, created) SELECT ?, ?, 'escrow_funding', ?, ?, ? FROM runs WHERE id = ?")
        .bind(`${runId}:cash:escrow`, cashAccountId("escrow:" + match.id), stake, match.id, now, runId),
    );
  } else {
    ops.push(
      db
        .prepare("INSERT INTO ledger(id, user_id, match_id, kind, amount, created) SELECT ?, ?, ?, 'entry', ?, ? FROM runs WHERE id = ?")
        .bind(`${runId}:entry`, uid, match.id, -stake, now, runId),
    );
  }
  await db.batch(ops);

  const row = await db
    .prepare(`SELECT ${PUBLIC_RUN} FROM runs r JOIN matches m ON m.id = r.match_id WHERE r.id = ? AND r.user_id = ?`)
    .bind(runId, uid)
    .first<RunRecord>();
  if (!row) throw new GameError("That opponent was just matched. Please try again.", 409);
  return publicRun(row);
}

/** Matchmaking: takes the oldest open seat at this entry, or opens one. */
export async function startMatch(uid: string, stakeInput: unknown, assetInput: unknown): Promise<Run> {
  const { asset, stake, active } = await assertCanEnter(uid, stakeInput, assetInput);
  if (active) return active;
  const rulesets = SUPPORTED_RULESETS.map(Number).join(", ");
  const match = await database()
    .prepare(
      `SELECT id, seed, stake, asset, p1, p2, settled, ruleset, row_key FROM matches
       WHERE stake = ? AND asset = ? AND p2 IS NULL AND p1 <> ? AND settled = 0
         AND ruleset IN (${rulesets}) AND ${JOINABLE} AND ${PUBLIC_SEAT}
       ORDER BY created ASC LIMIT 1`,
    )
    .bind(stake, asset, uid)
    .first<MatchRow>();
  return enterMatch(uid, stake, asset, match, null);
}

/** Codes travel in links and chat messages: short, unambiguous, hard to guess. */
const inviteCode = () => Array.from(crypto.getRandomValues(new Uint8Array(9)), (b) => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]).join("");

/**
 * Opens a match public matchmaking never hands out: only its link takes the
 * other seat. With `opponentName`, only that player may take it, and they are told.
 */
export async function createChallenge(uid: string, stakeInput: unknown, assetInput: unknown, opponentName?: unknown): Promise<Run> {
  // Only a challenge may be played for nothing: matchmaking never hands one out.
  const { asset, stake, active } = await assertCanEnter(uid, stakeInput, assetInput, true);
  if (active) return active;
  const db = database();
  let invited: { id: string; name: string } | null = null;
  const wanted = String(opponentName ?? "").trim();
  if (wanted) {
    invited = await db.prepare("SELECT id, name FROM players WHERE lower(name) = lower(?)").bind(wanted).first<{ id: string; name: string }>();
    if (!invited) throw new GameError("No player by that name.", 404);
    if (invited.id === uid) throw new GameError("You cannot challenge yourself.");
    if (await blockedBetween(uid, invited.id)) throw new GameError(BLOCKED_MESSAGE, 403);
  }
  const code = inviteCode();
  const run = await enterMatch(uid, stake, asset, null, { code, invited: invited?.id ?? null });
  if (invited) {
    const from = await db.prepare("SELECT name FROM players WHERE id = ?").bind(uid).first<{ name: string }>();
    const data: ChallengeNotification = { matchId: run.match_id, invite: code, asset, stake, from: from?.name ?? "A player" };
    await db.batch([notificationInsert(db, `challenge:${run.match_id}`, invited.id, "challenge", data, Date.now())]);
  }
  return run;
}

/** Takes the seat of a private match from its link. */
export async function joinChallenge(uid: string, codeInput: unknown): Promise<Run> {
  const code = String(codeInput ?? "").trim().toLowerCase();
  if (!/^[a-z0-9]{4,32}$/.test(code)) throw new GameError("That challenge link is not valid.", 404);
  const db = database();
  const match = await db
    .prepare("SELECT id, seed, stake, asset, p1, p2, settled, ruleset, row_key, invited FROM matches WHERE invite = ? AND settled = 0")
    .bind(code)
    .first<MatchRow & { invited: string | null }>();
  if (!match) throw new GameError("This challenge has expired or was already played.", 404);
  if (match.p1 === uid) {
    const own = await activeRun(uid);
    if (own && own.match_id === match.id) return own;
    throw new GameError("This is your own challenge. Send the link to a rival.", 409);
  }
  if (match.p2) throw new GameError("Someone already took this seat.", 409);
  if (await blockedBetween(uid, match.p1)) throw new GameError(BLOCKED_MESSAGE, 403);
  if (match.invited && match.invited !== uid) throw new GameError("This challenge was sent to another player.", 403);
  // The entry comes from the match, not the caller, so a friendly seat is allowed.
  const { asset, stake, active } = await assertCanEnter(uid, match.stake, match.asset, true);
  if (active) return active;
  return enterMatch(uid, stake, asset, match, null);
}

/**
 * Applies one shot (or a forfeit) to the player's run. `allowed` lets the caller
 * run its rate-limit check concurrently with loading the run: the save path is
 * on every shot, so each database round trip saved is felt by the player.
 */
export async function playShot(
  uid: string,
  runIdInput: unknown,
  revision: unknown,
  action: "shot" | "forfeit",
  angle?: unknown,
  allowed: Promise<boolean> | boolean = true,
  guard: ShotGuard = {},
): Promise<Run> {
  const db = database();
  const [record, permitted] = await Promise.all([
    db
      .prepare(
        `SELECT ${PUBLIC_RUN}, m.row_key, ${suspendedSql("r.user_id")} AS suspended, ${SHOT_HISTORY_SQL("'m-' || r.id")}
         FROM runs r JOIN matches m ON m.id = r.match_id WHERE r.id = ? AND r.user_id = ?`,
      )
      .bind(String(runIdInput), uid)
      .first<RunRecord & ShotHistory & { row_key: string | null; suspended: number }>(),
    allowed,
  ]);
  if (!permitted) throw new GameError("Too many requests. Wait a minute before trying again.", 429);
  if (!record) throw new GameError("Game not found.", 404);
  // The row key and the anti-cheat history stay on the server.
  const { row_key: rowKey, suspended, previous_at, previous_ticks, timing_strikes, anti_cheat_on, trap: trapJson, ...row } = record;
  if (suspended) throw new GameError(SUSPENDED_MESSAGE, 403);
  if (row.done || row.revision !== revision) throw new GameError("This game changed in another tab. Reload to resume.", 409);

  const run = parseRun({ ...row, trap: null });
  const runKey = `m-${run.id}`;
  let state = run.state;
  let ticks: number | null = null;
  const forfeit = action === "forfeit";
  const now = Date.now();
  const signals: Statement[] = [];
  if (forfeit) {
    state.over = true;
  } else {
    if (!validAngle(angle)) throw new GameError("Invalid aim angle.");
    if (!isSupportedRuleset(run.ruleset)) throw new GameError("This match uses a retired ruleset. It can only be forfeited.", 409);
    if (guard.proof) {
      const signed = reportSigned(runKey, run.revision, angle, guard);
      const findings = inspectShot({ proof: guard.proof, signed, ruleset: run.ruleset, now, previousShotAt: previous_at, previousTicks: previous_ticks, timingStrikes: timing_strikes });
      if (anti_cheat_on && findings.some((f) => f.level === "proof")) {
        const { disqualify } = await import("./anti-cheat");
        await disqualify(uid, runKey, findings, now);
        throw new GameError(AUTOMATION_DETECTED, 403);
      }
      signals.push(...recordedFindings(findings, !!anti_cheat_on).map((f) => signalInsert(db, uid, runKey, f, now)));
    }
    try {
      ({ game: state, ticks } = simulateShot(state, angle, run.ruleset, rowsFor(run.ruleset, rowKey)));
    } catch (e) {
      if (e instanceof ShotError) throw new GameError(e.message);
      throw e;
    }
  }
  // A shot is one round, and `bonus` marks a round that cleared the board.
  const clears = run.clears + (!forfeit && state.bonus ? 1 : 0);
  // Real-money boards may carry a ghost trap for the next round.
  const nextTrap = !forfeit && run.asset === "devnet" ? planTrap(runKey, run.revision + 1, state, run.ruleset) : null;
  const nextTrapJson = nextTrap ? JSON.stringify(nextTrap) : null;
  const [result] = await db.batch([
    db
      .prepare("UPDATE runs SET state = ?, score = ?, done = ?, forfeit = ?, clears = ?, finished = ?, trap = ?, revision = revision + 1 WHERE id = ? AND user_id = ? AND revision = ? AND done = 0")
      .bind(JSON.stringify(state), state.score, state.over ? 1 : 0, forfeit ? 1 : 0, clears, state.over ? now : null, nextTrapJson, run.id, uid, run.revision),
    shotInsert(db, runKey, "runs", run.id, run.revision, forfeit ? null : (angle as number), now, ticks, forfeit ? null : (guard.aim ?? null)),
    ...signals,
  ]);
  if (!result.meta.changes) throw new GameError("This shot was already processed. Reload to resume.", 409);
  // Real-money shots are rated against every other angle once the player has their answer.
  if (!forfeit && guard.defer && run.asset === "devnet") {
    const before = run.state;
    const aimMs = guard.proof?.aimMs ?? null;
    const aim = guard.aim ?? null;
    const shown = parseTrap(trapJson);
    const trap = shown?.revision === run.revision ? shown : null;
    guard.defer(() => analyzeShot({ uid, runKey, revision: run.revision, before, angle: angle as number, ruleset: run.ruleset, rowKey, aimMs, aim, trap, evaluate: state.over }));
  }
  if (state.over) await settle(run.match_id);
  return presentRun({ ...run, state, score: state.score, done: state.over ? 1 : 0, forfeit: forfeit ? 1 : 0, clears, revision: run.revision + 1 }, runKey, nextTrapJson);
}
