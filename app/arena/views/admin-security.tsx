"use client";
import { Form } from "@/components/ui/form";
import { PlayerNameInput } from "@/components/ui/player-name-input";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { AdminSecuritySnapshot } from "@/lib/api-types";
import { signInWith, type SignInProvider } from "../../auth-actions";
import { request, RequestError } from "../api";
import { CodeInput } from "../two-factor-panel";
import styles from "./tournaments.module.css";

const date = (value: number | null) => value === null ? "None" : new Date(value).toLocaleString();

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
    return () => { active = false; };
  }, []);

  const lookup = async (query: string) => {
    setData(await request<AdminSecuritySnapshot>(`/api/admin/security?name=${encodeURIComponent(query)}`));
  };

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <p className="muted">Help a player who lost their authenticator and recovery codes. Verify their identity outside Bounce before resetting access.</p>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="success" role="status">{notice}</p>}
      <Form className={styles.panel} onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setError(""); setNotice(""); setCode(""); setReason(""); setVerified(false); setReauth(null);
        try { await lookup(name.trim()); setSearched(true); }
        catch (e) { setError((e as Error).message); setData(null); }
        finally { setBusy(false); }
      }}>
        <div className="field"><label htmlFor="security-player-name">Player public name</label>
          <PlayerNameInput id="security-player-name" scope="admin" value={name} onValueChange={setName} maxLength={32} required placeholder="Exact public name" />
        </div>
        <button className="btn" disabled={busy}>{busy ? "Loading..." : "Find player"}</button>
        {searched && data && !data.player && <p className="muted" role="status" style={{ marginTop: 12 }}>No player found with that exact public name.</p>}
      </Form>

      {data?.player && <section className={styles.panel}>
        <h2 style={{ overflowWrap: "anywhere" }}>{data.player.name}</h2>
        <dl style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "8px 16px", margin: "16px 0" }}>
          <dt>Two-factor</dt><dd>{data.player.enabled ? "Enabled" : "Off"}</dd>
          <dt>Enabled since</dt><dd>{date(data.player.enabledAt)}</dd>
          <dt>Recovery codes left</dt><dd>{data.player.recoveryCodesLeft}</dd>
          <dt>Verification locked until</dt><dd>{date(data.player.lockedUntil)}</dd>
          <dt>Withdrawals paused until</dt><dd>{date(data.player.withdrawalHoldUntil)}</dd>
        </dl>
        <Form onSubmit={async (e) => {
          e.preventDefault();
          if (!data.player || !verified) return;
          const target = data.player.name;
          setBusy(true); setError(""); setNotice(""); setReauth(null);
          try {
            const result = await request<{ withdrawalHoldUntil: number }>("/api/admin/security", { action: "reset", name: target, reason, code });
            setNotice(`${target}'s two-factor authentication was reset. Withdrawals are paused until ${date(result.withdrawalHoldUntil)}.`);
            setReason(""); setVerified(false);
            await lookup(target);
          } catch (e) {
            setError((e as Error).message);
            if (e instanceof RequestError && e.code === "REAUTH_REQUIRED") setReauth((e.details?.provider as SignInProvider) ?? "github");
          } finally { setCode(""); setBusy(false); }
        }}>
          <p className="muted" style={{ marginBottom: 16 }}>Resetting removes this player&apos;s authenticator and recovery codes and pauses withdrawals for at least 72 hours. They must set up two-factor again. Your own two-factor must be enabled in <Link href="/wallet">your wallet</Link>.</p>
          <label className="field">Reason for reset
            <textarea className="input" value={reason} onChange={(e) => setReason(e.target.value)} minLength={10} maxLength={300} rows={3} required placeholder="How identity was verified and why access needs resetting. Do not include secrets." />
          </label>
          <p className="fine">Enter your own administrator code below.</p>
          <CodeInput value={code} onChange={setCode} />
          <label style={{ display: "flex", gap: 10, alignItems: "flex-start", margin: "16px 0" }}>
            <input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} required />
            <span>I verified {data.player.name}&apos;s identity outside the app and intend to reset their two-factor authentication.</span>
          </label>
          {reauth && <button type="button" className="btn" onClick={() => void signInWith(reauth, "/admin")}>Confirm it is you</button>}
          <button className="btn" disabled={busy || !verified || reason.trim().length < 10 || !code.trim()} style={{ borderColor: "#ff8091", color: "#ffb2bf" }}>{busy ? "Working..." : `Reset ${data.player.name}'s two-factor`}</button>
        </Form>
      </section>}

      <section className={styles.panel}>
        <h2>Recent security resets</h2>
        {!data ? <p className="muted">Security history has not loaded.</p> : !data.recent.length ? <p className="muted">No resets recorded.</p> : <ul style={{ listStyle: "none", padding: 0 }}>
          {data.recent.map((entry) => <li key={entry.id} style={{ borderTop: "1px solid #2b3546", padding: "16px 0", overflowWrap: "anywhere" }}>
            <b>{entry.playerName}</b><p className="fine">Reset by {entry.adminName} · {date(entry.created)}</p><p>{entry.reason}</p>
          </li>)}
        </ul>}
      </section>
    </div>
  );
}
