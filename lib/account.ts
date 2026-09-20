import { database } from "@/db/raw";
import { GameError } from "./matches";
import { cashAccountId } from "./payments/accounts";
import { signOutEverywhere } from "./sessions";

/**
 * What a player may take with them, and what happens when they leave.
 *
 * The export is every row the site holds about them, as it is stored, minus the
 * things that are not theirs to have: the key their wallet is encrypted with,
 * the secret behind their authenticator, the keys that generate match rows.
 *
 * Deleting is not a DELETE. Both sides of every match, and every line of the
 * ledger that balances against another account, refer to the player's row: it
 * stays, with its identity scrubbed, and everything personal around it goes.
 * Signing in again starts a fresh profile on the same row.
 */

/** One section of the export: a label, the rows behind it, and how they are looked up. */
const SECTIONS: { name: string; sql: string; by: "user" | "account" }[] = [
  { name: "profile", sql: "SELECT id, name, public_id, balance, created, last_seen, avatar FROM players WHERE id = ?", by: "user" },
  { name: "games", sql: "SELECT id, match_id, score, revision, done, forfeit, clears, created, finished FROM runs WHERE user_id = ? ORDER BY created", by: "user" },
  {
    name: "matches",
    sql: `SELECT m.id, m.asset, m.stake, m.fee, m.settled, m.cancelled, m.created,
            CASE WHEN m.winner IS NULL THEN NULL WHEN m.winner = ? THEN 'you' ELSE 'opponent' END AS outcome,
            (SELECT p.name FROM players p WHERE p.id = CASE WHEN m.p1 = ? THEN m.p2 ELSE m.p1 END) AS opponent
          FROM matches m WHERE m.p1 = ? OR m.p2 = ? ORDER BY m.created`,
    by: "user",
  },
  { name: "tournamentEntries", sql: "SELECT id, tournament_id, score, clears, rank, payout, done, forfeit, registered, started, finished FROM tournament_entries WHERE user_id = ? ORDER BY registered", by: "user" },
  { name: "gemLedger", sql: "SELECT id, match_id, kind, amount, created FROM ledger WHERE user_id = ? ORDER BY created", by: "user" },
  { name: "dailyGems", sql: "SELECT day, streak, amount, created FROM daily_claims WHERE user_id = ? ORDER BY day", by: "user" },
  { name: "referral", sql: "SELECT referral_code, referral_level FROM players WHERE id = ?", by: "user" },
  { name: "referralCodes", sql: "SELECT code, created FROM referral_codes WHERE user_id = ? ORDER BY created", by: "user" },
  {
    name: "referredBy",
    sql: "SELECT (SELECT p.name FROM players p WHERE p.id = r.referrer_id) AS referrer, r.level, r.discount_until, r.created FROM referrals r WHERE r.user_id = ?",
    by: "user",
  },
  { name: "referredPlayers", sql: "SELECT (SELECT p.name FROM players p WHERE p.id = r.user_id) AS name, r.level, r.created FROM referrals r WHERE r.referrer_id = ? ORDER BY r.created", by: "user" },
  { name: "notifications", sql: "SELECT id, kind, data, created, read_at FROM notifications WHERE user_id = ? ORDER BY created", by: "user" },
  { name: "pushDevices", sql: "SELECT endpoint, created FROM push_subscriptions WHERE user_id = ? ORDER BY created", by: "user" },
  { name: "twoFactor", sql: "SELECT enabled, enabled_at FROM two_factor WHERE user_id = ?", by: "user" },
  { name: "suspensions", sql: "SELECT status, source, reason, created, reviewed_at FROM player_suspensions WHERE user_id = ? ORDER BY created", by: "user" },
  { name: "depositAddresses", sql: "SELECT address, network, created FROM custody_wallets WHERE owner = ? ORDER BY created", by: "user" },
  { name: "transfers", sql: "SELECT id, kind, amount, fee, destination, signature, status, error, created, updated FROM cash_transfers WHERE user_id = ? ORDER BY created", by: "user" },
  { name: "solLedger", sql: "SELECT id, kind, amount, reference, created FROM cash_ledger WHERE account_id = ? ORDER BY created", by: "account" },
  { name: "solBalance", sql: "SELECT balance FROM cash_accounts WHERE id = ?", by: "account" },
];

/** Every row the site holds about this player, ready to hand over as a file. */
export async function exportAccount(uid: string, now = Date.now()) {
  const db = database();
  const account = cashAccountId(uid);
  const data: Record<string, unknown[]> = {};
  for (const section of SECTIONS) {
    // The matches query names the player in four places; the others once.
    const args = section.by === "account" ? [account] : Array<string>(section.sql.split("?").length - 1).fill(uid);
    data[section.name] = (await db.prepare(section.sql).bind(...args).all()).results;
  }
  return {
    exportedAt: now,
    about: "Everything Bounce stores about your account. Amounts in lamports (1 SOL = 1,000,000,000) or whole gems.",
    ...data,
  };
}

/** What still has to finish before an account can be closed. */
async function blockers(uid: string) {
  const db = database();
  const account = cashAccountId(uid);
  const [run, match, tournament, funds, transfer] = await Promise.all([
    db.prepare("SELECT 1 AS x FROM runs WHERE user_id = ? AND done = 0").bind(uid).first(),
    db.prepare("SELECT 1 AS x FROM runs r JOIN matches m ON m.id = r.match_id WHERE r.user_id = ? AND m.settled = 0").bind(uid).first(),
    db
      .prepare("SELECT 1 AS x FROM tournament_entries e JOIN tournaments t ON t.id = e.tournament_id WHERE e.user_id = ? AND t.status = 'scheduled'")
      .bind(uid)
      .first(),
    db.prepare("SELECT balance FROM cash_accounts WHERE id = ?").bind(account).first<{ balance: number }>(),
    db.prepare("SELECT 1 AS x FROM cash_transfers WHERE user_id = ? AND status IN ('pending', 'review')").bind(uid).first(),
  ]);
  if (run) return "Finish or forfeit your game first, then delete your account.";
  if (match) return "One of your matches is still being played. It settles once both players finish.";
  if (tournament) return "You are entered in a tournament that has not ended yet.";
  if (transfer) return "A transfer is still being confirmed on-chain. Try again in about a minute.";
  if (funds && funds.balance > 0) return "Withdraw your devnet SOL first: deleting an account does not send it anywhere.";
  return null;
}

/** A name nobody can be reached by, and nobody else can take. */
const anonymousName = () => `deleted-${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`;

/**
 * Closes the account: the name, the picture, the notifications, the devices and
 * the authenticator go; the ledger and the matches keep their rows, with nobody
 * behind them. Signing in again offers a new profile on the same row.
 */
export async function deleteAccount(uid: string, now = Date.now()) {
  const db = database();
  const player = await db.prepare("SELECT id FROM players WHERE id = ? AND deleted IS NULL").bind(uid).first();
  if (!player) throw new GameError("There is no account to delete.", 404);
  const blocked = await blockers(uid);
  if (blocked) throw new GameError(blocked, 409);
  // Whatever is still signed in to this account stops being signed in to it.
  // Its notice goes with the others in the batch below.
  await signOutEverywhere(uid, now);
  await db.batch([
    db.prepare("UPDATE players SET name = ?, avatar = NULL, deleted = ? WHERE id = ? AND deleted IS NULL").bind(anonymousName(), now, uid),
    db.prepare("DELETE FROM avatars WHERE user_id = ?").bind(uid),
    db.prepare("DELETE FROM notifications WHERE user_id = ?").bind(uid),
    db.prepare("DELETE FROM push_subscriptions WHERE user_id = ?").bind(uid),
    db.prepare("DELETE FROM two_factor WHERE user_id = ?").bind(uid),
    db.prepare("DELETE FROM two_factor_recovery WHERE user_id = ?").bind(uid),
    db.prepare("DELETE FROM daily_claims WHERE user_id = ?").bind(uid),
  ]);
  return { deleted: true as const, at: now };
}
