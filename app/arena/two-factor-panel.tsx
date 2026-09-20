"use client";
import { Form } from "@/components/ui/form";
import { useCallback, useEffect, useState } from "react";
import { Check, Copy, KeyRound, LockKeyhole, LogOut, ShieldCheck, ShieldOff } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { SecurityStatus } from "@/lib/api-types";
import { signInWith, signOutToLogin, type SignInProvider } from "../auth-actions";
import { request, RequestError } from "./api";

type Setup = { secret: string; uri: string; qr: string };
type Mode = null | "setup" | "codes" | "disable" | "regenerate" | "signout";

/** The player's two-factor status, shared by the security panel and the withdrawal dialog. */
export function useTwoFactor() {
  const [status, setStatus] = useState<SecurityStatus | null>(null);
  const reload = useCallback(
    () =>
      request<SecurityStatus>("/api/security").then(
        (next) => (setStatus(next), next),
        () => null,
      ),
    [],
  );
  useEffect(() => {
    let active = true;
    request<SecurityStatus>("/api/security").then(
      (next) => active && setStatus(next),
      () => {},
    );
    return () => {
      active = false;
    };
  }, []);
  return { status, reload };
}

/** Accepts a 6-digit code or a recovery code, as typed. */
export function CodeInput({ value, onChange, recovery = true, autoFocus = false }: { value: string; onChange: (value: string) => void; recovery?: boolean; autoFocus?: boolean }) {
  return (
    <label className="field">
      {recovery ? "Authentication code or recovery code" : "6-digit code from your app"}
      <input
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value.slice(0, 16))}
        inputMode={recovery ? "text" : "numeric"}
        autoComplete="one-time-code"
        placeholder={recovery ? "123 456 or ABCDE-FGHIJ" : "123 456"}
        autoFocus={autoFocus}
        required
        style={{ letterSpacing: 2, fontVariantNumeric: "tabular-nums" }}
      />
    </label>
  );
}

export function TwoFactorPanel({ twoFactor }: { twoFactor: ReturnType<typeof useTwoFactor> }) {
  const { status, reload } = twoFactor;
  const [mode, setMode] = useState<Mode>(null);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reauth, setReauth] = useState<SignInProvider | null>(null);
  const [copied, setCopied] = useState<"" | "secret" | "codes">("");

  const call = async <T,>(body: Record<string, unknown>): Promise<T | null> => {
    setBusy(true);
    setError("");
    setReauth(null);
    try {
      return await request<T>("/api/security", body);
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof RequestError && e.code === "REAUTH_REQUIRED") setReauth((e.details?.provider as SignInProvider) ?? "github");
      return null;
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    setMode(null);
    setSetup(null);
    setCode("");
    setError("");
    setReauth(null);
    setCopied("");
  };

  const start = async () => {
    const next = await call<Setup>({ action: "setup" });
    if (next) {
      setSetup(next);
      setCode("");
      setMode("setup");
    }
  };

  const copy = async (text: string, what: "secret" | "codes") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
    } catch {
      setError("Select the text and copy it manually.");
    }
  };

  if (!status) return null;
  const locked = status.lockedUntil !== null;

  return (
    <div className="callout" style={{ alignItems: "flex-start" }}>
      {status.enabled ? <ShieldCheck /> : <ShieldOff style={{ color: "#ffb86b" }} />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <h3>Two-factor authentication {status.enabled ? "is on" : "is off"}</h3>
        {status.withdrawalHoldUntil !== null && (
          <p className="error" role="status" style={{ marginTop: 10 }}>
            After a security reset, withdrawals are paused until {new Date(status.withdrawalHoldUntil).toLocaleString()}. Setting up two-factor authentication again does not shorten this pause.
          </p>
        )}
        <p>
          {status.enabled
            ? `Every withdrawal asks for a code from your authenticator app. ${status.recoveryCodesLeft} recovery code${status.recoveryCodesLeft === 1 ? "" : "s"} left.`
            : "Withdrawals require a code from an authenticator app such as Google Authenticator, Authy or 1Password. Set it up once; it takes a minute."}
        </p>
        {locked && (
          <p className="error" role="alert" style={{ marginTop: 10 }}>
            <LockKeyhole size={14} style={{ verticalAlign: -2 }} /> Too many wrong codes. Verification is paused until {new Date(status.lockedUntil!).toLocaleTimeString()}.
          </p>
        )}
        {error && !mode && (
          <p className="error" role="alert" style={{ marginTop: 10 }}>
            {error}
          </p>
        )}
        {reauth && !mode && (
          <button className="btn" style={{ marginTop: 10 }} onClick={() => void signInWith(reauth, window.location.pathname)}>
            <ShieldCheck /> Confirm it is you
          </button>
        )}
        <div className="row-actions" style={{ marginTop: 12 }}>
          {status.enabled ? (
            <>
              <button className="btn" disabled={busy} onClick={() => (setError(""), setCode(""), setMode("regenerate"))}>
                <KeyRound /> New recovery codes
              </button>
              <button className="btn" style={{ borderColor: "#ff8091", color: "#ffb2bf" }} disabled={busy} onClick={() => (setError(""), setCode(""), setMode("disable"))}>
                Turn off
              </button>
            </>
          ) : (
            <button className="btn btn-primary" disabled={busy} onClick={() => void start()}>
              <ShieldCheck /> {busy ? "Preparing…" : "Set up two-factor"}
            </button>
          )}
          {/* Sessions are cookies, so the way to take one back is to end them all. */}
          <button className="btn" disabled={busy} onClick={() => (setError(""), setMode("signout"))}>
            <LogOut /> Sign out everywhere
          </button>
        </div>
      </div>

      <Dialog open={mode !== null} onOpenChange={(open) => !open && !busy && mode !== "codes" && close()}>
        <DialogContent className="dialog-dark">
          {mode === "signout" && (
            <>
              <DialogTitle>Sign out everywhere?</DialogTitle>
              <DialogDescription>
                Every device signed in to this account is signed out, including this one. Do this if you used a shared computer, lost a device, or suspect someone
                else has been on your account. Your games, balances and settings are untouched.
              </DialogDescription>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              <div className="row-actions" style={{ marginTop: 10 }}>
                <button className="btn" disabled={busy} onClick={close}>
                  Stay signed in
                </button>
                <button
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() =>
                    void call({ action: "sign_out_everywhere" }).then((done) => {
                      if (done) void signOutToLogin();
                    })
                  }
                >
                  {busy ? "Signing out…" : "Sign out everywhere"}
                </button>
              </div>
            </>
          )}
          {mode === "setup" && setup && (
            <>
              <DialogTitle>Set up two-factor authentication</DialogTitle>
              <DialogDescription>Scan this QR code with your authenticator app, then enter the 6-digit code it shows.</DialogDescription>
              <div style={{ display: "grid", placeItems: "center", margin: "6px 0" }}>
                {/* eslint-disable-next-line @next/next/no-img-element -- a generated data URL, not a remote image */}
                <img src={setup.qr} alt="QR code for your authenticator app" width={196} height={196} style={{ borderRadius: 12, background: "#fff", padding: 6 }} />
              </div>
              <p className="fine" style={{ textAlign: "center" }}>
                Can&apos;t scan? Enter this key manually:
              </p>
              <button type="button" className="btn full" onClick={() => void copy(setup.secret.replaceAll(" ", ""), "secret")} style={{ fontFamily: "monospace", letterSpacing: 1, overflowWrap: "anywhere" }}>
                {copied === "secret" ? <Check /> : <Copy />} {setup.secret}
              </button>
              <Form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const result = await call<{ recoveryCodes: string[] }>({ action: "confirm", code });
                  if (result) {
                    setCodes(result.recoveryCodes);
                    setCopied("");
                    setMode("codes");
                    void reload();
                  }
                }}
              >
                <CodeInput value={code} onChange={setCode} recovery={false} autoFocus />
                {error && (
                  <p className="error" role="alert">
                    {error}
                  </p>
                )}
                <button className="btn btn-primary full" disabled={busy || code.replace(/\s/g, "").length !== 6}>
                  {busy ? "Checking…" : "Turn on two-factor"}
                </button>
              </Form>
            </>
          )}

          {mode === "codes" && (
            <>
              <DialogTitle>Save your recovery codes</DialogTitle>
              <DialogDescription>
                If you lose your phone, each of these codes works once instead of an app code. They will not be shown again: store them somewhere safe, like a password manager.
              </DialogDescription>
              <ol style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "8px 18px", fontFamily: "monospace", fontSize: 15, margin: "8px 0", paddingLeft: 22 }}>
                {codes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ol>
              <div className="row-actions">
                <button className="btn" onClick={() => void copy(codes.join("\n"), "codes")}>
                  {copied === "codes" ? <Check /> : <Copy />} {copied === "codes" ? "Copied" : "Copy codes"}
                </button>
                <button className="btn btn-primary" onClick={() => (setCodes([]), close())}>
                  I saved them
                </button>
              </div>
            </>
          )}

          {(mode === "disable" || mode === "regenerate") && (
            <>
              <DialogTitle>{mode === "disable" ? "Turn off two-factor authentication?" : "Create new recovery codes?"}</DialogTitle>
              <DialogDescription>
                {mode === "disable"
                  ? "You will not be able to withdraw until you set it up again. Enter a code to confirm."
                  : "Your current recovery codes stop working. Enter a code to confirm."}
              </DialogDescription>
              <Form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (mode === "disable") {
                    if (await call({ action: "disable", code })) {
                      await reload();
                      close();
                    }
                  } else {
                    const result = await call<{ recoveryCodes: string[] }>({ action: "regenerate", code });
                    if (result) {
                      setCodes(result.recoveryCodes);
                      setCode("");
                      setMode("codes");
                      void reload();
                    }
                  }
                }}
              >
                <CodeInput value={code} onChange={setCode} autoFocus />
                {error && (
                  <p className="error" role="alert">
                    {error}
                  </p>
                )}
                {reauth && (
                  <button type="button" className="btn full" onClick={() => void signInWith(reauth, window.location.pathname)}>
                    <ShieldCheck /> Confirm it is you, then try again
                  </button>
                )}
                <div className="row-actions" style={{ marginTop: 12 }}>
                  <button type="button" className="btn" disabled={busy} onClick={close}>
                    Cancel
                  </button>
                  <button className="btn btn-primary" disabled={busy || !code.trim()}>
                    {busy ? "Checking…" : mode === "disable" ? "Turn off" : "Create new codes"}
                  </button>
                </div>
              </Form>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
