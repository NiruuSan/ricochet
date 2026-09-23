"use client";
import { Tooltip } from "@/components/ui/tooltip";

import { Form } from "@/components/ui/form";
import { useActionDialog } from "@/components/ui/action-dialog";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Ban, Check, Eye, Flag, RotateCcw, Save } from "lucide-react";
import type { AdminRaceWeek, RacePrize } from "@/lib/api-types";
import { request } from "../api";
import { units } from "../format";
import styles from "./admin.module.css";
import { prizeLabel } from "./weekly-race";

type AdminRaces = { prizes: RacePrize[]; weeks: AdminRaceWeek[] };
type PrizeInput = { sol: string; gems: string };

const dayLabel = (ms: number) => new Date(ms).toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" });
const moment = (ms: number) => new Date(ms).toLocaleString("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
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
    <Form className={styles.panel} onSubmit={save}>
      <div className={styles.panelHead}>
        <h3>What the podium pays</h3>
        <span>SOL leaves the treasury house balance when you confirm a week.</span>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="success" role="status">
          {notice}
        </p>
      )}
      <div className={styles.form}>
        {values.map((v, i) => (
          <div key={i} className={styles.full}>
            <div className="field-row" style={{ gridTemplateColumns: "84px minmax(0, 1fr) minmax(0, 1fr)", marginTop: 0 }}>
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
          </div>
        ))}
      </div>
      <div className={styles.formActions}>
        <button className="btn btn-primary" disabled={busy}>
          <Save /> {busy ? "Saving…" : "Save prizes"}
        </button>
      </div>
    </Form>
  );
}

function RaceWeek({ week, prizes, busy, onAction }: { week: AdminRaceWeek; prizes: RacePrize[]; busy: boolean; onAction: (body: Record<string, unknown>, question?: string) => void }) {
  const dialog = useActionDialog();
  const state = week.paid
    ? { label: `Paid ${moment(week.paid.at)}`, tone: styles.ok }
    : week.ended
      ? { label: "Ended · awaiting your review", tone: styles.warn }
      : { label: "Live", tone: styles.calm };
  const top = week.standings.slice(0, 3);
  const total = top.reduce((sum, _, i) => sum + (prizes[i]?.sol ?? 0), 0);
  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <h3>
          <Flag size={15} /> {dayLabel(week.weekStart)} – {dayLabel(week.weekEnd - 1)}
          <span className={`${styles.chip} ${state.tone}`}>{state.label}</span>
        </h3>
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
        <div className={styles.scroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Rank</th>
                <th>Player</th>
                <th>Best score</th>
                <th className={styles.right}>Paid</th>
              </tr>
            </thead>
            <tbody>
              {week.paid.winners.map((w) => (
                <tr key={w.rank}>
                  <td>#{w.rank}</td>
                  <td>
                    <Link href={`/players/${encodeURIComponent(w.name)}`}>{w.name}</Link>
                  </td>
                  <td className={styles.numeric}>{w.score.toLocaleString("en")} pts</td>
                  <td className={`${styles.right} lime`}>{prizeLabel(w)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : week.standings.length ? (
        <div className={styles.scroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Rank</th>
                <th>Player</th>
                <th>Best score</th>
                <th>Set</th>
                <th className={styles.right}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {week.standings.map((s) => (
                <tr key={s.name}>
                  <td className={s.rank === 1 ? "lime" : undefined}>#{s.rank}</td>
                  <td>
                    <Link href={`/players/${encodeURIComponent(s.name)}`}>{s.name}</Link>
                    {s.rank <= 3 && <small style={{ display: "block", color: "#8291a8" }}>{prizeLabel(prizes[s.rank - 1])}</small>}
                  </td>
                  <td className={styles.numeric}>{s.score.toLocaleString("en")}</td>
                  <td style={{ color: "#8291a8" }}>{moment(s.at)}</td>
                  <td>
                    <div className={styles.actions}>
                      {s.watchId && (
                        <Tooltip content="Replay this run">
                          <Link aria-label="Replay this run" className="btn" href={`/watch/${s.watchId}`}>
                            <Eye size={15} />
                          </Link>
                        </Tooltip>
                      )}
                      <button
                        className="btn btn-danger"
                        disabled={busy}
                        onClick={async () => {
                          const reason = await dialog.prompt(`Exclude ${s.name} from the week of ${dayLabel(week.weekStart)}? Give a reason (kept in the audit log).`, { title: "Exclude player from race", confirmLabel: "Exclude player", danger: true });
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
        </div>
      ) : (
        <p className={styles.empty}>No real-money scores this week yet.</p>
      )}

      {week.excluded.length > 0 && (
        <div className={styles.list} style={{ marginTop: 14 }}>
          {week.excluded.map((x) => (
            <div key={x.name} className={styles.row}>
              <div className={styles.who}>
                <Ban size={16} color="#ffb2bf" />
                <div>
                  <b>{x.name}</b>
                  <span>Excluded · {x.reason}</span>
                </div>
              </div>
              <div />
              <div className={styles.actions}>
                {!week.paid && (
                  <button className="btn" disabled={busy} onClick={() => onAction({ action: "include", week: week.weekStart, name: x.name })}>
                    <RotateCcw size={15} /> Restore
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function AdminRace() {
  const dialog = useActionDialog();
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
    if (question && !(await dialog.confirm(question, { title: "Confirm race payout", confirmLabel: "Confirm payout" }))) return;
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

  if (!data) return <p className={styles.loading}>{error || "Loading the weekly race…"}</p>;
  return (
    <section className={styles.section}>
      <PrizeSettings key={JSON.stringify(data.prizes)} prizes={data.prizes} onSaved={() => void load()} />
      {error && (
        <div className="error" role="alert">
          <span>{error}</span>
        </div>
      )}
      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>Weeks</h2>
        </div>
        {data.weeks.map((week) => (
          <RaceWeek key={week.weekStart} week={week} prizes={data.prizes} busy={busy} onAction={(body, question) => void act(body, question)} />
        ))}
      </div>
    </section>
  );
}
