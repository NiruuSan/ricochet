import { GROUND, H, W } from "@/lib/engine";
import type { Scene, Theme } from "@/lib/themes";

// The pictures behind the bricks, and bricks with depth.
//
// Like everything a theme paints, none of this is read by the engine: a scene
// sits behind the bricks and the ball, and a brick style draws inside the very
// rectangle the engine gives it. Scenes that move are painted from the time
// alone, so the same moment always looks the same and nothing accumulates.

/** Scenes that move, and so want painting while the board is idle. */
const MOVING: Record<Scene, boolean> = {
  stars: true,
  aurora: true,
  outrun: true,
  ink: false,
  snow: true,
  cave: true,
  felt: true,
  pulse: true,
  candy: false,
};
export const isAnimated = (theme: Theme) => !!theme.board.scene && MOVING[theme.board.scene];

// ---------------------------------------------------------------- colours

const parsed = new Map<string, [number, number, number, number]>();
/** `#rgb`, `#rrggbb` or `#rrggbbaa` as channels, alpha 0–1. */
function rgba(hex: string): [number, number, number, number] {
  const known = parsed.get(hex);
  if (known) return known;
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  const value: [number, number, number, number] = [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
    h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
  ];
  parsed.set(hex, value);
  return value;
}
/** `hex` moved `amount` of the way to `to`, at its own opacity unless `alpha` is given. */
export function mix(hex: string, to: string, amount: number, alpha?: number) {
  const [r, g, b, a] = rgba(hex);
  const [r2, g2, b2] = rgba(to);
  const m = (x: number, y: number) => Math.round(x + (y - x) * amount);
  return `rgba(${m(r, r2)},${m(g, g2)},${m(b, b2)},${alpha ?? a})`;
}
/** The colour at another opacity. */
export const fade = (hex: string, alpha: number) => mix(hex, hex, 0, alpha);

// ------------------------------------------------------- fixed randomness

/** The same "random" layout every time: a scene must not reshuffle between frames. */
function seeded(seed: number) {
  let s = seed >>> 0 || 1;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
}
const layouts = new Map<string, number[][]>();
function layout(key: string, count: number, make: (r: () => number) => number[]) {
  let found = layouts.get(key);
  if (!found) {
    const r = seeded([...key].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261));
    found = Array.from({ length: count }, () => make(r));
    layouts.set(key, found);
  }
  return found;
}
/** A stable number for a cell, for per-brick variety that does not flicker. */
const cellHash = (x: number, y: number) => {
  const h = Math.imul(Math.round(x) * 374761393 + Math.round(y) * 668265263, 1274126177) >>> 0;
  return (h % 10_000) / 10_000;
};

/** A four-pointed glint. */
function sparkle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.quadraticCurveTo(x, y, x, y + r);
  ctx.quadraticCurveTo(x, y, x - r, y);
  ctx.quadraticCurveTo(x, y, x, y - r);
  ctx.fill();
}

// ------------------------------------------------------------------ scenes

/** Paints the theme's scene over the sky and the floor, before the bricks. */
export function drawScene(ctx: CanvasRenderingContext2D, theme: Theme, t: number) {
  switch (theme.board.scene) {
    case "stars":
      return starfield(ctx, "stars", 90, 1, t);
    case "aurora":
      return aurora(ctx, theme, t);
    case "outrun":
      return outrun(ctx, theme, t);
    case "ink":
      return ink(ctx);
    case "snow":
      return snow(ctx, t);
    case "cave":
      return cave(ctx, theme, t);
    case "felt":
      return felt(ctx, theme, t);
    case "pulse":
      return pulse(ctx, t);
    case "candy":
      return candy(ctx, theme);
  }
}

function starfield(ctx: CanvasRenderingContext2D, key: string, count: number, brightness: number, t: number, bottom = GROUND - 30) {
  const stars = layout(key, count, (r) => [r() * W, r() * bottom, 0.35 + r() * 1.1, r() * 6.28, 0.6 + r() * 1.8]);
  ctx.fillStyle = "#ffffff";
  for (const [x, y, size, phase, speed] of stars) {
    ctx.globalAlpha = brightness * (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * speed + phase))) * (0.4 + size / 2);
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
    if (size > 1.25) sparkle(ctx, x, y, size * 3);
  }
  ctx.globalAlpha = 1;
}

/** Curtains of light, drawn as thin columns that fade upwards, over a ridge. */
function aurora(ctx: CanvasRenderingContext2D, theme: Theme, t: number) {
  starfield(ctx, "aurora", 80, 0.8, t);
  const colours = ["#5cffc6", "#8f7cff", "#3ad6ff"];
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  colours.forEach((colour, k) => {
    const curtain = ctx.createLinearGradient(0, 0, 0, 1);
    curtain.addColorStop(0, fade(colour, 0));
    curtain.addColorStop(0.55, fade(colour, 0.7));
    curtain.addColorStop(1, fade(colour, 0));
    ctx.fillStyle = curtain;
    for (let x = 0; x < W; x += 3) {
      const top = 70 + k * 46 + Math.sin(x * 0.011 + t * 0.22 + k * 1.7) * 30 + Math.sin(x * 0.029 - t * 0.37 + k) * 10;
      const height = 150 + Math.sin(x * 0.019 + t * 0.5 + k * 2.1) * 55;
      ctx.globalAlpha = Math.max(0, 0.26 + 0.14 * Math.sin(x * 0.034 + t * 0.8 + k * 3) + 0.06 * Math.sin(x * 0.11 - t * 1.3));
      ctx.save();
      ctx.translate(x, top);
      ctx.scale(1, height);
      ctx.fillRect(0, 0, 3.2, 1);
      ctx.restore();
    }
  });
  ctx.restore();
  // The ridge, dark against the light, just above the line the balls leave from.
  ridge(ctx, "aurora-far", GROUND - 70, 34, mix(theme.board.sky[1], "#000000", 0.25));
  ridge(ctx, "aurora-near", GROUND - 30, 26, mix(theme.board.floor, "#000000", 0.2));
}

/** A line of hills from `base` up to `height` higher, filled down to the ground. */
function ridge(ctx: CanvasRenderingContext2D, key: string, base: number, height: number, colour: string) {
  const [[a, b, c]] = layout(key, 1, (r) => [r() * 6, r() * 6, r() * 6]);
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.moveTo(0, GROUND);
  for (let x = 0; x <= W; x += 6) {
    const y = base - height * (0.5 + 0.28 * Math.sin(x * 0.013 + a) + 0.16 * Math.sin(x * 0.037 + b) + 0.06 * Math.sin(x * 0.11 + c));
    ctx.lineTo(x, y);
  }
  ctx.lineTo(W, GROUND);
  ctx.closePath();
  ctx.fill();
}

/** A striped sun sinking into a grid that runs towards you. */
function outrun(ctx: CanvasRenderingContext2D, theme: Theme, t: number) {
  const horizon = 392;
  starfield(ctx, "outrun", 50, 0.7, t, horizon - 120);
  const cx = W / 2;
  const radius = 118;
  // The glow, then the sun, cut by bands that thicken towards the horizon.
  const glow = ctx.createRadialGradient(cx, horizon - 40, 20, cx, horizon - 40, 230);
  glow.addColorStop(0, "rgba(255,43,214,0.35)");
  glow.addColorStop(1, "rgba(255,43,214,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, horizon - 270, W, 270);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, W, horizon);
  for (let i = 0; i < 7; i++) {
    const y = horizon - 8 - i * i * 2.6 - i * 7;
    const gap = Math.max(1.2, 7 - i * 0.95);
    ctx.rect(W, y, -W, gap);
  }
  ctx.clip("evenodd");
  const sun = ctx.createLinearGradient(0, horizon - radius, 0, horizon);
  sun.addColorStop(0, "#ffe259");
  sun.addColorStop(0.55, "#ff7a3d");
  sun.addColorStop(1, "#ff2bd6");
  ctx.fillStyle = sun;
  ctx.beginPath();
  ctx.arc(cx, horizon, radius, Math.PI, 0);
  ctx.fill();
  ctx.restore();
  // The ground plane: dark, then the grid scrolling in from the horizon.
  const plane = ctx.createLinearGradient(0, horizon, 0, H);
  plane.addColorStop(0, "#1a0336");
  plane.addColorStop(1, "#090014");
  ctx.fillStyle = plane;
  ctx.fillRect(0, horizon, W, H - horizon);
  ctx.strokeStyle = theme.board.line;
  ctx.lineWidth = 1;
  const scroll = (t * 0.45) % 1;
  for (let i = 0; i < 14; i++) {
    const p = (i + scroll) / 14;
    const y = horizon + (H - horizon) * Math.pow(p, 2.1);
    ctx.globalAlpha = 0.15 + 0.6 * p;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
  for (let k = -9; k <= 9; k++) {
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    ctx.moveTo(cx + k * 9, horizon);
    ctx.lineTo(cx + k * 78, H);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // The horizon itself, burning.
  const line = ctx.createLinearGradient(0, 0, W, 0);
  line.addColorStop(0, "rgba(255,43,214,0)");
  line.addColorStop(0.5, "rgba(255,180,240,0.95)");
  line.addColorStop(1, "rgba(255,43,214,0)");
  ctx.fillStyle = line;
  ctx.fillRect(0, horizon - 1, W, 2);
}

/** Rice paper, a red sun and mountains washed in grey. */
function ink(ctx: CanvasRenderingContext2D) {
  const specks = layout("ink-paper", 260, (r) => [r() * W, r() * H, r() * 1.2 + 0.2, r()]);
  for (const [x, y, size, tone] of specks) {
    ctx.fillStyle = tone > 0.5 ? "rgba(90,70,40,0.08)" : "rgba(255,255,255,0.35)";
    ctx.fillRect(x, y, size, size);
  }
  const sun = ctx.createRadialGradient(W * 0.72, 150, 50, W * 0.72, 150, 66);
  sun.addColorStop(0, "rgba(184,49,47,0.88)");
  sun.addColorStop(1, "rgba(184,49,47,0)");
  ctx.fillStyle = sun;
  ctx.beginPath();
  ctx.arc(W * 0.72, 150, 66, 0, Math.PI * 2);
  ctx.fill();
  const layers: [string, number, number, number][] = [
    ["ink-far", 330, 110, 0.07],
    ["ink-mid", 410, 120, 0.11],
    ["ink-near", 490, 90, 0.17],
  ];
  for (const [key, base, height, alpha] of layers) {
    const [[a, b, c]] = layout(key, 1, (r) => [r() * 6, r() * 6, r() * 6]);
    const wash = ctx.createLinearGradient(0, base - height, 0, base + 90);
    wash.addColorStop(0, `rgba(40,32,26,${alpha})`);
    wash.addColorStop(1, "rgba(40,32,26,0)");
    ctx.fillStyle = wash;
    ctx.beginPath();
    ctx.moveTo(0, GROUND);
    for (let x = 0; x <= W; x += 4) {
      const peak = Math.pow(Math.abs(Math.sin(x * 0.009 + a)), 1.6);
      const y = base - height * (0.25 + 0.6 * peak + 0.1 * Math.sin(x * 0.05 + b) + 0.05 * Math.sin(x * 0.17 + c));
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W, GROUND);
    ctx.closePath();
    ctx.fill();
  }
}

/** A moon behind the cloud and snow drifting down past it. */
function snow(ctx: CanvasRenderingContext2D, t: number) {
  const moon = ctx.createRadialGradient(92, 96, 8, 92, 96, 150);
  moon.addColorStop(0, "rgba(230,245,255,0.55)");
  moon.addColorStop(0.18, "rgba(200,230,255,0.18)");
  moon.addColorStop(1, "rgba(200,230,255,0)");
  ctx.fillStyle = moon;
  ctx.fillRect(0, 0, W, 300);
  ctx.fillStyle = "rgba(240,250,255,0.9)";
  ctx.beginPath();
  ctx.arc(92, 96, 22, 0, Math.PI * 2);
  ctx.fill();
  const flakes = layout("snow", 110, (r) => [r() * W, r() * GROUND, 0.6 + r() * 2.2, 10 + r() * 30, r() * 6.28]);
  ctx.fillStyle = "#ffffff";
  for (const [x, y, size, speed, phase] of flakes) {
    const fy = (y + t * speed) % GROUND;
    const fx = x + Math.sin(t * 0.7 + phase) * 9;
    ctx.globalAlpha = 0.25 + size * 0.22;
    ctx.beginPath();
    ctx.arc(fx, fy, size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // Drifts along the ground.
  ridge(ctx, "snow-drift", GROUND - 8, 22, "rgba(220,240,255,0.10)");
}

/** Light pooled in the dark and crystals growing from the corners. */
function cave(ctx: CanvasRenderingContext2D, theme: Theme, t: number) {
  const pools: [number, number, number, string][] = [
    [70, 110, 190, "#9b5de5"],
    [420, 280, 200, "#06d6a0"],
    [170, 470, 170, "#3a86ff"],
  ];
  for (const [x, y, r, colour] of pools) {
    const pool = ctx.createRadialGradient(x, y, 0, x, y, r);
    pool.addColorStop(0, fade(colour, 0.2 + 0.05 * Math.sin(t * 0.6 + x)));
    pool.addColorStop(1, fade(colour, 0));
    ctx.fillStyle = pool;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // Crystal clusters at the foot of each wall.
  const clusters: [number, number][] = [
    [0, 1],
    [W, -1],
  ];
  for (const [x0, dir] of clusters) {
    const spikes = layout(`cave-${dir}`, 6, (r) => [r() * 70, 40 + r() * 110, 10 + r() * 14, (r() - 0.5) * 0.5, Math.floor(r() * 6)]);
    for (const [offset, height, width, lean, tone] of spikes) {
      const bx = x0 + dir * offset;
      const [face] = theme.board.bricks[tone];
      const tip = { x: bx + dir * lean * height, y: GROUND - height };
      const body = ctx.createLinearGradient(bx, GROUND, tip.x, tip.y);
      body.addColorStop(0, fade(face, 0.05));
      body.addColorStop(1, fade(face, 0.55));
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.moveTo(bx - width / 2, GROUND);
      ctx.lineTo(tip.x, tip.y);
      ctx.lineTo(bx + width / 2, GROUND);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = fade(face, 0.6);
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(bx, GROUND);
      ctx.lineTo(tip.x, tip.y);
      ctx.stroke();
    }
  }
  // Glints that catch the light now and then.
  const glints = layout("cave-glints", 34, (r) => [r() * W, r() * (GROUND - 20), 1.5 + r() * 3, r() * 6.28, 0.5 + r() * 1.2]);
  ctx.fillStyle = "#ffffff";
  for (const [x, y, size, phase, speed] of glints) {
    const on = Math.pow(Math.max(0, Math.sin(t * speed + phase)), 6);
    if (on < 0.02) continue;
    ctx.globalAlpha = on * 0.9;
    sparkle(ctx, x, y, size * (0.6 + on));
  }
  ctx.globalAlpha = 1;
}

/** Baize, with a pattern woven into it and a gold rail that catches the light. */
function felt(ctx: CanvasRenderingContext2D, theme: Theme, t: number) {
  const light = ctx.createRadialGradient(W / 2, H * 0.42, 40, W / 2, H * 0.42, H * 0.75);
  light.addColorStop(0, "rgba(255,255,255,0.10)");
  light.addColorStop(0.6, "rgba(0,0,0,0)");
  light.addColorStop(1, "rgba(0,0,0,0.5)");
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, W, H);
  // A diamond lattice, barely there.
  ctx.strokeStyle = "rgba(212,175,55,0.07)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let d = -H; d < W + H; d += 34) {
    ctx.moveTo(d, 0);
    ctx.lineTo(d + GROUND, GROUND);
    ctx.moveTo(d + GROUND, 0);
    ctx.lineTo(d, GROUND);
  }
  ctx.stroke();
  // The crest in the middle of the table.
  ctx.save();
  ctx.translate(W / 2, GROUND / 2 + 20);
  ctx.strokeStyle = "rgba(212,175,55,0.16)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(0, 0, 78, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, 70, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "rgba(212,175,55,0.14)";
  ctx.font = "700 30px Georgia, serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("B", 0, 2);
  ctx.textBaseline = "alphabetic";
  ctx.restore();
  // The rail, with a highlight that runs round it.
  const sweep = ((t * 0.12) % 1.6) - 0.3;
  const rail = ctx.createLinearGradient(0, 0, W, H);
  rail.addColorStop(0, "#8a6d1c");
  rail.addColorStop(Math.max(0, Math.min(1, sweep - 0.08)), "#b8932e");
  rail.addColorStop(Math.max(0, Math.min(1, sweep)), "#fff1b8");
  rail.addColorStop(Math.max(0, Math.min(1, sweep + 0.08)), "#b8932e");
  rail.addColorStop(1, "#8a6d1c");
  ctx.strokeStyle = rail;
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, W - 3, H - 3);
  ctx.strokeStyle = fade(theme.board.line, 0.35);
  ctx.lineWidth = 1;
  ctx.strokeRect(5.5, 5.5, W - 11, H - 11);
}

/** Blocks on a chain: a faint ledger grid, and value travelling along the beams. */
function pulse(ctx: CanvasRenderingContext2D, t: number) {
  const glow = ctx.createRadialGradient(W * 0.2, H * 0.15, 0, W * 0.2, H * 0.15, 330);
  glow.addColorStop(0, "rgba(153,69,255,0.28)");
  glow.addColorStop(1, "rgba(153,69,255,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  const glow2 = ctx.createRadialGradient(W * 0.85, GROUND * 0.8, 0, W * 0.85, GROUND * 0.8, 300);
  glow2.addColorStop(0, "rgba(20,241,149,0.18)");
  glow2.addColorStop(1, "rgba(20,241,149,0)");
  ctx.fillStyle = glow2;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "rgba(255,255,255,0.035)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0.5; x < W; x += 34) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, GROUND);
  }
  for (let y = 0.5; y < GROUND; y += 34) {
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
  }
  ctx.stroke();
  // Beams across the board, each carrying a packet of light.
  const beams = layout("pulse", 6, (r) => [r() * (W + GROUND) - GROUND * 0.5, 0.05 + r() * 0.12, r()]);
  for (const [offset, speed, start] of beams) {
    const beam = ctx.createLinearGradient(offset, GROUND, offset + GROUND * 0.9, 0);
    beam.addColorStop(0, "rgba(153,69,255,0)");
    beam.addColorStop(0.5, "rgba(153,69,255,0.22)");
    beam.addColorStop(1, "rgba(20,241,149,0.22)");
    ctx.strokeStyle = beam;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(offset, GROUND);
    ctx.lineTo(offset + GROUND * 0.9, 0);
    ctx.stroke();
    const p = (start + t * speed) % 1;
    const px = offset + GROUND * 0.9 * p;
    const py = GROUND - GROUND * p;
    const packet = ctx.createRadialGradient(px, py, 0, px, py, 9);
    packet.addColorStop(0, fade(p < 0.5 ? "#c58bff" : "#5fffc0", 0.95));
    packet.addColorStop(1, fade(p < 0.5 ? "#9945ff" : "#14f195", 0));
    ctx.fillStyle = packet;
    ctx.beginPath();
    ctx.arc(px, py, 9, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Soft circles of colour, out of focus behind the jelly. */
function candy(ctx: CanvasRenderingContext2D, theme: Theme) {
  const bokeh = layout("candy", 16, (r) => [r() * W, r() * GROUND, 18 + r() * 60, Math.floor(r() * 6)]);
  for (const [x, y, r, tone] of bokeh) {
    const [face] = theme.board.bricks[tone];
    const dot = ctx.createRadialGradient(x, y, r * 0.2, x, y, r);
    dot.addColorStop(0, fade(face, 0.22));
    dot.addColorStop(1, fade(face, 0));
    ctx.fillStyle = dot;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const sprinkles = layout("candy-sprinkles", 40, (r) => [r() * W, r() * GROUND, r() * Math.PI, Math.floor(r() * 6)]);
  ctx.lineCap = "round";
  ctx.lineWidth = 3;
  for (const [x, y, angle, tone] of sprinkles) {
    ctx.strokeStyle = fade(theme.board.bricks[tone][0], 0.35);
    ctx.beginPath();
    ctx.moveTo(x - Math.cos(angle) * 4, y - Math.sin(angle) * 4);
    ctx.lineTo(x + Math.cos(angle) * 4, y + Math.sin(angle) * 4);
    ctx.stroke();
  }
  ctx.lineCap = "butt";
}

// ------------------------------------------------------------------ bricks

type Rect = { x: number; y: number; w: number; h: number };

/**
 * Paints one brick in the theme's style, inside the engine's rectangle. Returns
 * the colour its number should be written in.
 */
export function drawStyledBrick(ctx: CanvasRenderingContext2D, theme: Theme, r: Rect, face: string, shade: string, t: number): string {
  const radius = theme.board.radius;
  switch (theme.board.brick) {
    case "glossy": {
      ctx.fillStyle = shade;
      ctx.beginPath();
      ctx.roundRect(r.x, r.y + 4, r.w, r.h, radius);
      ctx.fill();
      const body = ctx.createLinearGradient(0, r.y, 0, r.y + r.h);
      body.addColorStop(0, mix(face, "#ffffff", 0.18));
      body.addColorStop(1, mix(face, shade, 0.45));
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.roundRect(r.x, r.y, r.w, r.h - 2, radius);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.beginPath();
      ctx.ellipse(r.x + r.w / 2, r.y + r.h * 0.27, r.w * 0.36, r.h * 0.15, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.beginPath();
      ctx.arc(r.x + r.w * 0.22, r.y + r.h * 0.25, 2.4, 0, Math.PI * 2);
      ctx.fill();
      return mix(shade, "#000000", 0.25);
    }
    case "gem": {
      const i = 9;
      const { x, y, w, h } = r;
      ctx.fillStyle = mix(shade, "#000000", 0.35);
      ctx.fillRect(x, y + 3, w, h);
      const facet = (points: number[], colour: string) => {
        ctx.fillStyle = colour;
        ctx.beginPath();
        ctx.moveTo(points[0], points[1]);
        for (let k = 2; k < points.length; k += 2) ctx.lineTo(points[k], points[k + 1]);
        ctx.closePath();
        ctx.fill();
      };
      facet([x, y, x + w, y, x + w - i, y + i, x + i, y + i], mix(face, "#ffffff", 0.5));
      facet([x, y, x + i, y + i, x + i, y + h - i, x, y + h], mix(face, "#ffffff", 0.2));
      facet([x + w, y, x + w, y + h, x + w - i, y + h - i, x + w - i, y + i], mix(face, "#000000", 0.25));
      facet([x, y + h, x + i, y + h - i, x + w - i, y + h - i, x + w, y + h], shade);
      const table = ctx.createLinearGradient(x + i, y + i, x + w - i, y + h - i);
      table.addColorStop(0, mix(face, "#ffffff", 0.3));
      table.addColorStop(0.5, face);
      table.addColorStop(1, mix(face, shade, 0.5));
      ctx.fillStyle = table;
      ctx.fillRect(x + i, y + i, w - i * 2, h - i * 2);
      ctx.strokeStyle = "rgba(255,255,255,0.28)";
      ctx.lineWidth = 0.8;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      ctx.strokeRect(x + i, y + i, w - i * 2, h - i * 2);
      // Now and then, a glint on a corner of the stone.
      const on = Math.pow(Math.max(0, Math.sin(t * 1.4 + cellHash(x, y) * 40)), 10);
      if (on > 0.02) {
        ctx.fillStyle = `rgba(255,255,255,${on})`;
        sparkle(ctx, x + i + 3, y + i + 2, 4 + on * 5);
      }
      return "#ffffff";
    }
    case "glass": {
      ctx.fillStyle = fade(shade, 0.35);
      ctx.beginPath();
      ctx.roundRect(r.x, r.y + 3, r.w, r.h, radius);
      ctx.fill();
      ctx.fillStyle = face;
      ctx.beginPath();
      ctx.roundRect(r.x, r.y, r.w, r.h - 2, radius);
      ctx.fill();
      ctx.save();
      ctx.clip();
      const top = ctx.createLinearGradient(0, r.y, 0, r.y + r.h * 0.5);
      top.addColorStop(0, "rgba(255,255,255,0.32)");
      top.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = top;
      ctx.fillRect(r.x, r.y, r.w, r.h * 0.5);
      // A sheen that slides slowly across the pane.
      const slide = ((t * 0.08 + cellHash(r.x, r.y)) % 1.6) - 0.3;
      ctx.translate(r.x + r.w * slide, r.y);
      ctx.rotate(0.45);
      ctx.fillStyle = "rgba(255,255,255,0.16)";
      ctx.fillRect(-6, -20, 9, r.h + 40);
      ctx.fillRect(7, -20, 3, r.h + 40);
      ctx.restore();
      if (theme.board.stroke) {
        ctx.strokeStyle = theme.board.stroke;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.roundRect(r.x + 0.6, r.y + 0.6, r.w - 1.2, r.h - 3.2, radius);
        ctx.stroke();
      }
      if (theme.board.shine) {
        ctx.fillStyle = theme.board.shine;
        ctx.fillRect(r.x + 7, r.y + 4, r.w - 14, 1.5);
      }
      return theme.board.label;
    }
    case "neon": {
      ctx.fillStyle = fade(face, 0.1);
      ctx.beginPath();
      ctx.roundRect(r.x + 1, r.y + 1, r.w - 2, r.h - 4, radius);
      ctx.fill();
      ctx.shadowColor = face;
      ctx.shadowBlur = 14;
      ctx.strokeStyle = face;
      ctx.lineWidth = 2.2;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.lineWidth = 0.7;
      ctx.stroke();
      return face;
    }
    case "chip": {
      ctx.fillStyle = shade;
      ctx.beginPath();
      ctx.roundRect(r.x, r.y + 4, r.w, r.h, radius);
      ctx.fill();
      ctx.fillStyle = face;
      ctx.beginPath();
      ctx.roundRect(r.x, r.y, r.w, r.h - 2, radius);
      ctx.fill();
      // The edge inserts every casino chip carries.
      // A pale chip gets red inserts, every other one white.
      ctx.fillStyle = rgba(face)[0] > 200 && rgba(face)[1] > 200 ? "#c8102e" : "rgba(255,255,255,0.88)";
      const cx = r.x + r.w / 2;
      const cy = r.y + (r.h - 2) / 2;
      const bottom = r.y + r.h - 2 - 4;
      for (const [ix, iy, iw, ih] of [
        [cx - r.w * 0.22 - 3.5, r.y, 7, 4],
        [cx + r.w * 0.22 - 3.5, r.y, 7, 4],
        [cx - r.w * 0.22 - 3.5, bottom, 7, 4],
        [cx + r.w * 0.22 - 3.5, bottom, 7, 4],
        [r.x, cy - 3.5, 4, 7],
        [r.x + r.w - 4, cy - 3.5, 4, 7],
      ]) {
        ctx.fillRect(ix, iy, iw, ih);
      }
      // The inlay, ringed in gold.
      ctx.fillStyle = mix(face, "#000000", 0.28);
      ctx.beginPath();
      ctx.roundRect(r.x + 9, r.y + 8, r.w - 18, r.h - 18, Math.max(2, radius - 6));
      ctx.fill();
      ctx.strokeStyle = theme.board.stroke ?? "#d4af37";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 2.5]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = "rgba(255,240,190,0.35)";
      ctx.beginPath();
      ctx.roundRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 3, radius);
      ctx.stroke();
      return theme.board.label;
    }
    case "ink": {
      // A brushstroke: the edges never quite straight, the paint never quite even.
      const seed = cellHash(r.x, r.y);
      const jitter = (k: number) => (cellHash(r.x + k * 13.7, r.y + seed * 97) - 0.5) * 4;
      ctx.fillStyle = fade(face, 0.93);
      ctx.beginPath();
      const steps = 6;
      ctx.moveTo(r.x + jitter(0), r.y + jitter(1));
      for (let k = 1; k <= steps; k++) ctx.lineTo(r.x + (r.w * k) / steps, r.y + jitter(k + 2));
      for (let k = 1; k <= steps; k++) ctx.lineTo(r.x + r.w + jitter(k + 10), r.y + (r.h * k) / steps);
      for (let k = steps - 1; k >= 0; k--) ctx.lineTo(r.x + (r.w * k) / steps, r.y + r.h + jitter(k + 20));
      for (let k = steps - 1; k >= 1; k--) ctx.lineTo(r.x + jitter(k + 30), r.y + (r.h * k) / steps);
      ctx.closePath();
      ctx.fill();
      // Dry-brush streaks where the ink ran thin.
      ctx.strokeStyle = "rgba(245,237,220,0.18)";
      ctx.lineWidth = 1;
      for (let k = 0; k < 3; k++) {
        const sy = r.y + 8 + (r.h - 16) * cellHash(r.x + k, r.y - k);
        ctx.beginPath();
        ctx.moveTo(r.x + 4 + k * 6, sy);
        ctx.lineTo(r.x + r.w - 6 - k * 3, sy + (k - 1) * 1.5);
        ctx.stroke();
      }
      return theme.board.label;
    }
    case "gradient": {
      ctx.fillStyle = mix(shade, "#000000", 0.45);
      ctx.beginPath();
      ctx.roundRect(r.x, r.y + 4, r.w, r.h, radius);
      ctx.fill();
      const body = ctx.createLinearGradient(r.x, r.y + r.h, r.x + r.w, r.y);
      body.addColorStop(0, face);
      body.addColorStop(1, shade);
      ctx.fillStyle = body;
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
        ctx.fillRect(r.x + 9, r.y + 5, r.w - 18, 2);
      }
      return theme.board.label;
    }
    default:
      return theme.board.label;
  }
}

/** The ball as a lit sphere: a highlight up and to the left, the colour around it. */
export function orbFill(ctx: CanvasRenderingContext2D, theme: Theme, x: number, y: number, r: number) {
  const orb = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
  orb.addColorStop(0, "#ffffff");
  orb.addColorStop(0.45, theme.board.ball);
  orb.addColorStop(1, mix(theme.board.ball, theme.board.glow, 0.55));
  return orb;
}
