import { database } from "@/db/raw";
import { adminAudit, adminNote } from "./admin";
import type { AdminGame, Asset } from "./api-types";
import { avatarUrl } from "./matches";
import { refundMatch } from "./refunds";
import { matchWatchId } from "./spectate";

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
 * full, with no house fee (lib/refunds.ts), with one audit row per refunded player.
 */
export async function cancelMatchAsAdmin(adminUid: string, idInput: unknown, reasonInput: unknown, now = Date.now()) {
  const reason = adminNote(reasonInput, true);
  const matchId = String(idInput ?? "");
  const { refunded, players } = await refundMatch(matchId, reason, now, (runs, match) =>
    runs.map((run) => adminAudit(adminUid, "match_cancel", run.user_id, `${reason} · match ${matchId} · refunded ${match.stake}`, now)),
  );
  return { refunded, players };
}
