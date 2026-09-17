"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Eye, Lock, Medal, RefreshCw, Swords } from "lucide-react";
import type { LiveGame } from "@/lib/api-types";
import { request } from "../api";
import { Avatar } from "../avatar";
import { amount, timeAgo } from "../format";
import styles from "./live.module.css";

const REFRESH_MS = 15_000;

/** Why a run in progress cannot be opened yet. */
const LOCKED: Record<"seat" | "playing", string> = {
  seat: "Nobody has taken this seat yet. The board opens once someone does.",
  playing: "Finish your own run in this tournament to watch the others.",
};

function LiveCard({ game, now }: { game: LiveGame; now: number }) {
  const context = game.kind === "tournament" ? game.context : game.context ? `vs ${game.context}` : "Open seat";
  const body = (
    <>
      <div className={styles.cardHead}>
        <Avatar name={game.name} src={game.avatar} size={40} />
        <span className={styles.who}>
          <b>
            {game.name}
            {game.isYou && <small className={styles.you}>YOU</small>}
          </b>
          <small>
            {context} · {amount(game.stake, game.asset)}
          </small>
        </span>
        <span className={styles.kind} title={game.kind === "tournament" ? "Tournament run" : "1v1 match"}>
          {game.kind === "tournament" ? <Medal size={15} /> : <Swords size={15} />}
        </span>
      </div>
      <div className={styles.cardFoot}>
        <span className={styles.score}>
          {game.score === null ? <i>Score hidden</i> : game.score.toLocaleString("en")}
          <small>Round {game.round}</small>
        </span>
        <span className={styles.action}>
          {game.locked ? (
            <>
              <Lock size={14} /> Locked
            </>
          ) : (
            <>
              <Eye size={14} /> Watch
            </>
          )}
        </span>
      </div>
    </>
  );
  return (
    <div className={`${styles.card} ${game.isYou ? styles.mine : ""}`}>
      <span className={styles.age}>{timeAgo(game.at, now)}</span>
      {game.locked ? (
        <div className={styles.cardInner} title={LOCKED[game.locked]}>
          {body}
        </div>
      ) : (
        <Link href={`/watch/${game.watchId}`} className={styles.cardInner}>
          {body}
        </Link>
      )}
      {game.locked && <p className={styles.note}>{LOCKED[game.locked]}</p>}
    </div>
  );
}

/** Every run being played right now, with a way into the ones you may watch. */
export function LiveView() {
  const [games, setGames] = useState<LiveGame[] | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    const load = () =>
      request<LiveGame[]>("/api/watch").then(
        (rows) => {
          if (!active) return;
          setGames(rows);
          setError("");
          setNow(Date.now());
        },
        (e: Error) => active && setError(e.message),
      ).finally(() => active && setRefreshing(false));
    void load();
    const poll = setInterval(() => !document.hidden && void load(), REFRESH_MS);
    const clock = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      active = false;
      clearInterval(poll);
      clearInterval(clock);
    };
  }, [reload]);

  const watchable = games?.filter((g) => !g.locked).length ?? 0;
  return (
    <section className={styles.page}>
      <header className={styles.hero}>
        <div>
          <div className={styles.eyebrow}>
            <span />
            RIGHT NOW
          </div>
          <h1>
            Playing live.
            <br />
            <span>Pull up a chair.</span>
          </h1>
          <p>Every run in progress across the arena. Open one and follow it shot by shot, aim included.</p>
        </div>
        <Link href="/" className={`btn btn-primary ${styles.playButton}`}>
          Take your shot <ArrowUpRight />
        </Link>
      </header>

      <div className={styles.bar}>
        <h2>
          {games ? `${games.length} ${games.length === 1 ? "run" : "runs"} in progress` : "Loading live games…"}
          {!!games?.length && <span>{watchable} to watch</span>}
        </h2>
        <button className={styles.refresh} aria-label="Refresh live games" disabled={refreshing} onClick={() => { setRefreshing(true); setReload((n) => n + 1); }}>
          <RefreshCw size={16} className={refreshing ? styles.spinning : undefined} />
        </button>
      </div>

      {error && <div className={styles.error} role="alert"><span>{games ? "Could not refresh. Showing the last games." : error}</span></div>}

      {games?.length ? (
        <div className={styles.grid}>
          {games.map((g) => (
            <LiveCard key={g.watchId} game={g} now={now} />
          ))}
        </div>
      ) : games ? (
        <div className={styles.empty}>
          <Swords size={26} />
          <h3>Nobody is mid-run.</h3>
          <p>Runs show up here while they are played, and stay for a few minutes after the last shot. Start one and you might be the show.</p>
          <Link href="/" className="btn btn-primary">Play a match <ArrowUpRight /></Link>
        </div>
      ) : (
        <div className={styles.loading} role="status" aria-label="Loading live games">
          <div />
          <div />
          <div />
          <div />
        </div>
      )}

      <p className={styles.footnote}>Runs refresh every {REFRESH_MS / 1000} seconds. A match nobody has joined stays hidden until someone takes the seat, so the board cannot be studied first.</p>
    </section>
  );
}
