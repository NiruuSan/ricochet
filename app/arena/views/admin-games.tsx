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
import styles from "./tournaments.module.css";

const REFRESH_MS = 15_000;

/** What the match is waiting for right now. */
function status(g: AdminGame) {
  if (g.seatOpen) return g.players[0]?.done ? "Seat open · creator finished" : "Seat open · creator playing";
  const done = g.players.filter((p) => p.done).length;
  if (done === g.players.length) return "Both finished · settling";
  return done ? "One side finished" : "Both playing";
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
    <>
      <h2 style={{ margin: "30px 0 6px" }}>Games in progress</h2>
      <p className="muted">
        Every 1v1 match that has not settled, most recently played first. Refreshes every 15 seconds. Tournament runs are ended from the Tournaments tab.
      </p>
      {error && (
        <div className="error" role="alert" style={{ marginTop: 14 }}>
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <p className="success" role="status" style={{ marginTop: 14 }}>
          {notice}
        </p>
      )}
      {!list ? (
        <p className="muted" style={{ marginTop: 16 }}>Loading…</p>
      ) : !list.length ? (
        <p className={styles.empty} style={{ marginTop: 16 }}>No match is open right now.</p>
      ) : (
        <div style={{ marginTop: 16 }}>
          {list.map((g) => (
            <div key={g.id} className={styles.adminRow}>
              <div>
                <b>{g.players.map((p) => p.name).join(" vs ") || "No entry yet"}</b>
                <span className={styles.muted}>
                  {status(g)} · started {timeAgo(g.created, now)}
                </span>
              </div>
              <div>
                <b>{amount(g.stake, g.asset)}</b>
                <span className={styles.muted}>entry each</span>
              </div>
              <div>
                <b>{g.players.map((p) => p.score.toLocaleString("en")).join(" – ") || "—"}</b>
                <span className={styles.muted}>{g.lastShot ? `last shot ${timeAgo(g.lastShot, now)}` : "no shot yet"}</span>
              </div>
              <div>
                <b>{amount(g.refund, g.asset)}</b>
                <span className={styles.muted}>held in escrow</span>
              </div>
              <div className="row-actions">
                {g.players.map((p) => (
                  <Tooltip key={p.watchId} content={`Watch ${p.name}'s run · round ${p.round}`}><Link aria-label={`Watch ${p.name}'s run · round ${p.round}`} className="btn" href={`/watch/${p.watchId}`}>
                    <Avatar name={p.name} src={p.avatar} size={18} />
                    <Eye size={14} />
                  </Link></Tooltip>
                ))}
                <button className="btn" style={{ borderColor: "#ff8091", color: "#ffb2bf" }} disabled={busy === g.id} onClick={() => void cancel(g)}>
                  {busy === g.id ? "Cancelling…" : "Cancel & refund"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
