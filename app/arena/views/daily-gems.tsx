"use client";
import { useEffect, useState } from "react";
import { Gem, Check } from "lucide-react";
import type { DailyGems } from "@/lib/api-types";
import { request } from "../api";
import { units } from "../format";
import type { PlayerState } from "../arena";
import styles from "./daily-gems.module.css";

/** How long until the next claim, in words. */
function opensIn(nextAt: number, now: number) {
  const minutes = Math.max(0, Math.round((nextAt - now) / 60_000));
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `in ${hours} h ${minutes % 60} min` : `in ${hours} h`;
}

/**
 * The free gems of the day, on the lobby. A player out of gems always has an
 * entry waiting for them tomorrow, and days in a row are worth more.
 */
export function DailyGemsCard({ player }: { player: PlayerState }) {
  const { data, refresh } = player;
  const daily = data.daily;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [claimed, setClaimed] = useState<DailyGems | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  if (!data.player || !daily) return null;
  const state = claimed ?? daily;
  const claim = async () => {
    setBusy(true);
    setError("");
    try {
      setClaimed(await request<DailyGems>("/api/daily", { action: "claim" }));
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`${styles.card} ${state.ready ? styles.ready : ""}`} aria-labelledby="daily-gems">
      <span className={styles.icon} aria-hidden>
        {state.ready ? <Gem size={20} /> : <Check size={20} />}
      </span>
      <div className={styles.copy}>
        <h2 id="daily-gems">{state.ready ? "Your daily gems are waiting" : `${units(state.amount, "gems")} gems claimed today`}</h2>
        <p>
          {state.ready
            ? state.streak > 1
              ? `Day ${state.streak} in a row. Miss a day and the run starts again.`
              : "Free gems every day, and more for every day in a row."
            : `Day ${state.streak} in a row · next claim ${opensIn(state.nextAt, now)}.`}
        </p>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </div>
      <div className={styles.action}>
        {state.ready ? (
          <button className="btn btn-primary" disabled={busy} onClick={() => void claim()}>
            {busy ? "Claiming…" : `Claim ${units(state.amount, "gems")} gems`}
          </button>
        ) : (
          <span className={styles.streak}>
            <b>{state.streak}</b>
            <small>{state.streak === 1 ? "day" : "days"} in a row</small>
          </span>
        )}
      </div>
    </section>
  );
}
