import assert from "node:assert/strict";
import { createDatabase } from "./helpers/test-env.mjs";

Object.assign(process.env, { SOLANA_NETWORK: "devnet", SOLANA_RPC_URL: "https://rpc.invalid", SOLANA_VAULT_KEY: Buffer.alloc(32, 5).toString("base64") });

// Ranked play: a rating won and lost in every public SOL match.
//
// What has to hold is the arithmetic players are told about on the rules page —
// the favourite gains less and loses more, a rout counts more than a narrow
// result, a draw moves nobody — and everything that keeps the ladder honest:
// a result applied once, placements before a rank shows, the promotion shield,
// no RR for farming the same opponent, the house's players fixed in place,
// seats handed out by rank, a season that turns over without a job, decay at
// the top, and Bouncer as a place among the fifty best rather than a number.
const { sqlite, close } = await createDatabase();
const rules = await import("../lib/ranked-rules.ts");
const ranked = await import("../lib/ranked.ts");
const { rankFor } = await import("../lib/levels.ts");
const matches = await import("../lib/matches.ts");
const { cashAccountId, ensureCashAccount } = await import("../lib/payments/accounts.ts");
const { RANKED, ratingChange, withShield } = rules;

const SOL = 1_000_000_000;
const MIN = 60_000;
const DAY = 86_400_000;
const run = (sql, ...args) => sqlite.prepare(sql).run(...args);
const rating = (uid, season) => sqlite.prepare("SELECT * FROM ranked_ratings WHERE user_id = ? AND season = ?").get(uid, season);
const changes = (matchId) => sqlite.prepare("SELECT * FROM rating_changes WHERE match_id = ? ORDER BY user_id").all(matchId);

// Fixtures are played in season 3, whatever today's date: every call is given its clock.
const SEASON = 3;
const T = rules.seasonStart(SEASON) + 2 * DAY;
let made = 0;
const player = (id, { bot = 0 } = {}) => run("INSERT INTO players(id, name, balance, created, bot) VALUES(?, ?, 0, 0, ?)", id, id.split(":")[1], bot);
const placed = (id, value, { season = SEASON, games = 10, shield = 0, lastPlayed = T - DAY, placements = 5 } = {}) =>
  run("INSERT INTO ranked_ratings(user_id, season, rating, games, wins, placements, peak, shield, last_played, created) VALUES(?, ?, ?, ?, 0, ?, ?, ?, ?, 0)", id, season, value, games, placements, value, shield, lastPlayed);
/** A settled ranked match with these scores, then its rating update. */
const play = async (p1, p2, s1, s2, at) => {
  const id = `rm${++made}`;
  run(
    "INSERT INTO matches(id, seed, stake, asset, p1, p2, settled, winner, fee, created, ruleset, ranked) VALUES(?, 1, ?, 'devnet', ?, ?, 1, ?, 0, ?, 6, 1)",
    id,
    SOL / 10,
    p1,
    p2,
    s1 === s2 ? null : s1 > s2 ? p1 : p2,
    at,
  );
  run("INSERT INTO runs(id, match_id, user_id, state, score, done, created) VALUES(?, ?, ?, '{}', ?, 1, ?)", `${id}a`, id, p1, s1, at);
  run("INSERT INTO runs(id, match_id, user_id, state, score, done, created) VALUES(?, ?, ?, '{}', ?, 1, ?)", `${id}b`, id, p2, s2, at);
  await ranked.applyRankedResult(id, at);
  return id;
};

try {
  // --- The arithmetic -------------------------------------------------------
  assert.equal(rules.expectedScore(1000, 1000), 0.5);
  assert.ok(Math.abs(rules.expectedScore(1150, 950) + rules.expectedScore(950, 1150) - 1) < 1e-12, "One player's chance is the other's miss");
  const swing = (mine, theirs, score, other, placement = false) => ratingChange({ rating: mine, opponent: theirs, result: score > other ? 1 : score < other ? 0 : 0.5, score, opponentScore: other, placement });
  const even = swing(950, 950, 1000, 950);
  assert.equal(even, 16, "Level players, a narrow win: half of K");
  assert.equal(swing(950, 950, 950, 1000), -16, "and the loser drops as much");
  assert.equal(swing(950, 950, 1000, 400), 21, "A rout counts more");
  assert.equal(swing(950, 950, 400, 1000), -21);
  // Gold 3 against Gold 1: the favourite gains less and loses more.
  const favouriteWin = swing(1150, 950, 1000, 950);
  const favouriteLoss = swing(1150, 950, 950, 1000);
  assert.ok(favouriteWin < even && favouriteWin > 0, "The favourite gains less for winning");
  assert.ok(-favouriteLoss > even, "and loses more for losing");
  assert.equal(swing(950, 1150, 1000, 950), -favouriteLoss, "The underdog's win is the favourite's loss");
  assert.equal(swing(950, 1150, 950, 1000), -favouriteWin, "A match is zero-sum between two placed players");
  assert.equal(swing(950, 950, 500, 500), 0, "A draw moves nobody");
  assert.equal(swing(3000, 0, 1000, 999), 1, "A win is always worth a point");
  assert.equal(swing(0, 3000, 999, 1000), -1, "and a loss always costs one");
  assert.equal(swing(950, 950, 1000, 950, true), 33, "Placement matches count double");
  assert.equal(rules.scoreGap(0, 0), 0, "Two empty boards are a level result");
  assert.equal(rules.scoreGap(400, 40), rules.scoreGap(4000, 400), "The gap is relative, so small boards count as much as big ones");

  // The promotion shield: three losses that cannot take a player back out of a new division.
  assert.deepEqual(withShield(1090, 20, 0), { after: 1110, shield: RANKED.shield }, "A promotion arms it");
  assert.deepEqual(withShield(1110, 10, 2), { after: 1120, shield: 2 }, "A win keeps what is left");
  assert.deepEqual(withShield(1105, -30, 3), { after: 1100, shield: 2 }, "A loss stops at the division's floor");
  assert.deepEqual(withShield(1100, -30, 1), { after: 1100, shield: 0 });
  assert.deepEqual(withShield(1100, -30, 0), { after: 1070, shield: 0 }, "Then losses count in full");
  assert.deepEqual(withShield(10, -30, 0), { after: 0, shield: 0 }, "Nobody goes below zero");

  // Seasons, the soft reset and the widening seat.
  assert.equal(rules.seasonAt(RANKED.epoch), 1);
  assert.equal(rules.seasonAt(RANKED.epoch - DAY), 1, "Before the first season is the first season");
  assert.equal(rules.seasonAt(RANKED.epoch + RANKED.seasonMs - 1), 1);
  assert.equal(rules.seasonAt(RANKED.epoch + RANKED.seasonMs), 2, "Eight weeks a season");
  assert.equal(rules.seasonEnd(1), rules.seasonStart(2));
  assert.deepEqual([1750, 750, 350].map(rules.softReset), [1250, 750, 550], "Halfway back to the middle of Silver");
  assert.deepEqual([0, 14 * MIN, 15 * MIN, 59 * MIN, 60 * MIN].map(rules.tierReach), [1, 1, 2, 2, 6]);

  // How a rating reads.
  assert.deepEqual(rankFor(0), { tier: "iron", division: 1, name: "Iron 1", rating: 0, points: 0, placed: true, placementsLeft: 0, position: null, season: 1 });
  assert.equal(rankFor(RANKED.start).name, "Silver 2", "Everyone starts in the middle of Silver");
  assert.deepEqual([rankFor(1799).name, rankFor(1799).points], ["Diamond 3", 99]);
  assert.deepEqual([rankFor(2400).name, rankFor(2400).points], ["Diamond 3", 700], "Diamond 3 has no ceiling");
  assert.deepEqual([rankFor(1800, { bouncer: true, position: 4 }).name, rankFor(1800, { bouncer: true, position: 4 }).position], ["Bouncer", 4]);
  assert.equal(rankFor(900, { placementsLeft: 2 }).tier, "unranked", "No rank shows while being placed");

  // --- Which matches are ranked, through the real game ----------------------
  const EVE = "github:eve";
  const FAY = "github:fay";
  for (const id of [EVE, FAY]) {
    player(id);
    await ensureCashAccount(id);
    run("INSERT INTO cash_ledger VALUES(?, ?, 'deposit', ?, 'fixture', 0)", `${id}-cash`, cashAccountId(id), 10 * SOL);
  }
  assert.deepEqual(await ranked.rankOf(EVE), rankFor(RANKED.start, { placementsLeft: RANKED.placements, season: rules.seasonAt(Date.now()) }), "A newcomer is unranked, five placements to go");
  const opened = await matches.startMatch(EVE, String(SOL / 20), "devnet");
  const matchId = sqlite.prepare("SELECT match_id FROM runs WHERE id = ?").get(opened.id).match_id;
  assert.equal(sqlite.prepare("SELECT ranked FROM matches WHERE id = ?").get(matchId).ranked, 1, "A public SOL match is ranked");
  await matches.playShot(EVE, opened.id, opened.revision, "forfeit");
  const joined = await matches.startMatch(FAY, String(SOL / 20), "devnet");
  assert.equal(sqlite.prepare("SELECT match_id FROM runs WHERE id = ?").get(joined.id).match_id, matchId, "Two newcomers meet");
  await matches.playShot(FAY, joined.id, joined.revision, "forfeit");
  assert.equal(changes(matchId).length, 2, "Settling the match moved both ratings");
  const recap = await matches.matchRecap(EVE, matchId);
  assert.equal(recap.ranked, true);
  assert.deepEqual([recap.ratingChange.delta, recap.ratingChange.placement, recap.ratingChange.rankAfter.placementsLeft], [0, true, 4], "A draw: nothing won, one placement played");
  assert.equal((await ranked.rankOf(EVE)).placementsLeft, 4);

  const challenge = await matches.createChallenge(EVE, String(SOL / 20), "devnet");
  assert.equal(sqlite.prepare("SELECT m.ranked FROM matches m JOIN runs r ON r.match_id = m.id WHERE r.id = ?").get(challenge.id).ranked, 0, "A challenge between friends is not");
  await matches.playShot(EVE, challenge.id, challenge.revision, "forfeit");
  run("UPDATE players SET balance = 1000 WHERE id = ?", FAY);
  const gems = await matches.startMatch(FAY, "100", "gems");
  assert.equal(sqlite.prepare("SELECT m.ranked FROM matches m JOIN runs r ON r.match_id = m.id WHERE r.id = ?").get(gems.id).ranked, 0, "and neither is a gem match");
  await matches.playShot(FAY, gems.id, gems.revision, "forfeit");

  // Seats go by rank: a Diamond does not sit down at an Iron's board.
  const GIL = "github:gil";
  const HUGO = "github:hugo";
  const season = rules.seasonAt(Date.now());
  for (const [id, value] of [[GIL, 50], [HUGO, 1600]]) {
    player(id);
    await ensureCashAccount(id);
    run("INSERT INTO cash_ledger VALUES(?, ?, 'deposit', ?, 'fixture', 0)", `${id}-cash`, cashAccountId(id), 10 * SOL);
    placed(id, value, { season });
  }
  const ironSeat = await matches.startMatch(GIL, String(SOL / 10), "devnet");
  const diamondSeat = await matches.startMatch(HUGO, String(SOL / 10), "devnet");
  const seatOf = (r) => sqlite.prepare("SELECT match_id FROM runs WHERE id = ?").get(r.id).match_id;
  assert.notEqual(seatOf(diamondSeat), seatOf(ironSeat), "Five tiers apart: the Diamond opens a board of their own");

  // --- Placement, once, and the limit on farming one opponent ---------------
  const ANN = "github:ann";
  const BEN = "github:ben";
  for (const id of [ANN, BEN]) player(id);
  const first = await play(ANN, BEN, 1000, 950, T);
  assert.deepEqual(
    changes(first).map((c) => [c.user_id, c.before, c.after, c.delta]),
    [
      [ANN, 750, 783, 33],
      [BEN, 750, 717, -33],
    ],
    "Two newcomers, a narrow result: double K while being placed",
  );
  await ranked.applyRankedResult(first, T + 1000);
  assert.equal(rating(ANN, SEASON).rating, 783, "A result is applied once");
  assert.equal(rating(ANN, SEASON).games, 1);
  const second = await play(BEN, ANN, 900, 1000, T + MIN);
  const third = await play(ANN, BEN, 1000, 100, T + 2 * MIN);
  assert.equal(changes(second)[0].unrated, null, "The second match against the same player still counts");
  assert.deepEqual(
    changes(third).map((c) => [c.delta, c.unrated]),
    [
      [0, "repeat"],
      [0, "repeat"],
    ],
    "The third in a day moves nothing",
  );
  assert.equal((await ranked.ratingChangeFor(third, ANN)).unrated, "repeat");
  assert.equal(rating(ANN, SEASON).games, 3, "but it is still a game played");
  const later = await play(ANN, BEN, 1000, 950, T + DAY + 3 * MIN);
  assert.notEqual(changes(later)[0].delta, 0, "A day later they can meet again");

  // The fifth game places the player and shows the rank.
  const CAT = "github:cat";
  player(CAT);
  const fifth = await play(ANN, CAT, 1000, 900, T + DAY + 4 * MIN);
  const reveal = await ranked.ratingChangeFor(fifth, ANN);
  assert.deepEqual([reveal.placement, reveal.rankBefore.placed, reveal.rankAfter.placed], [true, false, true], "The last placement reveals the rank");
  const annNow = await ranked.rankOf(ANN, T + DAY + 5 * MIN);
  assert.equal(annNow.placed, true);
  assert.equal(annNow.rating, rating(ANN, SEASON).rating);
  const sixth = await play(ANN, CAT, 1000, 950, T + DAY + 6 * MIN);
  assert.equal(Math.abs(changes(sixth).find((c) => c.user_id === ANN).delta) < 33, true, "After placement, single K");
  assert.equal(changes(sixth).find((c) => c.user_id === CAT).delta < -16, true, "CAT, still being placed, counts double");

  // --- The shield, in the database -------------------------------------------
  const GUS = "github:gus";
  const HAL = "github:hal";
  const IVY = "github:ivy";
  for (const id of [GUS, HAL, IVY]) player(id);
  placed(GUS, 1090);
  placed(HAL, 1090);
  placed(IVY, 1300);
  await play(GUS, HAL, 1000, 950, T + 2 * DAY);
  assert.deepEqual([rating(GUS, SEASON).rating, rating(GUS, SEASON).shield], [1106, RANKED.shield], "Gold 3 reached, the shield armed");
  await play(IVY, GUS, 1000, 100, T + 2 * DAY + MIN);
  assert.deepEqual([rating(GUS, SEASON).rating, rating(GUS, SEASON).shield], [1100, RANKED.shield - 1], "A loss stops at Gold 3's floor");
  // A placed player's result reads as ranked, whatever came before the ratings were recorded.
  const promoted = (await ranked.ratingChangeFor(sqlite.prepare("SELECT match_id FROM rating_changes WHERE user_id = ? ORDER BY rowid LIMIT 1").get(GUS).match_id, GUS));
  assert.deepEqual([promoted.placement, promoted.rankBefore.name, promoted.rankAfter.name], [false, "Gold 2", "Gold 3"], "The promotion shows as one");

  // --- The house's players: a fixed rating by skill ---------------------------
  const BOT = "bot:sharp-one";
  player(BOT, { bot: 1 });
  await ranked.setBotRatings([{ id: BOT, skill: "sharp" }], T);
  assert.deepEqual([rating(BOT, SEASON).rating, rating(BOT, SEASON).placements], [RANKED.bots.sharp, 0]);
  const versusBot = await play(IVY, BOT, 100, 1000, T + 3 * DAY);
  assert.deepEqual(changes(versusBot).map((c) => c.user_id), [IVY], "Only the person's rating moves");
  assert.equal(rating(BOT, SEASON).rating, RANKED.bots.sharp, "the house's player holds still");
  assert.ok(rating(IVY, SEASON).rating < 1300, "and losing to it costs the person as anyone would");
  assert.deepEqual([400, 900, 1500].map(ranked.botSkillFor), ["rookie", "steady", "sharp"], "A bot is chosen to suit the seat");

  // --- Seats by rank, widening with age --------------------------------------
  const JO = "github:jo";
  const KAI = "github:kai";
  const LOU = "github:lou";
  for (const id of [JO, KAI, LOU]) player(id);
  placed(JO, 1000); // Gold
  placed(KAI, 150); // Iron
  placed(LOU, 1250); // Platinum
  const seats = [
    { id: "iron-seat", p1: KAI, created: T - 20 * MIN },
    { id: "plat-seat", p1: LOU, created: T - MIN },
  ];
  assert.equal((await ranked.eligibleSeat(JO, seats, T)).id, "plat-seat", "One tier away is a fair match; three is not, after twenty minutes");
  assert.equal((await ranked.eligibleSeat(JO, seats, T + 50 * MIN)).id, "iron-seat", "After an hour, anyone may take it, oldest first");
  assert.equal(await ranked.eligibleSeat(JO, seats.slice(0, 1), T), null, "Nothing fair is waiting: open a seat");

  // --- Decay at the top ---------------------------------------------------------
  const MIA = "github:mia";
  const NED = "github:ned";
  const OLA = "github:ola";
  const PIP = "github:pip";
  for (const id of [MIA, NED, OLA, PIP]) player(id);
  placed(MIA, 1650, { lastPlayed: T - 15 * DAY });
  placed(NED, 1510, { lastPlayed: T - 15 * DAY });
  placed(OLA, 1400, { lastPlayed: T - 15 * DAY });
  placed(PIP, 1650, { lastPlayed: T - DAY });
  await ranked.decayInactive(T);
  assert.deepEqual([MIA, NED, OLA, PIP].map((id) => rating(id, SEASON).rating), [1625, 1500, 1400, 1650], "Idle Diamonds lose RR down to Diamond 1; Platinum and active players keep theirs");
  await ranked.decayInactive(T + 3_600_000);
  assert.equal(rating(MIA, SEASON).rating, 1625, "Once a day");
  await ranked.decayInactive(T + DAY);
  assert.equal(rating(MIA, SEASON).rating, 1600);
  await play(MIA, PIP, 1000, 950, T + DAY + MIN);
  await ranked.decayInactive(T + 2 * DAY);
  assert.ok(rating(MIA, SEASON).rating > 1600, "Playing again stops it");

  // --- A new season, made on first need -----------------------------------------
  const QUIN = "github:quin";
  const ROY = "github:roy";
  for (const id of [QUIN, ROY]) player(id);
  placed(QUIN, 1450, { season: SEASON, games: 20 });
  placed(ROY, 1700, { season: SEASON - 1, games: 30 });
  const next = rules.seasonStart(SEASON + 1) + 3_600_000;
  const quin = await ranked.rankOf(QUIN, next);
  assert.deepEqual([quin.tier, quin.placementsLeft, quin.rating, quin.season], ["unranked", RANKED.returningPlacements, 1100, SEASON + 1], "Three placements, from halfway back to the start");
  assert.equal(rating(QUIN, SEASON + 1), undefined, "Reading a rank writes nothing");
  assert.equal((await ranked.seasonRow(QUIN, next)).rating, 1100);
  assert.equal(rating(QUIN, SEASON).rating, 1450, "Last season's record is kept");
  assert.deepEqual([(await ranked.rankOf(ROY, T)).placementsLeft, (await ranked.rankOf(ROY, T)).rating], [RANKED.returningPlacements, 1225], "A season skipped starts from the last one played");

  // --- Bouncer: a place, not a number ---------------------------------------------
  const top = Array.from({ length: RANKED.bouncers + 2 }, (_, i) => `github:top${String(i + 1).padStart(2, "0")}`);
  for (const [i, id] of top.entries()) {
    player(id);
    placed(id, 2100 - i * 5);
  }
  const SAM = "github:sam";
  player(SAM);
  placed(SAM, 1690); // Diamond 3, too low for Bouncer whatever the place
  const UNPLACED = "github:una";
  player(UNPLACED);
  placed(UNPLACED, 3000, { games: 2 });
  run("UPDATE ranked_ratings SET rating = 2500 WHERE user_id = ? AND season = ?", BOT, SEASON); // above everyone, and still not on the table
  const at = T + 5 * DAY; // past the half-minute the top fifty is kept
  const board = await ranked.seasonStandings(top[3], at, undefined);
  assert.equal(board.standings.length, RANKED.bouncers, "The table is the best fifty");
  assert.equal(board.standings[0].name, "top01", "best first");
  assert.ok(board.standings.every((s) => s.rank.tier === "bouncer"), "all of them Bouncers here, at 1,700 RR or more");
  assert.deepEqual(board.standings.slice(0, 3).map((s) => s.rank.position), [1, 2, 3]);
  assert.ok(!board.standings.some((s) => s.name === "una" || s.name === "sharp-one"), "Players still being placed and the house's players are left out");
  assert.equal(board.you.name, "top04");
  assert.ok(!JSON.stringify(board).includes("github:"), "Names, never ids");
  const fiftyFirst = await ranked.rankOf(top[RANKED.bouncers], at);
  assert.deepEqual([fiftyFirst.tier, fiftyFirst.division, fiftyFirst.position], ["diamond", 3, null], "The fifty-first is Diamond 3, however high");
  const bouncerOne = await ranked.rankOf(top[0], at);
  assert.deepEqual([bouncerOne.tier, bouncerOne.position], ["bouncer", 1]);
  const spread = await ranked.rankDistribution(at);
  assert.equal(spread.bouncers, RANKED.bouncers);
  assert.equal(spread.divisions.reduce((a, b) => a + b, 0) + spread.bouncers, spread.placed, "Every placed player is counted once");
  assert.ok(spread.unranked >= 1);

  console.log(
    "PASS: ranked (Elo with the favourite gaining less and losing more, score margin, draws, the one-point floor, double K in placement, zero-sum between placed players; shield, seasons, soft reset and widening reach; public SOL matches ranked, challenges and gems not, settlement moving both ratings once; seats by rank; placement reveal; the repeat limit; the house's players fixed; decay above Diamond 1, once a day; a new season made on first need; Bouncer as the top fifty at 1,700 RR, names only).",
  );
} finally {
  close();
}
