"use client";
import { Tooltip } from "@/components/ui/tooltip";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, Eye, Lock, Medal, Radio, RefreshCw, RotateCcw, Swords, Target } from "lucide-react";
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

function LiveCard({ game, now, featured = false }: { game: LiveGame; now: number; featured?: boolean }) {
  const context = game.kind === "tournament" ? game.context : game.context ? `vs ${game.context}` : "Open seat";
  const body = (
    <>
      <div className={styles.cardTop}>
        <span className={styles.runBadge}>
          {game.locked ? <Lock size={12} /> : <Radio size={12} />}
          {game.locked ? "BOARD LOCKED" : featured ? "IN THE SPOTLIGHT" : "LIVE RUN"}
        </span>
        <span className={styles.age}>Active {timeAgo(game.at, now)}</span>
      </div>
      <div className={styles.cardHead}>
        <Avatar name={game.name} src={game.avatar} size={featured ? 54 : 40} />
        <span className={styles.who}>
          <b>
            {game.name}
            {game.isYou && <small className={styles.you}>YOU</small>}
          </b>
          <small>{context}</small>
        </span>
        <Tooltip content={game.kind === "tournament" ? "Tournament run" : "1v1 match"}><span className={styles.kind}>
          {game.kind === "tournament" ? <Medal size={15} /> : <Swords size={15} />}
        </span></Tooltip>
      </div>
      <div className={styles.gameStats}>
        <div className={styles.score}>
          <small>CURRENT SCORE</small>
          <strong>{game.score === null ? <i>Hidden</i> : game.score.toLocaleString("en")}</strong>
        </div>
        <div className={styles.round}>
          <small>ROUND</small>
          <strong>{String(game.round).padStart(2, "0")}</strong>
        </div>
        {featured && <Radio className={styles.scoreArt} aria-hidden="true" strokeWidth={.8} />}
      </div>
      <div className={styles.cardFoot}>
        <span className={styles.entry}>{game.kind === "tournament" ? "Tournament" : "1v1 match"}<small>{game.stake ? `${amount(game.stake, game.asset)} entry` : "Free entry"}</small></span>
        <span className={styles.action}>
          {game.locked ? (
            <>
              <Lock size={14} /> Locked
            </>
          ) : (
            <>
              <Eye size={15} /> Watch run <ArrowUpRight size={15} />
            </>
          )}
        </span>
      </div>
    </>
  );
  return (
    <article className={`${styles.card} ${featured ? styles.featured : ""} ${game.isYou ? styles.mine : ""} ${game.locked ? styles.locked : ""}`}>
      {game.locked ? (
        <Tooltip content={LOCKED[game.locked]}><div className={styles.cardInner}>
          {body}
        </div></Tooltip>
      ) : (
        <Link href={`/watch/${game.watchId}`} className={styles.cardInner}>
          {body}
        </Link>
      )}
      {game.locked && <p className={styles.note}>{LOCKED[game.locked]}</p>}
    </article>
  );
}

/** Every run being played right now, with a way into the ones you may watch. */
export function LiveView() {
  const [games, setGames] = useState<LiveGame[] | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [reload, setReload] = useState(0);
  const [filter, setFilter] = useState<"all" | "watchable" | "match" | "tournament">("all");

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
  const matches = games?.filter((g) => g.kind === "match").length ?? 0;
  const tournaments = games?.filter((g) => g.kind === "tournament").length ?? 0;
  const filters = [
    { id: "all", label: "All runs", count: games?.length ?? 0 },
    { id: "watchable", label: "Ready to watch", count: watchable },
    { id: "match", label: "1v1 matches", count: matches },
    { id: "tournament", label: "Tournaments", count: tournaments },
  ] as const;
  const visible = games?.filter((g) => filter === "all" || (filter === "watchable" ? !g.locked : g.kind === filter)) ?? [];
  const featured = visible.find((g) => !g.locked);
  const otherGames = visible.filter((g) => g.watchId !== featured?.watchId);
  const refresh = () => {
    setRefreshing(true);
    setReload((n) => n + 1);
  };
  return (
    <section className={styles.page}>
      <header className={styles.hero}>
        <div>
          <div className={styles.eyebrow}>
            <span />
            THE SPECTATOR LOUNGE
          </div>
          <h1>
            Every shot.
            <br />
            <span>Front-row seat.</span>
          </h1>
          <p>Find a player. Follow their angles. Catch the next great run.<br />The best seat in the arena is yours.</p>
          <Link href="/" className={styles.heroLink}>Rather be the show? Take your shot <ArrowUpRight size={15} /></Link>
        </div>
        <div className={styles.heroArt} aria-hidden="true">
          <div className={styles.broadcastRing} />
          <div className={styles.screen}>
            <div className={styles.screenTop}><span />SPECTATOR VIEW<Radio size={14} /></div>
            <div className={styles.viewfinder}><Eye size={74} strokeWidth={1.2} /></div>
            <div className={styles.screenFoot}><span>SHOT BY SHOT</span><span className={styles.signal}><i /><i /><i /><i /></span></div>
          </div>
          <span className={styles.artCaption}>FOLLOW EVERY BOUNCE</span>
        </div>
      </header>

      <div className={styles.activity}>
        <div><Radio size={19} /><span><b>{games?.length ?? "–"}</b><small>Runs on the board</small></span></div>
        <div><Eye size={19} /><span><b>{games ? watchable : "–"}</b><small>Ready to watch</small></span></div>
        <div><Medal size={19} /><span><b>{games ? tournaments : "–"}</b><small>Tournament runs</small></span></div>
        <button className={styles.refresh} aria-label="Refresh live games" disabled={refreshing} onClick={refresh}>
          <RefreshCw size={16} className={refreshing ? styles.spinning : undefined} />
          <span>{refreshing ? "Refreshing…" : "Refresh"}</span>
        </button>
      </div>

      {error && <div className={styles.error} role="alert"><span>{games ? "Could not refresh. Showing the last games." : error}</span></div>}

      <div className={styles.filters} role="group" aria-label="Filter live runs">
        {filters.map((f) => (
          <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>{f.label}<span>{games ? f.count : "–"}</span></button>
        ))}
        <span className={styles.updateNote}>Updates every {REFRESH_MS / 1000}s</span>
      </div>

      <div className={styles.stage}>
        <div className={styles.main}>
          {!games && error ? (
            <div className={styles.empty}>
              <Radio size={32} /><h2>The live board couldn’t load</h2>
              <p>Try refreshing to reconnect to the arena.</p>
              <button className="btn btn-primary" onClick={refresh} disabled={refreshing}><RefreshCw size={15} />{refreshing ? "Reconnecting…" : "Try again"}</button>
            </div>
          ) : !games ? (
            <div className={styles.loading} role="status"><span>Finding live runs…</span><div /><div /></div>
          ) : featured ? (
            <LiveCard game={featured} now={now} featured />
          ) : visible.length ? (
            <div className={styles.waiting}>
              <Lock size={28} /><h2>These boards aren’t open yet</h2>
              <p>Some runs become watchable once an opponent joins, or after you finish your own tournament run. You’ll find the details below.</p>
            </div>
          ) : (
            <div className={styles.empty}>
              <span className={styles.emptyIcon}><Radio size={28} /></span>
              <small>{games.length ? "NOTHING IN THIS VIEW" : "A MOMENT BETWEEN BOUNCES"}</small>
              <h2>{games.length ? "No matching runs right now" : "The next great run could be yours."}</h2>
              <p>{games.length ? "Try another filter to see what’s happening across the arena." : "The arena is quiet for now. Start a match, find your angle, and give the crowd something to watch."}</p>
              {games.length ? (
                <button className="btn btn-primary" onClick={() => setFilter("all")}>See all runs <ArrowRight size={16} /></button>
              ) : (
                <Link href="/" className="btn btn-primary">Enter the arena <ArrowUpRight size={16} /></Link>
              )}
            </div>
          )}
        </div>
        <aside className={styles.guide}>
          <div className={styles.guideHeading}><Eye size={18} /><h2>More than the final score</h2></div>
          <div className={styles.guideItem}><Target size={17} /><div><h3>See the angle</h3><p>Watch the aim, the shot, and every bounce as the run unfolds.</p></div></div>
          <div className={styles.guideItem}><RotateCcw size={17} /><div><h3>Catch what you missed</h3><p>Replay from the start, change the speed, then jump back to live.</p></div></div>
          <Link href="/tournaments" className={styles.tournamentLink}><Medal size={18} /><span>Follow the competition<small>Explore tournaments</small></span><ArrowUpRight size={17} /></Link>
        </aside>
      </div>

      {!!otherGames.length && (
        <section className={styles.more}>
          <h2>{featured ? "More from the arena" : "Waiting to open"}<span>{otherGames.length}</span></h2>
          <div className={styles.grid}>{otherGames.map((g) => <LiveCard key={g.watchId} game={g} now={now} />)}</div>
        </section>
      )}
    </section>
  );
}
