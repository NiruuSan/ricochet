import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { database } from "@/db/raw";
import { notificationInsert } from "./notifications";

// Passkeys for the administrator.
//
// A code from an authenticator app can be phished: a fake page asks for it and
// types it into the real one within its thirty seconds. A passkey cannot — the
// browser signs for the site it is actually on, and a look-alike domain gets a
// signature that is worth nothing here. So the administrator can open the admin
// with a passkey (Face ID, Windows Hello, a security key) instead of a code,
// and can switch to "passkey only", after which an app code no longer opens it.
// The recovery codes still do: they are the way back in with every device lost.
//
// A passkey belongs to the site it was made on (its hostname), and each
// ceremony answers a challenge issued to this session, good once for five
// minutes. The library checks the signature, the origin, the site and that the
// person was verified on the device; this file keeps the keys, the challenges
// and the signature counter that gives a cloned key away.

export type PasskeyErrorCode = "PASSKEY_INVALID" | "PASSKEY_EXPIRED" | "PASSKEY_NONE" | "PASSKEY_LIMIT";

export class PasskeyError extends Error {
  readonly code: PasskeyErrorCode;
  constructor(message: string, code: PasskeyErrorCode = "PASSKEY_INVALID") {
    super(message);
    this.code = code;
  }
}

/** How long a challenge waits to be answered. */
export const CHALLENGE_MS = 5 * 60_000;
/** Passkeys one administrator may hold. */
export const MAX_PASSKEYS = 10;
const ONLY = "admin_passkey_only";

type Stored = { id: string; user_id: string; rp_id: string; public_key: string; counter: number; transports: string | null; name: string; created: number; last_used: number | null };
export type AdminPasskey = { id: string; name: string; created: number; lastUsed: number | null };

/** The site a ceremony runs on: the origin the browser reports, and the hostname a passkey is bound to. */
const site = (origin: string) => {
  const url = new URL(origin);
  return { origin: url.origin, rpID: url.hostname };
};
const transportsOf = (row: Stored) => (row.transports ? (JSON.parse(row.transports) as AuthenticatorTransportFuture[]) : undefined);

async function stored(uid: string) {
  const { results } = await database().prepare("SELECT * FROM admin_passkeys WHERE user_id = ? ORDER BY created").bind(uid).all<Stored>();
  return results;
}

/** The administrator's passkeys, newest last. */
export async function listPasskeys(uid: string): Promise<AdminPasskey[]> {
  return (await stored(uid)).map((row) => ({ id: row.id, name: row.name, created: row.created, lastUsed: row.last_used }));
}

/** How many passkeys can open the admin on this site. */
export async function passkeysHere(uid: string, origin: string) {
  const { rpID } = site(origin);
  return (await stored(uid)).filter((row) => row.rp_id === rpID).length;
}

/** Whether an app code no longer opens the admin. */
export async function passkeyOnly() {
  const row = await database().prepare("SELECT value FROM app_settings WHERE key = ?").bind(ONLY).first<{ value: string }>();
  return row?.value === "1";
}

/** Turns "passkey only" on or off. On needs a passkey to open with. */
export async function setPasskeyOnly(uid: string, on: boolean, now = Date.now()) {
  if (on && !(await stored(uid)).length) throw new PasskeyError("Add a passkey first: with none, nothing but a recovery code would open the admin.", "PASSKEY_NONE");
  const db = database();
  await db.batch([
    db
      .prepare(
        "INSERT INTO app_settings(key, value, updated_by, updated) VALUES(?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated = excluded.updated",
      )
      .bind(ONLY, on ? "1" : "0", uid, now),
    notificationInsert(db, `security:passkey_only:${now}`, uid, "security_alert", { event: on ? "admin_passkey_only_on" : "admin_passkey_only_off" }, now),
  ]);
  return on;
}

async function saveChallenge(session: string, uid: string, kind: "register" | "auth", challenge: string, now: number) {
  const db = database();
  await db.batch([
    db.prepare("DELETE FROM admin_passkey_challenges WHERE expires <= ?").bind(now),
    db
      .prepare(
        `INSERT INTO admin_passkey_challenges(session, kind, user_id, challenge, expires) VALUES(?, ?, ?, ?, ?)
         ON CONFLICT(session, kind) DO UPDATE SET user_id = excluded.user_id, challenge = excluded.challenge, expires = excluded.expires`,
      )
      .bind(session, kind, uid, challenge, now + CHALLENGE_MS),
  ]);
}

/** The challenge this session was given, spent by reading it. */
async function takeChallenge(session: string, uid: string, kind: "register" | "auth", now: number) {
  const row = await database()
    .prepare("DELETE FROM admin_passkey_challenges WHERE session = ? AND kind = ? AND user_id = ? AND expires > ? RETURNING challenge")
    .bind(session, kind, uid, now)
    .first<{ challenge: string }>();
  if (!row) throw new PasskeyError("This request has expired. Start again.", "PASSKEY_EXPIRED");
  return row.challenge;
}

/** What the browser needs to make a new passkey for this administrator. */
export async function registrationOptions(uid: string, userName: string, session: string, origin: string, now = Date.now()) {
  const { rpID } = site(origin);
  const existing = await stored(uid);
  if (existing.length >= MAX_PASSKEYS) throw new PasskeyError(`Up to ${MAX_PASSKEYS} passkeys: remove one first.`, "PASSKEY_LIMIT");
  const options = await generateRegistrationOptions({
    rpName: "Bounce admin",
    rpID,
    userName,
    userID: new TextEncoder().encode(uid),
    attestationType: "none",
    // The same device twice would only be a second name for one key.
    excludeCredentials: existing.filter((row) => row.rp_id === rpID).map((row) => ({ id: row.id, transports: transportsOf(row) })),
    authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
  });
  await saveChallenge(session, uid, "register", options.challenge, now);
  return options;
}

const cleanName = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 40);

/** Checks the new passkey against the challenge, then keeps it. */
export async function registerPasskey(uid: string, session: string, origin: string, response: unknown, label: unknown, now = Date.now()) {
  const challenge = await takeChallenge(session, uid, "register", now);
  const { origin: expectedOrigin, rpID } = site(origin);
  let verification;
  try {
    verification = await verifyRegistrationResponse({ response: response as RegistrationResponseJSON, expectedChallenge: challenge, expectedOrigin, expectedRPID: rpID, requireUserVerification: true });
  } catch {
    throw new PasskeyError("This passkey could not be verified. Try again.");
  }
  if (!verification.verified) throw new PasskeyError("This passkey could not be verified. Try again.");
  const { credential } = verification.registrationInfo;
  const count = (await stored(uid)).length;
  const name = cleanName(label) || `Passkey ${count + 1}`;
  const db = database();
  try {
    await db.batch([
      db
        .prepare("INSERT INTO admin_passkeys(id, user_id, rp_id, public_key, counter, transports, name, created) VALUES(?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(credential.id, uid, rpID, Buffer.from(credential.publicKey).toString("base64url"), credential.counter, credential.transports ? JSON.stringify(credential.transports) : null, name, now),
      notificationInsert(db, `security:passkey_added:${now}`, uid, "security_alert", { event: "admin_passkey_added", name }, now),
    ]);
  } catch (e) {
    if (e instanceof Error && /UNIQUE|PRIMARY KEY/i.test(e.message)) throw new PasskeyError("This passkey is already registered.");
    throw e;
  }
  return { id: credential.id, name, created: now, lastUsed: null } satisfies AdminPasskey;
}

/** Removes a passkey. Removing the last one turns "passkey only" off, so the app code works again. */
export async function removePasskey(uid: string, idInput: unknown, now = Date.now()) {
  const id = String(idInput ?? "");
  const db = database();
  const gone = await db.prepare("DELETE FROM admin_passkeys WHERE id = ? AND user_id = ? RETURNING name").bind(id, uid).first<{ name: string }>();
  if (!gone) throw new PasskeyError("No such passkey.");
  const ops = [notificationInsert(db, `security:passkey_removed:${now}`, uid, "security_alert", { event: "admin_passkey_removed", name: gone.name }, now)];
  if (!(await stored(uid)).length) {
    ops.push(db.prepare("UPDATE app_settings SET value = '0', updated_by = ?, updated = ? WHERE key = ?").bind(uid, now, ONLY));
  }
  await db.batch(ops);
}

/** What the browser needs to sign in with one of this site's passkeys. */
export async function authenticationOptions(uid: string, session: string, origin: string, now = Date.now()) {
  const { rpID } = site(origin);
  const here = (await stored(uid)).filter((row) => row.rp_id === rpID);
  if (!here.length) throw new PasskeyError("No passkey is registered for this site yet.", "PASSKEY_NONE");
  const options = await generateAuthenticationOptions({ rpID, allowCredentials: here.map((row) => ({ id: row.id, transports: transportsOf(row) })), userVerification: "required" });
  await saveChallenge(session, uid, "auth", options.challenge, now);
  return options;
}

/**
 * Checks a passkey's answer to this session's challenge. The signature counter
 * must move forward: a counter that goes back means two copies of one key.
 */
export async function verifyPasskey(uid: string, session: string, origin: string, response: unknown, now = Date.now()) {
  const challenge = await takeChallenge(session, uid, "auth", now);
  const answer = response as AuthenticationResponseJSON;
  const { origin: expectedOrigin, rpID } = site(origin);
  const row = await database().prepare("SELECT * FROM admin_passkeys WHERE id = ? AND user_id = ? AND rp_id = ?").bind(String(answer?.id ?? ""), uid, rpID).first<Stored>();
  if (!row) throw new PasskeyError("This passkey is not registered here.");
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: answer,
      expectedChallenge: challenge,
      expectedOrigin,
      expectedRPID: rpID,
      credential: { id: row.id, publicKey: new Uint8Array(Buffer.from(row.public_key, "base64url")), counter: row.counter, transports: transportsOf(row) },
      requireUserVerification: true,
    });
  } catch {
    throw new PasskeyError("This passkey could not be verified.");
  }
  if (!verification.verified) throw new PasskeyError("This passkey could not be verified.");
  // Conditional on the counter read, so two answers racing cannot both pass.
  const used = await database()
    .prepare("UPDATE admin_passkeys SET counter = ?, last_used = ? WHERE id = ? AND user_id = ? AND counter = ?")
    .bind(verification.authenticationInfo.newCounter, now, row.id, uid, row.counter)
    .run();
  if (!used.meta.changes) throw new PasskeyError("This passkey was just used. Try again.");
  return row.name;
}
