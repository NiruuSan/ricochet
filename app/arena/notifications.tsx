"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, Equal, Gift, Medal, ShieldAlert, Trophy, X } from "lucide-react";
import type { NotificationItem } from "@/lib/api-types";
import { request } from "./api";
import { PushControl } from "./push-control";
import { CURRENCY, timeAgo, units } from "./format";
import styles from "./notifications.module.css";

const TOAST_MS = 6_500;

const ordinal = (n: number) => `${n}${[, "st", "nd", "rd"][(n % 100 >> 3) ^ 1 && n % 10] || "th"}`;

function describe(n: NotificationItem): { tone: "win" | "loss" | "draw" | "tip" | "tournament" | "security"; title: string; detail: string } {
  if (n.kind === "security_reset") {
    return { tone: "security", title: "Your two-factor authentication was reset", detail: `An administrator reset your authenticator. Withdrawals are paused until ${new Date(n.data.holdUntil).toLocaleString()}. Set up two-factor again in your wallet. If you did not request this, contact support.` };
  }
  if (n.kind === "security_alert") {
    const { event, amount, to } = n.data;
    if (event === "withdrawal_started") return { tone: "security", title: "A withdrawal was started", detail: `${units(amount ?? 0, "devnet")} SOL to ${to ? `${to.slice(0, 6)}…${to.slice(-4)}` : "an external wallet"}. If this was not you, contact support now.` };
    if (event === "tip_sent") return { tone: "security", title: `You tipped ${to ?? "a player"}`, detail: `−${units(amount ?? 0, "devnet")} SOL left your balance. If this was not you, contact support now.` };
    if (event === "two_factor_disabled") return { tone: "security", title: "Two-factor authentication was turned off", detail: "Withdrawals and larger tips are blocked until you turn it back on. If this was not you, sign out everywhere and contact support." };
    if (event === "signed_out_everywhere") return { tone: "security", title: "You signed out everywhere", detail: "Every other session was ended. Sign in again on your other devices." };
    return { tone: "security", title: "Your recovery codes were replaced", detail: "The previous codes no longer work. If this was not you, sign out everywhere and contact support." };
  }
  if (n.kind === "account_suspended") {
    return { tone: "security", title: "Your account is suspended", detail: `${n.data.reason}. Play, withdrawals and tips are paused while this is reviewed. Contact support if you think this is a mistake.` };
  }
  if (n.kind === "race_result") {
    const { rank, score, sol, gems } = n.data;
    const prizes = [sol ? `+${units(sol, "devnet")} SOL` : "", gems ? `+${units(gems, "gems")} gems` : ""].filter(Boolean).join(" · ");
    return { tone: "win", title: `${ordinal(rank)} in the weekly race`, detail: `${prizes || "Podium finish"} · best score ${score.toLocaleString("en")}` };
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
  if (n.kind === "referral_joined") {
    return {
      tone: "tip",
      title: `${n.data.name} joined with your code`,
      detail: n.data.level >= 2 ? "They play at a reduced house fee for a week, and their matches pay you a share." : "They play at a reduced house fee for their first 24 hours.",
    };
  }
  if (n.kind === "referral_partner") {
    return n.data.level >= 2
      ? { tone: "win", title: "You are a Bounce partner", detail: "Players who sign up with your code get a week of reduced fees, and you earn a share of the house fee on every match they play." }
      : { tone: "security", title: "Your partnership ended", detail: "Your code still gives new players their first day at a reduced fee." };
  }
  if (n.kind === "friend_request") {
    return { tone: "tip", title: `${n.data.name} wants to be friends`, detail: "Answer from your friends page to play and talk." };
  }
  if (n.kind === "friend_accepted") {
    return { tone: "win", title: `${n.data.name} accepted your request`, detail: "Challenge them to a game, or say hello." };
  }
  if (n.kind === "challenge") {
    const { from, asset, stake } = n.data;
    return { tone: "tournament", title: `${from} challenged you`, detail: `${units(stake, asset)} ${CURRENCY[asset]} · same board, head to head` };
  }
  const { result, opponent, net, asset, stake, score, opponentScore } = n.data;
  const vs = opponent ?? "your opponent";
  if (result === "cancelled") {
    return {
      tone: "draw",
      title: opponent ? `Your match vs ${vs} was cancelled` : "Your match was cancelled",
      detail: `Entry refunded · +${units(stake, asset)} ${CURRENCY[asset]}${n.data.reason ? ` · ${n.data.reason}` : ""}`,
    };
  }
  const scores = `${score.toLocaleString("en")} – ${opponentScore.toLocaleString("en")}`;
  const bonus = n.data.bonusGems ? ` · +${n.data.bonusGems} gems` : "";
  if (result === "win" && n.data.disqualified) return { tone: "win", title: `You won: ${vs} was disqualified`, detail: `Automated play was detected on their side · +${units(net, asset)} ${CURRENCY[asset]}${bonus}` };
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
    if (n.kind === "challenge") router.push(`/?join=${encodeURIComponent(n.data.invite)}`);
    else if (n.kind === "match_result") onOpenMatch(n.data.matchId);
    else if (n.kind === "tournament_result") router.push(`/tournaments/${n.data.tournamentId}`);
    else if (n.kind === "race_result") router.push("/leaderboard?board=race");
    else if (n.kind === "friend_request" || n.kind === "friend_accepted") router.push("/friends");
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
            <PushControl />
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
