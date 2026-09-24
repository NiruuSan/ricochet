import type { Asset, MatchSummary } from "@/lib/api-types";
import { currentMoney } from "./money";

const solFormat = new Intl.NumberFormat("en", { maximumFractionDigits: 4 });
const gemFormat = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });
const fiatFormat = new Intl.NumberFormat("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Past a thousand the cents say nothing, and the figure has to stay readable. */
const bigFiatFormat = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

/** Lamports to a short SOL amount. */
export const sol = (lamports: number) => solFormat.format(lamports / 1e9);

/** Lamports to the last decimal, for the wallet and anything that moves on-chain. */
export const exactSol = (lamports: number) => (lamports / 1e9).toLocaleString("en", { maximumFractionDigits: 9 });

/**
 * What a devnet amount is worth in the money the player reads in, or null when
 * they read in SOL — or when no rate is known, which is the same thing.
 */
function inFiat(lamports: number) {
  const { choice, rate } = currentMoney();
  if (choice === "sol" || !rate || !Number.isFinite(lamports)) return null;
  return (lamports / 1e9) * rate;
}

const written = (value: number) => (Math.abs(value) >= 1000 ? bigFiatFormat : fiatFormat).format(value);

/** A bare amount in the display units: whole gems, SOL, or the player's own money. */
export function units(value: number, asset: Asset) {
  if (asset === "gems") return gemFormat.format(value);
  const converted = inFiat(value);
  return converted === null ? sol(value) : written(converted);
}

/** The same, to the last decimal when it is still SOL. */
export function fullSol(lamports: number) {
  const converted = inFiat(lamports);
  return converted === null ? exactSol(lamports) : written(converted);
}

/** The unit written beside an amount: "gems", "SOL", or the currency it is read in. */
export function currency(asset: Asset) {
  if (asset === "gems") return "gems";
  const { choice, rate } = currentMoney();
  return choice === "sol" || !rate ? "SOL" : choice.toUpperCase();
}

/**
 * The name of a board or a mode: the gem game, or the money game written in
 * whatever the player reads. The network keeps its own name in the places that
 * describe where the money actually is.
 */
export const assetName = (asset: Asset) => (asset === "gems" ? "Gems" : currency(asset) === "SOL" ? "Devnet SOL" : currency(asset));

/** An amount with its unit, e.g. "1,250 gems", "0.1 SOL" or "11.46 EUR". */
export const amount = (value: number, asset: Asset) => `${units(value, asset)} ${currency(asset)}`;

export const signedAmount = (value: number, asset: Asset) => `${value > 0 ? "+" : ""}${units(value, asset)}`;

export const shortId = (id: string) => id.slice(0, 8).toUpperCase();

export const initials = (name: string) => name.slice(0, 2).toUpperCase();

export const shortDate = (ms: number) => new Date(ms).toLocaleDateString("en", { month: "short", day: "numeric" });

/** How long ago something happened, in words. */
export function timeAgo(ms: number, now = Date.now()) {
  const minutes = Math.round((now - ms) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return shortDate(ms);
}

export function outcome(m: MatchSummary) {
  if (!m.done) return "In progress";
  if (m.result === "cancelled") return m.net === 0 ? "Cancelled · fully refunded" : `Cancelled · ${Math.round((m.stake + m.net) / m.stake * 100)}% refunded`;
  if (!m.joined) return "Awaiting opponent";
  if (!m.settled) return "Opponent playing";
  if (m.result === "draw") return "Draw · refunded";
  return m.result === "win" ? "Victory" : "Defeat";
}

/** Settled profit or loss and victories across a list of matches. */
export function matchStats(matches: MatchSummary[]) {
  const settled = matches.filter((m) => m.settled);
  return {
    pnl: settled.reduce((sum, m) => sum + m.net, 0),
    wins: settled.filter((m) => m.result === "win").length,
    openEntries: matches.filter((m) => !m.settled).reduce((sum, m) => sum + m.stake, 0),
  };
}

/**
 * Hands a challenge link to whatever the device shares with, and falls back to
 * the clipboard. Returns true when the link went to the clipboard, so the
 * caller can say so.
 */
export async function shareChallenge(invite: string) {
  const url = `${window.location.origin}/?join=${invite}`;
  try {
    if (navigator.share) {
      await navigator.share({ title: "Take my challenge on Bounce", url });
      return false;
    }
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    return false;
  }
}
