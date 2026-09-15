import type { MatchSummary } from "@/lib/api-types";

const solFormat = new Intl.NumberFormat("en", { maximumFractionDigits: 4 });

/** Lamports to a short SOL amount. */
export const sol = (lamports: number) => solFormat.format(lamports / 1e9);

export const shortId = (id: string) => id.slice(0, 8).toUpperCase();

export const initials = (name: string) => name.slice(0, 2).toUpperCase();

export const shortDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });

export const signed = (lamports: number) => `${lamports > 0 ? "+" : ""}${sol(lamports)}`;

export function outcome(m: MatchSummary) {
  if (!m.done) return "In progress";
  if (m.result === "cancelled") return "Cancelled · 88% refunded";
  if (!m.joined) return "Awaiting opponent";
  if (!m.settled) return "Opponent playing";
  if (m.result === "draw") return "Draw · refunded";
  return m.result === "win" ? "Victory" : "Defeat";
}

export const LEDGER_LABELS: Record<string, string> = {
  entry: "Match entry",
  payout: "Match payout",
  refund: "Match refund",
};

/** Settled profit or loss and victories across a list of matches. */
export function matchStats(matches: MatchSummary[]) {
  const settled = matches.filter((m) => m.settled);
  return {
    pnl: settled.reduce((sum, m) => sum + m.net, 0),
    wins: settled.filter((m) => m.result === "win").length,
    openEntries: matches.filter((m) => !m.settled).reduce((sum, m) => sum + m.stake, 0),
  };
}
