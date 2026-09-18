import type { AdminGrowth as Growth } from "@/lib/api-types";
import styles from "./admin-growth.module.css";

const percent = (n: number | null) => n === null ? "—" : `${(n * 100).toFixed(1)}%`;
const date = (n: number) => new Date(n).toLocaleDateString("en", { timeZone: "UTC" });

export function AdminGrowth({ growth }: { growth: Growth | undefined }) {
  if (!growth) return <p className="muted">Loading retention and deposit conversion…</p>;
  const d = growth.deposits;
  return <section style={{ marginTop: 35 }} aria-label="Retention and deposit conversion">
    <h2>Retention</h2>
    <div className="stat-grid">
      {([['day', 'Daily active'], ['week', 'Weekly active'], ['month', 'Monthly active']] as const).map(([key, label]) =>
        <div className="stat-card" key={key}><span className="muted">{label}</span><b>{growth.active[key].toLocaleString("en")}</b></div>)}
    </div>
    <p className="fine">Unique signed-in players seen today / the last 7 / 30 UTC calendar days, including today. Tracking began {date(growth.trackedSince)}; earlier visits are unavailable.</p>
    <div className={styles.scroll} tabIndex={0} role="region" aria-label="Retention cohorts">
      <table className={styles.table}>
        <thead><tr><th>Return day</th><th>Retention</th><th>Returned / eligible</th><th>Signup cohort (UTC)</th></tr></thead>
        <tbody>{growth.retention.map((r) => <tr key={r.day}>
          <td>D{r.day}</td><td>{percent(r.rate)}</td><td>{r.returned} / {r.eligible}</td>
          <td>{r.from < r.to ? `${date(r.from)} – ${date(r.to - 1)}` : "Awaiting complete cohorts"}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <p className="fine">Return on exactly day 1, 7 or 30 after signup. Each rate uses up to 30 signup days whose return day has fully elapsed. Only cohorts tracked from a complete signup day count; no eligible players means no rate.</p>
    <h2 style={{ marginTop: 28 }}>First deposit conversion · devnet SOL</h2>
    <div className="stat-grid">
      <div className="stat-card"><span className="muted">Registered → first deposit · all time</span><b>{percent(d.rate)}</b><small>{d.converted} / {d.registered} players</small></div>
      <div className="stat-card"><span className="muted">First deposit within 7 days</span><b>{percent(d.rate7d)}</b><small>{d.converted7d} / {d.eligible7d} eligible players</small></div>
      <div className="stat-card"><span className="muted">First depositors · 24h / 7d / 30d</span><b>{d.firstDepositors.day} / {d.firstDepositors.week} / {d.firstDepositors.month}</b></div>
    </div>
    <p className="fine">Confirmed positive deposits only, once per player. Treasury deposits, tips and pending or failed transfers are excluded. The 7-day rate covers signups from {date(d.cohortFrom)} to {date(d.cohortTo)}, with a full 7-day observation window.</p>
  </section>;
}
