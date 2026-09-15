import type { PayoutPreset, TournamentStatus, TournamentSummary } from "@/lib/api-types";
import { amount } from "./format";

export const PAYOUT_LABELS: Record<PayoutPreset, string> = { winner: "Winner takes all", top3: "Top 3 paid", top10: "Top 10 paid" };

export const STATUS_LABELS: Record<TournamentStatus, string> = {
  registration: "Registration open",
  live: "Live",
  closing: "Paying out",
  settled: "Finished",
  cancelled: "Cancelled",
};

/** "2d 4h", "3h 12m", "45m", "30s": the largest two units left. */
export function duration(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m`;
  return `${s}s`;
}

export function timing(t: TournamentSummary, now: number) {
  if (t.status === "registration") return `Starts in ${duration(t.startsAt - now)}`;
  if (t.status === "live") return `Ends in ${duration(t.endsAt - now)}`;
  if (t.status === "closing") return "Results any second";
  return new Date(t.endsAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export const entryLabel = (t: TournamentSummary) => (t.entryFee ? amount(t.entryFee, t.asset) : "Free");

/** The pot to advertise: what it would be when full while seats remain, otherwise what it is. */
export const headlinePot = (t: TournamentSummary) => (t.status === "registration" && t.entryFee ? t.maxPot : t.pot);

export const ordinal = (n: number) => `${n}${[, "st", "nd", "rd"][((n % 100) >> 3) ^ 1 && n % 10] || "th"}`;
