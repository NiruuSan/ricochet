import assert from "node:assert/strict";
import { createDatabase } from "./helpers/test-env.mjs";

// Cashback, the widened race, the daily cup and seasons: the four things that
// give a player a reason to come back, and the three of them that cost money.
//
// The one rule holding the cashback up is that it is a share of the fee the
// player funded, never of what they wagered — so the cost is bounded by the
// revenue it came from. The entry tiers are paid in gems, which cost nothing,
// and a period that has closed cannot be claimed twice or late.
Object.assign(process.env, {
  SOLANA_NETWORK: "devnet",
  SOLANA_RPC_URL: "https://rpc.invalid",
  SOLANA_VAULT_KEY: Buffer.alloc(32, 3).toString("base64"),
  RICOCHET_ADMIN_USER_ID: "github:admin",
});
const { sqlite, close } = await createDatabase();

const rewards = await import("../lib/rewards.ts");
const race = await import("../lib/weekly-race.ts");
const seasons = await import("../lib/seasons.ts");
const tournaments = await import("../lib/tournaments.ts");
const { cashAccountId, ensureCashAccount, HOUSE } = await import("../lib/payments/accounts.ts");
const { playerLevel } = await import("../lib/experience.ts");

const ANA = "github:ana";
const BEN = "github:ben";
const ADMIN = "github:admin";
const SOL = 1_000_000_000;
const WEEK = 7 * 86_400_000;
// A Wednesday, so "last week" is a whole week behind and the month has a past.
const NOW = Date.UTC(2026, 8, 23, 12);
const lastWeek = race.weekStart(NOW) - WEEK;
const gems = (uid) => sqlite.prepare("SELECT balance FROM players WHERE id = ?").get(uid).balance;
const cash = (owner) => Number(sqlite.prepare("SELECT balance FROM cash_accounts WHERE id = ?").get(cashAccountId(owner))?.balance ?? 0);
const count = (sql, ...args) => sqlite.prepare(sql).get(...args).n;

let match = 0;
/** A settled SOL match the player paid an entry for, at `at`. */
function played(uid, stake, at) {
  const id = `m${match++}`;
  sqlite.prepare("INSERT INTO matches(id, seed, stake, asset, p1, p2, settled, winner, fee, created, ruleset) VALUES(?, 1, ?, 'devnet', ?, ?, 1, ?, ?, ?, 6)")
    .run(id, stake, uid, BEN, uid, Math.floor((stake * 24) / 100), at);
  sqlite.prepare("INSERT INTO cash_ledger VALUES(?, ?, 'match_entry', ?, ?, ?)").run(`${id}:entry`, cashAccountId(uid), -stake, id, at);
  return id;
}

try {
  sqlite.prepare("INSERT INTO players(id, name, balance, created) VALUES(?, 'Ana', 0, 0)").run(ANA);
  sqlite.prepare("INSERT INTO players(id, name, balance, created) VALUES(?, 'Ben', 0, 0)").run(BEN);
  sqlite.prepare("INSERT INTO players(id, name, balance, created) VALUES(?, 'Admin', 0, 0)").run(ADMIN);
  sqlite.prepare("INSERT INTO players(id, name, balance, created) VALUES('github:dust', 'Dust', 0, 0)").run();
  await Promise.all([ensureCashAccount(ANA), ensureCashAccount(BEN), ensureCashAccount("github:dust"), ensureCashAccount(HOUSE)]);
  sqlite.prepare("INSERT INTO cash_ledger VALUES('house-float', ?, 'fixture', ?, 'fixture', 0)").run(cashAccountId(HOUSE), 50 * SOL);
  for (const [id, uid] of [["ana", ANA], ["ben", BEN], ["dust", "github:dust"]]) {
    sqlite.prepare("INSERT INTO cash_ledger VALUES(?, ?, 'fixture', ?, 'fixture', 0)").run(`${id}-float`, cashAccountId(uid), 500 * SOL);
  }

  // --- The grid -------------------------------------------------------------
  assert.equal(rewards.tierFor(0).share, 3, "Any play at all is worth something");
  assert.equal(rewards.tierFor(3 * SOL).name, "Regular");
  assert.equal(rewards.tierFor(30 * SOL).share, 9);
  assert.equal(rewards.tierFor(1_000 * SOL).share, 14, "And it stops climbing at the top tier");
  assert.ok(rewards.TIERS.filter((t) => t.gems).length === 2, "The two entry tiers are paid in gems, which cost nothing");

  // --- A small week: paid in gems, so the house pays nothing ----------------
  played(ANA, SOL / 2, lastWeek + 3_600_000);
  played(ANA, SOL / 2, lastWeek + 7_200_000);
  const small = await rewards.rewardFor(ANA, "weekly", NOW);
  assert.equal(small.asset, "gems", "A one-SOL week is an entry tier");
  assert.equal(small.volume, SOL, "It counts what was staked, not the pot");
  assert.equal(small.fees, Math.floor((SOL * 12) / 100), "And the fee is 12% of that");
  assert.equal(small.amount, Math.floor(Math.floor((small.fees * 5) / 100) / 20_000), "5% of the fee, in gems");
  const houseBefore = cash(HOUSE);
  await rewards.claimReward(ANA, "weekly", NOW);
  assert.equal(gems(ANA), small.amount, "The gems arrived");
  assert.equal(cash(HOUSE), houseBefore, "And the house paid nothing real for them");
  await assert.rejects(() => rewards.claimReward(ANA, "weekly", NOW), (e) => e.status === 409, "One claim per period");
  assert.equal(count("SELECT COUNT(*) AS n FROM reward_claims WHERE user_id = ?", ANA), 1);
  assert.equal((await rewards.rewardFor(ANA, "weekly", NOW)).claimed, true);

  // --- A big week: real SOL, out of the house ------------------------------
  for (let i = 0; i < 6; i++) played(BEN, 5 * SOL, lastWeek + i * 3_600_000);
  const big = await rewards.rewardFor(BEN, "weekly", NOW);
  assert.equal(big.asset, "devnet", "Thirty SOL of play is paid in SOL");
  assert.equal(big.share, 9);
  assert.equal(big.amount, Math.floor((Math.floor((30 * SOL * 12) / 100) * 9) / 100));
  const house = cash(HOUSE);
  const mine = cash(BEN);
  await rewards.claimReward(BEN, "weekly", NOW);
  assert.equal(cash(BEN) - mine, big.amount, "The player was paid");
  assert.equal(cash(HOUSE), house - big.amount, "By the house, exactly once");
  assert.equal(count("SELECT COUNT(*) AS n FROM cash_ledger WHERE kind = 'cashback'"), 2, "Both sides of it");

  // What the house keeps is still most of what it took.
  const fees = Math.floor((30 * SOL * 12) / 100);
  assert.ok(big.amount < fees / 5, "A cashback is a slice of the fee, never the fee");

  // --- What does not count --------------------------------------------------
  // A cancelled match is refunded in full, so it never earns cashback.
  const cancelled = played(ANA, 5 * SOL, lastWeek + 10_000);
  sqlite.prepare("UPDATE matches SET cancelled = 1 WHERE id = ?").run(cancelled);
  const after = await rewards.rewardFor(ANA, "weekly", NOW);
  assert.equal(after.volume, SOL, "The cancelled entry is not in the volume");
  // Nor is a week too small to bother with.
  played("github:dust", SOL / 50, lastWeek + 60_000);
  assert.equal(await rewards.rewardFor("github:dust", "weekly", NOW), null, "Dust earns no claim row");

  // --- The monthly bonus asks for weeks, not size --------------------------
  assert.equal(await rewards.rewardFor(BEN, "monthly", NOW), null, "One week of play is not a month of coming back");
  const month = rewards.monthStart(rewards.monthStart(NOW) - 1);
  for (const week of [0, 1, 2]) played(BEN, 10 * SOL, month + week * WEEK + 3_600_000);
  const monthly = await rewards.rewardFor(BEN, "monthly", NOW);
  assert.ok(monthly, "Three weeks in the month earns it");
  assert.equal(monthly.share, 4);
  assert.ok(monthly.amount > 0);

  // --- A closed account claims nothing -------------------------------------
  sqlite.prepare("INSERT INTO player_suspensions(user_id, status, source, reason, evidence, created, restricted) VALUES(?, 'suspended', 'proof', 'bot', '{}', 0, 0)").run(BEN);
  await assert.rejects(() => rewards.claimReward(BEN, "monthly", NOW), (e) => e.status === 403);
  sqlite.prepare("DELETE FROM player_suspensions WHERE user_id = ?").run(BEN);

  // --- The race pays past the podium, in gems ------------------------------
  assert.deepEqual(race.prizeFor(1, race.DEFAULT_PRIZES), race.DEFAULT_PRIZES[0]);
  assert.deepEqual(race.prizeFor(7, race.DEFAULT_PRIZES), { sol: 0, gems: 1_000 }, "Seventh place is worth something now");
  assert.deepEqual(race.prizeFor(40, race.DEFAULT_PRIZES), { sol: 0, gems: 250 });
  assert.equal(race.prizeFor(51, race.DEFAULT_PRIZES), null, "The board stops at fifty");
  assert.ok(race.TIERS.every((t) => t.gems > 0), "Every tier below the podium is gems, so the widening is free");

  // --- Seasons --------------------------------------------------------------
  seasons.forgetSeason();
  assert.deepEqual(await seasons.currentSeason(NOW), { number: 1, startedAt: 0 }, "Before anything is done, the season is all of time");
  const before = await playerLevel(BEN);
  assert.ok(before.xp > 0, "Ben has wagered a great deal");
  const second = await seasons.startSeason(ADMIN, NOW);
  assert.equal(second.number, 2);
  assert.equal(second.startedAt, NOW);
  assert.equal((await playerLevel(BEN, second.startedAt)).xp, 0, "A new season starts everyone at nothing");
  assert.equal((await playerLevel(BEN)).xp, before.xp, "While the career rank keeps it all");
  assert.equal(count("SELECT COUNT(*) AS n FROM admin_audit WHERE action = 'season_start'"), 1);

  // --- The daily cup ---------------------------------------------------------
  const made = await tournaments.ensureDailyTournaments(NOW);
  assert.ok(made.length >= 3, `the next few days are scheduled, got ${made.length}`);
  const cups = sqlite.prepare("SELECT name, entry_fee, starts_at, ends_at, payout, places FROM tournaments ORDER BY starts_at").all();
  assert.ok(cups.every((c) => c.entry_fee === 50_000_000), "A low entry, so a table fills");
  assert.ok(cups.every((c) => new Date(c.starts_at).getUTCHours() === tournaments.DAILY.hour), "Always the same hour");
  assert.ok(cups.every((c) => c.ends_at - c.starts_at === 3 * 60 * 60_000));
  assert.equal(new Set(cups.map((c) => c.starts_at)).size, cups.length, "One a day, never two");
  assert.equal((await tournaments.ensureDailyTournaments(NOW)).length, 0, "Running the sweep again changes nothing");
  // The house puts up nothing: the pot is the entries less the same 12%.
  assert.equal(count("SELECT COUNT(*) AS n FROM cash_ledger WHERE kind = 'tournament_funding'"), 0);

  console.log(
    "PASS: rewards (cashback as a share of the fee funded, entry tiers paid in gems at no cost to the house, SOL from the house above them, one claim per period, cancelled and dust excluded, a monthly bonus that asks for weeks rather than size, a closed account refused; race prizes past the podium in gems; seasons that reset the ladder and keep the career; and a daily cup the house pays nothing for).",
  );
} finally {
  close();
}
