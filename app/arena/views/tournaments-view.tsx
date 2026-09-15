"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Medal, Play } from "lucide-react";
import type { TournamentSummary } from "@/lib/api-types";
import { request } from "../api";
import { amount } from "../format";
import type { PlayerState } from "../arena";
import { entryLabel, headlinePot, PAYOUT_LABELS, STATUS_LABELS, timing } from "../tournament-format";
import styles from "./tournaments.module.css";

const REFRESH_MS = 15_000;

/** Tournaments, refreshed while the page is open, with a clock for countdowns. */
export function useTournaments() {
  const [tournaments, setTournaments] = useState<TournamentSummary[] | null>(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let active = true;
    const load = () =>
      request<TournamentSummary[]>("/api/tournaments").then(
        (next) => active && (setTournaments(next), setError("")),
        (e: Error) => active && setError(e.message),
      );
    void load();
    const poll = setInterval(() => !document.hidden && void load(), REFRESH_MS);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      active = false;
      clearInterval(poll);
      clearInterval(clock);
    };
  }, []);
  return { tournaments, error, now };
}

export function TournamentCard({ t, now }: { t: TournamentSummary; now: number }) {
  const you = t.you;
  const action =
    t.status === "live" && you && !you.done
      ? { label: you.started ? "Resume your run" : "Play now", icon: <Play size={14} /> }
      : t.status === "registration" && you
        ? { label: "Registered", icon: <Check size={14} /> }
        : t.status === "registration"
          ? { label: t.entrants >= t.places ? "Full" : "Register", icon: <ArrowRight size={14} /> }
          : { label: t.status === "settled" ? "Results" : "Standings", icon: <ArrowRight size={14} /> };
  return (
    <Link href={`/tournaments/${t.id}`} className={styles.card}>
      <div className={styles.cardTop}>
        <span className={`${styles.chip} ${t.status === "live" ? styles.chipLive : ""}`}>{STATUS_LABELS[t.status].toUpperCase()}</span>
        <span className={`${styles.chip} ${t.asset === "devnet" ? styles.chipSol : styles.chipGems}`}>{t.asset === "devnet" ? "DEVNET SOL" : "GEMS"}</span>
      </div>
      <div className={styles.cardName}>{t.name}</div>
      <div className={styles.pot}>
        <small>{t.status === "registration" && t.entryFee ? "PRIZE POOL WHEN FULL" : "PRIZE POOL"}</small>
        <strong>{amount(headlinePot(t), t.asset)}</strong>
      </div>
      <div className={styles.cardFacts}>
        <span>
          Entry <b>{entryLabel(t)}</b>
        </span>
        <span>{PAYOUT_LABELS[t.payout]}</span>
        <span>
          <b>
            {t.entrants}/{t.places}
          </b>{" "}
          players
        </span>
      </div>
      <div className={styles.bar} aria-hidden>
        <span style={{ width: `${Math.min(100, (t.entrants / t.places) * 100)}%` }} />
      </div>
      <div className={styles.cardFoot}>
        <span>{timing(t, now)}</span>
        <span className={t.status === "live" && you && !you.done ? "lime" : ""} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 700 }}>
          {you?.rank ? `${you.rank === 1 ? "Winner" : `Rank ${you.rank}`}` : action.label} {action.icon}
        </span>
      </div>
    </Link>
  );
}

export function TournamentsView({ player }: { player: PlayerState }) {
  const { tournaments, error, now } = useTournaments();
  const live = tournaments?.filter((t) => t.status === "live" || t.status === "closing") ?? [];
  const upcoming = tournaments?.filter((t) => t.status === "registration") ?? [];
  const finished = tournaments?.filter((t) => t.status === "settled" || t.status === "cancelled") ?? [];
  const groups = [
    { title: "Live now", items: live, empty: "No tournament is running right now." },
    { title: "Open for registration", items: upcoming, empty: "No upcoming tournament yet. Check back soon." },
    { title: "Recently finished", items: finished, empty: "" },
  ];
  return (
    <section className={styles.page}>
      <div className={styles.head}>
        <div className="tag lime">TOURNAMENTS</div>
        <h1>One board. One run. The whole field.</h1>
        <p>Everyone plays the same seed once before the deadline. The best scores split the prize pool.</p>
      </div>
      {error && (
        <div className="error" role="alert" style={{ marginTop: 20 }}>
          <span>{error}</span>
        </div>
      )}
      {!player.data.player && player.loaded && (
        <p className="fine" style={{ marginTop: 16 }}>
          <Link className="lime" href={player.data.authenticated ? "/signup" : "/login"}>
            Sign in
          </Link>{" "}
          to register for tournaments.
        </p>
      )}
      {!tournaments && !error ? (
        <p className="muted" style={{ marginTop: 30 }}>
          Loading tournaments…
        </p>
      ) : (
        groups.map(
          (g) =>
            (g.items.length > 0 || g.empty) && (
              <div className={styles.section} key={g.title}>
                <h2>
                  <Medal size={18} className="lime" /> {g.title}
                </h2>
                {g.items.length ? (
                  <div className={styles.grid}>
                    {g.items.map((t) => (
                      <TournamentCard key={t.id} t={t} now={now} />
                    ))}
                  </div>
                ) : (
                  <p className={styles.empty}>{g.empty}</p>
                )}
              </div>
            ),
        )
      )}
    </section>
  );
}
