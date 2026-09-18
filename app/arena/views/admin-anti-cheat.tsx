"use client";
import { ENTRY_BATCH, ShowMore } from "@/components/ui/show-more";

import { Form } from "@/components/ui/form";
import { useActionDialog } from "@/components/ui/action-dialog";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Power, ShieldAlert, UserX } from "lucide-react";
import type { AntiCheatOverview, CheatCase } from "@/lib/anti-cheat-admin";
import { request } from "../api";
import { CASE_STATUS, SignalRow } from "./anti-cheat-case-details";
import review from "./anti-cheat.module.css";
import styles from "./tournaments.module.css";

function CaseSummary({ item }: { item: CheatCase }) {
  const status = CASE_STATUS[item.status];
  return <Link href={`/admin/anti-cheat/${encodeURIComponent(item.name)}`} className={review.caseCard} aria-label={`Review ${item.name}`}>
    <div className={review.cardTop}><span style={{ color: status.color }}>{status.label}</span><ArrowUpRight size={17} /></div>
    <h3>{item.name}</h3>
    <p className={review.reason}>{item.reason}</p>
    <div className={review.cardMetrics}><span>Shot quality <b>{item.stats.meanQuality === null ? "—" : `${Math.round(item.stats.meanQuality * 100)}%`}</b></span><span>Ghost hits <b>{item.stats.traps.trapped}/{item.stats.traps.rounds}</b></span></div>
    <div className={review.cardFooter}><span>{new Date(item.created).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span><span>Review case <ArrowUpRight size={12} /></span></div>
  </Link>;
}
export function AdminAntiCheat() {
  const dialog = useActionDialog();
  const [data, setData] = useState<AntiCheatOverview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");
  const [signalLimit, setSignalLimit] = useState(ENTRY_BATCH);

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
    if (question && !(await dialog.confirm(question, { title: body.action === "ban" ? "Ban & seize balances" : "Change automatic sanctions", confirmLabel: body.action === "ban" ? "Ban & seize" : "Confirm change", danger: true }))) return;
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
        <Form
          className={`field-row ${review.suspendForm}`}
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
        </Form>
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
            <div className={review.caseGrid}>{data.cases.map((item) => <CaseSummary key={item.name} item={item} />)}</div>
          ) : (
            <p className={styles.empty}>No suspended players.</p>
          )}
          <h2 style={{ margin: "30px 0 4px" }}>Watchlist</h2>
          <p className={styles.muted}>Players worth a look (modified game page, sudden jump in results). Nothing happens to them unless you suspend.</p>
          {data.watchlist.length ? (
            <div className={review.caseGrid}>{data.watchlist.map((item) => <CaseSummary key={item.name} item={item} />)}</div>
          ) : (
            <p className={styles.empty}>Nobody on the watchlist.</p>
          )}
          <h2 style={{ margin: "30px 0 4px" }}>Latest signals</h2>
          <p className={styles.muted}>Every observation, including those below a sanction threshold.</p>
          {data.recentSignals.length ? (
            <div className={review.signalTable}><table className={styles.table} aria-label="Latest signals">
              <tbody>
                {data.recentSignals.slice(0, signalLimit).map((signal, i) => (
                  <SignalRow key={i} signal={signal} name={signal.name} />
                ))}
              </tbody>
            </table></div>
          ) : (
            <p className={styles.empty}>No signals yet.</p>
          )}
          <ShowMore shown={Math.min(signalLimit, data.recentSignals.length)} total={data.recentSignals.length} onShowMore={() => setSignalLimit((current) => current + ENTRY_BATCH)} label="signals" />
        </>
      )}
    </>
  );
}
