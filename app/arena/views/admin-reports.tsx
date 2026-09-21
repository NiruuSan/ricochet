"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Flag } from "lucide-react";
import { useActionDialog } from "@/components/ui/action-dialog";
import type { ReportRow } from "@/lib/api-types";
import { request } from "../api";
import { timeAgo } from "../format";
import styles from "./tournaments.module.css";

const REFRESH_MS = 30_000;
const LABELS: Record<string, string> = {
  cheating: "Cheating or automated play",
  harassment: "Harassment or abuse",
  spam: "Spam or scam",
  other: "Something else",
};

/**
 * What players have told the house about each other. Open reports first; a
 * closed one keeps the note that says what was done about it.
 */
export function AdminReports() {
  const dialog = useActionDialog();
  const [list, setList] = useState<ReportRow[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(
    () =>
      request<ReportRow[]>("/api/admin/reports").then(
        (next) => (setList(next), setError("")),
        (e: Error) => setError(e.message),
      ),
    [],
  );
  useEffect(() => {
    void load();
    const timer = setInterval(() => !document.hidden && void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const resolve = async (report: ReportRow) => {
    const note = await dialog.prompt(
      `Close the report about ${report.target ?? "this player"}?\n\nWrite what was done about it: nothing, a warning, a suspension from the anti-cheat tab. The note stays on the report and in the audit log.`,
      { title: "Close report", confirmLabel: "Close report" },
    );
    if (note === null) return;
    setBusy(report.id);
    setError("");
    setNotice("");
    try {
      await request("/api/admin/reports", { action: "resolve", id: report.id, note });
      await load();
      setNotice("Report closed.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const open = (list ?? []).filter((r) => r.status === "open");

  return (
    <>
      <h2 style={{ margin: "30px 0 6px" }}>Reports</h2>
      <p className="muted">
        What players have said about each other. Blocking is theirs to do and needs nothing from you; this is the queue for everything else. Suspensions are still
        made from the Anti-cheat tab.
      </p>
      {error && (
        <div className="error" role="alert" style={{ marginTop: 14 }}>
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <p className="success" role="status" style={{ marginTop: 14 }}>
          {notice}
        </p>
      )}
      {!list ? (
        <p className="muted" style={{ marginTop: 16 }}>Loading…</p>
      ) : !list.length ? (
        <p className={styles.empty} style={{ marginTop: 16 }}>Nobody has reported anybody.</p>
      ) : (
        <div style={{ marginTop: 16 }}>
          <p className="fine" style={{ marginBottom: 10 }}>
            {open.length} open · {list.length} in all
          </p>
          {list.map((report) => (
            <div key={report.id} className={styles.adminRow} style={{ opacity: report.status === "open" ? 1 : 0.65 }}>
              <div>
                <b>
                  <Flag size={13} style={{ verticalAlign: -1, color: report.status === "open" ? "#ffb86b" : "#8e9cb1" }} />{" "}
                  {report.target ? <Link href={`/players/${encodeURIComponent(report.target)}`}>{report.target}</Link> : "A closed account"}
                  {report.against > 1 && <span className={styles.muted} style={{ marginLeft: 8 }}>{report.against} reports in all</span>}
                </b>
                <span className={styles.muted}>
                  {LABELS[report.kind] ?? report.kind} · from {report.reporter ?? "a closed account"} · {timeAgo(report.created)}
                </span>
                <p className="fine" style={{ marginTop: 6, maxWidth: 620, whiteSpace: "pre-line" }}>
                  {report.detail}
                </p>
                {report.note && (
                  <p className="fine" style={{ marginTop: 6, color: "#c6f564" }}>
                    Closed {report.reviewedAt ? timeAgo(report.reviewedAt) : ""} · {report.note}
                  </p>
                )}
              </div>
              {report.status === "open" && (
                <button className="btn" disabled={busy === report.id} onClick={() => void resolve(report)}>
                  {busy === report.id ? "Closing…" : "Close"}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
