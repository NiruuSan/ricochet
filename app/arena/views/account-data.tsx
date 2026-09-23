"use client";
import { useState } from "react";
import Link from "next/link";
import { Download, ShieldCheck, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { signInWith, type SignInProvider } from "../../auth-actions";
import { request, RequestError } from "../api";
import type { PlayerState } from "../arena";
import styles from "./profile-dashboard.module.css";

/**
 * The two things a player can do with their own account beyond playing: take a
 * copy of everything it holds, and close it. Closing asks the sign-in provider
 * to vouch for whoever is asking, so a borrowed session cannot do it.
 */
export function AccountData({ player }: { player: PlayerState }) {
  const [busy, setBusy] = useState<"" | "export" | "delete">("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [reauth, setReauth] = useState<SignInProvider | null>(null);
  const name = player.data.player?.name ?? "";
  const [typed, setTyped] = useState("");

  const download = async () => {
    setBusy("export");
    setError("");
    setNotice("");
    try {
      const data = await request<Record<string, unknown>>("/api/profile", { action: "export" });
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `bounce-${name || "account"}-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setNotice("Your data was downloaded as a JSON file.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const remove = async () => {
    setBusy("delete");
    setError("");
    setReauth(null);
    try {
      await request("/api/profile", { action: "delete" });
      setConfirming(false);
      setNotice("Your account is closed. Your name, picture and notifications are gone.");
      await player.refresh();
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof RequestError && e.code === "REAUTH_REQUIRED") setReauth((e.details?.provider as SignInProvider) ?? "github");
    } finally {
      setBusy("");
    }
  };

  return (
    <section className={styles.accountSection} aria-label="Account and data">
      <div className={styles.sectionHeading}>
        <div>
          <h2>
            <ShieldCheck size={18} />
            Account &amp; data
          </h2>
          <p>Everything here is yours: take a copy of it, or close the account for good.</p>
        </div>
        <span className={styles.statsScope}>Private to you</span>
      </div>
      {notice && (
        <p className={`success ${styles.accountNote}`} role="status">
          {notice}
        </p>
      )}
      {error && !confirming && (
        <p className={`error ${styles.accountNote}`} role="alert">
          {error}
        </p>
      )}
      {reauth && !confirming && (
        <button className={`btn ${styles.accountNote}`} onClick={() => void signInWith(reauth, window.location.pathname)}>
          <ShieldCheck /> Confirm it is you
        </button>
      )}
      <div className={styles.accountGrid}>
        <article className={`${styles.card} ${styles.accountCard}`}>
          <h3>
            <Download size={16} />
            Download your data
          </h3>
          <p>
            Your profile, every game you played, every line of your gem and devnet SOL ledgers, your transfers, your tips and your notifications — one JSON file,
            exactly as it is stored.
          </p>
          <button className="btn" disabled={!!busy} onClick={() => void download()}>
            <Download /> {busy === "export" ? "Preparing…" : "Download my data"}
          </button>
        </article>
        <article className={`${styles.card} ${styles.accountCard} ${styles.accountDanger}`}>
          <h3>
            <Trash2 size={16} />
            Close your account
          </h3>
          <p>
            Your name, picture, notifications, devices and authenticator are deleted. Settled games keep their rows, with nobody behind them, so the other
            players&apos; history stays true. <Link href="/privacy">What we keep, and why</Link>.
          </p>
          <button
            className="btn btn-danger"
            disabled={!!busy}
            onClick={() => (setError(""), setNotice(""), setTyped(""), setConfirming(true))}
          >
            <Trash2 /> Delete my account
          </button>
        </article>
      </div>

      <Dialog open={confirming} onOpenChange={(open) => !open && !busy && setConfirming(false)}>
        <DialogContent className="dialog-dark">
          <DialogTitle>Delete your account?</DialogTitle>
          <DialogDescription>
            Your name, picture, notifications, notification devices and authenticator are deleted. Your finished games and the ledger lines that balance against
            other players keep their rows, with nobody behind them — that is what keeps everyone else&apos;s history and the house accounts correct. This cannot
            be undone, and your gems do not come back if you sign in again.
          </DialogDescription>
          <p className="fine">Withdraw your devnet SOL and finish any game in play first, or this will be refused.</p>
          <label className="field">
            Type your player name to confirm
            <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={name} autoComplete="off" />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {reauth && (
            <button className="btn" onClick={() => void signInWith(reauth, window.location.pathname)}>
              <ShieldCheck /> Confirm it is you
            </button>
          )}
          <div className="row-actions" style={{ marginTop: 10 }}>
            <button className="btn" disabled={!!busy} onClick={() => setConfirming(false)}>
              Keep my account
            </button>
            <button
              className="btn btn-danger"
              disabled={!!busy || typed.trim().toLowerCase() !== name.toLowerCase()}
              onClick={() => void remove()}
            >
              {busy === "delete" ? "Deleting…" : "Delete my account"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
