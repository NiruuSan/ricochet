import assert from "node:assert/strict";
import { createDatabase } from "./helpers/test-env.mjs";

// Real matchmaking, shot, settlement and snapshot code against a libSQL
// database built from the committed migrations.
Object.assign(process.env, {
  RICOCHET_ADMIN_USER_ID: "admin-user",
  SOLANA_NETWORK: "devnet",
  SOLANA_RPC_URL: "https://rpc.invalid",
  SOLANA_VAULT_KEY: Buffer.alloc(32, 7).toString("base64"),
});
const { sqlite, statements, close } = await createDatabase();
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
const gemBalance = (uid) => sqlite.prepare("SELECT balance FROM players WHERE id = ?").get(uid).balance;
const cashBalance = (uid) => sqlite.prepare("SELECT balance FROM cash_accounts WHERE id = ?").get(service.cashAccountId(uid))?.balance ?? 0;
const matchRow = (id) => sqlite.prepare("SELECT * FROM matches WHERE id = ?").get(id);
const STAKE = 25;
const WIN_NET = STAKE; // The gem winner receives the entire two-entry pot.

// New matches record the current ruleset.
const aliceRun = await matches.startMatch(ALICE, STAKE, "gems");
assert.equal(aliceRun.ruleset, engine.RULESET);
assert.equal(matchRow(aliceRun.match_id).ruleset, engine.RULESET);
assert.equal(gemBalance(ALICE), 2000 - STAKE);
assert.equal("user_id" in aliceRun, false);

// Forfeiting an unjoined match cancels it: nobody can take the seat, and the
// creator gets the full gem entry back, exactly once.
const cancelled = await matches.playShot(ALICE, aliceRun.id, aliceRun.revision, "forfeit");
assert.equal(cancelled.done, 1);
let m = matchRow(aliceRun.match_id);
assert.deepEqual([m.settled, m.cancelled, m.fee, m.winner, m.p2], [1, 1, 0, null, null]);
assert.equal(gemBalance(ALICE), 2000);
await matches.settle(aliceRun.match_id);
assert.equal(gemBalance(ALICE), 2000, "Cancellation refunds once");
const bobRun = await matches.startMatch(BOB, STAKE, "gems");
assert.notEqual(bobRun.match_id, aliceRun.match_id, "A cancelled match cannot be joined");

// Even before settlement runs, a match whose creator forfeited is not joinable.
sqlite.prepare("INSERT INTO matches(id, seed, stake, asset, p1, created, ruleset) VALUES('carol-open', 5, ?, 'gems', ?, 1, 3)").run(50, CAROL);
sqlite.prepare("INSERT INTO runs(id, match_id, user_id, state, done, forfeit, created) VALUES('carol-run', 'carol-open', ?, '{}', 1, 1, 1)").run(CAROL);
sqlite.prepare("INSERT INTO ledger VALUES('carol-run:entry', ?, 'carol-open', 'entry', -50, 1)").run(CAROL);
const danRun = await matches.startMatch(DAN, 50, "gems");
assert.notEqual(danRun.match_id, "carol-open");
assert.equal(matchRow("carol-open").p2, null);

// Normal play: Carol joins Bob's open match and both runs share its seed and ruleset.
const carolRun = await matches.startMatch(CAROL, STAKE, "gems");
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
assert.equal(m.fee, 0, "Gem winners pay no house fee");
assert.equal(gemBalance(BOB), 2000 + STAKE);

// Snapshots settle only unsettled matches and never expose other players' IDs.
statements.length = 0;
const snapshot = await matches.playerSnapshot(BOB, "gems");
assert.equal(statements.filter((s) => s.startsWith("SELECT * FROM matches WHERE id")).length, 0, "Settled matches are not re-settled");
const serialized = JSON.stringify(snapshot);
for (const id of [ALICE, CAROL, DAN, BOB]) assert.ok(!serialized.includes(id), `snapshot leaked ${id}`);
const bobMatch = snapshot.matches.find((x) => x.id === bobRun.match_id);
assert.equal(bobMatch.opponent, "carol");
assert.equal(bobMatch.joined, 1);
assert.equal(bobMatch.result, "win");
assert.equal(bobMatch.net, WIN_NET);
assert.equal(bobMatch.opponent_score, 0);
assert.equal(snapshot.leaders.find((l) => l.name === "bob").is_you, 1);
assert.equal(snapshot.leaders.find((l) => l.name === "bob").pnl, WIN_NET);
assert.equal(snapshot.leaders.find((l) => l.name === "carol").is_you, 0);
const aliceSnapshot = await matches.playerSnapshot(ALICE, "gems");
assert.deepEqual(
  aliceSnapshot.matches.map((x) => [x.result, x.net, x.joined]),
  [["cancelled", 0, 0]],
);
assert.equal(aliceSnapshot.leaders.find((l) => l.name === "alice").pnl, 0);
assert.equal(aliceSnapshot.isAdmin, false);

// Finished-but-unsettled matches are picked up by the player's next snapshot:
// here Bob's match (reset below) and Carol's forfeited open match.
sqlite.prepare("UPDATE matches SET settled = 0, winner = NULL, fee = 0 WHERE id = ?").run(bobRun.match_id);
sqlite.prepare("DELETE FROM ledger WHERE id LIKE ?").run(`${bobRun.match_id}:payout:%`);
statements.length = 0;
await matches.playerSnapshot(CAROL, "gems");
assert.equal(statements.filter((s) => s.startsWith("SELECT * FROM matches WHERE id")).length, 2);
assert.equal(matchRow(bobRun.match_id).settled, 1);
assert.equal(matchRow("carol-open").cancelled, 1);
statements.length = 0;
await matches.playerSnapshot(CAROL, "gems");
assert.equal(statements.filter((s) => s.startsWith("SELECT * FROM matches WHERE id")).length, 0);

// Existing ruleset 2 matches keep playing under ruleset 2; retired rulesets can only be forfeited.
sqlite.prepare("INSERT INTO matches(id, seed, stake, asset, p1, created, ruleset) VALUES('legacy', 99, ?, 'gems', ?, 2, 2)").run(STAKE, DAN);
const legacyState = engine.initial(99);
sqlite.prepare("UPDATE runs SET done = 1 WHERE user_id = ?").run(DAN);
sqlite.prepare("INSERT INTO runs(id, match_id, user_id, state, created) VALUES('legacy-run', 'legacy', ?, ?, 2)").run(DAN, JSON.stringify(legacyState));
const legacyShot = await matches.playShot(DAN, "legacy-run", 0, "shot", 101.5);
assert.equal(legacyShot.ruleset, 2);
assert.deepEqual(legacyShot.state, engine.simulate(legacyState, 101.5, 2));
sqlite.prepare("UPDATE runs SET done = 1 WHERE user_id = ?").run(DAN);
sqlite.prepare("INSERT INTO matches(id, seed, stake, asset, p1, created, ruleset) VALUES('retired', 1, ?, 'gems', ?, 3, 1)").run(STAKE, DAN);
sqlite.prepare("INSERT INTO runs(id, match_id, user_id, state, created) VALUES('retired-run', 'retired', ?, ?, 3)").run(DAN, JSON.stringify(engine.initial(1)));
await assert.rejects(() => matches.playShot(DAN, "retired-run", 0, "shot", 90), /retired ruleset/);
assert.equal((await matches.playShot(DAN, "retired-run", 0, "forfeit")).done, 1);
sqlite.prepare("INSERT INTO matches(id, seed, stake, asset, p1, created, ruleset) VALUES('retired-open', 1, ?, 'gems', ?, 4, 1)").run(STAKE, ALICE);
assert.notEqual((await matches.startMatch(BOB, STAKE, "gems")).match_id, "retired-open", "Unsupported rulesets are not matched");

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

// A rate-limited shot is rejected before anything is written.
sqlite.prepare("UPDATE runs SET done = 1").run();
const limitedRun = await matches.startMatch(ALICE, STAKE, "gems");
await assert.rejects(() => matches.playShot(ALICE, limitedRun.id, limitedRun.revision, "shot", 73, Promise.resolve(false)), (e) => e.status === 429);
assert.equal(sqlite.prepare("SELECT revision FROM runs WHERE id = ?").get(limitedRun.id).revision, 0);

// Profiles: unique names regardless of case, validated pictures served under random keys.
const profile = await import("../lib/profile.ts");
await assert.rejects(() => profile.renamePlayer(ALICE, "BOB"), (e) => e.status === 409 && /taken/.test(e.message));
await assert.rejects(() => profile.renamePlayer(ALICE, "no spaces"), /letters, numbers/);
assert.equal(await profile.renamePlayer(ALICE, "Alice_2"), "Alice_2");
await assert.rejects(() => profile.createPlayer("new-user", "alice_2"), (e) => e.status === 409);
assert.equal(await profile.createPlayer("new-user", "newbie"), true);
assert.equal(await profile.createPlayer("new-user", "newbie"), false, "Signing up twice keeps the first profile");
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]);
await assert.rejects(() => profile.setAvatar(ALICE, "data:image/svg+xml;base64," + Buffer.from("<svg onload=alert(1)>").toString("base64")), /JPEG, PNG or WebP/);
await assert.rejects(() => profile.setAvatar(ALICE, "data:image/png;base64," + Buffer.from("<svg onload=alert(1)>").toString("base64")), /JPEG, PNG or WebP/);
await assert.rejects(() => profile.setAvatar(ALICE, "data:image/png;base64," + Buffer.alloc(120_000).toString("base64")), /too large/);
await assert.rejects(() => profile.setAvatar("nobody", "data:image/png;base64," + png.toString("base64")), (e) => e.status === 403);
const firstKey = await profile.setAvatar(ALICE, "data:image/png;base64," + png.toString("base64"));
const secondKey = await profile.setAvatar(ALICE, "data:image/png;base64," + png.toString("base64"));
assert.equal(await profile.avatarImage(firstKey), null, "Replacing a picture deletes the old one");
assert.equal((await profile.avatarImage(secondKey)).type, "image/png");
assert.equal(await profile.avatarImage("../../etc/passwd"), null);
const withAvatar = await matches.playerSnapshot(ALICE, "gems");
assert.equal(withAvatar.player.avatar, `/api/avatars/${secondKey}`);
assert.equal(withAvatar.player.name, "Alice_2");
assert.ok(!JSON.stringify(await matches.playerSnapshot(BOB, "gems")).includes(ALICE));
await profile.removeAvatar(ALICE);
assert.equal((await matches.playerSnapshot(ALICE, "gems")).player.avatar, null);
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM avatars").get().n, 0);

// Presence and the administrator overview.
const { adminOverview } = await import("../lib/admin.ts");
const t0 = Date.now();
await matches.touchPlayer(ALICE, t0);
await matches.touchPlayer(BOB, t0 - 5 * 60_000);
await matches.touchPlayer(ALICE, t0 + 1000);
assert.equal(sqlite.prepare("SELECT last_seen FROM players WHERE id = ?").get(ALICE).last_seen, t0, "Presence writes are throttled");
const overview = await adminOverview(t0 + 2000);
assert.deepEqual([overview.players.registered, overview.players.online, overview.players.offline], [5, 1, 4]);
assert.deepEqual(overview.players.onlineNames, [{ name: "Alice_2", avatar: null }]);
// Fixture rows dated 1970 fall outside every window.
const gemEntries = sqlite.prepare("SELECT -SUM(amount) AS n FROM ledger WHERE kind = 'entry' AND created > 1000").get().n;
assert.equal(overview.gems.entries.month, gemEntries);
assert.equal(overview.devnet.entries.day, 1_000_000_000);
assert.equal(overview.devnet.fees.week, 120_000_000);
for (const asset of ["gems", "devnet"]) {
  for (const volume of Object.values(overview[asset])) {
    for (const [period, length] of [["day", 24], ["week", 7], ["month", 30]]) {
      assert.equal(volume.series[period].length, length);
      assert.equal(volume.series[period].reduce((sum, point) => sum + point.value, 0), volume[period], "Chart points reconcile to each metric total");
      assert.equal(volume.series[period].at(-1).end, overview.generated);
    }
  }
}

// Include the start of each rolling window and now, excluding old and future rows.
const chartNow = overview.generated;
const DAY = 86_400_000;
const boundaryTimes = [chartNow - 30 * DAY - 1, chartNow - 30 * DAY, chartNow - 7 * DAY - 1,
  chartNow - 7 * DAY, chartNow - DAY - 1, chartNow - DAY, chartNow, chartNow + 1];
for (const [i, created] of boundaryTimes.entries()) {
  sqlite.prepare("INSERT INTO matches(id, seed, stake, p1, created) VALUES(?, 1, 25, ?, ?)").run(`chart-boundary-${i}`, ALICE, created);
}
const chartOverview = await adminOverview(chartNow);
for (const [period, added] of [["day", 2], ["week", 4], ["month", 6]]) {
  const volume = chartOverview.gems.matches;
  assert.equal(volume[period] - overview.gems.matches[period], added, `${period} window boundaries`);
  assert.equal(volume.series[period].reduce((sum, point) => sum + point.value, 0), volume[period]);
  assert.equal(volume.series[period][0].value - overview.gems.matches.series[period][0].value, 1, "Start boundary enters the first bucket");
}
const later = await adminOverview(t0 + 40 * 86_400_000);
assert.deepEqual([later.gems.entries.month, later.devnet.entries.month, later.players.online], [0, 0, 0], "Old activity leaves the rolling windows");
assert.ok(later.gems.matches.series.month.every((point) => point.value === 0), "Empty intervals are zero-filled");
assert.ok(!JSON.stringify(overview).includes("user-"), "The overview carries no player IDs");

// Fixed-window rate limiting.
const now = 1_000_000 * 60_000;
for (let i = 0; i < LIMITS.walletWrite; i++) assert.equal(await rateLimited("walletWrite", ALICE, now), false);
assert.equal(await rateLimited("walletWrite", ALICE, now), true);
assert.equal(await rateLimited("walletWrite", BOB, now), false, "Limits are per user");
assert.equal(await rateLimited("walletWrite", ALICE, now + 60_000), false, "A new window resets the count");

console.log(
  "PASS: ruleset recorded per match, legacy ruleset replay, retired rulesets, unjoined-forfeit cancellation (gems and devnet), no joining forfeited matches, settlement of unsettled matches only, no player-ID leaks, per-match net P&L, rate-limited shots, unique names, picture validation and replacement, presence, admin overview, rate limits.",
);
close();
