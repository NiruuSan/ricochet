import assert from "node:assert/strict";
import { createDatabase } from "./helpers/test-env.mjs";

// The free gems of the day: one claim per UTC day, worth more every day in a row.
const { sqlite, close } = await createDatabase();
const { DAILY, claimDailyGems, dailyGems, dayOf, gemsFor } = await import("../lib/daily.ts");
const matches = await import("../lib/matches.ts");

const ANN = "daily-ann-private";
const BEN = "daily-ben-private";
for (const [id, name] of [
  [ANN, "ann"],
  [BEN, "ben"],
]) {
  sqlite.prepare("INSERT INTO players(id, name, created) VALUES(?, ?, 0)").run(id, name);
}
const gems = (uid) => sqlite.prepare("SELECT balance FROM players WHERE id = ?").get(uid).balance;
const DAY = 86_400_000;
const day0 = dayOf(Date.now()) * DAY + 9 * 3_600_000;

try {
  // The ladder: the first day pays the base, each day in a row adds a step, and it stops at the cap.
  assert.equal(gemsFor(1), DAILY.base);
  assert.equal(gemsFor(2), DAILY.base + DAILY.step);
  assert.equal(gemsFor(99), DAILY.cap);
  assert.ok(DAILY.cap > DAILY.base);

  // First claim.
  const before = gems(ANN);
  let state = await dailyGems(ANN, day0);
  assert.deepEqual([state.ready, state.streak, state.amount], [true, 1, DAILY.base]);
  state = await claimDailyGems(ANN, day0);
  assert.deepEqual([state.ready, state.streak], [false, 1]);
  assert.equal(gems(ANN), before + DAILY.base);

  // Twice in a day pays once, whatever the hour.
  await assert.rejects(() => claimDailyGems(ANN, day0 + 6 * 3_600_000), (e) => e.status === 409 && /already claimed/.test(e.message));
  assert.equal(gems(ANN), before + DAILY.base);
  assert.equal((await dailyGems(ANN, day0 + 6 * 3_600_000)).ready, false);

  // The next day carries the streak; the gems grow with it.
  const second = await claimDailyGems(ANN, day0 + DAY);
  assert.deepEqual([second.streak, second.amount], [2, gemsFor(2)]);
  assert.equal(gems(ANN), before + DAILY.base + gemsFor(2));

  // A missed day starts the streak again.
  const afterGap = await claimDailyGems(ANN, day0 + 3 * DAY);
  assert.deepEqual([afterGap.streak, afterGap.amount], [1, DAILY.base]);

  // The claim is the lock: two calls at the same moment pay one.
  const both = await Promise.allSettled([claimDailyGems(BEN, day0), claimDailyGems(BEN, day0)]);
  assert.equal(both.filter((r) => r.status === "fulfilled").length, 1, "One of the two claims wins");
  assert.equal(gems(BEN), 2000 + DAILY.base);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM ledger WHERE user_id = ? AND kind = 'daily_gems'").get(BEN).n, 1);

  // A suspended player claims nothing.
  sqlite
    .prepare("INSERT INTO player_suspensions(user_id, status, source, reason, evidence, created) VALUES(?, 'suspended', 'stats', 'review', '{}', 0)")
    .run(BEN);
  assert.equal((await dailyGems(BEN, day0 + DAY)).ready, false);
  await assert.rejects(() => claimDailyGems(BEN, day0 + DAY), (e) => e.status === 403);

  // The snapshot carries the day's state to the lobby.
  const snapshot = await matches.playerSnapshot(ANN, "gems");
  assert.equal(typeof snapshot.daily.nextAt, "number");
  assert.equal(snapshot.daily.ready, false, "Ann has already claimed today in this test's clock");

  console.log("PASS: daily gems (ladder and cap, one claim per UTC day, streaks that grow and reset, race-safe claim, suspended accounts excluded, snapshot state).");
} finally {
  close();
}
