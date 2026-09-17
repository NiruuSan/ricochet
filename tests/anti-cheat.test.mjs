import assert from "node:assert/strict";
import { createDatabase } from "./helpers/test-env.mjs";

// Anti-cheat: detection rules, automatic sanctions on proof (lost matches,
// disqualified tournament runs, suspension), statistical review, enforcement,
// and the administrator's decisions.
Object.assign(process.env, {
  RICOCHET_ADMIN_USER_ID: "admin-user",
  SOLANA_NETWORK: "devnet",
  SOLANA_RPC_URL: "https://rpc.invalid",
  SOLANA_VAULT_KEY: Buffer.alloc(32, 9).toString("base64"),
});
const { sqlite, close } = await createDatabase();
globalThis.fetch = async () => {
  throw new Error("Anti-cheat code must not touch the network");
};

const rules = await import("../lib/anti-cheat-rules.ts");
const antiCheat = await import("../lib/anti-cheat.ts");
const admin = await import("../lib/anti-cheat-admin.ts");
const matches = await import("../lib/matches.ts");
const race = await import("../lib/weekly-race.ts");
const { cashAccountId, ensureCashAccount, HOUSE } = await import("../lib/payments/accounts.ts");
const tips = await import("../lib/payments/tips.ts");
const service = await import("../lib/payments/service.ts");
const { shotKeyFor, signReport } = await import("../lib/shot-key.ts");

const SOL = 1_000_000_000;
const human = (extra = {}) => ({ v: 2, aimMs: 1800, inputs: 25, trusted: true, webdriver: false, build: rules.CLIENT_BUILD, flags: 0, synthetic: 0, sig: "0".repeat(64), ...extra });
/** A shot guard signed like the official client signs it; `tamper` edits the report after signing. */
const signed = (run, angle, { extra = {}, aim = [[0, 90], [600, angle]], tamper = {}, defer } = {}) => {
  const runKey = run.id.startsWith("t:") ? `t-${run.id.slice(2)}` : `m-${run.id}`;
  const proof = human(extra);
  proof.sig = signReport(shotKeyFor(runKey), rules.reportMessage({ runKey, revision: run.revision, angle, proof, aim }));
  const parsedAim = rules.parseAim(aim);
  return { proof: { ...proof, ...tamper }, aim: parsedAim, signedAim: aim, defer };
};

try {
  // --- Rules ---------------------------------------------------------------
  assert.equal(rules.parseProof(undefined), null, "A shot without a report is from an outdated client");
  assert.equal(rules.parseProof({ v: 1, aimMs: -1, inputs: 0, trusted: true, webdriver: false }), null);
  assert.deepEqual(rules.parseProof(human()), human());
  assert.equal(rules.parseProof({ ...human(), v: 1 }), null, "The first report format is outdated");
  assert.equal(rules.parseProof({ ...human(), sig: "abc" }), null, "An unsigned report is outdated");
  assert.equal(rules.parseProof({ ...human(), inputs: 1.5 }), null, "Signed values are never rounded");
  const inspect = (over) => rules.inspectShot({ proof: human(), signed: true, ruleset: 6, now: 10_000, previousShotAt: null, previousTicks: null, timingStrikes: 0, ...over });
  assert.deepEqual(inspect({}), [], "A normal shot raises nothing");
  assert.deepEqual(inspect({ proof: human({ webdriver: true }) }).map((f) => [f.kind, f.level]), [["automation_browser", "proof"]]);
  assert.deepEqual(inspect({ proof: human({ trusted: false }) }).map((f) => [f.kind, f.level]), [["synthetic_input", "proof"]]);
  assert.deepEqual(inspect({ signed: false }).map((f) => [f.kind, f.level]), [["forged_report", "proof"]], "A rewritten report is proof");
  assert.deepEqual(inspect({ proof: human({ synthetic: 2 }) }), [], "A couple of stray synthetic events are tolerated");
  assert.deepEqual(inspect({ proof: human({ synthetic: 12 }) }).map((f) => [f.kind, f.level]), [["synthetic_aim", "proof"]]);
  assert.deepEqual(inspect({ proof: human({ flags: 3 }) }).map((f) => [f.kind, f.level, f.detail.replaced.join()]), [["tampered_client", "watch", "fetchPatched,dispatchPatched"]], "A replaced page function is only watched");

  // Shot quality and its thresholds.
  assert.equal(rules.qualityPercentile(10, [1, 5, 10, 10]), 1, "Nothing better: top percentile");
  assert.equal(rules.qualityPercentile(5, [1, 5, 10, 10]), 0.5);
  assert.equal(rules.qualityThreshold([0.7, 0.8]), rules.QUALITY.absoluteMean, "Too few players: the absolute threshold");
  const crowd = Array.from({ length: 100 }, (_, i) => 0.6 + i * 0.002);
  assert.equal(rules.qualityThreshold(crowd), rules.QUALITY.floorMean, "A weak population never lowers the bar under the floor");
  const strong = Array.from({ length: 100 }, (_, i) => 0.8 + i * 0.001);
  assert.equal(rules.qualityThreshold(strong), 0.899, "A strong population raises the bar to its 99th percentile");
  assert.deepEqual(rules.evaluateQuality(Array(59).fill(0.95), 0.85), [], "Too few shots");
  assert.deepEqual(rules.evaluateQuality(Array(80).fill(0.78), 0.85), [], "A careful player");
  assert.equal(rules.evaluateQuality(Array(80).fill(0.9), 0.85)[0].kind, "superhuman_quality");
  const board = (bricks, extra = {}) => ({ seed: 1, round: 5, score: 10, balls: 5, x: 200, bricks, over: false, bonus: false, ...extra });
  const before = board([]);
  assert.ok(rules.boardValue(before, board([{ col: 0, row: 2, hp: 5 }], { score: 20 })) < rules.boardValue(before, board([{ col: 0, row: 6, hp: 5 }], { score: 18 })), "Bricks near the ground cost more than a few points");
  assert.equal(rules.boardValue(before, board([], { over: true })), -10_000);

  // Results trend: a sudden jump is watched, steady strength is not.
  const matchesOf = (n, rate, score) => Array.from({ length: n }, (_, i) => ({ won: i < n * rate, score }));
  assert.deepEqual(rules.evaluateTrend([...matchesOf(20, 0.6, 500), ...matchesOf(40, 0.6, 480)]), []);
  assert.equal(rules.evaluateTrend([...matchesOf(20, 0.85, 500), ...matchesOf(40, 0.3, 450)])[0].level, "watch");
  assert.equal(rules.evaluateTrend([...matchesOf(20, 0.5, 1500), ...matchesOf(40, 0.5, 400)])[0].kind, "sudden_improvement");
  assert.deepEqual(rules.evaluateTrend(matchesOf(30, 1, 900)), [], "Not enough history");

  // Aim trail shape.
  assert.deepEqual(rules.aimFeatures([[0, 90], [100, 80], [200, 70], [300, 75], [400, 74.9], [500, 70]]), { samples: 6, durationMs: 500, reversals: 2, gapCv: 0 });
  // 1,080 ticks animate for at least 3 s at 3× speed; a next shot 1 s later is impossible.
  assert.deepEqual(inspect({ previousShotAt: 9_000, previousTicks: 1_080 }).map((f) => [f.kind, f.level]), [["timing", "stat"]]);
  assert.deepEqual(inspect({ previousShotAt: 9_000, previousTicks: 1_080, timingStrikes: 2 }).map((f) => [f.kind, f.level]), [["impossible_timing", "proof"]], "The third impossible gap in a run is proof");
  assert.deepEqual(inspect({ previousShotAt: 7_000, previousTicks: 1_080 }), [], "Gaps above half the fastest animation are fine");
  assert.deepEqual(inspect({ previousShotAt: 9_900, previousTicks: 300 }), [], "Short animations are never timed (network jitter)");
  assert.deepEqual(inspect({ previousShotAt: 9_000, previousTicks: 1_080, ruleset: 5 }), [], "Older rulesets send shots after landing and are not timed");

  // Aim trails: validated, never blocking a shot.
  assert.deepEqual(rules.parseAim([[0, 90], [120, 84.44], [300, 84.44], [650, 71.06]]), [[0, 90], [120, 84.4], [300, 84.4], [650, 71.1]]);
  for (const bad of [undefined, [], [[0, 5]], [[10, 90], [5, 91]], [[0, "90"]], Array.from({ length: 121 }, (_, i) => [i, 90])]) assert.equal(rules.parseAim(bad), null);
  assert.equal(rules.aimMoves([[0, 90], [120, 84.4], [300, 84.4], [650, 71.1]]), 2);
  assert.equal(rules.aimMoves([[0, 71.1], [900, 71.1]]), 0, "A shot fired without touching the aim");

  const shot = (gain, bestGain, bestShare, aimMs) => ({ gain, bestGain, bestShare, aimMs });
  const person = Array.from({ length: 120 }, (_, i) => shot(i % 3 === 0 ? 20 : 12, 20, i % 2 ? 0.03 : 0.3, 900 + ((i * 377) % 4000)));
  assert.deepEqual(rules.evaluateShots(person), [], "A strong but human player is not flagged");
  const bot = Array.from({ length: 60 }, (_, i) => shot(20, 20, 0.02, 700 + (i % 3) * 10));
  assert.deepEqual(rules.evaluateShots(bot).map((f) => f.kind), ["superhuman_precision", "mechanical_rhythm"]);
  assert.deepEqual(rules.evaluateShots(bot.slice(0, 20)).map((f) => f.kind), [], "Too few shots to judge");

  // --- Fixtures ------------------------------------------------------------
  const ids = { bot: "ac-bot-private", ann: "ac-ann-private", ben: "ac-ben-private", cat: "ac-cat-private" };
  for (const [name, id] of Object.entries(ids)) {
    sqlite.prepare("INSERT INTO players(id, name, created) VALUES(?, ?, 0)").run(id, name);
    await ensureCashAccount(id);
    sqlite.prepare("INSERT INTO cash_ledger VALUES(?, ?, 'fixture', ?, 'fixture', 0)").run(`fund-${id}`, cashAccountId(id), 10 * SOL);
  }
  await ensureCashAccount(HOUSE);
  const cash = (owner) => sqlite.prepare("SELECT balance FROM cash_accounts WHERE id = ?").get(cashAccountId(owner))?.balance ?? 0;
  const gems = (id) => sqlite.prepare("SELECT balance FROM players WHERE id = ?").get(id).balance;
  const suspension = (id) => sqlite.prepare("SELECT status, source, reason FROM player_suspensions WHERE user_id = ?").get(id);

  // A normal shot with a report is accepted and logs its animation length.
  const annRun = await matches.startMatch(ids.ann, SOL, "devnet");
  const deferred = [];
  const trail = [[0, 90], [400, 85.5], [900, 80]];
  const saved = await matches.playShot(ids.ann, annRun.id, annRun.revision, "shot", 80, true, signed(annRun, 80, { aim: trail, defer: (task) => deferred.push(task) }));
  assert.equal(saved.shotKey, shotKeyFor(`m-${annRun.id}`), "Runs carry their shot key to the player");
  assert.equal(saved.revision, 1);
  assert.ok(sqlite.prepare("SELECT ticks FROM run_shots WHERE run_key = ?").get(`m-${annRun.id}`).ticks > 0, "The shot log records animation ticks");
  assert.equal(deferred.length, 1, "Real-money shots are analyzed after the response");
  await deferred[0]();
  const analysis = sqlite.prepare("SELECT gain, best_gain, best_share, aim_ms FROM shot_analysis WHERE run_key = ?").get(`m-${annRun.id}`);
  assert.ok(analysis.best_gain >= analysis.gain && analysis.best_share > 0 && analysis.best_share <= 1 && analysis.aim_ms === 1800);
  const quality = sqlite.prepare("SELECT quality FROM shot_analysis WHERE run_key = ?").get(`m-${annRun.id}`).quality;
  assert.ok(quality > 0 && quality <= 1, "Each analyzed shot gets a quality percentile");
  assert.equal(sqlite.prepare("SELECT aim_moves FROM shot_analysis WHERE run_key = ?").get(`m-${annRun.id}`).aim_moves, 2);
  assert.equal(sqlite.prepare("SELECT aim FROM run_shots WHERE run_key = ?").get(`m-${annRun.id}`).aim, JSON.stringify(trail), "The aim trail is logged with the shot");

  // The bot joins Ann's match (Ann still playing) and plays with an automation browser.
  const botRun = await matches.startMatch(ids.bot, SOL, "devnet");
  assert.equal(botRun.match_id, annRun.match_id);
  // It also has an open match of its own at another stake, and a live paid SOL tournament run.
  sqlite.prepare("INSERT INTO matches(id, seed, stake, asset, p1, created, ruleset, row_key) VALUES('bot-open', 1, ?, 'devnet', ?, 0, 6, 'k')").run(SOL / 10, ids.bot);
  sqlite.prepare("INSERT INTO runs(id, match_id, user_id, state, score, done, created, finished) VALUES('bot-open-run', 'bot-open', ?, '{}', 50, 1, 0, 1)").run(ids.bot);
  await ensureCashAccount("escrow:bot-open");
  sqlite.prepare("INSERT INTO cash_ledger VALUES('bot-open-escrow', ?, 'escrow_funding', ?, 'bot-open', 0)").run(cashAccountId("escrow:bot-open"), SOL / 10);
  const now = Date.now();
  sqlite
    .prepare("INSERT INTO tournaments(id, name, asset, entry_fee, prize, payout, places, seed, ruleset, row_key, starts_at, ends_at, status, created) VALUES('cup', 'Cup', 'devnet', ?, 0, 'winner', 8, 1, 6, 'k', ?, ?, 'scheduled', 0)")
    .run(SOL, now - 60_000, now + 3_600_000);
  for (const [who, score, done] of [[ids.bot, 500, 0], [ids.cat, 40, 1]]) {
    sqlite.prepare("INSERT INTO tournament_entries(id, tournament_id, user_id, state, score, done, registered, finished) VALUES(?, 'cup', ?, '{}', ?, ?, 0, ?)").run(`cup-${who}`, who, score, done, done ? now : null);
  }
  await ensureCashAccount("escrow:tournament:cup");
  sqlite.prepare("INSERT INTO cash_ledger VALUES('cup-escrow', ?, 'tournament_escrow', ?, 'cup', 0)").run(cashAccountId("escrow:tournament:cup"), 2 * SOL);
  const annBefore = cash(ids.ann);
  const houseBefore = cash(HOUSE);
  await assert.rejects(
    () => matches.playShot(ids.bot, botRun.id, botRun.revision, "shot", 80, true, signed(botRun, 80, { extra: { webdriver: true } })),
    (e) => e.status === 403 && /Automated play was detected/.test(e.message),
  );
  assert.deepEqual({ ...suspension(ids.bot) }, { status: "suspended", source: "proof", reason: "Automation browser (webdriver)" });
  const m = sqlite.prepare("SELECT settled, winner, disqualified, fee FROM matches WHERE id = ?").get(annRun.match_id);
  assert.deepEqual({ ...m }, { settled: 1, winner: ids.ann, disqualified: ids.bot, fee: 0.24 * SOL }, "The opponent wins at once, with the usual house fee");
  assert.equal(cash(ids.ann), annBefore + 1.76 * SOL);
  assert.equal(sqlite.prepare("SELECT done FROM runs WHERE id = ?").get(annRun.id).done, 1, "The opponent's run ends with the match");
  const annNote = sqlite.prepare("SELECT data FROM notifications WHERE user_id = ? AND kind = 'match_result'").get(ids.ann);
  assert.equal(JSON.parse(annNote.data).disqualified, true, "The opponent is told why they won");
  const open = sqlite.prepare("SELECT settled, cancelled, disqualified FROM matches WHERE id = 'bot-open'").get();
  assert.deepEqual({ ...open }, { settled: 1, cancelled: 1, disqualified: ids.bot }, "An open seat closes");
  // 0.24 match fee + 0.1 unjoined entry + 12% house share of the 2 SOL tournament pot.
  assert.equal(cash(HOUSE), houseBefore + 0.24 * SOL + 0.1 * SOL + 0.24 * SOL, "The house keeps the unjoined entry");
  assert.equal(cash("escrow:bot-open"), 0);
  const cupEntry = sqlite.prepare("SELECT disqualified, done FROM tournament_entries WHERE id = ?").get(`cup-${ids.bot}`);
  assert.deepEqual({ ...cupEntry }, { disqualified: 1, done: 1 });
  assert.equal(sqlite.prepare("SELECT status FROM tournaments WHERE id = 'cup'").get().status, "settled", "Everyone has finished, so the tournament ends");
  assert.equal(sqlite.prepare("SELECT rank FROM tournament_entries WHERE id = ?").get(`cup-${ids.cat}`).rank, 1, "The disqualified top score does not rank");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM weekly_race_exclusions WHERE user_id = ? AND admin_id = 'system'").get(ids.bot).n, 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND kind = 'account_suspended'").get(ids.bot).n, 1);

  // A suspended player can do nothing with money or games.
  await assert.rejects(() => matches.startMatch(ids.bot, SOL, "devnet"), (e) => e.status === 403);
  await assert.rejects(() => tips.sendTip(ids.bot, crypto.randomUUID(), sqlite.prepare("SELECT public_id FROM players WHERE id = ?").get(ids.ann).public_id, "0.1"), /suspended/);
  await assert.rejects(() => service.precheckWithdrawal(ids.bot, "11111111111111111111111111111111", "1"), /suspended/);
  assert.throws(
    () => sqlite.prepare("INSERT INTO cash_ledger VALUES('sneaky-tip', ?, 'tip_sent', -1, 'x', 0)").run(cashAccountId(ids.bot)),
    /account suspended/,
    "The database refuses tips too",
  );
  assert.equal((await matches.playerSnapshot(ids.bot, "devnet")).suspension.reason, "Automation browser (webdriver)");
  assert.equal((await matches.playerSnapshot(ids.ann, "devnet")).suspension, null);

  // Scripted input and repeated impossible timing are proof too; a single timing strike only records a signal.
  const benRun = await matches.startMatch(ids.ben, SOL / 10, "devnet");
  const benKey = `m-${benRun.id}`;
  let benSaved = await matches.playShot(ids.ben, benRun.id, 0, "shot", 80, true, signed(benRun, 80));
  sqlite.prepare("UPDATE run_shots SET ticks = 1080, created = ? WHERE run_key = ?").run(Date.now() - 500, benKey);
  benSaved = await matches.playShot(ids.ben, benRun.id, benSaved.revision, "shot", 100, true, { ...signed(benSaved, 100, { extra: { flags: 1 } }) });
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM cheat_signals WHERE run_key = ? AND kind = 'tampered_client'").get(benKey).n, 1, "A replaced fetch is recorded");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM cheat_signals WHERE run_key = ? AND kind = 'timing'").get(benKey).n, 1);
  assert.equal(suspension(ids.ben), undefined, "One fast gap is not enough");
  assert.equal(benSaved.revision, 2);

  // A report rewritten after signing (the red-team userscript's approach) is proof, like a key for another shot.
  const eveRun = await matches.startMatch("ac-eve-private", SOL / 10, "devnet").catch(() => null);
  assert.equal(eveRun, null, "Unknown players cannot play");
  sqlite.prepare("INSERT INTO players(id, name, created) VALUES('ac-dan-private', 'dan', 0)").run();
  await ensureCashAccount("ac-dan-private");
  sqlite.prepare("INSERT INTO cash_ledger VALUES('fund-dan', ?, 'fixture', ?, 'fixture', 0)").run(cashAccountId("ac-dan-private"), 10 * SOL);
  const danRun = await matches.startMatch("ac-dan-private", SOL, "devnet");
  await assert.rejects(
    () => matches.playShot("ac-dan-private", danRun.id, danRun.revision, "shot", 70, true, signed(danRun, 70, { extra: { trusted: false, inputs: 0 }, tamper: { trusted: true, inputs: 40 } })),
    (e) => e.status === 403,
  );
  assert.equal(sqlite.prepare("SELECT reason FROM player_suspensions WHERE user_id = 'ac-dan-private'").get().reason, "Shot report edited after signing (request rewritten)");
  sqlite.prepare("DELETE FROM player_suspensions WHERE user_id = 'ac-dan-private'").run();
  const danNext = await matches.startMatch("ac-dan-private", SOL / 20, "devnet");
  await assert.rejects(() => matches.playShot("ac-dan-private", danNext.id, danNext.revision, "shot", 70, true, signed(danRun, 70)), (e) => e.status === 403, "A signature for another run does not verify");
  sqlite.prepare("DELETE FROM player_suspensions WHERE user_id = 'ac-dan-private'").run();

  // Statistics: a player whose recent SOL shots look automated is suspended for review, without touching results.
  for (let i = 0; i < 45; i++) {
    sqlite.prepare("INSERT INTO shot_analysis(run_key, revision, user_id, aim_ms, gain, best_gain, best_share, created) VALUES('cat-run', ?, ?, ?, 30, 30, 0.02, ?)").run(i, ids.cat, 650 + (i % 2) * 5, Date.now() - i);
  }
  const catCash = cash(ids.cat);
  sqlite.prepare("UPDATE shot_analysis SET quality = 0.97 WHERE user_id = ?").run(ids.cat);
  for (let i = 45; i < 70; i++) {
    sqlite.prepare("INSERT INTO shot_analysis(run_key, revision, user_id, aim_ms, gain, best_gain, best_share, quality, created) VALUES('cat-run', ?, ?, ?, 10, 30, 0.5, 0.96, ?)").run(i, ids.cat, 1500 + i * 37, Date.now() - 60_000 - i);
  }
  const findings = await antiCheat.evaluatePlayer(ids.cat);
  assert.deepEqual(findings.map((f) => f.kind), ["superhuman_precision", "mechanical_rhythm", "superhuman_quality"]);
  assert.equal(suspension(ids.cat).source, "stats");
  assert.equal(cash(ids.cat), catCash, "Statistical suspensions seize nothing on their own");
  assert.deepEqual(await antiCheat.evaluatePlayer(ids.cat), [], "An already suspended player is not flagged twice");

  // Suspended players drop out of the weekly race standings.
  sqlite.prepare("INSERT INTO matches(id, seed, stake, asset, p1, p2, settled, created, ruleset) VALUES('cat-race', 1, 1, 'devnet', ?, ?, 1, 0, 6)").run(ids.cat, ids.ann);
  sqlite.prepare("INSERT INTO runs(id, match_id, user_id, state, score, done, created, finished) VALUES('cat-race-run', 'cat-race', ?, '{}', 9999, 1, 0, ?)").run(ids.cat, Date.now());
  assert.ok(!(await race.weeklyRace()).standings.some((s) => s.name === "cat"));

  // --- The switch: with sanctions off, checks still run and are recorded -----
  assert.equal(await antiCheat.antiCheatEnabled(), true, "On by default");
  await antiCheat.setAntiCheatEnabled("admin-user", false);
  assert.equal(await antiCheat.antiCheatEnabled(), false);
  sqlite.prepare("INSERT INTO players(id, name, created) VALUES('ac-eli-private', 'eli', 0)").run();
  await ensureCashAccount("ac-eli-private");
  sqlite.prepare("INSERT INTO cash_ledger VALUES('fund-eli', ?, 'fixture', ?, 'fixture', 0)").run(cashAccountId("ac-eli-private"), 10 * SOL);
  const eliRun = await matches.startMatch("ac-eli-private", SOL / 20, "devnet");
  const eliSaved = await matches.playShot("ac-eli-private", eliRun.id, eliRun.revision, "shot", 75, true, signed(eliRun, 75, { extra: { webdriver: true } }));
  assert.equal(eliSaved.revision, 1, "A detected shot is accepted while sanctions are off");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM player_suspensions WHERE user_id = 'ac-eli-private'").get().n, 0);
  const eliSignal = sqlite.prepare("SELECT kind, level, detail FROM cheat_signals WHERE user_id = 'ac-eli-private'").get();
  assert.deepEqual([eliSignal.kind, eliSignal.level, JSON.parse(eliSignal.detail).sanctioned], ["automation_browser", "proof", false], "The proof is kept, marked as not sanctioned");
  for (let i = 0; i < 45; i++) {
    sqlite.prepare("INSERT INTO shot_analysis(run_key, revision, user_id, aim_ms, gain, best_gain, best_share, created) VALUES('eli-run', ?, 'ac-eli-private', ?, 30, 30, 0.02, ?)").run(i, 650 + (i % 2) * 5, Date.now() - i);
  }
  assert.deepEqual((await antiCheat.evaluatePlayer("ac-eli-private")).map((f) => f.kind), ["superhuman_precision", "mechanical_rhythm"]);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM player_suspensions WHERE user_id = 'ac-eli-private'").get().n, 0, "Statistics do not suspend while off");
  await antiCheat.evaluatePlayer("ac-eli-private");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM cheat_signals WHERE user_id = 'ac-eli-private' AND level = 'stat'").get().n, 2, "Repeated evaluations do not flood the signals");
  await antiCheat.setAntiCheatEnabled("admin-user", true);
  await assert.rejects(() => matches.playShot("ac-eli-private", eliSaved.id, eliSaved.revision, "shot", 80, true, signed(eliSaved, 80, { extra: { webdriver: true } })), (e) => e.status === 403, "Back on: sanctions apply again");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM admin_audit WHERE action = 'anti_cheat_toggle'").get().n, 2);

  // --- Administrator ---------------------------------------------------------
  const overview = await admin.antiCheatOverview();
  const botCase = overview.cases.find((c) => c.name === "bot");
  const catCase = overview.cases.find((c) => c.name === "cat");
  assert.equal(catCase.stats.stillAimRate, null, "No trails, no still-aim rate");
  assert.ok(catCase.stats.meanQuality > 0.95 && catCase.stats.qualityThreshold === rules.QUALITY.absoluteMean);
  assert.ok(overview.watchlist.some((w) => w.name === "ben" && w.status === "watch"), "A tampered client puts the player on the watchlist");
  assert.equal(botCase.status, "suspended");
  assert.equal(botCase.signals[0].label, "Automation browser (webdriver)");
  assert.ok(overview.recentSignals.some((s) => s.name === "ben" && s.kind === "timing"));
  assert.ok(!JSON.stringify(overview).includes("-private"), "No player IDs in the admin view");

  await assert.rejects(() => admin.adminLift("admin-user", "cat", ""), /note/);
  await admin.adminLift("admin-user", "cat", "Checked the replays, legitimate player");
  assert.equal(suspension(ids.cat).status, "lifted");
  assert.ok((await race.weeklyRace()).standings.some((s) => s.name === "cat"), "Lifting restores the race");
  await assert.rejects(() => admin.adminLift("admin-user", "cat", "again"), /not suspended/);

  const botSol = cash(ids.bot);
  const houseBeforeBan = cash(HOUSE);
  sqlite.prepare("INSERT INTO ledger(id, user_id, match_id, kind, amount, created) VALUES('bot-gems', ?, NULL, 'fixture', 300, 0)").run(ids.bot);
  const botGems = gems(ids.bot);
  const seized = await admin.adminBan("admin-user", "bot", "Confirmed from replays");
  assert.deepEqual(seized, { sol: botSol, gems: botGems });
  assert.equal(cash(ids.bot), 0);
  assert.equal(gems(ids.bot), 0);
  assert.equal(cash(HOUSE), houseBeforeBan + botSol, "The SOL balance moves to the house");
  assert.equal(suspension(ids.bot).status, "banned");
  await assert.rejects(() => admin.adminBan("admin-user", "bot", "twice"), /Only a suspended player/);
  await assert.rejects(() => matches.startMatch(ids.bot, SOL / 10, "devnet"), (e) => e.status === 403, "Banned players stay locked out");

  await admin.adminSuspend("admin-user", "ben", "Reported by several players");
  assert.equal(suspension(ids.ben).source, "admin");
  await assert.rejects(() => matches.playShot(ids.ben, benRun.id, benSaved.revision, "shot", 90, true, signed(benSaved, 90)), (e) => e.status === 403, "A suspension stops a run mid-match");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM admin_audit WHERE action LIKE 'anti_cheat_%' AND action <> 'anti_cheat_toggle'").get().n, 3);

  console.log(
    "PASS: anti-cheat (sanctions switch (checks recorded while off), report parsing, signed reports (rewritten or reused signatures), synthetic aim events, replaced page functions on the watchlist, shot quality with population thresholds, results trend, aim trail shape, aim trails, automation browser, scripted input, impossible timing strikes, jitter-safe timing, precision and rhythm statistics, shot analysis after the response, instant loss to the opponent with the normal fee, open seats closed for the house, disqualified tournament runs without rank, race exclusion, suspension notice, play/tip/withdrawal locks in code and database, statistical review without seizure, admin overview without IDs, lift, ban with seizure, manual suspension).",
  );
} finally {
  close();
}
