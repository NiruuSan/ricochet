"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Crown, Eye, History, Lock, Medal, Radio, Swords, Trophy, Users } from "lucide-react";
import type { ArenaOverview, LiveGame, RecentGame } from "@/lib/api-types";
import { request } from "../api";
import { Avatar } from "../avatar";
import { amount, CURRENCY, signedAmount } from "../format";
import { ordinal } from "../tournament-format";
import { TournamentCard } from "./tournaments-view";
import styles from "./arena-dashboard.module.css";

const REFRESH_MS = 20_000;

/** The arena lobby's live data, refreshed while the tab is visible. */
export function useArenaOverview() {
  const [overview, setOverview] = useState<ArenaOverview | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let active = true;
    const load = () =>
      request<ArenaOverview>("/api/arena").then(
        (next) => active && (setOverview(next), setNow(Date.now())),
        () => {},
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
  return { overview, now };
}

const OUTCOME_LABEL: Record<RecentGame["outcome"], string> = { win: "Won", loss: "Lost", draw: "Draw", cancelled: "Cancelled", waiting: "Waiting" };

function resultLabel(g: RecentGame) {
  if (g.kind === "tournament") {
    if (g.outcome === "waiting") return "Awaiting results";
    if (g.outcome === "cancelled") return "Cancelled";
    return g.rank ? `${ordinal(g.rank)} of ${g.players}` : "Finished";
  }
  if (g.outcome === "waiting") return g.title === "Open seat" ? "Seat open" : "Rival playing";
  return OUTCOME_LABEL[g.outcome];
}

function RecentRow({ g, onOpenMatch }: { g: RecentGame; onOpenMatch: (id: string) => void }) {
  const tone = g.outcome === "win" ? styles.win : g.outcome === "loss" ? styles.loss : "";
  const body = (
    <>
      {g.kind === "tournament" ? (
        <span className={styles.icon}>
          <Medal size={18} />
        </span>
      ) : g.title === "Open seat" ? (
        <span className={styles.icon}>
          <Swords size={18} />
        </span>
      ) : (
        <Avatar name={g.title} src={g.avatar} size={36} />
      )}
      <span className={styles.rowMain}>
        <b>{g.kind === "tournament" ? g.title : g.title === "Open seat" ? "Waiting for a rival" : `vs ${g.title}`}</b>
        <small>
          {g.score.toLocaleString("en")}
          {g.opponentScore !== null && ` – ${g.opponentScore.toLocaleString("en")}`} pts · {g.asset === "gems" ? "Gems" : "SOL"}
        </small>
      </span>
      <span className={styles.rowEnd}>
        <span className={`${styles.pill} ${tone}`}>{resultLabel(g)}</span>
        {g.net !== null && <small className={g.net > 0 ? "lime" : g.net < 0 ? styles.negative : ""}>{`${signedAmount(g.net, g.asset)} ${CURRENCY[g.asset]}`}</small>}
      </span>
    </>
  );
  return (
    <div className={styles.row}>
      {g.kind === "tournament" ? (
        <Link href={`/tournaments/${g.id}`} className={styles.rowLink}>
          {body}
        </Link>
      ) : (
        <button type="button" className={styles.rowLink} onClick={() => onOpenMatch(g.id)}>
          {body}
        </button>
      )}
      {g.watchId && (
        <Link href={`/watch/${g.watchId}`} className={styles.replay} aria-label="Replay this run" title="Replay">
          <Eye size={16} />
        </Link>
      )}
    </div>
  );
}

/** One run in progress. A run that cannot be watched yet is shown, but not opened. */
function LiveRow({ g }: { g: LiveGame }) {
  const body = (
    <>
      <Avatar name={g.name} src={g.avatar} size={26} />
      <span className={styles.rowMain}>
        <b>
          {g.name}
          {g.isYou && <small className={styles.youTag}>YOU</small>}
        </b>
        <small>{g.kind === "tournament" ? g.context : `${g.context ? `vs ${g.context}` : "Open seat"} · ${amount(g.stake, g.asset)}`}</small>
      </span>
      <span className={styles.liveScore}>
        {g.score === null ? <Lock size={14} className={styles.muted} /> : g.score.toLocaleString("en")}
        <small>R{g.round}</small>
      </span>
    </>
  );
  if (g.locked) return <div className={`${styles.live} ${styles.lockedRow}`} title={g.locked === "seat" ? "The board opens once someone takes the seat" : "Finish your own run in this tournament first"}>{body}</div>;
  return (
    <Link href={`/watch/${g.watchId}`} className={styles.live}>
      {body}
    </Link>
  );
}

type Props = {
  overview: ArenaOverview | null;
  now: number;
  signedIn: boolean;
  onOpenMatch: (id: string) => void;
};

/** Below the game modes: the tournament to watch, your last results, and the arena right now. */
export function ArenaDashboard({ overview, now, signedIn, onOpenMatch }: Props) {
  const seats = overview ? Object.values(overview.openSeats).reduce((sum, byStake) => sum + Object.values(byStake).reduce((a, b) => a + b, 0), 0) : 0;
  return (
    <div className={styles.dashboard}>
      <section className={styles.panel} aria-labelledby="arena-tournament">
        <header>
          <h2 id="arena-tournament">
            <Trophy size={17} /> {overview?.tournament?.status === "live" ? "Tournament live" : "Next tournament"}
          </h2>
          <Link href="/tournaments" className="lime">
            All <ArrowRight size={13} />
          </Link>
        </header>
        {overview?.tournament ? (
          <TournamentCard t={overview.tournament} now={now} />
        ) : (
          <div className={styles.empty}>
            <Medal size={26} />
            <p>{overview ? "No tournament scheduled yet. New ones show up here first." : "Loading…"}</p>
          </div>
        )}
      </section>

      <section className={styles.panel} aria-labelledby="arena-recent">
        <header>
          <h2 id="arena-recent">
            <History size={17} /> Your last games
          </h2>
          {signedIn && (
            <Link href="/profile" className="lime">
              History <ArrowRight size={13} />
            </Link>
          )}
        </header>
        {!signedIn ? (
          <div className={styles.empty}>
            <History size={26} />
            <p>
              <Link href="/login" className="lime">
                Sign in
              </Link>{" "}
              to keep track of your results.
            </p>
          </div>
        ) : overview?.recent.length ? (
          <div className={styles.rows}>
            {overview.recent.map((g) => (
              <RecentRow key={`${g.kind}:${g.id}`} g={g} onOpenMatch={onOpenMatch} />
            ))}
          </div>
        ) : (
          <div className={styles.empty}>
            <Swords size={26} />
            <p>{overview ? "No finished games yet. Your next result lands here." : "Loading…"}</p>
          </div>
        )}
      </section>

      <section className={styles.panel} aria-labelledby="arena-pulse">
        <header>
          <h2 id="arena-pulse">
            <Radio size={17} className={styles.pulseIcon} /> Arena pulse
          </h2>
          <Link href="/live">
            Live board <ArrowRight size={14} />
          </Link>
        </header>
        <div className={styles.box}>
          <div className={styles.counters}>
            <div>
              <Users size={16} />
              <b>{overview?.online ?? "–"}</b>
              <small>online</small>
            </div>
            <div>
              <Swords size={16} />
              <b>{overview ? seats : "–"}</b>
              <small>{seats === 1 ? "rival waiting" : "rivals waiting"}</small>
            </div>
          </div>
          {overview?.bestToday && (
            <Link href={`/watch/${overview.bestToday.watchId}`} className={styles.best}>
              <Crown size={16} className={styles.crown} />
              <Avatar name={overview.bestToday.name} src={overview.bestToday.avatar} size={30} />
              <span className={styles.rowMain}>
                <small>Best run today</small>
                <b>
                  {overview.bestToday.name} · {overview.bestToday.score.toLocaleString("en")} pts
                </b>
              </span>
              <Eye size={16} className={styles.muted} />
            </Link>
          )}
          <h3>Live now</h3>
          {overview?.live.length ? (
            <div className={styles.liveList}>
              {overview.live.map((g) => (
                <LiveRow key={g.watchId} g={g} />
              ))}
            </div>
          ) : (
            <p className={styles.quiet}>Nobody is mid-run right now. Start one and you might be the show.</p>
          )}
        </div>
      </section>
    </div>
  );
}
