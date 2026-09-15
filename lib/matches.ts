import { adminId, database, type Statement } from "@/db/raw";
import { initial, isSupportedRuleset, RULESET, ShotError, simulate, SUPPORTED_RULESETS, validAngle, type Game } from "./engine";
import type { Asset, MatchResult, MatchSummary, Profile, Run, Snapshot } from "./api-types";
import { cancelRefund, isStake, winnerFee, winnerPayout } from "./api-types";
import { cashAccountId, ensureCashAccount, HOUSE, settings } from "./payments/accounts";
import { launchStatus, requireDevnet } from "./payments/policy";

/** An error whose message is safe to show and carries an HTTP status. */
export class GameError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

type RunRow = { user_id: string; done: number; forfeit: number; score: number };
type MatchRow = { id: string; seed: number; stake: number; asset: Asset; p1: string; p2: string | null; settled: number; ruleset: number };

const PUBLIC_RUN = "r.id, r.match_id, r.state, r.revision, r.score, r.done, r.forfeit, m.asset, m.ruleset";
type RunRecord = Omit<Run, "state"> & { state: string };
const parseRun = (row: RunRecord): Run => ({ ...row, state: JSON.parse(row.state) as Game });

/** Public URL of a stored profile picture. Keys are random, never user IDs. */
export const avatarUrl = (key: string | null) => (key ? `/api/avatars/${key}` : null);

// A match with a forfeited run and no second player has been (or is about to
// be) cancelled, so nobody may join it.
const NOT_FORFEITED = "NOT EXISTS (SELECT 1 FROM runs f WHERE f.match_id = matches.id AND f.forfeit = 1)";

export async function settle(matchId: string) {
  const db = database();
  const m = await db.prepare("SELECT * FROM matches WHERE id = ?").bind(matchId).first<MatchRow>();
  if (!m || m.settled) return;
  const runs = (await db.prepare("SELECT * FROM runs WHERE match_id = ?").bind(matchId).all<RunRow>()).results;
  if (!m.p2) return cancelUnjoined(m, runs);
  if (runs.length !== 2 || runs.some((r) => !r.done)) return;

  const [a, b] = runs;
  const winner =
    a.forfeit !== b.forfeit ? (a.forfeit ? b.user_id : a.user_id) : a.score === b.score ? null : a.score > b.score ? a.user_id : b.user_id;
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
  ops.push(db.prepare("UPDATE matches SET settled = 1, winner = ?, fee = ? WHERE id = ? AND settled = 0").bind(winner, fee, matchId));
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

function netResult(result: MatchResult | null, stake: number, fee: number) {
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

export async function playerSnapshot(uid: string, asset: Asset): Promise<Snapshot> {
  const db = database();
  await settleFinishedMatches(uid);
  const leaderQuery =
    asset === "gems"
      ? `SELECT p.name, p.avatar, p.id = ? AS is_you, COALESCE(SUM(l.amount), 0) AS pnl, COUNT(DISTINCT m.id) AS games
         FROM players p
         JOIN ledger l ON l.user_id = p.id
         JOIN matches m ON m.id = l.match_id AND m.settled = 1 AND m.asset = 'gems'
         GROUP BY p.id ORDER BY pnl DESC, p.name ASC LIMIT 50`
      : `SELECT p.name, p.avatar, p.id = ? AS is_you, SUM(l.amount) AS pnl, COUNT(DISTINCT m.id) AS games
         FROM players p
         JOIN cash_accounts a ON a.user_id = p.id AND a.network = 'devnet'
         JOIN cash_ledger l ON l.account_id = a.id
         JOIN matches m ON m.id = l.reference AND m.settled = 1 AND m.asset = 'devnet'
         WHERE l.kind IN ('match_entry', 'match_payout', 'match_refund')
         GROUP BY p.id ORDER BY pnl DESC, p.name ASC LIMIT 50`;
  const [player, history, transactions, leaders, active, cash] = await Promise.all([
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
    db.prepare("SELECT kind, amount, created FROM ledger WHERE user_id = ? ORDER BY created DESC LIMIT 50").bind(uid).all<Snapshot["transactions"][number]>(),
    db.prepare(leaderQuery).bind(uid).all<Snapshot["leaders"][number]>(),
    activeRun(uid),
    db.prepare("SELECT balance FROM cash_accounts WHERE id = ?").bind(cashAccountId(uid)).first<{ balance: number }>(),
  ]);
  const admin = adminId();
  return {
    asset,
    cashBalance: cash?.balance ?? 0,
    launch: launchStatus(settings()),
    player: player && { ...player, avatar: avatarUrl(player.avatar) },
    matches: history.results.map(({ fee, ...m }) => ({ ...m, opponent_avatar: avatarUrl(m.opponent_avatar), net: netResult(m.result, m.stake, fee) })),
    transactions: transactions.results,
    leaders: leaders.results.map((l) => ({ ...l, avatar: avatarUrl(l.avatar) })),
    active,
    isAdmin: !!admin && uid === admin,
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
      `SELECT id, seed, stake, asset, p1, p2, settled, ruleset FROM matches
       WHERE stake = ? AND asset = ? AND p2 IS NULL AND p1 <> ? AND settled = 0
         AND ruleset IN (${rulesets}) AND ${NOT_FORFEITED}
       ORDER BY created ASC LIMIT 1`,
    )
    .bind(stake, asset, uid)
    .first<MatchRow>();
  const runId = crypto.randomUUID();
  const now = Date.now();
  const ops: Statement[] = [];
  if (match) {
    ops.push(db.prepare(`UPDATE matches SET p2 = ? WHERE id = ? AND p2 IS NULL AND settled = 0 AND ${NOT_FORFEITED}`).bind(uid, match.id));
  } else {
    match = { id: crypto.randomUUID(), seed: crypto.getRandomValues(new Uint32Array(1))[0], stake, asset, p1: uid, p2: null, settled: 0, ruleset: RULESET };
    ops.push(
      db
        .prepare("INSERT INTO matches(id, seed, stake, asset, p1, created, ruleset) VALUES(?, ?, ?, ?, ?, ?, ?)")
        .bind(match.id, match.seed, stake, asset, uid, now, RULESET),
    );
  }
  // The run and the entry only exist if this player really holds a seat, which
  // makes losing a race for the open seat a harmless no-op.
  ops.push(
    db
      .prepare("INSERT INTO runs(id, match_id, user_id, state, created) SELECT ?, ?, ?, ?, ? FROM matches WHERE id = ? AND (p1 = ? OR p2 = ?)")
      .bind(runId, match.id, uid, JSON.stringify(initial(match.seed)), now, match.id, uid, uid),
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
  const [row, permitted] = await Promise.all([
    db
      .prepare(`SELECT ${PUBLIC_RUN} FROM runs r JOIN matches m ON m.id = r.match_id WHERE r.id = ? AND r.user_id = ?`)
      .bind(String(runIdInput), uid)
      .first<RunRecord>(),
    allowed,
  ]);
  if (!permitted) throw new GameError("Too many requests. Wait a minute before trying again.", 429);
  if (!row) throw new GameError("Game not found.", 404);
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
      state = simulate(state, angle, run.ruleset);
    } catch (e) {
      if (e instanceof ShotError) throw new GameError(e.message);
      throw e;
    }
  }
  const result = await db
    .prepare("UPDATE runs SET state = ?, score = ?, done = ?, forfeit = ?, revision = revision + 1 WHERE id = ? AND user_id = ? AND revision = ? AND done = 0")
    .bind(JSON.stringify(state), state.score, state.over ? 1 : 0, forfeit ? 1 : 0, run.id, uid, run.revision)
    .run();
  if (!result.meta.changes) throw new GameError("This shot was already processed. Reload to resume.", 409);
  if (state.over) await settle(run.match_id);
  return { ...run, state, score: state.score, done: state.over ? 1 : 0, forfeit: forfeit ? 1 : 0, revision: run.revision + 1 };
}
