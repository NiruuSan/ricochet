import { database, type Statement } from "@/db/raw";
import { adminAudit, adminNote } from "./admin";
import type { AdminGame, Asset, MatchNotification } from "./api-types";
import { avatarUrl, GameError } from "./matches";
import { notificationInsert } from "./notifications";
import { matchWatchId } from "./spectate";
import { cashAccountId, ensureCashAccount } from "./payments/accounts";

// The administrator's view of 1v1 matches that have not settled, and the call to
// close one and hand every entry back. Tournaments are cancelled from their own
// tab, which refunds their entries the same way.

type GameRow = { id: string; asset: Asset; stake: number; created: number; seat_open: number; last_shot: number | null };
type RunRow = {
  id: string;
  match_id: string;
  user_id: string;
  name: string;
  avatar: string | null;
  score: number;
  round: number;
  done: number;
  forfeit: number;
  last_shot: number | null;
};

const LIMIT = 60;

/** Every unsettled match, most recently played first, with both sides. */
export async function adminGames(): Promise<AdminGame[]> {
  const db = database();
  const [matches, runs] = await Promise.all([
    db
      .prepare(
        `SELECT m.id, m.asset, m.stake, m.created, m.p2 IS NULL AS seat_open,
           (SELECT MAX(s.created) FROM run_shots s JOIN runs r ON s.run_key = 'm-' || r.id WHERE r.match_id = m.id) AS last_shot
         FROM matches m WHERE m.settled = 0
         ORDER BY COALESCE(last_shot, m.created) DESC LIMIT ?`,
      )
      .bind(LIMIT)
      .all<GameRow>(),
    db
      .prepare(
        `SELECT r.id, r.match_id, r.user_id, p.name, p.avatar, r.score, json_extract(r.state, '$.round') AS round, r.done, r.forfeit,
           (SELECT MAX(s.created) FROM run_shots s WHERE s.run_key = 'm-' || r.id) AS last_shot
         FROM runs r JOIN players p ON p.id = r.user_id
         WHERE r.match_id IN (SELECT id FROM matches WHERE settled = 0)
         ORDER BY r.created`,
      )
      .all<RunRow>(),
  ]);
  return matches.results.map((m): AdminGame => {
    const sides = runs.results.filter((r) => r.match_id === m.id);
    return {
      id: m.id,
      asset: m.asset,
      stake: m.stake,
      created: m.created,
      lastShot: m.last_shot,
      seatOpen: !!m.seat_open,
      // One entry was taken per run, and cancelling returns each in full.
      refund: m.stake * sides.length,
      players: sides.map((r) => ({
        name: r.name,
        avatar: avatarUrl(r.avatar),
        score: r.score,
        round: r.round,
        done: !!r.done,
        forfeit: !!r.forfeit,
        watchId: matchWatchId(r.id),
        lastShot: r.last_shot,
      })),
    };
  });
}

/**
 * Administrator: closes a match that has not settled and returns every entry in
 * full, with no house fee. Both runs end where they are, the match counts as
 * cancelled (so it earns no experience and no race score), and each player is
 * told. Refund IDs are per player and per match, so a cancellation cannot pay twice.
 */
export async function cancelMatchAsAdmin(adminUid: string, idInput: unknown, reasonInput: unknown, now = Date.now()) {
  const db = database();
  const matchId = String(idInput ?? "");
  const reason = adminNote(reasonInput, true);
  const match = await db
    .prepare("SELECT id, asset, stake, p1, p2, settled FROM matches WHERE id = ?")
    .bind(matchId)
    .first<{ id: string; asset: Asset; stake: number; p1: string; p2: string | null; settled: number }>();
  if (!match) throw new GameError("Match not found.", 404);
  if (match.settled) throw new GameError("This match has already settled.", 409);
  const runs = (await db.prepare("SELECT id, user_id, score FROM runs WHERE match_id = ?").bind(matchId).all<{ id: string; user_id: string; score: number }>()).results;
  if (!runs.length) throw new GameError("This match has no entry to refund.", 409);
  const names = (await db.prepare(`SELECT id, name FROM players WHERE id IN (${runs.map(() => "?").join(", ")})`).bind(...runs.map((r) => r.user_id)).all<{ id: string; name: string }>()).results;
  const nameOf = (uid: string) => names.find((p) => p.id === uid)?.name ?? null;

  // Every refund selects from the match row, so it only applies if this batch's
  // UPDATE is the one that cancelled the match.
  const cancelled = "FROM matches WHERE id = ? AND cancelled = 1";
  const ops: Statement[] = [
    db.prepare("UPDATE matches SET settled = 1, cancelled = 1, fee = 0 WHERE id = ? AND settled = 0").bind(matchId),
    db.prepare("UPDATE runs SET done = 1, finished = COALESCE(finished, ?) WHERE match_id = ? AND done = 0").bind(now, matchId),
  ];
  if (match.asset === "devnet") {
    for (const run of runs) {
      ops.push(
        db
          .prepare(`INSERT OR IGNORE INTO cash_ledger(id, account_id, kind, amount, reference, created) SELECT ?, ?, 'match_refund', ?, ?, ? ${cancelled}`)
          .bind(`${matchId}:cash:refund:${run.user_id}`, cashAccountId(run.user_id), match.stake, matchId, now, matchId),
      );
    }
    await ensureCashAccount("escrow:" + matchId);
    ops.push(
      db
        .prepare(`INSERT OR IGNORE INTO cash_ledger(id, account_id, kind, amount, reference, created) SELECT ?, ?, 'escrow_release', ?, ?, ? ${cancelled}`)
        .bind(`${matchId}:cash:release`, cashAccountId("escrow:" + matchId), -match.stake * runs.length, matchId, now, matchId),
    );
  } else {
    for (const run of runs) {
      ops.push(
        db
          .prepare(`INSERT OR IGNORE INTO ledger(id, user_id, match_id, kind, amount, created) SELECT ?, ?, ?, 'refund', ?, ? ${cancelled}`)
          .bind(`${matchId}:refund:${run.user_id}`, run.user_id, matchId, match.stake, now, matchId),
      );
    }
  }
  for (const run of runs) {
    const other = runs.find((r) => r.user_id !== run.user_id) ?? null;
    const data: MatchNotification = {
      matchId,
      asset: match.asset,
      stake: match.stake,
      result: "cancelled",
      net: 0,
      opponent: other ? nameOf(other.user_id) : null,
      score: run.score,
      opponentScore: other?.score ?? 0,
      reason,
    };
    ops.push(notificationInsert(db, `${matchId}:cancelled:${run.user_id === match.p1 ? "p1" : "p2"}`, run.user_id, "match_result", data, now));
    ops.push(adminAudit(adminUid, "match_cancel", run.user_id, `${reason} · match ${matchId} · refunded ${match.stake}`, now));
  }
  const [applied] = await db.batch(ops);
  if (!applied.meta.changes) throw new GameError("This match has already settled.", 409);
  return { refunded: match.stake * runs.length, players: runs.length };
}
