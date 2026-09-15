"use client";
import Link from "next/link";
import { ArrowLeft, Eye, FastForward, Medal, Radio, RotateCcw, Swords } from "lucide-react";
import { H, W } from "@/lib/engine";
import { Avatar } from "../avatar";
import { amount } from "../format";
import { useSpectator } from "../use-spectator";
import styles from "./watch.module.css";

export function WatchView({ id }: { id: string }) {
  const { data, game, error, revision, flying, liveScore, replaying, speed, replay, goLive, toggleSpeed, attachCanvas } = useSpectator(id);

  if (!data || !game) {
    return (
      <section className={styles.page}>
        <Link href="/" className="lime">
          ← Arena
        </Link>
        <div className={styles.blocked}>
          <Eye size={28} />
          <p>{error || "Loading the game…"}</p>
        </div>
      </section>
    );
  }

  const live = !data.done;
  const caughtUp = !replaying && revision >= data.revision;
  const status = replaying
    ? "Replaying from the start"
    : flying
      ? "Shot in flight"
      : live
        ? "Waiting for the next shot…"
        : data.forfeit
          ? `Run ended early with ${data.score.toLocaleString("en")} points`
          : `Run finished with ${data.score.toLocaleString("en")} points`;

  return (
    <section className={styles.page}>
      {data.tournament ? (
        <Link href={`/tournaments/${data.tournament.id}`} className={`lime ${styles.back}`}>
          <ArrowLeft size={14} /> {data.tournament.name}
        </Link>
      ) : (
        <Link href="/" className={`lime ${styles.back}`}>
          <ArrowLeft size={14} /> Arena
        </Link>
      )}

      <div className={styles.head}>
        <span className={`${styles.badge} ${live && caughtUp ? styles.live : ""}`}>
          {live && caughtUp ? (
            <>
              <Radio size={13} /> LIVE
            </>
          ) : replaying ? (
            <>
              <RotateCcw size={13} /> REPLAY
            </>
          ) : (
            <>
              <Eye size={13} /> SPECTATING
            </>
          )}
        </span>
        <div className={styles.who}>
          <Avatar name={data.player.name} src={data.player.avatar} size={46} />
          <div>
            <h1>
              <Link href={`/players/${encodeURIComponent(data.player.name)}`}>{data.player.name}</Link>
              {data.player.isYou && <span className={styles.muted}> · you</span>}
            </h1>
            <p className={`${styles.muted} ${styles.context}`}>
              {data.tournament ? (
                <>
                  <Medal size={14} /> Tournament run · {data.stake ? `${amount(data.stake, data.asset)} entry` : "Free entry"}
                </>
              ) : (
                <>
                  <Swords size={14} /> 1v1 · {amount(data.stake, data.asset)} entry
                </>
              )}
            </p>
          </div>
        </div>
      </div>

      {data.sides.length > 1 && (
        <div className={styles.sides} role="group" aria-label="Players in this match">
          {data.sides.map((side) => (
            <Link key={side.watchId} href={`/watch/${side.watchId}`} className={styles.side} aria-current={side.watchId === data.watchId ? "page" : undefined}>
              <Avatar name={side.name} src={side.avatar} size={30} />
              <span>
                <b>
                  {side.name}
                  {side.isYou && " · you"}
                </b>
                <small>
                  {side.score.toLocaleString("en")} pts · {side.done ? "finished" : "playing"}
                </small>
              </span>
            </Link>
          ))}
        </div>
      )}

      <div className={styles.layout}>
        <div className={`board-shell ${styles.board}`}>
          <div className="board-head">
            <div>
              <small>ROUND</small>
              <b>{String(game.round).padStart(2, "0")}</b>
            </div>
            <div className="center">
              <small>SCORE</small>
              <b className="lime">{(flying ? liveScore : game.score).toLocaleString()}</b>
            </div>
            <div>
              <small>BALLS</small>
              <b className="ball-counter">
                <span className="ball-dot" />
                {game.balls}
              </b>
            </div>
          </div>
          <div className="board-wrap">
            <canvas ref={attachCanvas} className={`game-canvas ${styles.canvas}`} width={W} height={H} aria-label={`${data.player.name}'s board. Round ${game.round}, score ${game.score}.`} />
          </div>
          <div className="board-bottom">
            <span>{status}</span>
            <button aria-label="Toggle replay speed" className="icon-btn" onClick={toggleSpeed}>
              <FastForward size={15} />
              {speed}×
            </button>
          </div>
        </div>

        <aside className={styles.panel}>
          <div className={styles.stat}>
            <small>Shots played</small>
            <b>{data.revision.toLocaleString("en")}</b>
          </div>
          <div className={styles.stat}>
            <small>Current score</small>
            <b className="lime">{data.score.toLocaleString("en")}</b>
          </div>
          <div className={styles.stat}>
            <small>Status</small>
            <b>{live ? "Playing" : data.forfeit ? "Ended early" : "Finished"}</b>
          </div>
          <div className={styles.actions}>
            {data.replayable && data.revision > 0 && (
              <button className="btn" onClick={() => void replay()} disabled={replaying && revision === 0}>
                <RotateCcw size={15} /> Watch from the start
              </button>
            )}
            {(replaying || !caughtUp) && (
              <button className="btn btn-primary" onClick={goLive}>
                {live ? <Radio size={15} /> : <Eye size={15} />} {live ? "Back to live" : "Skip to the end"}
              </button>
            )}
          </div>
          {!data.replayable && data.revision > 0 && <p className={styles.note}>This run started before replays were recorded, so only new shots animate.</p>}
          {error && <p className="error">{error}</p>}
        </aside>
      </div>
    </section>
  );
}
