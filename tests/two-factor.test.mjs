import assert from "node:assert/strict";
import { createDatabase } from "./helpers/test-env.mjs";

// Two-factor authentication for withdrawals: RFC 6238 codes, enrolment,
// single use, clock drift, lockout, recovery codes and encrypted secrets.
Object.assign(process.env, { SOLANA_VAULT_KEY: Buffer.alloc(32, 3).toString("base64") });
const { sqlite, close } = await createDatabase();
globalThis.fetch = async () => {
  throw new Error("Two-factor checks must not touch the network");
};
const tf = await import("../lib/two-factor.ts");

try {
  // RFC 6238 test vectors (SHA-1, secret "12345678901234567890").
  const rfc = Buffer.from("12345678901234567890");
  for (const [seconds, expected] of [[59, "94287082"], [1111111109, "07081804"], [1111111111, "14050471"], [1234567890, "89005924"], [2000000000, "69279037"]]) {
    assert.equal(tf.totpCode(rfc, Math.floor(seconds / 30), 8), expected, `RFC 6238 vector at T=${seconds}`);
  }
  assert.equal(tf.totpCode(rfc, 1), "287082", "Six digits keep the last six");
  assert.deepEqual(tf.base32Decode(tf.base32Encode(rfc)), rfc);
  assert.equal(tf.base32Encode(Buffer.from("foobar")), "MZXW6YTBOI", "RFC 4648 base32");

  const UID = "github:77";
  const now = Date.UTC(2026, 8, 16, 12, 0, 10);
  const codeAt = (secretText, when) => tf.totpCode(tf.base32Decode(secretText), tf.currentStep(when));

  await assert.rejects(() => tf.verifySecondFactor(UID, "123456", now), (e) => e.code === "TWO_FACTOR_REQUIRED", "Withdrawals need 2FA turned on");
  assert.deepEqual(await tf.twoFactorStatus(UID, now), { enabled: false, recoveryCodesLeft: 0, lockedUntil: null });

  // Enrolment: a pending secret, an otpauth URI and a QR code.
  const setup = await tf.beginTwoFactorSetup(UID, "Neil", now);
  assert.match(setup.uri, /^otpauth:\/\/totp\/Bounce%3ANeil\?secret=[A-Z2-7]{32}&issuer=Bounce&algorithm=SHA1&digits=6&period=30$/);
  assert.match(setup.qr, /^data:image\/svg\+xml;base64,/);
  assert.ok(Buffer.from(setup.qr.split(",")[1], "base64").toString().startsWith("<svg"), "The QR code is a plain SVG");
  const stored = sqlite.prepare("SELECT secret, enabled FROM two_factor WHERE user_id = ?").get(UID);
  assert.equal(stored.enabled, 0);
  assert.ok(!stored.secret.includes(setup.secret.replaceAll(" ", "")), "The secret is encrypted at rest");
  await assert.rejects(() => tf.verifySecondFactor(UID, "000000", now), (e) => e.code === "TWO_FACTOR_REQUIRED", "A pending setup does not protect withdrawals yet");

  await assert.rejects(() => tf.confirmTwoFactorSetup(UID, "000000", now), (e) => e.code === "TWO_FACTOR_INVALID");
  const { recoveryCodes } = await tf.confirmTwoFactorSetup(UID, codeAt(setup.secret, now), now);
  assert.equal(recoveryCodes.length, 10);
  assert.ok(recoveryCodes.every((c) => /^[A-Z2-7]{5}-[A-Z2-7]{5}$/.test(c)) && new Set(recoveryCodes).size === 10);
  const hashes = sqlite.prepare("SELECT code_hash FROM two_factor_recovery WHERE user_id = ?").all(UID).map((r) => r.code_hash);
  assert.equal(hashes.length, 10);
  assert.ok(!hashes.some((h) => recoveryCodes.some((c) => h.includes(c.replace("-", "")))), "Recovery codes are only stored hashed");
  await assert.rejects(() => tf.beginTwoFactorSetup(UID, "Neil", now), /already on/, "Setup cannot silently replace an active authenticator");
  assert.deepEqual(await tf.twoFactorStatus(UID, now), { enabled: true, recoveryCodesLeft: 10, lockedUntil: null });

  // A code works once; the enrolment code itself cannot be replayed.
  await assert.rejects(() => tf.verifySecondFactor(UID, codeAt(setup.secret, now), now), (e) => e.code === "TWO_FACTOR_INVALID", "The confirmation code cannot be reused");
  const next = now + 30_000;
  assert.equal(await tf.verifySecondFactor(UID, codeAt(setup.secret, next), next), "totp");
  await assert.rejects(() => tf.verifySecondFactor(UID, codeAt(setup.secret, next), next), (e) => e.code === "TWO_FACTOR_INVALID" && /already used/.test(e.message), "No replay, with a clear message");
  // One step of clock drift either way is fine; an old code is not.
  const later = now + 5 * 30_000;
  assert.equal(await tf.verifySecondFactor(UID, codeAt(setup.secret, later + 30_000), later), "totp", "A phone slightly ahead works");
  await assert.rejects(() => tf.verifySecondFactor(UID, codeAt(setup.secret, later - 2 * 30_000), later + 60_000), (e) => e.code === "TWO_FACTOR_INVALID");
  // Two requests racing with the same fresh code: exactly one passes.
  const race = now + 20 * 30_000;
  const outcomes = await Promise.allSettled([tf.verifySecondFactor(UID, codeAt(setup.secret, race), race), tf.verifySecondFactor(UID, codeAt(setup.secret, race), race)]);
  assert.equal(outcomes.filter((o) => o.status === "fulfilled").length, 1, "A code cannot be spent twice concurrently");

  // Recovery codes: any formatting, single use.
  const spaced = recoveryCodes[0].toLowerCase().replace("-", " ");
  assert.equal(await tf.verifySecondFactor(UID, spaced, race), "recovery");
  await assert.rejects(() => tf.verifySecondFactor(UID, recoveryCodes[0], race), (e) => e.code === "TWO_FACTOR_INVALID", "A recovery code works once");
  assert.equal((await tf.twoFactorStatus(UID, race)).recoveryCodesLeft, 9);

  // Lockout: five wrong codes block verification, even with a correct code.
  const lockAt = now + 40 * 30_000;
  // Earlier wrong codes in this test already count; start the streak from zero.
  sqlite.prepare("UPDATE two_factor SET failures = 0 WHERE user_id = ?").run(UID);
  for (let i = 0; i < tf.MAX_FAILURES; i++) await assert.rejects(() => tf.verifySecondFactor(UID, "000000", lockAt), (e) => e.code === "TWO_FACTOR_INVALID");
  await assert.rejects(() => tf.verifySecondFactor(UID, codeAt(setup.secret, lockAt), lockAt), (e) => e.code === "TWO_FACTOR_LOCKED");
  assert.ok((await tf.twoFactorStatus(UID, lockAt)).lockedUntil > lockAt);
  const unlocked = lockAt + tf.LOCK_MS + 1000;
  assert.equal(await tf.verifySecondFactor(UID, codeAt(setup.secret, unlocked), unlocked), "totp", "The lock expires");

  // Regenerating recovery codes invalidates the old ones.
  const regenAt = unlocked + 30_000;
  const fresh = await tf.regenerateRecoveryCodes(UID, codeAt(setup.secret, regenAt), regenAt);
  await assert.rejects(() => tf.verifySecondFactor(UID, recoveryCodes[1], regenAt), (e) => e.code === "TWO_FACTOR_INVALID");
  assert.equal(await tf.verifySecondFactor(UID, fresh.recoveryCodes[0], regenAt), "recovery");

  // Secrets are bound to their owner: a copied ciphertext does not decrypt for someone else.
  sqlite.prepare("INSERT INTO two_factor(user_id, secret, enabled, last_step, failures, locked_until, created) SELECT 'github:thief', secret, 1, 0, 0, 0, 0 FROM two_factor WHERE user_id = ?").run(UID);
  await assert.rejects(() => tf.verifySecondFactor("github:thief", codeAt(setup.secret, regenAt + 30_000), regenAt + 30_000));

  // Turning it off needs a valid code and removes everything.
  const offAt = regenAt + 60_000;
  await assert.rejects(() => tf.disableTwoFactor(UID, "111111", offAt));
  const offAfterFailure = offAt + 30_000;
  await tf.disableTwoFactor(UID, codeAt(setup.secret, offAfterFailure), offAfterFailure);
  assert.deepEqual(await tf.twoFactorStatus(UID, offAfterFailure), { enabled: false, recoveryCodesLeft: 0, lockedUntil: null });
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM two_factor_recovery WHERE user_id = ?").get(UID).n, 0);

  console.log("PASS: two-factor (RFC 6238 vectors, encrypted owner-bound secrets, confirmed enrolment, single-use and race-safe codes, clock drift, lockout, hashed single-use recovery codes, regeneration, disabling).");
} finally {
  close();
}
