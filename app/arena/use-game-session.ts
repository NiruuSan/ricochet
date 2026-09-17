"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Asset, Run } from "@/lib/api-types";
import { GROUND, H, initial, launch, MAX_ANGLE, MIN_ANGLE, RULESET, seedRows, step, W, type Flight, type Game } from "@/lib/engine";
import { MAX_AIM_SAMPLES, type AimTrail, type ShotProof } from "@/lib/anti-cheat-rules";
import { gameAction } from "./api";
import { drawBoard } from "./board-canvas";

const SHOWCASE_SEED = 42076;
const TICK_MS = 1000 / 120;
const DEFAULT_ANGLE = 73;

const clampAngle = (angle: number) => Math.max(MIN_ANGLE, Math.min(MAX_ANGLE, angle));
const sameState = (a: Game, b: Game) => JSON.stringify(a) === JSON.stringify(b);

type Options = {
  /** Called after the server saved a change that affects balances or match lists. */
  onSaved: () => void;
  onError: (message: string) => void;
};

/**
 * The board being played: practice or a saved match run, the aim, and the shot
 * animation. The animation loop and async handlers read the latest values from
 * refs, which every setter below keeps in step with React state.
 *
 * Match shots are saved in the background. The engine is deterministic and the
 * server replays each shot with the same code, so the board the player just
 * watched is already the result: the next shot is playable immediately while
 * saves go out one at a time, in order. If a save fails, the board returns to
 * the last shot the server confirmed.
 *
 * Ruleset 6 hides future rows: only the server can generate them. Those shots
 * are sent the moment they are launched. The balls fly on the board the player
 * already has, and the server's reply (with the new row) is almost always back
 * before they land; if not, the row drops in as soon as it arrives.
 */
type ShotReport = { proof: ShotProof; aim: AimTrail };

const roundAngle = (angle: number) => Math.round(angle * 10) / 10;
/** Aim samples closer together than this merge into one. */
const AIM_SAMPLE_MS = 40;

function recordAim(trail: AimTrail, readyAt: number, angle: number) {
  const t = Math.max(0, Math.round(performance.now() - readyAt));
  const last = trail.at(-1);
  if (last && t - last[0] < AIM_SAMPLE_MS && trail.length > 1) last[1] = roundAngle(angle);
  else trail.push([Math.max(t, last?.[0] ?? 0), roundAngle(angle)]);
}

/** The trail as sent with the shot: ends on the shot angle, thinned to the sample limit. */
function finishAim(trail: AimTrail, aimMs: number, angle: number): AimTrail {
  const full: AimTrail = [...trail, [Math.max(aimMs, trail.at(-1)?.[0] ?? 0), roundAngle(angle)]];
  if (full.length <= MAX_AIM_SAMPLES) return full;
  const step = (full.length - 1) / (MAX_AIM_SAMPLES - 1);
  return Array.from({ length: MAX_AIM_SAMPLES }, (_, i) => full[Math.round(i * step)]);
}

export function useGameSession({ onSaved, onError }: Options) {
  const [game, setGameState] = useState<Game>(() => initial(SHOWCASE_SEED));
  const [run, setRunState] = useState<Run | null>(null);
  const [started, setStartedState] = useState(false);
  const [angle, setAngleState] = useState(DEFAULT_ANGLE);
  const [speed, setSpeedState] = useState(1);
  const [flying, setFlying] = useState(false);
  /** A blocking request is in flight: entering or forfeiting a match. */
  const [busy, setBusy] = useState(false);
  /** Shots are still being saved in the background. Never blocks play. */
  const [syncing, setSyncing] = useState(false);
  /** The balls landed and the next row is on its way from the server (ruleset 6). */
  const [awaitingRow, setAwaitingRow] = useState(false);
  const [liveScore, setLiveScore] = useState(0);
  /** Boards cleared in the current practice run; a match run carries its own count. */
  const [practiceClears, setPracticeClears] = useState(0);

  const gameRef = useRef(game);
  /** The run as this tab plays it, including shots not saved yet. */
  const runRef = useRef(run);
  /** The latest run state the server has confirmed. */
  const confirmedRef = useRef<Run | null>(null);
  const startedRef = useRef(started);
  const angleRef = useRef(angle);
  const speedRef = useRef(speed);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const flightRef = useRef<Flight | null>(null);
  const frameRef = useRef(0);
  const busyRef = useRef(false);
  const disposedRef = useRef(false);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const pendingSavesRef = useRef(0);
  const saveFailedRef = useRef(false);
  const mismatchRef = useRef(false);
  /** Anti-cheat report: when the board was last ready to aim, and the real inputs since. */
  const readyAtRef = useRef(0);
  const inputsRef = useRef(0);
  /** How the player aimed since the board was ready, replayed to spectators. */
  const aimTrailRef = useRef<AimTrail>([]);

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
      if (startedRef.current && !busyRef.current) recordAim(aimTrailRef.current, readyAtRef.current, value);
      setAngleState(value);
      draw();
    },
    [draw],
  );
  const toggleSpeed = useCallback(() => {
    speedRef.current = speedRef.current === 1 ? 3 : 1;
    setSpeedState(speedRef.current);
  }, []);
  const setBlocking = useCallback((value: boolean) => {
    busyRef.current = value;
    setBusy(value);
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

  // Closing the tab would drop shots that are not saved yet.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (pendingSavesRef.current > 0) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  /** Shows the server's version of the current run, abandoning any shot in the air. */
  const adoptConfirmed = useCallback(() => {
    const confirmed = confirmedRef.current;
    if (!confirmed || runRef.current?.id !== confirmed.id) return;
    cancelAnimationFrame(frameRef.current);
    flightRef.current = null;
    busyRef.current = false;
    setFlying(false);
    setAwaitingRow(false);
    setRun(confirmed);
    setGame(confirmed.state);
  }, [setGame, setRun]);

  const saveShot = useCallback(
    /** `predicted` is the board this tab expects; null when the server supplies part of it (hidden rows). */
    (runId: string, revision: number, shotAngle: number, report: ShotReport, predicted: Game | null, onConfirmed?: (saved: Run) => void) => {
      pendingSavesRef.current++;
      setSyncing(true);
      saveChainRef.current = saveChainRef.current.then(async () => {
        try {
          // After a failure, later shots were played on a board the server never had.
          if (saveFailedRef.current) return;
          const { run: saved } = await gameAction<{ run: Run }>({ action: "shot", runId, revision, angle: shotAngle, proof: report.proof, aim: report.aim });
          confirmedRef.current = saved;
          if (predicted && !sameState(saved.state, predicted)) mismatchRef.current = true;
          if (!disposedRef.current) onConfirmed?.(saved);
          if (saved.done && !disposedRef.current) onSaved();
        } catch (e) {
          saveFailedRef.current = true;
          if (!disposedRef.current) onError(`${(e as Error).message} The board is back at your last saved shot.`);
        } finally {
          pendingSavesRef.current--;
          if (pendingSavesRef.current === 0) {
            if (!disposedRef.current) {
              setSyncing(false);
              if (saveFailedRef.current || mismatchRef.current) adoptConfirmed();
            }
            saveFailedRef.current = false;
            mismatchRef.current = false;
          }
        }
      });
    },
    [adoptConfirmed, onError, onSaved],
  );

  const aimAt = useCallback(
    (clientX: number, clientY: number, rect: DOMRect) => {
      const x = ((clientX - rect.left) / rect.width) * W;
      const y = ((clientY - rect.top) / rect.height) * H;
      setAngle((Math.atan2(GROUND - 6 - y, x - gameRef.current.x) * 180) / Math.PI);
    },
    [setAngle],
  );

  /** Counts a real pointer or key event while aiming, for the anti-cheat report. */
  const noteInput = useCallback((event: Event) => {
    if (event.isTrusted) inputsRef.current++;
  }, []);

  /** `trigger` is the input event that fired the shot. */
  const shoot = useCallback((trigger?: { isTrusted: boolean }) => {
    if (busyRef.current || !startedRef.current || gameRef.current.over) return;
    const currentRun = runRef.current;
    const shotAngle = angleRef.current;
    const proof: ShotProof = {
      v: 1,
      aimMs: Math.max(0, Math.round(performance.now() - readyAtRef.current)),
      inputs: inputsRef.current,
      trusted: trigger?.isTrusted === true,
      webdriver: navigator.webdriver === true,
    };
    const report: ShotReport = { proof, aim: finishAim(aimTrailRef.current, proof.aimMs, shotAngle) };
    // Practice rows come from its own seed; a match run uses its ruleset, and from
    // ruleset 6 the browser has no row source at all.
    const ruleset = currentRun?.ruleset ?? RULESET;
    const hiddenRows = !!currentRun && ruleset >= 6;
    let f: Flight;
    try {
      // A match replays with its own ruleset so the animation matches the server.
      f = launch(gameRef.current, shotAngle, ruleset, currentRun ? undefined : seedRows(gameRef.current.seed));
    } catch (e) {
      onError((e as Error).message);
      return;
    }
    busyRef.current = true;
    onError("");
    setFlying(true);
    setLiveScore(gameRef.current.score);
    flightRef.current = f;

    // Hidden rows: send the shot now, and show the server's board once the balls land.
    let confirmed: Run | null = null;
    let landed = false;
    const adopt = (saved: Run) => {
      if (runRef.current?.id !== saved.id || flightRef.current) return;
      busyRef.current = false;
      setAwaitingRow(false);
      setRun(saved);
      setGame(saved.state);
    };
    inputsRef.current = 0;
    aimTrailRef.current = [];
    if (hiddenRows) {
      saveShot(currentRun.id, currentRun.revision, shotAngle, report, null, (saved) => {
        confirmed = saved;
        if (landed) adopt(saved);
      });
    }

    const finish = () => {
      flightRef.current = null;
      setFlying(false);
      if (hiddenRows) {
        landed = true;
        if (confirmed) {
          adopt(confirmed);
        } else {
          // Everything but the new row is known: show it while the row is on its way.
          setAwaitingRow(true);
          setGame(f.game);
        }
        return;
      }
      busyRef.current = false;
      if (currentRun) {
        const next = f.game;
        const clears = (currentRun.clears ?? 0) + (next.bonus ? 1 : 0);
        setRun({ ...currentRun, state: next, score: next.score, done: next.over ? 1 : 0, clears, revision: currentRun.revision + 1 });
        saveShot(currentRun.id, currentRun.revision, shotAngle, report, next);
      } else if (f.game.bonus) {
        setPracticeClears((count) => count + 1);
      }
      setGame(f.game);
    };

    let previous = 0;
    let pending = 0;
    const tick = (ts: number) => {
      // Stop if unmounted, or if this flight was abandoned (reset or restored board).
      if (disposedRef.current || flightRef.current !== f) return;
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
      if (f.done) finish();
      else frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
  }, [draw, onError, saveShot, setGame, setRun]);

  const startPractice = useCallback(() => {
    if (busyRef.current) return;
    flightRef.current = null;
    setRun(null);
    setPracticeClears(0);
    setGame(initial(crypto.getRandomValues(new Uint32Array(1))[0]));
    setStarted(true);
    setAngle(DEFAULT_ANGLE);
  }, [setAngle, setGame, setRun, setStarted]);

  /** Enters (or resumes) a saved match. Returns the run, or null after reporting an error. */
  const startMatch = useCallback(
    async (stake: number, asset: Asset) => {
      if (busyRef.current) return null;
      setBlocking(true);
      try {
        const { run: entered } = await gameAction<{ run: Run }>({ action: "start", stake, asset });
        confirmedRef.current = entered;
        setRun(entered);
        setGame(entered.state);
        setStarted(true);
        onSaved();
        return entered;
      } catch (e) {
        onError((e as Error).message);
        return null;
      } finally {
        setBlocking(false);
      }
    },
    [onError, onSaved, setBlocking, setGame, setRun, setStarted],
  );

  const forfeit = useCallback(async () => {
    if (!runRef.current || busyRef.current) return;
    setBlocking(true);
    try {
      // Queued shots land first, so the forfeit applies to the latest revision.
      await saveChainRef.current;
      const current = runRef.current;
      if (!current || current.done) return;
      const { run: ended } = await gameAction<{ run: Run }>({ action: "forfeit", runId: current.id, revision: current.revision });
      confirmedRef.current = ended;
      setRun(ended);
      setGame(ended.state);
      onSaved();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBlocking(false);
    }
  }, [onError, onSaved, setBlocking, setGame, setRun]);

  const resume = useCallback(
    (active: Run) => {
      // Polling must not rewind a run this tab is already playing, or replace another game in progress.
      if (runRef.current?.id === active.id || (startedRef.current && !gameRef.current.over)) return;
      confirmedRef.current = active;
      setRun(active);
      setGame(active.state);
      setStarted(true);
    },
    [setGame, setRun, setStarted],
  );

  /** Leaves a finished run or abandons practice, back to the showcase board. Pending saves still complete. */
  const reset = useCallback(() => {
    cancelAnimationFrame(frameRef.current);
    flightRef.current = null;
    busyRef.current = false;
    setFlying(false);
    setAwaitingRow(false);
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
          name: "read_bounce_game",
          title: "Read Bounce game",
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

  // The board is ready to aim again once the balls have landed and the next row is in.
  useEffect(() => {
    if (flying || awaitingRow) return;
    readyAtRef.current = performance.now();
    aimTrailRef.current = [[0, roundAngle(angleRef.current)]];
  }, [flying, awaitingRow, run?.id, started]);

  return {
    game,
    run,
    started,
    angle,
    speed,
    flying,
    busy,
    syncing,
    awaitingRow,
    liveScore,
    clears: run ? (run.clears ?? 0) : practiceClears,
    attachCanvas,
    aimAt,
    noteInput,
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
