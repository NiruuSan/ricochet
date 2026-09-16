import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { randomBytes, randomUUID } from "node:crypto";
import { Keypair } from "@solana/web3.js";
import { createDatabase } from "./helpers/test-env.mjs";

Object.assign(process.env, { RICOCHET_ADMIN_USER_ID: "github:admin", SOLANA_NETWORK: "devnet", SOLANA_RPC_URL: "https://rpc.invalid", SOLANA_VAULT_KEY: randomBytes(32).toString("base64") });
const { sqlite, DB, close } = await createDatabase();
// Only authentication is replaced: exercise real route guards, parsers, limits and SQL.
globalThis.securityTestUser = null;
const hook = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "@/lib/auth-user") return { url: "test:security-auth", shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === "test:security-auth") return { format: "module", shortCircuit: true, source: `
      export { stepUpRequired } from ${JSON.stringify(new URL("../lib/step-up.ts", import.meta.url).href)};
      export async function currentUser() { return globalThis.securityTestUser; }
      export async function administrator() { const u = globalThis.securityTestUser; return u?.userId === process.env.RICOCHET_ADMIN_USER_ID ? u : null; }
    ` };
    return next(url, context);
  },
});

try {
  const tf = await import("../lib/two-factor.ts");
  const security = await import("../lib/security-admin.ts");
  const { SECURITY_RESET_HOLD_MS, withdrawalHold } = await import("../lib/security-holds.ts");
  const service = await import("../lib/payments/service.ts");
  const route = await import("../app/api/admin/security/route.ts");
  const own = await import("../app/api/security/route.ts");
  const { listNotifications } = await import("../lib/notifications.ts");
  const admin = "github:admin", target = "discord:player";
  const now = Date.now();
  const reason = "Verified ownership through the linked provider account discord:player.";
  for (const [id, name] of [[admin, "Operator"], [target, "PlayerOne"]]) sqlite.prepare("INSERT INTO players(id, name, created) VALUES(?, ?, ?)").run(id, name, now);
  const enroll = async (uid, name, at) => {
    const setup = await tf.beginTwoFactorSetup(uid, name, at);
    const result = await tf.confirmTwoFactorSetup(uid, tf.totpCode(tf.base32Decode(setup.secret), tf.currentStep(at)), at);
    return { ...setup, ...result };
  };
  const player = await enroll(target, "PlayerOne", now);
  const post = (body, headers = {}) => route.POST(new Request("https://ricochet.test/api/admin/security", { method: "POST", headers: { origin: "https://ricochet.test", "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));
  const body = { action: "reset", name: "PlayerOne", reason, code: "invalid" };
  const get = () => route.GET(new Request("https://ricochet.test/api/admin/security?name=playerone"));
  for (const user of [null, { userId: target, authTime: now }]) {
    globalThis.securityTestUser = user;
    assert.equal((await get()).status, 403);
    assert.equal((await post(body)).status, 403);
  }
  await assert.rejects(() => security.adminResetTwoFactor(target, "PlayerOne", reason, player.recoveryCodes[0], now), /Administrator access/);
  globalThis.securityTestUser = { userId: admin, authTime: null };
  assert.equal((await (await post(body)).json()).code, "REAUTH_REQUIRED");
  globalThis.securityTestUser.authTime = now;
  assert.equal((await post(body, { origin: "https://evil.test" })).status, 403);
  assert.equal((await post(body, { "content-type": "text/plain" })).status, 415);
  assert.equal((await post({ ...body, reason: "x".repeat(3000) })).status, 413);
  assert.equal((await (await post(body)).json()).code, "TWO_FACTOR_REQUIRED");
  const operator = await enroll(admin, "Operator", now);
  assert.equal((await (await post({ ...body, code: player.recoveryCodes[0] })).json()).code, "TWO_FACTOR_INVALID", "A player's code cannot authorize the administrator");
  sqlite.prepare("UPDATE two_factor SET failures = 0 WHERE user_id = ?").run(admin);
  for (const bad of ["short", "x".repeat(301), null]) assert.equal((await post({ ...body, reason: bad })).status, 400);
  assert.equal((await tf.twoFactorStatus(admin)).recoveryCodesLeft, 10);
  for (let i = 0; i < tf.MAX_FAILURES; i++) assert.equal((await (await post(body)).json()).code, "TWO_FACTOR_INVALID");
  assert.ok(sqlite.prepare("SELECT locked_until FROM two_factor WHERE user_id = ?").get(admin).locked_until > now);
  assert.equal((await (await post({ ...body, code: operator.recoveryCodes[0] })).json()).code, "TWO_FACTOR_LOCKED");
  assert.equal((await tf.twoFactorStatus(target)).enabled, true);
  sqlite.prepare("UPDATE two_factor SET locked_until = 0, failures = 0 WHERE user_id = ?").run(admin);
  sqlite.exec("DELETE FROM rate_limits");

  // A failure in the last operation rolls back 2FA deletion, the hold and audit.
  sqlite.exec("CREATE TRIGGER fail_reset_notification BEFORE INSERT ON notifications WHEN NEW.kind = 'security_reset' BEGIN SELECT RAISE(ABORT, 'test notification failure'); END");
  assert.equal((await post({ ...body, code: operator.recoveryCodes[0] })).status, 503);
  assert.equal((await tf.twoFactorStatus(target)).enabled, true);
  assert.equal((await tf.twoFactorStatus(target)).recoveryCodesLeft, 10);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM security_holds").get().n, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM admin_audit").get().n, 0);
  sqlite.exec("DROP TRIGGER fail_reset_notification");

  const response = await post({ ...body, code: operator.recoveryCodes[1] });
  assert.equal(response.status, 200);
  const reset = await response.json();
  const audit = sqlite.prepare("SELECT * FROM admin_audit").get();
  assert.equal(reset.withdrawalHoldUntil, audit.created + SECURITY_RESET_HOLD_MS);
  assert.equal(audit.admin_id, admin);
  assert.equal(audit.target_user_id, target);
  assert.equal(audit.reason, reason);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM two_factor WHERE user_id = ?").get(target).n, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM two_factor_recovery WHERE user_id = ?").get(target).n, 0);
  const notifications = await listNotifications(target);
  assert.equal(notifications.items[0].kind, "security_reset");
  assert.equal(notifications.items[0].data.holdUntil, reset.withdrawalHoldUntil);
  assert.equal(notifications.unread, 1);

  const destination = Keypair.generate().publicKey.toBase58();
  for (const uid of [target, service.HOUSE]) {
    await service.ensureCashAccount(uid);
    await DB.batch([DB.prepare("INSERT INTO cash_ledger VALUES(?, ?, 'fixture', ?, 'fixture', ?)").bind(randomUUID(), service.cashAccountId(uid), 1_000_000_000, now)]);
  }
  const precheck = (at, treasury = false) => service.precheckWithdrawal(target, destination, "0.1", treasury, at);
  await assert.rejects(() => precheck(reset.withdrawalHoldUntil - 1), /Withdrawals are paused until/);
  await precheck(reset.withdrawalHoldUntil);
  await precheck(now, true);
  await assert.rejects(() => service.beginWithdrawal(target, randomUUID(), destination, "0.1"), /Withdrawals are paused/);
  const reenrolled = await enroll(target, "PlayerOne", now + 30_000);
  await assert.rejects(() => precheck(now + 30_000), /Withdrawals are paused/);
  assert.equal(await withdrawalHold(target, reset.withdrawalHoldUntil), null);
  globalThis.securityTestUser = { userId: target, authTime: now };
  assert.equal((await (await own.GET()).json()).withdrawalHoldUntil, reset.withdrawalHoldUntil);
  globalThis.securityTestUser = { userId: admin, authTime: now };

  // The SQL guard aborts a withdrawal/reservation batch even if a reset occurred after its precheck.
  const balanceBefore = sqlite.prepare("SELECT balance FROM cash_accounts WHERE id = ?").get(service.cashAccountId(target)).balance;
  const insert = (id, at) => DB.prepare(`INSERT INTO cash_transfers(id, network, user_id, account_id, kind, source, destination, amount, fee, signature, wire, last_valid_block_height, status, created, updated)
    VALUES(?, 'devnet', ?, ?, 'withdrawal', 'test-source', ?, 100, 5, ?, 'wire', 100, 'pending', ?, ?)`).bind(id, target, service.cashAccountId(target), destination, id, at, at);
  await assert.rejects(() => DB.batch([
    DB.prepare("INSERT INTO cash_ledger VALUES('race-reserve', ?, 'withdrawal_reserve', -105, 'race', ?)").bind(service.cashAccountId(target), now),
    insert("race", now),
  ]), /security withdrawal hold/);
  assert.equal(sqlite.prepare("SELECT balance FROM cash_accounts WHERE id = ?").get(service.cashAccountId(target)).balance, balanceBefore);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM cash_transfers").get().n, 0);
  await DB.batch([insert("after-expiry", reset.withdrawalHoldUntil)]);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM cash_transfers").get().n, 1);

  const snapshot = await (await get()).json();
  assert.equal(snapshot.player.name, "PlayerOne");
  assert.equal(snapshot.player.enabled, true);
  assert.equal(snapshot.player.enabledAt, now + 30_000);
  assert.equal(snapshot.recent[0].adminName, "Operator");
  const serialized = JSON.stringify({ snapshot, reset, notifications });
  for (const privateValue of [admin, target, operator.secret, player.secret, reenrolled.secret, operator.recoveryCodes[2], sqlite.prepare("SELECT code_hash FROM two_factor_recovery LIMIT 1").get().code_hash]) assert.ok(!serialized.includes(privateValue));
  for (const key of ['"secret"', '"code_hash"', '"admin_id"', '"user_id"', '"target_user_id"']) assert.ok(!serialized.includes(key));
  assert.equal((await security.adminTwoFactorLookup("missing")).player, null);

  // Repeated resets extend the hold; the same administrator code cannot be reused.
  const later = now + 60_000;
  const second = await security.adminResetTwoFactor(admin, "playerone", reason, operator.recoveryCodes[2], later);
  assert.ok(second.withdrawalHoldUntil > reset.withdrawalHoldUntil);
  await assert.rejects(() => security.adminResetTwoFactor(admin, "PlayerOne", reason, operator.recoveryCodes[2], later), (e) => e.code === "TWO_FACTOR_INVALID");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM admin_audit").get().n, 2);
  sqlite.exec("DELETE FROM rate_limits");
  for (let i = 0; i < 20; i++) assert.equal((await post({ ...body, action: "unknown" })).status, 400);
  assert.equal((await post(body)).status, 429);
  console.log("PASS: admin 2FA recovery guards, step-up, admin lockout, atomic rollback, reset audit and notification, private responses, persistent 72-hour hold, treasury exemption, expiry and database race guard.");
} finally {
  hook.deregister();
  delete globalThis.securityTestUser;
  close();
}
