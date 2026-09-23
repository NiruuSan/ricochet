"use client";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { Currency } from "@/lib/price";

// Amounts in money people think in.
//
// Every figure on the site stays in SOL, because that is what is wagered, won
// and paid. This only adds a second reading beside it — "≈ €41" — for players
// who do not hold a feel for what a SOL is worth. The rate comes from the
// server (lib/price.ts), which is the only thing allowed to talk to a price
// source, and is refreshed while the tab is open so the figure stays true.

const KEY = "bounce.fiat";
export type FiatChoice = "off" | Currency;
const CHOICES: FiatChoice[] = ["off", "usd", "eur"];
export const CURRENCY_LABEL: Record<FiatChoice, string> = { off: "SOL only", usd: "US dollars", eur: "Euros" };
const SYMBOL: Record<Currency, string> = { usd: "$", eur: "€" };

let choice: FiatChoice | null = null;
const listeners = new Set<() => void>();

function load(): FiatChoice {
  if (choice) return choice;
  try {
    const stored = localStorage.getItem(KEY) as FiatChoice | null;
    choice = stored && CHOICES.includes(stored) ? stored : "off";
  } catch {
    choice = "off";
  }
  return choice;
}

export function setFiat(next: FiatChoice) {
  choice = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // Not remembering it is better than losing the click.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** The player's choice, shared by every component on the page. */
export const useFiatChoice = () =>
  useSyncExternalStore(
    subscribe,
    load,
    () => "off" as FiatChoice,
  );

type Rate = { usd: number | null; eur: number | null; at: number | null };
let rate: Rate | null = null;
const rateListeners = new Set<() => void>();
/** The server caches the lookup; this is only how often a tab asks for it. */
const REFRESH = 10 * 60_000;

async function pull() {
  try {
    const next = (await (await fetch("/api/price", { cache: "no-store" })).json()) as Rate;
    rate = next;
    for (const listener of rateListeners) listener();
  } catch {
    // A missing rate simply means no second reading is shown.
  }
}

/**
 * The rate, fetched once per tab and kept fresh. Nothing is requested at all
 * while the player has chosen SOL only.
 */
export function useSolRate(enabled: boolean) {
  const [, bump] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const listener = () => bump((n) => n + 1);
    rateListeners.add(listener);
    if (!rate) void pull();
    const timer = setInterval(() => void pull(), REFRESH);
    return () => {
      rateListeners.delete(listener);
      clearInterval(timer);
    };
  }, [enabled]);
  return rate;
}

/** Formats lamports in the chosen currency, or null when there is nothing to show. */
export function useFiat() {
  const chosen = useFiatChoice();
  const current = useSolRate(chosen !== "off");
  return useCallback(
    (lamports: number) => {
      if (chosen === "off" || !current) return null;
      const price = chosen === "usd" ? current.usd : current.eur;
      if (!price || !Number.isFinite(lamports)) return null;
      const value = (lamports / 1_000_000_000) * price;
      const decimals = Math.abs(value) >= 100 ? 0 : Math.abs(value) >= 1 ? 2 : 4;
      return `${SYMBOL[chosen]}${value.toLocaleString("en", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
    },
    [chosen, current],
  );
}

/** "≈ €41" beside an amount, or nothing at all. */
export function Fiat({ lamports, className = "" }: { lamports: number; className?: string }) {
  const format = useFiat();
  const shown = format(lamports);
  if (!shown) return null;
  return (
    <span className={`fiat ${className}`} title="Live rate for mainnet SOL. Play here is on devnet and has no monetary value.">
      ≈ {shown}
    </span>
  );
}

/** The setting itself: three buttons, remembered in this browser. */
export function FiatPicker() {
  const chosen = useFiatChoice();
  return (
    <div className="fiat-picker" role="group" aria-label="Show amounts in">
      {CHOICES.map((option) => (
        <button key={option} aria-pressed={chosen === option} onClick={() => setFiat(option)}>
          {option === "off" ? "SOL" : option.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
