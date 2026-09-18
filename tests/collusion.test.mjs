import assert from "node:assert/strict";
import { createDatabase } from "./helpers/test-env.mjs";

// Two accounts in the same hands: no shot looks wrong, but the pair's history
// does. These rules only decide what an administrator is shown.
const { sqlite, close } = await createDatabase();
const { COLLUSION, collusionPairs } = await import("../lib/collusion.ts");

const now = Date.now();
const SOL = 1_000_000_000;
const ids = { mule: "col-mule", farmer: "col-farmer", ann: "col-ann", ben: "col-ben", cat: "col-cat" };
for (const [key, id] of Object.entries(ids)) sqlite.prepare("INSERT INTO players(id, name, created) VALUES(?, ?, 0)").run(id, key);

let n = 0;
/** A settled devnet match between two players, won by `winner`. */
const duel = (a, b, winner, at = now - 86_400_000) => {
  const id = `col-m-${n++}`;
  sqlite
    .prepare("INSERT INTO matches(id, seed, stake, asset, p1, p2, settled, winner, fee, created, ruleset) VALUES(?, 1, ?, 'devnet', ?, ?, 1, ?, ?, ?, 5)")
    .run(id, SOL, a, b, winner, Math.round(SOL * 0.12), at);
  return id;
};
const pairOf = (list, x, y) => list.find((p) => p.players.map((s) => s.name).sort().join() === [x, y].sort().join());

try {
  // The pair everyone should look at: they only play each other and one always wins.
  for (let i = 0; i < 6; i++) duel(ids.mule, ids.farmer, ids.farmer);
  // An honest pair: they meet as often, but split the wins and play others too.
  for (let i = 0; i < 6; i++) duel(ids.ann, ids.ben, i % 2 ? ids.ann : ids.ben);
  for (let i = 0; i < 10; i++) duel(i % 2 ? ids.ann : ids.ben, ids.cat, ids.cat);

  const flagged = await collusionPairs(now);
  const arranged = pairOf(flagged, "mule", "farmer");
  assert.ok(arranged, "A one-sided pair that only plays itself is listed");
  assert.equal(arranged.matches, 6);
  assert.deepEqual(arranged.reasons.sort(), ["mostly_each_other", "one_sided"]);
  assert.equal(Math.abs(arranged.net), 6 * (SOL - Math.round(SOL * 0.12)), "The money moved is what the winner actually took");
  const winner = arranged.net >= 0 ? arranged.players[0] : arranged.players[1];
  assert.equal(winner.name, "farmer", "The money moves towards the winner");
  assert.equal(winner.wins, 6);
  assert.equal(Math.round(winner.share * 100), 100, "Every one of their matches is against the same player");
  assert.ok(!pairOf(flagged, "ann", "ben"), "An even pair who also play others is not listed");

  // Below the minimum, a streak is not evidence.
  for (let i = 0; i < COLLUSION.minMatches - 1; i++) duel(ids.cat, ids.mule, ids.cat);
  assert.ok(!pairOf(await collusionPairs(now), "cat", "mule"), "A short streak is left alone");

  // Tips between a listed pair are shown as extra evidence, and old history drops out.
  sqlite.prepare("INSERT INTO cash_accounts(id, network, user_id, balance, created) VALUES('devnet:' || ?, 'devnet', ?, 0, 0)").run(ids.farmer, ids.farmer);
  sqlite.prepare("INSERT INTO cash_accounts(id, network, user_id, balance, created) VALUES('devnet:' || ?, 'devnet', ?, 0, 0)").run(ids.mule, ids.mule);
  sqlite.prepare("INSERT INTO cash_ledger VALUES('t0:fund', 'devnet:' || ?, 'fixture', ?, 'fixture', 0)").run(ids.farmer, SOL);
  sqlite.prepare("INSERT INTO cash_ledger VALUES('t1:sent', 'devnet:' || ?, 'tip_sent', ?, 'tip-1', ?)").run(ids.farmer, -SOL / 2, now - 3600_000);
  sqlite.prepare("INSERT INTO cash_ledger VALUES('t1:received', 'devnet:' || ?, 'tip_received', ?, 'tip-1', ?)").run(ids.mule, SOL / 2, now - 3600_000);
  const withTips = pairOf(await collusionPairs(now), "mule", "farmer");
  assert.deepEqual([withTips.tips, withTips.tipped], [1, SOL / 2]);
  assert.ok(withTips.reasons.includes("tips_between"));
  assert.equal(pairOf(await collusionPairs(now + COLLUSION.windowMs + 86_400_000), "mule", "farmer"), undefined, "Only the recent window counts");

  console.log("PASS: collusion (one-sided pairs that mostly meet each other are listed with the money moved and any tips, even pairs and short streaks are not, recent window only).");
} finally {
  close();
}
