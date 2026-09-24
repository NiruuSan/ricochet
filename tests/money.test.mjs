import assert from "node:assert/strict";
import "./helpers/test-env.mjs";

// The money the site is written in.
//
// Every figure stays in lamports; this is only how they are written. The three
// things that must hold: gems are never converted, a player who reads in euros
// sees euros and the word SOL nowhere near a figure, and without a rate the
// site says SOL rather than inventing a number.
const money = await import("../app/arena/money.ts");
const { amount, assetName, currency, exactSol, fullSol, units } = await import("../app/arena/format.ts");

const SOL = 1_000_000_000;
const RATES = { usd: 200, eur: 185 };

try {
  // Nobody has chosen anything: the site is written in what it is played in.
  assert.equal(units(SOL / 10, "devnet"), "0.1");
  assert.equal(amount(SOL / 10, "devnet"), "0.1 SOL");
  assert.equal(currency("devnet"), "SOL");
  assert.equal(assetName("devnet"), "Devnet SOL");

  // A player reading in euros sees euros, and the unit follows the figure.
  money.primeMoney("eur", RATES);
  assert.equal(units(SOL / 10, "devnet"), "18.50");
  assert.equal(amount(SOL / 10, "devnet"), "18.50 EUR");
  assert.equal(currency("devnet"), "EUR");
  assert.equal(assetName("devnet"), "EUR");
  assert.equal(amount(SOL / 2, "devnet"), "92.50 EUR", "half a SOL, at 185 a SOL");

  // Dollars are the same lens over the same lamports.
  money.primeMoney("usd", RATES);
  assert.equal(amount(SOL / 10, "devnet"), "20.00 USD");

  // Past a thousand the cents say nothing and the figure has to stay readable.
  assert.equal(units(300 * SOL, "devnet"), "60,000");

  // Gems are gems: no rate touches them, whatever the player reads in.
  assert.equal(amount(4_000, "gems"), "4,000 gems");
  assert.equal(assetName("gems"), "Gems");

  // The wallet's own figure follows the choice too.
  assert.equal(fullSol(SOL / 10), "20.00");
  // But anything that moves on-chain keeps its exact SOL amount.
  assert.equal(exactSol(SOL / 10), "0.1");
  assert.equal(exactSol(123_456_789), "0.123456789");

  // A rate nobody could fetch is not a reason to write a wrong number.
  money.primeMoney("eur", null);
  assert.equal(amount(SOL / 10, "devnet"), "0.1 SOL");
  assert.equal(currency("devnet"), "SOL");
  assert.equal(assetName("devnet"), "Devnet SOL");

  // And a player can always come back to the currency they play in.
  money.primeMoney("sol", RATES);
  assert.equal(amount(SOL / 10, "devnet"), "0.1 SOL");

  // A fresh page starts where the server rendered it, not where the browser left it.
  money.forgetMoney();
  assert.deepEqual(money.currentMoney(), { choice: "sol", rate: null });

  console.log("PASS: money (SOL by default, euros and dollars everywhere once chosen, gems untouched, exact SOL for the chain, and SOL again when no rate is known)");
} catch (e) {
  console.error(e);
  process.exit(1);
}
