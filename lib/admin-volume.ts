import type { Database } from "@/db/raw";
import type { Period, VolumePoint, VolumeTotals } from "./api-types";

const HOUR = 3_600_000;
const MONTH_HOURS = 30 * 24;
const WINDOWS: Record<Period, { count: number; hours: number }> = {
  day: { count: 24, hours: 1 },
  week: { count: 7, hours: 24 },
  month: { count: 30, hours: 24 },
};

/** Query hourly aggregates once, then build matching rolling totals and chart points. */
export async function volumeHistory(
  db: Database,
  now: number,
  table: string,
  value: string,
  filter: string,
  timestamp = "created",
  args: unknown[] = [],
): Promise<VolumeTotals> {
  const start = now - MONTH_HOURS * HOUR;
  const { results } = await db.prepare(`
    SELECT MIN(${MONTH_HOURS - 1}, CAST((${timestamp} - ?) / ? AS INTEGER)) AS bucket,
      SUM(${value}) AS value
    FROM ${table}
    WHERE ${filter} AND ${timestamp} >= ? AND ${timestamp} <= ?
    GROUP BY bucket
  `).bind(start, HOUR, ...args, start, now).all<{ bucket: number; value: number }>();
  const hourly = Array<number>(MONTH_HOURS).fill(0);
  for (const row of results) hourly[Number(row.bucket)] = Number(row.value);

  const series = {} as Record<Period, VolumePoint[]>;
  const totals = {} as Record<Period, number>;
  for (const period of Object.keys(WINDOWS) as Period[]) {
    const { count, hours } = WINDOWS[period];
    const offset = MONTH_HOURS - count * hours;
    series[period] = Array.from({ length: count }, (_, i) => {
      const first = offset + i * hours;
      return {
        start: start + first * HOUR,
        end: start + (first + hours) * HOUR,
        value: hourly.slice(first, first + hours).reduce((sum, amount) => sum + amount, 0),
      };
    });
    totals[period] = series[period].reduce((sum, point) => sum + point.value, 0);
  }
  return { ...totals, series };
}
