import { database } from "@/db/raw";
import { adminAudit, adminNote } from "./admin";
import { openPlay } from "./account";
import { GameError } from "./matches";
import { cashAccountId, ensureCashAccount, HOUSE } from "./payments/accounts";
import { verifySecondFactor } from "./two-factor";

/**
 * The register of players, and — while the site is still being built — the way
 * to take one off it for good.
 *
 * A player deleting their own account keeps its rows, because the ledger and
 * both sides of every match refer to them (lib/account.ts). This does not: it
 * removes the account and everything attached to it, including the matches it
 * played, which are the opponent's history too. It exists to clear test
 * accounts out of a development database and is meant to be deleted with this
 * comment once the site is live.
 *
 * What it will not do is make money disappear: whatever devnet SOL is left goes
 * to the treasury first, in its own ledger line, so the pool still owes exactly
 * what it holds.
 */

export type AdminPlayer = {
  name: string;
  created: number;
  lastSeen: number;
  gems: number;
  sol: number;
  games: number;
  suspended: number;
  deleted: number | null;
};

/** Everyone who ever made a profile, newest first. Names only: player IDs stay on the server. */
export async function adminPlayers(limit = 200): Promise<AdminPlayer[]> {
  const { results } = await database()
    .prepare(
      `SELECT p.name, p.created, p.last_seen AS lastSeen, p.balance AS gems, p.deleted,
         COALESCE((SELECT a.balance FROM cash_accounts a WHERE a.id = 'devnet:' || p.id), 0) AS sol,
         (SELECT COUNT(*) FROM runs r WHERE r.user_id = p.id) AS games,
         EXISTS (SELECT 1 FROM player_suspensions s WHERE s.user_id = p.id AND s.status IN ('suspended', 'banned')) AS suspended
       FROM players p ORDER BY p.created DESC LIMIT ?`,
    )
    .bind(limit)
    .all<AdminPlayer>();
  return results;
}

/**
 * Everything a player's record is made of. Deleting these is what resets their
 * statistics: every number on a profile, a leaderboard or a rank is counted
 * from these rows, and the ledger is left alone, so no balance moves.
 */
const GAME_ROWS = [
  // The shot log of every run of theirs, and of every match they were in.
  "DELETE FROM run_shots WHERE run_key IN (SELECT 'm-' || r.id FROM runs r WHERE r.user_id = ? OR r.match_id IN (SELECT m.id FROM matches m WHERE m.p1 = ? OR m.p2 = ?))",
  "DELETE FROM runs WHERE user_id = ? OR match_id IN (SELECT m.id FROM matches m WHERE m.p1 = ? OR m.p2 = ?)",
  "DELETE FROM matches WHERE p1 = ? OR p2 = ?",
  "DELETE FROM run_shots WHERE run_key IN (SELECT 't-' || e.id FROM tournament_entries e WHERE e.user_id = ?)",
  "DELETE FROM tournament_entries WHERE user_id = ?",
  "DELETE FROM weekly_race_exclusions WHERE user_id = ?",
  "DELETE FROM daily_claims WHERE user_id = ?",
];

/** Every table that belongs to a player, in the order a purge empties them. */
const PURGE = [
  ...GAME_ROWS,
  "DELETE FROM ledger WHERE user_id = ?",
  "DELETE FROM cash_ledger WHERE account_id = 'devnet:' || ?",
  "DELETE FROM cash_transfers WHERE user_id = ?",
  "DELETE FROM cash_accounts WHERE user_id = ?",
  "DELETE FROM custody_wallets WHERE owner = ?",
  "DELETE FROM push_deliveries WHERE subscription_id IN (SELECT id FROM push_subscriptions WHERE user_id = ?)",
  "DELETE FROM push_subscriptions WHERE user_id = ?",
  "DELETE FROM notifications WHERE user_id = ?",
  "DELETE FROM avatars WHERE user_id = ?",
  "DELETE FROM bug_reports WHERE user_id = ?",
  "UPDATE bug_report_attachments SET user_id = '', name = '' WHERE user_id = ?",
  "DELETE FROM two_factor_recovery WHERE user_id = ?",
  "DELETE FROM two_factor WHERE user_id = ?",
  "DELETE FROM security_holds WHERE user_id = ?",
  "DELETE FROM session_resets WHERE user_id = ?",
  "DELETE FROM player_activity WHERE user_id = ?",
  "DELETE FROM player_suspensions WHERE user_id = ?",
  "DELETE FROM cheat_signals WHERE user_id = ?",
  "DELETE FROM shot_analysis WHERE user_id = ?",
  "DELETE FROM referral_codes WHERE user_id = ?",
  "DELETE FROM referrals WHERE user_id = ? OR referrer_id = ?",
  "DELETE FROM players WHERE id = ?",
];

/**
 * Removes a player and everything of theirs. The administrator's own second
 * factor is required, and the decision is written to the audit log, which is
 * the one record that outlives the account.
 */
export async function purgePlayer(adminUid: string, nameInput: unknown, codeInput: unknown, reasonInput: unknown, now = Date.now()) {
  const reason = adminNote(reasonInput, true);
  const name = String(nameInput ?? "").trim();
  const db = database();
  const player = await db.prepare("SELECT id, name FROM players WHERE lower(name) = lower(?)").bind(name).first<{ id: string; name: string }>();
  if (!player) throw new GameError("No player by that name.", 404);
  if (player.id === adminUid) throw new GameError("You cannot delete the account you are signed in with.");
  // Money still committed to a game cannot be cleaned up: settle or cancel it first.
  const blocked = await openPlay(player.id);
  if (blocked) throw new GameError(blocked, 409);
  await verifySecondFactor(adminUid, codeInput, now);

  const account = cashAccountId(player.id);
  const funds = await db.prepare("SELECT balance FROM cash_accounts WHERE id = ?").bind(account).first<{ balance: number }>();
  const swept = Math.max(0, Number(funds?.balance ?? 0));
  const ops = [];
  if (swept > 0) {
    await ensureCashAccount(HOUSE);
    // The balance leaves the account before the account leaves the database, so
    // the pool's liabilities never move.
    ops.push(
      db
        .prepare("INSERT INTO cash_ledger(id, account_id, kind, amount, reference, created) VALUES(?, ?, 'account_closure', ?, ?, ?)")
        .bind(`closure:${player.id}:${now}`, account, -swept, player.id, now),
      db
        .prepare("INSERT INTO cash_ledger(id, account_id, kind, amount, reference, created) VALUES(?, ?, 'account_closure', ?, ?, ?)")
        .bind(`closure:${player.id}:${now}:house`, cashAccountId(HOUSE), swept, player.id, now),
    );
  }
  for (const sql of PURGE) ops.push(db.prepare(sql).bind(...Array<string>(sql.split("?").length - 1).fill(player.id)));
  ops.push(adminAudit(adminUid, "player_deleted", player.id, `${reason} · ${swept} lamports to the treasury`, now));
  await db.batch(ops);
  return { name: player.name, swept };
}

/**
 * Puts a player's record back to nothing: no games, no scores, no profit and
 * loss, no rank, no streak. Their balances, their wallet and every line of the
 * ledger stay exactly as they are — nothing here moves money.
 *
 * The matches go with the runs, which means they also leave the history of
 * whoever played against them. That is the price of a record counted from the
 * games themselves, and the reason this is an administrator's tool.
 */
export async function resetPlayerStats(adminUid: string, nameInput: unknown, reasonInput: unknown, now = Date.now()) {
  const reason = adminNote(reasonInput, true);
  const name = String(nameInput ?? "").trim();
  const db = database();
  const player = await db.prepare("SELECT id, name FROM players WHERE lower(name) = lower(?)").bind(name).first<{ id: string; name: string }>();
  if (!player) throw new GameError("No player by that name.", 404);
  // A game still running would leave its entry committed to a match nobody owns.
  const blocked = await openPlay(player.id);
  if (blocked) throw new GameError(blocked, 409);
  const counted = await db
    .prepare("SELECT (SELECT COUNT(*) FROM matches WHERE p1 = ? OR p2 = ?) AS matches, (SELECT COUNT(*) FROM tournament_entries WHERE user_id = ?) AS entries")
    .bind(player.id, player.id, player.id)
    .first<{ matches: number; entries: number }>();
  const ops = GAME_ROWS.map((sql) => db.prepare(sql).bind(...Array<string>(sql.split("?").length - 1).fill(player.id)));
  ops.push(adminAudit(adminUid, "player_stats_reset", player.id, `${reason} · ${counted?.matches ?? 0} matches, ${counted?.entries ?? 0} tournament entries`, now));
  await db.batch(ops);
  return { name: player.name, matches: Number(counted?.matches ?? 0), entries: Number(counted?.entries ?? 0) };
}
