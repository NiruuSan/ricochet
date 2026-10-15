import assert from "node:assert/strict";
import { createDatabase } from "./helpers/test-env.mjs";

// Account levels: the ladder, and experience from devnet SOL wagered on finished competition only.
const { sqlite, close } = await createDatabase();
globalThis.fetch = async () => {
  throw new Error("Levels must not touch the network");
};
const { accountLevelFor, cashbackFor, experienceFromWagered, levelStart, LEVEL_CAP, RANKS } = await import("../lib/levels.ts");
const { playerLevel } = await import("../lib/experience.ts");
const { publicProfile } = await import("../lib/public-profile.ts");
const matches = await import("../lib/matches.ts");

const SOL = 1_000_000_000;

try {
  // The level ladder: 60 levels whose thresholds strictly increase.
  for (let l = 2; l <= LEVEL_CAP; l++) assert.ok(levelStart(l) > levelStart(l - 1), `Level ${l} starts above level ${l - 1}`);
  assert.deepEqual(accountLevelFor(0), { level: 1, xp: 0, floor: 0, next: levelStart(2) });
  // The cashback steps sit exactly where the old ranks started.
  for (const [level, xp] of [[10, 50], [20, 400], [30, 3_000], [40, 25_000], [50, 200_000], [60, 1_000_000]]) {
    assert.equal(levelStart(level), xp, `Level ${level} starts at ${xp} XP`);
    assert.equal(accountLevelFor(xp).level, level);
    assert.equal(accountLevelFor(xp - 1).level, level - 1, `${xp - 1} XP is still level ${level - 1}`);
  }
  assert.deepEqual(accountLevelFor(5_000_000), { level: 60, xp: 5_000_000, floor: 1_000_000, next: null }, "Level 60 is the last");
  assert.equal(experienceFromWagered(100_000 * SOL), 1_000_000, "Level 60 is 100,000 SOL wagered");
  assert.equal(accountLevelFor(-5).level, 1, "Bad input stays at the bottom");
  assert.deepEqual([1, 9, 10, 29, 30, 59, 60].map((l) => cashbackFor(l).share), [3, 3, 4, 5, 6, 11, 14]);
  assert.equal(cashbackFor(29).gems, true, "Below level 30 the cashback is paid in gems");
  assert.equal(cashbackFor(30).gems, false);
  // The ranked ladder is separate: 18 divisions of 100 RR, then Bouncer at Diamond 3's floor.
  assert.equal(RANKS.length, 19);
  for (let i = 1; i < 18; i++) assert.equal(RANKS[i].rating - RANKS[i - 1].rating, 100);
  assert.equal(experienceFromWagered(1 * SOL), 10, "1 XP per 0.1 SOL");
  assert.equal(experienceFromWagered(0.15 * SOL), 1, "Partial points round down on the total");

  // Fixtures: Liv wagers on everything; Max only on what must not count.
  const LIV = "levels-liv-private", MAX = "levels-max-private";
  for (const [id, name] of [[LIV, "Liv"], [MAX, "Max"]]) {
    sqlite.prepare("INSERT INTO players(id, name, created) VALUES(?, ?, 0)").run(id, name);
    sqlite.prepare("INSERT INTO cash_accounts(id, network, user_id, balance, created) VALUES(?, 'devnet', ?, ?, 0)").run(`devnet:${id}`, id, 1_000 * SOL);
  }
  let n = 0;
  const entry = (uid, kind, amount, reference) =>
    sqlite.prepare("INSERT INTO cash_ledger(id, account_id, kind, amount, reference, created) VALUES(?, ?, ?, ?, ?, ?)").run(`l${++n}`, `devnet:${uid}`, kind, amount, reference, n);
  const match = (id, { stake, settled = 1, cancelled = 0, p2 = MAX, asset = "devnet" }) =>
    sqlite.prepare("INSERT INTO matches(id, seed, stake, asset, p1, p2, settled, cancelled, created, ruleset) VALUES(?, 1, ?, ?, ?, ?, ?, ?, 0, 6)").run(id, stake, asset, LIV, p2, settled, cancelled);
  const tournament = (id, status) =>
    sqlite.prepare("INSERT INTO tournaments(id, name, asset, entry_fee, prize, payout, places, seed, ruleset, starts_at, ends_at, status, created) VALUES(?, ?, 'devnet', 0, 0, 'top3', 8, 1, 6, 0, 1, ?, 0)").run(id, id, status);

  match("settled", { stake: 1 * SOL });
  entry(LIV, "match_entry", -1 * SOL, "settled");
  entry(LIV, "match_payout", 1.76 * SOL, "settled");
  match("tie", { stake: 0.5 * SOL });
  entry(LIV, "match_entry", -0.5 * SOL, "tie");
  entry(LIV, "match_refund", 0.5 * SOL, "tie");
  match("playing", { stake: 5 * SOL, settled: 0, p2: null });
  entry(LIV, "match_entry", -5 * SOL, "playing");
  match("cancelled", { stake: 0.1 * SOL, cancelled: 1, p2: null });
  entry(LIV, "match_entry", -0.1 * SOL, "cancelled");
  entry(LIV, "match_refund", 0.088 * SOL, "cancelled");
  tournament("cup-settled", "settled");
  entry(LIV, "tournament_entry", -0.25 * SOL, "cup-settled");
  tournament("cup-upcoming", "scheduled");
  entry(LIV, "tournament_entry", -3 * SOL, "cup-upcoming");
  tournament("cup-cancelled", "cancelled");
  entry(LIV, "tournament_entry", -2 * SOL, "cup-cancelled");
  entry(LIV, "tournament_refund", 2 * SOL, "cup-cancelled");
  entry(LIV, "tournament_entry", -0.25 * SOL, "cup-deleted-by-admin");
  entry(LIV, "tip_sent", -7 * SOL, "tip");
  entry(LIV, "withdrawal_reserve", -9 * SOL, "withdrawal");
  match("gem-match", { stake: 1000, asset: "gems" });
  sqlite.prepare("INSERT INTO ledger(id, user_id, match_id, kind, amount, created) VALUES('gem-entry', ?, 'gem-match', 'entry', -1000, 0)").run(LIV);

  // 1 + 0.5 (a tie still counts) + 0.25 + 0.25 (deleted tournament) = 2 SOL = 20 XP.
  const liv = await playerLevel(LIV);
  assert.equal(liv.xp, 20, "Settled matches, ties and closed tournaments count; the rest does not");
  assert.equal(liv.level, accountLevelFor(20).level);
  assert.equal((await playerLevel(MAX)).xp, 0, "The opponent's ledger is separate");
  assert.equal((await playerLevel("nobody")).level, 1, "Players without a SOL account start at level 1");

  // Settling the running match and ending the upcoming tournament adds their wagers.
  sqlite.prepare("UPDATE matches SET settled = 1 WHERE id = 'playing'").run();
  sqlite.prepare("UPDATE tournaments SET status = 'settled' WHERE id = 'cup-upcoming'").run();
  const after = await playerLevel(LIV);
  assert.equal(after.xp, 100, "10 SOL wagered is 100 XP");
  assert.equal(after.level, 13);

  const profile = await publicProfile("Liv", MAX);
  assert.equal(profile.level.xp, 100, "Profiles carry the account level");
  assert.equal(profile.ranked.tier, "unranked", "and a ranked rank of their own, which wagering alone does not move");
  const leaders = await matches.leaderboard(null, "devnet");
  const livRow = leaders.find((l) => l.name === "Liv");
  assert.equal(livRow.ranked.tier, "unranked", "Leaderboard rows carry the ranked rank");
  assert.ok(!("wagered" in livRow) && !("level" in livRow) && !JSON.stringify(leaders).includes("private"), "No raw totals, levels or player IDs in the leaderboard");

  console.log("PASS: account levels (60 levels, cashback steps where the old ranks started, 1 XP per 0.1 SOL, level 60 at 100,000 SOL, settled matches and ties, closed and deleted tournaments minus refunds, no XP for unsettled or cancelled matches, upcoming tournaments, tips, withdrawals or gems, profile level and ranked rank, leaderboard ranks without IDs).");
} finally {
  close();
}
