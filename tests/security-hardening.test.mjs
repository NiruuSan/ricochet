import assert from "node:assert/strict";
import { createDatabase } from "./helpers/test-env.mjs";

// The hardening pass: administrator changes need a fresh second factor bound to
// one session; money leaving one account is capped per 24 hours; the scheduled
// sweep only answers its exact secret.
const ADMIN = "github:1";
Object.assign(process.env, {
  SOLANA_VAULT_KEY: Buffer.alloc(32, 5).toString("base64"),
  SOLANA_NETWORK: "devnet",
  SOLANA_RPC_URL: "https://rpc.invalid",
  RICOCHET_ADMIN_USER_ID: ADMIN,
  CRON_SECRET: "a-long-random-secret-of-at-least-thirty-two-chars",
});
const { sqlite, close } = await createDatabase();
globalThis.fetch = async () => {
  throw new Error("These checks must not touch the network");
};
const tf = await import("../lib/two-factor.ts");
const guard = await import("../lib/admin-guard.ts");
const { signOutEverywhere, forgetSessionCache } = await import("../lib/sessions.ts");
const service = await import("../lib/payments/service.ts");
const { cashAccountId, ensureCashAccount } = await import("../lib/payments/accounts.ts");
const { Keypair } = await import("@solana/web3.js");

const SOL = 1_000_000_000;
const HOUR = 3_600_000;
const run = (sql, ...args) => sqlite.prepare(sql).run(...args);

try {
  // ---------------------------------------------------------------- sudo mode
  const now = Date.UTC(2026, 9, 13, 12, 0, 10);
  const codeAt = (secretText, when) => tf.totpCode(tf.base32Decode(secretText), tf.currentStep(when));
  run("INSERT INTO players(id, name, balance, created) VALUES(?, 'Boss', 0, 0)", ADMIN);

  // No authenticator yet: nothing to confirm with, so nothing opens.
  await assert.rejects(() => guard.elevate(ADMIN, "session-a", "123456", now), (e) => e.code === "TWO_FACTOR_REQUIRED", "An administrator without 2FA cannot unlock changes");
  const setup = await tf.beginTwoFactorSetup(ADMIN, "Boss", now);
  await tf.confirmTwoFactorSetup(ADMIN, codeAt(setup.secret, now), now);

  assert.equal(await guard.isElevated(ADMIN, "session-a", now), false, "A fresh session is not elevated");
  const at = now + 60_000;
  await assert.rejects(() => guard.elevate(ADMIN, "session-a", "000000", at), (e) => e.code === "TWO_FACTOR_INVALID", "A wrong code opens nothing");
  assert.equal(await guard.isElevated(ADMIN, "session-a", at), false);
  assert.equal(sqlite.prepare("SELECT failures FROM two_factor WHERE user_id = ?").get(ADMIN).failures, 1, "and it counts against the lock like any other");

  const opened = await guard.elevate(ADMIN, "session-a", codeAt(setup.secret, at), at);
  assert.equal(opened.until, at + guard.ELEVATION_MS);
  assert.equal(await guard.isElevated(ADMIN, "session-a", at + 1000), true, "The code opens this session");
  assert.equal(await guard.isElevated(ADMIN, "session-b", at + 1000), false, "and no other: a copied cookie of a different session gets nothing");
  assert.equal(await guard.isElevated("github:2", "session-a", at + 1000), false, "nor another user on the same key");
  assert.equal(await guard.isElevated(ADMIN, "session-a", at + guard.ELEVATION_MS + 1), false, "It closes on its own after 15 minutes");
  assert.equal(await guard.isElevated(ADMIN, null, at + 1000), false, "No session, no window");
  assert.ok(
    sqlite.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND data LIKE '%admin_elevated%'").get(ADMIN).n === 1,
    "The administrator is told every time a window opens",
  );
  // The same code cannot open a second session.
  await assert.rejects(() => guard.elevate(ADMIN, "session-b", codeAt(setup.secret, at), at + 2000), (e) => e.code === "TWO_FACTOR_INVALID", "A code is spent once");

  // Signing out everywhere closes every window at once.
  const later = at + 90_000;
  await guard.elevate(ADMIN, "session-c", codeAt(setup.secret, later), later);
  assert.equal(await guard.isElevated(ADMIN, "session-c", later + 1000), true);
  await signOutEverywhere(ADMIN, later + 2000);
  forgetSessionCache();
  assert.equal(await guard.isElevated(ADMIN, "session-c", later + 3000), false, "Signing out everywhere ends sudo mode on every device");

  // --------------------------------------------------- 24-hour withdrawal cap
  const UID = "github:3";
  run("INSERT INTO players(id, name, balance, created) VALUES(?, 'Ann', 0, 0)", UID);
  await ensureCashAccount(UID);
  run("INSERT INTO cash_ledger VALUES('fund', ?, 'deposit', ?, 'fixture', 0)", cashAccountId(UID), 500 * SOL);
  const destination = Keypair.generate().publicKey.toBase58();
  const t = Date.now();
  const sent = (id, amount, status, created) =>
    run(
      `INSERT INTO cash_transfers(id, network, user_id, account_id, kind, source, destination, amount, fee, signature, wire, last_valid_block_height, status, created, updated)
       VALUES(?, 'devnet', ?, ?, 'withdrawal', 'pool', ?, ?, 5000, ?, 'wire', 1, ?, ?, ?)`,
      id, UID, cashAccountId(UID), destination, amount, `sig-${id}`, status, created, created,
    );
  assert.equal(service.dailyWithdrawalLimit(), service.DEFAULT_DAILY_WITHDRAWAL_SOL * SOL, "50 SOL a day unless configured");
  sent("w1", 30 * SOL, "finalized", t - 2 * HOUR);
  sent("w2", 15 * SOL, "pending", t - HOUR);
  sent("w3", 40 * SOL, "failed", t - HOUR);
  sent("w4", 40 * SOL, "finalized", t - 25 * HOUR);
  await service.precheckWithdrawal(UID, destination, "5", false, t);
  await assert.rejects(() => service.precheckWithdrawal(UID, destination, "5.000000001", false, t), /limited to 50 SOL in any 24 hours.*5 SOL today/, "45 SOL already left today: 5 more is the most");
  process.env.WITHDRAWAL_DAILY_LIMIT_SOL = "100";
  await service.precheckWithdrawal(UID, destination, "55", false, t);
  process.env.WITHDRAWAL_DAILY_LIMIT_SOL = "nonsense";
  assert.equal(service.dailyWithdrawalLimit(), 50 * SOL, "A setting that is not a positive number falls back to the default");
  delete process.env.WITHDRAWAL_DAILY_LIMIT_SOL;

  // ---------------------------------------------------------------- the cron
  const cron = await import("../app/api/cron/sweep/route.ts");
  const call = (header) => cron.GET(new Request("https://bounce.test/api/cron/sweep", { headers: header === undefined ? {} : { authorization: header } }));
  for (const header of [undefined, "", "Bearer", `Bearer ${process.env.CRON_SECRET.slice(0, -1)}`, `Bearer ${process.env.CRON_SECRET}x`, process.env.CRON_SECRET]) {
    assert.equal((await call(header)).status, 404, `The sweep does not answer ${JSON.stringify(header)}`);
  }

  console.log(
    "PASS: security hardening (administrator changes need a fresh 2FA code, bound to one session and one user, closing after 15 minutes and on sign-out everywhere, spent once, counted against the lock and announced to the owner; withdrawals capped per 24 hours with failed and older transfers not counted, configurable, and checked only once the balance is there; the sweep refusing every near-miss of its secret).",
  );
} finally {
  close();
}
