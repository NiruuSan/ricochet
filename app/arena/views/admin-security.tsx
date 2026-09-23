"use client";
import { Form } from "@/components/ui/form";
import { PlayerNameInput } from "@/components/ui/player-name-input";
import { useEffect, useState } from "react";
import Link from "next/link";
import { KeyRound, Search } from "lucide-react";
import type { AdminSecuritySnapshot } from "@/lib/api-types";
import { signInWith, type SignInProvider } from "../../auth-actions";
import { request, RequestError } from "../api";
import { CodeInput } from "../two-factor-panel";
import styles from "./admin.module.css";

const date = (value: number | null) => (value === null ? "None" : new Date(value).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" }));

export function AdminSecurity() {
  const [data, setData] = useState<AdminSecuritySnapshot | null>(null);
  const [name, setName] = useState("");
  const [searched, setSearched] = useState(false);
  const [reason, setReason] = useState("");
  const [code, setCode] = useState("");
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reauth, setReauth] = useState<SignInProvider | null>(null);

  useEffect(() => {
    let active = true;
    request<AdminSecuritySnapshot>("/api/admin/security").then(
      (next) => active && setData(next),
      (e: Error) => active && setError(e.message),
    );
    return () => {
      active = false;
    };
  }, []);

  const lookup = async (query: string) => {
    setData(await request<AdminSecuritySnapshot>(`/api/admin/security?name=${encodeURIComponent(query)}`));
  };

  return (
    <section className={styles.section}>
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

      <Form
        className={styles.panel}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          setNotice("");
          setCode("");
          setReason("");
          setVerified(false);
          setReauth(null);
          try {
            await lookup(name.trim());
            setSearched(true);
          } catch (e) {
            setError((e as Error).message);
            setData(null);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className={styles.panelHead}>
          <h3>
            <Search size={15} /> Find a player
          </h3>
          <span>Their exact public name, as it appears on their profile.</span>
        </div>
        <div className={styles.form}>
          <div className="field">
            <label htmlFor="security-player-name">Player public name</label>
            <PlayerNameInput id="security-player-name" scope="admin" value={name} onValueChange={setName} maxLength={32} required placeholder="Exact public name" />
          </div>
          <div className={styles.formActions}>
            <button className="btn" disabled={busy}>
              {busy ? "Loading…" : "Find player"}
            </button>
          </div>
        </div>
        {searched && data && !data.player && (
          <p className={styles.fine} role="status">
            No player found with that exact public name.
          </p>
        )}
      </Form>

      {data?.player && (
        <section className={styles.panel}>
          <div className={styles.panelHead}>
            <h3 style={{ overflowWrap: "anywhere" }}>{data.player.name}</h3>
            <span className={`${styles.chip} ${data.player.enabled ? styles.ok : styles.bad}`}>{data.player.enabled ? "Two-factor on" : "Two-factor off"}</span>
          </div>
          <div className={styles.stats}>
            <div className={styles.stat}>
              <span>Enabled since</span>
              <b style={{ fontSize: 15 }}>{date(data.player.enabledAt)}</b>
            </div>
            <div className={styles.stat}>
              <span>Recovery codes left</span>
              <b>{data.player.recoveryCodesLeft}</b>
            </div>
            <div className={styles.stat}>
              <span>Verification locked until</span>
              <b style={{ fontSize: 15 }}>{date(data.player.lockedUntil)}</b>
            </div>
            <div className={styles.stat}>
              <span>Withdrawals paused until</span>
              <b style={{ fontSize: 15 }}>{date(data.player.withdrawalHoldUntil)}</b>
            </div>
          </div>
          <Form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!data.player || !verified) return;
              const target = data.player.name;
              setBusy(true);
              setError("");
              setNotice("");
              setReauth(null);
              try {
                const result = await request<{ withdrawalHoldUntil: number }>("/api/admin/security", { action: "reset", name: target, reason, code });
                setNotice(`${target}'s two-factor authentication was reset. Withdrawals are paused until ${date(result.withdrawalHoldUntil)}.`);
                setReason("");
                setVerified(false);
                await lookup(target);
              } catch (e) {
                setError((e as Error).message);
                if (e instanceof RequestError && e.code === "REAUTH_REQUIRED") setReauth((e.details?.provider as SignInProvider) ?? "github");
              } finally {
                setCode("");
                setBusy(false);
              }
            }}
          >
            <p className={styles.fine} style={{ marginTop: 18 }}>
              Resetting removes this player&apos;s authenticator and recovery codes and pauses withdrawals for at least 72 hours. They must set up two-factor again. Your own
              two-factor must be enabled in <Link href="/wallet">your wallet</Link>.
            </p>
            <label className="field">
              Reason for reset
              <textarea className="input" value={reason} onChange={(e) => setReason(e.target.value)} minLength={10} maxLength={300} rows={3} required placeholder="How identity was verified and why access needs resetting. Do not include secrets." />
            </label>
            <p className={styles.fine}>Enter your own administrator code below.</p>
            <CodeInput value={code} onChange={setCode} />
            <label style={{ display: "flex", gap: 10, alignItems: "flex-start", margin: "16px 0" }}>
              <input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} required />
              <span>I verified {data.player.name}&apos;s identity outside the app and intend to reset their two-factor authentication.</span>
            </label>
            <div className={styles.formActions}>
              {reauth && (
                <button type="button" className="btn" onClick={() => void signInWith(reauth, "/admin")}>
                  Confirm it is you
                </button>
              )}
              <button className="btn btn-danger" disabled={busy || !verified || reason.trim().length < 10 || !code.trim()}>
                <KeyRound size={15} /> {busy ? "Working…" : `Reset ${data.player.name}'s two-factor`}
              </button>
            </div>
          </Form>
        </section>
      )}

      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>Recent resets</h2>
        </div>
        {!data ? (
          <p className={styles.loading}>Security history has not loaded.</p>
        ) : !data.recent.length ? (
          <p className={styles.empty}>No resets recorded.</p>
        ) : (
          <div className={styles.list}>
            {data.recent.map((entry) => (
              <div key={entry.id} className={styles.row}>
                <div className={styles.who}>
                  <KeyRound size={16} color="#9ec5ff" />
                  <div>
                    <b>{entry.playerName}</b>
                    <span>
                      Reset by {entry.adminName} · {date(entry.created)}
                    </span>
                  </div>
                </div>
                <div />
                <div />
                <p className={styles.note}>{entry.reason}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
