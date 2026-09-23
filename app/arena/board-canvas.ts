import { brickRect, GROUND, H, W, type Flight, type Game } from "@/lib/engine";
import { themeById, type Theme } from "@/lib/themes";
import { drawEffects, hasEffects } from "./board-effects";

// The board, painted in whatever skin the player wears (lib/themes.ts). Only
// the look comes from the theme: every position on screen is computed from the
// engine's own geometry, so two players on the same board see the same shot.

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

/** Paints the board: the live flight while a shot animates, otherwise the aim guide (none for spectators: `angle` null). */
export function drawBoard(canvas: HTMLCanvasElement, flight: Flight | null, game: Game, angle: number | null, skin?: Theme | string | null) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const theme = typeof skin === "object" && skin ? skin : themeById(typeof skin === "string" ? skin : null);
  fitToDisplay(canvas, ctx);
  const g = flight?.game ?? game;
  drawBackground(ctx, theme);
  for (const b of g.bricks) {
    const r = brickRect(b);
    const [face, shade] = brickColours(theme, b.col, g.round);
    const radius = theme.board.radius;
    ctx.fillStyle = shade;
    ctx.beginPath();
    ctx.roundRect(r.x, r.y + 4, r.w, r.h, radius);
    ctx.fill();
    ctx.fillStyle = face;
    ctx.beginPath();
    ctx.roundRect(r.x, r.y, r.w, r.h - 2, radius);
    ctx.fill();
    if (theme.board.stroke) {
      ctx.strokeStyle = theme.board.stroke;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    if (theme.board.shine) {
      ctx.fillStyle = theme.board.shine;
      ctx.fillRect(r.x + 8, r.y + 5, r.w - 16, 2);
    }
    ctx.fillStyle = theme.board.label;
    ctx.font = `800 21px ${labelFont(theme)}`;
    ctx.textBaseline = "middle";
    ctx.fillText(String(b.hp), r.x + r.w / 2, r.y + r.h / 2 - 1);
    ctx.textBaseline = "alphabetic";
  }
  if (flight) drawFlight(ctx, flight, theme);
  else if (!g.over) drawAim(ctx, g, angle, theme);
  if (hasEffects()) drawEffects(ctx, performance.now());
}

/** The number on a brick follows the theme's typeface, but never at a size that hides it. */
function labelFont(theme: Theme) {
  switch (theme.ui.font) {
    case "mono":
      return "ui-monospace, monospace";
    case "pixel":
      return "ui-monospace, monospace";
    case "serif":
      return "Georgia, serif";
    default:
      return "Arial";
  }
}

function drawBackground(ctx: CanvasRenderingContext2D, theme: Theme) {
  const [top, bottom] = theme.board.sky;
  ctx.clearRect(0, 0, W, H);
  if (top === bottom) {
    ctx.fillStyle = top;
  } else {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, top);
    sky.addColorStop(1, bottom);
    ctx.fillStyle = sky;
  }
  ctx.fillRect(0, 0, W, H);
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
  ctx.textAlign = "center";
  ctx.strokeStyle = theme.board.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, GROUND);
  ctx.lineTo(W, GROUND);
  ctx.stroke();
  ctx.fillStyle = theme.board.floor;
  ctx.fillRect(0, GROUND + 1, W, H - GROUND);
}

function drawFlight(ctx: CanvasRenderingContext2D, flight: Flight, theme: Theme) {
  for (const b of flight.balls) {
    if (b.done || b.delay > 0) continue;
    // A trail is three fading copies laid back along the way the ball came.
    if (theme.effects.trail) {
      for (let i = 3; i >= 1; i--) {
        ctx.globalAlpha = 0.1 * i;
        ctx.beginPath();
        ctx.arc(b.x - b.vx * i * 1.6, b.y - b.vy * i * 1.6, 5 - i * 0.9, 0, Math.PI * 2);
        ctx.fillStyle = theme.board.glow;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    ctx.beginPath();
    ctx.arc(b.x, b.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = theme.board.ball;
    ctx.shadowColor = theme.board.glow;
    ctx.shadowBlur = 9;
    ctx.fill();
    ctx.shadowBlur = 0;
  }
  if (flight.landing !== null) {
    ctx.fillStyle = theme.board.ball;
    ctx.beginPath();
    ctx.arc(flight.landing, GROUND - 5, 5, 0, Math.PI * 2);
    ctx.fill();
  }
}

// The dotted guide is decorative only, so native trigonometry is fine here.
function drawAim(ctx: CanvasRenderingContext2D, g: Game, angle: number | null, theme: Theme) {
  if (angle !== null) drawGuide(ctx, g, angle, theme);
  // The ball waiting on the line is the same ball that will fly: same colour,
  // same size, with the theme's glow behind it when it has one.
  ctx.beginPath();
  ctx.arc(g.x, GROUND - 6, 6, 0, Math.PI * 2);
  ctx.fillStyle = theme.board.ball;
  ctx.shadowBlur = 18;
  ctx.shadowColor = theme.board.glow;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = theme.ui.ink;
  ctx.font = `600 12px ${labelFont(theme)}`;
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
    ctx.fillStyle = `rgba(${theme.board.aim},${0.65 - i * 0.019})`;
    ctx.fill();
  }
}
