import type { Asset, MatchSummary } from "@/lib/api-types";

const solFormat = new Intl.NumberFormat("en", { maximumFractionDigits: 4 });
const gemFormat = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

/** Lamports to a short SOL amount. */
export const sol = (lamports: number) => solFormat.format(lamports / 1e9);

/** A bare amount in the currency's display units: whole gems, or SOL. */
export const units = (value: number, asset: Asset) => (asset === "gems" ? gemFormat.format(value) : sol(value));

export const CURRENCY: Record<Asset, string> = { gems: "gems", devnet: "SOL" };

/** An amount with its unit, e.g. "1,250 gems" or "0.1 SOL". */
export const amount = (value: number, asset: Asset) => `${units(value, asset)} ${CURRENCY[asset]}`;

export const signedAmount = (value: number, asset: Asset) => `${value > 0 ? "+" : ""}${units(value, asset)}`;

export const shortId = (id: string) => id.slice(0, 8).toUpperCase();

export const initials = (name: string) => name.slice(0, 2).toUpperCase();

export const shortDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });

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
