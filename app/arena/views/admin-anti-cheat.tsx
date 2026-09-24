"use client";
import { ENTRY_BATCH, ShowMore } from "@/components/ui/show-more";

import { Form } from "@/components/ui/form";
import { PlayerNameInput } from "@/components/ui/player-name-input";
import { useActionDialog } from "@/components/ui/action-dialog";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Power, UserX } from "lucide-react";
import type { AntiCheatOverview, CheatCase } from "@/lib/anti-cheat-admin";
import type { CollusionPair } from "@/lib/collusion";
import { request } from "../api";
import { Avatar } from "../avatar";
import { amount, units } from "../format";
import { CASE_STATUS, SignalRow } from "./anti-cheat-case-details";
import review from "./anti-cheat.module.css";
import styles from "./admin.module.css";

function CaseSummary({ item }: { item: CheatCase }) {
  const status = CASE_STATUS[item.status];
  return (
    <Link href={`/admin/anti-cheat/${encodeURIComponent(item.name)}`} className={review.caseCard} aria-label={`Review ${item.name}`}>
      <div className={review.cardTop}>
        <span style={{ color: status.color }}>
          {status.label}
          {item.restricted && item.status === "suspended" && " · MONEY ONLY"}
        </span>
        <ArrowUpRight size={17} />
      </div>
      {/* A case whose player has answered is the one to read first. */}
      {item.appeal && <span className={review.answered}>ANSWERED</span>}
      <h3>{item.name}</h3>
      <p className={review.reason}>{item.reason}</p>
      <div className={review.cardMetrics}>
        <span>
          Shot quality <b>{item.stats.meanQuality === null ? "—" : `${Math.round(item.stats.meanQuality * 100)}%`}</b>
        </span>
        <span>
          Ghost hits{" "}
          <b>
            {item.stats.traps.trapped}/{item.stats.traps.rounds}
          </b>
        </span>
      </div>
      <div className={review.cardFooter}>
        <span>{new Date(item.created).toLocaleDateString("en", { month: "short", day: "numeric" })}</span>
        <span>
          Review case <ArrowUpRight size={12} />
        </span>
      </div>
    </Link>
  );
}

const PAIR_REASON: Record<CollusionPair["reasons"][number], string> = {
  mostly_each_other: "They mostly play each other",
  one_sided: "One of them wins nearly every time",
  tips_between: "Tips between them",
};

/** One pair of accounts whose real-money history together is worth a look. */
function PairRow({ pair }: { pair: CollusionPair }) {
  const [winner, loser] = pair.net >= 0 ? pair.players : [pair.players[1], pair.players[0]];
  return (
    <div className={review.pairRow}>
      <div className={review.pairPlayers}>
        {pair.players.map((side) => (
          <Link key={side.name} href={`/players/${encodeURIComponent(side.name)}`} className={review.pairPlayer}>
            <Avatar name={side.name} src={side.avatar} size={28} />
            <span>
              <b>{side.name}</b>
              <small>
                {side.wins} {side.wins === 1 ? "win" : "wins"} · {Math.round(side.share * 100)}% of their SOL matches
              </small>
            </span>
          </Link>
        ))}
      </div>
      <div className={review.pairFacts}>
        <span>
          Matches <b>{pair.matches}</b>
        </span>
        <span>
          Money moved{" "}
          <b>
            {amount(Math.abs(pair.net), "devnet")} → {winner.name}
          </b>
        </span>
        <span>
          Tips <b>{pair.tips ? `${pair.tips} · ${amount(pair.tipped, "devnet")}` : "—"}</b>
        </span>
      </div>
      <div className={review.pairReasons}>
        {pair.reasons.map((reason) => (
          <span key={reason}>{PAIR_REASON[reason]}</span>
        ))}
        <small>
          Last match {new Date(pair.lastAt).toLocaleDateString("en", { month: "short", day: "numeric" })} · from {loser.name}
        </small>
      </div>
    </div>
  );
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
    <section className={styles.section}>
      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <h3>Automatic sanctions</h3>
          {data && (
            <button
              className={`btn ${data.enabled ? "" : "btn-danger"}`}
              role="switch"
              aria-checked={data.enabled}
              disabled={busy}
              style={data.enabled ? { borderColor: "#c6f564", color: "#c6f564" } : undefined}
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
          <p className="error" role="status">
            Automatic sanctions are off. Detections are still recorded below, marked as not sanctioned. Existing suspensions still apply.
          </p>
        )}
        <p className={styles.fine}>
          Technical proof (automation browser, scripted input, skipped animations) suspends a player at once, hands their unsettled matches to their opponents and closes their
          account until you lift or ban. Statistics (superhuman precision, rhythm, or an average the ghost traps agree with) open a review instead: SOL entries, tournaments,
          withdrawals and tips are held, while practice and gems stay open — a suspicion should not take the game away from somebody who is simply good. Players can answer their
          case; the ones who have are marked ANSWERED.
        </p>
        <Form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            void act({ action: "suspend", name, note: reason }).then((ok) => ok && (setName(""), setReason("")));
          }}
        >
          <div className="field">
            <label htmlFor="suspension-player-name">Player</label>
            <PlayerNameInput id="suspension-player-name" scope="admin" value={name} onValueChange={setName} required placeholder="Player name" />
          </div>
          <label className="field">
            Reason
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} placeholder="Reported by several players" />
          </label>
          <div className={`${styles.formActions} ${styles.full}`}>
            <button className="btn btn-danger" disabled={busy}>
              <UserX size={15} /> Suspend
            </button>
          </div>
        </Form>
      </section>

      {error && (
        <div className="error" role="alert">
          <span>{error}</span>
        </div>
      )}

      {!data ? (
        <p className={styles.loading}>Loading anti-cheat cases…</p>
      ) : (
        <>
          <div className={styles.section}>
            <div className={styles.sectionHead}>
              <h2>Cases {open > 0 && <small>· {open} to review</small>}</h2>
            </div>
            {data.cases.length ? <div className={review.caseGrid}>{data.cases.map((item) => <CaseSummary key={item.name} item={item} />)}</div> : <p className={styles.empty}>No suspended players.</p>}
          </div>

          <div className={styles.section}>
            <div className={styles.sectionHead}>
              <div>
                <h2>Watchlist</h2>
                <p>Players worth a look (modified game page, sudden jump in results). Nothing happens to them unless you suspend.</p>
              </div>
            </div>
            {data.watchlist.length ? <div className={review.caseGrid}>{data.watchlist.map((item) => <CaseSummary key={item.name} item={item} />)}</div> : <p className={styles.empty}>Nobody on the watchlist.</p>}
          </div>

          <div className={styles.section}>
            <div className={styles.sectionHead}>
              <div>
                <h2>Paired accounts</h2>
                <p>
                  Real-money pairs whose history together looks arranged rather than played: they mostly meet each other, or one of them wins nearly every time. Friends do play
                  each other, so nothing happens automatically — open a profile and suspend only if the pattern convinces you.
                </p>
              </div>
            </div>
            {data.collusion.length ? (
              <div className={review.pairList}>
                {data.collusion.map((pair) => (
                  <PairRow key={pair.players.map((side) => side.name).join("-")} pair={pair} />
                ))}
              </div>
            ) : (
              <p className={styles.empty}>No pair worth a look.</p>
            )}
          </div>

          <div className={styles.section}>
            <div className={styles.sectionHead}>
              <div>
                <h2>Latest signals</h2>
                <p>Every observation, including those below a sanction threshold.</p>
              </div>
            </div>
            {data.recentSignals.length ? (
              <div className={styles.scroll}>
                <table className={styles.table} aria-label="Latest signals">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Player</th>
                      <th>What the game saw</th>
                      <th className={styles.right}>Run</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentSignals.slice(0, signalLimit).map((signal, i) => (
                      <SignalRow key={i} signal={signal} name={signal.name} />
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className={styles.empty}>No signals yet.</p>
            )}
            <ShowMore shown={Math.min(signalLimit, data.recentSignals.length)} total={data.recentSignals.length} onShowMore={() => setSignalLimit((current) => current + ENTRY_BATCH)} label="signals" />
          </div>
        </>
      )}
    </section>
  );
}
