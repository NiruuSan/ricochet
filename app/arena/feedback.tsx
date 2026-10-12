"use client";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Check, CircleAlert, Gem, Info, X } from "lucide-react";
import type { Asset } from "@/lib/api-types";
import { SolanaMark } from "./solana-mark";
import { units } from "./format";
import { playSound } from "./sound";
import styles from "./feedback.module.css";

// What the site says back when the player does something. Nothing is written
// into the page: a confirmation is a toast that slides in and leaves on its own,
// and money that arrives flies from the button that earned it into the balance
// in the top bar, which counts up as it lands.
//
// Any component calls `toast()` or `reward()`; one <FeedbackHost /> in the shell
// draws them. The store is a plain module, like the money display, so nothing
// has to be threaded through props.

export type Tone = "ok" | "info" | "error";
type Toast = { id: number; title: string; detail?: string; tone: Tone };
type Point = { x: number; y: number };
type Flight = { id: number; asset: Asset; amount: number; from: Point; to: Point };

const TOAST_MS = { ok: 3200, info: 4200, error: 6000 };
const MAX_TOASTS = 3;
/** Particles leave over this window, then each takes FLY_MS to arrive. */
const STAGGER_MS = 260;
const FLY_MS = 780;

let toasts: Toast[] = [];
let flights: Flight[] = [];
let seq = 0;
/** When the last particle lands in each balance, so the counter can wait for it. */
const arrivals: Record<Asset, number> = { gems: 0, devnet: 0 };
const listeners = new Set<() => void>();
let snapshot = { toasts, flights, arrivals: { ...arrivals } };
function emit() {
  snapshot = { toasts, flights, arrivals: { ...arrivals } };
  for (const listener of listeners) listener();
}
const subscribe = (listener: () => void) => (listeners.add(listener), () => void listeners.delete(listener));
const EMPTY = { toasts: [] as Toast[], flights: [] as Flight[], arrivals: { gems: 0, devnet: 0 } };
const useFeedback = () => useSyncExternalStore(subscribe, () => snapshot, () => EMPTY);

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** A confirmation, in a toast. The page itself never changes to say it. */
export function toast(title: string, { detail, tone = "ok" }: { detail?: string; tone?: Tone } = {}) {
  const id = ++seq;
  toasts = [...toasts.filter((t) => t.title !== title || t.detail !== detail), { id, title, detail, tone }].slice(-MAX_TOASTS);
  emit();
  setTimeout(() => dismiss(id), TOAST_MS[tone]);
}
export function dismiss(id: number) {
  if (!toasts.some((t) => t.id === id)) return;
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

const center = (el: Element) => {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};
/** Drawn at all: a balance hidden at this width (display: none) has no box. */
const rendered = (el: Element | null): el is Element => {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
};
const visible = (el: Element | null): el is Element => rendered(el) && el.getBoundingClientRect().bottom > 0 && el.getBoundingClientRect().top < window.innerHeight;

/**
 * Money arriving. Gems (or SOL) burst out of `from` — the button that earned
 * them — and fly into that balance in the top bar. Where there is no balance on
 * screen to fly to, or the player asked for less motion, it says so in a toast.
 */
export function reward(asset: Asset, amount: number, from?: Element | null, label?: string) {
  if (!(amount > 0)) return;
  const target = [document.querySelector(`[data-balance="${asset}"]`), document.querySelector("[data-balance-fallback]")].find(rendered);
  const what = asset === "gems" ? `+${units(amount, "gems")} gems` : `+${units(amount, "devnet")} SOL`;
  if (!target || reducedMotion()) {
    toast(what, { detail: label });
    return;
  }
  const source = from && visible(from) ? center(from) : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  const id = ++seq;
  // Scrolled past the top bar, the gems still head for it: up to the edge of the
  // screen, right where the balance is waiting above.
  const goal = center(target);
  const to = { x: goal.x, y: Math.min(window.innerHeight - 12, Math.max(-24, goal.y)) };
  flights = [...flights, { id, asset, amount, from: source, to }];
  arrivals[asset] = Date.now() + STAGGER_MS + FLY_MS;
  emit();
  setTimeout(() => playSound("coin", 6), FLY_MS);
  setTimeout(() => {
    flights = flights.filter((f) => f.id !== id);
    emit();
  }, STAGGER_MS + FLY_MS + 900);
}

/** True for a moment after money lands in this balance: the pill pulses. */
export function useArrival(asset: Asset) {
  const { arrivals: at } = useFeedback();
  const [now, setNow] = useState(0);
  const until = at[asset] + 520;
  useEffect(() => {
    if (!at[asset]) return;
    const wait = at[asset] - Date.now();
    const timers = [setTimeout(() => setNow(Date.now()), Math.max(0, wait)), setTimeout(() => setNow(Date.now()), Math.max(0, wait) + 540)];
    return () => timers.forEach(clearTimeout);
  }, [at, asset]);
  // Nothing has landed yet: 0 is not an arrival, or the pill would glow from the first paint.
  return at[asset] > 0 && now >= at[asset] && now < until;
}

/**
 * A balance that counts up to its new value instead of jumping, and waits for
 * the flying gems to land before it starts. Money going out is shown at once.
 */
export function RollingBalance({ asset, value, format }: { asset: Asset; value: number; format: (n: number) => ReactNode }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    from.current = value;
    if (value <= start || reducedMotion()) {
      setShown(value);
      return;
    }
    let frame = 0;
    const begin = performance.now() + Math.max(0, arrivals[asset] - Date.now());
    const tick = (now: number) => {
      const k = Math.min(1, Math.max(0, (now - begin) / 650));
      setShown(Math.round(start + (value - start) * (1 - (1 - k) ** 3)));
      if (k < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [asset, value]);
  return <>{format(shown)}</>;
}

const ICONS = { ok: <Check size={16} />, info: <Info size={16} />, error: <CircleAlert size={16} /> };

/** One flight: the particles, and the amount rising from where they left. */
function FlightView({ flight }: { flight: Flight }) {
  const parts = useRef<(HTMLSpanElement | null)[]>([]);
  const count = flight.asset === "gems" ? Math.min(14, 6 + Math.round(Math.log10(flight.amount + 1) * 2)) : 9;
  useEffect(() => {
    const { from, to } = flight;
    parts.current.forEach((el, i) => {
      if (!el) return;
      // Out first, in a little burst around the button, then a curve home.
      const angle = (i / count) * Math.PI * 2 + (i % 2 ? 0.4 : -0.2);
      const spread = 46 + ((i * 37) % 40);
      const burst = { x: from.x + Math.cos(angle) * spread, y: from.y + Math.sin(angle) * spread * 0.8 };
      const bend = { x: (burst.x + to.x) / 2 + (i % 2 ? 80 : -80), y: Math.min(burst.y, to.y) - 120 };
      const frames: Keyframe[] = [];
      for (let s = 0; s <= 16; s++) {
        const k = s / 16;
        let x: number, y: number, scale: number;
        if (k <= 0.22) {
          const u = 1 - (1 - k / 0.22) ** 2;
          x = from.x + (burst.x - from.x) * u;
          y = from.y + (burst.y - from.y) * u;
          scale = 0.4 + u * 0.9;
        } else {
          const u = (k - 0.22) / 0.78, e = u * u;
          x = (1 - e) ** 2 * burst.x + 2 * (1 - e) * e * bend.x + e * e * to.x;
          y = (1 - e) ** 2 * burst.y + 2 * (1 - e) * e * bend.y + e * e * to.y;
          scale = 1.3 - u * 0.75;
        }
        frames.push({ transform: `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${scale})`, opacity: k > 0.95 ? 0 : 1, offset: k });
      }
      el.animate(frames, { duration: FLY_MS + 160, delay: (i / count) * STAGGER_MS, easing: "linear", fill: "both" });
    });
  }, [flight, count]);
  const Icon = flight.asset === "gems" ? <Gem size={22} strokeWidth={2.2} /> : <SolanaMark size={20} />;
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} ref={(el) => void (parts.current[i] = el)} className={`${styles.particle} ${flight.asset === "gems" ? styles.gem : styles.sol}`}>
          {Icon}
        </span>
      ))}
      <span className={styles.amount} style={{ left: flight.from.x, top: flight.from.y }}>
        {Icon}+{units(flight.amount, flight.asset)}
      </span>
    </>
  );
}

/** Mounted once in the shell: the toasts, and anything in flight. */
export function FeedbackHost() {
  const { toasts: list, flights: inFlight } = useFeedback();
  return (
    <>
      <div className={styles.toasts} aria-live="polite">
        {list.map((t) => (
          <div key={t.id} className={`${styles.toast} ${styles[t.tone]}`} role={t.tone === "error" ? "alert" : "status"}>
            <span className={styles.mark}>{ICONS[t.tone]}</span>
            <span className={styles.copy}>
              <b>{t.title}</b>
              {t.detail && <small>{t.detail}</small>}
            </span>
            <button className={styles.close} aria-label="Dismiss" onClick={() => dismiss(t.id)}>
              <X size={14} />
            </button>
          </div>
        ))}
        {inFlight.map((f) => (
          <span key={f.id} className={styles.sr} role="status">
            {units(f.amount, f.asset)} {f.asset === "gems" ? "gems" : "SOL"} added to your balance.
          </span>
        ))}
      </div>
      <div className={styles.sky} aria-hidden>
        {inFlight.map((f) => (
          <FlightView key={f.id} flight={f} />
        ))}
      </div>
    </>
  );
}
