import type { Currency } from "@/lib/price";

// The money the player reads the site in.
//
// The game is played in SOL and every balance, stake and payout is held in
// lamports; this only decides how those figures are *written*. A player who
// picks euros sees euros everywhere — not a second reading beside the SOL one —
// because a figure they cannot value is worse than no figure at all.
//
// Two rules keep it honest:
//
// - it is a lens, never an amount. Nothing here is ever used to compute a
//   balance, a stake or a payout, and the wallet's deposit and withdrawal
//   figures stay in SOL, because that is what leaves the chain;
// - without a live rate there is nothing to convert to, so the site falls back
//   to SOL rather than inventing a number.
//
// The store is a plain module rather than a context: app/arena/format.ts is a
// set of pure functions called from every view, and it reads the choice from
// here. Arena subscribes at the root, so a change repaints the whole page.

export type Display = "sol" | Currency;
export const DISPLAYS: Display[] = ["sol", "usd", "eur"];

const KEY = "bounce.money";
/** The key the old "second reading" setting used, so nobody loses their choice. */
const OLD_KEY = "bounce.fiat";
/** The server caches the lookup; this is only how often a tab asks for it. */
const REFRESH = 10 * 60_000;

export type Money = { choice: Display; rate: number | null };

/** The default until the browser says otherwise: what the server rendered. */
let money: Money = { choice: "sol", rate: null };
let rates: { usd: number; eur: number } | null = null;
let started = false;
const listeners = new Set<() => void>();

const rateFor = (choice: Display) => (choice === "sol" || !rates ? null : rates[choice]);
const announce = () => {
  for (const listener of listeners) listener();
};
const settle = (choice: Display) => {
  const next = { choice, rate: rateFor(choice) };
  if (next.choice === money.choice && next.rate === money.rate) return;
  money = next;
  announce();
};

/** What every amount on the page is written in right now. */
export const currentMoney = (): Money => money;

/** For `useSyncExternalStore`: the object only changes when the display does. */
export const moneySnapshot = () => money;
export function subscribeMoney(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function setMoney(choice: Display) {
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    // Not remembering it is better than losing the click.
  }
  settle(choice);
  if (choice !== "sol") void pull();
}

async function pull() {
  try {
    const next = (await (await fetch("/api/price", { cache: "no-store" })).json()) as { usd: number | null; eur: number | null };
    if (typeof next.usd !== "number" || typeof next.eur !== "number") return;
    rates = { usd: next.usd, eur: next.eur };
    settle(money.choice);
  } catch {
    // No rate means the site keeps writing SOL, which is always true.
  }
}

/**
 * Reads the stored choice and keeps the rate fresh. Called once, from the
 * arena's root, after mounting: reading it during the first render would make
 * the page disagree with the HTML the server sent.
 */
export function startMoney() {
  if (started) return;
  started = true;
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(KEY) ?? ({ usd: "usd", eur: "eur", off: "sol" }[localStorage.getItem(OLD_KEY) ?? ""] ?? null);
  } catch {
    stored = null;
  }
  if (stored && (DISPLAYS as string[]).includes(stored)) settle(stored as Display);
  if (money.choice !== "sol") void pull();
  setInterval(() => {
    if (money.choice !== "sol" && !document.hidden) void pull();
  }, REFRESH);
}

/** Tests: back to a page nobody has touched. */
export function forgetMoney() {
  money = { choice: "sol", rate: null };
  rates = null;
  started = false;
}

/** Tests: a rate without a network. */
export function primeMoney(choice: Display, next: { usd: number; eur: number } | null) {
  rates = next;
  money = { choice, rate: rateFor(choice) };
}
