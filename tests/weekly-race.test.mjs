import assert from "node:assert/strict";
import { createDatabase } from "./helpers/test-env.mjs";

// Weekly race: best real-money score per player per week, admin exclusions and
// a one-time payout of SOL from the house balance plus gems.
const { sqlite, close } = await createDatabase();
globalThis.fetch = async () => {
  throw new Error("The weekly race must not touch the network");
};
const race = await import("../lib/weekly-race.ts");
const { cashAccountId, HOUSE } = await import("../lib/payments/accounts.ts");

const SOL = 1_000_000_000;
const HOUR = 3_600_000;
const WEEK = race.WEEK;
const MONDAY = Date.UTC(2026, 8, 14); // Monday 14 September 2026, 00:00 UTC
const PREVIOUS = MONDAY - WEEK;

try {
  // Weeks start on Monday 00:00 UTC.
  assert.equal(race.weekStart(MONDAY), MONDAY);
  assert.equal(race.weekStart(MONDAY + 3.5 * 24 * HOUR), MONDAY);
  assert.equal(race.weekStart(MONDAY - 1), PREVIOUS, "Sunday 23:59:59.999 belongs to the previous week");
  assert.equal(new Date(race.weekStart(Date.UTC(2026, 8, 20, 23))).getUTCDay(), 1);

  const ids = { ann: "race-ann-private", ben: "race-ben-private", cat: "race-cat-private", dom: "race-dom-private", eve: "race-eve-private" };
  for (const [name, id] of Object.entries(ids)) {
    sqlite.prepare("INSERT INTO players(id, name, created) VALUES(?, ?, 0)").run(id, name[0].toUpperCase() + name.slice(1));
    sqlite.prepare("INSERT INTO cash_accounts(id, network, user_id, balance, created) VALUES(?, 'devnet', ?, 0, 0)").run(cashAccountId(id), id);
  }
  sqlite.prepare("INSERT INTO cash_accounts(id, network, user_id, balance, created) VALUES(?, 'devnet', ?, ?, 0)").run(cashAccountId(HOUSE), HOUSE, 2 * SOL);
  const gems = (id) => sqlite.prepare("SELECT balance FROM players WHERE id = ?").get(id).balance;
  const cash = (id) => sqlite.prepare("SELECT balance FROM cash_accounts WHERE id = ?").get(cashAccountId(id)).balance;

  let n = 0;
  const run = (uid, score, finished, { asset = "devnet", cancelled = 0, joined = true, done = 1 } = {}) => {
    const match = `match-${++n}`;
    sqlite.prepare("INSERT INTO matches(id, seed, stake, asset, p1, p2, settled, cancelled, created, ruleset) VALUES(?, 1, 1, ?, ?, ?, 1, ?, 0, 6)").run(match, asset, uid, joined ? ids.eve : null, cancelled);
    sqlite.prepare("INSERT INTO runs(id, match_id, user_id, state, score, done, created, finished) VALUES(?, ?, ?, '{}', ?, ?, 0, ?)").run(`run-${n}`, match, uid, score, done, done ? finished : null);
    return `m-run-${n}`;
  };
  const tournamentRun = (uid, score, finished, { entryFee = SOL, status = "settled" } = {}) => {
    const t = `cup-${++n}`;
    sqlite.prepare("INSERT INTO tournaments(id, name, asset, entry_fee, prize, payout, places, seed, ruleset, starts_at, ends_at, status, created) VALUES(?, ?, 'devnet', ?, 0, 'top3', 8, 1, 6, 0, 1, ?, 0)").run(t, t, entryFee, status);
    sqlite.prepare("INSERT INTO tournament_entries(id, tournament_id, user_id, state, score, done, registered, finished) VALUES(?, ?, ?, '{}', ?, 1, 0, ?)").run(`entry-${n}`, t, uid, score, finished);
  };

  // This week.
  const annBest = run(ids.ann, 90, MONDAY + 2 * HOUR);
  run(ids.ann, 40, MONDAY + 3 * HOUR); // Only a player's best score counts.
  tournamentRun(ids.ben, 120, MONDAY + 5 * HOUR); // Paid SOL tournament run.
  run(ids.cat, 90, MONDAY + 4 * HOUR, { joined: false }); // Ties Ann but later; seat still open, so no watch link.
  run(ids.dom, 70, MONDAY + HOUR);
  run(ids.eve, 500, MONDAY + HOUR, { asset: "gems" }); // Gems do not count.
  run(ids.eve, 400, MONDAY + HOUR, { cancelled: 1 }); // Cancelled matches do not count.
  run(ids.eve, 300, 0, { done: 0 }); // Unfinished runs do not count.
  tournamentRun(ids.eve, 450, MONDAY + HOUR, { entryFee: 0 }); // Free tournaments do not count.
  tournamentRun(ids.eve, 350, MONDAY + HOUR, { status: "cancelled" }); // Cancelled tournaments do not count.
  run(ids.eve, 60, MONDAY + WEEK); // Next week.
  // Last week.
  run(ids.dom, 200, PREVIOUS + HOUR);

  const now = MONDAY + 3 * 24 * HOUR;
  const current = await race.weeklyRace(now);
  assert.equal(current.weekStart, MONDAY);
  assert.equal(current.weekEnd, MONDAY + WEEK);
  assert.deepEqual(current.prizes, race.DEFAULT_PRIZES);
  assert.deepEqual(
    current.standings.map((s) => [s.rank, s.name, s.score]),
    [[1, "Ben", 120], [2, "Ann", 90], [3, "Cat", 90], [4, "Dom", 70]],
    "Best score per player; an earlier score wins a tie; gems, cancelled, unfinished, free and other-week runs are left out",
  );
  assert.equal(current.standings[1].watchId, annBest, "Joined match runs can be watched");
  assert.equal(current.standings[2].watchId, null, "A run whose seat is still open is not linked");
  assert.deepEqual(current.previous.winners.map((w) => [w.name, w.score, w.sol, w.gems]), [["Dom", 200, SOL, 5_000]]);
  assert.equal(current.previous.paid, false, "Last week awaits review");
  assert.ok(!JSON.stringify(current).includes("private"), "No player IDs");

  // Paying: only ended weeks, only once.
  await assert.rejects(() => race.payWeeklyRace("admin", MONDAY, now), /not ended/);
  await assert.rejects(() => race.payWeeklyRace("admin", MONDAY + 1, now), /Unknown race week/);

  // Exclusions reorder the places.
  await assert.rejects(() => race.setRaceExclusion("admin", { week: MONDAY, name: "Ben", reason: "", excluded: true }, now), /reason/);
  await race.setRaceExclusion("admin", { week: MONDAY, name: "ben", reason: "Suspicious score", excluded: true }, now);
  assert.deepEqual((await race.weeklyRace(now)).standings.map((s) => s.name), ["Ann", "Cat", "Dom"]);
  const admin = await race.adminRaces(now);
  assert.deepEqual(admin.weeks[0].excluded, [{ name: "Ben", reason: "Suspicious score" }]);
  assert.equal(admin.weeks[1].weekStart, PREVIOUS);
  await race.setRaceExclusion("admin", { week: MONDAY, name: "Ben", excluded: false }, now);
  await race.setRaceExclusion("admin", { week: MONDAY, name: "Dom", reason: "Testing", excluded: true }, now);

  // Prize settings.
  await assert.rejects(() => race.setRacePrizes("admin", [{ sol: "1", gems: 1 }], now), /top 3/);
  await assert.rejects(() => race.setRacePrizes("admin", [{ sol: "101", gems: 1 }, { sol: "0", gems: 0 }, { sol: "0", gems: 0 }], now), /at most 100 SOL/);
  await assert.rejects(() => race.setRacePrizes("admin", [{ sol: "1", gems: 1.5 }, { sol: "0", gems: 0 }, { sol: "0", gems: 0 }], now), /whole numbers/);
  const prizes = await race.setRacePrizes("admin", [{ sol: "1.5", gems: 3000 }, { sol: "0.75", gems: 2000 }, { sol: "0", gems: 1000 }], now);
  assert.deepEqual(prizes, [{ sol: 1.5 * SOL, gems: 3000 }, { sol: 0.75 * SOL, gems: 2000 }, { sol: 0, gems: 1000 }]);

  // The house cannot cover 2.25 SOL with 2 SOL: nothing is paid.
  const after = MONDAY + WEEK + HOUR;
  const gemsBefore = gems(ids.ben);
  await assert.rejects(() => race.payWeeklyRace("admin", MONDAY, after), /treasury balance/);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM weekly_races").get().n, 0);
  assert.equal(gems(ids.ben), gemsBefore, "A failed payout credits nothing");
  assert.equal(cash(HOUSE), 2 * SOL);

  sqlite.prepare("UPDATE cash_accounts SET balance = ? WHERE id = ?").run(10 * SOL, cashAccountId(HOUSE));
  const winners = await race.payWeeklyRace("admin", MONDAY, after);
  assert.deepEqual(winners.map((w) => [w.rank, w.name, w.score, w.sol, w.gems]), [[1, "Ben", 120, 1.5 * SOL, 3000], [2, "Ann", 90, 0.75 * SOL, 2000], [3, "Cat", 90, 0, 1000]]);
  assert.equal(cash(HOUSE), 10 * SOL - 2.25 * SOL, "SOL prizes come from the house balance");
  assert.deepEqual([cash(ids.ben), cash(ids.ann), cash(ids.cat), cash(ids.dom)], [1.5 * SOL, 0.75 * SOL, 0, 0]);
  assert.equal(gems(ids.ben), gemsBefore + 3000);
  const notes = sqlite.prepare("SELECT user_id, kind, data FROM notifications WHERE kind = 'race_result' ORDER BY id").all();
  assert.deepEqual(notes.map((r) => [r.user_id, JSON.parse(r.data).rank]), [[ids.ben, 1], [ids.ann, 2], [ids.cat, 3]]);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM admin_audit WHERE action = 'weekly_race_pay'").get().n, 1);

  await assert.rejects(() => race.payWeeklyRace("admin", MONDAY, after), /already paid/);
  await assert.rejects(() => race.setRaceExclusion("admin", { week: MONDAY, name: "Ann", reason: "Too late", excluded: true }, after), /already paid/);
  const nextWeek = await race.weeklyRace(after);
  assert.equal(nextWeek.previous.paid, true);
  assert.deepEqual(nextWeek.previous.winners.map((w) => w.name), ["Ben", "Ann", "Cat"], "The paid result is frozen");
  assert.deepEqual(nextWeek.standings.map((s) => [s.name, s.score]), [["Eve", 60]]);
  await assert.rejects(() => race.payWeeklyRace("admin", MONDAY + 2 * WEEK, after), /Unknown race week/);

  console.log("PASS: weekly race (Monday UTC weeks, best real-money score per player, ties by time, gems/cancelled/unfinished/free runs excluded, watch links, exclusions, prize settings, ended weeks only, atomic single payout from the house balance with gems and notifications, frozen results, no player IDs).");
} finally {
  close();
}
