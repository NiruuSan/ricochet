import assert from "node:assert/strict";
import { createDatabase } from "./helpers/test-env.mjs";

// Profile statistics: records, streaks, run bests and tournament finishes, from
// finished competition only.
const { sqlite, close } = await createDatabase();
globalThis.fetch = async () => {
  throw new Error("Profile stats must not touch the network");
};
const { profileStats } = await import("../lib/profile-stats.ts");
const { profilePerformance } = await import("../lib/profile-performance.ts");

try {
  const DAN = "stats-dan-private", EVE = "stats-eve-private";
  for (const [id, name] of [[DAN, "Dan"], [EVE, "Eve"]]) sqlite.prepare("INSERT INTO players(id, name, created) VALUES(?, ?, 0)").run(id, name);
  const board = (round) => JSON.stringify({ seed: 1, round, score: 0, balls: 1, x: 236, bricks: [], over: true, bonus: false });
  let n = 0;
  const match = ({ result, score, round = 5, clears = 0, asset = "gems", settled = 1, cancelled = 0 }) => {
    const id = `m${++n}`;
    const winner = result === "win" ? DAN : result === "loss" ? EVE : null;
    sqlite.prepare("INSERT INTO matches(id, seed, stake, asset, p1, p2, settled, winner, cancelled, created, ruleset) VALUES(?, 1, 25, ?, ?, ?, ?, ?, ?, ?, 6)").run(id, asset, DAN, EVE, settled, winner, cancelled, n);
    sqlite.prepare("INSERT INTO runs(id, match_id, user_id, state, score, done, clears, created) VALUES(?, ?, ?, ?, ?, 1, ?, ?)").run(`${id}:dan`, id, DAN, board(round), score, clears, n);
    sqlite.prepare("INSERT INTO runs(id, match_id, user_id, state, score, done, clears, created) VALUES(?, ?, ?, ?, 10, 1, 0, ?)").run(`${id}:eve`, id, EVE, board(3), n);
  };
  // In order: W W L D W W W, a loss in SOL, a cancelled match and one still unsettled.
  match({ result: "win", score: 40, round: 9, clears: 1 });
  match({ result: "win", score: 55 });
  match({ result: "loss", score: 12 });
  match({ result: "draw", score: 20 });
  match({ result: "win", score: 61, round: 12, clears: 2 });
  match({ result: "win", score: 30 });
  match({ result: "win", score: 33 });
  match({ result: "loss", score: 9999, asset: "devnet" });
  match({ result: "draw", score: 8888, cancelled: 1 });
  match({ result: null, score: 7777, round: 40, settled: 0 });

  const tournament = (id, status, rank, score, round = 7, clears = 0) => {
    sqlite.prepare("INSERT INTO tournaments(id, name, asset, entry_fee, prize, payout, places, seed, ruleset, starts_at, ends_at, status, created) VALUES(?, ?, 'gems', 0, 100, 'top3', 8, 1, 6, 0, 1, ?, 0)").run(id, id, status);
    sqlite.prepare("INSERT INTO tournament_entries(id, tournament_id, user_id, state, score, clears, done, registered, rank) VALUES(?, ?, ?, ?, ?, ?, 1, 0, ?)").run(`${id}:dan`, id, DAN, board(round), score, clears, rank);
  };
  tournament("cup-a", "settled", 1, 80, 14, 3);
  tournament("cup-b", "settled", 3, 25);
  tournament("cup-c", "settled", 5, 15);
  tournament("cup-live", "scheduled", null, 6666, 50);

  const gems = await profileStats(DAN, "gems");
  assert.deepEqual(gems.matches, { played: 7, wins: 5, losses: 1, draws: 1, winRate: 5 / 7, streak: 3, bestWinStreak: 3 });
  assert.deepEqual(gems.runs, { played: 10, bestScore: 80, averageScore: Math.round((40 + 55 + 12 + 20 + 61 + 30 + 33 + 80 + 25 + 15) / 10), bestRound: 14, clears: 6 });
  assert.deepEqual(gems.tournaments, { played: 3, wins: 1, podiums: 2, bestRank: 1 });
  for (const hidden of [9999, 8888, 7777, 6666]) assert.ok(!JSON.stringify(gems).includes(String(hidden)), "Unsettled, cancelled and other-currency scores stay out");

  const sol = await profileStats(DAN, "devnet");
  assert.deepEqual([sol.matches.played, sol.matches.losses, sol.matches.streak, sol.matches.winRate, sol.runs.bestScore], [1, 1, -1, 0, 9999], "Stats are per currency; a loss streak is negative");
  const eve = await profileStats(EVE, "gems");
  assert.deepEqual([eve.matches.wins, eve.matches.losses, eve.matches.streak, eve.matches.bestWinStreak], [1, 5, -3, 1], "The opponent sees the mirror record");
  const fresh = await profileStats("nobody", "gems");
  assert.deepEqual(fresh, {
    matches: { played: 0, wins: 0, losses: 0, draws: 0, winRate: null, streak: 0, bestWinStreak: 0 },
    runs: { played: 0, bestScore: 0, averageScore: null, bestRound: 0, clears: 0 },
    tournaments: { played: 0, wins: 0, podiums: 0, bestRank: null },
  });

  const performance = await profilePerformance("Dan", "gems");
  assert.deepEqual(performance.stats, gems, "Profiles ship the same stats");
  assert.ok(!JSON.stringify(performance.stats).includes(DAN));

  console.log("PASS: profile stats (record, win rate, current and best streaks, run bests and averages, tournament finishes, per currency, finished games only).");
} finally {
  close();
}
