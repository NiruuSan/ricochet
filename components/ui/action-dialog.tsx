"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { CircleAlert, MessageSquareText } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./dialog";
import { Form } from "./form";
import styles from "./overlays.module.css";

type Options = { title?: string; confirmLabel?: string; danger?: boolean; minLength?: number };
type Request = Options & { description: string; prompt: boolean; code?: boolean };
/** What a prompt comes back with: the reason, and the code when one was asked for. */
type Answer = { reason: string; code: string };
type Actions = {
  confirm: (description: string, options?: Options) => Promise<boolean>;
  prompt: (description: string, options?: Options) => Promise<string | null>;
  /** A reason plus the administrator's own authentication code, for what cannot be undone. */
  promptSigned: (description: string, options?: Options) => Promise<Answer | null>;
};
const Context = createContext<Actions | null>(null);

export function ActionDialogProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<Request | null>(null);
  const [value, setValue] = useState("");
  const [code, setCode] = useState("");
  const pending = useRef<((value: Answer | null) => void) | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();
  const finish = useCallback((result: Answer | null) => {
    const resolve = pending.current;
    pending.current = null;
    setRequest(null);
    resolve?.(result);
  }, []);
  useEffect(() => () => { pending.current?.(null); pending.current = null; }, []);
  useEffect(() => { finish(null); }, [pathname, finish]);
  useEffect(() => { if (request && !request.prompt) cancelButton.current?.focus(); }, [request]);
  const ask = useCallback((next: Request) => new Promise<Answer | null>((resolve) => {
    // A second action cannot replace an unanswered confirmation.
    if (pending.current) { resolve(null); return; }
    const active = document.activeElement;
    // Consecutive steps (reason, then confirmation) return to the original action.
    if (active instanceof HTMLElement && !active.closest('[data-slot="dialog-content"]')) returnFocus.current = active;
    pending.current = resolve;
    setValue("");
    setCode("");
    setRequest(next);
  }), []);
  const actions: Actions = {
    confirm: async (description, options) => (await ask({ ...options, description, prompt: false })) !== null,
    prompt: async (description, options) => (await ask({ ...options, description, prompt: true }))?.reason ?? null,
    promptSigned: (description, options) => ask({ ...options, description, prompt: true, code: true }),
  };
  return <Context.Provider value={actions}>
    {children}
    <Dialog open={!!request} onOpenChange={(open) => { if (!open) finish(null); }}>
      <DialogContent className={`dialog-dark ${styles.actionDialog}`} onOpenAutoFocus={(event) => {
        if (!request?.prompt) { event.preventDefault(); cancelButton.current?.focus(); }
      }} onCloseAutoFocus={(event) => { event.preventDefault(); if (!pending.current) returnFocus.current?.focus(); }}>
        <div className={`${styles.dialogIcon} ${request?.danger ? styles.danger : ""}`}>{request?.prompt ? <MessageSquareText size={22} /> : <CircleAlert size={22} />}</div>
        <DialogTitle>{request?.title ?? (request?.prompt ? "Add a reason" : "Confirm action")}</DialogTitle>
        <DialogDescription className={styles.dialogDescription}>{request?.description}</DialogDescription>
        <Form key={request?.description} onSubmit={(event) => { event.preventDefault(); finish({ reason: request?.prompt ? value.trim() : "confirmed", code: code.trim() }); }}>
          {request?.prompt && <label className="field">Reason<textarea className="input" value={value} onChange={(event) => setValue(event.target.value)} required minLength={request.minLength ?? 3} maxLength={500} rows={3} placeholder="Explain the reason for this action" /></label>}
          {request?.code && <label className="field">Your authentication code<input className="input" value={code} onChange={(event) => setCode(event.target.value.slice(0, 16))} required inputMode="text" autoComplete="one-time-code" placeholder="123 456 or ABCDE-FGHIJ" style={{ letterSpacing: 2 }} /></label>}
          <div className={styles.dialogActions}><button ref={cancelButton} className="btn" type="button" onClick={() => finish(null)}>Cancel</button><button type="submit" className={`btn ${request?.danger ? styles.dangerButton : "btn-primary"}`}>{request?.confirmLabel ?? "Continue"}</button></div>
        </Form>
      </DialogContent>
    </Dialog>
  </Context.Provider>;
}

export function useActionDialog() {
  const context = useContext(Context);
  if (!context) throw new Error("useActionDialog needs ActionDialogProvider");
  return context;
}
