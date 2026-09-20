"use client";
import { useCallback, useEffect, useState } from "react";
import { Form } from "@/components/ui/form";
import { useActionDialog } from "@/components/ui/action-dialog";
import type { AdminReferral } from "@/lib/api-types";
import { request } from "../api";
import { fullSol } from "../funded-wallet";
import styles from "./tournaments.module.css";

const REFRESH_MS = 30_000;

/**
 * Who brings players in, and who is paid for it. A partnership gives the
 * players who use that code a week of reduced fees instead of a day, and pays
 * the partner a share of the house fee on their matches (lib/referrals.ts).
 */
export function AdminPartners() {
  const dialog = useActionDialog();
  const [list, setList] = useState<AdminReferral[] | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(
    () =>
      request<AdminReferral[]>("/api/admin/referrals").then(
        (next) => (setList(next), setError("")),
        (e: Error) => setError(e.message),
      ),
    [],
  );
  useEffect(() => {
    void load();
    const timer = setInterval(() => !document.hidden && void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const setLevel = async (player: string, level: 1 | 2) => {
    const reason = await dialog.prompt(
      level === 2
        ? `Make ${player} a partner?\n\nPlayers who sign up with their code get a week of reduced fees instead of a day, and ${player} earns 10% of the house fee on every match those players play, for as long as they play.\n\nWrite the reason. It is recorded in the audit log.`
        : `End ${player}'s partnership?\n\nTheir code keeps working at level 1: a day of reduced fees for new players, and nothing paid out. Commission already earned stays paid.\n\nWrite the reason. It is recorded in the audit log.`,
      { title: level === 2 ? "Grant partnership" : "End partnership", confirmLabel: level === 2 ? "Grant partnership" : "End partnership", danger: level === 1 },
    );
    if (reason === null) return;
    setBusy(player);
    setError("");
    setNotice("");
    try {
      const done = await request<{ name: string; level: number }>("/api/admin/referrals", { action: "level", name: player, level, reason });
      await load();
      setName("");
      setNotice(done.level === 2 ? `${done.name} is now a partner.` : `${done.name} is no longer a partner.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  return (
    <>
      <h2 style={{ margin: "30px 0 6px" }}>Referrals & partners</h2>
      <p className="muted">
        Every player has a code. A code gives whoever signs up with it 8% house fee instead of 12% — a day from an ordinary code, a week from a partner&apos;s.
        Winnings never change: the difference is credited back to the player after each match, out of the house fee.
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
      <Form
        className="field-row"
        style={{ gridTemplateColumns: "minmax(0, 1fr) auto" }}
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) void setLevel(name.trim(), 2);
        }}
      >
        <label className="field">
          Player name
          <input className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Exact player name" autoComplete="off" />
        </label>
        <button className="btn btn-primary" disabled={!name.trim() || !!busy}>
          Grant partnership
        </button>
      </Form>
      {!list ? (
        <p className="muted" style={{ marginTop: 16 }}>Loading…</p>
      ) : !list.length ? (
        <p className={styles.empty} style={{ marginTop: 16 }}>Nobody has referred a player yet.</p>
      ) : (
        <div style={{ marginTop: 16 }}>
          {list.map((row) => (
            <div key={row.name} className={styles.adminRow}>
              <div>
                <b>
                  {row.name} {row.level >= 2 && <span className="tag lime">PARTNER</span>}
                </b>
                <span className={styles.muted}>
                  Code {row.code ?? "—"} · {row.joined} {row.joined === 1 ? "player" : "players"} brought in
                  {row.level >= 2 && ` · ${fullSol(row.earned)} SOL earned`}
                </span>
              </div>
              <button className="btn" disabled={busy === row.name} onClick={() => void setLevel(row.name, row.level >= 2 ? 1 : 2)}>
                {busy === row.name ? "Saving…" : row.level >= 2 ? "End partnership" : "Make partner"}
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
