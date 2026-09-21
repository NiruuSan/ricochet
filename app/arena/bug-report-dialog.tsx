"use client";
import { useState } from "react";
import Link from "next/link";
import { Paperclip, Send, X } from "lucide-react";
import { upload } from "@vercel/blob/client";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Form } from "@/components/ui/form";
import { BUG_ATTACHMENT_LIMITS, BUG_ATTACHMENT_TYPES, BUG_REPORT_LIMITS } from "@/lib/bug-report-types";
import { request } from "./api";
import styles from "./bug-reports.module.css";

/**
 * The upload SDK reports every refusal from our own route as one opaque line,
 * so ask the route again for the reason it gave. Reserving a file is
 * idempotent — asking twice for the same file changes nothing — and if the
 * second ask succeeds, the token was never the problem: the transfer was.
 */
async function uploadFailure(id: string, file: File) {
  try {
    await request("/api/bug-reports/upload", {
      type: "blob.generate-client-token",
      payload: { pathname: `bug-reports/${id}`, multipart: false, clientPayload: JSON.stringify({ name: file.name, type: file.type, size: file.size }) },
    });
  } catch (e) {
    return (e as Error).message;
  }
  return `${file.name} could not be uploaded. Check your connection and try again.`;
}

export function BugReportDialog({ open, onOpenChange, signedIn, hasProfile }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  signedIn: boolean;
  hasProfile: boolean;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<{ id: string; file: File; uploaded: boolean }[]>([]);
  const [progress, setProgress] = useState("");
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
          for (const [index, attachment] of files.entries()) {
            if (attachment.uploaded) continue;
            const { file, id } = attachment;
            setProgress(`Uploading file ${index + 1} of ${files.length}…`);
            try {
              await upload(`bug-reports/${id}`, file, {
                access: "private", contentType: file.type, handleUploadUrl: "/api/bug-reports/upload",
                clientPayload: JSON.stringify({ name: file.name, type: file.type, size: file.size }),
                multipart: file.size > 4 * 1024 * 1024,
                onUploadProgress: ({ percentage }) => setProgress(`Uploading file ${index + 1} of ${files.length}: ${Math.round(percentage)}%`),
              });
            } catch {
              throw new Error(await uploadFailure(id, file));
            }
            setFiles((current) => current.map((item) => item.id === id ? { ...item, uploaded: true } : item));
          }
          setProgress("Sending report…");
          await request("/api/bug-reports", { title, description, attachments: files.map((file) => file.id), page: window.location.pathname });
          setSent(true); setTitle(""); setDescription(""); setFiles([]);
        } catch (e) { setError((e as Error).message); }
        finally { setBusy(false); setProgress(""); }
      }}>
        <fieldset disabled={busy} className={styles.fields}>
          <label className={styles.field}>Title
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} required minLength={3} maxLength={BUG_REPORT_LIMITS.title} placeholder="A short summary of the problem" />
          </label>
          <label className={styles.field}>What happened?
            <textarea className="input" value={description} onChange={(e) => setDescription(e.target.value)} required minLength={10} maxLength={BUG_REPORT_LIMITS.description} rows={5} placeholder="What were you doing? What did you expect, and what happened instead? Include steps to reproduce the bug." />
          </label>
          <div className={styles.field}>
            <label htmlFor="bug-attachments"><Paperclip size={15} style={{ display: "inline" }} /> Images or videos <span className="muted">(optional)</span></label>
            <p className="fine" id="bug-attachment-help">Up to five files, 25 MB each. JPG, PNG, WebP, GIF, HEIC, MP4, WebM or MOV.</p>
            <input id="bug-attachments" className={`input ${styles.fileInput}`} type="file" multiple accept={BUG_ATTACHMENT_TYPES.join(",")}
              aria-describedby="bug-attachment-help" disabled={files.length >= BUG_ATTACHMENT_LIMITS.count}
              onChange={(event) => {
                const selected = Array.from(event.target.files ?? []);
                event.target.value = "";
                if (files.length + selected.length > BUG_ATTACHMENT_LIMITS.count) { setError("Attach up to five files."); return; }
                for (const file of selected) {
                  if (!BUG_ATTACHMENT_TYPES.includes(file.type)) { setError(`${file.name}: choose a supported image or video format.`); return; }
                  if (file.size <= 0 || file.size > BUG_ATTACHMENT_LIMITS.bytes) { setError(`${file.name}: choose a non-empty file no larger than 25 MB.`); return; }
                  if (file.name.length > BUG_ATTACHMENT_LIMITS.name) { setError("Shorten the filename to 180 characters or fewer."); return; }
                }
                setError("");
                setFiles((current) => [...current, ...selected.map((file) => ({ id: crypto.randomUUID(), file, uploaded: false }))]);
              }} />
            <ul className={styles.fileList}>{files.map(({ id, file, uploaded }) => <li key={id}>
              <span>{file.name}<small>{(file.size / 1024 / 1024).toFixed(1)} MB{uploaded ? " · Uploaded" : ""}</small></span>
              <button type="button" className="btn" aria-label={`Remove ${file.name}`} onClick={() => setFiles((current) => current.filter((item) => item.id !== id))}><X size={16} /></button>
            </li>)}</ul>
          </div>
          <p className="fine">The current page is included with your report.</p>
          {error && <p className="error" role="alert">{error}</p>}
          {progress && <p role="status" className="fine">{progress}</p>}
          <div className="row-actions">
            <button type="button" className="btn" onClick={() => changeOpen(false)}>Cancel</button>
            <button className="btn btn-primary"><Send size={16} /> {busy ? "Sending…" : "Send bug report"}</button>
          </div>
        </fieldset>
      </Form>}
    </DialogContent>
  </Dialog>;
}
