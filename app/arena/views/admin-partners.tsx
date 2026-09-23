"use client";
import { useCallback, useEffect, useState } from "react";
import { Form } from "@/components/ui/form";
import { PlayerNameInput } from "@/components/ui/player-name-input";
import { useActionDialog } from "@/components/ui/action-dialog";
import type { AdminReferral } from "@/lib/api-types";
import { request } from "../api";
import { Avatar } from "../avatar";
import { fullSol } from "../funded-wallet";
import styles from "./admin.module.css";

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
        : `End ${player}'s partnership?\n\nTheir code keeps working at level 1: a day of reduced fees for new players, and nothing paid out. What they have already earned stays theirs, claimed or not.\n\nWrite the reason. It is recorded in the audit log.`,
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

      <Form
        className={styles.panel}
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) void setLevel(name.trim(), 2);
        }}
      >
        <div className={styles.panelHead}>
          <h3>Grant a partnership</h3>
          <span>A code gives whoever signs up with it 8% house fee instead of 12% — a day from an ordinary code, a week from a partner&apos;s.</span>
        </div>
        <div className={styles.form}>
          <div className="field">
            <label htmlFor="partner-name">Player name</label>
            <PlayerNameInput id="partner-name" scope="admin" value={name} onValueChange={setName} placeholder="Exact player name" />
          </div>
          <div className={styles.formActions}>
            <button className="btn btn-primary" disabled={!name.trim() || !!busy}>
              Grant partnership
            </button>
          </div>
        </div>
      </Form>

      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <div>
            <h2>Codes in use</h2>
            <p>Net site earnings are the all-time fees from referred players, after player rebates and partner commissions.</p>
          </div>
        </div>
        {!list ? (
          <p className={styles.loading}>Loading partners…</p>
        ) : !list.length ? (
          <p className={styles.empty}>Nobody has referred a player yet.</p>
        ) : (
          <div className={styles.list}>
            {list.map((row) => (
              <div key={row.name} className={styles.row}>
                <div className={styles.who}>
                  <Avatar name={row.name} src={null} size={34} />
                  <div>
                    <b>
                      {row.name}
                      {row.level >= 2 && <span className={`${styles.chip} ${styles.ok}`}>Partner</span>}
                    </b>
                    <span>Code {row.code ?? "—"}</span>
                  </div>
                </div>
                <div className={styles.cells}>
                  <div className={styles.cell}>
                    <span>Brought in</span>
                    <b>
                      {row.joined} {row.joined === 1 ? "player" : "players"}
                    </b>
                  </div>
                  <div className={styles.cell}>
                    <span>Their earnings</span>
                    <b>{row.level >= 2 || row.earned > 0 ? `${fullSol(row.earned)} SOL` : "—"}</b>
                  </div>
                  <div className={styles.cell}>
                    <span>Unclaimed</span>
                    <b>{row.pending > 0 ? `${fullSol(row.pending)} SOL` : "—"}</b>
                  </div>
                  <div className={styles.cell}>
                    <span>Net to the house</span>
                    <b className="lime">{fullSol(row.siteEarned)} SOL</b>
                  </div>
                </div>
                <div className={styles.actions}>
                  <button className={`btn ${row.level >= 2 ? "btn-danger" : ""}`} disabled={busy === row.name} onClick={() => void setLevel(row.name, row.level >= 2 ? 1 : 2)}>
                    {busy === row.name ? "Saving…" : row.level >= 2 ? "End partnership" : "Make partner"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
