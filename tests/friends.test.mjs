import assert from "node:assert/strict";
import { createDatabase } from "./helpers/test-env.mjs";

// Friends: who may be added, who may write, and the friendly game that costs
// nothing. The rule underneath all of it is that a pair is one row, so the same
// two players can never hold two links in opposite directions.
const { sqlite, close } = await createDatabase();
globalThis.fetch = async () => {
  throw new Error("No network in this test");
};

const friends = await import("../lib/friends.ts");
const { MESSAGE_MAX } = await import("../lib/api-types.ts");
const { createPlayer } = await import("../lib/profile.ts");
const matches = await import("../lib/matches.ts");
const { listNotifications } = await import("../lib/notifications.ts");

const ANA = "github:ana";
const BEN = "github:ben";
const CAT = "github:cat";
const NOW = Date.UTC(2026, 8, 21, 18);
const count = (sql, ...args) => sqlite.prepare(sql).get(...args).n;
const gems = (uid) => sqlite.prepare("SELECT balance FROM players WHERE id = ?").get(uid).balance;
const done = () => sqlite.prepare("UPDATE runs SET done = 1").run();

try {
  for (const [uid, name] of [[ANA, "Ana"], [BEN, "Ben"], [CAT, "Cat"]]) await createPlayer(uid, name);

  // 1. Asking, and what asking cannot do.
  await assert.rejects(() => friends.requestFriend(ANA, "Ana"), /That is you/);
  await assert.rejects(() => friends.requestFriend(ANA, "Nobody"), (e) => e.status === 404);
  await assert.rejects(() => friends.requestFriend(ANA, "!!"), (e) => e.status === 404);
  assert.deepEqual(await friends.requestFriend(ANA, "Ben", NOW), { name: "Ben", status: "pending" });
  await assert.rejects(() => friends.requestFriend(ANA, "ben", NOW), /has not answered yet/);
  assert.equal(count("SELECT COUNT(*) AS n FROM friend_links"), 1, "One row for a pair, whoever asked");
  const asked = await listNotifications(BEN);
  assert.deepEqual([asked.items[0].kind, asked.items[0].data.name], ["friend_request", "Ana"]);

  // Ben sees it waiting; Ana sees it sent.
  const waiting = await friends.friendList(BEN);
  assert.deepEqual([waiting.incoming.map((f) => f.name), waiting.friends.length], [["Ana"], 0]);
  assert.deepEqual((await friends.friendList(ANA)).outgoing.map((f) => f.name), ["Ana"].map(() => "Ben"));
  assert.deepEqual(await friends.friendAlerts(BEN), { requests: 1, unread: 0 });

  // 2. Only the other side can answer, and asking back is accepting.
  await assert.rejects(() => friends.answerFriend(ANA, "Ben", true), /They have to answer it/);
  assert.deepEqual(await friends.requestFriend(BEN, "Ana", NOW), { name: "Ana", status: "accepted" }, "Asking back accepts");
  assert.deepEqual((await friends.friendList(ANA)).friends.map((f) => f.name), ["Ben"]);
  assert.deepEqual(await friends.friendAlerts(BEN), { requests: 0, unread: 0 });
  await assert.rejects(() => friends.requestFriend(ANA, "Ben"), /already friends/);

  // 3. Only friends may write.
  await assert.rejects(() => friends.sendMessage(ANA, "Cat", "hello"), /only message friends/);
  await assert.rejects(() => friends.sendMessage(ANA, "Ben", "   "), /Write something first/);
  await friends.sendMessage(ANA, "Ben", "  good game  ", NOW);
  await friends.sendMessage(BEN, "Ana", "rematch?", NOW + 1000);
  assert.equal(sqlite.prepare("SELECT body FROM messages ORDER BY created").get().body, "good game", "Whitespace is trimmed");
  assert.equal((await friends.friendAlerts(ANA)).unread, 1, "Ana has one waiting");
  assert.equal((await friends.friendList(ANA)).friends[0].unread, 1);

  // Reading a conversation marks what was sent to you, and nothing else.
  const thread = await friends.conversation(ANA, "Ben", NOW + 2000);
  assert.deepEqual(thread.map((m) => [m.mine, m.body]), [[true, "good game"], [false, "rematch?"]]);
  assert.equal((await friends.friendAlerts(ANA)).unread, 0);
  assert.equal((await friends.friendAlerts(BEN)).unread, 1, "Ana's own message still waits for Ben");
  await assert.rejects(() => friends.conversation(ANA, "Cat"), /only read a conversation with a friend/);
  const long = "x".repeat(700);
  await friends.sendMessage(ANA, "Ben", long, NOW + 3000);
  assert.equal(sqlite.prepare("SELECT length(body) AS n FROM messages ORDER BY created DESC").get().n, MESSAGE_MAX, "A message is capped, not refused");

  // 4. A friendly game: a private match with no entry at all.
  const before = gems(ANA);
  const friendly = await matches.createChallenge(ANA, 0, "gems", "Ben");
  assert.equal(gems(ANA), before, "A friendly costs nothing");
  assert.equal(count("SELECT COUNT(*) AS n FROM ledger WHERE match_id = ?", friendly.match_id), 0, "And writes no ledger line");
  done();
  const joined = await matches.joinChallenge(BEN, friendly.invite);
  assert.equal(joined.match_id, friendly.match_id);
  assert.equal(gems(BEN), 2000);
  sqlite.prepare("UPDATE runs SET done = 1, score = CASE WHEN user_id = ? THEN 900 ELSE 400 END WHERE match_id = ?").run(ANA, friendly.match_id);
  await matches.settle(friendly.match_id);
  const settled = sqlite.prepare("SELECT winner, fee, settled FROM matches WHERE id = ?").get(friendly.match_id);
  assert.deepEqual([settled.settled, settled.winner, settled.fee], [1, ANA, 0], "It still has a winner");
  assert.equal(count("SELECT COUNT(*) AS n FROM ledger WHERE match_id = ?", friendly.match_id), 0, "And still pays nothing");
  assert.deepEqual([gems(ANA), gems(BEN)], [before, 2000], "Both balances are where they started");
  // Matchmaking never hands out a free seat.
  await assert.rejects(() => matches.startMatch(CAT, 0, "gems"), /five entry amounts/);

  // 5. Removing a friend takes the conversation with it.
  await assert.rejects(() => friends.removeFriend(ANA, "Cat"), /not friends with this player/);
  assert.deepEqual(await friends.removeFriend(ANA, "Ben"), { name: "Ben" });
  assert.equal(count("SELECT COUNT(*) AS n FROM friend_links"), 0);
  assert.equal(count("SELECT COUNT(*) AS n FROM messages"), 0, "Nothing of it is left to read");
  await assert.rejects(() => friends.sendMessage(BEN, "Ana", "still there?"), /only message friends/);

  // 6. A refusal leaves no trace, and can be asked again.
  await friends.requestFriend(CAT, "Ana", NOW + 4000);
  assert.deepEqual(await friends.answerFriend(ANA, "Cat", false), { name: "Cat", status: "declined" });
  assert.equal(count("SELECT COUNT(*) AS n FROM friend_links"), 0);
  assert.deepEqual(await friends.requestFriend(CAT, "Ana", NOW + 5000), { name: "Ana", status: "pending" });

  // 7. Blocking: it ends what was there, and stops everything after it.
  const moderation = await import("../lib/moderation.ts");
  await friends.requestFriend(ANA, "Ben", NOW + 6000);
  await friends.answerFriend(BEN, "Ana", true, NOW + 6100);
  await friends.sendMessage(ANA, "Ben", "one more?", NOW + 6200);
  assert.deepEqual(await moderation.blockPlayer(BEN, "Ana", NOW + 7000), { name: "Ana" });
  assert.equal(count("SELECT COUNT(*) AS n FROM friend_links"), 1, "Only Cat's pending request is left");
  assert.equal(count("SELECT COUNT(*) AS n FROM messages"), 0, "The conversation goes with the block");
  for (const call of [
    () => friends.sendMessage(ANA, "Ben", "hello?"),
    () => friends.sendMessage(BEN, "Ana", "hello?"),
    () => friends.requestFriend(ANA, "Ben"),
    () => friends.requestFriend(BEN, "Ana"),
    () => matches.createChallenge(ANA, 0, "gems", "Ben"),
  ]) {
    await assert.rejects(call, /cannot reach this player/, "Neither side gets through, whoever blocked whom");
  }
  // A seat cannot be taken either, whichever side opened it.
  done();
  const open = await matches.createChallenge(BEN, 0, "gems");
  done();
  await assert.rejects(() => matches.joinChallenge(ANA, open.invite), /cannot reach this player/);
  assert.deepEqual((await friends.friendList(BEN)).blocked.map((b) => b.name), ["Ana"]);
  assert.deepEqual((await friends.friendList(ANA)).blocked, [], "A block is only listed by whoever made it");

  await assert.rejects(() => moderation.unblockPlayer(ANA, "Ben"), /have not blocked this player/);
  assert.deepEqual(await moderation.unblockPlayer(BEN, "Ana"), { name: "Ana" });
  assert.deepEqual(await friends.requestFriend(ANA, "Ben", NOW + 8000), { name: "Ben", status: "pending" }, "Unblocking opens the door, not the friendship");

  // 8. Reporting: it goes to the house, once per open case, and says something.
  await assert.rejects(() => moderation.reportPlayer(ANA, "Ana", "spam", "myself"), /That is you/);
  await assert.rejects(() => moderation.reportPlayer(ANA, "Ben", "nonsense", "a real detail here"), /what this report is about/);
  await assert.rejects(() => moderation.reportPlayer(ANA, "Ben", "spam", "short"), /Say what happened/);
  assert.deepEqual(await moderation.reportPlayer(ANA, "Ben", "harassment", "Kept messaging after I said stop.", NOW + 9000), { name: "Ben", kind: "harassment" });
  await assert.rejects(() => moderation.reportPlayer(ANA, "Ben", "spam", "Something else entirely."), /already with us/);
  const queue = await moderation.adminReports();
  assert.deepEqual([queue.length, queue[0].reporter, queue[0].target, queue[0].kind, queue[0].status, queue[0].against], [1, "Ana", "Ben", "harassment", "open", 1]);
  assert.ok(!JSON.stringify(queue).includes(BEN), "The queue carries names, not player IDs");

  await assert.rejects(() => moderation.resolveReport("admin", "nope", "gone"), /No such report/);
  await assert.rejects(() => moderation.resolveReport("admin", queue[0].id, ""), /note explaining/);
  await moderation.resolveReport("admin", queue[0].id, "Warned them; nothing further for now.", NOW + 10_000);
  await assert.rejects(() => moderation.resolveReport("admin", queue[0].id, "again"), /already been reviewed/);
  const closed = (await moderation.adminReports())[0];
  assert.deepEqual([closed.status, closed.note], ["reviewed", "Warned them; nothing further for now."]);
  assert.equal(count("SELECT COUNT(*) AS n FROM admin_audit WHERE action = 'report_reviewed'"), 1);
  // With the case closed, the same player can be reported again.
  assert.deepEqual(await moderation.reportPlayer(ANA, "Ben", "cheating", "It happened again in our last match.", NOW + 11_000), { name: "Ben", kind: "cheating" });

  console.log(
    "PASS: friends (one row per pair, no self or unknown, asking back accepts, notices sent, only friends message, trimmed and capped bodies, unread counts and read marking, friendly matches that cost and pay nothing, never from matchmaking, removal takes the conversation, a refusal leaves no trace); blocking (ends the friendship and the conversation, stops messages, requests, challenges and seats both ways, listed only by its owner, undone without restoring anything); reporting (validated, one open case per pair, names only, closed once with a note and an audit row).",
  );
} finally {
  close();
}
