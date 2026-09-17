"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Ban, Eye, Power, RotateCcw, ShieldAlert, UserX } from "lucide-react";
import type { AntiCheatOverview, CheatCase, CheatSignalView } from "@/lib/anti-cheat-admin";
import { request } from "../api";
import { units } from "../format";
import styles from "./tournaments.module.css";

const STATUS: Record<CheatCase["status"], { label: string; color: string }> = {
  suspended: { label: "SUSPENDED · TO REVIEW", color: "#ffb86b" },
  banned: { label: "BANNED", color: "#ff8091" },
  lifted: { label: "LIFTED", color: "#c6f564" },
  watch: { label: "WATCHLIST · NOT SUSPENDED", color: "#7fd6ff" },
};
const SOURCE: Record<string, string> = { proof: "Automatic · technical proof", stats: "Automatic · statistics", admin: "Administrator", watch: "Last signal" };
const percent = (value: number | null) => (value === null ? "—" : `${Math.round(value * 100)}%`);

const detailText = (detail: Record<string, unknown>) =>
  Object.entries(detail)
    .map(([key, value]) => `${key}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`)
    .join(" · ");

function SignalRow({ signal, name }: { signal: CheatSignalView; name?: string }) {
  return (
    <tr>
      <td style={{ width: 150 }} className={styles.muted}>
        {new Date(signal.created).toLocaleString()}
      </td>
      {name !== undefined && (
        <td>
          <Link href={`/players/${encodeURIComponent(name)}`}>{name}</Link>
        </td>
      )}
      <td>
        <b style={{ color: signal.level === "proof" ? "#ff8091" : "#ffb86b" }}>{signal.label}</b>
        <div className={styles.muted} style={{ overflowWrap: "anywhere" }}>
          {detailText(signal.detail)}
        </div>
      </td>
      <td>
        {signal.runKey && (
          <Link className="btn" href={`/watch/${signal.runKey}`} title="Replay this run">
            <Eye size={15} />
          </Link>
        )}
      </td>
    </tr>
  );
}

function CaseCard({ item, busy, onAction }: { item: CheatCase; busy: boolean; onAction: (body: Record<string, unknown>, question?: string) => void }) {
  const status = STATUS[item.status];
  const decide = (action: "lift" | "ban" | "suspend") => {
    const text = window.prompt(
      action === "lift" ? `Lift ${item.name}'s suspension? Write why (kept in the audit log).` : action === "ban" ? `Ban ${item.name}? Write why (kept in the audit log).` : `Suspend ${item.name} for review? Write why (kept in the audit log).`,
    );
    if (text === null) return;
    onAction(
      { action, name: item.name, note: text },
      action === "ban"
        ? `Ban ${item.name} and seize ${units(item.balances.sol, "devnet")} SOL and ${units(item.balances.gems, "gems")} gems? Their unsettled matches go to their opponents. This cannot be undone.`
        : undefined,
    );
  };
  return (
    <section className={styles.panel} style={{ marginTop: 16 }}>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
        <div>
          <span style={{ color: status.color, fontSize: 11, fontWeight: 800, letterSpacing: 1 }}>{status.label}</span>
          <h3 style={{ marginTop: 6 }}>
            <Link href={`/players/${encodeURIComponent(item.name)}`}>{item.name}</Link>
          </h3>
          <p className={styles.muted} style={{ marginTop: 4 }}>
            {SOURCE[item.source] ?? item.source} · {new Date(item.created).toLocaleString()}
          </p>
          <p style={{ marginTop: 8, fontSize: 14 }}>{item.reason}</p>
          {item.note && <p className={styles.muted}>Review note: {item.note}</p>}
        </div>
        {item.status === "watch" && (
          <div className="row-actions">
            <button className="btn" style={{ borderColor: "#ff8091", color: "#ffb2bf" }} disabled={busy} onClick={() => decide("suspend")}>
              <UserX size={15} /> Suspend
            </button>
          </div>
        )}
        {item.status === "suspended" && (
          <div className="row-actions">
            <button className="btn" disabled={busy} onClick={() => decide("lift")}>
              <RotateCcw size={15} /> Lift
            </button>
            <button className="btn" style={{ borderColor: "#ff8091", color: "#ffb2bf" }} disabled={busy} onClick={() => decide("ban")}>
              <Ban size={15} /> Ban & seize
            </button>
          </div>
        )}
      </div>
      <div className={styles.stats} style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
        <div className={styles.stat}>
          <small className={styles.muted}>BALANCE</small>
          <b>{units(item.balances.sol, "devnet")} SOL</b>
          <span className={styles.muted}>{units(item.balances.gems, "gems")} gems</span>
        </div>
        <div className={styles.stat}>
          <small className={styles.muted}>SOL WINS · 30 DAYS</small>
          <b>{item.winnings.solMatchesWon}</b>
          <span className={styles.muted}>net {units(item.winnings.solMatchNet, "devnet")} SOL</span>
        </div>
        <div className={styles.stat}>
          <small className={styles.muted}>PRIZES · 30 DAYS</small>
          <b>{units(item.winnings.tournamentPrizes + item.winnings.racePrizes, "devnet")} SOL</b>
          <span className={styles.muted}>
            tournaments {units(item.winnings.tournamentPrizes, "devnet")} · race {units(item.winnings.racePrizes, "devnet")}
          </span>
        </div>
        <div className={styles.stat}>
          <small className={styles.muted}>HARD SHOTS PERFECT</small>
          <b>{item.stats.hardHitRate === null ? "—" : `${Math.round(item.stats.hardHitRate * 100)}%`}</b>
          <span className={styles.muted}>
            {item.stats.hardShots} hard of {item.stats.analyzedShots} analyzed · aim {item.stats.meanAimMs ?? "—"} ms
          </span>
        </div>
        <div className={styles.stat}>
          <small className={styles.muted}>SHOT QUALITY</small>
          <b style={{ color: item.stats.meanQuality !== null && item.stats.meanQuality >= item.stats.qualityThreshold ? "#ff8091" : undefined }}>{percent(item.stats.meanQuality)}</b>
          <span className={styles.muted}>Average percentile among all angles · flagged from {percent(item.stats.qualityThreshold)}</span>
        </div>
        <div className={styles.stat}>
          <small className={styles.muted}>GHOST TRAPS</small>
          <b style={{ color: item.stats.traps.trapped ? "#ff8091" : undefined }}>
            {item.stats.traps.trapped} / {item.stats.traps.rounds}
          </b>
          <span className={styles.muted}>Rounds with ghost bricks, and shots aimed at them. A person aims at what they see.</span>
        </div>
        <div className={styles.stat}>
          <small className={styles.muted}>AIM TRAJECTORIES</small>
          <b>{item.stats.aim.trails ? `${item.stats.aim.samples} pts · ${item.stats.aim.reversals} turns` : "—"}</b>
          <span className={styles.muted}>
            Medians over {item.stats.aim.trails} trails · timing irregularity {item.stats.aim.gapCv === null ? "—" : item.stats.aim.gapCv.toFixed(2)}
          </span>
        </div>
        <div className={styles.stat}>
          <small className={styles.muted}>SHOTS WITHOUT AIMING</small>
          <b>{item.stats.stillAimRate === null ? "—" : `${Math.round(item.stats.stillAimRate * 100)}%`}</b>
          <span className={styles.muted}>Aim never moved before the shot. Watch the replays: touch players can tap straight to their angle.</span>
        </div>
      </div>
      {item.signals.length > 0 && (
        <table className={styles.table}>
          <tbody>
            {item.signals.map((signal, i) => (
              <SignalRow key={i} signal={signal} />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export function AdminAntiCheat() {
  const [data, setData] = useState<AntiCheatOverview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");

  const load = useCallback(
    () =>
      request<AntiCheatOverview>("/api/admin/anti-cheat").then(
        (next) => (setData(next), setError("")),
        (e: Error) => setError(e.message),
      ),
    [],
  );

  useEffect(() => {
    let active = true;
    request<AntiCheatOverview>("/api/admin/anti-cheat").then(
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
      await request("/api/admin/anti-cheat", body);
      await load();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const open = data?.cases.filter((c) => c.status === "suspended").length ?? 0;
  return (
    <>
      <section className={styles.panel}>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <h2 style={{ fontSize: 20, display: "flex", alignItems: "center", gap: 8 }}>
            <ShieldAlert size={20} /> Anti-cheat
          </h2>
          {data && (
            <button
              className="btn"
              role="switch"
              aria-checked={data.enabled}
              disabled={busy}
              style={data.enabled ? { borderColor: "#c6f564", color: "#c6f564" } : { borderColor: "#ff8091", color: "#ffb2bf" }}
              onClick={() =>
                void act(
                  { action: "toggle", enabled: !data.enabled },
                  data.enabled
                    ? "Turn off automatic sanctions? Checks keep running and are recorded, but nobody is suspended or loses a match automatically until you turn them back on."
                    : "Turn automatic sanctions back on?",
                )
              }
            >
              <Power size={15} /> {data.enabled ? "Sanctions on" : "Sanctions off"}
            </button>
          )}
        </div>
        {data && !data.enabled && (
          <p className="error" role="status" style={{ marginTop: 12 }}>
            Automatic sanctions are off. Detections are still recorded below, marked as not sanctioned. Existing suspensions still apply.
          </p>
        )}
        <p className="muted" style={{ marginTop: 6, fontSize: 13 }}>
          Technical proof (automation browser, scripted input, skipped animations) suspends a player at once and hands their unsettled matches to their opponents. Statistical signals
          (superhuman precision or rhythm on SOL shots) suspend for your review. Suspended players cannot play, withdraw or tip until you lift or ban.
        </p>
        <form
          className="field-row"
          style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 2fr) auto" }}
          onSubmit={(e) => {
            e.preventDefault();
            void act({ action: "suspend", name, note: reason }).then((ok) => ok && (setName(""), setReason("")));
          }}
        >
          <label className="field" style={{ margin: 0 }}>
            Player
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} required placeholder="Player name" />
          </label>
          <label className="field" style={{ margin: 0 }}>
            Reason
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} placeholder="Reported by several players" />
          </label>
          <button className="btn" disabled={busy}>
            <UserX size={15} /> Suspend
          </button>
        </form>
      </section>
      {error && (
        <div className="error" role="alert" style={{ marginTop: 16 }}>
          <span>{error}</span>
        </div>
      )}
      {!data ? (
        <p className="muted" style={{ marginTop: 16 }}>
          Loading anti-cheat cases…
        </p>
      ) : (
        <>
          <h2 style={{ margin: "30px 0 4px" }}>Cases {open > 0 && <span className={styles.muted}>· {open} to review</span>}</h2>
          {data.cases.length ? (
            data.cases.map((item) => <CaseCard key={item.name} item={item} busy={busy} onAction={(body, question) => void act(body, question)} />)
          ) : (
            <p className={styles.empty}>No suspended players.</p>
          )}
          <h2 style={{ margin: "30px 0 4px" }}>Watchlist</h2>
          <p className={styles.muted}>Players worth a look (modified game page, sudden jump in results). Nothing happens to them unless you suspend.</p>
          {data.watchlist.length ? (
            data.watchlist.map((item) => <CaseCard key={item.name} item={item} busy={busy} onAction={(body, question) => void act(body, question)} />)
          ) : (
            <p className={styles.empty}>Nobody on the watchlist.</p>
          )}
          <h2 style={{ margin: "30px 0 4px" }}>Latest signals</h2>
          <p className={styles.muted}>Every observation, including those below a sanction threshold.</p>
          {data.recentSignals.length ? (
            <table className={styles.table}>
              <tbody>
                {data.recentSignals.map((signal, i) => (
                  <SignalRow key={i} signal={signal} name={signal.name} />
                ))}
              </tbody>
            </table>
          ) : (
            <p className={styles.empty}>No signals yet.</p>
          )}
        </>
      )}
    </>
  );
}
