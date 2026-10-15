"use client";
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { RANK_TIERS, RANKS, rankName, type RankTier } from "@/lib/levels";
import { request } from "../api";
import { RankEmblem } from "../rank-badge";
import { rankColor } from "../rank-art";
import styles from "./admin.module.css";
import own from "./admin-ranked.module.css";

/** What /api/admin/ranked answers: placed players by division, Bouncers on their own. */
type Distribution = { season: number; startsAt: number; endsAt: number; divisions: number[]; bouncers: number; unranked: number; placed: number };

const REFRESH_MS = 60_000;
const day = (at: number) => new Date(at).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const share = (n: number, of: number) => (of ? `${((n / of) * 100).toFixed(n && n / of < 0.01 ? 1 : 0)}%` : "—");

/**
 * The season's ladder as a bar chart, one bar per division and one for the
 * Bouncers, so a pile-up anywhere — everyone stuck in Silver, nobody past
 * Gold — shows at a glance.
 */
export function AdminRanked() {
  const [data, setData] = useState<Distribution | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [now, setNow] = useState(0);

  useEffect(() => {
    let active = true;
    const load = () =>
      request<Distribution>("/api/admin/ranked").then(
        (next) => {
          if (!active) return;
          setData(next);
          setError("");
          setNow(Date.now());
        },
        (e: Error) => active && setError(e.message),
      );
    void load();
    const timer = setInterval(() => !document.hidden && void load(), REFRESH_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [reload]);

  if (!data) return error ? <div className="error" role="alert"><span>{error}</span></div> : <p className="muted">Loading the season…</p>;

  const bars = [
    ...RANKS.slice(0, 18).map((rank, i) => ({ key: `${rank.tier}${rank.division}`, tier: rank.tier, division: rank.division, label: rankName(rank.tier, rank.division), count: data.divisions[i] ?? 0 })),
    { key: "bouncer", tier: "bouncer" as RankTier, division: null, label: "Bouncer", count: data.bouncers },
  ];
  const tallest = Math.max(1, ...bars.map((b) => b.count));
  const byTier = RANK_TIERS.map((tier) => ({ tier, count: bars.filter((b) => b.tier === tier).reduce((sum, b) => sum + b.count, 0) }));
  const median = (() => {
    // The division the middle placed player sits in.
    let seen = 0;
    for (const bar of bars) {
      seen += bar.count;
      if (seen * 2 >= data.placed && data.placed) return bar.label;
    }
    return "—";
  })();
  const daysLeft = Math.max(0, Math.ceil((data.endsAt - (now || data.startsAt)) / 86_400_000));

  return (
    <>
      {error && (
        <div className="error" role="alert">
          <span>Could not refresh: {error}</span>
        </div>
      )}
      <section className={styles.section}>
        <div className={styles.stats}>
          <div className={styles.stat}>
            <span>Season {data.season}</span>
            <b>{daysLeft} days left</b>
            <small>
              {day(data.startsAt)} – {day(data.endsAt - 1)}
            </small>
          </div>
          <div className={styles.stat}>
            <span>Placed players</span>
            <b>{data.placed.toLocaleString("en")}</b>
            <small>{data.unranked.toLocaleString("en")} still playing their placements</small>
          </div>
          <div className={styles.stat}>
            <span>Middle of the ladder</span>
            <b>{median}</b>
            <small>Where the median placed player sits</small>
          </div>
          <div className={styles.stat}>
            <span>Bouncers</span>
            <b>{data.bouncers}</b>
            <small>Of fifty places, from Diamond 3 up</small>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.panel}>
          <div className={styles.panelHead}>
            <h3>Players by division</h3>
            <button className="btn" onClick={() => setReload((n) => n + 1)} aria-label="Refresh the distribution">
              <RefreshCw size={14} /> Refresh
            </button>
          </div>
          {data.placed ? (
            <>
              <div className={own.chart} role="img" aria-label={`Placed players by division: ${bars.map((b) => `${b.label} ${b.count}`).join(", ")}`}>
                {bars.map((bar) => (
                  <div key={bar.key} className={own.column} title={`${bar.label}: ${bar.count} (${share(bar.count, data.placed)})`}>
                    <span className={own.value}>{bar.count || ""}</span>
                    <span className={own.bar} style={{ height: `${(bar.count / tallest) * 100}%`, background: rankColor(bar.tier) }} />
                    <span className={own.division}>{bar.division ?? "B"}</span>
                  </div>
                ))}
              </div>
              <ul className={own.tiers}>
                {byTier.map(({ tier, count }) => (
                  <li key={tier} style={{ flexGrow: tier === "bouncer" ? 1 : 3 }}>
                    <RankEmblem tier={tier} division={null} size={22} />
                    <span>{rankName(tier, null)}</span>
                    <b>{share(count, data.placed)}</b>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="muted">Nobody has finished their placement matches this season yet.</p>
          )}
        </div>
      </section>
    </>
  );
}
