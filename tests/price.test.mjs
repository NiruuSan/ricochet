import assert from "node:assert/strict";
import { createDatabase } from "./helpers/test-env.mjs";

// What a SOL is worth, for the amounts shown beside the SOL ones.
//
// The rate decides nothing — no balance, stake or payout is computed from it —
// so the only things that matter are that a page never waits on a price API,
// that a bad answer cannot poison what is shown, and that a rate nobody has
// been able to refresh for a day stops being shown at all.
const { sqlite, close } = await createDatabase();
const price = await import("../lib/price.ts");

const SETTING = () => sqlite.prepare("SELECT value FROM app_settings WHERE key = 'sol_price'").get()?.value;
let calls = 0;
let answer = { solana: { usd: 200, eur: 185 } };
let fail = false;
globalThis.fetch = async () => {
  calls++;
  if (fail) throw new Error("offline");
  return { ok: true, json: async () => answer };
};

const NOW = Date.UTC(2026, 8, 23, 12);

try {
  // The first ask fetches once and keeps the answer.
  const first = await price.solPrice(NOW);
  assert.deepEqual([first.usd, first.eur, first.at], [200, 185, NOW]);
  assert.equal(calls, 1);
  assert.ok(SETTING(), "It is kept for every other instance and visitor");

  // Within the window, nobody asks the source again.
  await price.solPrice(NOW + 60_000);
  assert.equal(calls, 1, "One lookup serves everybody for ten minutes");

  // After it, a stale rate is served at once and refreshed behind the request.
  answer = { solana: { usd: 240, eur: 220 } };
  const stale = await price.solPrice(NOW + 11 * 60_000);
  assert.equal(stale.usd, 200, "The page is never made to wait on a price API");
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(calls, 2);
  assert.equal((await price.solPrice(NOW + 11 * 60_000 + 1)).usd, 240, "And the new rate is there for the next reader");

  // A source that is down, or answering nonsense, changes nothing.
  fail = true;
  price.forgetPrice();
  assert.equal((await price.solPrice(NOW + 30 * 60_000)).usd, 240, "The last good rate stands");
  fail = false;
  answer = { solana: { usd: "lots", eur: null } };
  price.forgetPrice();
  const afterJunk = await price.solPrice(NOW + 60 * 60_000);
  assert.equal(afterJunk.usd, 240, "Nonsense is refused rather than shown");
  assert.equal(JSON.parse(SETTING()).usd, 240);

  // A rate nobody could refresh for a day is not shown at all.
  price.forgetPrice();
  fail = true;
  assert.equal(await price.solPrice(NOW + 40 * 60 * 60_000), null, "Better no figure than a day-old one");

  console.log("PASS: SOL price (one shared lookup, a cached window, stale served while it refreshes, a dead or nonsense source ignored, and a day-old rate withdrawn).");
} finally {
  close();
}
