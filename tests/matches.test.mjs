import assert from "node:assert/strict";
import { createDatabase } from "./helpers/worker-env.mjs";

// Real matchmaking, shot, settlement and snapshot code against SQLite built
// from the committed migrations.
const { sqlite, DB, statements } = createDatabase();
globalThis.__workerTestEnv = {
  DB,
  RICOCHET_ADMIN_USER_ID: "admin-user",
  SOLANA_NETWORK: "devnet",
  SOLANA_RPC_URL: "https://rpc.invalid",
  SOLANA_VAULT_KEY: Buffer.alloc(32, 7).toString("base64"),
};
globalThis.fetch = async () => {
  throw new Error("Match code must not touch the network");
};

const matches = await import("../lib/matches.ts");
const engine = await import("../lib/engine.ts");
const service = await import("../lib/payments/service.ts");
const { rateLimited, LIMITS } = await import("../lib/rate-limit.ts");

const ALICE = "user-alice-private-id";
const BOB = "user-bob-private-id";
const CAROL = "user-carol-private-id";
const DAN = "user-dan-private-id";
for (const [id, name] of [
  [ALICE, "alice"],
  [BOB, "bob"],
  [CAROL, "carol"],
  [DAN, "dan"],
]) {
  sqlite.prepare("INSERT INTO players(id, name, created) VALUES(?, ?, 0)").run(id, name);
}
const demoBalance = (uid) => sqlite.prepare("SELECT balance FROM players WHERE id = ?").get(uid).balance;
const cashBalance = (uid) => sqlite.prepare("SELECT balance FROM cash_accounts WHERE id = ?").get(service.cashAccountId(uid))?.balance ?? 0;
const matchRow = (id) => sqlite.prepare("SELECT * FROM matches WHERE id = ?").get(id);
const STAKE = 50_000_000;

// New matches record the current ruleset.
const aliceRun = await matches.startMatch(ALICE, STAKE, "demo");
assert.equal(aliceRun.ruleset, engine.RULESET);
assert.equal(matchRow(aliceRun.match_id).ruleset, engine.RULESET);
assert.equal(demoBalance(ALICE), 20_000_000_000 - STAKE);
assert.equal("user_id" in aliceRun, false);

// Forfeiting an unjoined match cancels it: nobody can take the seat, and the
// creator gets the entry back minus the 12% fee, exactly once.
const cancelled = await matches.playShot(ALICE, aliceRun.id, aliceRun.revision, "forfeit");
assert.equal(cancelled.done, 1);
let m = matchRow(aliceRun.match_id);
assert.deepEqual([m.settled, m.cancelled, m.fee, m.winner, m.p2], [1, 1, 6_000_000, null, null]);
assert.equal(demoBalance(ALICE), 20_000_000_000 - 6_000_000);
await matches.settle(aliceRun.match_id);
assert.equal(demoBalance(ALICE), 20_000_000_000 - 6_000_000, "Cancellation refunds once");
const bobRun = await matches.startMatch(BOB, STAKE, "demo");
assert.notEqual(bobRun.match_id, aliceRun.match_id, "A cancelled match cannot be joined");

// Even before settlement runs, a match whose creator forfeited is not joinable.
sqlite.prepare("INSERT INTO matches(id, seed, stake, asset, p1, created, ruleset) VALUES('carol-open', 5, ?, 'demo', ?, 1, 3)").run(100_000_000, CAROL);
sqlite.prepare("INSERT INTO runs(id, match_id, user_id, state, done, forfeit, created) VALUES('carol-run', 'carol-open', ?, '{}', 1, 1, 1)").run(CAROL);
sqlite.prepare("INSERT INTO ledger VALUES('carol-run:entry', ?, 'carol-open', 'entry', -100000000, 1)").run(CAROL);
const danRun = await matches.startMatch(DAN, 100_000_000, "demo");
assert.notEqual(danRun.match_id, "carol-open");
assert.equal(matchRow("carol-open").p2, null);

// Normal play: Carol joins Bob's open match and both runs share its seed and ruleset.
const carolRun = await matches.startMatch(CAROL, STAKE, "demo");
assert.equal(carolRun.match_id, bobRun.match_id);
assert.deepEqual(carolRun.state, bobRun.state);
// Give Bob a full top row so his one shot is guaranteed to score.
const bobBoard = { ...bobRun.state, bricks: [0, 1, 2, 3, 4, 5, 6].map((col) => ({ col, row: 7, hp: 1 })) };
sqlite.prepare("UPDATE runs SET state = ? WHERE id = ?").run(JSON.stringify(bobBoard), bobRun.id);
const shot = await matches.playShot(BOB, bobRun.id, bobRun.revision, "shot", 73);
assert.deepEqual(shot.state, engine.simulate(bobBoard, 73, engine.RULESET));
assert.ok(shot.state.score > 0);
await assert.rejects(() => matches.playShot(BOB, bobRun.id, bobRun.revision, "shot", 73), (e) => e instanceof matches.GameError && e.status === 409);
await assert.rejects(() => matches.playShot(BOB, bobRun.id, shot.revision, "shot", 3), /Invalid aim angle/);
await matches.playShot(BOB, bobRun.id, shot.revision, "forfeit");
await matches.playShot(CAROL, carolRun.id, carolRun.revision, "forfeit");
// Both forfeited: scores decide. Bob scored with his one shot, Carol did not.
m = matchRow(bobRun.match_id);
assert.equal(m.settled, 1);
assert.equal(m.cancelled, 0);
assert.equal(m.winner, BOB);

// Snapshots settle only unsettled matches and never expose other players' IDs.
statements.length = 0;
const snapshot = await matches.playerSnapshot(BOB, "demo");
assert.equal(statements.filter((s) => s.startsWith("SELECT * FROM matches WHERE id")).length, 0, "Settled matches are not re-settled");
const serialized = JSON.stringify(snapshot);
for (const id of [ALICE, CAROL, DAN, BOB]) assert.ok(!serialized.includes(id), `snapshot leaked ${id}`);
const bobMatch = snapshot.matches.find((x) => x.id === bobRun.match_id);
assert.equal(bobMatch.opponent, "carol");
assert.equal(bobMatch.joined, 1);
assert.equal(bobMatch.result, "win");
assert.equal(bobMatch.net, (STAKE * 76) / 100);
assert.equal(bobMatch.opponent_score, 0);
assert.equal(snapshot.leaders.find((l) => l.name === "bob").is_you, 1);
assert.equal(snapshot.leaders.find((l) => l.name === "bob").pnl, (STAKE * 76) / 100);
assert.equal(snapshot.leaders.find((l) => l.name === "carol").is_you, 0);
const aliceSnapshot = await matches.playerSnapshot(ALICE, "demo");
assert.deepEqual(
  aliceSnapshot.matches.map((x) => [x.result, x.net, x.joined]),
  [["cancelled", -6_000_000, 0]],
);
assert.equal(aliceSnapshot.leaders.find((l) => l.name === "alice").pnl, -6_000_000);
assert.equal(aliceSnapshot.isAdmin, false);

// Finished-but-unsettled matches are picked up by the player's next snapshot:
// here Bob's match (reset below) and Carol's forfeited open match.
sqlite.prepare("UPDATE matches SET settled = 0, winner = NULL, fee = 0 WHERE id = ?").run(bobRun.match_id);
sqlite.prepare("DELETE FROM ledger WHERE id LIKE ?").run(`${bobRun.match_id}:payout:%`);
statements.length = 0;
await matches.playerSnapshot(CAROL, "demo");
assert.equal(statements.filter((s) => s.startsWith("SELECT * FROM matches WHERE id")).length, 2);
assert.equal(matchRow(bobRun.match_id).settled, 1);
assert.equal(matchRow("carol-open").cancelled, 1);
statements.length = 0;
await matches.playerSnapshot(CAROL, "demo");
assert.equal(statements.filter((s) => s.startsWith("SELECT * FROM matches WHERE id")).length, 0);

// Existing ruleset 2 matches keep playing under ruleset 2; retired rulesets can only be forfeited.
sqlite.prepare("INSERT INTO matches(id, seed, stake, asset, p1, created, ruleset) VALUES('legacy', 99, ?, 'demo', ?, 2, 2)").run(STAKE, DAN);
const legacyState = engine.initial(99);
sqlite.prepare("UPDATE runs SET done = 1 WHERE user_id = ?").run(DAN);
sqlite.prepare("INSERT INTO runs(id, match_id, user_id, state, created) VALUES('legacy-run', 'legacy', ?, ?, 2)").run(DAN, JSON.stringify(legacyState));
const legacyShot = await matches.playShot(DAN, "legacy-run", 0, "shot", 101.5);
assert.equal(legacyShot.ruleset, 2);
assert.deepEqual(legacyShot.state, engine.simulate(legacyState, 101.5, 2));
sqlite.prepare("UPDATE runs SET done = 1 WHERE user_id = ?").run(DAN);
sqlite.prepare("INSERT INTO matches(id, seed, stake, asset, p1, created, ruleset) VALUES('retired', 1, ?, 'demo', ?, 3, 1)").run(STAKE, DAN);
sqlite.prepare("INSERT INTO runs(id, match_id, user_id, state, created) VALUES('retired-run', 'retired', ?, ?, 3)").run(DAN, JSON.stringify(engine.initial(1)));
await assert.rejects(() => matches.playShot(DAN, "retired-run", 0, "shot", 90), /retired ruleset/);
assert.equal((await matches.playShot(DAN, "retired-run", 0, "forfeit")).done, 1);
sqlite.prepare("INSERT INTO matches(id, seed, stake, asset, p1, created, ruleset) VALUES('retired-open', 1, ?, 'demo', ?, 4, 1)").run(STAKE, ALICE);
assert.notEqual((await matches.startMatch(BOB, STAKE, "demo")).match_id, "retired-open", "Unsupported rulesets are not matched");

// Devnet cancellation moves escrow to the player (88%) and the house (12%).
sqlite.prepare("UPDATE runs SET done = 1").run();
await service.ensureCashAccount(CAROL);
sqlite.prepare("INSERT INTO cash_ledger VALUES('fund-carol', ?, 'fixture', 1000000000, 'fixture', 0)").run(service.cashAccountId(CAROL));
const devnetRun = await matches.startMatch(CAROL, 1_000_000_000, "devnet");
assert.equal(cashBalance(CAROL), 0);
assert.equal(cashBalance("escrow:" + devnetRun.match_id), 1_000_000_000);
await matches.playShot(CAROL, devnetRun.id, devnetRun.revision, "forfeit");
assert.equal(cashBalance(CAROL), 880_000_000);
assert.equal(cashBalance(service.HOUSE), 120_000_000);
assert.equal(cashBalance("escrow:" + devnetRun.match_id), 0);
const devnetLeaders = (await matches.playerSnapshot(CAROL, "devnet")).leaders;
assert.equal(devnetLeaders.find((l) => l.name === "carol").pnl, -120_000_000);

// Fixed-window rate limiting.
const now = 1_000_000 * 60_000;
for (let i = 0; i < LIMITS.walletWrite; i++) assert.equal(await rateLimited("walletWrite", ALICE, now), false);
assert.equal(await rateLimited("walletWrite", ALICE, now), true);
assert.equal(await rateLimited("walletWrite", BOB, now), false, "Limits are per user");
assert.equal(await rateLimited("walletWrite", ALICE, now + 60_000), false, "A new window resets the count");

console.log(
  "PASS: ruleset recorded per match, legacy ruleset replay, retired rulesets, unjoined-forfeit cancellation (demo and devnet), no joining forfeited matches, settlement of unsettled matches only, no player-ID leaks, per-match net P&L, rate limits.",
);
sqlite.close();
