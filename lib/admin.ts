import { database } from "@/db/raw";
import type { AdminOverview, Period, PeriodTotals } from "./api-types";
import { avatarUrl, ONLINE_MS } from "./matches";
import { HOUSE } from "./payments/accounts";

const DAY = 86_400_000;
const PERIODS: Record<Period, number> = { day: DAY, week: 7 * DAY, month: 30 * DAY };

/** `SUM` over each rolling period, as three columns named day, week and month. */
const byPeriod = (value: string, created = "created") =>
  (Object.keys(PERIODS) as Period[]).map((p) => `COALESCE(SUM(CASE WHEN ${created} >= ? THEN ${value} ELSE 0 END), 0) AS ${p}`).join(", ");

type Totals = PeriodTotals & Record<string, unknown>;
const totals = (row: Totals | null): PeriodTotals => ({ day: Number(row?.day ?? 0), week: Number(row?.week ?? 0), month: Number(row?.month ?? 0) });

/** Player counts and rolling volumes for the administrator dashboard. */
export async function adminOverview(now = Date.now()): Promise<AdminOverview> {
  const db = database();
  const since = (Object.values(PERIODS) as number[]).map((ms) => now - ms);
  const monthAgo = since[2];
  const [players, online, devEntries, devMatches, deposits, withdrawals, devFees, gemEntries, gemMatches, gemFees] = await Promise.all([
    db
      .prepare("SELECT COUNT(*) AS registered, COALESCE(SUM(CASE WHEN last_seen >= ? THEN 1 ELSE 0 END), 0) AS online FROM players")
      .bind(now - ONLINE_MS)
      .first<{ registered: number; online: number }>(),
    db.prepare("SELECT name, avatar FROM players WHERE last_seen >= ? ORDER BY last_seen DESC LIMIT 24").bind(now - ONLINE_MS).all<{ name: string; avatar: string | null }>(),
    // Devnet SOL staked into matches by players.
    db.prepare(`SELECT ${byPeriod("-amount")} FROM cash_ledger WHERE kind = 'match_entry' AND created >= ?`).bind(...since, monthAgo).first<Totals>(),
    db.prepare(`SELECT ${byPeriod("1")} FROM matches WHERE asset = 'devnet' AND created >= ?`).bind(...since, monthAgo).first<Totals>(),
    db
      .prepare(`SELECT ${byPeriod("amount", "updated")} FROM cash_transfers WHERE kind = 'deposit' AND status = 'finalized' AND user_id <> ? AND updated >= ?`)
      .bind(...since, HOUSE, monthAgo)
      .first<Totals>(),
    db
      .prepare(`SELECT ${byPeriod("amount", "updated")} FROM cash_transfers WHERE kind = 'withdrawal' AND status = 'finalized' AND updated >= ?`)
      .bind(...since, monthAgo)
      .first<Totals>(),
    db.prepare(`SELECT ${byPeriod("amount")} FROM cash_ledger WHERE kind = 'house_fee' AND created >= ?`).bind(...since, monthAgo).first<Totals>(),
    db.prepare(`SELECT ${byPeriod("-amount")} FROM ledger WHERE kind = 'entry' AND created >= ?`).bind(...since, monthAgo).first<Totals>(),
    db.prepare(`SELECT ${byPeriod("1")} FROM matches WHERE asset = 'gems' AND created >= ?`).bind(...since, monthAgo).first<Totals>(),
    db.prepare(`SELECT ${byPeriod("fee")} FROM matches WHERE asset = 'gems' AND settled = 1 AND created >= ?`).bind(...since, monthAgo).first<Totals>(),
  ]);
  const registered = Number(players?.registered ?? 0);
  const onlineCount = Number(players?.online ?? 0);
  return {
    players: {
      registered,
      online: onlineCount,
      offline: registered - onlineCount,
      onlineNames: online.results.map((p) => ({ name: p.name, avatar: avatarUrl(p.avatar) })),
    },
    devnet: { entries: totals(devEntries), matches: totals(devMatches), deposits: totals(deposits), withdrawals: totals(withdrawals), fees: totals(devFees) },
    gems: { entries: totals(gemEntries), matches: totals(gemMatches), fees: totals(gemFees) },
    generated: now,
  };
}
