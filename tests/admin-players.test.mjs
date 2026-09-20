import assert from "node:assert/strict";
import { createDatabase } from "./helpers/test-env.mjs";

// The register of players, and the development-phase tool that takes one off
// it: what it refuses, what it moves, and what it leaves behind.
Object.assign(process.env, { SOLANA_NETWORK: "devnet", SOLANA_RPC_URL: "https://rpc.invalid", SOLANA_VAULT_KEY: Buffer.alloc(32, 3).toString("base64") });
const { sqlite, close } = await createDatabase();

const { adminPlayers, purgePlayer } = await import("../lib/admin-players.ts");
const { createPlayer } = await import("../lib/profile.ts");
const { referralCode, applyReferral } = await import("../lib/referrals.ts");
const { cashAccountId, ensureCashAccount, HOUSE } = await import("../lib/payments/accounts.ts");
const { notificationInsert } = await import("../lib/notifications.ts");
const { database } = await import("../db/raw.ts");
const tf = await import("../lib/two-factor.ts");

const ADMIN = "github:boss";
const GONE = "github:gone";
const RIVAL = "github:rival";
const SOL = 1_000_000_000;
const NOW = Date.UTC(2026, 8, 21, 15);

const count = (sql, ...args) => sqlite.prepare(sql).get(...args).n;
const balance = (uid) => Number(sqlite.prepare("SELECT balance FROM cash_accounts WHERE id = ?").get(cashAccountId(uid))?.balance ?? 0);
const liabilities = () => Number(sqlite.prepare("SELECT COALESCE(SUM(balance), 0) AS n FROM cash_accounts").get().n);

try {
  for (const [uid, name] of [[ADMIN, "Boss"], [GONE, "Gone"], [RIVAL, "Rival"]]) await createPlayer(uid, name);
  for (const uid of [ADMIN, GONE, RIVAL, HOUSE]) await ensureCashAccount(uid);
  sqlite.prepare("INSERT INTO cash_ledger VALUES('funds', ?, 'deposit', ?, 'test', 0)").run(cashAccountId(GONE), 3 * SOL);

  // The administrator's own second factor is what signs this off.
  const setup = await tf.beginTwoFactorSetup(ADMIN, "Boss", NOW);
  await tf.confirmTwoFactorSetup(ADMIN, tf.totpCode(tf.base32Decode(setup.secret), tf.currentStep(NOW)), NOW);
  const code = (when) => tf.totpCode(tf.base32Decode(setup.secret), tf.currentStep(when));

  // A settled match against a rival, a referral, and a notification to go with it.
  sqlite.prepare("INSERT INTO matches(id, seed, stake, asset, p1, p2, settled, winner, fee, created, ruleset) VALUES('m1', 1, ?, 'devnet', ?, ?, 1, ?, 0, 0, 6)").run(SOL, GONE, RIVAL, GONE);
  for (const [id, uid] of [["r1", GONE], ["r2", RIVAL]]) {
    sqlite.prepare("INSERT INTO runs(id, match_id, user_id, state, score, done, created) VALUES(?, 'm1', ?, '{}', 700, 1, 0)").run(id, uid);
    sqlite.prepare("INSERT INTO run_shots(run_key, revision, angle, created) VALUES(?, 0, 73, 0)").run("m-" + id);
  }
  sqlite.prepare("INSERT INTO ledger(id, user_id, match_id, kind, amount, created) VALUES('l1', ?, 'm1', 'payout', 50, 0)").run(GONE);
  await applyReferral(RIVAL, await referralCode(GONE), NOW);
  await database().batch([notificationInsert(database(), "n1", GONE, "tip_received", { amount: 1, from: "Rival" }, NOW)]);

  // 1. The register: names and balances, no player IDs.
  const list = await adminPlayers();
  assert.deepEqual(list.map((p) => p.name).sort(), ["Boss", "Gone", "Rival"]);
  const gone = list.find((p) => p.name === "Gone");
  assert.deepEqual([gone.sol, gone.gems, gone.games], [3 * SOL, 2050, 1]);
  assert.ok(!JSON.stringify(list).includes(GONE), "The register carries no player IDs");

  // 2. What it refuses.
  await assert.rejects(() => purgePlayer(ADMIN, "Nobody", code(NOW), "gone?"), /No player by that name/);
  await assert.rejects(() => purgePlayer(ADMIN, "Boss", code(NOW), "myself"), /account you are signed in with/);
  await assert.rejects(() => purgePlayer(ADMIN, "Gone", code(NOW), ""), /note explaining/);
  await assert.rejects(() => purgePlayer(ADMIN, "Gone", "000000", "wrong code"), (e) => e.code === "TWO_FACTOR_INVALID");
  assert.equal(count("SELECT COUNT(*) AS n FROM players WHERE id = ?", GONE), 1, "A refused deletion removes nothing");

  // A game still in play holds it back, because the entry is still committed.
  sqlite.prepare("INSERT INTO matches(id, seed, stake, asset, p1, settled, fee, created, ruleset) VALUES('open', 2, ?, 'devnet', ?, 0, 0, 0, 6)").run(SOL, GONE);
  sqlite.prepare("INSERT INTO runs(id, match_id, user_id, state, score, done, created) VALUES('r3', 'open', ?, '{}', 0, 0, 0)").run(GONE);
  await assert.rejects(() => purgePlayer(ADMIN, "Gone", code(NOW), "still playing"), /Finish or forfeit/);
  sqlite.prepare("UPDATE runs SET done = 1 WHERE id = 'r3'").run();
  sqlite.prepare("UPDATE matches SET settled = 1 WHERE id = 'open'").run();

  // 3. The deletion itself: the money moves before the account goes.
  const pool = liabilities();
  const house = balance(HOUSE);
  const done = await purgePlayer(ADMIN, "gone", code(NOW + 60_000), "Test account from the development phase", NOW + 60_000);
  assert.deepEqual([done.name, done.swept], ["Gone", 3 * SOL]);
  assert.equal(balance(HOUSE), house + 3 * SOL, "What was left goes to the treasury");
  assert.equal(liabilities(), pool, "The pool owes exactly what it owed");

  for (const [table, where] of [
    ["players", "id = ?"],
    ["runs", "user_id = ?"],
    ["ledger", "user_id = ?"],
    ["cash_accounts", "user_id = ?"],
    ["cash_ledger", "account_id = 'devnet:' || ?"],
    ["notifications", "user_id = ?"],
    ["referral_codes", "user_id = ?"],
    ["referrals", "referrer_id = ?"],
    ["two_factor", "user_id = ?"],
  ]) {
    assert.equal(count(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`, GONE), 0, `${table} is empty of them`);
  }
  assert.equal(count("SELECT COUNT(*) AS n FROM matches WHERE id IN ('m1', 'open')"), 0, "The matches they played go with them");
  assert.equal(count("SELECT COUNT(*) AS n FROM runs WHERE match_id = 'm1'"), 0, "Including the other side of them");
  assert.equal(count("SELECT COUNT(*) AS n FROM run_shots WHERE run_key IN ('m-r1', 'm-r2')"), 0);
  assert.equal(count("SELECT COUNT(*) AS n FROM players WHERE id = ?", RIVAL), 1, "The rival keeps their account");

  // 4. The one record that outlives the account.
  const audit = sqlite.prepare("SELECT action, target_user_id, reason FROM admin_audit ORDER BY created DESC").get();
  assert.equal(audit.action, "player_deleted");
  assert.equal(audit.target_user_id, GONE);
  assert.match(audit.reason, /development phase · 3000000000 lamports to the treasury/);
  assert.equal((await adminPlayers()).length, 2);

  console.log(
    "PASS: admin player register (names only, balances, runs), deletion refused without a reason, a valid code, or with a game in play, never the administrator's own, funds swept to the treasury with the pool conserved, every table emptied, the rival untouched, and the decision kept in the audit log.",
  );
} finally {
  close();
}
