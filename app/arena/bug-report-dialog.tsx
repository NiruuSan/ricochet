"use client";
import { useState } from "react";
import Link from "next/link";
import { Plus, Send, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Form } from "@/components/ui/form";
import { BUG_REPORT_LIMITS } from "@/lib/bug-report-types";
import { request } from "./api";
import styles from "./bug-reports.module.css";

export function BugReportDialog({ open, onOpenChange, signedIn, hasProfile }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  signedIn: boolean;
  hasProfile: boolean;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [links, setLinks] = useState([""]);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const changeOpen = (next: boolean) => {
    if (busy) return;
    if (!next) { setSent(false); setError(""); }
    onOpenChange(next);
  };

  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogContent className={`dialog-dark ${styles.dialog}`} showCloseButton={!busy}>
      <DialogTitle>Report a bug</DialogTitle>
      <DialogDescription>Tell us what went wrong. Your report goes to the site administrators.</DialogDescription>
      {!hasProfile ? <div>
        <p>{signedIn ? "Create your player profile to send a report." : "Sign in to send a bug report."}</p>
        <Link className="btn btn-primary" style={{ marginTop: 16 }} href={signedIn ? "/signup" : "/login"}>{signedIn ? "Create profile" : "Sign in"}</Link>
      </div> : sent ? <div>
        <p role="status">Bug report sent. Thanks for helping us improve Bounce.</p>
        <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => changeOpen(false)}>Done</button>
      </div> : <Form onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true); setError("");
        try {
          await request("/api/bug-reports", { title, description, links: links.map((link) => link.trim()).filter(Boolean), page: window.location.pathname });
          setSent(true); setTitle(""); setDescription(""); setLinks([""]);
        } catch (e) { setError((e as Error).message); }
        finally { setBusy(false); }
      }}>
        <fieldset disabled={busy} className={styles.fields}>
          <label className={styles.field}>Title
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} required minLength={3} maxLength={BUG_REPORT_LIMITS.title} placeholder="A short summary of the problem" />
          </label>
          <label className={styles.field}>What happened?
            <textarea className="input" value={description} onChange={(e) => setDescription(e.target.value)} required minLength={10} maxLength={BUG_REPORT_LIMITS.description} rows={5} placeholder="What were you doing? What did you expect, and what happened instead? Include steps to reproduce the bug." />
          </label>
          <div className={styles.field}>
            <span>Image or video links <span className="muted">(optional)</span></span>
            <p className="fine">Paste a shareable screenshot or video URL. Up to five links.</p>
            {links.map((link, index) => <div className={styles.linkRow} key={index}>
              <input className="input" type="url" aria-label={`Image or video link ${index + 1}`} placeholder="https://…" maxLength={BUG_REPORT_LIMITS.url} value={link}
                onChange={(e) => setLinks((current) => current.map((value, i) => i === index ? e.target.value : value))} />
              {links.length > 1 && <button type="button" className="btn" aria-label={`Remove link ${index + 1}`} onClick={() => setLinks((current) => current.filter((_, i) => i !== index))}><X size={16} /></button>}
            </div>)}
            {links.length < BUG_REPORT_LIMITS.links && <button type="button" className="btn" onClick={() => setLinks((current) => [...current, ""])}><Plus size={16} /> Add another link</button>}
          </div>
          <p className="fine">The current page is included with your report.</p>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="row-actions">
            <button type="button" className="btn" onClick={() => changeOpen(false)}>Cancel</button>
            <button className="btn btn-primary"><Send size={16} /> {busy ? "Sending…" : "Send bug report"}</button>
          </div>
        </fieldset>
      </Form>}
    </DialogContent>
  </Dialog>;
}
