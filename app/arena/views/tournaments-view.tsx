"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, Check, Clock3, Medal, Play, Target, Trophy, Users } from "lucide-react";
import type { TournamentSummary } from "@/lib/api-types";
import { request } from "../api";
import { amount } from "../format";
import type { PlayerState } from "../arena";
import { entryLabel, headlinePot, PAYOUT_LABELS, STATUS_LABELS, timing } from "../tournament-format";
import styles from "./tournaments.module.css";
import lobby from "./tournament-lobby.module.css";

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

function tournamentAction(t: TournamentSummary) {
  const you = t.you;
  if (you?.rank) return { label: you.rank === 1 ? "Winner" : `Rank ${you.rank}`, icon: <ArrowRight size={14} /> };
  if (t.status === "live" && you && !you.done) {
    return { label: you.started ? "Resume your run" : "Play now", icon: <Play size={14} /> };
  }
  if (t.status === "registration") {
    return you
      ? { label: "Registered", icon: <Check size={14} /> }
      : { label: t.entrants >= t.places ? "Full" : "Register", icon: <ArrowRight size={14} /> };
  }
  return { label: t.status === "settled" ? "Results" : "Standings", icon: <ArrowRight size={14} /> };
}

export function TournamentCard({ t, now }: { t: TournamentSummary; now: number }) {
  const you = t.you;
  const action = tournamentAction(t);
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
          {action.label} {action.icon}
        </span>
      </div>
    </Link>
  );
}

function FeaturedTournament({ t, now }: { t: TournamentSummary; now: number }) {
  const action = tournamentAction(t);
  const spots = Math.max(0, t.places - t.entrants);
  return (
    <Link href={`/tournaments/${t.id}`} className={lobby.featured}>
      <div className={lobby.featuredTop}>
        <span className={lobby.eventStatus}><span className={t.status === "live" ? lobby.liveDot : lobby.statusDot} />{t.status === "registration" ? "NEXT UP" : "IN PROGRESS"}<span className={lobby.statusDetail}>{STATUS_LABELS[t.status]}</span></span>
        <span className={t.asset === "devnet" ? lobby.sol : lobby.gems}>{t.asset === "devnet" ? "DEVNET SOL" : "GEMS"}</span>
      </div>
      <h2>{t.name}</h2>
      <div className={lobby.eventTiming}><Clock3 size={15} />{timing(t, now)}</div>
      <div className={lobby.featuredBody}>
        <div className={lobby.prize}>
          <small>{t.status === "registration" && t.entryFee ? "PRIZE POOL WHEN FULL" : "PRIZE POOL"}</small>
          <strong>{amount(headlinePot(t), t.asset)}</strong>
          <span><Trophy size={14} />{PAYOUT_LABELS[t.payout]}</span>
        </div>
        <dl className={lobby.eventFacts}>
          <div><dt>Entry</dt><dd>{entryLabel(t)}</dd></div>
          <div><dt>Format</dt><dd>One run</dd></div>
          <div><dt>Players</dt><dd>{t.entrants}<span> / {t.places}</span></dd></div>
        </dl>
      </div>
      <div className={lobby.featuredFoot}>
        <div className={lobby.capacity}>
          <div><Users size={14} /><span>{t.status === "registration" ? spots ? `${spots} ${spots === 1 ? "spot" : "spots"} available` : "All spots filled" : `${t.entrants} ${t.entrants === 1 ? "player" : "players"} in the field`}</span>{t.you && <b><Check size={12} />You’re in</b>}</div>
          <div className={lobby.capacityBar} aria-hidden="true"><span style={{ width: `${Math.min(100, t.entrants / t.places * 100)}%` }} /></div>
        </div>
        <span className={lobby.eventAction}>{t.status === "registration" && !t.you && spots ? "View tournament" : action.label}<ArrowUpRight size={18} /></span>
      </div>
    </Link>
  );
}

type TournamentFilter = "all" | "registration" | "live" | "finished" | "mine";

export function TournamentsView({ player }: { player: PlayerState }) {
  const { tournaments, error, now } = useTournaments();
  const [filter, setFilter] = useState<TournamentFilter>("all");
  const live = tournaments?.filter((t) => t.status === "live" || t.status === "closing") ?? [];
  const upcoming = tournaments?.filter((t) => t.status === "registration") ?? [];
  const finished = tournaments?.filter((t) => t.status === "settled" || t.status === "cancelled") ?? [];
  const mine = tournaments?.filter((t) => t.you) ?? [];
  const filters: { id: TournamentFilter; label: string; items: TournamentSummary[] }[] = [
    { id: "all", label: "All events", items: tournaments ?? [] },
    { id: "registration", label: "Registration open", items: upcoming },
    { id: "live", label: "Live now", items: live },
    { id: "finished", label: "Past results", items: finished },
    { id: "mine", label: "My tournaments", items: mine },
  ];
  const visible = filters.find((f) => f.id === filter)!.items;
  const featured = visible.filter((t) => t.status === "live" || t.status === "registration" || t.status === "closing")
    .sort((a, b) => Number(b.status === "live") - Number(a.status === "live") || a.startsAt - b.startsAt)[0];
  const otherEvents = visible.filter((t) => t.id !== featured?.id);
  const emptyCopy = {
    all: ["The next challenge is on its way", "New tournaments will appear here. In the meantime, keep your angles sharp in the arena."],
    registration: ["No open registrations right now", "Check back for your next chance to join the field."],
    live: ["A moment between rounds", "No tournament is running right now. Explore upcoming events to find your next challenge."],
    finished: ["The podium is waiting", "Completed tournaments and their final standings will appear here."],
    mine: [player.data.player ? "Your next challenge starts here" : "Keep your tournaments in view", player.data.player ? "Enter a tournament to follow your registration, run and result here." : "Sign in to see the tournaments you’ve entered."],
  }[filter];
  return (
    <section className={lobby.page}>
      <header className={lobby.hero}>
        <div>
          <div className={lobby.eyebrow}><Medal size={15} /> THE TOURNAMENT ARENA</div>
          <h1>One run.<br /><span>Make it count.</span></h1>
          <p>Same board. The whole field. Your shot at the top.<br />Compete for the prize pool, one bounce at a time.</p>
        </div>
        <div className={lobby.heroArt} aria-hidden="true">
          <div className={lobby.orbit} />
          <div className={lobby.podium}>
            <span>2</span>
            <span><Trophy className={lobby.trophy} strokeWidth={1.3} />1</span>
            <span>3</span>
          </div>
          <span className={lobby.artCaption}>ONE BOARD. THE WHOLE FIELD.</span>
        </div>
      </header>
      {error && (
        <div className="error" role="alert" style={{ marginTop: 20 }}>
          <span>{error}</span>
        </div>
      )}
      {!player.data.player && player.loaded && (
        <p className={lobby.signIn}>
          <Link className="lime" href={player.data.authenticated ? "/signup" : "/login"}>
            Sign in
          </Link>{" "}
          to register for tournaments.
        </p>
      )}
      <div className={lobby.filters} role="group" aria-label="Filter tournaments">
        {filters.map((f) => (
          <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
            {f.label}<span>{tournaments ? f.items.length : "–"}</span>
          </button>
        ))}
      </div>
      <div className={lobby.content}>
        <div className={lobby.events}>
          {!tournaments ? (
            <div className={lobby.empty} role="status">
              <Trophy size={32} />
              <h2>{error ? "The schedule couldn’t load" : "Finding your next challenge…"}</h2>
              <p>{error ? "We’ll try again automatically in a moment." : "Checking open registrations and live events."}</p>
            </div>
          ) : !visible.length ? (
            <div className={lobby.empty}>
              <Trophy size={32} />
              <h2>{emptyCopy[0]}</h2>
              <p>{emptyCopy[1]}</p>
              {filter === "mine" && !player.data.player ? (
                <Link href={player.data.authenticated ? "/signup" : "/login"}>Sign in <ArrowRight size={15} /></Link>
              ) : filter !== "all" ? (
                <button type="button" onClick={() => setFilter("all")}>Explore all events <ArrowRight size={15} /></button>
              ) : (
                <Link href="/">Head to the arena <ArrowRight size={15} /></Link>
              )}
            </div>
          ) : (
            <>
              {featured && <FeaturedTournament t={featured} now={now} />}
              {!!otherEvents.length && (
                <div className={lobby.eventGrid}>
                  {otherEvents.map((t) => <TournamentCard key={t.id} t={t} now={now} />)}
                </div>
              )}
            </>
          )}
        </div>
        <aside className={lobby.guide}>
          <div className={lobby.guideTitle}><Target size={18} /><h2>Your shot at the top</h2></div>
          <ol>
            <li><span>01</span><div><h3>Join the field</h3><p>Pick your tournament and register before it starts.</p></div></li>
            <li><span>02</span><div><h3>Make your run count</h3><p>Everyone gets the same board. Play your one run before the deadline.</p></div></li>
            <li><span>03</span><div><h3>Climb the standings</h3><p>The highest scores take the prizes. Check each event for its payout split.</p></div></li>
          </ol>
          <Link href="/rules">Know the game <ArrowUpRight size={15} /></Link>
          <p className={lobby.testNote}>Gems and devnet SOL are test funds with no monetary value.</p>
        </aside>
      </div>
    </section>
  );
}
