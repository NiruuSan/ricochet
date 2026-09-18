import { database } from "@/db/raw";
import type { AdminGrowth } from "./api-types";
import { HOUSE } from "./payments/accounts";

const DAY = 86_400_000;
const rate = (n: number, d: number) => d ? n / d : null;

/** UTC calendar-day retention; only fully observed signup cohorts enter its denominator. */
export async function adminGrowth(now = Date.now()): Promise<AdminGrowth> {
  const db = database();
  const today = Math.floor(now / DAY) * DAY;
  const metadata = await db.prepare("SELECT value FROM analytics_metadata WHERE key = 'started'").first<{ value: number }>();
  const trackedSince = metadata?.value ?? now;
  const firstFullDay = Math.ceil(trackedSince / DAY) * DAY;
  const [activity, retention, deposits] = await Promise.all([
    db.prepare(`SELECT COUNT(DISTINCT CASE WHEN day >= ? THEN user_id END) AS day,
      COUNT(DISTINCT CASE WHEN day >= ? THEN user_id END) AS week,
      COUNT(DISTINCT user_id) AS month FROM player_activity WHERE day >= ? AND day <= ?`)
      .bind(today, today - 6 * DAY, today - 29 * DAY, today).first<AdminGrowth["active"]>(),
    Promise.all([1, 7, 30].map(async (day) => {
      const to = today - day * DAY;
      const from = Math.max(firstFullDay, to - 30 * DAY);
      const row = await db.prepare(`SELECT COUNT(*) AS eligible,
        COALESCE(SUM(EXISTS(SELECT 1 FROM player_activity a WHERE a.user_id = p.id
          AND a.day = CAST(p.created / ? AS INTEGER) * ? + ?)), 0) AS returned
        FROM players p WHERE p.created >= ? AND p.created < ?`)
        .bind(DAY, DAY, day * DAY, from, to).first<{ eligible: number; returned: number }>();
      const eligible = Number(row?.eligible ?? 0), returned = Number(row?.returned ?? 0);
      return { day, eligible, returned, rate: rate(returned, eligible), from, to };
    })),
    db.prepare(`WITH first_deposit AS (
      SELECT user_id, MIN(updated) AS at FROM cash_transfers
      WHERE kind = 'deposit' AND status = 'finalized' AND network = 'devnet' AND amount > 0
        AND user_id <> ? AND updated <= ? GROUP BY user_id
    ) SELECT COUNT(*) AS registered, COUNT(f.at) AS converted,
      COALESCE(SUM(p.created >= ? AND p.created <= ?), 0) AS eligible7d,
      COALESCE(SUM(p.created >= ? AND p.created <= ? AND f.at <= p.created + ?), 0) AS converted7d,
      COALESCE(SUM(f.at >= ?), 0) AS day, COALESCE(SUM(f.at >= ?), 0) AS week,
      COALESCE(SUM(f.at >= ?), 0) AS month
      FROM players p LEFT JOIN first_deposit f ON f.user_id = p.id AND f.at >= p.created
      WHERE p.created <= ?`)
      .bind(HOUSE, now, now - 37 * DAY, now - 7 * DAY, now - 37 * DAY, now - 7 * DAY, 7 * DAY,
        now - DAY, now - 7 * DAY, now - 30 * DAY, now)
      .first<{ registered: number; converted: number; eligible7d: number; converted7d: number; day: number; week: number; month: number }>(),
  ]);
  const d = deposits!;
  return {
    trackedSince, active: activity!, retention,
    deposits: { registered: d.registered, converted: d.converted, rate: rate(d.converted, d.registered),
      eligible7d: d.eligible7d, converted7d: d.converted7d, rate7d: rate(d.converted7d, d.eligible7d),
      cohortFrom: now - 37 * DAY, cohortTo: now - 7 * DAY,
      firstDepositors: { day: d.day, week: d.week, month: d.month } },
  };
}
