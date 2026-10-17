import assert from "node:assert/strict";
import { createDatabase } from "./helpers/test-env.mjs";

// Badges and the beta survey. Badges: given and taken back by the
// administrator, one player or everyone at once, told to the player, written to
// the audit log, shown on profiles and leaderboards, and opening the Blueprint
// theme. The survey: asked after the fifth finished game, answered once, checked
// on the way in, read by the administrator as a net promoter score with every
// comment, and carried away with the player's data.
Object.assign(process.env, { SOLANA_NETWORK: "devnet", SOLANA_RPC_URL: "https://rpc.invalid", SOLANA_VAULT_KEY: Buffer.alloc(32, 8).toString("base64") });
const { sqlite, close } = await createDatabase();
globalThis.fetch = async () => {
  throw new Error("Badges and surveys must not touch the network");
};
const admin = await import("../lib/badge-admin.ts");
const { badgesFor, badgesOf } = await import("../lib/player-badges.ts");
const survey = await import("../lib/survey.ts");
const { publicProfile } = await import("../lib/public-profile.ts");
const { themeInventory } = await import("../lib/theme-store.ts");
const { exportAccount, deleteAccount } = await import("../lib/account.ts");

const ADMIN = "github:boss";
const NOW = Date.UTC(2026, 9, 17, 12);
const run = (sql, ...args) => sqlite.prepare(sql).run(...args);
const count = (sql, ...args) => Number(sqlite.prepare(sql).get(...args).n);

try {
  for (const [id, name, bot] of [[ADMIN, "Boss", 0], ["github:ann", "Ann", 0], ["github:ben", "Ben", 0], ["github:cat", "Cat", 0], ["bot:one", "HouseOne", 1]]) {
    run("INSERT INTO players(id, name, balance, created, bot) VALUES(?, ?, 0, 0, ?)", id, name, bot);
  }

  // --- Badges ------------------------------------------------------------------
  await assert.rejects(() => admin.grantBadge(ADMIN, "Ann", "gold-star", NOW), /Choose a badge/);
  await assert.rejects(() => admin.grantBadge(ADMIN, "Nobody", "beta", NOW), (e) => e.status === 404);
  assert.deepEqual(await admin.grantBadge(ADMIN, "ann", "founder", NOW), { name: "Ann", badge: "founder" }, "Names are found whatever their case");
  await assert.rejects(() => admin.grantBadge(ADMIN, "Ann", "founder", NOW), (e) => e.status === 409, "Once is enough");
  assert.equal(count("SELECT COUNT(*) AS n FROM notifications WHERE user_id = 'github:ann' AND kind = 'badge_granted'"), 1, "Ann is told, once");
  assert.equal(count("SELECT COUNT(*) AS n FROM admin_audit WHERE action = 'badge.grant'"), 1, "and it is on the record");
  assert.ok((await themeInventory("github:ann")).owned.includes("blueprint"), "The badge opens Blueprint");

  // Everyone at once: people, not the house's players; nobody told twice.
  await admin.grantBadge(ADMIN, "Ben", "beta", NOW);
  const all = await admin.grantToEveryone(ADMIN, "beta", NOW + 1000);
  assert.equal(all.granted, 3, "Boss, Ann and Cat: Ben had it already, and bots are left out");
  assert.equal(count("SELECT COUNT(*) AS n FROM player_badges WHERE user_id = 'bot:one'"), 0);
  assert.equal(count("SELECT COUNT(*) AS n FROM notifications WHERE user_id = 'github:ben' AND kind = 'badge_granted'"), 1, "Ben is not told twice");
  assert.equal((await admin.grantToEveryone(ADMIN, "beta", NOW + 2000)).granted, 0, "A second press gives nothing");
  assert.deepEqual(await badgesOf("github:ann"), ["founder", "beta"], "Rarest first");
  const map = await badgesFor(["github:ann", "github:cat", "nobody"]);
  assert.deepEqual([map.get("github:cat"), map.has("nobody")], [["beta"], false]);

  // Shown where others look: the public profile (names only, no ids).
  const profile = await publicProfile("Ann", "github:cat");
  assert.deepEqual(profile.badges, ["founder", "beta"]);
  const roster = await admin.badgeRoster();
  assert.deepEqual(roster.counts, { founder: 1, beta: 4 });
  assert.equal(roster.players, 4, "Four people on the register");
  assert.ok(!JSON.stringify(roster).includes("github:"), "The roster holds names, never ids");

  // Taken back: the theme goes with it.
  await admin.revokeBadge(ADMIN, "Cat", "beta", NOW + 3000);
  assert.deepEqual(await badgesOf("github:cat"), []);
  assert.ok(!(await themeInventory("github:cat")).owned.includes("blueprint"));
  await assert.rejects(() => admin.revokeBadge(ADMIN, "Cat", "beta", NOW), (e) => e.status === 404);

  // --- The survey -----------------------------------------------------------------
  const play = (uid, n, offset = 0) => {
    for (let i = 0; i < n; i++) {
      const id = `${uid}-${offset + i}`;
      run("INSERT INTO matches(id, seed, stake, asset, p1, settled, created, ruleset) VALUES(?, 1, 100, 'gems', ?, 1, 0, 6)", id, uid);
      run("INSERT INTO runs(id, match_id, user_id, state, score, done, created) VALUES(?, ?, ?, '{}', 10, 1, 0)", `r-${id}`, id, uid);
    }
  };
  play("github:ann", 4);
  assert.equal(await survey.surveyDue("github:ann"), null, "Not before the fifth game");
  await assert.rejects(() => survey.submitSurvey("github:ann", { survey: "beta-1", score: 9 }, NOW), (e) => e.status === 409);
  play("github:ann", 1, 4);
  assert.deepEqual(await survey.surveyDue("github:ann"), { id: "beta-1" }, "Asked after the fifth");
  // A tournament run counts as a game too.
  play("github:ben", 4);
  run("INSERT INTO tournaments(id, name, asset, entry_fee, prize, payout, places, seed, ruleset, starts_at, ends_at, status, created) VALUES('cup', 'Cup', 'gems', 0, 0, 'top3', 8, 1, 6, 0, 1, 'settled', 0)");
  run("INSERT INTO tournament_entries(id, tournament_id, user_id, registered, done) VALUES('e1', 'cup', 'github:ben', 0, 1)");
  assert.deepEqual(await survey.surveyDue("github:ben"), { id: "beta-1" });

  for (const [input, why] of [
    [{ survey: "other", score: 5 }, /closed/],
    [{ survey: "beta-1", score: 11 }, /0 to 10/],
    [{ survey: "beta-1", score: -1 }, /0 to 10/],
    [{ survey: "beta-1", score: 4.5 }, /0 to 10/],
    [{ survey: "beta-1", score: 6, answer: "x".repeat(1001) }, /under 1,000/],
  ]) {
    await assert.rejects(() => survey.submitSurvey("github:ann", input, NOW), why);
  }
  await survey.submitSurvey("github:ann", { survey: "beta-1", score: 10, answer: "  More tournaments\r\nat night, please  " }, NOW);
  await assert.rejects(() => survey.submitSurvey("github:ann", { survey: "beta-1", score: 2 }, NOW), (e) => e.status === 409, "Answered once");
  assert.equal(await survey.surveyDue("github:ann"), null, "and never asked again");
  await survey.submitSurvey("github:ben", { survey: "beta-1", score: 3, answer: "Matchmaking was slow" }, NOW + 1000);
  play("github:cat", 6);
  await survey.submitSurvey("github:cat", { survey: "beta-1", score: 8 }, NOW + 2000);

  const results = await survey.surveyResults();
  assert.equal(results.responses, 3);
  assert.equal(results.eligible, 3, "Three players past the fifth game");
  assert.equal(results.nps, 0, "One promoter, one detractor, one passive: a score of 0");
  assert.equal(results.average, 7);
  assert.deepEqual([results.scores[10], results.scores[3], results.scores[8]], [1, 1, 1]);
  assert.deepEqual(results.comments.map((c) => [c.name, c.score, c.answer]), [["Ben", 3, "Matchmaking was slow"], ["Ann", 10, "More tournaments\nat night, please"]], "Comments, newest first, line breaks made plain; a score alone adds none");
  assert.ok(!JSON.stringify(results).includes("github:"), "Names, never ids");

  // --- The player's own data -------------------------------------------------------
  const data = await exportAccount("github:ann", NOW);
  assert.deepEqual(data.badges.map((b) => b.badge), ["founder", "beta"], "Badges are in the export");
  assert.deepEqual(data.surveyAnswers.map((a) => a.score), [10], "and the survey answer");
  await deleteAccount("github:ann", NOW + 5000);
  assert.equal(count("SELECT COUNT(*) AS n FROM player_badges WHERE user_id = 'github:ann'"), 0, "Both go with the account");
  assert.equal(count("SELECT COUNT(*) AS n FROM survey_responses WHERE user_id = 'github:ann'"), 0);

  console.log(
    "PASS: badges and survey (badges given once by name, to everyone but the house in one press, told and audited, rarest first, on profiles, opening Blueprint and taken back with it; the survey due after the fifth game or tournament run, validated, answered once, scored as NPS with named comments newest first, exported and deleted with the account).",
  );
} finally {
  close();
}
