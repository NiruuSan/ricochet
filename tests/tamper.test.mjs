import assert from "node:assert/strict";
import { createDatabase } from "./helpers/test-env.mjs";

// What a hostile client can reach. Every call here goes through the same
// functions the API routes call, with the inputs a tampered browser would send:
// injection payloads in every string a player controls, a board the client would
// like to rewrite, entries it cannot afford and amounts it should not be able to
// name. Nothing is asserted from a fixture shortcut; the checks read the
// database back.
const { sqlite, close } = await createDatabase();
globalThis.fetch = async () => {
  throw new Error("No network in this probe");
};

const matches = await import("../lib/matches.ts");
const profile = await import("../lib/profile.ts");
const policy = await import("../lib/payments/policy.ts");
const notifications = await import("../lib/notifications.ts");
const spectate = await import("../lib/spectate.ts");

const ANN = "tamper-ann";
const BEN = "tamper-ben";
const gems = (uid) => sqlite.prepare("SELECT balance FROM players WHERE id = ?").get(uid).balance;
const runOf = (uid) => sqlite.prepare("SELECT * FROM runs WHERE user_id = ? ORDER BY rowid DESC LIMIT 1").get(uid);
const tables = () => sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_master").get().n;

const INJECTIONS = [
  "'; DROP TABLE players;--",
  "' OR '1'='1",
  "x' UNION SELECT id, balance FROM players --",
  '"; UPDATE players SET balance = 999999;--',
  "1; UPDATE runs SET score = 999999",
  "\\'; DELETE FROM matches;--",
  "a'||(SELECT balance FROM players LIMIT 1)||'",
];

try {
  const schema = tables();
  await profile.createPlayer(ANN, "Ann");
  await profile.createPlayer(BEN, "Ben");

  // 1. Every string a player controls, with SQL in it.
  for (const payload of INJECTIONS) {
    await assert.rejects(() => profile.createPlayer("tamper-x", payload), /3–20 letters/);
    await assert.rejects(() => profile.renamePlayer(ANN, payload), /3–20 letters/);
    await assert.rejects(() => matches.joinChallenge(ANN, payload), (e) => e.status === 404);
    await assert.rejects(() => matches.createChallenge(ANN, 100, "gems", payload), (e) => e.status === 404);
    await assert.rejects(() => matches.matchRecap(ANN, payload), (e) => e.status === 404 || e.status === 403);
    await assert.rejects(() => spectate.watchRun(ANN, payload, payload), (e) => e.status === 404);
    await assert.rejects(() => matches.playShot(ANN, payload, 0, "shot", 73), (e) => e.status === 404);
    assert.equal(await spectate.runCard(payload), null);
    // These take whatever they are given and are expected to simply do nothing.
    await notifications.markNotificationsRead(ANN, { ids: [payload] });
    await notifications.markNotificationsRead(ANN, { matchId: payload });
  }
  assert.equal(tables(), schema, "No payload changed the schema");
  assert.deepEqual([gems(ANN), gems(BEN)], [2000, 2000], "No payload moved a balance");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM players").get().n, 2, "No payload created or removed a player");

  // 2. The board belongs to the server: a shot carries an angle, nothing else.
  const ann = await matches.startMatch(ANN, 100, "gems");
  assert.equal(gems(ANN), 1900, "The entry is charged from the stored balance");
  const played = await matches.playShot(ANN, ann.id, ann.revision, "shot", 73);
  const stored = JSON.parse(runOf(ANN).state);
  assert.equal(played.score, stored.score, "The answer is the stored board");
  assert.equal(runOf(ANN).score, stored.score, "The score column is the stored board's score");
  assert.ok(stored.balls >= 1 && stored.balls <= 6, `Balls come from the engine (${stored.balls})`);
  assert.ok(Array.isArray(stored.bricks), "Bricks come from the engine");

  // 3. A revision is used once: no replaying a shot, no skipping ahead.
  await assert.rejects(() => matches.playShot(ANN, ann.id, ann.revision, "shot", 73), (e) => e.status === 409);
  await assert.rejects(() => matches.playShot(ANN, ann.id, 9999, "shot", 73), (e) => e.status === 409);
  const guarded = runOf(ANN);

  // 4. Angles outside the engine's range, and things that are not angles.
  for (const angle of [0, 179, -45, 1e9, NaN, Infinity, "73", null, { valueOf: () => 73 }]) {
    await assert.rejects(() => matches.playShot(ANN, ann.id, guarded.revision, "shot", angle), /Invalid aim angle/);
  }
  assert.equal(runOf(ANN).revision, guarded.revision, "A refused shot does not move the run");

  // 5. Another player's run, whatever id is sent.
  await assert.rejects(() => matches.playShot(BEN, ann.id, guarded.revision, "shot", 73), (e) => e.status === 404);
  await assert.rejects(() => matches.playShot(BEN, ann.id, guarded.revision, "forfeit"), (e) => e.status === 404);

  // 6. Entries: one of the five amounts, and only what the player has.
  for (const stake of [0, -100, 1, 999999, "100' OR '1'='1", NaN, null, 1e308]) {
    await assert.rejects(() => matches.startMatch(BEN, stake, "gems"), /five entry amounts/);
  }
  assert.equal(gems(BEN), 2000, "A refused entry costs nothing");
  // Spent down to 100 gems, the largest entry is out of reach.
  sqlite.prepare("INSERT INTO ledger(id, user_id, match_id, kind, amount, created) VALUES('tamper-spend', ?, NULL, 'entry', -1900, 0)").run(BEN);
  await assert.rejects(() => matches.startMatch(BEN, 1000, "gems"), /Not enough gems/);
  assert.equal(gems(BEN), 100, "A refused entry costs nothing");

  // 7. The balance cannot go below zero, even from inside the ledger.
  assert.throws(
    () => sqlite.prepare("INSERT INTO ledger(id, user_id, match_id, kind, amount, created) VALUES('tamper', ?, NULL, 'payout', -999999, 0)").run(BEN),
    /balance_nonnegative|CHECK/i,
  );
  assert.equal(gems(BEN), 100);

  // 8. SOL amounts have one shape: no negatives, no notation, no hidden precision.
  for (const amount of ["-1", "-0.5", "1e9", "0", "0.0000000001", "abc", 1.5, null, "Infinity", "1,5", " 1 "]) {
    assert.throws(() => policy.parseSol(amount), /SOL amount|greater than zero/);
  }
  assert.equal(policy.parseSol("1.5"), 1_500_000_000);

  // 9. The key that generates the rows never leaves the server while the board can still be played.
  const rowKey = sqlite.prepare("SELECT row_key FROM matches WHERE id = ?").get(ann.match_id).row_key;
  const watching = JSON.stringify(await spectate.watchRun(ANN, `m-${ann.id}`, 0));
  assert.ok(rowKey, "A ruleset 6 match has a row key");
  assert.ok(!watching.includes(rowKey), "A live board never carries its row key");
  assert.ok(!JSON.stringify(played).includes(rowKey), "Nor does the run the player plays");

  console.log("PASS: injection payloads inert, boards and scores server-side, revisions single-use, angles and entries validated, balances floored, live row key withheld.");
} finally {
  close();
}
