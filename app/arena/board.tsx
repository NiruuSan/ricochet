"use client";
import { useEffect, useRef, useState } from "react";
import { Tooltip } from "@/components/ui/tooltip";

import { FastForward, Play } from "lucide-react";
import { H, MAX_ANGLE, MIN_ANGLE, W, type Game } from "@/lib/engine";
import type { GameSession } from "./use-game-session";

/** How long the board-cleared celebration plays, keyframes included. */
const CLEAR_MS = 1600;

/**
 * The round a clear just happened on, or null while nothing is being
 * celebrated. The engine raises `bonus` on the round a shot emptied the board,
 * and every shot moves the round on, so one round is celebrated once.
 */
function useClearCelebration(game: Game, mini: boolean) {
  const [cleared, setCleared] = useState<number | null>(null);
  const seen = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  useEffect(() => {
    // The first board this hook sees is the one it opened on: a run resumed just
    // after a clear is not a clear that just happened.
    if (seen.current === null) {
      seen.current = game.round;
      return;
    }
    if (mini || !game.bonus || seen.current === game.round) return;
    seen.current = game.round;
    setCleared(game.round);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCleared(null), CLEAR_MS);
  }, [game, mini]);
  return cleared;
}

type Props = {
  session: GameSession;
  /** A decorative, non-interactive board (the welcome page). */
  mini?: boolean;
  startLabel?: string;
  startDisabled?: boolean;
  onStart?: () => void;
};

export function Board({ session, mini = false, startLabel, startDisabled, onStart }: Props) {
  const { game, started, flying, busy, syncing, awaitingRow, liveScore, speed, attachCanvas } = session;
  const locked = flying || busy || awaitingRow;
  const cleared = useClearCelebration(game, mini);
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
            session.noteInput(e.nativeEvent);
            if (!locked) session.aimAt(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
          }}
          onPointerDown={(e) => {
            session.noteInput(e.nativeEvent);
            if (!locked) session.aimAt(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerUp={(e) => {
            session.noteInput(e.nativeEvent);
            if (locked) return;
            session.aimAt(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
            const trigger = { isTrusted: e.nativeEvent.isTrusted };
            if (!mini && started) setTimeout(() => session.shoot(trigger), 0);
          }}
          onKeyDown={(e) => {
            session.noteInput(e.nativeEvent);
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
              session.shoot(e.nativeEvent);
            }
          }}
        >
          Aim and launch balls to break numbered bricks.
        </canvas>
        {cleared !== null && (
          <div className="board-clear" role="status" key={cleared}>
            <span className="board-clear-wash" />
            <span className="board-clear-ring" />
            <span className="board-clear-ring board-clear-ring-alt" />
            <div className="board-clear-copy">
              <b>Board cleared</b>
              <span className="board-clear-chip">+4 bonus balls · +1 round ball</span>
              <span className="board-clear-balls" aria-hidden="true">
                <i />
                <i />
                <i />
                <i />
              </span>
            </div>
          </div>
        )}
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
      </div>
      <div className="board-bottom">
        <span>
          {busy ? "Saving…" : flying ? "Let it bounce." : awaitingRow ? "Next row incoming…" : started ? "Aim anywhere above the line." : "472 × 612 · 7 columns · 9 rows"}
          {syncing && !game.over && <Tooltip content="Saving your shots in the background"><span className="sync-dot" /></Tooltip>}
        </span>
        <button aria-label="Toggle animation speed" className="icon-btn" onClick={() => session.toggleSpeed()}>
          <FastForward size={15} />
          {speed}×
        </button>
      </div>
    </div>
  );
}
