"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, Equal, Gift, Medal, ShieldAlert, Trophy, X } from "lucide-react";
import type { NotificationItem } from "@/lib/api-types";
import { request } from "./api";
import { CURRENCY, units } from "./format";
import styles from "./notifications.module.css";

const TOAST_MS = 6_500;

function timeAgo(ms: number, now = Date.now()) {
  const minutes = Math.round((now - ms) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const ordinal = (n: number) => `${n}${[, "st", "nd", "rd"][(n % 100 >> 3) ^ 1 && n % 10] || "th"}`;

function describe(n: NotificationItem): { tone: "win" | "loss" | "draw" | "tip" | "tournament" | "security"; title: string; detail: string } {
  if (n.kind === "security_reset") {
    return { tone: "security", title: "Your two-factor authentication was reset", detail: `An administrator reset your authenticator. Withdrawals are paused until ${new Date(n.data.holdUntil).toLocaleString()}. Set up two-factor again in your wallet. If you did not request this, contact support.` };
  }
  if (n.kind === "tip_received") {
    return { tone: "tip", title: `${n.data.from} tipped you`, detail: `+${units(n.data.amount, "devnet")} SOL` };
  }
  if (n.kind === "tournament_result") {
    const { name, rank, players, payout, refund, asset } = n.data;
    if (rank === null) return { tone: "tournament", title: refund ? `${name} was called off` : `${name} has ended`, detail: refund ? `Entry refunded · +${units(refund, asset)} ${CURRENCY[asset]}` : "You did not play your run" };
    return {
      tone: payout > 0 ? "win" : "tournament",
      title: `${ordinal(rank)} of ${players} in ${name}`,
      detail: payout > 0 ? `Prize +${units(payout, asset)} ${CURRENCY[asset]}` : "Outside the prize places this time",
    };
  }
  const { result, opponent, net, asset, score, opponentScore } = n.data;
  const vs = opponent ?? "your opponent";
  const scores = `${score.toLocaleString("en")} – ${opponentScore.toLocaleString("en")}`;
  const bonus = n.data.bonusGems ? ` · +${n.data.bonusGems} gems` : "";
  if (result === "win") return { tone: "win", title: `You won vs ${vs}`, detail: `+${units(net, asset)} ${CURRENCY[asset]}${bonus} · ${scores}` };
  if (result === "loss") return { tone: "loss", title: `You lost vs ${vs}`, detail: `${units(net, asset)} ${CURRENCY[asset]} · ${scores}` };
  return { tone: "draw", title: `Draw vs ${vs}`, detail: `Entry refunded · ${scores}` };
}

function Icon({ tone }: { tone: ReturnType<typeof describe>["tone"] }) {
  const Glyph = tone === "security" ? ShieldAlert : tone === "tip" ? Gift : tone === "tournament" ? Medal : tone === "draw" ? Equal : tone === "loss" ? X : Trophy;
  return (
    <span className={`${styles.icon} ${styles[tone]}`}>
      <Glyph size={16} />
    </span>
  );
}

type Props = {
  /** Undefined until the player's snapshot has loaded. */
  items: NotificationItem[] | undefined;
  unread: number;
  /** Opens a match's end-of-run screen. */
  onOpenMatch: (matchId: string) => void;
  /** Called after notifications were marked read, so the snapshot can refresh. */
  onRead: () => void;
  /** A match whose result is on screen right now; it is not announced again. */
  viewingMatchId: string | null;
};

type Toast = { key: string; item?: NotificationItem; summary?: string };

/** The bell in the top bar and the toasts for anything that arrives. */
export function Notifications({ items, unread, onOpenMatch, onRead, viewingMatchId }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [tracked, setTracked] = useState<{ items: NotificationItem[]; seen: Set<string> } | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  // Announce what is new whenever a snapshot arrives. On the first one, summarize
  // what happened while the player was away. (State adjusted during render, not in an effect.)
  if (items && items !== tracked?.items) {
    const fresh = items.filter((n) => !n.read && !(tracked?.seen.has(n.id)) && (n.kind !== "match_result" || n.data.matchId !== viewingMatchId));
    setTracked({ items, seen: new Set([...(tracked?.seen ?? []), ...items.map((n) => n.id)]) });
    if (!tracked && fresh.length > 1) {
      const wins = fresh.filter((n) => n.kind === "match_result" && n.data.result === "win").length;
      const losses = fresh.filter((n) => n.kind === "match_result" && n.data.result === "loss").length;
      const draws = fresh.filter((n) => n.kind === "match_result" && n.data.result === "draw").length;
      const tips = fresh.filter((n) => n.kind === "tip_received").length;
      const plural = (count: number, word: string, many = `${word}s`) => count && `${count} ${count > 1 ? many : word}`;
      const parts = [plural(wins, "win"), plural(losses, "loss", "losses"), plural(draws, "draw"), plural(tips, "tip")].filter(Boolean);
      setToasts([{ key: "summary", summary: `While you were away: ${parts.join(", ") || `${fresh.length} updates`}.` }]);
    } else if (fresh.length) {
      setToasts((current) => [...fresh.slice(0, 3).map((item) => ({ key: item.id, item })), ...current].slice(0, 3));
    }
  }

  useEffect(() => {
    if (!toasts.length) return;
    const timer = setTimeout(() => setToasts((current) => current.slice(0, -1)), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toasts]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !panel.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const markAllRead = () => request("/api/notifications", { action: "read" }).then(onRead, () => {});

  const select = (n: NotificationItem) => {
    setOpen(false);
    setToasts([]);
    if (!n.read) void request("/api/notifications", { action: "read", ids: [n.id] }).then(onRead, () => {});
    if (n.kind === "match_result") onOpenMatch(n.data.matchId);
    else if (n.kind === "tournament_result") router.push(`/tournaments/${n.data.tournamentId}`);
    else router.push("/wallet");
  };

  return (
    <>
      <div className={styles.wrap} ref={panel}>
        <button
          className={styles.bell}
          aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
          aria-expanded={open}
          onClick={() => {
            setOpen((v) => !v);
            setToasts([]);
          }}
        >
          <Bell size={19} />
          {unread > 0 && <span className={styles.badge}>{unread > 9 ? "9+" : unread}</span>}
        </button>
        {open && (
          <div className={styles.panel} role="dialog" aria-label="Notifications">
            <div className={styles.panelHead}>
              <b>Notifications</b>
              {unread > 0 && (
                <button className={styles.markRead} onClick={() => void markAllRead()}>
                  Mark all as read
                </button>
              )}
            </div>
            {!items?.length ? (
              <p className={styles.empty}>Match results and tips will show up here.</p>
            ) : (
              <ul className={styles.list}>
                {items.map((n) => {
                  const d = describe(n);
                  return (
                    <li key={n.id}>
                      <button className={`${styles.item} ${n.read ? "" : styles.unread}`} onClick={() => select(n)}>
                        <Icon tone={d.tone} />
                        <span className={styles.text}>
                          <b>{d.title}</b>
                          <span>{d.detail}</span>
                        </span>
                        <time className={styles.time}>{timeAgo(n.created)}</time>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>
      <div className={styles.toasts} aria-live="polite">
        {toasts.map((t) => {
          const d = t.item ? describe(t.item) : null;
          return (
            <div key={t.key} className={`${styles.toast} ${d ? styles[d.tone] : ""}`}>
              <button className={styles.toastBody} onClick={() => (t.item ? select(t.item) : (setToasts([]), setOpen(true)))}>
                {d ? <Icon tone={d.tone} /> : <Bell size={18} className={styles.summaryIcon} />}
                <span className={styles.text}>
                  <b>{d ? d.title : "Welcome back"}</b>
                  <span>{d ? d.detail : t.summary}</span>
                </span>
              </button>
              <button className={styles.dismiss} aria-label="Dismiss" onClick={() => setToasts((current) => current.filter((x) => x.key !== t.key))}>
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}
