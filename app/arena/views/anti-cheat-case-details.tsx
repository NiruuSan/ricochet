"use client";
import { useState } from "react";
import { ENTRY_BATCH, ShowMore } from "@/components/ui/show-more";
import Link from "next/link";
import { Ban, Eye, RotateCcw, UserX } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { useActionDialog } from "@/components/ui/action-dialog";
import type { CheatCase, CheatSignalView } from "@/lib/anti-cheat-admin";
import { QUALITY } from "@/lib/anti-cheat-rules";
import { units } from "../format";
import styles from "./tournaments.module.css";
import review from "./anti-cheat.module.css";
export const CASE_STATUS: Record<CheatCase["status"], { label: string; color: string }> = {
  suspended: { label: "SUSPENDED · TO REVIEW", color: "#ffb86b" },
  banned: { label: "BANNED", color: "#ff8091" },
  lifted: { label: "LIFTED", color: "#c6f564" },
  watch: { label: "WATCHLIST · NOT SUSPENDED", color: "#7fd6ff" },
};
const SOURCE: Record<string, string> = { proof: "Automatic · technical proof", stats: "Automatic · statistics", admin: "Administrator", watch: "Last signal" };
const percent = (value: number | null) => (value === null ? "—" : `${Math.round(value * 100)}%`);

/** Whether a trap record is enough to turn a high average into evidence (lib/anti-cheat-rules.ts). */
const corroborating = (traps: { rounds: number; trapped: number }) =>
  traps.rounds >= QUALITY.minTrapRounds && traps.trapped >= QUALITY.corroboratingTraps && traps.trapped / traps.rounds >= QUALITY.corroboratingTrapShare;

const detailText = (detail: Record<string, unknown>) =>
  Object.entries(detail)
    .map(([key, value]) => `${key}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`)
    .join(" · ");

export function SignalRow({ signal, name }: { signal: CheatSignalView; name?: string }) {
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
          <Tooltip content="Replay this run"><Link aria-label="Replay this run" className="btn" href={`/watch/${signal.runKey}`}>
            <Eye size={15} />
          </Link></Tooltip>
        )}
      </td>
    </tr>
  );
}

export function CaseDetails({ item, busy, onAction }: { item: CheatCase; busy: boolean; onAction: (body: Record<string, unknown>, question?: string) => void }) {
  const [signalLimit, setSignalLimit] = useState(ENTRY_BATCH);
  const dialog = useActionDialog();
  const status = CASE_STATUS[item.status];
  const decide = async (action: "lift" | "ban" | "suspend") => {
    const text = await dialog.prompt(
      action === "lift" ? `Lift ${item.name}'s suspension? Write why (kept in the audit log).` : action === "ban" ? `Ban ${item.name}? Write why (kept in the audit log).` : `Suspend ${item.name} for review? Write why (kept in the audit log).`,
      { title: action === "lift" ? "Lift suspension" : action === "ban" ? "Review player ban" : "Suspend player", confirmLabel: action === "ban" ? "Review ban" : "Continue", danger: action !== "lift" },
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
          <h2 style={{ marginTop: 6 }}>Case overview</h2>
          <p className={styles.muted} style={{ marginTop: 4 }}>
            {SOURCE[item.source] ?? item.source} · {new Date(item.created).toLocaleString()}
          </p>
          <p style={{ marginTop: 8, fontSize: 14 }}>{item.reason}</p>
          {item.note && <p className={styles.muted}>Review note: {item.note}</p>}
          {item.reviewedAt && <p className={styles.muted}>Last reviewed {new Date(item.reviewedAt).toLocaleString()}</p>}
        </div>
        {(item.status === "watch" || item.status === "lifted") && (
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
      <div className={review.metrics}>
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
          <span className={styles.muted}>
            Average percentile among all angles · a case opens from {percent(item.stats.qualityThreshold)}, but an average alone only suspends above{" "}
            {percent(QUALITY.solverMean)} or with the traps agreeing.
          </span>
        </div>
        <div className={styles.stat}>
          <small className={styles.muted}>AIM VARIETY</small>
          <b style={{ color: item.stats.angleShare !== null && item.stats.angleShare > item.stats.maxAngleShare ? "#ffb86b" : undefined }}>
            {item.stats.angleShare === null ? "—" : `${Math.round(item.stats.angleShare * 100)}% one angle`}
          </b>
          <span className={styles.muted}>
            Largest share of shots aimed within a few degrees of each other. Above {percent(item.stats.maxAngleShare)} they are repeating one shot, not solving each board.
          </span>
        </div>
        <div className={styles.stat}>
          <small className={styles.muted}>GHOST TRAPS</small>
          {/* Chance puts a person in one now and again: the colour follows the rule, not the count. */}
          <b style={{ color: corroborating(item.stats.traps) ? "#ff8091" : item.stats.traps.trapped ? "#ffb86b" : undefined }}>
            {item.stats.traps.trapped} / {item.stats.traps.rounds}
          </b>
          <span className={styles.muted}>
            Rounds with ghost bricks, and shots aimed at them. A person aims at what they see; {percent(QUALITY.corroboratingTrapShare)} of the rounds or more says
            otherwise.
          </span>
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
      <h2 className={review.evidenceHeading}>Player signals & replays</h2>
      {item.signals.length > 0 ? (
        <div className={review.signalTable}><table className={styles.table} aria-label="Player signals and replays">
          <tbody>
            {item.signals.slice(0, signalLimit).map((signal, i) => (
              <SignalRow key={i} signal={signal} />
            ))}
          </tbody>
        </table></div>
      ) : <p className={styles.muted}>No signals recorded for this player.</p>}
      <ShowMore shown={Math.min(signalLimit, item.signals.length)} total={item.signals.length} onShowMore={() => setSignalLimit((current) => current + ENTRY_BATCH)} label="signals" />
    </section>
  );
}
