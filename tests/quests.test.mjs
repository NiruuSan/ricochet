import assert from "node:assert/strict";
import { createDatabase } from "./helpers/test-env.mjs";

// Quests: what they ask, what counts towards them, and the gems they pay.
//
// The two things holding this up are that nothing is assigned in advance — the
// period decides the quests and the player's own finished runs decide the
// progress — and that only a match somebody else sat down for counts. Practice
// is free and endless, and so is a challenge nobody joined, so either one would
// turn the board into a way of printing gems alone in a room.
const { sqlite, close } = await createDatabase();

const quests = await import("../lib/quests.ts");
const { createPlayer } = await import("../lib/profile.ts");
const { playerSnapshot } = await import("../lib/matches.ts");
const { dayOf } = await import("../lib/daily.ts");
const { weekStart, WEEK } = await import("../lib/weekly-race.ts");

const ANA = "github:ana";
const BEN = "github:ben";
const DAY = 86_400_000;
// Wednesday: far enough into the week that yesterday is inside it too.
const NOW = Date.UTC(2026, 8, 23, 12);
const gems = (uid) => sqlite.prepare("SELECT balance FROM players WHERE id = ?").get(uid).balance;
const count = (sql, ...args) => sqlite.prepare(sql).get(...args).n;

let match = 0;
/**
 * A finished run in a match, with the seat opposite taken unless told otherwise.
 * Everything a quest counts comes from rows exactly like these.
 */
function played(uid, { score = 500, clears = 0, won = false, at = NOW, joined = true, cancelled = 0 } = {}) {
  const id = `m${match++}`;
  sqlite
    .prepare("INSERT INTO matches(id, seed, stake, asset, p1, p2, settled, winner, cancelled, created, ruleset) VALUES(?, 1, 25, 'gems', ?, ?, 1, ?, ?, 0, 6)")
    .run(id, uid, joined ? BEN : null, won ? uid : joined ? BEN : null, cancelled);
  sqlite
    .prepare("INSERT INTO runs(id, match_id, user_id, state, score, clears, done, finished, created) VALUES(?, ?, ?, '{}', ?, ?, 1, ?, 0)")
    .run(id + uid, id, uid, score, clears, at);
  return id;
}

try {
  for (const [uid, name] of [[ANA, "Ana"], [BEN, "Ben"]]) await createPlayer(uid, name);
  const start = gems(ANA);

  // 1. The same board for everybody, a different one tomorrow, and stable.
  const today = quests.questsFor("daily", quests.periodOf("daily", NOW));
  assert.equal(today.length, 3, "Three a day");
  assert.deepEqual(today.map((q) => q.id), quests.questsFor("daily", quests.periodOf("daily", NOW)).map((q) => q.id), "Asking twice draws the same three");
  assert.equal(new Set(today.map((q) => q.id)).size, 3, "And never the same quest twice");
  const drawn = new Set();
  for (let day = 0; day < 40; day++) for (const quest of quests.questsFor("daily", quests.periodOf("daily", NOW + day * DAY))) drawn.add(quest.id);
  assert.ok(drawn.size > 3, "Over a month the board changes");
  assert.notDeepEqual(
    quests.questsFor("daily", quests.periodOf("daily", NOW)).map((q) => q.id),
    quests.questsFor("weekly", quests.periodOf("weekly", NOW)).map((q) => q.id),
    "The week does not simply repeat the day",
  );
  assert.equal(quests.periodOf("daily", NOW), dayOf(NOW));
  assert.equal(quests.periodOf("weekly", NOW), weekStart(NOW));
  assert.equal(quests.periodEnd("weekly", NOW), weekStart(NOW) + WEEK);

  // 2. A fresh player has everything to do and nothing to claim.
  const empty = await quests.questBoard(ANA, NOW);
  assert.deepEqual([empty.daily.length, empty.weekly.length, empty.ready], [3, 3, 0]);
  assert.ok(empty.daily.every((q) => q.progress === 0 && !q.claimed && q.reward > 0 && q.target > 0));
  // Every quest in the catalogue, whichever period draws it: a week always asks
  // for more than a day and pays more for it.
  const catalogue = new Map();
  for (let period = 0; period < 30; period++) for (const quest of quests.questsFor("daily", period)) catalogue.set(quest.id, quest);
  assert.ok(catalogue.size >= 5, "Every quest comes round");
  for (const [id, quest] of catalogue) {
    assert.ok(quest.weekly[0] > quest.daily[0], `${id}: the week asks for more`);
    assert.ok(quest.weekly[1] > quest.daily[1], `${id}: and pays more for it`);
    // The ladder: each rung asks for more than the one below, pays more up to a
    // ceiling, and lands on a number a player can hold in their head.
    for (const scope of ["daily", "weekly"]) {
      const rungs = [0, 1, 2, 3, 4, 5, 6].map((tier) => quests.rung(quest, scope, tier));
      for (let i = 1; i < rungs.length; i++) {
        assert.ok(rungs[i].target > rungs[i - 1].target, `${id} ${scope}: rung ${i} asks for more`);
        assert.ok(rungs[i].reward >= rungs[i - 1].reward, `${id} ${scope}: and never pays less`);
      }
      assert.equal(rungs[0].target, quest[scope][0], `${id} ${scope}: the first rung is the one in the catalogue`);
      assert.equal(rungs[0].reward, quest[scope][1]);
      assert.ok(rungs[6].reward <= quest[scope][1] * 3, `${id} ${scope}: the gems stop climbing`);
      assert.equal(rungs[6].reward, rungs[5].reward, `${id} ${scope}: and have stopped by the sixth`);
      for (const { target } of rungs) {
        const step = target < 40 ? 1 : target < 200 ? 5 : target < 2_000 ? 50 : target < 20_000 ? 500 : 2_500;
        assert.equal(target % step, 0, `${id} ${scope}: ${target} is a round number`);
      }
    }
  }

  // 3. What counts, and what does not.
  played(ANA, { score: 900, clears: 1, won: true });
  played(ANA, { score: 300, clears: 0, won: false });
  played(ANA, { score: 4_000, clears: 9, won: true, joined: false });
  played(ANA, { score: 4_000, clears: 9, won: true, cancelled: 1 });
  played(BEN, { score: 4_000, clears: 9, won: true });
  const board = await quests.questBoard(ANA, NOW);
  const all = [...board.daily, ...board.weekly];
  assert.ok(new Set(all.map((q) => q.id)).size >= 3, "Between the two boards most of the catalogue is on screen");
  for (const [id, expected] of [["play", 2], ["win", 1], ["points", 1_200], ["score", 900], ["clear", 1]]) {
    for (const quest of all.filter((q) => q.id === id)) {
      assert.equal(quest.progress, Math.min(expected, quest.target), `${id}: a seat nobody took, a cancelled match and somebody else's run are all ignored`);
    }
  }

  // 4. Yesterday counts for the week, never for the day.
  played(ANA, { score: 700, won: true, at: NOW - DAY });
  const carried = await quests.questBoard(ANA, NOW);
  const find = (scope, id) => carried[scope].find((q) => q.id === id);
  for (const id of ["play", "win", "points"]) {
    const day = find("daily", id);
    const week = find("weekly", id);
    if (day && week) assert.ok(week.progress > day.progress, `${id}: the week has yesterday in it and the day does not`);
  }

  // 5. Claiming: only what is finished, once, and paid in gems.
  const runnable = (await quests.questBoard(ANA, NOW)).daily.find((q) => q.progress < q.target);
  if (runnable) await assert.rejects(() => quests.claimQuest(ANA, "daily", runnable.id, NOW), /not finished yet/);
  await assert.rejects(() => quests.claimQuest(ANA, "monthly", "play", NOW), (e) => e.status === 404);
  await assert.rejects(() => quests.claimQuest(ANA, "daily", "nonsense", NOW), (e) => e.status === 404);

  // Finish every daily quest outright, then take them.
  for (let i = 0; i < 20; i++) played(ANA, { score: 1_500, clears: 2, won: true });
  const full = await quests.questBoard(ANA, NOW);
  assert.ok(full.daily.every((q) => q.progress >= q.target), "Twenty wins finishes anything the day can ask");
  assert.equal(full.ready, full.daily.length + full.weekly.filter((q) => q.progress >= q.target).length);

  let paid = 0;
  for (const quest of full.daily) {
    const result = await quests.claimQuest(ANA, "daily", quest.id, NOW);
    assert.deepEqual([result.scope, result.quest, result.tier, result.reward], ["daily", quest.id, 0, quest.reward]);
    assert.ok(result.next > quest.target, "The claim says what the next rung will ask for");
    paid += quest.reward;
  }
  assert.equal(gems(ANA) - start, paid, "The gems land in the balance, through the ledger like everything else");
  assert.equal(count("SELECT COUNT(*) AS n FROM ledger WHERE user_id = ? AND kind = 'quest_reward'", ANA), full.daily.length);

  // 6. A claimed quest does not go away: it comes back harder, and richer, with
  //    the work already done still counting towards it.
  const raised = await quests.questBoard(ANA, NOW);
  for (const quest of raised.daily) {
    const was = full.daily.find((q) => q.id === quest.id);
    assert.equal(quest.tier, 1, `${quest.id}: one rung taken`);
    assert.ok(quest.target > was.target, `${quest.id}: the bar went up`);
    assert.ok(quest.reward > was.reward, `${quest.id}: and so did the gems`);
    assert.ok(quest.title.includes(quest.target.toLocaleString("en")), `${quest.id}: the title says the new target`);
    assert.ok(quest.progress >= Math.min(was.target, quest.target), `${quest.id}: nothing already done was thrown away`);
  }

  // Climbing until a rung is out of reach, one claim at a time.
  const ladder = raised.daily[0];
  let rungs = 1;
  for (;;) {
    const current = (await quests.questBoard(ANA, NOW)).daily.find((q) => q.id === ladder.id);
    if (current.progress < current.target) break;
    await quests.claimQuest(ANA, "daily", ladder.id, NOW);
    rungs++;
  }
  assert.ok(rungs > 1, "A good day is worth more than one rung");
  const stopped = (await quests.questBoard(ANA, NOW)).daily.find((q) => q.id === ladder.id);
  assert.equal(stopped.tier, rungs, "The board sits on the first rung still out of reach");
  await assert.rejects(() => quests.claimQuest(ANA, "daily", ladder.id, NOW), /not finished yet/, "And that one is not payable yet");
  assert.equal(
    count("SELECT COUNT(DISTINCT id) AS n FROM ledger WHERE user_id = ? AND kind = 'quest_reward'", ANA),
    count("SELECT COUNT(*) AS n FROM ledger WHERE user_id = ? AND kind = 'quest_reward'", ANA),
    "Every rung paid on its own ledger line",
  );

  // Two taps at the same moment land one payment: they are the same rung.
  const weekly = (await quests.questBoard(ANA, NOW)).weekly.find((q) => q.progress >= q.target);
  assert.ok(weekly, "A week's worth of play finishes a weekly quest too");
  const before = gems(ANA);
  const both = await Promise.allSettled([quests.claimQuest(ANA, "weekly", weekly.id, NOW), quests.claimQuest(ANA, "weekly", weekly.id, NOW)]);
  assert.equal(both.filter((r) => r.status === "fulfilled").length, 1, "Only one of them pays");
  assert.equal(gems(ANA) - before, weekly.reward);

  // 7. Tomorrow the ladder is back on the ground; the week keeps its rungs.
  const tomorrow = await quests.questBoard(ANA, NOW + DAY);
  assert.ok(tomorrow.daily.every((q) => q.tier === 0), "A new day, and every quest back to its first rung");
  assert.ok(tomorrow.weekly.some((q) => q.tier > 0), "The week carries on from where it was");
  const nextWeek = await quests.questBoard(ANA, NOW + 7 * DAY);
  assert.ok(nextWeek.weekly.every((q) => q.tier === 0), "And a new week starts again too");

  // 8. A suspended account claims nothing.
  sqlite.prepare("INSERT INTO player_suspensions(user_id, status, source, reason, evidence, created) VALUES(?, 'suspended', 'stats', 'review', '{}', 0)").run(ANA);
  const left = (await quests.questBoard(ANA, NOW)).weekly.find((q) => q.progress >= q.target);
  if (left) await assert.rejects(() => quests.claimQuest(ANA, "weekly", left.id, NOW), (e) => e.status === 403);
  sqlite.prepare("DELETE FROM player_suspensions WHERE user_id = ?").run(ANA);

  // 9. The badge the rest of the site shows is the board's own count.
  const snapshot = await playerSnapshot(ANA, "gems");
  assert.equal(snapshot.questsReady, (await quests.questBoard(ANA)).ready);

  console.log(
    "PASS: quests (three a day and three a week, the same for everyone, stable within a period and rotating between them; the week asks more and pays more; a ladder whose every rung asks for more, pays more up to a ceiling and lands on a round number; progress read from finished runs only, ignoring practice, unjoined seats, cancelled matches and other players; yesterday counts for the week and not the day; claims refused before the target, on an unknown quest or scope, and from a suspended account; gems paid through the ledger, one line per rung, once, even from two taps at the same moment; a claimed quest coming back harder with the work already done still counting; the daily ladder back on the ground tomorrow and the weekly one next week; and the badge matching the board).",
  );
} finally {
  close();
}
