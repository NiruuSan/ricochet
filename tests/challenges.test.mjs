import assert from "node:assert/strict";
import { createDatabase } from "./helpers/test-env.mjs";

// Private matches: a challenge nobody can be matched into, only taken from its
// link, and only by the player it names when it names one.
const { sqlite, close } = await createDatabase();
globalThis.fetch = async () => {
  throw new Error("Matchmaking must not touch the network");
};

const matches = await import("../lib/matches.ts");

const ANN = "chal-ann-private";
const BEN = "chal-ben-private";
const CAT = "chal-cat-private";
for (const [id, name] of [
  [ANN, "ann"],
  [BEN, "ben"],
  [CAT, "cat"],
]) {
  sqlite.prepare("INSERT INTO players(id, name, created) VALUES(?, ?, 0)").run(id, name);
}
const gems = (uid) => sqlite.prepare("SELECT balance FROM players WHERE id = ?").get(uid).balance;
const matchRow = (id) => sqlite.prepare("SELECT * FROM matches WHERE id = ?").get(id);
const done = () => sqlite.prepare("UPDATE runs SET done = 1").run();
const STAKE = 100;

try {
  // Ann challenges Ben by name: the match is private and Ben is told.
  const ann = await matches.createChallenge(ANN, STAKE, "gems", "ben");
  assert.match(ann.invite, /^[a-z0-9]{9}$/);
  assert.equal(gems(ANN), 2000 - STAKE, "The challenger pays their entry like any match");
  const row = matchRow(ann.match_id);
  assert.deepEqual([row.invite, row.invited, row.p2], [ann.invite, BEN, null]);
  const notice = JSON.parse(sqlite.prepare("SELECT data FROM notifications WHERE user_id = ? ORDER BY created DESC LIMIT 1").get(BEN).data);
  assert.deepEqual([notice.from, notice.invite, notice.stake], ["ann", ann.invite, STAKE]);

  // Nobody is matched into it, whatever the entry.
  done();
  const cat = await matches.startMatch(CAT, STAKE, "gems");
  assert.notEqual(cat.match_id, ann.match_id, "Public matchmaking never hands out a challenge");

  // Only the player it names can take the seat.
  done();
  await assert.rejects(() => matches.joinChallenge(CAT, ann.invite), (e) => e.status === 403 && /another player/.test(e.message));
  await assert.rejects(() => matches.joinChallenge(ANN, ann.invite), (e) => e.status === 409 && /your own challenge/.test(e.message));
  await assert.rejects(() => matches.joinChallenge(BEN, "nosuchcode"), (e) => e.status === 404);

  const ben = await matches.joinChallenge(BEN, ann.invite);
  assert.equal(ben.match_id, ann.match_id);
  assert.deepEqual(ben.state, ann.state, "Both sides play the same board");
  assert.equal(gems(BEN), 2000 - STAKE);
  assert.equal(matchRow(ann.match_id).p2, BEN);

  // The seat is taken once.
  done();
  await assert.rejects(() => matches.joinChallenge(CAT, ann.invite), (e) => e.status === 409);

  // An open challenge with no name: whoever holds the link takes it.
  done();
  const open = await matches.createChallenge(ANN, STAKE, "gems");
  assert.equal(matchRow(open.match_id).invited, null);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM notifications WHERE kind = 'challenge'").get().n, 1, "An open challenge notifies nobody");
  done();
  const taken = await matches.joinChallenge(CAT, open.invite.toUpperCase());
  assert.equal(taken.match_id, open.match_id, "The code is not case sensitive");

  // A challenge to a name nobody has, and to yourself.
  done();
  await assert.rejects(() => matches.createChallenge(ANN, STAKE, "gems", "nobody"), (e) => e.status === 404);
  await assert.rejects(() => matches.createChallenge(ANN, STAKE, "gems", "ann"), /cannot challenge yourself/);

  // The run carries its own link back to its player, and never to anyone else.
  done();
  const mine = await matches.createChallenge(ANN, STAKE, "gems");
  const snapshot = await matches.playerSnapshot(ANN, "gems");
  assert.equal(snapshot.active.invite, mine.invite, "The player can copy the link again from their run");
  const theirs = await matches.playerSnapshot(BEN, "gems");
  assert.ok(!JSON.stringify(theirs).includes(mine.invite), "A challenge code never reaches another player's snapshot");

  console.log("PASS: private challenges (entry paid on creation, hidden from matchmaking, named player only, notice sent, joined once from the link, case-insensitive codes, validation, code only in its own run).");
} finally {
  close();
}
