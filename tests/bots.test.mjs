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
  assert.deepEqual(await bots.tickBots(NOW), { played: 0, entered: 0, joined: 0, more: false }, "nothing happens while they are off");

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
  const forced = await bots.tickBots(NOW + 60_000, { immediate: true });
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

  // And they can be put back on: turning them on again brings the same players,
  // under their own names, with the treasury funding them afresh.
  const back = await bots.setBotConfig(ADMIN, { enabled: true, count: 3 }, NOW + 32 * 60_000);
  assert.equal(back.count, 3);
  const again = await bots.bots();
  assert.deepEqual(
    again.map((bot) => bot.name),
    roster.map((bot) => bot.name),
    "the same three came back, named as they were",
  );
  assert.ok(again.every((bot) => bot.sol >= back.floor), "and funded again");

  // No roster of twenty: past the first names, every bot still gets a name of
  // its own that a player could have, and an id of its own.
  const names = Array.from({ length: bots.MAX_BOTS }, (_, i) => bots.botName(i));
  assert.equal(new Set(names.map((name) => name.toLowerCase())).size, bots.MAX_BOTS, "every place in the roster has its own name");
  assert.ok(names.every((name) => /^[a-zA-Z0-9_]{3,20}$/.test(name)), "and every one is a valid player name");
  assert.equal(new Set(names.map((_, i) => bots.botId(i))).size, bots.MAX_BOTS, "and its own id");
  assert.equal(bots.botName(0), "Bumper", "the first twenty keep the names they always had");

  // How much each one is given is the administrator's to set.
  const houseAt = cash(HOUSE);
  const wide = await bots.setBotConfig(ADMIN, { enabled: true, count: 30, topUp: 2 * SOL, floor: SOL / 4 }, NOW + 33 * 60_000);
  assert.equal(wide.count, 30, "thirty sit down: more than the old twenty");
  assert.equal(wide.topUp, 2 * SOL);
  const thirty = await bots.bots();
  assert.equal(thirty.length, 30);
  assert.ok(thirty.slice(20).every((bot) => !bot.name.startsWith("bot:") && bot.sol === 2 * SOL), "the new ones are named and given exactly the new amount");
  assert.equal(houseAt - cash(HOUSE), 27 * 2 * SOL, "and only the twenty-seven new wallets were paid for: the first three still hold more than the floor");
  assert.equal(thirty.find((bot) => bot.id === bots.botId(21)).skill, ["rookie", "steady", "sharp"][21 % 3], "a bot past twenty still plays at the skill its place gives it");

  // The button brings every bot up to a new amount, and only up.
  await bots.setBotConfig(ADMIN, { topUp: 3 * SOL }, NOW + 34 * 60_000);
  const beforeButton = cash(HOUSE);
  const topped = await bots.fundBots(NOW + 34 * 60_000, { everyone: true });
  assert.equal(topped.funded, 27, "the twenty-seven at two SOL were brought up; the three at five were left alone");
  assert.equal(topped.moved, 27 * SOL);
  assert.equal(beforeButton - cash(HOUSE), topped.moved, "and the treasury paid exactly that");
  assert.ok((await bots.bots()).every((bot) => bot.sol >= 3 * SOL));

  // An amount the treasury cannot cover: it pays nobody it cannot pay in full, and never goes below zero.
  await bots.setBotConfig(ADMIN, { topUp: 900 * SOL }, NOW + 35 * 60_000);
  const broke = await bots.fundBots(NOW + 35 * 60_000, { everyone: true });
  assert.ok(broke.unaffordable > 0, "the bots it cannot afford are counted, not paid");
  assert.ok(cash(HOUSE) >= 0, "and the treasury stays above zero");

  // Nonsense is held to sensible bounds: the floor never above the amount, nothing past the guards.
  const bounded = await bots.setBotConfig(ADMIN, { enabled: false, topUp: 2 * SOL, floor: 7 * SOL, count: 1e9 }, NOW + 36 * 60_000);
  assert.equal(bounded.floor, 2 * SOL, "a floor above the amount given is brought down to it");
  assert.equal(bounded.count, bots.MAX_BOTS, "and a count past the guard stops at it");
  assert.equal((await bots.setBotConfig(ADMIN, { topUp: 1e30, count: 30 }, NOW + 36 * 60_000)).topUp, bots.MAX_TOP_UP);
  assert.equal((await bots.setBotConfig(ADMIN, { topUp: -5 }, NOW + 36 * 60_000)).topUp, bots.MIN_TOP_UP);

  // The administrator's button has no cap: ten open seats, at every entry in
  // both currencies, are all taken in one press — an ordinary turn stops at
  // four — and the ten runs that makes are all played in the next, past the
  // eight an ordinary turn reads.
  // The seat left open while they were switched off is put away first, so every seat below is a new one.
  run("UPDATE matches SET settled = 1, cancelled = 1 WHERE settled = 0 AND p2 IS NULL");
  run("INSERT INTO cash_ledger VALUES('house-more', ?, 'fixture', ?, 'fixture', ?)", cashAccountId(HOUSE), 500 * SOL, NOW);
  await bots.setBotConfig(ADMIN, { enabled: true, count: 12, topUp: 11 * SOL, floor: 11 * SOL }, NOW + 40 * 60_000);
  const entries = [...[25, 50, 100, 500, 1000].map((stake) => ["gems", stake]), ...[0.05, 0.1, 1, 5, 10].map((stake) => ["devnet", stake * SOL])];
  for (const [i, [asset, stake]] of entries.entries()) {
    const uid = `github:seat${i}`;
    run("INSERT INTO players(id, name, balance, created) VALUES(?, ?, 5000, ?)", uid, `Seat${i}`, NOW - 9e8);
    if (asset === "devnet") {
      await ensureCashAccount(uid);
      run("INSERT INTO cash_ledger VALUES(?, ?, 'deposit', ?, 'fixture', ?)", `seat-${i}`, cashAccountId(uid), 20 * SOL, NOW - 9e8);
    }
    await startMatch(uid, String(stake), asset);
  }
  const openSeats = () => Number(sqlite.prepare("SELECT COUNT(*) AS n FROM matches WHERE settled = 0 AND p2 IS NULL AND p1 LIKE 'github:seat%'").get().n);
  assert.equal(openSeats(), 10, "ten seats open at once");
  const seated = await bots.tickBots(NOW + 41 * 60_000, { immediate: true });
  assert.equal(seated.joined, 10, "all ten taken in one press");
  assert.equal(openSeats(), 0);
  const playedOut = await bots.tickBots(NOW + 41 * 60_000, { immediate: true });
  assert.equal(playedOut.played, 10, "and all ten runs played in the next");
  assert.equal(playedOut.more, false, "with nothing left over");
  const ordinary = await bots.tickBots(NOW + 42 * 60_000);
  assert.ok(ordinary.played + ordinary.joined + ordinary.entered <= 3, "an ordinary turn, inside somebody's page load, still does only a little");
  // What does stop the button is the clock, and a turn out of time says there is more.
  const late = await bots.tickBots(NOW + 43 * 60_000, { immediate: true, seconds: -1 });
  assert.equal(late.more, true, "a turn with no time left says so, and the screen asks again");

  // Launch day with a hundred of them: two whose retired names used to clash
  // (KestrelMoth and KestrelMarten), a cup they all entered that has not
  // started, and a seat one of them took and has not played yet. One press
  // takes every one of them off; nothing they were part of is left hanging.
  run("INSERT INTO cash_ledger VALUES('house-launch', ?, 'fixture', ?, 'fixture', ?)", cashAccountId(HOUSE), 400 * SOL, NOW);
  await bots.setBotConfig(ADMIN, { enabled: true, count: 100, topUp: SOL, floor: SOL / 2 }, NOW + 50 * 60_000);
  const hundred = await bots.bots();
  assert.equal(hundred.length, 100, "a hundred on the site");
  assert.ok(hundred.some((bot) => bot.name === "KestrelMoth") && hundred.some((bot) => bot.name === "KestrelMarten"), "both Kestrels among them");
  const launchCup = await createTournament(
    { name: "Launch Cup", asset: "devnet", entry: "paid", entryFee: "0.05", prize: "0", payout: "top3", places: 200, startsAt: NOW + 6 * 3_600_000, endsAt: NOW + 9 * 3_600_000 },
    NOW + 50 * 60_000,
  );
  const entered = (await bots.fillTournament(ADMIN, launchCup, NOW + 50 * 60_000)).filled;
  assert.ok(entered > 90, `the cup filled with them, saw ${entered}`);
  const escrow = () => cash(`escrow:tournament:${launchCup}`);
  assert.equal(escrow(), entered * 0.05 * SOL);
  run("INSERT INTO players(id, name, balance, created) VALUES('github:launch', 'Launcher', 5000, ?)", NOW - 9e8);
  const launchSeat = await startMatch("github:launch", "25", "gems");
  await bots.tickBots(NOW + 51 * 60_000, { immediate: true });
  const launchMatch = sqlite.prepare("SELECT match_id FROM runs WHERE id = ?").get(launchSeat.id).match_id;
  const sitter = sqlite.prepare("SELECT p2 FROM matches WHERE id = ?").get(launchMatch).p2;
  assert.ok(sitter?.startsWith("bot:"), "a bot took the seat");
  assert.equal(Number(sqlite.prepare("SELECT done FROM runs WHERE match_id = ? AND user_id = ?").get(launchMatch, sitter).done), 0, "and has not played it yet");

  const houseBeforeLaunch = cash(HOUSE);
  const launch = await bots.removeBots(ADMIN, NOW + 52 * 60_000);
  assert.equal(launch.retired, 100, "every one of the hundred retired, in one press");
  assert.equal((await bots.bots()).length, 0, "none left on the site");
  assert.equal(launch.withdrawn, entered, "they gave back every place in the cup");
  assert.equal(Number(sqlite.prepare("SELECT COUNT(*) AS n FROM tournament_entries WHERE tournament_id = ?").get(launchCup).n), 0, "which is empty for people again");
  assert.equal(escrow(), 0, "with its escrow emptied");
  assert.ok(launch.ended >= 1, "the run nobody played was ended");
  assert.equal(Number(sqlite.prepare("SELECT done FROM runs WHERE match_id = ? AND user_id = ?").get(launchMatch, sitter).done), 1);
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) AS n FROM players WHERE bot = 1 AND deleted IS NOT NULL AND (name = 'retired_kestrelmoth' OR name = 'retired_kestrelmarten')").get().n,
    2,
    "and the two Kestrels retired under names of their own",
  );
  const left = Number(sqlite.prepare("SELECT COALESCE(SUM(a.balance), 0) AS n FROM cash_accounts a JOIN players p ON a.id = 'devnet:' || p.id WHERE p.bot = 1").get().n);
  assert.equal(left, 0, "no bot holds a lamport");
  assert.equal(cash(HOUSE) - houseBeforeLaunch, launch.swept, "everything they held, refunds included, went to the treasury");
  assert.equal((await bots.botConfig()).enabled, false);

  // The match settles when its person finishes; a draw hands the bot its entry
  // back, and the next press collects it from the retired wallet.
  await playShot("github:launch", launchSeat.id, launchSeat.revision, "forfeit");
  assert.equal(Number(sqlite.prepare("SELECT settled FROM matches WHERE id = ?").get(launchMatch).settled), 1, "the match settled");
  const again2 = await bots.removeBots(ADMIN, NOW + 53 * 60_000);
  assert.equal(again2.retired, 0, "a second press finds nobody left to retire");
  assert.equal(Number(sqlite.prepare("SELECT COALESCE(SUM(a.balance), 0) AS n FROM cash_accounts a JOIN players p ON a.id = 'devnet:' || p.id WHERE p.bot = 1").get().n), 0);

  console.log("PASS: bots (off by default, funded by the treasury, taking open seats after a pause, playing through the engine with replayable shots, skill that shows, filling a cup on the button, stopping on the switch, giving the treasury its money back at launch, a roster past twenty with names of their own, an amount per bot the administrator sets and the treasury can always refuse, a button with no cap on how much it plays, only a clock, and a hundred of them retired in one press, cup places and unplayed runs included)");
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
