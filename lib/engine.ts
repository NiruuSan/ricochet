// Fixed 120 Hz physics, shared by the browser and the authoritative server.
//
// Every match records the ruleset it was created under and is always simulated
// with that ruleset, so a deploy never changes the rules of a match in progress.
// Keep a ruleset in SUPPORTED_RULESETS until no unsettled match uses it.
//
// Ruleset 2: solid grid-cell collision bounds, native Math.sin/Math.cos.
// Ruleset 3: same rules, but launch vectors use portable trigonometry and
//            distances use plain multiplication. Basic IEEE-754 arithmetic is
//            exact in every JavaScript engine, so browsers replay the server's
//            result bit for bit. Also bounds the work a single shot may cost.
// Ruleset 4: ruleset 3 physics, with bricks that toughen faster (see brickHp),
//            and matches settled on score alone: a forfeit just ends a run early.
// Ruleset 5: ruleset 4, plus sharp corners. A ball that clips the exposed corner
//            of a brick reflects off the rounded corner, so its path can be
//            deflected at any angle instead of only flipping one axis.
export const RULESET = 5;
export const SUPPORTED_RULESETS: readonly number[] = [2, 3, 4, 5];
export const isSupportedRuleset = (ruleset: number) => SUPPORTED_RULESETS.includes(ruleset);

export const W = 472;
export const H = 612;
export const COLS = 7;
export const ROWS = 9;
export const CW = W / COLS;
export const RH = H / ROWS;
export const GROUND = RH * 8;
export const RADIUS = 5;
export const SPEED = 4.5;
export const MIN_ANGLE = 8;
export const MAX_ANGLE = 172;
export const MAX_TICKS = 200_000;
/** Ruleset 3+: maximum ball-steps (active balls × ticks) for one shot, about half a second of CPU. A 400-ball shot on a dense round-300 board needs under 300,000. */
export const MAX_BALL_STEPS = 4_000_000;

export type Brick = { col: number; row: number; hp: number };
export type Game = {
  seed: number;
  round: number;
  score: number;
  balls: number;
  x: number;
  bricks: Brick[];
  over: boolean;
  bonus: boolean;
};
export type Ball = { x: number; y: number; vx: number; vy: number; delay: number; done: boolean };
export type Flight = {
  game: Game;
  balls: Ball[];
  ticks: number;
  landing: number | null;
  done: boolean;
  /** Set when the shot exceeded its simulation budget; the shot is rejected. */
  aborted: boolean;
  ruleset: number;
  ballSteps: number;
  /** Bricks in their order at launch; collision priority follows this order. */
  order: Brick[];
  /** Brick indices (into `order`) per grid cell, or null when bricks lie off-grid. */
  cells: number[][] | null;
};

export class ShotError extends Error {}

export function random(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Ruleset 4: HP of the bricks spawned in rounds 1–10. The per-round increase
 * grows from +1 to +4, and stays at +4 from round 10 on. Earlier rulesets used
 * the round number (+1 per round).
 */
const RULESET4_HP = [1, 2, 3, 4, 6, 8, 10, 13, 16, 20];

export function brickHp(round: number, ruleset = RULESET) {
  if (ruleset < 4) return round;
  return round <= RULESET4_HP.length ? RULESET4_HP[round - 1] : RULESET4_HP.at(-1)! + 4 * (round - RULESET4_HP.length);
}

export function spawn(g: Game, ruleset = RULESET) {
  const rng = random(g.seed ^ Math.imul(g.round, 2654435761));
  const count = 1 + Math.floor(rng() * 7);
  const cols = [0, 1, 2, 3, 4, 5, 6];
  for (let i = 6; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [cols[i], cols[j]] = [cols[j], cols[i]];
  }
  for (const col of cols.slice(0, count)) g.bricks.push({ col, row: 7, hp: brickHp(g.round, ruleset) });
}

export function initial(seed: number): Game {
  const g: Game = { seed, round: 1, score: 0, balls: 1, x: W / 2, bricks: [], over: false, bonus: false };
  spawn(g);
  return g;
}

// Padding is visual only: adjacent occupied cells form a continuous barrier.
export function brickBounds(b: Brick) {
  return { x: b.col * CW, y: (8 - b.row) * RH, w: CW, h: RH };
}

export function brickRect(b: Brick) {
  return { x: b.col * CW + 5, y: (8 - b.row) * RH + 5, w: CW - 10, h: RH - 10 };
}

/**
 * sin and cos of |u| <= π/2 from a fixed Taylor expansion (terms to u^21).
 * Uses only multiplication, division and subtraction, which IEEE-754 defines
 * exactly, unlike Math.sin/Math.cos whose precision varies between engines.
 */
export function portableSinCos(u: number): [number, number] {
  const u2 = u * u;
  let s = 1;
  for (let n = 21; n >= 3; n -= 2) s = 1 - (u2 / (n * (n - 1))) * s;
  let c = 1;
  for (let n = 20; n >= 2; n -= 2) c = 1 - (u2 / (n * (n - 1))) * c;
  return [u * s, c];
}

function launchVector(angle: number, ruleset: number): [number, number] {
  if (ruleset >= 3) {
    // cos θ = sin(90° − θ) and sin θ = cos(90° − θ); |90° − θ| <= 82°.
    const [sin, cos] = portableSinCos(((90 - angle) * Math.PI) / 180);
    return [sin * SPEED, -cos * SPEED];
  }
  const rad = (angle * Math.PI) / 180;
  return [Math.cos(rad) * SPEED, -Math.sin(rad) * SPEED];
}

function buildCells(bricks: Brick[]): number[][] | null {
  const cells: number[][] = Array.from({ length: COLS * ROWS }, () => []);
  for (let i = 0; i < bricks.length; i++) {
    const { col, row } = bricks[i];
    const cy = 8 - row;
    if (!Number.isInteger(col) || !Number.isInteger(cy) || col < 0 || col >= COLS || cy < 0 || cy >= ROWS) return null;
    cells[cy * COLS + col].push(i);
  }
  return cells;
}

export function validAngle(angle: unknown): angle is number {
  return typeof angle === "number" && Number.isFinite(angle) && angle >= MIN_ANGLE && angle <= MAX_ANGLE;
}

export function launch(g: Game, angle: number, ruleset = RULESET): Flight {
  if (!isSupportedRuleset(ruleset)) throw new ShotError("This match uses a retired ruleset. It can only be forfeited.");
  if (g.over || !validAngle(angle)) throw new ShotError(`Aim between ${MIN_ANGLE}° and ${MAX_ANGLE}°.`);
  const game = structuredClone(g);
  const [vx, vy] = launchVector(angle, ruleset);
  return {
    game,
    balls: Array.from({ length: g.balls }, (_, i) => ({ x: g.x, y: GROUND - RADIUS - 0.01, vx, vy, delay: i * 9, done: false })),
    ticks: 0,
    landing: null,
    done: false,
    aborted: false,
    ruleset,
    ballSteps: 0,
    order: game.bricks.slice(),
    cells: buildCells(game.bricks),
  };
}

function touches(ball: Ball, b: Brick, ruleset: number) {
  const r = brickBounds(b);
  const nx = Math.max(r.x, Math.min(ball.x, r.x + r.w));
  const ny = Math.max(r.y, Math.min(ball.y, r.y + r.h));
  const dx = ball.x - nx;
  const dy = ball.y - ny;
  return ruleset >= 3 ? dx * dx + dy * dy <= RADIUS * RADIUS : dx ** 2 + dy ** 2 <= RADIUS ** 2;
}

/**
 * The first live brick, in launch order, that the ball touches. Scanning only
 * the grid cells around the ball returns exactly what a scan of every brick
 * would, because the lowest matching index wins either way.
 */
function firstContact(f: Flight, ball: Ball): Brick | null {
  if (!f.cells) {
    for (const b of f.game.bricks) if (b.hp > 0 && touches(ball, b, f.ruleset)) return b;
    return null;
  }
  const c0 = Math.max(0, Math.floor((ball.x - RADIUS) / CW) - 1);
  const c1 = Math.min(COLS - 1, Math.floor((ball.x + RADIUS) / CW) + 1);
  const r0 = Math.max(0, Math.floor((ball.y - RADIUS) / RH) - 1);
  const r1 = Math.min(ROWS - 1, Math.floor((ball.y + RADIUS) / RH) + 1);
  let best = -1;
  for (let cy = r0; cy <= r1; cy++) {
    for (let col = c0; col <= c1; col++) {
      for (const i of f.cells[cy * COLS + col]) {
        if ((best === -1 || i < best) && f.order[i].hp > 0 && touches(ball, f.order[i], f.ruleset)) best = i;
      }
    }
  }
  return best === -1 ? null : f.order[best];
}

function bounce(ball: Ball, b: Brick, ox: number, oy: number) {
  const r = brickBounds(b);
  if (oy <= r.y - RADIUS + 0.001 && ball.vy > 0) {
    ball.y = r.y - RADIUS;
    ball.vy = -Math.abs(ball.vy);
  } else if (oy >= r.y + r.h + RADIUS - 0.001 && ball.vy < 0) {
    ball.y = r.y + r.h + RADIUS;
    ball.vy = Math.abs(ball.vy);
  } else if (ox < r.x) {
    ball.x = r.x - RADIUS;
    ball.vx = -Math.abs(ball.vx);
  } else if (ox > r.x + r.w) {
    ball.x = r.x + r.w + RADIUS;
    ball.vx = Math.abs(ball.vx);
  } else {
    ball.y = oy;
    ball.vy = -ball.vy;
  }
}

/** Ruleset 5: slowest vertical speed after a corner, so a ball never skims sideways forever (about a launch at 8°). */
const MIN_VY = 0.625;

/** Whether the grid cell holds a live brick. Cells outside the board count as solid walls. */
function solid(f: Flight, col: number, cy: number) {
  if (col < 0 || col >= COLS || cy < 0 || cy >= ROWS) return true;
  for (const i of f.cells![cy * COLS + col]) if (f.order[i].hp > 0) return true;
  return false;
}

/**
 * Ruleset 5 collision response. Sweeps the ball's centre from its previous
 * position against the brick's outline grown by the radius: four flat faces and
 * four quarter circles at the corners. A face flips one axis, as before. A corner
 * is sharp only when neither neighbouring cell next to it holds a brick; there the
 * velocity reflects about the line from the corner to the ball, which can turn it
 * by any amount. Uses Math.sqrt, which ECMAScript specifies as correctly rounded.
 */
function bounceSharp(f: Flight, ball: Ball, b: Brick, ox: number, oy: number) {
  if (!f.cells) return bounce(ball, b, ox, oy);
  const r = brickBounds(b);
  const dx = ball.x - ox;
  const dy = ball.y - oy;
  const left = r.x;
  const right = r.x + r.w;
  const top = r.y;
  const bottom = r.y + r.h;
  let best = 2;
  type Side = "top" | "bottom" | "left" | "right" | "corner";
  let hit = null as Side | null;
  let cornerX = 0;
  let cornerY = 0;
  const face = (t: number, along: number, from: number, to: number, side: Side) => {
    if (t >= 0 && t <= 1 && t < best && along >= from && along <= to) {
      best = t;
      hit = side;
    }
  };
  if (dy > 0) face((top - RADIUS - oy) / dy, ox + dx * ((top - RADIUS - oy) / dy), left, right, "top");
  if (dy < 0) face((bottom + RADIUS - oy) / dy, ox + dx * ((bottom + RADIUS - oy) / dy), left, right, "bottom");
  if (dx > 0) face((left - RADIUS - ox) / dx, oy + dy * ((left - RADIUS - ox) / dx), top, bottom, "left");
  if (dx < 0) face((right + RADIUS - ox) / dx, oy + dy * ((right + RADIUS - ox) / dx), top, bottom, "right");
  const a = dx * dx + dy * dy;
  if (a > 0) {
    for (const cx of [left, right]) {
      for (const cy of [top, bottom]) {
        const fx = ox - cx;
        const fy = oy - cy;
        const half = fx * dx + fy * dy;
        const disc = half * half - a * (fx * fx + fy * fy - RADIUS * RADIUS);
        if (half >= 0 || disc < 0) continue;
        const t = (-half - Math.sqrt(disc)) / a;
        const px = ox + dx * t;
        const py = oy + dy * t;
        // Only the outer quarter of the circle belongs to the corner; the rest lies behind a face.
        const outside = (cx === left ? px <= left : px >= right) && (cy === top ? py <= top : py >= bottom);
        if (t >= 0 && t <= 1 && t < best && outside) {
          best = t;
          hit = "corner";
          cornerX = cx;
          cornerY = cy;
        }
      }
    }
  }
  if (hit === null) return bounce(ball, b, ox, oy);
  if (hit === "corner") {
    const cy = 8 - b.row;
    const side = cornerX === left ? -1 : 1;
    const vertical = cornerY === top ? -1 : 1;
    const besideSolid = solid(f, b.col + side, cy);
    const aboveSolid = solid(f, b.col, cy + vertical);
    if (besideSolid || aboveSolid) {
      // A neighbour continues a face through this corner, so it is not sharp.
      if (besideSolid) {
        ball.y = vertical < 0 ? top - RADIUS : bottom + RADIUS;
        ball.vy = vertical < 0 ? -Math.abs(ball.vy) : Math.abs(ball.vy);
      }
      if (aboveSolid) {
        ball.x = side < 0 ? left - RADIUS : right + RADIUS;
        ball.vx = side < 0 ? -Math.abs(ball.vx) : Math.abs(ball.vx);
      }
      return;
    }
    const px = ox + dx * best;
    const py = oy + dy * best;
    const nx = (px - cornerX) / RADIUS;
    const ny = (py - cornerY) / RADIUS;
    const dot = ball.vx * nx + ball.vy * ny;
    let vx = ball.vx - 2 * dot * nx;
    let vy = ball.vy - 2 * dot * ny;
    if (vy > -MIN_VY && vy < MIN_VY) vy = (vy === 0 ? ny : vy) < 0 ? -MIN_VY : MIN_VY;
    // Keep the ball at its launch speed.
    const vxSquared = SPEED * SPEED - vy * vy;
    vx = (vx < 0 || (vx === 0 && nx < 0) ? -1 : 1) * Math.sqrt(vxSquared > 0 ? vxSquared : 0);
    ball.x = px;
    ball.y = py;
    ball.vx = vx;
    ball.vy = vy;
    return;
  }
  if (hit === "top") {
    ball.y = top - RADIUS;
    ball.vy = -Math.abs(ball.vy);
  } else if (hit === "bottom") {
    ball.y = bottom + RADIUS;
    ball.vy = Math.abs(ball.vy);
  } else if (hit === "left") {
    ball.x = left - RADIUS;
    ball.vx = -Math.abs(ball.vx);
  } else {
    ball.x = right + RADIUS;
    ball.vx = Math.abs(ball.vx);
  }
}

function finishRound(f: Flight) {
  const g = f.game;
  f.done = true;
  g.x = f.landing ?? g.x;
  g.bonus = g.bricks.length === 0;
  g.balls += g.bonus ? 5 : 1;
  for (const b of g.bricks) b.row--;
  g.over = g.bricks.some((b) => b.row <= 1);
  if (!g.over) {
    g.round++;
    spawn(g, f.ruleset);
  }
}

export function step(f: Flight) {
  if (f.done || f.aborted) return;
  if (f.ticks >= MAX_TICKS || (f.ruleset >= 3 && f.ballSteps >= MAX_BALL_STEPS)) {
    f.aborted = true;
    return;
  }
  f.ticks++;
  for (const ball of f.balls) {
    if (ball.done || ball.delay-- > 0) continue;
    f.ballSteps++;
    const ox = ball.x;
    const oy = ball.y;
    ball.x += ball.vx;
    ball.y += ball.vy;
    if (ball.x < RADIUS) {
      ball.x = 2 * RADIUS - ball.x;
      ball.vx = Math.abs(ball.vx);
    }
    if (ball.x > W - RADIUS) {
      ball.x = 2 * (W - RADIUS) - ball.x;
      ball.vx = -Math.abs(ball.vx);
    }
    if (ball.y < RADIUS) {
      ball.y = 2 * RADIUS - ball.y;
      ball.vy = Math.abs(ball.vy);
    }
    if (ball.vy > 0 && ball.y >= GROUND - RADIUS) {
      const t = (GROUND - RADIUS - oy) / (ball.y - oy);
      ball.x = Math.min(W - RADIUS, Math.max(RADIUS, ox + (ball.x - ox) * t));
      ball.y = GROUND;
      ball.done = true;
      if (f.landing === null) f.landing = ball.x;
      continue;
    }
    const brick = firstContact(f, ball);
    if (brick) {
      brick.hp--;
      f.game.score++;
      if (f.ruleset >= 5) bounceSharp(f, ball, brick, ox, oy);
      else bounce(ball, brick, ox, oy);
    }
  }
  f.game.bricks = f.game.bricks.filter((b) => b.hp > 0);
  if (f.balls.every((b) => b.done)) finishRound(f);
}

export function simulate(g: Game, angle: number, ruleset = RULESET) {
  const f = launch(g, angle, ruleset);
  while (!f.done && !f.aborted) step(f);
  if (f.aborted) throw new ShotError("Shot exceeded the simulation limit. Try another angle.");
  return f.game;
}
