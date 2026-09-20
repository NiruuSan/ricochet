import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, randomInt } from "node:crypto";
import qrcode from "qrcode-generator";
import { database } from "@/db/raw";
import type { TwoFactorStatus } from "./api-types";
import { notificationInsert } from "./notifications";
import { settings } from "./payments/accounts";
import { PaymentError } from "./payments/errors";

// Two-factor authentication for withdrawals: TOTP (RFC 6238, the 6-digit codes
// of Google Authenticator, Authy, 1Password…) plus single-use recovery codes.
//
// - The TOTP secret is encrypted with AES-256-GCM under a key derived from the
//   wallet vault key, and bound to the user ID.
// - A code is accepted at most once: the highest time step used is recorded.
// - Five wrong codes lock verification for 15 minutes.
// - Recovery codes are stored as keyed hashes (HMAC), never in clear.

const STEP_SECONDS = 30;
const DIGITS = 6;
/** Accept the previous and next 30-second code too, for clock drift. */
const DRIFT_STEPS = 1;
export const MAX_FAILURES = 5;
export const LOCK_MS = 15 * 60_000;
const RECOVERY_CODES = 10;
const ISSUER = "Bounce";
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export type TwoFactorErrorCode = "TWO_FACTOR_REQUIRED" | "TWO_FACTOR_INVALID" | "TWO_FACTOR_LOCKED" | "TWO_FACTOR_STATE";

export class TwoFactorError extends PaymentError {
  readonly code: TwoFactorErrorCode;
  constructor(message: string, code: TwoFactorErrorCode) {
    super(message);
    this.code = code;
  }
}

export function base32Encode(bytes: Uint8Array) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string) {
  const clean = text.toUpperCase().replace(/[\s=-]/g, "");
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error("Invalid base32.");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** The code for one 30-second time step (HOTP over the step counter, SHA-1, as authenticator apps expect). */
export function totpCode(secret: Buffer, step: number, digits = DIGITS) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac("sha1", secret).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 15;
  const binary = hmac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, "0");
}

export const currentStep = (now = Date.now()) => Math.floor(now / 1000 / STEP_SECONDS);

/** The time step a code belongs to, if it is valid now and newer than `lastStep`. */
export function matchingStep(secret: Buffer, code: string, lastStep: number, now = Date.now()) {
  const step = currentStep(now);
  for (let delta = -DRIFT_STEPS; delta <= DRIFT_STEPS; delta++) {
    const candidate = step + delta;
    if (candidate > lastStep && constantEqual(totpCode(secret, candidate), code)) return candidate;
  }
  return null;
}

function constantEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Keys for this feature, derived from the vault key so it is the only master secret. */
function keys() {
  const vault = settings().SOLANA_VAULT_KEY;
  if (!vault) throw new TwoFactorError("Two-factor authentication needs the payment service to be configured.", "TWO_FACTOR_STATE");
  const master = Buffer.from(vault, "base64");
  if (master.byteLength !== 32) throw new TwoFactorError("The wallet vault key must contain 32 random bytes.", "TWO_FACTOR_STATE");
  const derive = (info: string) => Buffer.from(hkdfSync("sha256", master, "ricochet-two-factor", info, 32));
  return { secret: derive("totp-secret-encryption"), recovery: derive("recovery-code-hash") };
}

function encryptSecret(secret: Buffer, uid: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keys().secret, iv);
  cipher.setAAD(Buffer.from(`two-factor:${uid}`));
  const data = Buffer.concat([cipher.update(secret), cipher.final()]);
  return JSON.stringify({ v: 1, iv: iv.toString("base64"), data: data.toString("base64"), tag: cipher.getAuthTag().toString("base64") });
}

function decryptSecret(stored: string, uid: string) {
  const { v, iv, data, tag } = JSON.parse(stored);
  if (v !== 1) throw new Error("Unsupported two-factor secret version.");
  const decipher = createDecipheriv("aes-256-gcm", keys().secret, Buffer.from(iv, "base64"));
  decipher.setAAD(Buffer.from(`two-factor:${uid}`));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]);
}

const normalizeRecovery = (code: string) => code.toUpperCase().replace(/[^A-Z2-7]/g, "");
const hashRecovery = (code: string) => createHmac("sha256", keys().recovery).update(normalizeRecovery(code)).digest("hex");

function newRecoveryCodes() {
  // 10 base32 characters: 50 bits each, shown as XXXXX-XXXXX.
  return Array.from({ length: RECOVERY_CODES }, () => {
    const raw = Array.from({ length: 10 }, () => BASE32[randomInt(32)]).join("");
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

/** An SVG QR code as a data URL. Drawn from the module grid, so no markup from the library reaches the page. */
function qrDataUrl(text: string) {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const size = qr.getModuleCount();
  const margin = 4;
  let path = "";
  for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) if (qr.isDark(row, col)) path += `M${col + margin} ${row + margin}h1v1h-1z`;
  const box = size + margin * 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${box} ${box}" shape-rendering="crispEdges"><rect width="${box}" height="${box}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

type Row = { user_id: string; secret: string; enabled: number; last_step: number; failures: number; locked_until: number };

const load = (uid: string) => database().prepare("SELECT * FROM two_factor WHERE user_id = ?").bind(uid).first<Row>();

/** Whether this account has a confirmed authenticator, for callers that only need to know that. */
export const twoFactorEnabled = async (uid: string) => !!(await load(uid))?.enabled;

/**
 * Tells the account holder that its protection changed. Turning the second
 * factor off, or replacing the recovery codes, is exactly what someone who
 * stole a session would do first, so it is never silent.
 */
const securityAlert = (uid: string, event: string, now: number) =>
  notificationInsert(database(), `security:${event}:${now}`, uid, "security_alert", { event }, now);

export async function twoFactorStatus(uid: string, now = Date.now()): Promise<TwoFactorStatus> {
  const db = database();
  const [row, codes] = await Promise.all([
    load(uid),
    db.prepare("SELECT COUNT(*) AS n FROM two_factor_recovery WHERE user_id = ? AND used_at IS NULL").bind(uid).first<{ n: number }>(),
  ]);
  const enabled = !!row?.enabled;
  return { enabled, recoveryCodesLeft: enabled ? (codes?.n ?? 0) : 0, lockedUntil: row && row.locked_until > now ? row.locked_until : null };
}

/** Starts enrolment: a new secret, pending until a code from the app confirms it. */
export async function beginTwoFactorSetup(uid: string, accountName: string, now = Date.now()) {
  const existing = await load(uid);
  if (existing?.enabled) throw new TwoFactorError("Two-factor authentication is already on.", "TWO_FACTOR_STATE");
  const secret = randomBytes(20);
  await database()
    .prepare(
      `INSERT INTO two_factor(user_id, secret, enabled, last_step, failures, locked_until, created) VALUES(?, ?, 0, 0, 0, 0, ?)
       ON CONFLICT(user_id) DO UPDATE SET secret = excluded.secret, last_step = 0, failures = 0, locked_until = 0, created = excluded.created
       WHERE two_factor.enabled = 0`,
    )
    .bind(uid, encryptSecret(secret, uid), now)
    .run();
  const key = base32Encode(secret);
  const label = encodeURIComponent(`${ISSUER}:${accountName}`);
  const uri = `otpauth://totp/${label}?secret=${key}&issuer=${ISSUER}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
  secret.fill(0);
  return { secret: key.match(/.{1,4}/g)!.join(" "), uri, qr: qrDataUrl(uri) };
}

async function registerFailure(uid: string, now: number) {
  // Count the failure; the fifth in a row locks verification and resets the count.
  await database()
    .prepare(
      `UPDATE two_factor SET
         locked_until = CASE WHEN failures + 1 >= ? THEN ? ELSE locked_until END,
         failures = CASE WHEN failures + 1 >= ? THEN 0 ELSE failures + 1 END
       WHERE user_id = ?`,
    )
    .bind(MAX_FAILURES, now + LOCK_MS, MAX_FAILURES, uid)
    .run();
}

function assertUnlocked(row: Row, now: number) {
  if (row.locked_until > now) {
    const minutes = Math.ceil((row.locked_until - now) / 60_000);
    throw new TwoFactorError(`Too many wrong codes. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`, "TWO_FACTOR_LOCKED");
  }
}

/** Finishes enrolment with a code from the app, and returns the recovery codes (shown once). */
export async function confirmTwoFactorSetup(uid: string, codeInput: unknown, now = Date.now()) {
  const row = await load(uid);
  if (!row || row.enabled) throw new TwoFactorError("Start the two-factor setup again.", "TWO_FACTOR_STATE");
  assertUnlocked(row, now);
  const code = typeof codeInput === "string" ? codeInput.replace(/\s/g, "") : "";
  const step = /^\d{6}$/.test(code) ? matchingStep(decryptSecret(row.secret, uid), code, row.last_step, now) : null;
  if (step === null) {
    await registerFailure(uid, now);
    throw new TwoFactorError("That code is not valid. Check the time on your phone and enter the current code.", "TWO_FACTOR_INVALID");
  }
  const codes = newRecoveryCodes();
  const db = database();
  const [enabled] = await db.batch([
    db.prepare("UPDATE two_factor SET enabled = 1, enabled_at = ?, last_step = ?, failures = 0 WHERE user_id = ? AND enabled = 0").bind(now, step, uid),
    db.prepare("DELETE FROM two_factor_recovery WHERE user_id = ?").bind(uid),
    ...codes.map((c) => db.prepare("INSERT INTO two_factor_recovery(code_hash, user_id) VALUES(?, ?)").bind(hashRecovery(c), uid)),
  ]);
  if (!enabled.meta.changes) throw new TwoFactorError("Two-factor authentication is already on.", "TWO_FACTOR_STATE");
  return { recoveryCodes: codes };
}

/**
 * Checks a 6-digit code or a recovery code for an action that needs the second
 * factor. Each code works once. Throws a TwoFactorError otherwise.
 */
export async function verifySecondFactor(uid: string, codeInput: unknown, now = Date.now()) {
  const row = await load(uid);
  // Withdrawals, large tips and an administrator closing an account all land here.
  if (!row?.enabled) throw new TwoFactorError("Turn on two-factor authentication first: this needs a code from your app.", "TWO_FACTOR_REQUIRED");
  assertUnlocked(row, now);
  const db = database();
  const code = typeof codeInput === "string" ? codeInput.trim() : "";
  if (/^\d{3}\s?\d{3}$/.test(code)) {
    const digits = code.replace(/\s/g, "");
    const secret = decryptSecret(row.secret, uid);
    const step = matchingStep(secret, digits, row.last_step, now);
    // Conditional on the step, so two requests racing with the same code cannot both pass.
    if (step !== null) {
      const used = await db.prepare("UPDATE two_factor SET last_step = ?, failures = 0 WHERE user_id = ? AND enabled = 1 AND last_step < ?").bind(step, uid, step).run();
      if (used.meta.changes) return "totp" as const;
    }
    // The right code, but already spent (for example to turn 2FA on a moment ago): not a guess.
    if (matchingStep(secret, digits, -1, now) !== null) {
      throw new TwoFactorError("This code was already used. Wait for the next code in your app (they change every 30 seconds).", "TWO_FACTOR_INVALID");
    }
  } else if (normalizeRecovery(code).length === 10) {
    const used = await db.prepare("UPDATE two_factor_recovery SET used_at = ? WHERE code_hash = ? AND user_id = ? AND used_at IS NULL").bind(now, hashRecovery(code), uid).run();
    if (used.meta.changes) {
      await db.prepare("UPDATE two_factor SET failures = 0 WHERE user_id = ?").bind(uid).run();
      return "recovery" as const;
    }
  }
  await registerFailure(uid, now);
  throw new TwoFactorError("That authentication code is not valid or was already used.", "TWO_FACTOR_INVALID");
}

/** Turns two-factor authentication off, after a valid code. */
export async function disableTwoFactor(uid: string, code: unknown, now = Date.now()) {
  await verifySecondFactor(uid, code, now);
  const db = database();
  await db.batch([
    db.prepare("DELETE FROM two_factor WHERE user_id = ?").bind(uid),
    db.prepare("DELETE FROM two_factor_recovery WHERE user_id = ?").bind(uid),
    securityAlert(uid, "two_factor_disabled", now),
  ]);
}

/** Replaces every recovery code, after a valid code. */
export async function regenerateRecoveryCodes(uid: string, code: unknown, now = Date.now()) {
  await verifySecondFactor(uid, code, now);
  const codes = newRecoveryCodes();
  const db = database();
  await db.batch([
    db.prepare("DELETE FROM two_factor_recovery WHERE user_id = ?").bind(uid),
    ...codes.map((c) => db.prepare("INSERT INTO two_factor_recovery(code_hash, user_id) VALUES(?, ?)").bind(hashRecovery(c), uid)),
    securityAlert(uid, "recovery_codes_replaced", now),
  ]);
  return { recoveryCodes: codes };
}
