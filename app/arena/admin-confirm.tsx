"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { Form } from "@/components/ui/form";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { onAdminConfirmation, request, RequestError } from "./api";
import { CodeInput } from "./two-factor-panel";
import { toast } from "./feedback";

const UNLOCKED = "Changes for 15 minutes, the admin for 12 hours, on this device and network.";

/**
 * The administrator's code prompt. An administrator request made without a
 * fresh code comes back asking for one; this opens, takes the code, and the
 * request goes through on its own (app/arena/api.ts retries it). One code opens
 * the admin for 12 hours and changes for 15 minutes, on this device and this
 * network (lib/admin-guard.ts).
 */
export function AdminConfirm() {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [missing, setMissing] = useState(false);
  const settle = useRef<((ok: boolean) => void) | null>(null);

  useEffect(
    () =>
      onAdminConfirmation(
        () =>
          new Promise<boolean>((resolve) => {
            settle.current?.(false);
            settle.current = resolve;
            setCode("");
            setError("");
            setMissing(false);
            setOpen(true);
          }),
      ),
    [],
  );

  const finish = (ok: boolean) => {
    settle.current?.(ok);
    settle.current = null;
    setOpen(false);
  };

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      await request("/api/admin/elevate", { code });
      toast("Admin unlocked", { detail: UNLOCKED });
      finish(true);
    } catch (e) {
      if (e instanceof RequestError && e.code === "TWO_FACTOR_REQUIRED") setMissing(true);
      setError((e as Error).message);
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && !next && finish(false)}>
      <DialogContent className="dialog-dark">
        <DialogTitle>
          <ShieldCheck size={18} style={{ verticalAlign: "-3px", marginRight: 8 }} />
          Confirm it is you
        </DialogTitle>
        <DialogDescription>
          The admin can read every player&apos;s data and move the house&apos;s money, so each device and network needs a code from your authenticator app. One
          code opens the admin for 12 hours, and changes for the next 15 minutes.
        </DialogDescription>
        {missing ? (
          <>
            <p className="fine">Two-factor authentication is not on for this account yet. Turn it on in your wallet, then come back.</p>
            <Link className="btn btn-primary" href="/wallet" onClick={() => finish(false)}>
              Open security settings
            </Link>
          </>
        ) : (
          <Form
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <CodeInput value={code} onChange={setCode} autoFocus />
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="row-actions" style={{ marginTop: 14 }}>
              <button type="button" className="btn" disabled={busy} onClick={() => finish(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" disabled={busy || !code.trim()}>
                {busy ? "Checking…" : "Confirm"}
              </button>
            </div>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The admin, shut: what an administrator sees on opening it without a code on
 * this device and network. One code opens it for 12 hours.
 */
export function AdminUnlock({ checking, onOpen }: { checking: boolean; onOpen: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [missing, setMissing] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      await request("/api/admin/elevate", { code });
      toast("Admin unlocked", { detail: UNLOCKED });
      onOpen();
    } catch (e) {
      if (e instanceof RequestError && e.code === "TWO_FACTOR_REQUIRED") setMissing(true);
      setError((e as Error).message);
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel admin-unlock">
      <ShieldCheck size={26} className="lime" />
      <h2>{checking ? "Checking access…" : "The admin is locked"}</h2>
      {!checking &&
        (missing ? (
          <>
            <p className="muted">Two-factor authentication is not on for this account yet. Turn it on in your wallet, then come back.</p>
            <Link className="btn btn-primary" href="/wallet">
              Open security settings
            </Link>
          </>
        ) : (
          <>
            <p className="muted">
              Enter a code from your authenticator app. It opens the admin on this device and this network for 12 hours, and administrator changes for the next 15
              minutes.
            </p>
            <Form
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <CodeInput value={code} onChange={setCode} autoFocus />
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              <button className="btn btn-primary" disabled={busy || !code.trim()} style={{ marginTop: 14 }}>
                {busy ? "Checking…" : "Open the admin"}
              </button>
            </Form>
          </>
        ))}
    </section>
  );
}
