import type { Brick, Game } from "./engine";
import type { Run } from "./api-types";

// Ghost bricks: bricks the server adds to a run's board on the way to the
// player's browser. The official client removes them before drawing or
// simulating anything, so a person never sees them and they never affect
// play. A bot that reads the board from the game's data plans shots around
// bricks that do not exist, and falls into traps set with them
// (lib/ghost-trap.ts).
//
// A ghost is recognised by a keyed mark over its cell and hit points, with the
// run's shot key and a `sync` number sent with the run. The server picks
// `sync` so that no real brick carries the mark, then gives each ghost hit
// points that do. Shared by the server and the browser: no secrets here.

const MARK_MODULUS = 29;
const MARK_VALUE = 7;

function fnv1a(text: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export const isGhost = (key: string, sync: number, b: Brick) => fnv1a(`${key}|${sync}|${b.col}|${b.row}|${b.hp}`) % MARK_MODULUS === MARK_VALUE;

/** The board without ghosts. */
export function stripGhosts(game: Game, key: string, sync: number): Game {
  const bricks = game.bricks.filter((b) => !isGhost(key, sync, b));
  return bricks.length === game.bricks.length ? game : { ...game, bricks };
}

/** A run from the server, as the official client uses it: ghosts removed. */
export function cleanRun(run: Run): Run {
  if (!run.shotKey || typeof run.sync !== "number") return run;
  return { ...run, state: stripGhosts(run.state, run.shotKey, run.sync) };
}

/** A `sync` for this board under which no real brick carries the ghost mark. Deterministic, so every copy of a board agrees. */
export function syncFor(key: string, revision: number, bricks: Brick[]) {
  const start = fnv1a(`${key}|sync|${revision}`) % 1_000_000;
  for (let n = start; n < start + 2_000; n++) {
    if (!bricks.some((b) => isGhost(key, n, b))) return n;
  }
  return start;
}

/** The smallest hit points from `min` that mark a brick in this cell as a ghost. */
export function ghostHp(key: string, sync: number, col: number, row: number, min: number) {
  for (let hp = Math.max(1, min); hp < min + 10 * MARK_MODULUS; hp++) {
    if (isGhost(key, sync, { col, row, hp })) return hp;
  }
  return null;
}
