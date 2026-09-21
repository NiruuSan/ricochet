import { database, type Statement } from "@/db/raw";
import type { Asset, MatchNotification } from "./api-types";
import { GameError } from "./matches";
import { notificationInsert } from "./notifications";
import { cashAccountId, ensureCashAccount } from "./payments/accounts";

// Closing a match without a winner and handing every entry back. An
// administrator does it by hand (lib/admin-games.ts) and the sweep does it when
// a seat nobody took has waited long enough (lib/expiry.ts).

type MatchRow = { id: string; asset: Asset; stake: number; p1: string; p2: string | null; settled: number };
type RunRow = { id: string; user_id: string; score: number };

/**
 * Closes an unsettled match and returns every entry in full, with no house fee.
 * Both runs end where they are, the match counts as cancelled (so it earns no
 * experience and no race score), and each player is told, with `reason` in their
 * notice. `extra` carries the caller's own rows (an audit trail) into the same
 * transaction. Refund IDs are per match and per player: a match cannot pay twice.
 */
export async function refundMatch(matchId: string, reason: string, now: number, extra: (runs: RunRow[], match: MatchRow) => Statement[] = () => []) {
  const db = database();
  const match = await db.prepare("SELECT id, asset, stake, p1, p2, settled FROM matches WHERE id = ?").bind(matchId).first<MatchRow>();
  if (!match) throw new GameError("Match not found.", 404);
  if (match.settled) throw new GameError("This match has already settled.", 409);
  const runs = (await db.prepare("SELECT id, user_id, score FROM runs WHERE match_id = ?").bind(matchId).all<RunRow>()).results;
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
  if (match.stake === 0) {
    // A friendly had no entry to give back.
  } else if (match.asset === "devnet") {
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
  }
  ops.push(...extra(runs, match));
  const [applied] = await db.batch(ops);
  if (!applied.meta.changes) throw new GameError("This match has already settled.", 409);
  return { refunded: match.stake * runs.length, players: runs.length, asset: match.asset };
}
