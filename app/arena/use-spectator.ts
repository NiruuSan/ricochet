"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { WatchData, WatchShot } from "@/lib/api-types";
import { CLIENT_TICKS_PER_SECOND, launch, step, type Flight, type Game } from "@/lib/engine";
import { request } from "./api";
import { drawBoard } from "./board-canvas";

const TICK_MS = 1000 / CLIENT_TICKS_PER_SECOND;
const LIVE_POLL_MS = 2500;
const IDLE_POLL_MS = 10_000;
/** Pause between shots of a replay, at 1× speed. */
const REPLAY_GAP_MS = 450;
/** Aim playback: long pauses are shortened, and a whole aim lasts at most this long at 1×. */
const AIM_MAX_PAUSE_MS = 700;
const AIM_MAX_MS = 5_000;

/** Aim samples on a compressed timeline: [ms from the start, angle]. */
function aimTimeline(aim: [number, number][]) {
  const points: [number, number][] = [];
  let t = 0;
  aim.forEach(([at, angle], i) => {
    if (i > 0) t += Math.min(AIM_MAX_PAUSE_MS, at - aim[i - 1][0]);
    points.push([t, angle]);
  });
  const scale = t > AIM_MAX_MS ? AIM_MAX_MS / t : 1;
  return points.map(([at, angle]): [number, number] => [at * scale, angle]);
}

function angleAt(points: [number, number][], t: number) {
  if (t <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [t1, a1] = points[i];
    if (t <= t1) {
      const [t0, a0] = points[i - 1];
      return t1 === t0 ? a1 : a0 + ((a1 - a0) * (t - t0)) / (t1 - t0);
    }
  }
  return points[points.length - 1][1];
}

/**
 * Follows a run in spectator mode. The board shows the last shot the server
 * confirmed; each new shot is replayed locally with the run's ruleset, which
 * reproduces the server's result exactly. If the local board ever disagrees
 * (or shots were never logged), it snaps to the server's board.
 */
export function useSpectator(watchId: string) {
  const [data, setData] = useState<WatchData | null>(null);
  const [error, setError] = useState("");
  const [game, setGame] = useState<Game | null>(null);
  const [revision, setRevision] = useState(0);
  const [flying, setFlying] = useState(false);
  const [liveScore, setLiveScore] = useState(0);
  const [replaying, setReplaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [aiming, setAiming] = useState(false);

  const dataRef = useRef<WatchData | null>(null);
  const gameRef = useRef<Game | null>(null);
  const revisionRef = useRef(0);
  const queueRef = useRef<WatchShot[]>([]);
  const flightRef = useRef<Flight | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef(0);
  const gapRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speedRef = useRef(1);
  const replayingRef = useRef(false);
  const disposedRef = useRef(false);
  // The animation loop calls back into `pump` after each shot.
  const pumpRef = useRef<() => void>(() => {});
  /** The replayed aim angle while a player's aiming plays back; null otherwise. */
  const aimRef = useRef<number | null>(null);

  const draw = useCallback(() => {
    if (canvasRef.current && gameRef.current) drawBoard(canvasRef.current, flightRef.current, gameRef.current, aimRef.current);
  }, []);

  const show = useCallback(
    (next: Game, rev: number) => {
      gameRef.current = next;
      revisionRef.current = rev;
      setGame(next);
      setRevision(rev);
      setLiveScore(next.score);
      draw();
    },
    [draw],
  );

  const stopAnimation = useCallback(() => {
    cancelAnimationFrame(frameRef.current);
    aimRef.current = null;
    setAiming(false);
    if (gapRef.current) clearTimeout(gapRef.current);
    gapRef.current = null;
    flightRef.current = null;
    queueRef.current = [];
    setFlying(false);
  }, []);

  const setReplay = useCallback((on: boolean) => {
    replayingRef.current = on;
    setReplaying(on);
  }, []);

  /** Shows the server's board as it is now. */
  const snap = useCallback(() => {
    const server = dataRef.current;
    if (!server) return;
    stopAnimation();
    setReplay(false);
    show(server.state, server.revision);
  }, [setReplay, show, stopAnimation]);

  /** Animates one shot, then moves on to the next queued shot. */
  const flyShot = useCallback((f: Flight) => {
    flightRef.current = f;
    setFlying(true);
    let previous = 0;
    let pending = 0;
    const tick = (ts: number) => {
      if (disposedRef.current || flightRef.current !== f) return;
      if (!previous) previous = ts;
      pending += Math.min(100, ts - previous) * speedRef.current;
      previous = ts;
      while (pending >= TICK_MS && !f.done && !f.aborted) {
        step(f);
        pending -= TICK_MS;
      }
      if (f.aborted) return snap();
      setLiveScore(f.game.score);
      draw();
      if (!f.done) {
        frameRef.current = requestAnimationFrame(tick);
        return;
      }
      flightRef.current = null;
      setFlying(false);
      show(f.game, revisionRef.current + 1);
      if (queueRef.current.length && replayingRef.current) {
        gapRef.current = setTimeout(() => {
          gapRef.current = null;
          pumpRef.current();
        }, REPLAY_GAP_MS / speedRef.current);
      } else {
        pumpRef.current();
      }
    };
    frameRef.current = requestAnimationFrame(tick);
  }, [draw, show, snap]);

  const pump = useCallback(() => {
    const server = dataRef.current;
    if (disposedRef.current || !server || flightRef.current || gapRef.current || aimRef.current !== null || !gameRef.current) return;
    const shot = queueRef.current[0];
    if (!shot) {
      // Caught up: make sure the board matches the server's.
      if (revisionRef.current >= server.revision) {
        if (replayingRef.current) setReplay(false);
        if (JSON.stringify(gameRef.current) !== JSON.stringify(server.state)) show(server.state, server.revision);
      } else if (!replayingRef.current) {
        show(server.state, server.revision);
      }
      return;
    }
    if (shot.revision !== revisionRef.current) return snap();
    queueRef.current.shift();
    if (shot.angle === null) {
      show({ ...gameRef.current, over: true }, revisionRef.current + 1);
      return pumpRef.current();
    }
    const angle = shot.angle;
    const fly = () => {
      if (disposedRef.current || !gameRef.current) return;
      let f: Flight;
      try {
        f = launch(gameRef.current, angle, server.ruleset, (round) => server.rows[round - 1] ?? []);
      } catch {
        return snap();
      }
      flyShot(f);
    };
    // Play back how the player aimed, then launch.
    if (!shot.aim?.length) return fly();
    const points = aimTimeline(shot.aim);
    const end = points[points.length - 1][0];
    aimRef.current = points[0][1];
    setAiming(true);
    let started = 0;
    let elapsed = 0;
    const aimTick = (ts: number) => {
      if (disposedRef.current || aimRef.current === null) return;
      if (!started) started = ts;
      elapsed += Math.min(100, ts - started) * speedRef.current;
      started = ts;
      aimRef.current = angleAt(points, elapsed);
      draw();
      if (elapsed < end) {
        frameRef.current = requestAnimationFrame(aimTick);
        return;
      }
      aimRef.current = null;
      setAiming(false);
      fly();
    };
    frameRef.current = requestAnimationFrame(aimTick);
  }, [draw, flyShot, setReplay, show, snap]);

  useEffect(() => {
    pumpRef.current = pump;
  }, [pump]);

  /** The revision of the next shot the board still needs. */
  const nextRevision = useCallback(() => {
    const last = queueRef.current.at(-1);
    return last ? last.revision + 1 : revisionRef.current + (flightRef.current ? 1 : 0);
  }, []);

  /** Queues logged shots the board has not reached yet, in order and without gaps. */
  const enqueue = useCallback((shots: WatchShot[]) => {
    let next = nextRevision();
    for (const shot of shots) {
      if (shot.revision !== next) continue;
      queueRef.current.push(shot);
      next++;
    }
  }, [nextRevision]);

  const load = useCallback(
    async (since: number) => {
      const next = await request<WatchData>(`/api/watch/${encodeURIComponent(watchId)}?since=${since}`);
      if (disposedRef.current) return null;
      dataRef.current = next;
      setData(next);
      setError("");
      return next;
    },
    [watchId],
  );

  // First load shows the current board; later polls animate new shots.
  useEffect(() => {
    disposedRef.current = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      const current = dataRef.current;
      try {
        if (!current) {
          const first = await load(0);
          if (first) show(first.state, first.revision);
        } else {
          const next = await load(nextRevision());
          if (next) {
            enqueue(next.shots);
            pump();
          }
        }
      } catch (e) {
        if (!disposedRef.current) setError((e as Error).message);
      }
      if (disposedRef.current) return;
      const latest = dataRef.current;
      if (latest && latest.done && latest.final) return;
      timer = setTimeout(() => void poll(), latest?.done ? IDLE_POLL_MS : LIVE_POLL_MS);
    };
    void poll();
    return () => {
      disposedRef.current = true;
      if (timer) clearTimeout(timer);
      cancelAnimationFrame(frameRef.current);
      if (gapRef.current) clearTimeout(gapRef.current);
    };
  }, [enqueue, load, nextRevision, pump, show]);

  const replay = useCallback(async () => {
    try {
      const full = await load(0);
      if (!full?.replayable) return;
      stopAnimation();
      setReplay(true);
      show(structuredClone(full.start), 0);
      queueRef.current = full.shots.slice();
      gapRef.current = setTimeout(() => {
        gapRef.current = null;
        pump();
      }, REPLAY_GAP_MS);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [load, pump, setReplay, show, stopAnimation]);

  const toggleSpeed = useCallback(() => {
    setSpeed((s) => {
      const next = s === 1 ? 2 : s === 2 ? 4 : 1;
      speedRef.current = next;
      return next;
    });
  }, []);

  const attachCanvas = useCallback(
    (node: HTMLCanvasElement | null) => {
      canvasRef.current = node;
      draw();
    },
    [draw],
  );

  return { data, error, game, revision, flying, aiming, liveScore, replaying, speed, replay, goLive: snap, toggleSpeed, attachCanvas };
}
