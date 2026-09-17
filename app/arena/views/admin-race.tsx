"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Ban, Check, Eye, Flag, RotateCcw, Save } from "lucide-react";
import type { AdminRaceWeek, RacePrize } from "@/lib/api-types";
import { request } from "../api";
import { units } from "../format";
import styles from "./tournaments.module.css";
import { prizeLabel } from "./weekly-race";

type AdminRaces = { prizes: RacePrize[]; weeks: AdminRaceWeek[] };
type PrizeInput = { sol: string; gems: string };

const dayLabel = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
const toInput = (prizes: RacePrize[]): PrizeInput[] => prizes.map((p) => ({ sol: String(p.sol / 1e9), gems: String(p.gems) }));

function PrizeSettings({ prizes, onSaved }: { prizes: RacePrize[]; onSaved: () => void }) {
  const [values, setValues] = useState<PrizeInput[]>(() => toInput(prizes));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const set = (i: number, key: keyof PrizeInput, value: string) => setValues((current) => current.map((v, j) => (j === i ? { ...v, [key]: value } : v)));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await request("/api/admin/race", { action: "prizes", prizes: values.map((v) => ({ sol: v.sol.trim(), gems: Number(v.gems) })) });
      setNotice("Prizes saved. They apply to the next payout.");
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={`${styles.panel} ${styles.form}`} onSubmit={save}>
      <div className={styles.full}>
        <h2 style={{ fontSize: 20 }}>Weekly race prizes</h2>
        <p className="muted" style={{ marginTop: 6, fontSize: 13 }}>
          Best single score of the week in SOL matches and paid SOL tournaments. SOL is paid from the treasury house balance when you confirm a week.
        </p>
      </div>
      {error && (
        <p className={`error ${styles.full}`} role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className={`success ${styles.full}`} role="status">
          {notice}
        </p>
      )}
      {values.map((v, i) => (
        <div key={i} className={`${styles.full} field-row`} style={{ gridTemplateColumns: "90px minmax(0, 1fr) minmax(0, 1fr)", marginTop: 0 }}>
          <b style={{ paddingBottom: 14 }}>{["1st", "2nd", "3rd"][i]} place</b>
          <label className="field" style={{ margin: 0 }}>
            SOL
            <input className="input" value={v.sol} onChange={(e) => set(i, "sol", e.target.value)} inputMode="decimal" required placeholder="0.5" />
          </label>
          <label className="field" style={{ margin: 0 }}>
            Gems
            <input className="input" type="number" min={0} max={1_000_000} step={1} value={v.gems} onChange={(e) => set(i, "gems", e.target.value)} required />
          </label>
        </div>
      ))}
      <div className={styles.full} style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
        <button className="btn btn-primary" disabled={busy}>
          <Save /> {busy ? "Saving…" : "Save prizes"}
        </button>
      </div>
    </form>
  );
}

function RaceWeek({ week, prizes, busy, onAction }: { week: AdminRaceWeek; prizes: RacePrize[]; busy: boolean; onAction: (body: Record<string, unknown>, question?: string) => void }) {
  const status = week.paid ? `Paid ${new Date(week.paid.at).toLocaleString()}` : week.ended ? "Ended · awaiting your review" : "Live";
  const top = week.standings.slice(0, 3);
  const total = top.reduce((sum, _, i) => sum + (prizes[i]?.sol ?? 0), 0);
  return (
    <section className={styles.panel} style={{ marginTop: 16 }}>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div>
          <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Flag size={16} /> Week of {dayLabel(week.weekStart)} – {dayLabel(week.weekEnd - 1)}
          </h3>
          <span className={styles.muted}>{status}</span>
        </div>
        {week.ended && !week.paid && top.length > 0 && (
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={() =>
              onAction(
                { action: "pay", week: week.weekStart },
                `Pay the week of ${dayLabel(week.weekStart)}?\n\n${top.map((s, i) => `#${i + 1} ${s.name} (${s.score.toLocaleString("en")} pts): ${prizeLabel(prizes[i])}`).join("\n")}\n\n${units(total, "devnet")} SOL leaves the treasury house balance. This cannot be undone.`,
              )
            }
          >
            <Check /> Pay top {top.length}
          </button>
        )}
      </div>

      {week.paid ? (
        <table className={styles.table}>
          <tbody>
            {week.paid.winners.map((w) => (
              <tr key={w.rank}>
                <td>#{w.rank}</td>
                <td>
                  <Link href={`/players/${encodeURIComponent(w.name)}`}>{w.name}</Link>
                </td>
                <td>{w.score.toLocaleString("en")} pts</td>
                <td className={styles.positive}>{prizeLabel(w)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : week.standings.length ? (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Rank</th>
              <th>Player</th>
              <th>Best score</th>
              <th>Set</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {week.standings.map((s) => (
              <tr key={s.name}>
                <td className={s.rank === 1 ? styles.gold : undefined}>#{s.rank}</td>
                <td>
                  <Link href={`/players/${encodeURIComponent(s.name)}`}>{s.name}</Link>
                  {s.rank <= 3 && <div className={styles.muted}>{prizeLabel(prizes[s.rank - 1])}</div>}
                </td>
                <td>{s.score.toLocaleString("en")}</td>
                <td className={styles.muted}>{new Date(s.at).toLocaleString()}</td>
                <td>
                  <div className="row-actions" style={{ justifyContent: "flex-end" }}>
                    {s.watchId && (
                      <Link className="btn" href={`/watch/${s.watchId}`} title="Replay this run">
                        <Eye size={15} />
                      </Link>
                    )}
                    <button
                      className="btn"
                      style={{ borderColor: "#ff8091", color: "#ffb2bf" }}
                      disabled={busy}
                      onClick={() => {
                        const reason = window.prompt(`Exclude ${s.name} from the week of ${dayLabel(week.weekStart)}? Give a reason (kept in the audit log).`);
                        if (reason !== null) onAction({ action: "exclude", week: week.weekStart, name: s.name, reason });
                      }}
                    >
                      <Ban size={15} /> Exclude
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className={styles.muted} style={{ marginTop: 14 }}>
          No real-money scores this week yet.
        </p>
      )}

      {week.excluded.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <b style={{ fontSize: 13 }}>Excluded</b>
          {week.excluded.map((x) => (
            <div key={x.name} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 8 }}>
              <span className={styles.muted}>
                <b style={{ color: "#f6f8fd" }}>{x.name}</b> · {x.reason}
              </span>
              {!week.paid && (
                <button className="btn" disabled={busy} onClick={() => onAction({ action: "include", week: week.weekStart, name: x.name })}>
                  <RotateCcw size={15} /> Restore
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function AdminRace() {
  const [data, setData] = useState<AdminRaces | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () =>
      request<AdminRaces>("/api/admin/race").then(
        (next) => (setData(next), setError("")),
        (e: Error) => setError(e.message),
      ),
    [],
  );

  useEffect(() => {
    let active = true;
    request<AdminRaces>("/api/admin/race").then(
      (next) => active && setData(next),
      (e: Error) => active && setError(e.message),
    );
    const timer = setInterval(() => !document.hidden && void load(), 30_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [load]);

  const act = async (body: Record<string, unknown>, question?: string) => {
    if (question && !window.confirm(question)) return;
    setBusy(true);
    setError("");
    try {
      await request("/api/admin/race", body);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <p className="muted">{error || "Loading the weekly race…"}</p>;
  return (
    <>
      <PrizeSettings key={JSON.stringify(data.prizes)} prizes={data.prizes} onSaved={() => void load()} />
      {error && (
        <div className="error" role="alert" style={{ marginTop: 16 }}>
          <span>{error}</span>
        </div>
      )}
      {data.weeks.map((week) => (
        <RaceWeek key={week.weekStart} week={week} prizes={data.prizes} busy={busy} onAction={(body, question) => void act(body, question)} />
      ))}
    </>
  );
}
