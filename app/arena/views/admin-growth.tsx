import type { AdminGrowth as Growth } from "@/lib/api-types";
import styles from "./admin.module.css";

const percent = (n: number | null) => (n === null ? "—" : `${(n * 100).toFixed(1)}%`);
const date = (n: number) => new Date(n).toLocaleDateString("en", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });

export function AdminGrowth({ growth }: { growth: Growth | undefined }) {
  if (!growth) return <p className={styles.loading}>Loading retention and deposit conversion…</p>;
  const d = growth.deposits;
  return (
    <>
      <section className={styles.section} aria-label="Retention">
        <div className={styles.sectionHead}>
          <div>
            <h2>Retention</h2>
            <p>
              Unique signed-in players seen today / the last 7 / 30 UTC calendar days, including today. Tracking began {date(growth.trackedSince)}; earlier visits are
              unavailable.
            </p>
          </div>
        </div>
        <div className={styles.stats}>
          {(
            [
              ["day", "Daily active"],
              ["week", "Weekly active"],
              ["month", "Monthly active"],
            ] as const
          ).map(([key, label]) => (
            <div className={styles.stat} key={key}>
              <span>{label}</span>
              <b>{growth.active[key].toLocaleString("en")}</b>
            </div>
          ))}
        </div>
        <div className={styles.scroll} tabIndex={0} role="region" aria-label="Retention cohorts">
          <table className={styles.table} style={{ marginTop: 14, minWidth: 560 }}>
            <thead>
              <tr>
                <th>Return day</th>
                <th>Retention</th>
                <th>Returned / eligible</th>
                <th>Signup cohort (UTC)</th>
              </tr>
            </thead>
            <tbody>
              {growth.retention.map((r) => (
                <tr key={r.day}>
                  <td>
                    <b>D{r.day}</b>
                  </td>
                  <td className={styles.numeric}>{percent(r.rate)}</td>
                  <td className={styles.numeric}>
                    {r.returned} / {r.eligible}
                  </td>
                  <td>{r.from < r.to ? `${date(r.from)} – ${date(r.to - 1)}` : "Awaiting complete cohorts"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={styles.fine}>
          Return on exactly day 1, 7 or 30 after signup. Each rate uses up to 30 signup days whose return day has fully elapsed. Only cohorts tracked from a complete signup day
          count; no eligible players means no rate.
        </p>
      </section>

      <section className={styles.section} aria-label="First deposit conversion">
        <div className={styles.sectionHead}>
          <div>
            <h2>
              First deposit <small>· devnet SOL</small>
            </h2>
            <p>
              Confirmed positive deposits only, once per player. Treasury deposits, tips and pending or failed transfers are excluded. The 7-day rate covers signups from{" "}
              {date(d.cohortFrom)} to {date(d.cohortTo)}, with a full 7-day observation window.
            </p>
          </div>
        </div>
        <div className={styles.stats}>
          <div className={styles.stat}>
            <span>Registered → first deposit</span>
            <b>{percent(d.rate)}</b>
            <small>
              {d.converted} / {d.registered} players · all time
            </small>
          </div>
          <div className={styles.stat}>
            <span>First deposit within 7 days</span>
            <b>{percent(d.rate7d)}</b>
            <small>{d.converted7d} / {d.eligible7d} eligible players</small>
          </div>
          <div className={styles.stat}>
            <span>First depositors</span>
            <b>
              {d.firstDepositors.day} / {d.firstDepositors.week} / {d.firstDepositors.month}
            </b>
            <small>24h / 7d / 30d</small>
          </div>
        </div>
      </section>
    </>
  );
}
