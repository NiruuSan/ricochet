"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Asset, Run } from "@/lib/api-types";
import { GROUND, H, initial, launch, MAX_ANGLE, MIN_ANGLE, RULESET, step, W, type Flight, type Game } from "@/lib/engine";
import { gameAction } from "./api";
import { drawBoard } from "./board-canvas";

const SHOWCASE_SEED = 42076;
const TICK_MS = 1000 / 120;
const DEFAULT_ANGLE = 73;

const clampAngle = (angle: number) => Math.max(MIN_ANGLE, Math.min(MAX_ANGLE, angle));

type Options = {
  /** Called after the server saved a match change. */
  onSaved: () => void;
  onError: (message: string) => void;
};

/**
 * The board being played: practice or a saved match run, the aim, and the shot
 * animation. The animation loop and async handlers read the latest values from
 * refs, which every setter below keeps in step with React state.
 */
export function useGameSession({ onSaved, onError }: Options) {
  const [game, setGameState] = useState<Game>(() => initial(SHOWCASE_SEED));
  const [run, setRunState] = useState<Run | null>(null);
  const [started, setStartedState] = useState(false);
  const [angle, setAngleState] = useState(DEFAULT_ANGLE);
  const [speed, setSpeedState] = useState(1);
  const [flying, setFlying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [liveScore, setLiveScore] = useState(0);

  const gameRef = useRef(game);
  const runRef = useRef(run);
  const startedRef = useRef(started);
  const angleRef = useRef(angle);
  const speedRef = useRef(speed);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const flightRef = useRef<Flight | null>(null);
  const frameRef = useRef(0);
  const busyRef = useRef(false);
  const disposedRef = useRef(false);

  const draw = useCallback(() => {
    if (canvasRef.current) drawBoard(canvasRef.current, flightRef.current, gameRef.current, angleRef.current);
  }, []);

  const setGame = useCallback(
    (next: Game) => {
      gameRef.current = next;
      setGameState(next);
      draw();
    },
    [draw],
  );
  const setRun = useCallback((next: Run | null) => {
    runRef.current = next;
    setRunState(next);
  }, []);
  const setStarted = useCallback((next: boolean) => {
    startedRef.current = next;
    setStartedState(next);
  }, []);
  const setAngle = useCallback(
    (next: number | ((current: number) => number)) => {
      const value = clampAngle(typeof next === "function" ? next(angleRef.current) : next);
      angleRef.current = value;
      setAngleState(value);
      draw();
    },
    [draw],
  );
  const toggleSpeed = useCallback(() => {
    speedRef.current = speedRef.current === 1 ? 3 : 1;
    setSpeedState(speedRef.current);
  }, []);

  /** Callback ref: the board canvas remounts when the view changes, so paint on attach. */
  const attachCanvas = useCallback(
    (node: HTMLCanvasElement | null) => {
      canvasRef.current = node;
      draw();
    },
    [draw],
  );

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      cancelAnimationFrame(frameRef.current);
    };
  }, []);

  const aimAt = useCallback(
    (clientX: number, clientY: number, rect: DOMRect) => {
      const x = ((clientX - rect.left) / rect.width) * W;
      const y = ((clientY - rect.top) / rect.height) * H;
      setAngle((Math.atan2(GROUND - 6 - y, x - gameRef.current.x) * 180) / Math.PI);
    },
    [setAngle],
  );

  const shoot = useCallback(() => {
    if (busyRef.current || !startedRef.current || gameRef.current.over) return;
    const currentRun = runRef.current;
    const shotAngle = angleRef.current;
    let f: Flight;
    try {
      // A match replays with its own ruleset so the animation matches the server.
      f = launch(gameRef.current, shotAngle, currentRun?.ruleset ?? RULESET);
    } catch (e) {
      onError((e as Error).message);
      return;
    }
    busyRef.current = true;
    onError("");
    setFlying(true);
    setLiveScore(gameRef.current.score);
    flightRef.current = f;

    const finish = async () => {
      flightRef.current = null;
      setFlying(false);
      if (currentRun) {
        setSaving(true);
        try {
          const { run: saved } = await gameAction<{ run: Run }>({ action: "shot", runId: currentRun.id, revision: currentRun.revision, angle: shotAngle });
          if (!disposedRef.current) {
            setRun(saved);
            setGame(saved.state);
            onSaved();
          }
        } catch (e) {
          if (!disposedRef.current) onError((e as Error).message);
        } finally {
          if (!disposedRef.current) setSaving(false);
        }
      } else {
        setGame(f.game);
      }
      busyRef.current = false;
      draw();
    };

    let previous = 0;
    let pending = 0;
    const tick = (ts: number) => {
      if (disposedRef.current) return;
      if (!previous) previous = ts;
      pending += Math.min(100, ts - previous) * speedRef.current;
      previous = ts;
      while (pending >= TICK_MS && !f.done && !f.aborted) {
        step(f);
        pending -= TICK_MS;
      }
      if (f.aborted) {
        flightRef.current = null;
        busyRef.current = false;
        setFlying(false);
        onError("This shot took too long. Please choose another angle.");
        draw();
        return;
      }
      setLiveScore(f.game.score);
      draw();
      if (f.done) void finish();
      else frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
  }, [draw, onError, onSaved, setGame, setRun]);

  const startPractice = useCallback(() => {
    if (busyRef.current) return;
    flightRef.current = null;
    setRun(null);
    setGame(initial(crypto.getRandomValues(new Uint32Array(1))[0]));
    setStarted(true);
    setAngle(DEFAULT_ANGLE);
  }, [setAngle, setGame, setRun, setStarted]);

  /** Enters (or resumes) a saved match. Returns the run, or null after reporting an error. */
  const startMatch = useCallback(
    async (stake: number, asset: Asset) => {
      if (busyRef.current) return null;
      busyRef.current = true;
      setSaving(true);
      try {
        const { run: entered } = await gameAction<{ run: Run }>({ action: "start", stake, asset });
        setRun(entered);
        setGame(entered.state);
        setStarted(true);
        onSaved();
        return entered;
      } catch (e) {
        onError((e as Error).message);
        return null;
      } finally {
        setSaving(false);
        busyRef.current = false;
      }
    },
    [onError, onSaved, setGame, setRun, setStarted],
  );

  const forfeit = useCallback(async () => {
    const current = runRef.current;
    if (!current || busyRef.current) return;
    busyRef.current = true;
    setSaving(true);
    try {
      const { run: ended } = await gameAction<{ run: Run }>({ action: "forfeit", runId: current.id, revision: current.revision });
      setRun(ended);
      setGame(ended.state);
      onSaved();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setSaving(false);
      busyRef.current = false;
    }
  }, [onError, onSaved, setGame, setRun]);

  const resume = useCallback(
    (active: Run) => {
      // Polling must not rewind a run this tab is already playing.
      if (runRef.current?.id === active.id) return;
      setRun(active);
      setGame(active.state);
      setStarted(true);
    },
    [setGame, setRun, setStarted],
  );

  /** Leaves a finished run or abandons practice, back to the showcase board. */
  const reset = useCallback(() => {
    cancelAnimationFrame(frameRef.current);
    flightRef.current = null;
    busyRef.current = false;
    setFlying(false);
    setStarted(false);
    setRun(null);
    setGame(initial(SHOWCASE_SEED));
  }, [setGame, setRun, setStarted]);

  // Lets an in-browser assistant read (never play) the current board.
  useEffect(() => {
    const context = (document as unknown as { modelContext?: { registerTool: (tool: unknown, options: unknown) => Promise<void> } }).modelContext;
    if (!context?.registerTool) return;
    const controller = new AbortController();
    Promise.resolve(
      context.registerTool(
        {
          name: "read_ricochet_game",
          title: "Read Ricochet game",
          description: "Read the current displayed round, score, ball count and aim. Does not launch a shot or enter a match.",
          inputSchema: { type: "object", properties: {}, additionalProperties: false },
          annotations: { readOnlyHint: true },
          execute: () => ({
            round: gameRef.current.round,
            score: gameRef.current.score,
            balls: gameRef.current.balls,
            angle: angleRef.current,
            playing: startedRef.current,
            over: gameRef.current.over,
            mode: runRef.current ? `${runRef.current.asset} match` : "practice",
          }),
        },
        { signal: controller.signal },
      ),
    ).catch(() => {});
    return () => controller.abort();
  }, []);

  return {
    game,
    run,
    started,
    angle,
    speed,
    flying,
    saving,
    liveScore,
    attachCanvas,
    aimAt,
    setAngle,
    toggleSpeed,
    shoot,
    startPractice,
    startMatch,
    forfeit,
    resume,
    reset,
  };
}

export type GameSession = ReturnType<typeof useGameSession>;
