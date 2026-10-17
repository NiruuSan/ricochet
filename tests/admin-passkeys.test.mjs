import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { createDatabase } from "./helpers/test-env.mjs";

// The administrator's passkeys, checked with a real signature: a software
// authenticator below makes a P-256 key and answers the server's challenges the
// way a phone or a security key would. What has to hold: a passkey made and
// kept; the admin opened with it; a replayed answer, another site's answer
// (a phishing page), a counter going back (a copied key), a person not
// verified on the device and a stale challenge all refused; and "passkey only"
// shutting out the app code while a recovery code still opens the way back.
const ADMIN = "github:1";
Object.assign(process.env, { SOLANA_VAULT_KEY: Buffer.alloc(32, 6).toString("base64"), RICOCHET_ADMIN_USER_ID: ADMIN });
const { sqlite, close } = await createDatabase();
globalThis.fetch = async () => {
  throw new Error("Passkeys must not touch the network");
};
const tf = await import("../lib/two-factor.ts");
const keys = await import("../lib/admin-passkeys.ts");
const guard = await import("../lib/admin-guard.ts");

const ORIGIN = "https://bounce.test";
const b64u = (bytes) => Buffer.from(bytes).toString("base64url");
const sha256 = (data) => createHash("sha256").update(data).digest();
const cborBytes = (buf) => Buffer.concat([buf.length < 24 ? Buffer.from([0x40 + buf.length]) : buf.length < 256 ? Buffer.from([0x58, buf.length]) : Buffer.from([0x59, buf.length >> 8, buf.length & 255]), buf]);
const cborText = (text) => cborBytes(Buffer.from(text)).fill(0x60 + Buffer.byteLength(text), 0, 1);

/** A passkey in software: what a device does when the browser asks it to make or use one. */
class SoftKey {
  constructor(origin = ORIGIN) {
    this.origin = origin;
    this.rpID = new URL(origin).hostname;
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const jwk = publicKey.export({ format: "jwk" });
    this.privateKey = privateKey;
    this.x = Buffer.from(jwk.x, "base64url");
    this.y = Buffer.from(jwk.y, "base64url");
    this.id = randomBytes(16);
    this.counter = 0;
  }
  // The public key as COSE: EC2, ES256, P-256, x, y.
  cose() {
    return Buffer.concat([Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21]), cborBytes(this.x), Buffer.from([0x22]), cborBytes(this.y)]);
  }
  authData(flags, withKey) {
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(this.counter);
    const parts = [sha256(this.rpID), Buffer.from([flags]), counter];
    if (withKey) {
      const length = Buffer.alloc(2);
      length.writeUInt16BE(this.id.length);
      parts.push(Buffer.alloc(16), length, this.id, this.cose());
    }
    return Buffer.concat(parts);
  }
  /** Makes the passkey: presence, verification and the new key in the data (flags UP|UV|AT). */
  register(options, origin = this.origin) {
    const clientData = Buffer.from(JSON.stringify({ type: "webauthn.create", challenge: options.challenge, origin, crossOrigin: false }));
    const attestation = Buffer.concat([Buffer.from([0xa3]), cborText("fmt"), cborText("none"), cborText("attStmt"), Buffer.from([0xa0]), cborText("authData"), cborBytes(this.authData(0x45, true))]);
    return { id: b64u(this.id), rawId: b64u(this.id), type: "public-key", response: { clientDataJSON: b64u(clientData), attestationObject: b64u(attestation), transports: ["internal"] }, clientExtensionResults: {} };
  }
  /** Signs a challenge: by default the next counter, on its own site, with the person verified (UP|UV). */
  answer(options, { counter = this.counter + 1, origin = this.origin, flags = 0x05 } = {}) {
    this.counter = counter;
    const clientData = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge: options.challenge, origin, crossOrigin: false }));
    const authData = this.authData(flags, false);
    const signature = sign("sha256", Buffer.concat([authData, sha256(clientData)]), this.privateKey);
    return { id: b64u(this.id), rawId: b64u(this.id), type: "public-key", response: { clientDataJSON: b64u(clientData), authenticatorData: b64u(authData), signature: b64u(signature) }, clientExtensionResults: {} };
  }
}

try {
  const now = Date.UTC(2026, 9, 17, 12, 0, 10);
  const codeAt = (secret, when) => tf.totpCode(tf.base32Decode(secret), tf.currentStep(when));
  sqlite.prepare("INSERT INTO players(id, name, balance, created) VALUES(?, 'Boss', 0, 0)").run(ADMIN);
  const setup = await tf.beginTwoFactorSetup(ADMIN, "Boss", now);
  const { recoveryCodes } = await tf.confirmTwoFactorSetup(ADMIN, codeAt(setup.secret, now), now);
  const here = guard.networkOf("203.0.113.7");
  const notices = (event) => sqlite.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND data LIKE ?").get(ADMIN, `%${event}%`).n;
  const rejects = (work, code, why) => assert.rejects(work, (e) => e.code === code, why);

  // --- Nothing yet ---------------------------------------------------------------
  assert.deepEqual(await keys.listPasskeys(ADMIN), []);
  assert.equal(await keys.passkeyOnly(), false);
  await rejects(() => keys.setPasskeyOnly(ADMIN, true, now), "PASSKEY_NONE", "Passkey only needs a passkey to open with");
  await rejects(() => keys.authenticationOptions(ADMIN, "s1", ORIGIN, now), "PASSKEY_NONE");

  // --- Making one -------------------------------------------------------------------
  const phone = new SoftKey();
  const made = await keys.registrationOptions(ADMIN, "Boss", "s1", ORIGIN, now);
  assert.equal(made.rp.id, "bounce.test", "Bound to the site's hostname");
  assert.equal(made.authenticatorSelection.userVerification, "required", "The person must be verified on the device");
  const registration = phone.register(made);
  const kept = await keys.registerPasskey(ADMIN, "s1", ORIGIN, registration, "  My   phone  ", now);
  assert.equal(kept.name, "My phone");
  assert.equal((await keys.listPasskeys(ADMIN)).length, 1);
  assert.equal(notices("admin_passkey_added"), 1, "The administrator is told");
  await rejects(() => keys.registerPasskey(ADMIN, "s1", ORIGIN, registration, "again", now), "PASSKEY_EXPIRED", "A challenge is answered once");
  const elsewhere = await keys.registrationOptions(ADMIN, "Boss", "s1", ORIGIN, now);
  assert.deepEqual(elsewhere.excludeCredentials.map((c) => c.id), [kept.id], "The same device is not registered twice");
  await rejects(() => keys.registerPasskey(ADMIN, "s1", ORIGIN, new SoftKey("https://evil.test").register(elsewhere), "", now), "PASSKEY_INVALID", "A key made for another site is refused");
  assert.equal(await keys.passkeysHere(ADMIN, ORIGIN), 1);
  assert.equal(await keys.passkeysHere(ADMIN, "https://preview.vercel.app"), 0, "A passkey works only on the site it was made on");

  // --- Opening the admin with it ---------------------------------------------------------
  const at = now + 60_000;
  let ask = await keys.authenticationOptions(ADMIN, "s2", ORIGIN, at);
  assert.deepEqual(ask.allowCredentials.map((c) => c.id), [kept.id]);
  const answer = phone.answer(ask);
  const opened = await guard.elevateWithPasskey(ADMIN, "s2", ORIGIN, answer, at, here);
  assert.equal(opened.viewingUntil, at + guard.VIEWING_MS);
  assert.equal(await guard.isViewing(ADMIN, "s2", at + 1000, here), true, "The passkey opens the admin");
  assert.equal(await guard.isElevated(ADMIN, "s2", at + 1000, here), true, "and changes");
  assert.equal(sqlite.prepare("SELECT counter FROM admin_passkeys").get().counter, 1, "The counter moves forward");
  assert.ok(sqlite.prepare("SELECT data FROM notifications WHERE data LIKE '%admin_elevated%'").all().some((row) => row.data.includes('"by":"passkey"')), "and the owner is told how");
  await rejects(() => guard.elevateWithPasskey(ADMIN, "s2", ORIGIN, answer, at + 2000, here), "PASSKEY_EXPIRED", "A replayed answer opens nothing");

  // --- Refused ------------------------------------------------------------------------------
  const refuse = async (session, change, why, code = "PASSKEY_INVALID", when = at + 5000) => {
    const options = await keys.authenticationOptions(ADMIN, session, ORIGIN, when);
    await rejects(() => guard.elevateWithPasskey(ADMIN, session, ORIGIN, change(options), when, here), code, why);
    assert.equal(await guard.isViewing(ADMIN, session, when + 1000, here), false);
  };
  await refuse("s3", (o) => phone.answer(o, { origin: "https://bounce-test.com" }), "An answer signed on a look-alike page is refused");
  await refuse("s4", (o) => phone.answer(o, { counter: 1 }), "A counter that does not move forward gives a copied key away");
  await refuse("s5", (o) => phone.answer(o, { counter: 9, flags: 0x01 }), "Presence without verification of the person is not enough");
  await refuse("s6", (o) => new SoftKey().answer(o), "A key nobody registered opens nothing");
  await refuse("s7", (o) => ({ ...phone.answer(o, { counter: 10 }), response: { ...phone.answer(o, { counter: 11 }).response, signature: b64u(randomBytes(70)) } }), "A forged signature is refused");
  const stale = await keys.authenticationOptions(ADMIN, "s8", ORIGIN, at);
  await rejects(() => guard.elevateWithPasskey(ADMIN, "s8", ORIGIN, phone.answer(stale, { counter: 12 }), at + keys.CHALLENGE_MS + 1, here), "PASSKEY_EXPIRED", "A challenge is good for five minutes");
  ask = await keys.authenticationOptions(ADMIN, "s9", ORIGIN, at);
  await rejects(() => guard.elevateWithPasskey(ADMIN, "s-other", ORIGIN, phone.answer(ask, { counter: 13 }), at, here), "PASSKEY_EXPIRED", "and belongs to the session it was issued to");

  // --- Passkey only -------------------------------------------------------------------------
  await keys.setPasskeyOnly(ADMIN, true, at);
  assert.equal(await keys.passkeyOnly(), true);
  const failures = () => sqlite.prepare("SELECT failures FROM two_factor WHERE user_id = ?").get(ADMIN).failures;
  const before = failures();
  const later = at + 90_000;
  await rejects(() => guard.elevate(ADMIN, "s10", codeAt(setup.secret, later), later, here), "PASSKEY_REQUIRED", "An app code no longer opens the admin");
  assert.equal(failures(), before, "and is not counted as a wrong guess");
  await guard.elevate(ADMIN, "s10", recoveryCodes[0], later, here);
  assert.equal(await guard.isViewing(ADMIN, "s10", later + 1000, here), true, "A recovery code is the way back in");
  ask = await keys.authenticationOptions(ADMIN, "s11", ORIGIN, later);
  await guard.elevateWithPasskey(ADMIN, "s11", ORIGIN, phone.answer(ask, { counter: 20 }), later, here);
  assert.equal(await guard.isViewing(ADMIN, "s11", later + 1000, here), true, "The passkey still opens it");

  // --- Removing the last one turns passkey only off, so the app code works again ----------------
  await keys.removePasskey(ADMIN, kept.id, later + 1000);
  assert.deepEqual(await keys.listPasskeys(ADMIN), []);
  assert.equal(await keys.passkeyOnly(), false);
  assert.equal(notices("admin_passkey_removed"), 1);
  const after = later + 60_000;
  await guard.elevate(ADMIN, "s12", codeAt(setup.secret, after), after, here);
  assert.equal(await guard.isViewing(ADMIN, "s12", after + 1000, here), true);
  await rejects(() => keys.removePasskey(ADMIN, "nope", after), "PASSKEY_INVALID");

  console.log(
    "PASS: admin passkeys (made against the site's hostname with the person verified, kept once, told to the owner; the admin opened with a real P-256 signature, counted forward; replays, look-alike pages, counters going back, unverified presence, unknown keys, forged signatures, stale and foreign challenges refused; passkey only refusing app codes without counting them, recovery codes still opening; the last passkey removed turning it off).",
  );
} finally {
  close();
}
