import assert from "node:assert/strict";
import { createDatabase } from "./helpers/test-env.mjs";

// Spectator mode: shot logging, replays that reproduce the server's board, and
// the rules that stop anyone still playing a seed from watching others on it.
const { sqlite, close } = await createDatabase();
globalThis.fetch = async () => {
  throw new Error("Spectating must not touch the network");
};

const matches = await import("../lib/matches.ts");
const engine = await import("../lib/engine.ts");
const t = await import("../lib/tournaments.ts");
const { watchRun, liveGames } = await import("../lib/spectate.ts");
const { tournamentHistory } = await import("../lib/tournament-history.ts");
const { profilePerformance } = await import("../lib/profile-performance.ts");

const ANN = "spec-ann-private";
const BEN = "spec-ben-private";
const CAT = "spec-cat-private";
const DOM = "spec-dom-private";
const IDS = [ANN, BEN, CAT, DOM];
for (const [id, name] of [
  [ANN, "Ann"],
  [BEN, "Ben"],
  [CAT, "Cat"],
  [DOM, "Dom"],
]) {
  sqlite.prepare("INSERT INTO players(id, name, created) VALUES(?, ?, 0)").run(id, name);
}
const noIds = (value, label) => {
  const text = JSON.stringify(value);
  for (const id of IDS) assert.ok(!text.includes(id), `${label} must not carry player IDs`);
};

/** Replays logged shots from the start, as the spectator client does. */
function replay(data) {
  let board = structuredClone(data.start);
  for (const shot of data.shots) board = shot.angle === null ? { ...board, over: true } : engine.simulate(board, shot.angle, data.ruleset);
  return board;
}

try {
  // A 1v1: Ann opens a match and plays. With the seat open, nobody else may watch.
  let ann = await matches.startMatch(ANN, 25, "gems");
  for (const angle of [70, 115.5, 42]) {
    if (ann.state.over) break;
    ann = await matches.playShot(ANN, ann.id, ann.revision, "shot", angle);
  }
  // Ann ends her run early; under the current ruleset the seat stays open.
  ann = await matches.playShot(ANN, ann.id, ann.revision, "forfeit");
  const annWatch = `m-${ann.id}`;
  await assert.rejects(() => watchRun(CAT, annWatch), /waiting for an opponent/, "An open seat cannot be studied before joining");
  await assert.rejects(() => watchRun(null, annWatch), /waiting for an opponent/);
  const own = await watchRun(ANN, annWatch);
  assert.equal(own.player.isYou, true, "A player can replay their own run");
  assert.deepEqual(
    own.shots.map((s) => s.revision),
    [...Array(ann.revision).keys()],
  );
  assert.equal(own.replayable, true);
  assert.deepEqual(replay(own), own.state, "Logged shots replay to the server's board");

  // A stale shot is rejected and logs nothing.
  await assert.rejects(() => matches.playShot(ANN, ann.id, ann.revision - 1, "shot", 90), /another tab/);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM run_shots WHERE run_key = ?").get(annWatch).n, ann.revision);

  // Ben takes the seat. While Ben is still playing, he can only watch his own run.
  let ben = await matches.startMatch(BEN, 25, "gems");
  assert.equal(ben.match_id, ann.match_id);
  ben = await matches.playShot(BEN, ben.id, 0, "shot", 88);
  await assert.rejects(() => watchRun(BEN, annWatch), /Finish your own run/);
  const benOwn = await watchRun(BEN, `m-${ben.id}`);
  assert.deepEqual(benOwn.sides, [], "No switching to the opponent while you still play");

  // Anyone else can watch both sides live, and the live list shows the match.
  const catView = await watchRun(CAT, annWatch);
  assert.equal(catView.kind, "match");
  assert.deepEqual(catView.sides.map((s) => s.name).sort(), ["Ann", "Ben"]);
  noIds(catView, "A watched match");
  const since = await watchRun(CAT, `m-${ben.id}`, 1);
  assert.deepEqual(since.shots, [], "Polling from a revision returns only newer shots");
  const live = await liveGames(CAT);
  assert.ok(live.some((g) => g.watchId === `m-${ben.id}` && g.context === "Ann"), "Ben's live run is listed for spectators");
  assert.ok(!live.some((g) => g.watchId === annWatch), "Finished runs are not live");
  assert.ok(!(await liveGames(BEN)).some((g) => g.watchId === `m-${ben.id}`), "Players do not see their own match as live");
  noIds(live, "The live list");
  assert.ok(!(await liveGames(DOM, Date.now() + 11 * 60_000)).length, "Idle runs drop off the live list");

  // Ben forfeits: the forfeit is logged, and the match settles; now Ben can watch Ann.
  ben = await matches.playShot(BEN, ben.id, ben.revision, "forfeit");
  const benDone = await watchRun(BEN, annWatch);
  assert.equal(benDone.final, true);
  const benReplay = await watchRun(DOM, `m-${ben.id}`);
  assert.equal(benReplay.shots.at(-1).angle, null, "A forfeit is logged without an angle");
  assert.deepEqual(replay(benReplay), benReplay.state);

  // Profile and history rows link to the player's run.
  const annProfile = await profilePerformance("Ann", "gems");
  assert.equal(annProfile.history.find((m) => m.id === ann.match_id).watchId, annWatch);
  const lone = await matches.startMatch(DOM, 50, "gems");
  const domProfile = await profilePerformance("Dom", "gems");
  assert.equal(domProfile.history.find((m) => m.id === lone.match_id).watchId, null, "Open-seat matches have no watch link");
  await matches.playShot(DOM, lone.id, 0, "forfeit");

  await assert.rejects(() => watchRun(CAT, "m-not-a-run"), /not found/);
  await assert.rejects(() => watchRun(CAT, `m-${crypto.randomUUID()}`), /not found/);

  // A tournament: registered players who have not finished cannot watch the others.
  const now = Date.now();
  const cup = await t.createTournament(
    { name: "Watch Cup", asset: "gems", entry: "free", prize: "300", payout: "winner", places: 4, startsAt: now + 60_000, endsAt: now + 3_600_000 },
    now,
  );
  for (const uid of [ANN, BEN, CAT]) await t.registerForTournament(uid, cup, now);
  sqlite.prepare("UPDATE tournaments SET starts_at = ? WHERE id = ?").run(now - 60_000, cup);
  let annRun = await t.startTournamentRun(ANN, cup, now);
  annRun = await t.playTournamentShot(ANN, annRun.id.slice(2), 0, "shot", 64, true, now);
  annRun = await t.playTournamentShot(ANN, annRun.id.slice(2), 1, "shot", 101, true, now);
  const benRun = await t.startTournamentRun(BEN, cup, now);
  const [annEntry] = await tournamentHistory(ANN, "gems");
  const annTournamentWatch = annEntry.watchId;
  assert.equal(annTournamentWatch, `t-${annRun.id.slice(2)}`);

  await assert.rejects(() => watchRun(BEN, annTournamentWatch), /Finish your own run/, "Entrants still to play cannot watch rivals");
  await assert.rejects(() => watchRun(CAT, annTournamentWatch), /Finish your own run/, "Even before starting their own run");
  const domTournament = await watchRun(DOM, annTournamentWatch);
  assert.equal(domTournament.tournament.name, "Watch Cup");
  assert.deepEqual(replay(domTournament), domTournament.state);
  noIds(domTournament, "A watched tournament run");

  const benDetail = await t.tournamentDetail(BEN, cup, now);
  assert.ok(benDetail.standings.every((s) => (s.isYou ? s.watchId !== null : s.watchId === null)), "Standings only offer your own run while you still play");
  const domDetail = await t.tournamentDetail(DOM, cup, now);
  assert.equal(domDetail.standings.find((s) => s.name === "Ann").watchId, annTournamentWatch);
  assert.equal(domDetail.standings.find((s) => s.name === "Cat").watchId, null, "Runs that have not started cannot be watched");
  await assert.rejects(() => watchRun(DOM, `t-${sqlite.prepare("SELECT id FROM tournament_entries WHERE tournament_id = ? AND user_id = ?").get(cup, CAT).id}`), /not started/);

  assert.ok((await liveGames(DOM, now)).some((g) => g.watchId === annTournamentWatch && g.context === "Watch Cup"));
  assert.ok(!(await liveGames(BEN, now)).some((g) => g.kind === "tournament"), "The live list hides a tournament you still have to play");

  // Once Ben finishes, he can watch Ann.
  await t.playTournamentShot(BEN, benRun.id.slice(2), 0, "forfeit", undefined, true, now);
  assert.equal((await watchRun(BEN, annTournamentWatch, 0, now)).player.name, "Ann");

  // The arena lobby: next tournament, last games, open seats, best run and live runs.
  const { arenaOverview } = await import("../lib/arena.ts");
  const catArena = await arenaOverview(CAT, now);
  assert.equal(catArena.tournament.name, "Watch Cup", "A live tournament you still have to play comes first");
  assert.equal(catArena.openSeats.gems[50], 1, "Dom's open seat is waiting for a rival");
  assert.deepEqual((await arenaOverview(DOM, now)).openSeats.gems, {}, "Your own open seat is not counted");
  assert.ok(catArena.bestToday && catArena.bestToday.score > 0);
  noIds(catArena, "The arena overview");
  const annArena = await arenaOverview(ANN, now);
  const annMatch = annArena.recent.find((g) => g.kind === "match");
  assert.equal(annMatch.title, "Ben");
  assert.ok(["win", "loss", "draw"].includes(annMatch.outcome));
  assert.equal(typeof annMatch.net, "number");
  assert.equal(annMatch.watchId, annWatch);
  const domRecent = (await arenaOverview(DOM, now)).recent.find((g) => g.id === lone.match_id);
  assert.deepEqual([domRecent.title, domRecent.outcome, domRecent.net], ["Open seat", "waiting", null], "An open seat is still waiting");
  const benCup = (await arenaOverview(BEN, now)).recent.find((g) => g.kind === "tournament");
  assert.deepEqual([benCup.title, benCup.outcome, benCup.rank], ["Watch Cup", "waiting", null], "A finished run in a live tournament awaits results");
  assert.deepEqual((await arenaOverview(null, now)).recent, [], "Visitors have no results");

  // Visitors see the same leaderboard, with no row marked as theirs and no player IDs.
  const publicBoard = await matches.leaderboard(null, "gems");
  const annBoard = await matches.leaderboard(ANN, "gems");
  assert.ok(publicBoard.length >= 2 && publicBoard.every((row) => row.is_you === 0));
  assert.deepEqual(publicBoard.map((row) => [row.name, row.pnl]), annBoard.map((row) => [row.name, row.pnl]));
  assert.equal(annBoard.find((row) => row.name === "Ann").is_you, 1);
  noIds(publicBoard, "The public leaderboard");

  console.log(
    "PASS: public leaderboard for visitors. arena overview (tournament pick, last games, open seats, best run). shot log for match and tournament runs (shots, forfeits, stale shots), replays match the server board, open seats hidden, players still on a seed limited to their own run, side switching, polling from a revision, live list rules, history and standings watch links, no player IDs.",
  );
} finally {
  close();
}
