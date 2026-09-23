"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Flag } from "lucide-react";
import { useActionDialog } from "@/components/ui/action-dialog";
import type { ReportRow } from "@/lib/api-types";
import { request } from "../api";
import { timeAgo } from "../format";
import styles from "./admin.module.css";

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
    <section className={styles.section}>
      {error && (
        <div className="error" role="alert">
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <p className="success" role="status">
          {notice}
        </p>
      )}
      {!list ? (
        <p className={styles.loading}>Loading reports…</p>
      ) : !list.length ? (
        <p className={styles.empty}>Nobody has reported anybody.</p>
      ) : (
        <>
          <p className={styles.fine}>
            {open.length} open · {list.length} in all. Blocking is the players&apos; own to do and needs nothing from you.
          </p>
          <div className={styles.list}>
            {list.map((report) => (
              <div key={report.id} className={`${styles.row} ${report.status === "open" ? "" : styles.done}`}>
                <div className={styles.who}>
                  <Flag size={17} color={report.status === "open" ? "#ffb86b" : "#8e9cb1"} />
                  <div>
                    <b>
                      {report.target ? <Link href={`/players/${encodeURIComponent(report.target)}`}>{report.target}</Link> : "A closed account"}
                      {report.against > 1 && <span className={`${styles.chip} ${styles.warn}`}>{report.against} reports</span>}
                    </b>
                    <span>{timeAgo(report.created)}</span>
                  </div>
                </div>
                <div className={styles.cells}>
                  <div className={styles.cell}>
                    <span>Reason given</span>
                    <b>{LABELS[report.kind] ?? report.kind}</b>
                  </div>
                  <div className={styles.cell}>
                    <span>Reported by</span>
                    <b>{report.reporter ?? "A closed account"}</b>
                  </div>
                </div>
                <div className={styles.actions}>
                  {report.status === "open" ? (
                    <button className="btn" disabled={busy === report.id} onClick={() => void resolve(report)}>
                      {busy === report.id ? "Closing…" : "Close report"}
                    </button>
                  ) : (
                    <span className={styles.chip}>Closed</span>
                  )}
                </div>
                <p className={styles.note}>{report.detail}</p>
                {report.note && (
                  <p className={`${styles.note} ${styles.noteDone}`}>
                    Closed {report.reviewedAt ? timeAgo(report.reviewedAt) : ""} · {report.note}
                  </p>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
