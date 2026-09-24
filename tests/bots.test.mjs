import assert from "node:assert/strict";
import { createDatabase } from "./helpers/test-env.mjs";

Object.assign(process.env, { SOLANA_NETWORK: "devnet", SOLANA_RPC_URL: "https://rpc.invalid", SOLANA_VAULT_KEY: Buffer.alloc(32, 9).toString("base64") });

// The house's practice opponents.
//
// They are ordinary players with a flag: they take open seats, play the same
// boards through the same engine, settle the same way, and their wallets are
// filled from the treasury. What has to hold is that they cost the house only
// what it lends them, that a switch really stops them, that a better skill
// really plays better, and that launch day can take them off the site.
const { sqlite, close } = await createDatabase();
const bots = await import("../lib/bots.ts");
const { cashAccountId, ensureCashAccount, HOUSE } = await import("../lib/payments/accounts.ts");
const { playShot, startMatch } = await import("../lib/matches.ts");
const { createTournament } = await import("../lib/tournaments.ts");

const SOL = 1_000_000_000;
// The seats and the runs are stamped by the real clock, so the test starts there.
const NOW = Date.now();
const ADMIN = "github:boss";
const HUMAN = "github:kitsu";
const run = (sql, ...args) => sqlite.prepare(sql).run(...args);
const cash = (uid) => Number(sqlite.prepare("SELECT balance FROM cash_accounts WHERE id = ?").get(cashAccountId(uid))?.balance ?? 0);

try {
  run("INSERT INTO players(id, name, balance, created) VALUES(?, 'Boss', 2000, ?)", ADMIN, NOW - 9e8);
  run("INSERT INTO players(id, name, balance, created) VALUES(?, 'Kitsu', 9000, ?)", HUMAN, NOW - 9e8);
  await Promise.all([ensureCashAccount(HUMAN), ensureCashAccount(HOUSE)]);
  run("INSERT INTO cash_ledger VALUES('house', ?, 'fixture', ?, 'fixture', ?)", cashAccountId(HOUSE), 200 * SOL, NOW - 9e8);
  run("INSERT INTO cash_ledger VALUES('mine', ?, 'deposit', ?, 'fixture', ?)", cashAccountId(HUMAN), 10 * SOL, NOW - 9e8);

  // Off by default: a fresh site is people only.
  assert.equal((await bots.botConfig()).enabled, false);
  assert.deepEqual(await bots.tickBots(NOW), { played: 0, entered: 0, joined: 0 }, "nothing happens while they are off");

  // Turning them on puts the roster on the site, funded by the treasury.
  const houseBefore = cash(HOUSE);
  const config = await bots.setBotConfig(ADMIN, { enabled: true, count: 3 }, NOW);
  assert.equal(config.count, 3);
  const roster = await bots.bots();
  assert.equal(roster.length, 3, "three players sat down");
  assert.ok(roster.every((bot) => bot.sol >= config.floor), "each with money to play with");
  assert.equal(houseBefore - cash(HOUSE), roster.reduce((sum, bot) => sum + bot.sol, 0), "every lamport came out of the treasury");
  assert.deepEqual(
    roster.map((bot) => bot.skill),
    ["rookie", "steady", "sharp"],
    "and they play at different levels",
  );
  assert.ok(roster.every((bot) => bot.name && !bot.name.startsWith("bot:")), "with names, like anybody else");

  // A seat nobody took: after a moment, one of them sits down.
  const seat = await startMatch(HUMAN, String(SOL / 20), "devnet");
  const matchId = sqlite.prepare("SELECT match_id FROM runs WHERE id = ?").get(seat.id).match_id;
  await bots.tickBots(NOW + 10_000);
  assert.equal(sqlite.prepare("SELECT p2 FROM matches WHERE id = ?").get(matchId).p2, null, "a fresh seat is left for a person first");
  const joined = await bots.tickBots(NOW + 120_000);
  assert.equal(joined.joined, 1, "then the house takes it");
  const opponent = sqlite.prepare("SELECT p2 FROM matches WHERE id = ?").get(matchId).p2;
  assert.ok(opponent?.startsWith("bot:"), `a bot took the seat, saw ${opponent}`);
  assert.equal(cash(opponent), await entryPaid(opponent, SOL / 20), "and paid the entry like everybody else");

  // It does not play the moment it sits down: the seat shows an opponent first.
  assert.equal(Number(sqlite.prepare("SELECT done FROM runs WHERE match_id = ? AND user_id = ?").get(matchId, opponent).done), 0, "a run takes time");
  await bots.tickBots(NOW + 20 * 60_000);
  const botRun = sqlite.prepare("SELECT done, score, revision FROM runs WHERE match_id = ? AND user_id = ?").get(matchId, opponent);
  assert.equal(Number(botRun.done), 1, "the run is played out");
  assert.ok(Number(botRun.score) > 0, "with a score on the board");
  const shots = Number(sqlite.prepare("SELECT COUNT(*) AS n FROM run_shots WHERE run_key = ?").get(`m-${sqlite.prepare("SELECT id FROM runs WHERE match_id = ? AND user_id = ?").get(matchId, opponent).id}`).n);
  assert.equal(shots, Number(botRun.revision), "every angle it took is kept, so the run replays like any other");

  // The human plays their side out: the match settles like any other.
  await playShot(HUMAN, seat.id, seat.revision, "forfeit");
  const settled = sqlite.prepare("SELECT settled, winner, fee FROM matches WHERE id = ?").get(matchId);
  assert.equal(Number(settled.settled), 1, "both runs in, so the match is paid");
  assert.equal(settled.winner, opponent, "the bot won it on points");
  assert.ok(Number(settled.fee) > 0, "and the house took its share of the pot, exactly as it would from two people");

  // Skill is not decoration: the sharp one out-scores the rookie over ten boards.
  // Ruleset 6 boards grow secret rows, so a comparison needs a key like any board.
  const key = (seed) => seed.toString(16).padStart(64, "7");
  const board = (skill, seed) => bots.playRun(seed, 6, key(seed), skill, seeded(seed)).game.score;
  let rookie = 0;
  let sharp = 0;
  for (let seed = 1; seed <= 10; seed++) {
    rookie += board("rookie", seed);
    sharp += board("sharp", seed);
  }
  assert.ok(sharp > rookie * 1.2, `a sharp bot scores better than a rookie, saw ${sharp} against ${rookie}`);

  // Tournaments: the button fills every seat that is left.
  const cupId = await createTournament(
    { name: "House Cup", asset: "devnet", entry: "paid", entryFee: "0.05", prize: "0", payout: "top3", places: 5, startsAt: NOW + 3 * 3_600_000, endsAt: NOW + 6 * 3_600_000 },
    NOW,
  );
  const filled = await bots.fillTournament(ADMIN, cupId, NOW);
  assert.equal(filled.filled, 3, "every bot free to play entered");
  assert.equal(Number(sqlite.prepare("SELECT COUNT(*) AS n FROM tournament_entries WHERE tournament_id = ?").get(cupId).n), 3);
  await assert.rejects(() => bots.fillTournament(ADMIN, "nope", NOW), /No such tournament/);

  // Their tournament run is played inside the window, not the moment it opens.
  // A cup that has started is still 'scheduled' in the table: live is the clock.
  run("UPDATE tournaments SET starts_at = ?, ends_at = ? WHERE id = ?", NOW, NOW + 3 * 3_600_000, cupId);
  assert.equal(sqlite.prepare("SELECT status FROM tournaments WHERE id = ?").get(cupId).status, "scheduled", "which is how the site stores a live one");
  await bots.tickBots(NOW + 60_000);
  assert.equal(Number(sqlite.prepare("SELECT COUNT(*) AS n FROM tournament_entries WHERE tournament_id = ? AND done = 1").get(cupId).n), 0, "nobody plays in the first minute");
  for (let i = 0; i < 4; i++) await bots.tickBots(NOW + 3 * 3_600_000 - 60_000);
  const played = Number(sqlite.prepare("SELECT COUNT(*) AS n FROM tournament_entries WHERE tournament_id = ? AND done = 1").get(cupId).n);
  assert.equal(played, 3, "by the end of the window every one of them has played");

  // The administrator's own button does not wait for anybody's pace.
  run("UPDATE tournament_entries SET done = 0, state = NULL, finished = NULL, score = 0, rank = NULL, payout = 0 WHERE tournament_id = ?", cupId);
  run("UPDATE tournaments SET status = 'scheduled', starts_at = ?, ends_at = ? WHERE id = ?", NOW, NOW + 3 * 3_600_000, cupId);
  assert.equal((await bots.botWork(NOW + 60_000)).cupRuns, 3, "three cup runs are waiting");
  const forced = await bots.tickBots(NOW + 60_000, { budget: 25, immediate: true });
  assert.equal(forced.played, 3, "and the button plays all three at once, a minute in");
  assert.equal((await bots.botWork(NOW + 60_000)).cupRuns, 0, "with nothing left owed");

  // A cup it owes a run to comes before a 1v1 seat.
  // The cup paid out when the last of them finished, so it is put back on.
  run("UPDATE tournament_entries SET done = 0, state = NULL, finished = NULL, score = 0, rank = NULL, payout = 0 WHERE tournament_id = ?", cupId);
  run("UPDATE tournaments SET status = 'scheduled', starts_at = ?, ends_at = ? WHERE id = ?", NOW, NOW + 3 * 3_600_000, cupId);
  const waiting = await startMatch(HUMAN, String(SOL / 20), "devnet");
  const waitingMatch = sqlite.prepare("SELECT match_id FROM runs WHERE id = ?").get(waiting.id).match_id;
  run("UPDATE matches SET created = ? WHERE id = ?", NOW - 5 * 60_000, waitingMatch);
  await bots.tickBots(NOW + 60_000);
  assert.equal(
    sqlite.prepare("SELECT p2 FROM matches WHERE id = ?").get(waitingMatch).p2,
    null,
    "with a cup run still owed, the seat is left alone",
  );
  await playShot(HUMAN, waiting.id, waiting.revision, "forfeit");

  // The switch really is one.
  await bots.setBotConfig(ADMIN, { enabled: false }, NOW);
  const quiet = await startMatch(HUMAN, String(SOL / 20), "devnet");
  const quietMatch = sqlite.prepare("SELECT match_id FROM runs WHERE id = ?").get(quiet.id).match_id;
  await bots.tickBots(NOW + 30 * 60_000);
  assert.equal(sqlite.prepare("SELECT p2 FROM matches WHERE id = ?").get(quietMatch).p2, null, "with the switch off, the seat stays open");

  // Launch day: they leave, and what the treasury lent comes back.
  await bots.setBotConfig(ADMIN, { enabled: true, count: 3 }, NOW);
  const beforeRetire = cash(HOUSE);
  const held = (await bots.bots()).reduce((sum, bot) => sum + bot.sol, 0);
  const gone = await bots.removeBots(ADMIN, NOW + 31 * 60_000);
  assert.equal(gone.retired, 3);
  assert.equal(gone.swept, held, "every lamport they were holding went home");
  assert.equal(cash(HOUSE) - beforeRetire, held);
  assert.equal((await bots.bots()).length, 0, "and none of them is on the site");
  assert.equal((await bots.botConfig()).enabled, false, "the switch is off behind them");
  assert.ok(
    sqlite.prepare("SELECT COUNT(*) AS n FROM matches WHERE p2 LIKE 'bot:%'").get().n > 0,
    "the matches they played stay, because they are their opponents' history too",
  );

  console.log("PASS: bots (off by default, funded by the treasury, taking open seats after a pause, playing through the engine with replayable shots, skill that shows, filling a cup on the button, stopping on the switch, and giving the treasury its money back at launch)");
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  close();
}

/** What a bot should be left with after paying one entry. */
async function entryPaid(uid, stake) {
  const funded = Number(sqlite.prepare("SELECT COALESCE(SUM(amount), 0) AS n FROM cash_ledger WHERE account_id = ? AND kind = 'bot_funding'").get(cashAccountId(uid)).n);
  return funded - stake;
}

/** The same dice the bots use, so the skill comparison is repeatable. */
function seeded(n) {
  let state = (n * 2654435761) % 2147483647 || 1;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}
