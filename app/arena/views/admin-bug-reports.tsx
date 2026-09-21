"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { BugReport, BugReportPage } from "@/lib/bug-report-types";
import { request } from "../api";
import styles from "../bug-reports.module.css";

export function AdminBugReports() {
  const [offset, setOffset] = useState(0);
  return <>
    <h2 style={{ margin: "30px 0 6px" }}>Bug reports</h2>
    <p className="muted">Problems reported by players, newest first. Resolved reports remain in this inbox.</p>
    <ReportPage key={offset} offset={offset} onPage={setOffset} />
  </>;
}

function ReportPage({ offset, onPage }: { offset: number; onPage: (offset: number) => void }) {
  const [data, setData] = useState<BugReportPage | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    const load = () => request<BugReportPage>(`/api/admin/bug-reports?offset=${offset}`).then(
      (next) => { if (active) { setData(next); setError(""); } },
      (e: Error) => { if (active) setError(e.message); },
    );
    void load();
    const timer = setInterval(() => { if (!document.hidden) void load(); }, 30_000);
    return () => { active = false; clearInterval(timer); };
  }, [offset, revision]);

  const update = async (report: BugReport) => {
    setBusy(report.id); setError(""); setNotice("");
    const status = report.status === "open" ? "resolved" : "open";
    try {
      await request("/api/admin/bug-reports", { id: report.id, status });
      setRevision((value) => value + 1);
      setNotice(status === "resolved" ? "Bug report marked as resolved." : "Bug report reopened.");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(""); }
  };

  return <>
    {error && <div className="error" role="alert"><span>{error}</span><button className="btn" onClick={() => setRevision((value) => value + 1)}>Retry</button></div>}
    {notice && <p className="success" role="status">{notice}</p>}
    {!data ? !error && <p className="muted">Loading bug reports…</p> : <>
      <p className={styles.meta}>{data.total} {data.total === 1 ? "report" : "reports"}</p>
      {!data.reports.length && <p className="muted" style={{ marginTop: 20 }}>{offset ? "No reports on this page." : "No bugs reported yet."}</p>}
      {data.reports.map((report) => <article key={report.id} className={styles.report}>
        <div className={styles.heading}>
          <div><h3>{report.title}</h3><p className={styles.meta}>
            {report.reporter ? <Link href={`/players/${encodeURIComponent(report.reporter)}`}>{report.reporter}</Link> : "Deleted player"}
            {" · "}<time dateTime={new Date(report.created).toISOString()}>{new Date(report.created).toLocaleString()}</time>
          </p></div>
          <span className={`tag ${report.status === "open" ? "lime" : ""}`}>{report.status === "open" ? "OPEN" : "RESOLVED"}</span>
        </div>
        <p className={styles.description}>{report.description}</p>
        {report.page && <p className={styles.meta}>Page: {report.page}</p>}
        {!!report.attachments?.length && <div className={styles.attachments}>{report.attachments.map((file) => {
          const src = `/api/bug-reports/attachments/${file.id}`;
          return <div className={styles.attachment} key={file.id}>
            {file.type.startsWith("video/") ? <video src={src} controls preload="none" playsInline aria-label={file.name} /> : file.type === "image/heic" || file.type === "image/heif" ? <p className="muted">HEIC image — download to view</p> :
              // These private images require the admin session cookie; Next's image optimizer cannot fetch them.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={src} alt={file.name} loading="lazy" />}
            <a href={`${src}?download=1`}>Download {file.name}</a>
            <p className={styles.meta}>{(file.size / 1024 / 1024).toFixed(1)} MB</p>
          </div>;
        })}</div>}
        {report.links.length > 0 && <ul className={styles.links}>{report.links.map((url, index) => <li key={index}>
          <a href={url} target="_blank" rel="noopener noreferrer">Image / video {index + 1} — {url}</a>
        </li>)}</ul>}
        <button className="btn" style={{ marginTop: 14 }} disabled={!!busy} onClick={() => void update(report)}>
          {busy === report.id ? "Saving…" : report.status === "open" ? "Mark as resolved" : "Reopen report"}
        </button>
      </article>)}
      <div className={styles.pagination}>
        <button className="btn" disabled={!offset || !!busy} onClick={() => onPage(Math.max(0, offset - data.limit))}>Previous</button>
        <span className="muted">Page {Math.floor(offset / data.limit) + 1}</span>
        <button className="btn" disabled={offset + data.limit >= data.total || !!busy} onClick={() => onPage(offset + data.limit)}>Next</button>
      </div>
    </>}
  </>;
}
