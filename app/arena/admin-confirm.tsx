"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { KeyRound, ShieldCheck } from "lucide-react";
import { Form } from "@/components/ui/form";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { onAdminConfirmation, request, RequestError } from "./api";
import { CodeInput } from "./two-factor-panel";
import { passkeyMessage, passkeysSupported, unlockWithPasskey } from "./passkey";
import { toast } from "./feedback";

const UNLOCKED = "Changes for 15 minutes, the admin for 12 hours, on this device and network.";

/** How the admin opens on this site: the passkeys that work here, and whether an app code still does. */
export type UnlockStatus = { passkeys: number; passkeyOnly: boolean };
export const unlockStatus = () => request<UnlockStatus & { until: number | null; viewingUntil: number | null }>("/api/admin/elevate");

/**
 * The ways to open the admin, for the locked screen and the prompt alike: a
 * passkey first when there is one, then a code from the authenticator app —
 * or, once the administrator has chosen "passkey only", a recovery code
 * behind a link, as the way back in with the passkey lost.
 */
function Unlocker({ status, submitLabel, onDone, onCancel }: { status: UnlockStatus; submitLabel: string; onDone: () => void; onCancel?: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"" | "code" | "passkey">("");
  const [error, setError] = useState("");
  const [missing, setMissing] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const canPasskey = status.passkeys > 0 && passkeysSupported();
  const codeShown = !status.passkeyOnly || recovery || !canPasskey;

  const unlocked = () => {
    toast("Admin unlocked", { detail: UNLOCKED });
    onDone();
  };
  const withCode = async () => {
    setBusy("code");
    setError("");
    try {
      await request("/api/admin/elevate", { code });
      unlocked();
    } catch (e) {
      if (e instanceof RequestError && e.code === "TWO_FACTOR_REQUIRED" && !canPasskey) setMissing(true);
      setError((e as Error).message);
      setCode("");
    } finally {
      setBusy("");
    }
  };
  const withPasskey = async () => {
    setBusy("passkey");
    setError("");
    try {
      await unlockWithPasskey();
      unlocked();
    } catch (e) {
      setError(passkeyMessage(e));
    } finally {
      setBusy("");
    }
  };

  if (missing) {
    return (
      <>
        <p className="fine">Two-factor authentication is not on for this account yet. Turn it on in your wallet, then come back.</p>
        <Link className="btn btn-primary" href="/wallet" onClick={onCancel}>
          Open security settings
        </Link>
      </>
    );
  }
  const cancel = onCancel && (
    <button type="button" className="btn" disabled={!!busy} onClick={onCancel}>
      Cancel
    </button>
  );
  return (
    <>
      {canPasskey && (
        <button type="button" className="btn btn-primary unlock-passkey" disabled={!!busy} onClick={() => void withPasskey()} autoFocus>
          <KeyRound size={16} /> {busy === "passkey" ? "Waiting for your passkey…" : "Use a passkey"}
        </button>
      )}
      {codeShown ? (
        <Form
          onSubmit={(e) => {
            e.preventDefault();
            void withCode();
          }}
        >
          {canPasskey && <p className="fine unlock-or">{status.passkeyOnly ? "A recovery code opens it once, if the passkey is lost." : "Or enter a code from your authenticator app."}</p>}
          <CodeInput value={code} onChange={setCode} autoFocus={!canPasskey} />
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="row-actions" style={{ marginTop: 14 }}>
            {cancel}
            <button className={canPasskey ? "btn" : "btn btn-primary"} disabled={!!busy || !code.trim()}>
              {busy === "code" ? "Checking…" : submitLabel}
            </button>
          </div>
        </Form>
      ) : (
        <>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="row-actions unlock-lost">
            {cancel}
            <button type="button" className="text-button" onClick={() => setRecovery(true)}>
              Lost your passkey? Use a recovery code
            </button>
          </div>
        </>
      )}
    </>
  );
}

/**
 * The administrator's prompt. An administrator request made without a fresh
 * code comes back asking for one; this opens, takes a passkey or a code, and
 * the request goes through on its own (app/arena/api.ts retries it). Opening
 * covers the admin for 12 hours and changes for 15 minutes, on this device and
 * this network (lib/admin-guard.ts).
 */
export function AdminConfirm() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<UnlockStatus | null>(null);
  const settle = useRef<((ok: boolean) => void) | null>(null);

  useEffect(
    () =>
      onAdminConfirmation(
        () =>
          new Promise<boolean>((resolve) => {
            settle.current?.(false);
            settle.current = resolve;
            setStatus(null);
            setOpen(true);
            // Asked afresh each time: a passkey may have been added since.
            unlockStatus().then(setStatus, () => setStatus({ passkeys: 0, passkeyOnly: false }));
          }),
      ),
    [],
  );

  const finish = (ok: boolean) => {
    settle.current?.(ok);
    settle.current = null;
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && finish(false)}>
      <DialogContent className="dialog-dark">
        <DialogTitle>
          <ShieldCheck size={18} style={{ verticalAlign: "-3px", marginRight: 8 }} />
          Confirm it is you
        </DialogTitle>
        <DialogDescription>
          The admin can read every player&apos;s data and move the house&apos;s money, so each device and network needs your passkey or a code from your authenticator
          app. It opens the admin for 12 hours, and changes for the next 15 minutes.
        </DialogDescription>
        {status ? <Unlocker status={status} submitLabel="Confirm" onDone={() => finish(true)} onCancel={() => finish(false)} /> : <p className="fine">Checking…</p>}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The admin, shut: what an administrator sees on opening it without having
 * confirmed on this device and network. Opening it covers 12 hours.
 */
export function AdminUnlock({ status, onOpen }: { status: UnlockStatus | null; onOpen: () => void }) {
  return (
    <section className="panel admin-unlock">
      <ShieldCheck size={26} className="lime" />
      <h2>{status ? "The admin is locked" : "Checking access…"}</h2>
      {status && (
        <>
          <p className="muted">
            {status.passkeys && status.passkeyOnly ? "Use your passkey." : status.passkeys ? "Use your passkey, or a code from your authenticator app." : "Enter a code from your authenticator app."} It
            opens the admin on this device and this network for 12 hours, and administrator changes for the next 15 minutes.
          </p>
          <Unlocker status={status} submitLabel="Open the admin" onDone={onOpen} />
        </>
      )}
    </section>
  );
}
