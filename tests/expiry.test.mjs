import assert from "node:assert/strict";
import { createDatabase } from "./helpers/test-env.mjs";

// Nothing stays open forever: a run its player never came back to ends at the
// score it reached, and a seat nobody took hands the entry back.
Object.assign(process.env, { SOLANA_NETWORK: "devnet", SOLANA_RPC_URL: "https://rpc.invalid", SOLANA_VAULT_KEY: Buffer.alloc(32, 5).toString("base64") });
const { sqlite, close } = await createDatabase();
globalThis.fetch = async () => {
  throw new Error("The sweep must not touch the network");
};

const matches = await import("../lib/matches.ts");
const service = await import("../lib/payments/service.ts");
const { EXPIRY, sweepIfDue, sweepStaleMatches } = await import("../lib/expiry.ts");

const ANN = "exp-ann-private";
const BEN = "exp-ben-private";
const CAT = "exp-cat-private";
for (const [id, name] of [
  [ANN, "ann"],
  [BEN, "ben"],
  [CAT, "cat"],
]) {
  sqlite.prepare("INSERT INTO players(id, name, created) VALUES(?, ?, 0)").run(id, name);
}
const gems = (uid) => sqlite.prepare("SELECT balance FROM players WHERE id = ?").get(uid).balance;
const cash = (uid) => sqlite.prepare("SELECT balance FROM cash_accounts WHERE id = ?").get(service.cashAccountId(uid))?.balance ?? 0;
const matchRow = (id) => sqlite.prepare("SELECT * FROM matches WHERE id = ?").get(id);
const runRow = (id) => sqlite.prepare("SELECT * FROM runs WHERE id = ?").get(id);
/** Moves a run's last activity into the past, as if its player had walked away. */
const idle = (runId, ms) => {
  sqlite.prepare("UPDATE runs SET created = created - ? WHERE id = ?").run(ms, runId);
  sqlite.prepare("UPDATE run_shots SET created = created - ? WHERE run_key = ?").run(ms, `m-${runId}`);
};
const age = (matchId, ms) => sqlite.prepare("UPDATE matches SET created = created - ? WHERE id = ?").run(ms, matchId);

try {
  // Ann opens a match and plays a shot; Ben joins and walks away mid-run.
  const stake = 100;
  let ann = await matches.startMatch(ANN, stake, "gems");
  ann = await matches.playShot(ANN, ann.id, ann.revision, "shot", 73);
  await matches.playShot(ANN, ann.id, ann.revision, "forfeit");
  const ben = await matches.startMatch(BEN, stake, "gems");
  assert.equal(ben.match_id, ann.match_id);
  await matches.playShot(BEN, ben.id, ben.revision, "shot", 91);

  // Fresh runs are left alone.
  assert.deepEqual(await sweepStaleMatches(), { forfeited: 0, expired: 0 });
  assert.equal(matchRow(ben.match_id).settled, 0);

  // A day without a shot: Ben's run ends where it is and the match settles on scores.
  idle(ben.id, EXPIRY.runIdleMs + 60_000);
  assert.deepEqual(await sweepStaleMatches(), { forfeited: 1, expired: 0 });
  const settled = matchRow(ben.match_id);
  assert.equal(settled.settled, 1);
  assert.equal(settled.cancelled, 0, "An abandoned run is a forfeit, not a cancellation");
  assert.deepEqual([runRow(ben.id).done, runRow(ben.id).forfeit], [1, 1]);
  assert.ok(settled.winner === ANN || settled.winner === BEN || settled.winner === null);
  assert.equal(gems(ANN) + gems(BEN), 4000, "The pot is paid out, nothing is created");

  // A seat nobody takes: the entry comes back in full, once.
  const lonely = await matches.startMatch(CAT, stake, "gems");
  const before = gems(CAT);
  age(lonely.match_id, EXPIRY.seatIdleMs + 60_000);
  idle(lonely.id, EXPIRY.seatIdleMs + 60_000);
  // The run ends first, then the seat nobody took hands the entry back.
  assert.deepEqual(await sweepStaleMatches(), { forfeited: 1, expired: 1 });
  const closed = matchRow(lonely.match_id);
  assert.deepEqual([closed.settled, closed.cancelled, closed.fee], [1, 1, 0]);
  assert.equal(gems(CAT), before + stake);
  assert.deepEqual(await sweepStaleMatches(), { forfeited: 0, expired: 0 });
  assert.equal(gems(CAT), before + stake, "An expired seat refunds once");
  const notice = JSON.parse(sqlite.prepare("SELECT data FROM notifications WHERE user_id = ? ORDER BY created DESC LIMIT 1").get(CAT).data);
  assert.deepEqual([notice.result, notice.stake], ["cancelled", stake]);
  assert.match(notice.reason, /No opponent/);
  assert.equal((await matches.playerSnapshot(CAT, "gems")).matches.find((m) => m.id === lonely.match_id).result, "cancelled");

  // An old match whose creator is still playing keeps its seat.
  const playing = await matches.startMatch(CAT, stake, "gems");
  await matches.playShot(CAT, playing.id, playing.revision, "shot", 88);
  age(playing.match_id, EXPIRY.seatIdleMs + 60_000);
  assert.deepEqual(await sweepStaleMatches(), { forfeited: 0, expired: 0 }, "A seat is never pulled from under an active run");
  assert.equal(matchRow(playing.match_id).settled, 0);

  // Devnet: the escrow empties back to the player, with no house fee.
  await service.ensureCashAccount(ANN);
  sqlite.prepare("INSERT INTO cash_ledger VALUES('exp-fund', ?, 'fixture', 1000000000, 'fixture', 0)").run(service.cashAccountId(ANN));
  sqlite.prepare("UPDATE runs SET done = 1 WHERE user_id = ?").run(ANN);
  const sol = await matches.startMatch(ANN, 1_000_000_000, "devnet");
  const house = cash(service.HOUSE);
  age(sol.match_id, EXPIRY.seatIdleMs + 60_000);
  idle(sol.id, EXPIRY.runIdleMs + 60_000);
  await sweepStaleMatches();
  assert.equal(cash(ANN), 1_000_000_000, "Devnet entries come back in full");
  assert.equal(cash("escrow:" + sol.match_id), 0);
  assert.equal(cash(service.HOUSE), house, "An expired seat pays no house fee");

  // The lease keeps the sweep to one run per window, whoever asks.
  const first = await sweepIfDue();
  assert.ok(first, "The first caller sweeps");
  assert.equal(await sweepIfDue(), null, "The next caller skips it");
  assert.ok(await sweepIfDue(Date.now() + 6 * 60_000), "A later window sweeps again");

  console.log(
    "PASS: expiry (abandoned runs forfeited and settled on scores, seats refunded in full once with a notice, active runs untouched, devnet escrow released with no fee, one sweep per lease window).",
  );
} finally {
  close();
}
