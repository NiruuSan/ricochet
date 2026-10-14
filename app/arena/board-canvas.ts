import { brickRect, GROUND, H, W, type Flight, type Game } from "@/lib/engine";
import { themeById, type FontKey, type Theme } from "@/lib/themes";
import { brickLabel, fade, mix, rgba } from "@/lib/colour";
import { drawEffects, hasEffects } from "./board-effects";
import { BRICK_H, BRICK_W, brickPad, hasLiveBrick, hasVariants, isAnimated, paintBrick, paintBrickLive, paintSceneBack, paintSceneLive, VARIANTS, variantAt } from "./board-scenes";

// The board, painted in whatever skin the player wears (lib/themes.ts). Only
// the look comes from the theme: every position on screen is computed from the
// engine's own geometry, so two players on the same board see the same shot.
//
// A frame is cheap whatever the theme. What never moves (the sky, the still
// half of a scene) is painted once into a backdrop at the board's own pixel
// size and copied in one stroke; each brick colour is painted once into a
// sprite; the ball is a sprite too, glow included. Per frame that leaves a few
// dozen copies, the moving half of the scene, the numbers and the particles.

/** The most pixels a board is drawn with, per board unit. Past this the gain is invisible and the cost is not. */
const MAX_SCALE = 3;

/**
 * Matches the pixels the board is drawn with to the size it is shown at, so a
 * board scaled up to fill a phone or a tablet stays sharp. Everything else here
 * draws in board units (W x H) and the transform does the rest.
 */
function fitToDisplay(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) {
  const shown = canvas.clientWidth || W;
  const density = Math.min(MAX_SCALE, Math.max(1, (shown / W) * (window.devicePixelRatio || 1)));
  const width = Math.round(W * density);
  // The two sides stay in proportion, so the height CSS derives from them does not move.
  if (canvas.width !== width) {
    canvas.width = width;
    canvas.height = Math.round(H * density);
  }
  ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
}

/** The colour pair a brick is painted in: its column and the round, as before. */
export const brickColours = (theme: Theme, col: number, round: number) => theme.board.bricks[(col + round - 1) % theme.board.bricks.length];

// ------------------------------------------------------------------ caches

/** A small cache that forgets what was used longest ago. */
function lru<T>(limit: number) {
  const map = new Map<string, T>();
  return (key: string, make: () => T): T => {
    const found = map.get(key);
    if (found !== undefined) {
      map.delete(key);
      map.set(key, found);
      return found;
    }
    const made = make();
    map.set(key, made);
    if (map.size > limit) map.delete(map.keys().next().value!);
    return made;
  };
}

const offscreen = (w: number, h: number) => {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
};

/** A few boards' worth: the one being played, a card being looked at, a final board. */
const backdrops = lru<HTMLCanvasElement>(4);

/** Everything behind the bricks that never moves, at the board's own pixel size. */
function backdrop(theme: Theme, width: number, height: number) {
  return backdrops(`${theme.id}:${width}x${height}`, () => {
    const c = offscreen(width, height);
    const ctx = c.getContext("2d")!;
    ctx.setTransform(width / W, 0, 0, height / H, 0, 0);
    const [top, bottom] = theme.board.sky;
    if (top === bottom) {
      ctx.fillStyle = top;
    } else {
      const sky = ctx.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, top);
      sky.addColorStop(1, bottom);
      ctx.fillStyle = sky;
    }
    ctx.fillRect(0, 0, W, H);
    // The floor goes down first, so a scene may paint across it (a road, a drift of snow).
    ctx.fillStyle = theme.board.floor;
    ctx.fillRect(0, GROUND + 1, W, H - GROUND);
    if (theme.board.scene) paintSceneBack(ctx, theme);
    if (theme.board.dots) {
      ctx.fillStyle = theme.board.dots;
      for (let x = 18; x < W; x += 23) {
        for (let y = 16; y < GROUND; y += 23) {
          ctx.beginPath();
          ctx.arc(x, y, 1, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.strokeStyle = theme.board.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, GROUND);
    ctx.lineTo(W, GROUND);
    ctx.stroke();
    return c;
  });
}

type Sprite = { canvas: HTMLCanvasElement; pad: number; label: { colour: string; outline: number } };
/** Six colours, a few cuts, a couple of themes and sizes on screen at once. */
const sprites = lru<Sprite>(96);

/** One brick, painted once at the size it is shown at, with the colour its number is written in. */
function brickSprite(theme: Theme, face: string, shade: string, variant: number, density: number): Sprite {
  return sprites(`${theme.id}|${face}|${shade}|${variant}|${density.toFixed(3)}`, () => {
    const pad = brickPad(theme);
    const c = offscreen((BRICK_W + pad * 2) * density, (BRICK_H + pad * 2) * density);
    const ctx = c.getContext("2d")!;
    ctx.setTransform(density, 0, 0, density, 0, 0);
    paintBrick(ctx, theme, { x: pad, y: pad, w: BRICK_W, h: BRICK_H }, face, shade, variant);
    return { canvas: c, pad, label: brickLabel(theme, face, shade) };
  });
}

const balls = lru<HTMLCanvasElement>(8);
/** The ball, glow and all, at radius 6: drawn once per theme and size, stamped every frame. */
function ballSprite(theme: Theme, density: number) {
  return balls(`${theme.id}|${density.toFixed(3)}`, () => {
    const reach = 15;
    const c = offscreen(reach * 2 * density, reach * 2 * density);
    const ctx = c.getContext("2d")!;
    ctx.setTransform(density, 0, 0, density, 0, 0);
    const r = 6;
    if (rgba(theme.board.glow)[3] > 0) {
      const halo = ctx.createRadialGradient(reach, reach, r * 0.6, reach, reach, reach);
      halo.addColorStop(0, fade(theme.board.glow, 0.55));
      halo.addColorStop(1, fade(theme.board.glow, 0));
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, reach * 2, reach * 2);
    }
    // A thin rim in the sky's own darkness, so the ball still reads over a pale brick.
    ctx.fillStyle = mix(theme.board.sky[0], "#000000", 0.4, 0.45);
    ctx.beginPath();
    ctx.arc(reach, reach, r + 0.9, 0, Math.PI * 2);
    ctx.fill();
    if (theme.board.orb) {
      const orb = ctx.createRadialGradient(reach - r * 0.35, reach - r * 0.4, r * 0.1, reach, reach, r);
      orb.addColorStop(0, "#ffffff");
      orb.addColorStop(0.45, theme.board.ball);
      orb.addColorStop(1, mix(theme.board.ball, theme.board.glow, 0.55, 1));
      ctx.fillStyle = orb;
    } else {
      ctx.fillStyle = theme.board.ball;
    }
    ctx.beginPath();
    ctx.arc(reach, reach, r, 0, Math.PI * 2);
    ctx.fill();
    return c;
  });
}

// ------------------------------------------------------------------- fonts

/**
 * How each typeface writes a brick's number: its CSS variable (from
 * app/layout.tsx), a fallback for before it arrives, and a size that keeps a
 * three-digit number inside the brick. The ball count below the line follows.
 */
const FONTS: Record<FontKey, { variable: string | null; fallback: string; weight: number; size: number; count: number; nudge: number }> = {
  system: { variable: null, fallback: "Arial, Helvetica, sans-serif", weight: 800, size: 21, count: 12, nudge: -1 },
  orbitron: { variable: "--font-orbitron", fallback: "Arial, sans-serif", weight: 800, size: 18, count: 10, nudge: 0 },
  pixel: { variable: "--font-pixel", fallback: "ui-monospace, monospace", weight: 400, size: 13, count: 8, nudge: 1 },
  serif: { variable: "--font-serif", fallback: "Georgia, serif", weight: 700, size: 21, count: 12, nudge: 0 },
  mono: { variable: "--font-mono", fallback: "ui-monospace, monospace", weight: 400, size: 31, count: 18, nudge: 0 },
  round: { variable: "--font-round", fallback: "Arial, sans-serif", weight: 600, size: 23, count: 13, nudge: -1 },
};
const families = new Map<FontKey, string>();
const ready = new Set<FontKey>();
/** Boards painted while their typeface was still on its way, to paint again once it lands. */
const waiting = new Map<HTMLCanvasElement, () => void>();

/** The font family to write in, and whether it is the real one yet. */
function family(key: FontKey): { family: string; final: boolean } {
  const font = FONTS[key];
  if (!font.variable) return { family: font.fallback, final: true };
  if (!families.has(key)) {
    const named = getComputedStyle(document.documentElement).getPropertyValue(font.variable).trim();
    families.set(key, named ? `${named}, ${font.fallback}` : font.fallback);
    if (!named || !document.fonts) {
      ready.add(key);
    } else {
      const spec = `${font.weight} ${font.size}px ${named}`;
      if (document.fonts.check(spec, "0123456789")) ready.add(key);
      else
        void document.fonts.load(spec, "0123456789×").then(
          () => {
            ready.add(key);
            const redraw = [...waiting.values()];
            waiting.clear();
            for (const paint of redraw) paint();
          },
          () => ready.add(key),
        );
    }
  }
  return { family: ready.has(key) ? families.get(key)! : font.fallback, final: ready.has(key) };
}

// ------------------------------------------------------------------- board

/**
 * Paints the board: the live flight while a shot animates, otherwise the aim
 * guide (none for spectators: `angle` null). `time` is what a moving scene is
 * painted at, in seconds.
 */
export function drawBoard(canvas: HTMLCanvasElement, flight: Flight | null, game: Game, angle: number | null, skin?: Theme | string | null, time = performance.now() / 1000) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const theme = typeof skin === "object" && skin ? skin : themeById(typeof skin === "string" ? skin : null);
  fitToDisplay(canvas, ctx);
  const sx = canvas.width / W;
  const sy = canvas.height / H;
  const g = flight?.game ?? game;
  const font = family(theme.board.font);
  if (!font.final) waiting.set(canvas, () => canvas.isConnected && drawBoard(canvas, flight, game, angle, theme, time));

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(backdrop(theme, canvas.width, canvas.height), 0, 0);
  ctx.setTransform(sx, 0, 0, sy, 0, 0);
  if (isAnimated(theme)) paintSceneLive(ctx, theme, time);

  // The bricks, stamped in device pixels so a sprite lands on whole pixels.
  const labels: [number, ReturnType<typeof brickRect>, Sprite][] = [];
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  for (const b of g.bricks) {
    const r = brickRect(b);
    const [face, shade] = brickColours(theme, b.col, g.round);
    const sprite = brickSprite(theme, face, shade, hasVariants(theme) ? variantAt(b.col * 7, b.row * 13) % VARIANTS : 0, sx);
    ctx.drawImage(sprite.canvas, Math.round((r.x - sprite.pad) * sx), Math.round((r.y - sprite.pad) * sy));
    labels.push([b.hp, r, sprite]);
  }
  ctx.setTransform(sx, 0, 0, sy, 0, 0);
  if (hasLiveBrick(theme)) for (const [, r] of labels) paintBrickLive(ctx, theme, r, time);
  writeLabels(ctx, theme, font.family, labels);

  if (flight) drawFlight(ctx, flight, theme, sx);
  else if (!g.over) drawAim(ctx, g, angle, theme, font.family, sx);
  if (hasEffects()) drawEffects(ctx, performance.now());
}

/** The hits each brick has left, in the middle of it, in the theme's typeface. */
function writeLabels(ctx: CanvasRenderingContext2D, theme: Theme, typeface: string, labels: [number, { x: number; y: number; w: number; h: number }, Sprite][]) {
  const font = FONTS[theme.board.font];
  ctx.font = `${font.weight} ${font.size}px ${typeface}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  const neon = theme.board.brick === "neon";
  for (const [hp, r, { label }] of labels) {
    const text = String(hp);
    const x = r.x + r.w / 2;
    const y = r.y + r.h / 2 - 1 + font.nudge;
    const max = r.w - 8;
    if (label.outline) {
      ctx.strokeStyle = `rgba(0,0,0,${label.outline})`;
      ctx.lineWidth = 4.5;
      ctx.strokeText(text, x, y, max);
    } else if (neon) {
      // A number drawn in light: a soft halo, then the hot core.
      ctx.strokeStyle = fade(label.colour, 0.3);
      ctx.lineWidth = 4;
      ctx.strokeText(text, x, y, max);
    }
    ctx.fillStyle = label.colour;
    ctx.fillText(text, x, y, max);
  }
  ctx.textBaseline = "alphabetic";
  ctx.lineJoin = "miter";
}

function drawFlight(ctx: CanvasRenderingContext2D, flight: Flight, theme: Theme, density: number) {
  const live = flight.balls.filter((b) => !b.done && b.delay <= 0);
  const trail = theme.effects.trail;
  if (trail === "dots") {
    // Three fading copies laid back along the way each ball came, one path per copy.
    ctx.fillStyle = theme.board.glow;
    for (let i = 3; i >= 1; i--) {
      ctx.globalAlpha = 0.1 * i;
      ctx.beginPath();
      for (const b of live) {
        const x = b.x - b.vx * i * 1.6;
        const y = b.y - b.vy * i * 1.6;
        ctx.moveTo(x + 5 - i * 0.9, y);
        ctx.arc(x, y, 5 - i * 0.9, 0, Math.PI * 2);
      }
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  } else if (trail === "comet") {
    // A tail streaming back from every ball: a wide faint stroke under a bright narrow one.
    ctx.lineCap = "round";
    ctx.strokeStyle = theme.board.glow;
    for (const [width, alpha, length] of [
      [7, 0.16, 7],
      [3, 0.45, 4.5],
    ]) {
      ctx.globalAlpha = alpha;
      ctx.lineWidth = width;
      ctx.beginPath();
      for (const b of live) {
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(b.x - b.vx * length, b.y - b.vy * length);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.lineCap = "butt";
  }
  const sprite = ballSprite(theme, density);
  // The sprite is a ball of radius 6 in a 30-unit square; a flying ball is radius 5.
  const size = 30 * (5 / 6);
  for (const b of live) ctx.drawImage(sprite, b.x - size / 2, b.y - size / 2, size, size);
  if (flight.landing !== null) ctx.drawImage(sprite, flight.landing - size / 2, GROUND - 5 - size / 2, size, size);
}

// The dotted guide is decorative only, so native trigonometry is fine here.
function drawAim(ctx: CanvasRenderingContext2D, g: Game, angle: number | null, theme: Theme, typeface: string, density: number) {
  if (angle !== null) drawGuide(ctx, g, angle, theme);
  // The ball waiting on the line is the same ball that will fly, a little larger.
  ctx.drawImage(ballSprite(theme, density), g.x - 15, GROUND - 6 - 15, 30, 30);
  const font = FONTS[theme.board.font];
  ctx.fillStyle = theme.ui.ink;
  ctx.font = `${Math.min(700, font.weight)} ${font.count}px ${typeface}`;
  ctx.textAlign = "center";
  ctx.fillText(`×${g.balls}`, Math.max(22, Math.min(W - 22, g.x)), GROUND + 23);
}

function drawGuide(ctx: CanvasRenderingContext2D, g: Game, angle: number, theme: Theme) {
  const rad = (angle * Math.PI) / 180;
  let x = g.x;
  let y = GROUND - 6;
  let dx = Math.cos(rad) * 12;
  let dy = -Math.sin(rad) * 12;
  for (let i = 0; i < 27; i++) {
    x += dx;
    y += dy;
    if (x < 5 || x > W - 5) {
      dx = -dx;
      x = Math.max(5, Math.min(W - 5, x));
    }
    if (y < 5) {
      dy = -dy;
      y = 5;
    }
    ctx.beginPath();
    ctx.arc(x, y, i === 26 ? 3 : 1.8, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${theme.board.aim},${0.7 - i * 0.02})`;
    ctx.fill();
  }
}

