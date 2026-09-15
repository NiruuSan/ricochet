import assert from "node:assert/strict";
import { createDatabase } from "./helpers/test-env.mjs";

// Score tournaments against a libSQL database built from the migrations: prize
// splits, registration limits, the play window, payouts, refunds and privacy.
Object.assign(process.env, {
  SOLANA_NETWORK: "devnet",
  SOLANA_RPC_URL: "https://rpc.invalid",
  SOLANA_VAULT_KEY: Buffer.alloc(32, 9).toString("base64"),
});
const { sqlite, close } = await createDatabase();
globalThis.fetch = async () => {
  throw new Error("Tournaments must not touch the network");
};

const t = await import("../lib/tournaments.ts");
const { cashAccountId, HOUSE } = await import("../lib/payments/accounts.ts");
const { listNotifications } = await import("../lib/notifications.ts");
const { PAYOUT_SHARES } = await import("../lib/api-types.ts");

try {
  // Prize splits: strictly decreasing presets, fewer players, ties and dust.
  for (const shares of Object.values(PAYOUT_SHARES)) {
    assert.equal(shares.reduce((a, b) => a + b, 0), 100);
    assert.ok(shares.every((share, i) => i === 0 || share < shares[i - 1]), "Presets never split equally");
  }
  assert.deepEqual(t.distribute(1000, "top3", [30, 20, 10, 5]), { amounts: [500, 300, 200, 0], ranks: [1, 2, 3, 4] });
  assert.deepEqual(t.distribute(1000, "top3", [30, 20]).amounts, [625, 375], "Unused shares are scaled onto the players who placed");
  assert.deepEqual(t.distribute(1000, "top3", [30, 20, 20, 5]), { amounts: [500, 250, 250, 0], ranks: [1, 2, 2, 4] }, "Ties share their places");
  assert.deepEqual(t.distribute(1001, "winner", [7, 7]).amounts, [501, 500], "Rounding dust goes to the top");
  assert.equal(t.distribute(999, "top10", [9, 8, 7, 6, 5, 4, 3, 2, 1, 1, 0]).amounts.reduce((a, b) => a + b, 0), 999, "The whole pot is always paid");

  const players = ["u-ann", "u-ben", "u-cat", "u-dom"];
  for (const [i, uid] of players.entries()) sqlite.prepare("INSERT INTO players(id, name, created) VALUES(?, ?, 0)").run(uid, ["Ann", "Ben", "Cat", "Dom"][i]);
  const cash = (uid) => sqlite.prepare("SELECT balance FROM cash_accounts WHERE id = ?").get(cashAccountId(uid))?.balance ?? 0;
  const gems = (uid) => sqlite.prepare("SELECT balance FROM players WHERE id = ?").get(uid).balance;
  const totalCash = () => sqlite.prepare("SELECT SUM(balance) AS n FROM cash_accounts").get().n ?? 0;
  const fund = (uid, amount) => {
    sqlite.prepare("INSERT OR IGNORE INTO cash_accounts(id, network, user_id, created) VALUES(?, 'devnet', ?, 0)").run(cashAccountId(uid), uid);
    sqlite.prepare("INSERT INTO cash_ledger VALUES(?, ?, 'fixture', ?, 'fixture', 0)").run(crypto.randomUUID(), cashAccountId(uid), amount);
  };
  const now = Date.UTC(2026, 8, 20, 12);
  const MIN = 60_000;

  // Validation.
  const base = { name: "Friday Cup", asset: "devnet", entry: "paid", entryFee: "0.1", payout: "top3", places: 4, startsAt: now + 10 * MIN, endsAt: now + 70 * MIN };
  await assert.rejects(() => t.createTournament({ ...base, places: 3 }, now), /even number/);
  await assert.rejects(() => t.createTournament({ ...base, payout: "top10" }, now), /top 10/);
  await assert.rejects(() => t.createTournament({ ...base, endsAt: base.startsAt + MIN }, now), /5 minutes/);
  await assert.rejects(() => t.createTournament({ ...base, startsAt: now - 10 * MIN }, now), /future/);
  await assert.rejects(() => t.createTournament({ ...base, entry: "free", prize: "5" }, now), /treasury balance/, "A free SOL prize must be covered by the house");

  // Paid SOL tournament: entries fund the pot, the house keeps 12%.
  const paidId = await t.createTournament(base, now);
  for (const uid of players) fund(uid, 1_000_000_000);
  const liabilities = totalCash();
  for (const uid of players) await t.registerForTournament(uid, paidId, now + MIN);
  assert.equal(cash("u-ann"), 900_000_000);
  assert.equal(cash(`escrow:tournament:${paidId}`), 400_000_000);
  assert.equal(totalCash(), liabilities, "Registration moves SOL, it does not create or destroy it");
  await assert.rejects(() => t.registerForTournament("u-ann", paidId, now + MIN), /already registered/);
  sqlite.prepare("INSERT INTO players(id, name, created) VALUES('u-eve', 'Eve', 0)").run();
  fund("u-eve", 1_000_000_000);
  const liabilitiesWithEve = totalCash();
  await assert.rejects(() => t.registerForTournament("u-eve", paidId, now + MIN), /filled up/);
  assert.equal(cash("u-eve"), 1_000_000_000, "A refused seat takes no entry");
  await assert.rejects(() => t.startTournamentRun("u-ann", paidId, now + MIN), /not started/);
  await assert.rejects(() => t.registerForTournament("u-eve", paidId, now + 20 * MIN), /closed/);

  // Live: one run each, same seed. Ann and Ben tie for first; Dom never plays.
  const live = now + 20 * MIN;
  const runs = {};
  for (const uid of ["u-ann", "u-ben", "u-cat"]) runs[uid] = await t.startTournamentRun(uid, paidId, live);
  assert.deepEqual(runs["u-ann"].state, runs["u-ben"].state, "Every entrant plays the same board");
  assert.equal(runs["u-ann"].tournamentId, paidId);
  const setScore = (uid, score) => sqlite.prepare("UPDATE tournament_entries SET score = ?, state = json_set(state, '$.score', ?) WHERE tournament_id = ? AND user_id = ?").run(score, score, paidId, uid);
  setScore("u-ann", 40);
  setScore("u-cat", 12);
  const annRun = await t.playTournamentShot("u-ann", runs["u-ann"].id.slice(2), 0, "forfeit", undefined, true, live);
  assert.deepEqual([annRun.done, annRun.score], [1, 40]);
  await assert.rejects(() => t.startTournamentRun("u-ann", paidId, live), /already played/);
  const benShot = await t.playTournamentShot("u-ben", runs["u-ben"].id.slice(2), 0, "shot", 90, true, live);
  assert.equal(benShot.revision, 1);
  setScore("u-ben", 40);
  await assert.rejects(() => t.playTournamentShot("u-ben", runs["u-ben"].id.slice(2), 0, "shot", 90, true, live), /another tab/);
  await assert.rejects(() => t.playTournamentShot("u-cat", runs["u-ann"].id.slice(2), 1, "shot", 90, true, live), /not found/, "A run belongs to its player");
  await assert.rejects(() => t.playTournamentShot("u-cat", runs["u-cat"].id.slice(2), 0, "shot", 90, true, now + 80 * MIN), /ended/);

  const detail = await t.tournamentDetail("u-cat", paidId, live);
  assert.equal(detail.status, "live");
  assert.equal(detail.pot, 352_000_000);
  assert.deepEqual(detail.prizes, [176_000_000, 105_600_000, 70_400_000]);
  assert.deepEqual(detail.standings.map((s) => [s.name, s.rank, s.started]), [["Ann", 1, true], ["Ben", 1, true], ["Cat", 3, true], ["Dom", null, false]]);
  assert.equal(detail.standings.find((s) => s.name === "Cat").isYou, true);
  for (const uid of [...players, "u-eve"]) assert.ok(!JSON.stringify(detail).includes(uid), "Standings carry no player IDs");

  // Close: the tie splits first and second place; Cat takes third; Dom gets nothing.
  const end = now + 71 * MIN;
  await t.settleDueTournaments(end);
  await t.settleTournament(paidId, end);
  const pot = 352_000_000;
  assert.equal(cash("u-ann") - 900_000_000 + cash("u-ben") - 900_000_000, Math.floor((pot * 80) / 100) + (pot - Math.floor((pot * 80) / 200) * 2 - Math.floor((pot * 20) / 100)));
  assert.equal(cash("u-cat"), 900_000_000 + Math.floor((pot * 20) / 100));
  assert.equal(cash("u-dom"), 900_000_000);
  assert.equal(cash(`escrow:tournament:${paidId}`), 0);
  assert.equal(cash(HOUSE), 48_000_000, "The house keeps 12% of the entries");
  assert.equal(totalCash(), liabilitiesWithEve, "Settlement conserves SOL");
  const settled = await t.tournamentDetail("u-ann", paidId, end);
  assert.equal(settled.status, "settled");
  assert.deepEqual(settled.you, { score: 40, done: true, started: true, rank: 1, payout: cash("u-ann") - 900_000_000 });
  const inbox = await listNotifications("u-cat");
  assert.deepEqual([inbox.items[0].kind, inbox.items[0].data.rank, inbox.items[0].data.players, inbox.items[0].data.payout], ["tournament_result", 3, 3, 70_400_000]);
  assert.equal((await listNotifications("u-dom")).items[0].data.rank, null);
  assert.ok(!JSON.stringify(inbox).includes("u-cat"));

  // A free gem tournament pays prizes from the house; nobody playing leaves nothing to pay.
  const freeGems = await t.createTournament({ ...base, name: "Gem Rush", asset: "gems", entry: "free", prize: "1000", payout: "winner", places: 2 }, now);
  const before = gems("u-dom");
  await t.registerForTournament("u-dom", freeGems, now + MIN);
  assert.equal(gems("u-dom"), before, "A free entry costs nothing");
  await t.startTournamentRun("u-dom", freeGems, live);
  await t.settleDueTournaments(end);
  assert.equal(gems("u-dom"), before + 1000);

  // Paid gem entries are refunded when nobody plays.
  const quiet = await t.createTournament({ ...base, name: "Quiet Cup", asset: "gems", entryFee: "100", payout: "winner", places: 2 }, now);
  await t.registerForTournament("u-ben", quiet, now + MIN);
  const benGems = gems("u-ben");
  await t.settleDueTournaments(end);
  assert.equal(gems("u-ben"), benGems + 100);
  await assert.rejects(() => t.registerForTournament("u-ann", quiet, now + MIN), /closed/);

  // Free SOL tournament: the house funds the prize; cancelling returns it and any entries.
  fund(HOUSE, 2_000_000_000);
  const houseBefore = cash(HOUSE);
  const freeSol = await t.createTournament({ ...base, name: "House Cup", entry: "free", prize: "1.5", payout: "top3", places: 4 }, now);
  assert.equal(cash(HOUSE), houseBefore - 1_500_000_000);
  await t.registerForTournament("u-ann", freeSol, now + MIN);
  await t.cancelTournament(freeSol, now + 2 * MIN);
  assert.equal(cash(HOUSE), houseBefore);
  assert.equal(cash(`escrow:tournament:${freeSol}`), 0);
  await t.cancelTournament(freeSol, now + 3 * MIN).catch(() => {});
  assert.equal(cash(HOUSE), houseBefore, "Cancelling twice returns the prize once");
  const called = (await listNotifications("u-ann")).items.find((n) => n.kind === "tournament_result" && n.data.name === "House Cup");
  assert.deepEqual([called.data.rank, called.data.refund], [null, 0], "Entrants hear about a cancellation");

  // Closing early pays out on the scores so far.
  const early = await t.createTournament({ ...base, name: "Early Close", entryFee: "0.2", payout: "winner", places: 2 }, now);
  await t.registerForTournament("u-cat", early, now + MIN);
  await t.registerForTournament("u-dom", early, now + MIN);
  const catBefore = cash("u-cat");
  sqlite.prepare("UPDATE tournaments SET starts_at = ? WHERE id = ?").run(now + 2 * MIN, early);
  await t.startTournamentRun("u-cat", early, now + 3 * MIN);
  await t.closeTournamentNow(early, now + 4 * MIN);
  assert.equal(cash("u-cat"), catBefore + 352_000_000);
  assert.equal((await t.adminTournaments(now + 4 * MIN)).find((x) => x.id === early).status, "settled");

  console.log(
    "PASS: prize presets and splits (fewer players, ties, dust), validation, capacity, one entry each, registration and play windows, same-board runs, conserved SOL with the 12% house share, tie payouts, notifications without player IDs, free gem prizes, refunds when nobody plays, house-funded SOL prizes and idempotent cancellation, early close.",
  );
} finally {
  close();
}
