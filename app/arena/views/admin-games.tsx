"use client";
import { Tooltip } from "@/components/ui/tooltip";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Eye } from "lucide-react";
import { useActionDialog } from "@/components/ui/action-dialog";
import type { AdminGame } from "@/lib/api-types";
import { request } from "../api";
import { Avatar } from "../avatar";
import { amount, timeAgo } from "../format";
import styles from "./admin.module.css";

const REFRESH_MS = 15_000;

/** What the match is waiting for right now, and how loudly to say it. */
function status(g: AdminGame): { label: string; tone: string } {
  if (g.seatOpen) return { label: g.players[0]?.done ? "Seat open · creator finished" : "Seat open", tone: styles.calm };
  const done = g.players.filter((p) => p.done).length;
  if (done === g.players.length) return { label: "Both finished · settling", tone: styles.warn };
  return done ? { label: "One side finished", tone: styles.chip } : { label: "Both playing", tone: styles.ok };
}

/** Matches that have not settled, and the call to close one and refund every entry. */
export function AdminGames() {
  const dialog = useActionDialog();
  const [list, setList] = useState<AdminGame[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(
    () =>
      request<AdminGame[]>("/api/admin/games").then(
        (next) => (setList(next), setError(""), setNow(Date.now())),
        (e: Error) => setError(e.message),
      ),
    [],
  );

  useEffect(() => {
    void load();
    const timer = setInterval(() => !document.hidden && void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const cancel = async (g: AdminGame) => {
    const who = g.players.map((p) => p.name).join(" and ");
    const reason = await dialog.prompt(
      `Cancel this match and refund ${amount(g.refund, g.asset)} to ${who}?\n\nBoth runs end where they are, the entries go back in full with no house fee, and the match counts for nothing.\n\nWrite the reason. It is sent to ${g.players.length === 1 ? "the player" : "both players"} and recorded in the audit log.`,
      { title: "Cancel & refund match", confirmLabel: "Cancel & refund", danger: true },
    );
    if (reason === null) return;
    setBusy(g.id);
    setError("");
    setNotice("");
    try {
      const result = await request<{ refunded: number; players: number }>("/api/admin/games", { action: "cancel", id: g.id, reason });
      await load();
      setNotice(`Match cancelled · ${amount(result.refunded, g.asset)} returned to ${result.players} ${result.players === 1 ? "player" : "players"}.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  return (
    <section className={styles.section}>
      {error && (
        <div className="error" role="alert">
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <p className="success" role="status">
          {notice}
        </p>
      )}
      {!list ? (
        <p className={styles.loading}>Loading matches…</p>
      ) : !list.length ? (
        <p className={styles.empty}>No match is open right now.</p>
      ) : (
        <div className={styles.list}>
          {list.map((g) => {
            const state = status(g);
            return (
              <div key={g.id} className={styles.row}>
                <div className={styles.who}>
                  <div>
                    <b>
                      {g.players.map((p) => p.name).join(" vs ") || "No entry yet"}
                      <span className={`${styles.chip} ${state.tone}`}>{state.label}</span>
                    </b>
                    <span>Started {timeAgo(g.created, now)}</span>
                  </div>
                </div>
                <div className={styles.cells}>
                  <div className={styles.cell}>
                    <span>Entry each</span>
                    <b>{amount(g.stake, g.asset)}</b>
                  </div>
                  <div className={styles.cell}>
                    <span>Score</span>
                    <b>{g.players.map((p) => p.score.toLocaleString("en")).join(" – ") || "—"}</b>
                  </div>
                  <div className={styles.cell}>
                    <span>In escrow</span>
                    <b>{amount(g.refund, g.asset)}</b>
                  </div>
                  <div className={styles.cell}>
                    <span>Last shot</span>
                    <b>{g.lastShot ? timeAgo(g.lastShot, now) : "None yet"}</b>
                  </div>
                </div>
                <div className={styles.actions}>
                  {g.players.map((p) => (
                    <Tooltip key={p.watchId} content={`Watch ${p.name}'s run · round ${p.round}`}>
                      <Link aria-label={`Watch ${p.name}'s run · round ${p.round}`} className="btn" href={`/watch/${p.watchId}`}>
                        <Avatar name={p.name} src={p.avatar} size={18} />
                        <Eye size={14} />
                      </Link>
                    </Tooltip>
                  ))}
                  <button className="btn btn-danger" disabled={busy === g.id} onClick={() => void cancel(g)}>
                    {busy === g.id ? "Cancelling…" : "Cancel & refund"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
