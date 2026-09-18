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

// Ruleset 3 and earlier: forfeiting an unjoined match cancels it. Nobody can
// take the seat, and the creator gets the full gem entry back, exactly once.
sqlite.prepare("UPDATE matches SET ruleset = 3 WHERE id = ?").run(aliceRun.match_id);
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
// Ruleset 6: the server adds the row from the match's secret key; the browser's
// copy of the shot is identical except for that row, and the key never leaves the server.
const { secretRows } = await import("../lib/secret-rows.ts");
const rowKey = matchRow(bobRun.match_id).row_key;
assert.match(rowKey, /^[0-9a-f]{64}$/);
assert.deepEqual(shot.state, engine.simulate(bobBoard, 73, engine.RULESET, secretRows(rowKey)));
const browserView = engine.simulate(bobBoard, 73, engine.RULESET);
assert.deepEqual(browserView.bricks, shot.state.bricks.filter((b) => b.row !== 7));
assert.deepEqual(bobRun.state.bricks.map((b) => b.col), secretRows(rowKey)(1), "The first row comes from the key too");
for (const value of [bobRun, carolRun, shot, await matches.playerSnapshot(BOB, "gems")]) assert.ok(!JSON.stringify(value).includes(rowKey), "The row key is never returned");
assert.ok(shot.state.score > 0);
await assert.rejects(() => matches.playShot(BOB, bobRun.id, bobRun.revision, "shot", 73), (e) => e instanceof matches.GameError && e.status === 409);
await assert.rejects(() => matches.playShot(BOB, bobRun.id, shot.revision, "shot", 3), /Invalid aim angle/);
assert.equal(sqlite.prepare("SELECT finished FROM runs WHERE id = ?").get(bobRun.id).finished, null, "A run in progress has no finish time");
await matches.playShot(BOB, bobRun.id, shot.revision, "forfeit");
assert.ok(sqlite.prepare("SELECT finished FROM runs WHERE id = ?").get(bobRun.id).finished > 0, "The last shot records when the run finished");
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
const bobLeaders = await matches.leaderboard(BOB, "gems");
assert.equal(bobLeaders.find((l) => l.name === "bob").is_you, 1);
assert.equal(bobLeaders.find((l) => l.name === "bob").pnl, WIN_NET);
assert.equal(bobLeaders.find((l) => l.name === "carol").is_you, 0);
assert.equal("leaders" in snapshot, false, "The leaderboard is served separately, not in every snapshot");
const aliceSnapshot = await matches.playerSnapshot(ALICE, "gems");
assert.deepEqual(
  aliceSnapshot.matches.map((x) => [x.result, x.net, x.joined]),
  [["cancelled", 0, 0]],
);
assert.equal((await matches.leaderboard(ALICE, "gems")).find((l) => l.name === "alice").pnl, 0);
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
sqlite.prepare("UPDATE matches SET ruleset = 3 WHERE id = ?").run(devnetRun.match_id);
assert.equal(cashBalance(CAROL), 0);
assert.equal(cashBalance("escrow:" + devnetRun.match_id), 1_000_000_000);
await matches.playShot(CAROL, devnetRun.id, devnetRun.revision, "forfeit");
assert.equal(cashBalance(CAROL), 880_000_000);
assert.equal(cashBalance(service.HOUSE), 120_000_000);
assert.equal(cashBalance("escrow:" + devnetRun.match_id), 0);
const devnetLeaders = await matches.leaderboard(CAROL, "devnet");
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

// Ruleset 4: a forfeit only ends that run. The entry stays in the pot, the seat
// stays open, and whoever joins wins by beating the forfeited score.
{
  sqlite.prepare("UPDATE runs SET done = 1").run();
  const stake = 1000;
  const before = gemBalance(BOB);
  const bobOpen = await matches.startMatch(BOB, stake, "gems");
  assert.equal(bobOpen.ruleset, engine.RULESET);
  assert.ok(bobOpen.ruleset >= 4, "New matches settle on score alone");
  sqlite.prepare("UPDATE runs SET score = 7, state = json_set(state, '$.score', 7) WHERE id = ?").run(bobOpen.id);
  const quit = await matches.playShot(BOB, bobOpen.id, bobOpen.revision, "forfeit");
  assert.deepEqual([quit.done, quit.forfeit, quit.score], [1, 1, 7]);
  await matches.settle(bobOpen.match_id);
  assert.deepEqual([matchRow(bobOpen.match_id).settled, matchRow(bobOpen.match_id).cancelled], [0, 0], "An unjoined forfeit is not cancelled");
  assert.equal(gemBalance(BOB), before - stake, "The forfeited entry is not refunded");
  assert.equal((await matches.matchRecap(BOB, bobOpen.match_id)).status, "waiting");
  // Carol takes the seat and beats Bob's 7.
  const carolJoin = await matches.startMatch(CAROL, stake, "gems");
  assert.equal(carolJoin.match_id, bobOpen.match_id, "A forfeited ruleset 4 match can be joined");
  sqlite.prepare("UPDATE runs SET score = 8, state = json_set(state, '$.score', 8) WHERE id = ?").run(carolJoin.id);
  await matches.playShot(CAROL, carolJoin.id, carolJoin.revision, "forfeit");
  let settledMatch = matchRow(bobOpen.match_id);
  assert.deepEqual([settledMatch.settled, settledMatch.winner], [1, CAROL]);
  assert.equal(gemBalance(BOB), before - stake);
  // A joiner who scores less loses their entry to the forfeiter.
  const bobAgain = await matches.startMatch(BOB, stake, "gems");
  sqlite.prepare("UPDATE runs SET score = 5, state = json_set(state, '$.score', 5) WHERE id = ?").run(bobAgain.id);
  await matches.playShot(BOB, bobAgain.id, bobAgain.revision, "forfeit");
  const danBalance = gemBalance(DAN);
  const danJoin = await matches.startMatch(DAN, stake, "gems");
  assert.equal(danJoin.match_id, bobAgain.match_id);
  sqlite.prepare("UPDATE runs SET score = 4, state = json_set(state, '$.score', 4) WHERE id = ?").run(danJoin.id);
  await matches.playShot(DAN, danJoin.id, danJoin.revision, "forfeit");
  settledMatch = matchRow(bobAgain.match_id);
  assert.deepEqual([settledMatch.winner, gemBalance(DAN), gemBalance(BOB)], [BOB, danBalance - stake, before - stake + stake]);
  const bobRecap = await matches.matchRecap(BOB, bobAgain.match_id);
  assert.deepEqual([bobRecap.result, bobRecap.net, bobRecap.you.forfeit, bobRecap.opponent.stats.score], ["win", stake, true, 4]);
}

// End-of-run recap, cleared boards and result notifications.
{
  const notifications = await import("../lib/notifications.ts");
  sqlite.prepare("UPDATE runs SET done = 1").run();
  const recapStake = 500; // No open match waits at this entry, so Alice opens one.
  const aliceStart = await matches.startMatch(ALICE, recapStake, "gems");
  let recap = await matches.matchRecap(ALICE, aliceStart.match_id);
  assert.deepEqual([recap.status, recap.result, recap.net, recap.opponent, recap.stake], ["playing", null, null, null, recapStake]);
  await assert.rejects(() => matches.matchRecap(BOB, aliceStart.match_id), (e) => e.status === 404);
  // One brick straight above the launch point: the shot clears the board.
  const lone = { ...aliceStart.state, x: engine.W / 2, bricks: [{ col: 3, row: 7, hp: 1 }] };
  sqlite.prepare("UPDATE runs SET state = ? WHERE id = ?").run(JSON.stringify(lone), aliceStart.id);
  const cleared = await matches.playShot(ALICE, aliceStart.id, 0, "shot", 90);
  assert.equal(cleared.state.bonus, true);
  assert.equal(cleared.clears, 1);
  assert.equal(sqlite.prepare("SELECT clears FROM runs WHERE id = ?").get(aliceStart.id).clears, 1);
  const danRun = await matches.startMatch(DAN, recapStake, "gems");
  assert.equal(danRun.match_id, aliceStart.match_id);
  await matches.playShot(ALICE, aliceStart.id, cleared.revision, "forfeit");
  recap = await matches.matchRecap(ALICE, aliceStart.match_id);
  assert.equal(recap.status, "opponent_playing");
  assert.equal(recap.opponent.name, "dan");
  assert.deepEqual(recap.you.level, await (await import("../lib/experience.ts")).playerLevel(ALICE));
  assert.deepEqual(recap.opponent.level, await (await import("../lib/experience.ts")).playerLevel(DAN));
  assert.equal(recap.opponent.stats, null, "The opponent's score stays hidden until they finish");
  assert.deepEqual([recap.you.score, recap.you.clears, recap.you.forfeit, recap.you.balls], [cleared.state.score, 1, true, cleared.state.balls]);
  const danView = await matches.matchRecap(DAN, aliceStart.match_id);
  assert.equal(danView.opponent.stats, null, "A finished player's board is not shown to an opponent still playing");
  assert.equal((await notifications.listNotifications(ALICE)).items.length, 0);

  await matches.playShot(DAN, danRun.id, danRun.revision, "forfeit");
  recap = await matches.matchRecap(ALICE, aliceStart.match_id);
  assert.deepEqual([recap.status, recap.result, recap.net], ["settled", "win", recapStake]);
  assert.equal(recap.bonusGems, 0, "Gem matches earn no gem bonus");
  assert.deepEqual([recap.opponent.stats.score, recap.opponent.stats.forfeit], [0, true]);
  await matches.settle(aliceStart.match_id);
  const aliceInbox = await notifications.listNotifications(ALICE);
  const danInbox = await notifications.listNotifications(DAN);
  assert.equal(aliceInbox.unread, 1, "Settling twice notifies once");
  assert.deepEqual(
    [aliceInbox.items[0].kind, aliceInbox.items[0].data.result, aliceInbox.items[0].data.net, aliceInbox.items[0].data.opponent, aliceInbox.items[0].read],
    ["match_result", "win", recapStake, "dan", false],
  );
  assert.deepEqual([danInbox.items[0].data.result, danInbox.items[0].data.net, danInbox.items[0].data.opponent], ["loss", -recapStake, "Alice_2"]);
  const aliceSnap = await matches.playerSnapshot(ALICE, "gems");
  assert.equal(aliceSnap.unreadNotifications, 1);
  for (const id of [ALICE, BOB, CAROL, DAN]) assert.ok(!JSON.stringify(aliceSnap.notifications).includes(id), "Notifications carry no player IDs");
  await notifications.markNotificationsRead(ALICE, { matchId: aliceStart.match_id });
  assert.equal((await notifications.listNotifications(ALICE)).unread, 0);
  assert.equal((await notifications.listNotifications(DAN)).unread, danInbox.unread, "Reading your result leaves the opponent's unread");
  await notifications.markNotificationsRead(DAN, { ids: [danInbox.items[0].id, aliceInbox.items[0].id] });
  assert.equal((await notifications.listNotifications(DAN)).unread, danInbox.unread - 1, "Only the player's own notifications are marked");

  // A finished run nobody has joined waits for a challenger; it does not cancel.
  const lonely = await matches.startMatch(CAROL, recapStake, "gems");
  sqlite.prepare("UPDATE runs SET done = 1 WHERE id = ?").run(lonely.id);
  recap = await matches.matchRecap(CAROL, lonely.match_id);
  assert.deepEqual([recap.status, recap.opponent, matchRow(lonely.match_id).settled], ["waiting", null, 0]);
}

// The administrator closes a match in progress: both runs end, both entries go
// back in full with no house fee, and each player is told once.
{
  const admin = await import("../lib/admin-games.ts");
  // An entry with no open seat left over from the fixtures above.
  const stake = 100;
  sqlite.prepare("UPDATE runs SET done = 1").run();
  const openRun = await matches.startMatch(ALICE, stake, "gems");
  const joinRun = await matches.startMatch(BOB, stake, "gems");
  assert.equal(joinRun.match_id, openRun.match_id);
  const staked = [gemBalance(ALICE), gemBalance(BOB)];
  const listed = (await admin.adminGames()).find((g) => g.id === openRun.match_id);
  assert.deepEqual([listed.seatOpen, listed.players.length, listed.refund, listed.stake], [false, 2, stake * 2, stake]);
  assert.deepEqual(listed.players.map((p) => p.name).sort(), ["Alice_2", "bob"]);
  assert.deepEqual(listed.players.map((p) => p.watchId).sort(), [`m-${joinRun.id}`, `m-${openRun.id}`].sort());
  assert.ok(!JSON.stringify(listed).includes(ALICE), "The administrator list carries no player IDs");
  await assert.rejects(() => admin.cancelMatchAsAdmin("admin-user", openRun.match_id, "x"), /short note/);
  await assert.rejects(() => admin.cancelMatchAsAdmin("admin-user", "no-such-match", "Missing"), (e) => e.status === 404);
  const refunded = await admin.cancelMatchAsAdmin("admin-user", openRun.match_id, "Server restart mid-round");
  assert.deepEqual([refunded.refunded, refunded.players], [stake * 2, 2]);
  assert.deepEqual([gemBalance(ALICE), gemBalance(BOB)], [staked[0] + stake, staked[1] + stake]);
  const closed = matchRow(openRun.match_id);
  assert.deepEqual([closed.settled, closed.cancelled, closed.fee, closed.winner], [1, 1, 0, null]);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM runs WHERE match_id = ? AND done = 0").get(openRun.match_id).n, 0, "Both runs end with the match");
  await assert.rejects(() => matches.playShot(ALICE, openRun.id, openRun.revision, "shot", 73), (e) => e.status === 409);
  await assert.rejects(() => admin.cancelMatchAsAdmin("admin-user", openRun.match_id, "Cancelling again"), (e) => e.status === 409);
  assert.deepEqual([gemBalance(ALICE), gemBalance(BOB)], [staked[0] + stake, staked[1] + stake], "A second cancellation refunds nothing");
  const told = JSON.parse(sqlite.prepare("SELECT data FROM notifications WHERE user_id = ? ORDER BY created DESC LIMIT 1").get(BOB).data);
  assert.deepEqual([told.result, told.stake, told.reason, told.opponent], ["cancelled", stake, "Server restart mid-round", "Alice_2"]);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM admin_audit WHERE action = 'match_cancel'").get().n, 2, "One audit row per refunded player");
  assert.ok(!(await admin.adminGames()).some((g) => g.id === openRun.match_id), "A cancelled match leaves the list");
  // The settled match keeps its cancelled result for both players.
  assert.equal((await matches.playerSnapshot(BOB, "gems")).matches.find((x) => x.id === openRun.match_id).result, "cancelled");

  // The same on devnet: the escrow empties back to the players, and the house keeps nothing.
  sqlite.prepare("UPDATE runs SET done = 1").run();
  for (const [uid, id] of [[ALICE, "fund-alice"], [BOB, "fund-bob"]]) {
    await service.ensureCashAccount(uid);
    sqlite.prepare("INSERT INTO cash_ledger VALUES(?, ?, 'fixture', 1000000000, 'fixture', 0)").run(id, service.cashAccountId(uid));
  }
  const solRun = await matches.startMatch(ALICE, 1_000_000_000, "devnet");
  assert.equal((await matches.startMatch(BOB, 1_000_000_000, "devnet")).match_id, solRun.match_id);
  const houseBefore = cashBalance(service.HOUSE);
  assert.equal(cashBalance("escrow:" + solRun.match_id), 2_000_000_000);
  assert.equal((await admin.cancelMatchAsAdmin("admin-user", solRun.match_id, "Network incident")).refunded, 2_000_000_000);
  assert.deepEqual([cashBalance(ALICE), cashBalance(BOB)], [1_000_000_000, 1_000_000_000], "Devnet entries go back in full");
  assert.equal(cashBalance("escrow:" + solRun.match_id), 0);
  assert.equal(cashBalance(service.HOUSE), houseBefore, "A cancellation by the house takes no fee");
}

// Fixed-window rate limiting.
const now = 1_000_000 * 60_000;
for (let i = 0; i < LIMITS.walletWrite; i++) assert.equal(await rateLimited("walletWrite", ALICE, now), false);
assert.equal(await rateLimited("walletWrite", ALICE, now), true);
assert.equal(await rateLimited("walletWrite", BOB, now), false, "Limits are per user");
assert.equal(await rateLimited("walletWrite", ALICE, now + 60_000), false, "A new window resets the count");

console.log(
  "PASS: ruleset recorded per match, legacy ruleset replay, retired rulesets, legacy unjoined-forfeit cancellation (gems and devnet), ruleset 4 forfeits that keep the seat open and settle on score, no joining forfeited matches, settlement of unsettled matches only, administrator cancellation of a match in progress (full refunds, ended runs, notices, audit, idempotent, gems and devnet), no player-ID leaks, per-match net P&L, rate-limited shots, unique names, picture validation and replacement, presence, admin overview, match recaps with hidden opponent stats, cleared boards, result notifications, rate limits.",
);
close();
