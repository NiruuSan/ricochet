import assert from "node:assert/strict";
import { createDatabase } from "./helpers/test-env.mjs";

// Taking your data with you, and closing the account: what leaves, what stays,
// and what the rest of the site sees afterwards.
Object.assign(process.env, { SOLANA_NETWORK: "devnet", SOLANA_RPC_URL: "https://rpc.invalid", SOLANA_VAULT_KEY: Buffer.alloc(32, 7).toString("base64") });
const { sqlite, close } = await createDatabase();

const { exportAccount, deleteAccount } = await import("../lib/account.ts");
const { createPlayer, setAvatar } = await import("../lib/profile.ts");
const { playerSnapshot, leaderboard } = await import("../lib/matches.ts");
const { publicProfile } = await import("../lib/public-profile.ts");
const { notificationInsert } = await import("../lib/notifications.ts");
const { cashAccountId, ensureCashAccount } = await import("../lib/payments/accounts.ts");
const tf = await import("../lib/two-factor.ts");
const { database } = await import("../db/raw.ts");

const ANA = "github:leaver";
const RIV = "github:rival";
const NOW = Date.UTC(2026, 8, 20, 9);
const player = (uid) => sqlite.prepare("SELECT * FROM players WHERE id = ?").get(uid);
const count = (sql, ...args) => sqlite.prepare(sql).get(...args).n;

try {
  await createPlayer(ANA, "Ana");
  await createPlayer(RIV, "Rival");
  // A tiny 1x1 PNG is enough to own a picture.
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100ffff03000006000557bfabd4000000004945", "hex");
  await setAvatar(ANA, `data:image/png;base64,${png.toString("base64")}`);
  const secret = await tf.beginTwoFactorSetup(ANA, "Ana", NOW);
  await tf.confirmTwoFactorSetup(ANA, tf.totpCode(tf.base32Decode(secret.secret), tf.currentStep(NOW)), NOW);
  await ensureCashAccount(ANA);
  await database().batch([notificationInsert(database(), "n1", ANA, "tip_received", { amount: 1, from: "Rival" }, NOW)]);

  // A settled match against a rival, with both ledger sides.
  sqlite.prepare("INSERT INTO matches(id, seed, stake, asset, p1, p2, settled, winner, fee, created, ruleset) VALUES('m1', 1, 100, 'gems', ?, ?, 1, ?, 0, ?, 6)").run(ANA, RIV, ANA, NOW);
  for (const [id, uid, score] of [["r1", ANA, 900], ["r2", RIV, 400]]) {
    sqlite.prepare("INSERT INTO runs(id, match_id, user_id, state, revision, score, done, created) VALUES(?, 'm1', ?, '{}', 3, ?, 1, ?)").run(id, uid, score, NOW);
  }
  sqlite.prepare("INSERT INTO ledger(id, user_id, match_id, kind, amount, created) VALUES('l1', ?, 'm1', 'entry', -100, ?)").run(ANA, NOW);
  sqlite.prepare("INSERT INTO ledger(id, user_id, match_id, kind, amount, created) VALUES('l2', ?, 'm1', 'payout', 200, ?)").run(ANA, NOW);

  // 1. The export carries the account, and none of the keys behind it.
  const data = await exportAccount(ANA, NOW);
  assert.equal(data.profile[0].name, "Ana");
  assert.equal(data.profile[0].balance, 2100);
  assert.deepEqual(data.gemLedger.map((l) => l.id), ["l1", "l2"]);
  assert.equal(data.games[0].score, 900);
  assert.deepEqual([data.matches[0].id, data.matches[0].opponent, data.matches[0].outcome], ["m1", "Rival", "you"]);
  assert.equal(data.notifications.length, 1);
  assert.equal(data.twoFactor[0].enabled, 1);
  const serialized = JSON.stringify(data);
  const stored = sqlite.prepare("SELECT secret FROM two_factor WHERE user_id = ?").get(ANA).secret;
  const rowKey = sqlite.prepare("SELECT row_key FROM matches WHERE id = 'm1'").get().row_key;
  for (const kept of [stored, secret.secret, RIV, rowKey].filter(Boolean)) {
    assert.ok(!serialized.includes(kept), "The export carries no secret and no other player's ID");
  }

  // 2. A game still in play, and money still in the account, both hold it back.
  sqlite.prepare("INSERT INTO matches(id, seed, stake, asset, p1, settled, fee, created, ruleset) VALUES('m2', 2, 100, 'gems', ?, 0, 0, ?, 6)").run(ANA, NOW);
  sqlite.prepare("INSERT INTO runs(id, match_id, user_id, state, revision, score, done, created) VALUES('open', 'm2', ?, '{}', 0, 0, 0, ?)").run(ANA, NOW);
  await assert.rejects(() => deleteAccount(ANA, NOW), /Finish or forfeit your game/);
  sqlite.prepare("UPDATE runs SET done = 1 WHERE id = 'open'").run();
  await assert.rejects(() => deleteAccount(ANA, NOW), /still being played/);
  sqlite.prepare("UPDATE matches SET settled = 1 WHERE id = 'm2'").run();
  sqlite.prepare("INSERT INTO cash_ledger VALUES('funds', ?, 'deposit', 5000, 'test', 0)").run(cashAccountId(ANA));
  await assert.rejects(() => deleteAccount(ANA, NOW), /Withdraw your devnet SOL/);
  sqlite.prepare("INSERT INTO cash_ledger VALUES('spent', ?, 'withdrawal_reserve', -5000, 'test', 0)").run(cashAccountId(ANA));

  // 3. Closing the account: the person goes, the accounting stays.
  const closed = await deleteAccount(ANA, NOW);
  assert.equal(closed.deleted, true);
  const row = player(ANA);
  assert.match(row.name, /^deleted-[0-9a-f]{10}$/, "The name is replaced by one nobody can reach");
  assert.deepEqual([row.avatar, row.deleted], [null, NOW]);
  assert.equal(row.balance, 2100, "The balance still reconciles with the ledger");
  assert.equal(count("SELECT COUNT(*) AS n FROM avatars WHERE user_id = ?", ANA), 0);
  assert.equal(count("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ?", ANA), 0);
  assert.equal(count("SELECT COUNT(*) AS n FROM two_factor WHERE user_id = ?", ANA), 0);
  assert.equal(count("SELECT COUNT(*) AS n FROM two_factor_recovery WHERE user_id = ?", ANA), 0);
  assert.equal(count("SELECT COUNT(*) AS n FROM ledger WHERE user_id = ?", ANA), 2, "Both sides of a settled match keep their rows");
  assert.equal(count("SELECT COUNT(*) AS n FROM runs WHERE user_id = ?", ANA), 2);
  await assert.rejects(() => deleteAccount(ANA, NOW), /no account to delete/);
  const { sessionCurrent } = await import("../lib/sessions.ts");
  assert.equal(await sessionCurrent(ANA, NOW - 1000, NOW + 1), false, "Whatever was signed in to it is signed out");

  // 4. The rest of the site treats it as no account at all.
  const snapshot = await playerSnapshot(ANA, "gems");
  assert.equal(snapshot.player, null, "There is no profile to show");
  await assert.rejects(() => publicProfile({ id: ANA }), /not found/);
  assert.ok(!(await leaderboard(null, "gems")).some((l) => l.name.startsWith("deleted-")), "A closed account is off the leaderboard");
  assert.deepEqual((await publicProfile("Rival")).stats.gems, { pnl: 0, games: 1, wins: 0 }, "The rival keeps their history");

  // 5. Coming back starts over on the same row, with a new name.
  assert.equal(await createPlayer(ANA, "Ana2"), true);
  assert.deepEqual([player(ANA).name, player(ANA).deleted], ["Ana2", null]);
  assert.equal(await createPlayer(ANA, "Ana3"), false, "An account that is open is never renamed by signing up again");
  assert.equal(player(ANA).name, "Ana2");

  console.log("PASS: account export (every row, no secrets, no other player's ID), deletion blocked by play and by funds, identity scrubbed with the ledger intact, closed accounts hidden from the site, and reopening on the same row.");
} finally {
  close();
}
