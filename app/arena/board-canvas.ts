import { brickRect, GROUND, H, W, type Flight, type Game } from "@/lib/engine";

const BRICK_PALETTE = [
  ["#bb8cff", "#8260b7"],
  ["#68d9d6", "#368887"],
  ["#ffd17b", "#a58042"],
  ["#9fccfc", "#5b7fac"],
  ["#fa98b4", "#9b536c"],
  ["#c6f564", "#809e3e"],
];

/** Paints the board: the live flight while a shot animates, otherwise the aim guide (none for spectators: `angle` null). */
export function drawBoard(canvas: HTMLCanvasElement, flight: Flight | null, game: Game, angle: number | null) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const g = flight?.game ?? game;
  drawBackground(ctx);
  for (const b of g.bricks) {
    const r = brickRect(b);
    const [face, shade] = BRICK_PALETTE[(b.col + g.round - 1) % BRICK_PALETTE.length];
    ctx.fillStyle = shade;
    ctx.beginPath();
    ctx.roundRect(r.x, r.y + 4, r.w, r.h, 7);
    ctx.fill();
    ctx.fillStyle = face;
    ctx.beginPath();
    ctx.roundRect(r.x, r.y, r.w, r.h - 2, 7);
    ctx.fill();
    ctx.fillStyle = "#ffffff38";
    ctx.fillRect(r.x + 8, r.y + 5, r.w - 16, 2);
    ctx.fillStyle = "#162238";
    ctx.font = "800 21px Arial";
    ctx.textBaseline = "middle";
    ctx.fillText(String(b.hp), r.x + r.w / 2, r.y + r.h / 2 - 1);
    ctx.textBaseline = "alphabetic";
  }
  if (flight) drawFlight(ctx, flight);
  else if (!g.over) drawAim(ctx, g, angle);
}

function drawBackground(ctx: CanvasRenderingContext2D) {
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#0c1422";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#263247";
  for (let x = 18; x < W; x += 23) {
    for (let y = 16; y < GROUND; y += 23) {
      ctx.beginPath();
      ctx.arc(x, y, 1, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.textAlign = "center";
  ctx.strokeStyle = "#29374b";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, GROUND);
  ctx.lineTo(W, GROUND);
  ctx.stroke();
  ctx.fillStyle = "#111d2d";
  ctx.fillRect(0, GROUND + 1, W, H - GROUND);
}

function drawFlight(ctx: CanvasRenderingContext2D, flight: Flight) {
  for (const b of flight.balls) {
    if (b.done || b.delay > 0) continue;
    ctx.beginPath();
    ctx.arc(b.x, b.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = "#ddffab";
    ctx.shadowColor = "#c6f564";
    ctx.shadowBlur = 9;
    ctx.fill();
    ctx.shadowBlur = 0;
  }
  if (flight.landing !== null) {
    ctx.fillStyle = "#c6f564";
    ctx.beginPath();
    ctx.arc(flight.landing, GROUND - 5, 5, 0, Math.PI * 2);
    ctx.fill();
  }
}

// The dotted guide is decorative only, so native trigonometry is fine here.
function drawAim(ctx: CanvasRenderingContext2D, g: Game, angle: number | null) {
  if (angle !== null) drawGuide(ctx, g, angle);
  ctx.beginPath();
  ctx.arc(g.x, GROUND - 6, 6, 0, Math.PI * 2);
  ctx.fillStyle = "#c6f564";
  ctx.shadowBlur = 18;
  ctx.shadowColor = "#c6f564";
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#d8e6fa";
  ctx.font = "600 12px Arial";
  ctx.fillText(`×${g.balls}`, Math.max(22, Math.min(W - 22, g.x)), GROUND + 23);
}

function drawGuide(ctx: CanvasRenderingContext2D, g: Game, angle: number) {
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
    ctx.fillStyle = `rgba(198,245,100,${0.65 - i * 0.019})`;
    ctx.fill();
  }
}
