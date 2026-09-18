"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, ShieldAlert } from "lucide-react";
import { useActionDialog } from "@/components/ui/action-dialog";
import type { CheatCase } from "@/lib/anti-cheat-admin";
import type { PlayerState } from "../arena";
import { request } from "../api";
import { CaseDetails } from "./anti-cheat-case-details";
import styles from "./anti-cheat.module.css";

export function AdminCaseView({ name, player }: { name: string; player: PlayerState }) {
  const { data, loaded } = player;
  const dialog = useActionDialog();
  const [item, setItem] = useState<CheatCase | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const load = useCallback(() => request<CheatCase>(`/api/admin/anti-cheat?name=${encodeURIComponent(name)}`), [name]);
  useEffect(() => {
    if (!data.isAdmin) return;
    let active = true;
    const refresh = () => load().then((next) => { if (active) { setItem(next); setError(""); } }, (e: Error) => { if (active) setError(e.message); });
    void refresh();
    const timer = setInterval(() => { if (!document.hidden) void refresh(); }, 30_000);
    return () => { active = false; clearInterval(timer); };
  }, [data.isAdmin, load, revision]);

  const act = async (body: Record<string, unknown>, question?: string) => {
    if (question && !(await dialog.confirm(question, { title: "Ban & seize balances", confirmLabel: "Ban & seize", danger: true }))) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await request("/api/admin/anti-cheat", body);
      setItem(await load());
      setNotice("Case updated.");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  if (!loaded || !data.isAdmin) return <section className={styles.page}><div className={styles.state}><h1>{loaded ? "Administrator access required." : "Checking access…"}</h1><p>This review is available only to administrators.</p></div></section>;
  return <section className={styles.page}>
    <Link className={styles.back} href="/admin?tab=anti-cheat"><ArrowLeft size={15} />Back to anti-cheat</Link>
    <header className={styles.heading}><div><div className={styles.eyebrow}><ShieldAlert size={15} />PLAYER REVIEW</div><h1>{item?.name ?? name}</h1><p>Evidence, recent activity, and moderation history.</p></div><Link href={`/players/${encodeURIComponent(item?.name ?? name)}`}>Public profile <ArrowUpRight size={16} /></Link></header>
    {error && <div className={styles.error} role="alert"><span>{error}</span><button className="btn" onClick={() => setRevision((current) => current + 1)}>Retry</button></div>}
    {notice && <p className="success" role="status">{notice}</p>}
    {item ? <CaseDetails item={item} busy={busy} onAction={(body, question) => void act(body, question)} /> : <p className={styles.state}>{error ? "This player review could not be loaded." : "Loading player review…"}</p>}
  </section>;
}
