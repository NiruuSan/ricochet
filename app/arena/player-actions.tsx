"use client";
import { useState } from "react";
import { Ban, Flag } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Form } from "@/components/ui/form";
import { Select } from "@/components/ui/select";
import { useActionDialog } from "@/components/ui/action-dialog";
import type { ReportKind } from "@/lib/api-types";
import { request } from "./api";

const KINDS: { value: ReportKind; label: string }[] = [
  { value: "cheating", label: "Cheating or automated play" },
  { value: "harassment", label: "Harassment or abuse" },
  { value: "spam", label: "Spam or scam" },
  { value: "other", label: "Something else" },
];

/**
 * What a player can do about another one: tell the house, or stop hearing from
 * them. Blocking is immediate and mutual in effect — it also ends the
 * friendship and the conversation, which the confirmation says plainly.
 */
export function PlayerActions({ name, onBlocked }: { name: string; onBlocked?: () => void }) {
  const dialog = useActionDialog();
  const [reporting, setReporting] = useState(false);
  const [kind, setKind] = useState<ReportKind>("cheating");
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const block = async () => {
    const sure = await dialog.confirm(
      `Block ${name}?\n\nThey will not be able to message you, add you, challenge you or tip you, and you will not be able to reach them either. If you are friends, that ends now, and your conversation is deleted.\n\nYou can unblock them from your friends page.`,
      { title: `Block ${name}`, confirmLabel: "Block", danger: true },
    );
    if (!sure) return;
    setBusy(true);
    setError("");
    try {
      await request("/api/friends", { action: "block", name });
      setNotice(`${name} is blocked.`);
      onBlocked?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    setBusy(true);
    setError("");
    try {
      await request("/api/friends", { action: "report", name, kind, detail });
      setReporting(false);
      setDetail("");
      setNotice("Thank you. An administrator will look at this.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button className="btn" disabled={busy} onClick={() => (setError(""), setNotice(""), setReporting(true))}>
        <Flag size={15} /> Report
      </button>
      <button className="btn" disabled={busy} onClick={() => void block()}>
        <Ban size={15} /> Block
      </button>
      {notice && (
        <span className="fine" role="status" style={{ color: "#c6f564" }}>
          {notice}
        </span>
      )}
      {error && !reporting && (
        <span className="fine" role="alert" style={{ color: "#ffb2bf" }}>
          {error}
        </span>
      )}

      <Dialog open={reporting} onOpenChange={(open) => !open && !busy && setReporting(false)}>
        <DialogContent className="dialog-dark">
          <DialogTitle>Report {name}</DialogTitle>
          <DialogDescription>
            This goes to an administrator, never to {name}. Say what happened and when — a match, a message, a pattern over several games.
          </DialogDescription>
          <Form
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <label className="field">
              What is this about
              <div style={{ marginTop: 8 }}>
                <Select label="What this report is about" value={kind} onValueChange={(value) => setKind(value as ReportKind)} options={KINDS} />
              </div>
            </label>
            <label className="field">
              What happened
              <textarea
                className="input"
                value={detail}
                onChange={(event) => setDetail(event.target.value.slice(0, 1000))}
                rows={4}
                minLength={10}
                required
                placeholder="A sentence or two is enough."
              />
            </label>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="row-actions" style={{ marginTop: 10 }}>
              <button type="button" className="btn" disabled={busy} onClick={() => setReporting(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" disabled={busy || detail.trim().length < 10}>
                {busy ? "Sending…" : "Send report"}
              </button>
            </div>
          </Form>
        </DialogContent>
      </Dialog>
    </>
  );
}
