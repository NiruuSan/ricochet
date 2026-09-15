"use client";
import Link from "next/link";
import { FastForward, Play } from "lucide-react";
import { H, MAX_ANGLE, MIN_ANGLE, W } from "@/lib/engine";
import type { GameSession } from "./use-game-session";

type Props = {
  session: GameSession;
  /** A decorative, non-interactive board (the welcome page). */
  mini?: boolean;
  startLabel?: string;
  startDisabled?: boolean;
  onStart?: () => void;
};

export function Board({ session, mini = false, startLabel, startDisabled, onStart }: Props) {
  const { game, run, started, flying, busy, syncing, liveScore, speed, attachCanvas } = session;
  const locked = flying || busy;
  return (
    <div className="board-shell">
      <div className="board-head">
        <div>
          <small>ROUND</small>
          <b>{String(game.round).padStart(2, "0")}</b>
        </div>
        <div className="center">
          <small>YOUR SCORE</small>
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
        <canvas
          ref={attachCanvas}
          className="game-canvas"
          width={W}
          height={H}
          tabIndex={0}
          aria-label={`Brick breaker board. Round ${game.round}, score ${game.score}. Arrow keys aim; Enter launches.`}
          onPointerMove={(e) => {
            if (!locked) session.aimAt(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
          }}
          onPointerDown={(e) => {
            if (!locked) session.aimAt(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerUp={(e) => {
            if (locked) return;
            session.aimAt(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
            if (!mini && started) setTimeout(session.shoot, 0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") {
              e.preventDefault();
              session.setAngle((a) => Math.min(MAX_ANGLE, a + 2));
            }
            if (e.key === "ArrowRight") {
              e.preventDefault();
              session.setAngle((a) => Math.max(MIN_ANGLE, a - 2));
            }
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              session.shoot();
            }
          }}
        >
          Aim and launch balls to break numbered bricks.
        </canvas>
        {!started && !mini && (
          <div className="board-overlay">
            <div className="tag lime">YOUR NEXT GOOD ANGLE</div>
            <h2>Let’s break some bricks.</h2>
            <p>
              One board. Endless possibilities.
              <br />
              Start a run, aim, and let it bounce.
            </p>
            <button className="btn btn-primary" onClick={onStart} disabled={startDisabled}>
              <Play size={16} />
              {startLabel}
            </button>
          </div>
        )}
        {game.over && !mini && (
          <div className="board-overlay">
            <div className="tag lime">RUN COMPLETE</div>
            <h2>{game.score} points.</h2>
            <p>
              {!run
                ? "Every bounce is a lesson. Find your next angle."
                : syncing
                  ? "Saving your final score…"
                  : "Your score is saved. Check Matches for the result."}
            </p>
            <button className="btn btn-primary" onClick={() => session.reset()}>
              Back to arena
            </button>
            {run && (
              <Link className="btn" href="/matches">
                View match
              </Link>
            )}
          </div>
        )}
      </div>
      <div className="board-bottom">
        <span>
          {busy ? "Saving…" : flying ? "Let it bounce." : started ? "Aim anywhere above the line." : "472 × 612 · 7 columns · 9 rows"}
          {syncing && !game.over && <span className="sync-dot" title="Saving your shots in the background" />}
        </span>
        <button aria-label="Toggle animation speed" className="icon-btn" onClick={() => session.toggleSpeed()}>
          <FastForward size={15} />
          {speed}×
        </button>
      </div>
    </div>
  );
}
