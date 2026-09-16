import { adminId, database, type Statement } from "@/db/raw";
import { wageredSql } from "./experience";
import { experienceFromWagered, levelFor } from "./levels";
import { initial, isSupportedRuleset, RULESET, ShotError, simulate, SUPPORTED_RULESETS, validAngle, type Game } from "./engine";
import type { Asset, Leader, MatchNotification, MatchRecap, MatchResult, MatchSummary, Profile, RecapSide, Run, Snapshot } from "./api-types";
import { cancelRefund, isStake, SOL_WIN_GEM_BONUS, winnerFee, winnerPayout } from "./api-types";
import { cashAccountId, ensureCashAccount, HOUSE, settings } from "./payments/accounts";
import { launchStatus, requireDevnet } from "./payments/policy";
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
type MatchRow = { id: string; seed: number; stake: number; asset: Asset; p1: string; p2: string | null; settled: number; ruleset: number; row_key: string | null };

const PUBLIC_RUN = "r.id, r.match_id, r.state, r.revision, r.score, r.done, r.forfeit, r.clears, m.asset, m.ruleset";
type RunRecord = Omit<Run, "state"> & { state: string };
const parseRun = (row: RunRecord): Run => ({ ...row, state: JSON.parse(row.state) as Game });

/** Public URL of a stored profile picture. Keys are random, never user IDs. */
export const avatarUrl = (key: string | null) => (key ? `/api/avatars/${key}` : null);

// Before ruleset 4, a match whose creator forfeited before anyone joined is
// (or is about to be) cancelled, so nobody may join it. From ruleset 4 a forfeit
// only ends that run: its score stands and the seat stays open.
const JOINABLE = "(matches.ruleset >= 4 OR NOT EXISTS (SELECT 1 FROM runs f WHERE f.match_id = matches.id AND f.forfeit = 1))";

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
  if (runs.length !== 2 || runs.some((r) => !r.done)) return;

  const [a, b] = runs;
  const winner = decideWinner(m.ruleset, a, b);
  const now = Date.now();
  const payout = winner ? winnerPayout(m.stake, m.asset) : m.stake;
  const fee = winner ? winnerFee(m.stake, m.asset) : 0;
  const recipients = winner ? [winner] : [a.user_id, b.user_id];
  const ops: Statement[] = [];
  if (m.asset === "devnet") {
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
  return row ? parseRun(row) : null;
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
         GROUP BY p.id ORDER BY pnl DESC, p.name ASC LIMIT 50`
      : `SELECT p.name, p.avatar, COALESCE(p.id = ?, 0) AS is_you, SUM(l.amount) AS pnl, COUNT(DISTINCT m.id) AS games, ${wageredSql("p.id")} AS wagered
         FROM players p
         JOIN cash_accounts a ON a.user_id = p.id AND a.network = 'devnet'
         JOIN cash_ledger l ON l.account_id = a.id
         JOIN matches m ON m.id = l.reference AND m.settled = 1 AND m.asset = 'devnet'
         WHERE l.kind IN ('match_entry', 'match_payout', 'match_refund')
         GROUP BY p.id ORDER BY pnl DESC, p.name ASC LIMIT 50`;
  const { results } = await database().prepare(sql).bind(viewer).all<Omit<Leader, "level"> & { wagered: number }>();
  return results.map(({ wagered, ...l }) => ({ ...l, avatar: avatarUrl(l.avatar), level: levelFor(experienceFromWagered(wagered)) }));
}

export async function playerSnapshot(uid: string, asset: Asset): Promise<Snapshot> {
  const db = database();
  await settleFinishedMatches(uid);
  const [player, history, active, cash, inbox, tournaments] = await Promise.all([
    db.prepare("SELECT public_id AS publicId, name, balance, avatar, created FROM players WHERE id = ?").bind(uid).first<Profile>(),
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
  ]);
  const admin = adminId();
  return {
    asset,
    cashBalance: cash?.balance ?? 0,
    launch: launchStatus(settings()),
    player: player && { ...player, avatar: avatarUrl(player.avatar) },
    matches: history.results.map(({ fee, ...m }) => ({ ...m, opponent_avatar: avatarUrl(m.opponent_avatar), net: netResult(m.result, m.stake, fee) })),
    active,
    isAdmin: !!admin && uid === admin,
    notifications: inbox.items,
    unreadNotifications: inbox.unread,
    tournaments,
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
    you: recapSide(row.name, row.avatar, row.state, row.clears, row.forfeit),
    opponent: row.other_name
      ? {
          name: row.other_name,
          avatar: avatarUrl(row.other_avatar),
          stats: reveal ? recapSide(row.other_name, row.other_avatar, row.other_state!, row.other_clears ?? 0, row.other_forfeit ?? 0) : null,
        }
      : null,
  };
}

export async function startMatch(uid: string, stakeInput: unknown, assetInput: unknown): Promise<Run> {
  const db = database();
  const asset = assetInput ?? "gems";
  if (asset !== "gems" && asset !== "devnet") throw new GameError("Unsupported match currency.");
  if (asset === "devnet") {
    requireDevnet(settings());
    await ensureCashAccount(uid);
  }
  const active = await activeRun(uid);
  if (active) return active;

  const stake = Number(stakeInput);
  if (!isStake(asset, stake)) throw new GameError("Choose one of the five entry amounts.");
  const available =
    asset === "gems"
      ? ((await db.prepare("SELECT balance FROM players WHERE id = ?").bind(uid).first<{ balance: number }>())?.balance ?? 0)
      : ((await db.prepare("SELECT balance FROM cash_accounts WHERE id = ?").bind(cashAccountId(uid)).first<{ balance: number }>())?.balance ?? 0);
  if (available < stake) {
    throw new GameError(asset === "gems" ? "Not enough gems. Practice is always free." : "Not enough deposited devnet SOL. Open your wallet to fund it.");
  }

  const rulesets = SUPPORTED_RULESETS.map(Number).join(", ");
  let match = await db
    .prepare(
      `SELECT id, seed, stake, asset, p1, p2, settled, ruleset, row_key FROM matches
       WHERE stake = ? AND asset = ? AND p2 IS NULL AND p1 <> ? AND settled = 0
         AND ruleset IN (${rulesets}) AND ${JOINABLE}
       ORDER BY created ASC LIMIT 1`,
    )
    .bind(stake, asset, uid)
    .first<MatchRow>();
  const runId = crypto.randomUUID();
  const now = Date.now();
  const ops: Statement[] = [];
  if (match) {
    ops.push(db.prepare(`UPDATE matches SET p2 = ? WHERE id = ? AND p2 IS NULL AND settled = 0 AND ${JOINABLE}`).bind(uid, match.id));
  } else {
    match = { id: crypto.randomUUID(), seed: crypto.getRandomValues(new Uint32Array(1))[0], stake, asset, p1: uid, p2: null, settled: 0, ruleset: RULESET, row_key: newRowKey() };
    ops.push(
      db
        .prepare("INSERT INTO matches(id, seed, stake, asset, p1, created, ruleset, row_key) VALUES(?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(match.id, match.seed, stake, asset, uid, now, RULESET, match.row_key),
    );
  }
  // The run and the entry only exist if this player really holds a seat, which
  // makes losing a race for the open seat a harmless no-op.
  ops.push(
    db
      .prepare("INSERT INTO runs(id, match_id, user_id, state, created) SELECT ?, ?, ?, ?, ? FROM matches WHERE id = ? AND (p1 = ? OR p2 = ?)")
      .bind(runId, match.id, uid, JSON.stringify(initial(match.seed, rowsFor(match.ruleset, match.row_key))), now, match.id, uid, uid),
  );
  if (asset === "devnet") {
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
  return parseRun(row);
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
): Promise<Run> {
  const db = database();
  const [record, permitted] = await Promise.all([
    db
      .prepare(`SELECT ${PUBLIC_RUN}, m.row_key FROM runs r JOIN matches m ON m.id = r.match_id WHERE r.id = ? AND r.user_id = ?`)
      .bind(String(runIdInput), uid)
      .first<RunRecord & { row_key: string | null }>(),
    allowed,
  ]);
  if (!permitted) throw new GameError("Too many requests. Wait a minute before trying again.", 429);
  if (!record) throw new GameError("Game not found.", 404);
  // The row key stays on the server: it is split off before anything is returned.
  const { row_key: rowKey, ...row } = record;
  if (row.done || row.revision !== revision) throw new GameError("This game changed in another tab. Reload to resume.", 409);

  const run = parseRun(row);
  let state = run.state;
  const forfeit = action === "forfeit";
  if (forfeit) {
    state.over = true;
  } else {
    if (!validAngle(angle)) throw new GameError("Invalid aim angle.");
    if (!isSupportedRuleset(run.ruleset)) throw new GameError("This match uses a retired ruleset. It can only be forfeited.", 409);
    try {
      state = simulate(state, angle, run.ruleset, rowsFor(run.ruleset, rowKey));
    } catch (e) {
      if (e instanceof ShotError) throw new GameError(e.message);
      throw e;
    }
  }
  // A shot is one round, and `bonus` marks a round that cleared the board.
  const clears = run.clears + (!forfeit && state.bonus ? 1 : 0);
  const [result] = await db.batch([
    db
      .prepare("UPDATE runs SET state = ?, score = ?, done = ?, forfeit = ?, clears = ?, revision = revision + 1 WHERE id = ? AND user_id = ? AND revision = ? AND done = 0")
      .bind(JSON.stringify(state), state.score, state.over ? 1 : 0, forfeit ? 1 : 0, clears, run.id, uid, run.revision),
    shotInsert(db, `m-${run.id}`, "runs", run.id, run.revision, forfeit ? null : (angle as number), Date.now()),
  ]);
  if (!result.meta.changes) throw new GameError("This shot was already processed. Reload to resume.", 409);
  if (state.over) await settle(run.match_id);
  return { ...run, state, score: state.score, done: state.over ? 1 : 0, forfeit: forfeit ? 1 : 0, clears, revision: run.revision + 1 };
}
