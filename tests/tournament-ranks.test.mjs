import assert from "node:assert/strict";
import { createDatabase } from "./helpers/test-env.mjs";

// Tournaments limited by rank: who a cup is for, in words; the limits an
// administrator may set; registration checked against the rank a player holds
// when they register, and nothing after; players still being placed kept out;
// and the house's players entering only the cups their fixed rank fits.
Object.assign(process.env, { SOLANA_NETWORK: "devnet", SOLANA_RPC_URL: "https://rpc.invalid", SOLANA_VAULT_KEY: Buffer.alloc(32, 4).toString("base64") });
const { sqlite, close } = await createDatabase();
globalThis.fetch = async () => {
  throw new Error("Tournaments must not touch the network");
};
const limits = await import("../lib/rank-limits.ts");
const { rankFor } = await import("../lib/levels.ts");
const t = await import("../lib/tournaments.ts");
const bots = await import("../lib/bots.ts");
const { seasonAt } = await import("../lib/ranked-rules.ts");
const { cashAccountId, ensureCashAccount, HOUSE } = await import("../lib/payments/accounts.ts");

const SOL = 1_000_000_000;
const MIN = 60_000;
const NOW = Date.now();
const season = seasonAt(NOW);
const run = (sql, ...args) => sqlite.prepare(sql).run(...args);
const stored = (id) => ({ ...sqlite.prepare("SELECT min_rank, max_rank FROM tournaments WHERE id = ?").get(id) });
const entrants = (id) => sqlite.prepare("SELECT p.name FROM tournament_entries e JOIN players p ON p.id = e.user_id WHERE e.tournament_id = ? ORDER BY p.name").all(id).map((r) => r.name);

try {
  // --- In words -------------------------------------------------------------
  const { rankLimitLabel: label, rankBlock: block, rankStep, TOP_STEP } = limits;
  assert.equal(TOP_STEP, 18, "Iron 1 to Diamond 3, then Bouncer");
  assert.equal(label({ min: null, max: null }), null, "An open cup says nothing");
  assert.equal(label({ min: 9, max: 14 }), "Gold – Platinum", "Whole tiers read as tiers");
  assert.equal(label({ min: 10, max: 12 }), "Gold 2 – Platinum 1");
  assert.equal(label({ min: 9, max: 11 }), "Gold only");
  assert.equal(label({ min: 10, max: 10 }), "Gold 2 only");
  assert.equal(label({ min: 6, max: null }), "Silver and above");
  assert.equal(label({ min: null, max: 4 }), "Up to Bronze 2");
  assert.equal(label({ min: null, max: 5 }), "Up to Bronze");
  assert.equal(label({ min: 18, max: null }), "Bouncers only");
  assert.equal(label({ min: 0, max: null }), "Ranked players only");
  assert.equal(rankStep(rankFor(950)), 9);
  assert.equal(rankStep(rankFor(2100)), 17, "Diamond 3 has no ceiling");
  assert.equal(rankStep(rankFor(1800, { bouncer: true, position: 3 })), 18);
  assert.equal(rankStep(rankFor(950, { placementsLeft: 2 })), null, "No rank while being placed");
  assert.equal(block(rankFor(950), { min: 9, max: 14 }), null);
  assert.match(block(rankFor(850), { min: 9, max: 14 }), /for Gold – Platinum, and you are Silver 3/);
  assert.match(block(rankFor(950, { placementsLeft: 2 }), { min: 9, max: 14 }), /Finish your placement matches/);
  assert.equal(block(rankFor(950, { placementsLeft: 2 }), { min: null, max: null }), null, "An open cup takes anybody");

  // --- What an administrator may set -------------------------------------------
  const base = { name: "Gold Rush", asset: "gems", entry: "free", prize: "500", payout: "top3", places: 8, startsAt: NOW + 60 * MIN, endsAt: NOW + 120 * MIN };
  await assert.rejects(() => t.createTournament({ ...base, minRank: 12, maxRank: 9 }, NOW), /lowest rank cannot be above the highest/);
  for (const bad of [-1, 19, 2.5, "gold"]) await assert.rejects(() => t.createTournament({ ...base, minRank: bad }, NOW), /from the list/);
  const open = await t.createTournament({ ...base, name: "Open Cup", minRank: "", maxRank: null }, NOW);
  assert.deepEqual(stored(open), { min_rank: null, max_rank: null });
  const bouncerTop = await t.createTournament({ ...base, name: "Top Half", minRank: 12, maxRank: 18 }, NOW);
  assert.deepEqual(stored(bouncerTop), { min_rank: 12, max_rank: null }, "Bouncer as the highest is no limit at all");
  const gold = await t.createTournament({ ...base, minRank: 9, maxRank: 14 }, NOW);
  const listed = (await t.listTournaments(null, NOW)).find((c) => c.id === gold);
  assert.deepEqual(listed.ranks, { min: 9, max: 14 }, "The lobby shows who a cup is for");
  assert.deepEqual((await t.tournamentDetail(null, gold, NOW)).ranks, { min: 9, max: 14 });

  // --- Registration, by the rank held now -----------------------------------------
  const people = [
    ["u-low", "Low", 820, 5], // Silver 3: below
    ["u-mid", "Mid", 1010, 5], // Gold 2: in
    ["u-high", "High", 1550, 5], // Diamond 1: above
    ["u-new", "New", 1010, 2], // still being placed
  ];
  for (const [id, name, rating, games] of people) {
    run("INSERT INTO players(id, name, balance, created) VALUES(?, ?, 5000, 0)", id, name);
    run("INSERT INTO ranked_ratings(user_id, season, rating, games, wins, placements, peak, shield, last_played, created) VALUES(?, ?, ?, ?, 0, 5, ?, 0, ?, 0)", id, season, rating, games, rating, NOW - MIN);
  }
  await assert.rejects(() => t.registerForTournament("u-low", gold, NOW), (e) => e.status === 403 && /Gold – Platinum, and you are Silver 3/.test(e.message));
  await assert.rejects(() => t.registerForTournament("u-high", gold, NOW), /and you are Diamond 1/);
  await assert.rejects(() => t.registerForTournament("u-new", gold, NOW), /Finish your placement matches/);
  await t.registerForTournament("u-mid", gold, NOW);
  await t.registerForTournament("u-new", open, NOW);
  assert.deepEqual(entrants(gold), ["Mid"]);
  assert.deepEqual(entrants(open), ["New"], "An open cup still takes a player being placed");
  // A climb after registering keeps the seat; a climb before it opens the door.
  run("UPDATE ranked_ratings SET rating = 1560 WHERE user_id = 'u-mid'");
  assert.deepEqual(entrants(gold), ["Mid"]);
  run("UPDATE ranked_ratings SET rating = 905 WHERE user_id = 'u-low'");
  await t.registerForTournament("u-low", gold, NOW);
  assert.deepEqual(entrants(gold), ["Low", "Mid"]);

  // --- The house's players: only those whose fixed rank fits -------------------------
  const ADMIN = "github:boss";
  run("INSERT INTO players(id, name, balance, created) VALUES(?, 'Boss', 0, 0)", ADMIN);
  await ensureCashAccount(HOUSE);
  run("INSERT INTO cash_ledger VALUES('house', ?, 'fixture', ?, 'fixture', 0)", cashAccountId(HOUSE), 100 * SOL);
  await bots.setBotConfig(ADMIN, { enabled: true, count: 6 }, NOW);
  const goldOnly = await t.createTournament({ ...base, name: "Gold Only", minRank: 9, maxRank: 11 }, NOW);
  const filled = await bots.fillTournament(ADMIN, goldOnly, NOW);
  const skills = sqlite.prepare("SELECT r.rating FROM tournament_entries e JOIN ranked_ratings r ON r.user_id = e.user_id AND r.season = ? WHERE e.tournament_id = ?").all(season, goldOnly);
  assert.equal(filled.filled, 2, "Two of the six play at Gold 1");
  assert.ok(skills.every((s) => s.rating === 950), "only the steady ones, at Gold 1");
  const diamonds = await t.createTournament({ ...base, name: "Diamond Night", minRank: 15 }, NOW);
  await assert.rejects(() => bots.fillTournament(ADMIN, diamonds, NOW), /No house player fits Diamond and above: they play at Bronze 2, Gold 1, Platinum 3/);
  // And the automatic turn leaves a cup alone when nobody fits it.
  await bots.tickBots(NOW, { immediate: true });
  assert.deepEqual(entrants(diamonds), []);

  console.log(
    "PASS: tournament ranks (labels for ranges, tiers, one rank, floors, ceilings, Bouncers and ranked-only; steps for divisions, Diamond 3 and Bouncer; limits validated and Bouncer as the highest dropped; limits in the lobby and the detail; registration refused below, above and while being placed, by the rank held at registration; open cups untouched; house players entered only where their fixed rank fits).",
  );
} finally {
  close();
}
