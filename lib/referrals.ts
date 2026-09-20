import { database, type Database, type Statement } from "@/db/raw";
import type { Asset } from "./api-types";
import { adminAudit, adminNote } from "./admin";
import { GameError } from "./matches";
import { notificationInsert } from "./notifications";
import { cashAccountId, ensureCashAccount, HOUSE } from "./payments/accounts";

/**
 * Bringing players in.
 *
 * Every player has a code. Someone who signs up with it pays a reduced house
 * fee for a while — a day from an ordinary code, a week from a partner's. A
 * partner (level 2, granted by an administrator) also earns a share of what the
 * house actually keeps from the players they brought, for as long as they play.
 *
 * The reduction never touches how a match settles. The pot, the winner's payout
 * and the fee are exactly what they would be without any of this; the reduction
 * comes back afterwards as its own ledger line, win or lose, and the house pays
 * for it out of the fee it just took. So a player's opponent is never affected
 * by a discount they cannot see, and nobody gains an edge at the table.
 *
 * Gem matches are fee-free, so none of this applies to them.
 */
export const REFERRAL = {
  /** What a player normally funds of the house fee: 12% of their own stake. */
  standardFee: 12,
  /** What a referred player funds while their window is open. */
  discountedFee: 8,
  /** A level 2 partner's share of what the house keeps from a player they brought. */
  partnerShare: 10,
  /** How long the reduced fee lasts, by the level of the code that was used. */
  window: { 1: 24 * 60 * 60_000, 2: 7 * 24 * 60 * 60_000 } as Record<number, number>,
};

/** Codes travel in links and chat: short, unambiguous, hard to guess. */
const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");

/** What a player may choose for themselves. Codes live in URLs, so they stay plain. */
const CHOSEN = /^[a-z0-9]{4,20}$/;
/** Codes nobody gets to hand out: they would read as if the site sent them. */
const RESERVED = new Set([
  "admin", "administrator", "bounce", "official", "support", "help", "staff", "team", "moderator", "mod", "root",
  "system", "security", "wallet", "treasury", "house", "partner", "partners", "referral", "referrals", "signup", "login",
]);

/**
 * Takes a code for this player, if it is theirs to take. The row in
 * `referral_codes` is what decides: it is written once and never handed on, so
 * a link already shared keeps pointing at whoever shared it, and a code let go
 * of cannot be picked up by someone else.
 */
async function claim(uid: string, code: string, now: number, onlyIfUnset: boolean) {
  const db = database();
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO referral_codes(code, user_id, created) VALUES(?, ?, ?)").bind(code, uid, now),
    // Only moves the player's current code if that insert really was theirs.
    db
      .prepare(
        `UPDATE players SET referral_code = ? WHERE id = ?${onlyIfUnset ? " AND referral_code IS NULL" : ""}
         AND EXISTS (SELECT 1 FROM referral_codes WHERE code = ? AND user_id = ?)`,
      )
      .bind(code, uid, code, uid),
  ]);
  const saved = await db.prepare("SELECT referral_code FROM players WHERE id = ?").bind(uid).first<{ referral_code: string | null }>();
  return saved?.referral_code ?? null;
}

/** The player's own code, made the first time they ask for it. */
export async function referralCode(uid: string, now = Date.now()): Promise<string> {
  const db = database();
  for (let attempt = 0; attempt < 5; attempt++) {
    const row = await db.prepare("SELECT referral_code FROM players WHERE id = ? AND deleted IS NULL").bind(uid).first<{ referral_code: string | null }>();
    if (!row) throw new GameError("Create your player profile first.", 403);
    if (row.referral_code) return row.referral_code;
    // Two players can draw the same code at once; the table decides, and the next round reads it.
    const saved = await claim(uid, newCode(), now, true);
    if (saved) return saved;
  }
  throw new GameError("Your referral code could not be created. Try again.", 503);
}

/**
 * A code the player picked. Their previous codes stay theirs and keep working,
 * so switching never breaks a link they already sent, and never frees a code
 * for someone else to catch traffic with.
 */
export async function chooseReferralCode(uid: string, input: unknown, now = Date.now()) {
  const code = String(input ?? "").trim().toLowerCase();
  if (!CHOSEN.test(code)) throw new GameError("Use 4 to 20 letters or numbers — no spaces, no punctuation.");
  if (RESERVED.has(code) || code.startsWith("deleted")) throw new GameError("That code is reserved. Choose another one.");
  const db = database();
  const player = await db.prepare("SELECT referral_code FROM players WHERE id = ? AND deleted IS NULL").bind(uid).first<{ referral_code: string | null }>();
  if (!player) throw new GameError("Create your player profile first.", 403);
  if (player.referral_code === code) return { code };
  const owner = await db.prepare("SELECT user_id FROM referral_codes WHERE code = ?").bind(code).first<{ user_id: string }>();
  if (owner && owner.user_id !== uid) throw new GameError("That code is taken. Try another one.", 409);
  const saved = await claim(uid, code, now, false);
  if (saved !== code) throw new GameError("That code is taken. Try another one.", 409);
  return { code };
}

/** Every code this player has ever owned, newest first. */
export const referralCodeHistory = (uid: string) =>
  database().prepare("SELECT code, created FROM referral_codes WHERE user_id = ? ORDER BY created DESC").bind(uid).all<{ code: string; created: number }>();

/**
 * Records who brought this player in, as their profile is created. An unknown
 * code, or their own, is ignored: signing up must never fail over a link.
 */
export async function applyReferral(uid: string, codeInput: unknown, now = Date.now()) {
  const code = String(codeInput ?? "").trim().toLowerCase();
  if (!/^[a-z0-9]{4,32}$/.test(code)) return null;
  const db = database();
  // Any code the referrer has ever owned resolves to them, current or not.
  const referrer = await db
    .prepare(
      `SELECT p.id, p.name, p.referral_level FROM referral_codes c JOIN players p ON p.id = c.user_id
       WHERE c.code = ? AND p.deleted IS NULL`,
    )
    .bind(code)
    .first<{ id: string; name: string; referral_level: number }>();
  if (!referrer || referrer.id === uid) return null;
  const level = referrer.referral_level >= 2 ? 2 : 1;
  const until = now + REFERRAL.window[level];
  const player = await db.prepare("SELECT name FROM players WHERE id = ?").bind(uid).first<{ name: string }>();
  await db.batch([
    db
      .prepare("INSERT OR IGNORE INTO referrals(user_id, referrer_id, level, discount_until, created) VALUES(?, ?, ?, ?, ?)")
      .bind(uid, referrer.id, level, until, now),
    // The referrer hears about it, which is most of the reason to share a code.
    notificationInsert(db, `referral:${uid}`, referrer.id, "referral_joined", { name: player?.name ?? "A player", level }, now),
  ]);
  return { referrer: referrer.name, level, discountUntil: until };
}

type Standing = { user_id: string; referrer_id: string; discount_until: number; referrer_level: number };

/**
 * The ledger lines a settled match owes to referrals: what goes back to each
 * discounted player, and what goes to the partner who brought them. Both come
 * out of the house's own fee, so the pool's liabilities do not move.
 *
 * `fee` is what the house took from the whole pot, so half of it is what each
 * player funded. A draw takes no fee, and there is nothing to give back.
 */
export async function referralCredits(
  db: Database,
  match: { id: string; asset: Asset; fee: number },
  players: string[],
  now = Date.now(),
): Promise<Statement[]> {
  if (match.asset !== "devnet" || match.fee <= 0 || !players.length) return [];
  const { results } = await db
    .prepare(
      `SELECT r.user_id, r.referrer_id, r.discount_until, p.referral_level AS referrer_level
       FROM referrals r JOIN players p ON p.id = r.referrer_id
       WHERE r.user_id IN (${players.map(() => "?").join(", ")})`,
    )
    .bind(...players)
    .all<Standing>();
  if (!results.length) return [];

  const house = cashAccountId(HOUSE);
  const funded = Math.floor(match.fee / 2);
  const ops: Statement[] = [];
  const credit = (id: string, account: string, kind: string, amount: number) =>
    db
      .prepare("INSERT OR IGNORE INTO cash_ledger(id, account_id, kind, amount, reference, created) VALUES(?, ?, ?, ?, ?, ?)")
      .bind(id, account, kind, amount, match.id, now);

  for (const standing of results) {
    // The discount is the part of their own fee share the house gives back.
    const rebate = standing.discount_until > now ? Math.floor((funded * (REFERRAL.standardFee - REFERRAL.discountedFee)) / REFERRAL.standardFee) : 0;
    const partner = standing.referrer_level >= 2 ? Math.floor(((funded - rebate) * REFERRAL.partnerShare) / 100) : 0;
    if (rebate > 0) {
      await ensureCashAccount(standing.user_id);
      ops.push(
        credit(`${match.id}:rebate:${standing.user_id}`, cashAccountId(standing.user_id), "referral_rebate", rebate),
        credit(`${match.id}:rebate-house:${standing.user_id}`, house, "referral_rebate", -rebate),
      );
    }
    if (partner > 0) {
      await ensureCashAccount(standing.referrer_id);
      ops.push(
        credit(`${match.id}:partner:${standing.user_id}`, cashAccountId(standing.referrer_id), "referral_commission", partner),
        credit(`${match.id}:partner-house:${standing.user_id}`, house, "referral_commission", -partner),
      );
    }
  }
  return ops;
}

export type ReferralStanding = { code: string; level: number; discountUntil: number | null; referredBy: string | null; joined: number; earned: number };

/** What a player sees of their own referrals: their code, their window, and what it brought. */
export async function referralSummary(uid: string, now = Date.now()): Promise<ReferralStanding> {
  const db = database();
  const code = await referralCode(uid);
  const [player, mine, joined, earned] = await Promise.all([
    db.prepare("SELECT referral_level FROM players WHERE id = ?").bind(uid).first<{ referral_level: number }>(),
    db
      .prepare("SELECT r.discount_until, p.name FROM referrals r JOIN players p ON p.id = r.referrer_id WHERE r.user_id = ?")
      .bind(uid)
      .first<{ discount_until: number; name: string }>(),
    db.prepare("SELECT COUNT(*) AS n FROM referrals WHERE referrer_id = ?").bind(uid).first<{ n: number }>(),
    db
      .prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM cash_ledger WHERE account_id = ? AND kind = 'referral_commission'")
      .bind(cashAccountId(uid))
      .first<{ total: number }>(),
  ]);
  return {
    code,
    level: Number(player?.referral_level ?? 1),
    discountUntil: mine && mine.discount_until > now ? mine.discount_until : null,
    referredBy: mine?.name ?? null,
    joined: Number(joined?.n ?? 0),
    earned: Number(earned?.total ?? 0),
  };
}

/** Every player brought in by a partner, for the administrator's view. */
export async function referralRoster(limit = 50) {
  const { results } = await database()
    .prepare(
      `SELECT p.name, p.referral_level AS level, p.referral_code AS code,
         (SELECT COUNT(*) FROM referrals r WHERE r.referrer_id = p.id) AS joined,
         (SELECT COALESCE(SUM(l.amount), 0) FROM cash_ledger l
            WHERE l.account_id = 'devnet:' || p.id AND l.kind = 'referral_commission') AS earned
       FROM players p
       WHERE p.deleted IS NULL AND (p.referral_level >= 2 OR EXISTS (SELECT 1 FROM referrals r WHERE r.referrer_id = p.id))
       ORDER BY p.referral_level DESC, joined DESC LIMIT ?`,
    )
    .bind(limit)
    .all<{ name: string; level: number; code: string | null; joined: number; earned: number }>();
  return results;
}

/** Grants or withdraws a partnership. Only an administrator may call this. */
export async function setReferralLevel(adminUid: string, nameInput: unknown, levelInput: unknown, reasonInput: unknown, now = Date.now()) {
  const name = String(nameInput ?? "").trim();
  const level = Number(levelInput);
  if (level !== 1 && level !== 2) throw new GameError("A referral level is 1 or 2.");
  const reason = adminNote(reasonInput, true);
  const db = database();
  const player = await db.prepare("SELECT id, name FROM players WHERE lower(name) = lower(?) AND deleted IS NULL").bind(name).first<{ id: string; name: string }>();
  if (!player) throw new GameError("No player by that name.", 404);
  await db.batch([
    db.prepare("UPDATE players SET referral_level = ? WHERE id = ?").bind(level, player.id),
    adminAudit(adminUid, level === 2 ? "referral_partner_granted" : "referral_partner_revoked", player.id, reason, now),
    notificationInsert(db, `partner:${player.id}:${now}`, player.id, "referral_partner", { level }, now),
  ]);
  return { name: player.name, level };
}
