import assert from "node:assert/strict";
import { createDatabase } from "./helpers/test-env.mjs";

// Ranks: the ladder, and experience from devnet SOL wagered on finished competition only.
const { sqlite, close } = await createDatabase();
globalThis.fetch = async () => {
  throw new Error("Levels must not touch the network");
};
const { levelFor, experienceFromWagered, RANKS } = await import("../lib/levels.ts");
const { playerLevel } = await import("../lib/experience.ts");
const { publicProfile } = await import("../lib/public-profile.ts");
const matches = await import("../lib/matches.ts");

const SOL = 1_000_000_000;

try {
  // The ladder: 6 tiers of 3 divisions, then Bouncer; thresholds strictly increase.
  assert.equal(RANKS.length, 19);
  for (let i = 1; i < RANKS.length; i++) assert.ok(RANKS[i].xp > RANKS[i - 1].xp);
  assert.deepEqual(levelFor(0), { tier: "iron", division: 1, name: "Iron 1", xp: 0, floor: 0, next: 50, nextName: "Iron 2" });
  assert.equal(levelFor(49).name, "Iron 1");
  assert.equal(levelFor(50).name, "Iron 2");
  assert.equal(levelFor(300).name, "Bronze 1");
  assert.equal(levelFor(2_499).name, "Silver 2");
  assert.equal(levelFor(59_999).name, "Diamond 2");
  assert.deepEqual(levelFor(60_000), { tier: "diamond", division: 3, name: "Diamond 3", xp: 60_000, floor: 60_000, next: 100_000, nextName: "Bouncer" });
  assert.deepEqual(levelFor(250_000), { tier: "bouncer", division: null, name: "Bouncer", xp: 250_000, floor: 100_000, next: null, nextName: null });
  assert.equal(levelFor(-5).name, "Iron 1", "Bad input stays at the bottom");
  assert.equal(experienceFromWagered(0.05 * SOL), 5, "1 XP per 0.01 SOL");
  assert.equal(experienceFromWagered(9_999_999), 0, "Partial points round down");

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

  // 1 + 0.5 (a tie still counts) + 0.25 + 0.25 (deleted tournament) = 2 SOL = 200 XP.
  const liv = await playerLevel(LIV);
  assert.equal(liv.xp, 200, "Settled matches, ties and closed tournaments count; the rest does not");
  assert.equal(liv.name, "Iron 3");
  assert.equal((await playerLevel(MAX)).xp, 0, "The opponent's ledger is separate");
  assert.equal((await playerLevel("nobody")).name, "Iron 1", "Players without a SOL account start at Iron 1");

  // Settling the running match and ending the upcoming tournament adds their wagers.
  sqlite.prepare("UPDATE matches SET settled = 1 WHERE id = 'playing'").run();
  sqlite.prepare("UPDATE tournaments SET status = 'settled' WHERE id = 'cup-upcoming'").run();
  assert.equal((await playerLevel(LIV)).name, "Bronze 3", "10 SOL wagered is 1,000 XP");

  const profile = await publicProfile("Liv", MAX);
  assert.equal(profile.level.xp, 1_000, "Profiles carry the rank");
  const leaders = await matches.leaderboard(null, "devnet");
  const livRow = leaders.find((l) => l.name === "Liv");
  assert.equal(livRow.level.name, "Bronze 3", "Leaderboard rows carry the rank");
  assert.ok(!("wagered" in livRow) && !JSON.stringify(leaders).includes("private"), "No raw totals or player IDs in the leaderboard");
  assert.equal((await matches.leaderboard(null, "gems")).find((l) => l.name === "Liv").level.xp, 1_000, "Gem leaderboard shows the same SOL rank");

  console.log("PASS: ranks (ladder and thresholds, 1 XP per 0.01 SOL, settled matches and ties, closed and deleted tournaments minus refunds, no XP for unsettled or cancelled matches, upcoming tournaments, tips, withdrawals or gems, profile and leaderboard ranks without IDs).");
} finally {
  close();
}
