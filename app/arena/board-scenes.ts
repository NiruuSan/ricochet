import { CW, GROUND, H, RH, W } from "@/lib/engine";
import type { Scene, Theme } from "@/lib/themes";
import { fade, mix, mixHex, neonInside, rgba } from "@/lib/colour";

// The pictures behind the bricks, and bricks with depth.
//
// Like everything a theme paints, none of this is read by the engine: a scene
// sits behind the bricks and the ball, and a brick is drawn inside the very
// rectangle the engine gives it.
//
// It is also built to cost a phone almost nothing per frame. A scene comes in
// two halves: everything that never moves is painted once into a backdrop the
// board keeps (board-canvas.ts), and only what moves — stars, snow, a scrolling
// grid — is drawn each frame, from the time alone, so the same moment always
// looks the same and nothing accumulates. Bricks are painted once per colour
// into small sprites and stamped; only a passing glint is drawn live.

/** Scenes with a moving half, and so worth painting while the board is idle. */
const MOVING: Record<Scene, boolean> = {
  skyline: true,
  papercraft: false,
  arcade: true,
  sea: true,
  rain: true,
  blossom: true,
  marble: true,
  flare: true,
  nebula: true,
  candy: false,
  snow: true,
  ink: false,
  outrun: true,
  cave: true,
  pulse: true,
  aurora: true,
  felt: true,
  blueprint: true,
};
export const isAnimated = (theme: Theme) => !!theme.board.scene && MOVING[theme.board.scene];

// ------------------------------------------------------- fixed randomness

/** A seeded generator: a scene must not reshuffle between frames. */
function seeded(seed: number) {
  let s = seed >>> 0 || 1;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
}
const hashKey = (key: string) => [...key].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261);
const layouts = new Map<string, unknown>();
/** The same "random" layout every time it is asked for. */
function once<T>(key: string, make: (r: () => number) => T): T {
  let found = layouts.get(key) as T | undefined;
  if (found === undefined) {
    found = make(seeded(hashKey(key)));
    layouts.set(key, found);
  }
  return found;
}
const layout = (key: string, count: number, make: (r: () => number) => number[]) => once(key, (r) => Array.from({ length: count }, () => make(r)));
/** A stable number in [0, 1) for a pair of numbers. */
const hash2 = (x: number, y: number) => ((Math.imul(Math.round(x) * 374761393 + Math.round(y) * 668265263, 1274126177) >>> 0) % 10_000) / 10_000;

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

const canvas = (w: number, h: number) => {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
};

const glows = new Map<string, HTMLCanvasElement>();
/** A soft round glow in one colour, painted once and stamped wherever it is wanted. */
function glow(colour: string) {
  let c = glows.get(colour);
  if (!c) {
    c = canvas(64, 64);
    const g = c.getContext("2d")!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, fade(colour, 1));
    grad.addColorStop(0.22, fade(colour, 0.6));
    grad.addColorStop(1, fade(colour, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    glows.set(colour, c);
  }
  return c;
}
const stamp = (ctx: CanvasRenderingContext2D, sprite: CanvasImageSource, x: number, y: number, r: number) => ctx.drawImage(sprite, x - r, y - r, r * 2, r * 2);

type Live = { canvas: HTMLCanvasElement; frame: number };
const lives = new Map<string, Live>();
/**
 * A layer repainted a few times a second at a lower resolution, for soft
 * things that move slowly (an aurora) or in steps anyway (falling code).
 * Painting it every frame at full size would cost more than the whole board.
 */
function liveLayer(key: string, scale: number, fps: number, t: number, height: number, paint: (g: CanvasRenderingContext2D, t: number) => void) {
  let live = lives.get(key);
  if (!live) {
    live = { canvas: canvas(W * scale, height * scale), frame: Number.NaN };
    lives.set(key, live);
  }
  const frame = Math.floor(t * fps);
  if (frame !== live.frame) {
    live.frame = frame;
    const g = live.canvas.getContext("2d")!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, live.canvas.width, live.canvas.height);
    g.setTransform(scale, 0, 0, scale, 0, 0);
    paint(g, frame / fps);
  }
  return live.canvas;
}

/** A line of hills from `base` up to `height` higher, filled down to the ground. */
function ridge(ctx: CanvasRenderingContext2D, key: string, base: number, height: number, colour: string | CanvasGradient, sharp = 0) {
  const [a, b, c] = once(key, (r) => [r() * 6, r() * 6, r() * 6]);
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.moveTo(0, GROUND);
  for (let x = 0; x <= W + 6; x += 6) ctx.lineTo(x, ridgeY(x, base, height, a, b, c, sharp));
  ctx.lineTo(W, GROUND);
  ctx.closePath();
  ctx.fill();
}
function ridgeY(x: number, base: number, height: number, a: number, b: number, c: number, sharp = 0) {
  const peak = sharp ? Math.pow(Math.abs(Math.sin(x * 0.011 + a)), 1 + sharp) : 0.5 + 0.28 * Math.sin(x * 0.013 + a);
  return base - height * (peak + 0.16 * Math.sin(x * 0.037 + b) + 0.06 * Math.sin(x * 0.11 + c));
}

function vignette(ctx: CanvasRenderingContext2D, strength: number) {
  const v = ctx.createRadialGradient(W / 2, H * 0.45, H * 0.3, W / 2, H * 0.45, H * 0.78);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, `rgba(0,0,0,${strength})`);
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);
}

/** Stars that twinkle: dim ones as specks, bright ones with a glint. */
function twinkle(ctx: CanvasRenderingContext2D, key: string, count: number, brightness: number, t: number, bottom = GROUND - 30) {
  const stars = layout(key, count, (r) => [r() * W, r() * bottom, 0.35 + r() * 1.1, r() * 6.28, 0.6 + r() * 1.8]);
  ctx.fillStyle = "#ffffff";
  for (const [x, y, size, phase, speed] of stars) {
    ctx.globalAlpha = brightness * (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * speed + phase))) * (0.4 + size / 2);
    if (size > 1.25) {
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
      sparkle(ctx, x, y, size * 3);
    } else {
      ctx.fillRect(x - size * 0.8, y - size * 0.8, size * 1.6, size * 1.6);
    }
  }
  ctx.globalAlpha = 1;
}

/** Stars that never move, for the backdrop. */
function specks(ctx: CanvasRenderingContext2D, key: string, count: number, colour: string, alpha: number, bottom = GROUND) {
  ctx.fillStyle = colour;
  for (const [x, y, size, a] of layout(key, count, (r) => [r() * W, r() * bottom, 0.4 + r() * 0.8, r()])) {
    ctx.globalAlpha = alpha * (0.3 + a * 0.7);
    ctx.fillRect(x, y, size, size);
  }
  ctx.globalAlpha = 1;
}

// ------------------------------------------------------------------ scenes

/** The half of the scene that never moves, painted once into the backdrop. */
export function paintSceneBack(ctx: CanvasRenderingContext2D, theme: Theme) {
  switch (theme.board.scene) {
    case "skyline":
      return skyline(ctx);
    case "papercraft":
      return papercraft(ctx);
    case "arcade":
      return arcadeBack(ctx);
    case "sea":
      return seaBack(ctx);
    case "rain":
      return rainBack(ctx);
    case "blossom":
      return blossomBack(ctx);
    case "marble":
      return marbleBack(ctx);
    case "flare":
      return flareBack(ctx);
    case "nebula":
      return nebulaBack(ctx);
    case "candy":
      return candy(ctx, theme);
    case "snow":
      return snowBack(ctx);
    case "ink":
      return ink(ctx);
    case "outrun":
      return outrunBack(ctx, theme);
    case "cave":
      return caveBack(ctx, theme);
    case "pulse":
      return pulseBack(ctx);
    case "aurora":
      return auroraBack(ctx, theme);
    case "felt":
      return feltBack(ctx, theme);
    case "blueprint":
      return blueprintBack(ctx, theme);
  }
}

/** The half that moves, painted every frame over the backdrop and behind the bricks. */
export function paintSceneLive(ctx: CanvasRenderingContext2D, theme: Theme, t: number) {
  switch (theme.board.scene) {
    case "skyline":
      return skylineLive(ctx, t);
    case "arcade":
      return arcadeLive(ctx, t);
    case "sea":
      return seaLive(ctx, t);
    case "rain":
      return rainLive(ctx, t);
    case "blossom":
      return blossomLive(ctx, t);
    case "marble":
      return marbleLive(ctx, t);
    case "flare":
      return flareLive(ctx, t);
    case "nebula":
      return nebulaLive(ctx, t);
    case "snow":
      return snowLive(ctx, t);
    case "outrun":
      return outrunLive(ctx, theme, t);
    case "cave":
      return caveLive(ctx, t);
    case "pulse":
      return pulseLive(ctx, t);
    case "aurora":
      return auroraLive(ctx, t);
    case "felt":
      return feltLive(ctx, t);
    case "blueprint":
      return blueprintLive(ctx, t);
  }
}

// --- Neon Grid: a city at 3am.

type Tower = { x: number; w: number; h: number; windows: [number, number, string][]; mast: boolean };
const towers = (key: string, min: number, max: number, lit: number) =>
  once(key, (r) => {
    const list: Tower[] = [];
    for (let x = -8; x < W; ) {
      const w = 18 + r() * 30;
      const h = min + r() * (max - min);
      const windows: [number, number, string][] = [];
      for (let wy = GROUND - h + 8; wy < GROUND - 6; wy += 9) {
        for (let wx = x + 4; wx < x + w - 5; wx += 6) {
          if (r() < lit) windows.push([wx, wy, ["#ff3df0", "#00f0ff", "#ffe600", "#ffffff"][Math.floor(r() * 4)]]);
        }
      }
      list.push({ x, w, h, windows, mast: r() < 0.25 });
      x += w + (r() < 0.3 ? 4 + r() * 10 : 0);
    }
    return list;
  });

function skyline(ctx: CanvasRenderingContext2D) {
  // The glow a city throws into the sky.
  const haze = ctx.createLinearGradient(0, GROUND - 320, 0, GROUND);
  haze.addColorStop(0, "rgba(255,61,240,0)");
  haze.addColorStop(0.65, "rgba(255,61,240,0.16)");
  haze.addColorStop(1, "rgba(0,240,255,0.24)");
  ctx.fillStyle = haze;
  ctx.fillRect(0, GROUND - 320, W, 320);
  const layers: [string, number, number, number, string, string][] = [
    ["neon-far", 70, 175, 0.08, "#27103f", "rgba(0,240,255,0.45)"],
    ["neon-near", 40, 125, 0.16, "#120620", "rgba(255,61,240,0.75)"],
  ];
  for (const [key, min, max, lit, body, rim] of layers) {
    for (const tower of towers(key, min, max, lit)) {
      const top = GROUND - tower.h;
      ctx.fillStyle = body;
      ctx.fillRect(tower.x, top, tower.w, tower.h);
      ctx.fillStyle = rim;
      ctx.fillRect(tower.x, top, tower.w, 1);
      if (tower.mast) ctx.fillRect(tower.x + tower.w / 2 - 0.5, top - 16, 1, 16);
      for (const [wx, wy, colour] of tower.windows) {
        ctx.fillStyle = fade(colour, key === "neon-near" ? 0.7 : 0.35);
        ctx.fillRect(wx, wy, 2.4, 3.4);
      }
    }
  }
  // The horizon that will not stop glowing.
  const line = ctx.createLinearGradient(0, 0, W, 0);
  line.addColorStop(0, "rgba(255,61,240,0.2)");
  line.addColorStop(0.5, "rgba(255,170,250,0.9)");
  line.addColorStop(1, "rgba(0,240,255,0.2)");
  ctx.fillStyle = line;
  ctx.fillRect(0, GROUND - 2, W, 2);
}

function skylineLive(ctx: CanvasRenderingContext2D, t: number) {
  // A few windows go dark and light again; the masts blink red.
  const near = towers("neon-near", 40, 125, 0.16);
  for (let i = 0; i < near.length; i++) {
    const tower = near[i];
    if (tower.mast && Math.sin(t * 2.2 + i) > 0.55) stamp(ctx, glow("#ff3355"), tower.x + tower.w / 2, GROUND - tower.h - 16, 4);
    for (let k = 0; k < tower.windows.length; k += 7) {
      const [wx, wy] = tower.windows[k];
      if (Math.sin(t * 0.7 + wx * 0.37 + wy) > 0.6) {
        ctx.fillStyle = "#120620";
        ctx.fillRect(wx, wy, 2.4, 3.4);
      }
    }
  }
}

// --- Paper Cut: hills and a sun cut from card.

function papercraft(ctx: CanvasRenderingContext2D) {
  for (const [x, y, size, tone] of layout("paper-grain", 320, (r) => [r() * W, r() * H, r() * 1.3 + 0.3, r()])) {
    ctx.fillStyle = tone > 0.5 ? "rgba(120,90,40,0.07)" : "rgba(255,255,255,0.5)";
    ctx.fillRect(x, y, size, size);
  }
  const shadow = (blur: number, y: number) => {
    ctx.shadowColor = "rgba(90,60,20,0.26)";
    ctx.shadowBlur = blur;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = y;
  };
  ctx.save();
  // A sun of two discs, the smaller one stuck on top.
  shadow(8, 3);
  ctx.fillStyle = "#f4b183";
  ctx.beginPath();
  ctx.arc(W * 0.77, 112, 40, 0, Math.PI * 2);
  ctx.fill();
  shadow(4, 2);
  ctx.fillStyle = "#f8c9a2";
  ctx.beginPath();
  ctx.arc(W * 0.77, 112, 27, 0, Math.PI * 2);
  ctx.fill();
  // Clouds: three circles on a flat base.
  for (const [cx, cy, s] of [
    [92, 168, 1],
    [300, 76, 0.75],
  ]) {
    // One outline, cut in one piece: three bumps on a flat base.
    shadow(7, 3);
    ctx.fillStyle = "#fffdf6";
    ctx.beginPath();
    ctx.moveTo(cx - 32 * s, cy + 12 * s);
    ctx.arc(cx - 18 * s, cy, 14 * s, Math.PI * 0.75, Math.PI * 1.6);
    ctx.arc(cx, cy - 8 * s, 19 * s, Math.PI * 1.1, Math.PI * 1.9);
    ctx.arc(cx + 20 * s, cy, 13 * s, Math.PI * 1.4, Math.PI * 0.25);
    ctx.lineTo(cx + 30 * s, cy + 12 * s);
    ctx.closePath();
    ctx.fill();
  }
  // Three layers of hill, each throwing its shadow up onto the one behind.
  const hills: [string, number, number, string][] = [
    ["paper-far", GROUND - 150, 62, "#dbe5d0"],
    ["paper-mid", GROUND - 92, 56, "#c3d8bb"],
    ["paper-near", GROUND - 40, 44, "#a9c9a6"],
  ];
  for (const [key, base, height, colour] of hills) {
    shadow(9, -3);
    ridge(ctx, key, base, height, colour);
    if (key === "paper-mid") {
      // A few paper trees along the middle hill.
      shadow(3, 1);
      const [a, b, c] = once(key, (r) => [r() * 6, r() * 6, r() * 6]);
      for (const [x, s] of layout("paper-trees", 6, (r) => [20 + r() * (W - 40), 0.7 + r() * 0.5])) {
        const y = ridgeY(x, base, height, a, b, c) + 4;
        ctx.fillStyle = "#8a6a4a";
        ctx.fillRect(x - 1.5 * s, y - 6 * s, 3 * s, 8 * s);
        ctx.fillStyle = "#7fae86";
        ctx.beginPath();
        ctx.moveTo(x, y - 30 * s);
        ctx.lineTo(x + 10 * s, y - 5 * s);
        ctx.lineTo(x - 10 * s, y - 5 * s);
        ctx.closePath();
        ctx.fill();
      }
    }
  }
  ctx.restore();
}

// --- Arcade 84: a starfield scrolling past a pixel moon.

function arcadeBack(ctx: CanvasRenderingContext2D) {
  // A moon built from squares, lit from the left.
  const [cx, cy, radius, block] = [W * 0.76, 118, 46, 6];
  for (let y = -radius; y < radius; y += block) {
    for (let x = -radius; x < radius; x += block) {
      const dx = x + block / 2;
      const dy = y + block / 2;
      if (Math.hypot(dx, dy) > radius) continue;
      const light = (-dx - dy * 0.6) / radius;
      const crater = hash2(x + 300, y + 900) > 0.86;
      ctx.fillStyle = crater ? "#2a1d55" : light > 0.35 ? "#7a62d6" : light > -0.2 ? "#5b44b0" : "#3a2a7a";
      ctx.fillRect(cx + x, cy + y, block, block);
    }
  }
  // Scanlines, behind everything that matters.
  ctx.fillStyle = "rgba(255,255,255,0.025)";
  for (let y = 0; y < GROUND; y += 3) ctx.fillRect(0, y, W, 1);
  vignette(ctx, 0.6);
}

function arcadeLive(ctx: CanvasRenderingContext2D, t: number) {
  const layers: [number, number, number, string][] = [
    [34, 1, 9, "#4a4a6a"],
    [22, 2, 22, "#9a9ad0"],
    [10, 2, 46, "#ffffff"],
  ];
  layers.forEach(([count, size, speed, colour], i) => {
    ctx.fillStyle = colour;
    for (const [x, y] of layout(`arcade-${i}`, count, (r) => [r() * W, r() * GROUND])) {
      ctx.fillRect(Math.round(x), Math.round((y + t * speed) % GROUND), size, size);
    }
  });
}

// --- Deep Sea: light from above, kelp below, and the water moving.

function seaBack(ctx: CanvasRenderingContext2D) {
  const top = ctx.createRadialGradient(W * 0.5, -80, 0, W * 0.5, -80, 470);
  top.addColorStop(0, "rgba(130,235,255,0.22)");
  top.addColorStop(1, "rgba(130,235,255,0)");
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const [x0, spread, lean, alpha] of layout("sea-rays", 6, (r) => [r() * W, 14 + r() * 26, -60 + r() * 120, 0.05 + r() * 0.06])) {
    const ray = ctx.createLinearGradient(0, 0, 0, GROUND * 0.9);
    ray.addColorStop(0, `rgba(170,240,255,${alpha})`);
    ray.addColorStop(1, "rgba(170,240,255,0)");
    ctx.fillStyle = ray;
    ctx.beginPath();
    ctx.moveTo(x0 - spread * 0.4, 0);
    ctx.lineTo(x0 + spread * 0.4, 0);
    ctx.lineTo(x0 + lean + spread * 1.6, GROUND * 0.9);
    ctx.lineTo(x0 + lean - spread * 1.6, GROUND * 0.9);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  // Kelp at both walls, and rocks along the bottom.
  ctx.strokeStyle = "#04302b";
  ctx.lineCap = "round";
  for (const [x, height, bend, width] of layout("sea-kelp", 9, (r) => {
    const side = r() < 0.5;
    return [side ? r() * 70 : W - r() * 70, 110 + r() * 150, (r() - 0.5) * 60, 3 + r() * 3];
  })) {
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x, GROUND);
    ctx.bezierCurveTo(x + bend, GROUND - height * 0.35, x - bend, GROUND - height * 0.7, x + bend * 0.5, GROUND - height);
    ctx.stroke();
  }
  ctx.lineCap = "butt";
  ridge(ctx, "sea-rocks", GROUND - 4, 26, "#03161f", 2);
  // Light dancing on the sand below the line.
  ctx.strokeStyle = "rgba(150,235,255,0.07)";
  ctx.lineWidth = 1;
  for (const [x, y, w] of layout("sea-caustic", 14, (r) => [r() * W, GROUND + 8 + r() * (H - GROUND - 14), 14 + r() * 26])) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + w / 2, y - 4, x + w, y);
    ctx.stroke();
  }
}

function seaLive(ctx: CanvasRenderingContext2D, t: number) {
  ctx.fillStyle = "#cfefff";
  for (const [x, y, phase, size] of layout("sea-snow", 46, (r) => [r() * W, r() * GROUND, r() * 6.28, 0.8 + r() * 1.1])) {
    ctx.globalAlpha = 0.18 + size * 0.12;
    ctx.fillRect(x + Math.sin(t * 0.4 + phase) * 7, (y + t * 7) % GROUND, size, size);
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = "rgba(220,250,255,0.45)";
  ctx.lineWidth = 0.9;
  for (const [x, y, speed, r, phase] of layout("sea-bubbles", 13, (r) => [r() * W, r() * GROUND, 16 + r() * 22, 1.4 + r() * 2.6, r() * 6.28])) {
    const by = GROUND - ((GROUND - y + t * speed) % (GROUND + 10));
    ctx.beginPath();
    ctx.arc(x + Math.sin(t * 1.6 + phase) * 4, by, r, 0, Math.PI * 2);
    ctx.stroke();
  }
}

// --- Terminal: code falling behind the bricks.

const GLYPHS = "0123456789ABCDEF<>/\\{}[]#$%&*+=:;";

function rainBack(ctx: CanvasRenderingContext2D) {
  const bloom = ctx.createRadialGradient(W / 2, H * 0.42, 0, W / 2, H * 0.42, H * 0.6);
  bloom.addColorStop(0, "rgba(0,255,106,0.07)");
  bloom.addColorStop(1, "rgba(0,255,106,0)");
  ctx.fillStyle = bloom;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "rgba(0,255,106,0.03)";
  for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1);
  vignette(ctx, 0.55);
}

function rainLive(ctx: CanvasRenderingContext2D, t: number) {
  const layer = liveLayer("rain", 1.5, 11, t, GROUND, (g, time) => {
    const cell = W / 26;
    const rows = Math.ceil(GROUND / cell);
    g.font = `${cell * 0.92}px ui-monospace, monospace`;
    g.textAlign = "center";
    layout("rain-cols", 26, (r) => [3.5 + r() * 7, r() * 60, 7 + Math.floor(r() * 12)]).forEach(([speed, offset, length], col) => {
      const head = Math.floor((offset + time * speed) % (rows + length + 8));
      for (let k = 0; k < length; k++) {
        const row = head - k;
        if (row < 0 || row >= rows) continue;
        g.fillStyle = k === 0 ? "rgba(200,255,221,0.22)" : `rgba(0,255,106,${0.16 * (1 - k / length)})`;
        g.fillText(GLYPHS[Math.floor(hash2(col * 31 + row, Math.floor(time * 2) + k * 7) * GLYPHS.length)], col * cell + cell / 2, row * cell + cell * 0.85);
      }
    });
  });
  ctx.drawImage(layer, 0, 0, W, GROUND);
}

// --- Sakura: a branch in flower against a pale moon.

function flower(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, colour: string, turn: number) {
  ctx.fillStyle = colour;
  ctx.beginPath();
  for (let k = 0; k < 5; k++) {
    const a = turn + (k * Math.PI * 2) / 5;
    const px = x + Math.cos(a) * r * 0.55;
    const py = y + Math.sin(a) * r * 0.55;
    ctx.moveTo(px + r * 0.48, py);
    ctx.arc(px, py, r * 0.48, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.fillStyle = "#c2557a";
  ctx.beginPath();
  ctx.arc(x, y, r * 0.18, 0, Math.PI * 2);
  ctx.fill();
}

function blossomBack(ctx: CanvasRenderingContext2D) {
  const dusk = ctx.createLinearGradient(0, GROUND - 260, 0, GROUND);
  dusk.addColorStop(0, "rgba(255,150,180,0)");
  dusk.addColorStop(1, "rgba(255,150,180,0.2)");
  ctx.fillStyle = dusk;
  ctx.fillRect(0, GROUND - 260, W, 260);
  // The moon.
  stamp(ctx, glow("#ffd9e4"), W * 0.74, 120, 120);
  ctx.fillStyle = "#ffeef3";
  ctx.beginPath();
  ctx.arc(W * 0.74, 120, 40, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(225,175,195,0.35)";
  for (const [dx, dy, r] of [
    [-12, -8, 7],
    [10, 9, 9],
    [14, -14, 4],
  ]) {
    ctx.beginPath();
    ctx.arc(W * 0.74 + dx, 120 + dy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ridge(ctx, "sakura-far", GROUND - 100, 74, "#3a2244", 1.2);
  ridge(ctx, "sakura-near", GROUND - 34, 44, "#2a1730");
  // The branch, thick at the trunk and thin at the tips.
  const branch = (points: [number, number][], from: number, to: number) => {
    ctx.strokeStyle = "#1b0f1e";
    ctx.lineCap = "round";
    for (let i = 1; i < points.length; i++) {
      ctx.lineWidth = from + ((to - from) * i) / points.length;
      ctx.beginPath();
      ctx.moveTo(points[i - 1][0], points[i - 1][1]);
      ctx.lineTo(points[i][0], points[i][1]);
      ctx.stroke();
    }
    ctx.lineCap = "butt";
  };
  branch(
    [
      [-10, 34],
      [40, 52],
      [88, 62],
      [130, 80],
      [176, 88],
      [222, 104],
    ],
    11,
    3,
  );
  branch(
    [
      [72, 58],
      [96, 30],
      [120, 18],
    ],
    5,
    2,
  );
  branch(
    [
      [140, 82],
      [150, 118],
      [168, 140],
    ],
    4,
    1.5,
  );
  branch(
    [
      [30, 50],
      [34, 86],
      [24, 116],
    ],
    4,
    1.5,
  );
  const clusters: [number, number, number][] = [
    [222, 104, 7],
    [120, 18, 6],
    [168, 140, 6],
    [24, 116, 5],
    [96, 66, 4],
    [180, 90, 4],
    [52, 52, 4],
  ];
  for (const [cx, cy, n] of clusters) {
    for (const [dx, dy, size, pick, turn] of layout(`sakura-${cx}`, n, (r) => [(r() - 0.5) * 30, (r() - 0.5) * 22, 4.5 + r() * 3.5, r(), r() * 6])) {
      flower(ctx, cx + dx, cy + dy, size, pick < 0.45 ? "#ffb3c6" : pick < 0.8 ? "#ffd3e0" : "#fff4f8", turn);
    }
  }
}

function blossomLive(ctx: CanvasRenderingContext2D, t: number) {
  ctx.fillStyle = "#ffc4d6";
  for (const [x, y, speed, phase, size] of layout("sakura-petals", 16, (r) => [r() * W, r() * GROUND, 12 + r() * 14, r() * 6.28, 2.6 + r() * 2])) {
    const span = W + 30;
    const px = ((((x + t * speed * 0.7 + Math.sin(t * 1.1 + phase) * 12) % span) + span) % span) - 15;
    const py = ((y + t * speed) % (GROUND + 20)) - 10;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(t * 1.4 + phase);
    ctx.scale(1, 0.35 + 0.65 * Math.abs(Math.sin(t * 2 + phase)));
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.ellipse(0, 0, size, size * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// --- Obsidian & Gold: black marble, veined with gold.

function vein(ctx: CanvasRenderingContext2D, key: string, steps: number, stride: number) {
  const r = seeded(hashKey(key));
  let x = r() * W;
  let y = r() < 0.5 ? 0 : r() * GROUND;
  let angle = Math.PI * (0.25 + r() * 0.5);
  const points: [number, number][] = [[x, y]];
  for (let i = 0; i < steps; i++) {
    angle += (r() - 0.5) * 0.7;
    x += Math.cos(angle) * stride;
    y += Math.sin(angle) * stride;
    points.push([x, y]);
  }
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (const [px, py] of points) ctx.lineTo(px, py);
  ctx.stroke();
  return points;
}

function marbleBack(ctx: CanvasRenderingContext2D) {
  ctx.lineJoin = "round";
  for (let i = 0; i < 8; i++) {
    ctx.strokeStyle = "rgba(190,190,210,0.035)";
    ctx.lineWidth = 7;
    vein(ctx, `marble-${i}`, 46, 14);
    ctx.strokeStyle = "rgba(215,215,230,0.08)";
    ctx.lineWidth = 1;
    vein(ctx, `marble-${i}`, 46, 14);
  }
  // Gold run through the cracks, like mended stone.
  ctx.save();
  ctx.shadowColor = "rgba(255,205,90,0.7)";
  ctx.shadowBlur = 6;
  ctx.strokeStyle = "rgba(214,176,58,0.75)";
  for (let i = 0; i < 3; i++) {
    ctx.lineWidth = 1.3;
    const points = vein(ctx, `gold-${i}`, 40, 13);
    ctx.lineWidth = 0.8;
    for (let k = 6; k < points.length; k += 11) {
      const r = seeded(hashKey(`gold-${i}-${k}`));
      let [x, y] = points[k];
      let angle = r() * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let s = 0; s < 5; s++) {
        angle += (r() - 0.5) * 0.8;
        x += Math.cos(angle) * 8;
        y += Math.sin(angle) * 8;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
  ctx.restore();
  ctx.lineJoin = "miter";
  const sheen = ctx.createLinearGradient(0, 0, W, H);
  sheen.addColorStop(0.3, "rgba(255,255,255,0)");
  sheen.addColorStop(0.5, "rgba(255,255,255,0.045)");
  sheen.addColorStop(0.7, "rgba(255,255,255,0)");
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, W, H);
  vignette(ctx, 0.5);
}

function marbleLive(ctx: CanvasRenderingContext2D, t: number) {
  const mote = glow("#f6d77a");
  for (const [x, y, speed, phase] of layout("marble-dust", 24, (r) => [r() * W, r() * GROUND, 3 + r() * 6, r() * 6.28])) {
    ctx.globalAlpha = 0.15 + 0.45 * Math.pow(Math.sin(t * 0.9 + phase), 2);
    stamp(ctx, mote, x + Math.sin(t * 0.35 + phase) * 10, GROUND - ((GROUND - y + t * speed) % GROUND), 3);
  }
  ctx.globalAlpha = 1;
}

// --- Solar Flare: the edge of the sun, burning above the board.

const SUN = { x: W / 2, y: -430, r: 462 };
const limb = (x: number) => SUN.y + Math.sqrt(Math.max(0, SUN.r * SUN.r - (x - SUN.x) ** 2));

function flareBack(ctx: CanvasRenderingContext2D) {
  const corona = ctx.createRadialGradient(SUN.x, SUN.y, SUN.r - 10, SUN.x, SUN.y, SUN.r + 230);
  corona.addColorStop(0, "rgba(255,150,50,0.55)");
  corona.addColorStop(0.25, "rgba(255,90,25,0.2)");
  corona.addColorStop(1, "rgba(255,60,10,0)");
  ctx.fillStyle = corona;
  ctx.fillRect(0, 0, W, SUN.y + SUN.r + 240);
  const disc = ctx.createRadialGradient(SUN.x, SUN.y, SUN.r * 0.6, SUN.x, SUN.y, SUN.r);
  disc.addColorStop(0, "#fff0b8");
  disc.addColorStop(0.8, "#ffb04a");
  disc.addColorStop(1, "#ff7a22");
  ctx.fillStyle = disc;
  ctx.beginPath();
  ctx.arc(SUN.x, SUN.y, SUN.r, 0, Math.PI * 2);
  ctx.fill();
  // Prominences: loops of fire hanging off the limb.
  ctx.save();
  ctx.shadowColor = "rgba(255,120,40,0.9)";
  ctx.shadowBlur = 10;
  ctx.lineCap = "round";
  for (const [x, span, depth] of [
    [80, 60, 46],
    [300, 90, 62],
    [410, 40, 30],
  ]) {
    ctx.strokeStyle = "rgba(255,110,40,0.5)";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(x, limb(x) - 2);
    ctx.bezierCurveTo(x, limb(x) + depth, x + span, limb(x + span) + depth, x + span, limb(x + span) - 2);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,220,150,0.6)";
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }
  ctx.restore();
  const heat = ctx.createLinearGradient(0, GROUND - 220, 0, GROUND);
  heat.addColorStop(0, "rgba(255,90,20,0)");
  heat.addColorStop(1, "rgba(255,90,20,0.2)");
  ctx.fillStyle = heat;
  ctx.fillRect(0, GROUND - 220, W, 220);
}

function flareLive(ctx: CanvasRenderingContext2D, t: number) {
  // The limb breathing.
  ctx.globalCompositeOperation = "lighter";
  for (const [x, phase] of layout("flare-breath", 4, (r) => [r() * W, r() * 6.28])) {
    ctx.globalAlpha = 0.1 + 0.08 * Math.sin(t * 1.3 + phase);
    stamp(ctx, glow("#ff9a3c"), x, 36, 90);
  }
  ctx.globalCompositeOperation = "source-over";
  const colours = ["#ffb347", "#ff7b29", "#ffd166"];
  for (const [x, y, speed, phase, size, tone] of layout("flare-embers", 26, (r) => [r() * W, r() * GROUND, 14 + r() * 26, r() * 6.28, 1 + r() * 1.4, Math.floor(r() * 3)])) {
    const rise = (GROUND - y + t * speed) % GROUND;
    ctx.globalAlpha = 0.85 * (1 - rise / GROUND);
    stamp(ctx, glow(colours[tone]), x + Math.sin(t * 1.3 + phase) * 9, GROUND - rise, size * 2.6);
  }
  ctx.globalAlpha = 1;
}

// --- Void: a nebula, and a shooting star now and then.

function nebulaBack(ctx: CanvasRenderingContext2D) {
  const colours = ["#6c5ce7", "#a29bfe", "#e84393", "#0984e3", "#00cec9"];
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const [p, off, radius, tone, alpha] of layout("nebula", 34, (r) => [r(), (r() - 0.5) * 170, 50 + r() * 100, Math.floor(r() * 5), 0.06 + r() * 0.09])) {
    const x = p * W + off * 0.5;
    const y = GROUND * (0.9 - p * 0.8) + off;
    const cloud = ctx.createRadialGradient(x, y, 0, x, y, radius);
    cloud.addColorStop(0, fade(colours[tone], alpha));
    cloud.addColorStop(1, fade(colours[tone], 0));
    ctx.fillStyle = cloud;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  ctx.restore();
  for (const [p, off, radius] of layout("nebula-dust", 9, (r) => [r(), (r() - 0.5) * 80, 30 + r() * 50])) {
    const x = p * W;
    const y = GROUND * (0.9 - p * 0.8) + off;
    const dust = ctx.createRadialGradient(x, y, 0, x, y, radius);
    dust.addColorStop(0, "rgba(0,0,0,0.3)");
    dust.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = dust;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  specks(ctx, "nebula-specks", 200, "#ffffff", 0.55);
}

function nebulaLive(ctx: CanvasRenderingContext2D, t: number) {
  twinkle(ctx, "nebula-stars", 36, 0.95, t);
  const period = 6.5;
  const n = Math.floor(t / period);
  const p = (t - n * period) / 0.85;
  if (p >= 1) return;
  const r = seeded(n * 7919 + 13);
  const dir = r() < 0.5 ? 1 : -1;
  const x0 = W * (0.15 + r() * 0.7);
  const y0 = GROUND * (0.05 + r() * 0.3);
  const angle = 0.35 + r() * 0.35;
  const hx = x0 + dir * Math.cos(angle) * p * 240;
  const hy = y0 + Math.sin(angle) * p * 240;
  const tx = hx - dir * Math.cos(angle) * 80;
  const ty = hy - Math.sin(angle) * 80;
  const streak = ctx.createLinearGradient(tx, ty, hx, hy);
  streak.addColorStop(0, "rgba(255,255,255,0)");
  streak.addColorStop(1, `rgba(255,255,255,${0.9 * Math.sin(p * Math.PI)})`);
  ctx.strokeStyle = streak;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(tx, ty);
  ctx.lineTo(hx, hy);
  ctx.stroke();
  ctx.globalAlpha = Math.sin(p * Math.PI);
  stamp(ctx, glow("#ffffff"), hx, hy, 5);
  ctx.globalAlpha = 1;
}

// --- Candy Pop: soft circles of colour, out of focus behind the jelly.

function candy(ctx: CanvasRenderingContext2D, theme: Theme) {
  for (const [x, y, r, tone] of layout("candy", 16, (r) => [r() * W, r() * GROUND, 18 + r() * 60, Math.floor(r() * 6)])) {
    const [face] = theme.board.bricks[tone];
    const dot = ctx.createRadialGradient(x, y, r * 0.2, x, y, r);
    dot.addColorStop(0, fade(face, 0.22));
    dot.addColorStop(1, fade(face, 0));
    ctx.fillStyle = dot;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.lineCap = "round";
  ctx.lineWidth = 3;
  for (const [x, y, angle, tone] of layout("candy-sprinkles", 40, (r) => [r() * W, r() * GROUND, r() * Math.PI, Math.floor(r() * 6)])) {
    ctx.strokeStyle = fade(theme.board.bricks[tone][0], 0.35);
    ctx.beginPath();
    ctx.moveTo(x - Math.cos(angle) * 4, y - Math.sin(angle) * 4);
    ctx.lineTo(x + Math.cos(angle) * 4, y + Math.sin(angle) * 4);
    ctx.stroke();
  }
  ctx.lineCap = "butt";
}

// --- Frostbite: a moon, pines on the ridge, and snow.

function snowBack(ctx: CanvasRenderingContext2D) {
  stamp(ctx, glow("#cfe8ff"), 92, 96, 150);
  ctx.fillStyle = "rgba(240,250,255,0.92)";
  ctx.beginPath();
  ctx.arc(92, 96, 22, 0, Math.PI * 2);
  ctx.fill();
  ridge(ctx, "frost-far", GROUND - 70, 48, "#0b2848", 1.4);
  ctx.fillStyle = "#06182e";
  for (const [x, h] of layout("frost-pines", 16, (r) => [r() * W, 28 + r() * 46])) {
    for (let tier = 0; tier < 3; tier++) {
      const top = GROUND - 14 - h + tier * h * 0.28;
      const half = h * (0.18 + tier * 0.08);
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x + half, top + h * 0.42);
      ctx.lineTo(x - half, top + h * 0.42);
      ctx.closePath();
      ctx.fill();
    }
  }
  ridge(ctx, "snow-drift", GROUND - 6, 22, "rgba(225,242,255,0.16)");
}

function snowLive(ctx: CanvasRenderingContext2D, t: number) {
  const soft = glow("#ffffff");
  for (const [x, y, size, speed, phase] of layout("snow", 100, (r) => [r() * W, r() * GROUND, 0.6 + r() * 2.2, 10 + r() * 30, r() * 6.28])) {
    ctx.globalAlpha = 0.3 + size * 0.22;
    stamp(ctx, soft, x + Math.sin(t * 0.7 + phase) * 9, (y + t * speed) % GROUND, size * 1.7);
  }
  ctx.globalAlpha = 1;
}

// --- Sumi-e: rice paper, a red sun and mountains washed in grey.

function ink(ctx: CanvasRenderingContext2D) {
  for (const [x, y, size, tone] of layout("ink-paper", 260, (r) => [r() * W, r() * H, r() * 1.2 + 0.2, r()])) {
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
    const [a, b, c] = once(key, (r) => [r() * 6, r() * 6, r() * 6]);
    const wash = ctx.createLinearGradient(0, base - height, 0, base + 90);
    wash.addColorStop(0, `rgba(40,32,26,${alpha})`);
    wash.addColorStop(1, "rgba(40,32,26,0)");
    ctx.fillStyle = wash;
    ctx.beginPath();
    ctx.moveTo(0, GROUND);
    for (let x = 0; x <= W; x += 4) {
      const peak = Math.pow(Math.abs(Math.sin(x * 0.009 + a)), 1.6);
      ctx.lineTo(x, base - height * (0.25 + 0.6 * peak + 0.1 * Math.sin(x * 0.05 + b) + 0.05 * Math.sin(x * 0.17 + c)));
    }
    ctx.lineTo(W, GROUND);
    ctx.closePath();
    ctx.fill();
  }
  // Three birds, a few strokes each, crossing the sun.
  ctx.strokeStyle = "rgba(40,32,26,0.55)";
  ctx.lineWidth = 1.3;
  for (const [x, y, s] of [
    [W * 0.6, 120, 1],
    [W * 0.66, 104, 0.8],
    [W * 0.55, 98, 0.7],
  ]) {
    ctx.beginPath();
    ctx.moveTo(x - 7 * s, y - 2 * s);
    ctx.quadraticCurveTo(x - 3 * s, y - 5 * s, x, y);
    ctx.quadraticCurveTo(x + 3 * s, y - 5 * s, x + 7 * s, y - 2 * s);
    ctx.stroke();
  }
}

// --- Outrun: a striped sun sinking into a grid that runs towards you.

const HORIZON = 392;

function outrunBack(ctx: CanvasRenderingContext2D, theme: Theme) {
  const cx = W / 2;
  const radius = 118;
  const halo = ctx.createRadialGradient(cx, HORIZON - 40, 20, cx, HORIZON - 40, 230);
  halo.addColorStop(0, "rgba(255,43,214,0.35)");
  halo.addColorStop(1, "rgba(255,43,214,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(0, HORIZON - 270, W, 270);
  specks(ctx, "outrun-specks", 70, "#ffffff", 0.5, HORIZON - 120);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, W, HORIZON);
  for (let i = 0; i < 7; i++) ctx.rect(W, HORIZON - 8 - i * i * 2.6 - i * 7, -W, Math.max(1.2, 7 - i * 0.95));
  ctx.clip("evenodd");
  const sun = ctx.createLinearGradient(0, HORIZON - radius, 0, HORIZON);
  sun.addColorStop(0, "#ffe259");
  sun.addColorStop(0.55, "#ff7a3d");
  sun.addColorStop(1, "#ff2bd6");
  ctx.fillStyle = sun;
  ctx.beginPath();
  ctx.arc(cx, HORIZON, radius, Math.PI, 0);
  ctx.fill();
  ctx.restore();
  // Mountains either side of the road, outlined in light.
  const ranges: [number, number][][] = [
    [
      [0, 330],
      [40, 352],
      [74, 318],
      [118, 360],
      [150, HORIZON],
    ],
    [
      [W, 340],
      [W - 34, 318],
      [W - 80, 356],
      [W - 112, 334],
      [W - 160, HORIZON],
    ],
  ];
  for (const peaks of ranges) {
    ctx.fillStyle = "#14022a";
    ctx.beginPath();
    ctx.moveTo(peaks[0][0], HORIZON);
    for (const [x, y] of peaks) ctx.lineTo(x, y);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(0,229,255,0.55)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(peaks[0][0], peaks[0][1]);
    for (const [x, y] of peaks) ctx.lineTo(x, y);
    ctx.stroke();
  }
  const plane = ctx.createLinearGradient(0, HORIZON, 0, H);
  plane.addColorStop(0, "#1a0336");
  plane.addColorStop(1, "#090014");
  ctx.fillStyle = plane;
  ctx.fillRect(0, HORIZON, W, H - HORIZON);
  ctx.strokeStyle = theme.board.line;
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let k = -9; k <= 9; k++) {
    ctx.moveTo(cx + k * 9, HORIZON);
    ctx.lineTo(cx + k * 78, H);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
  const line = ctx.createLinearGradient(0, 0, W, 0);
  line.addColorStop(0, "rgba(255,43,214,0)");
  line.addColorStop(0.5, "rgba(255,180,240,0.95)");
  line.addColorStop(1, "rgba(255,43,214,0)");
  ctx.fillStyle = line;
  ctx.fillRect(0, HORIZON - 1, W, 2);
}

function outrunLive(ctx: CanvasRenderingContext2D, theme: Theme, t: number) {
  twinkle(ctx, "outrun", 26, 0.75, t, HORIZON - 140);
  ctx.strokeStyle = theme.board.line;
  ctx.lineWidth = 1;
  const scroll = (t * 0.45) % 1;
  for (let i = 0; i < 14; i++) {
    const p = (i + scroll) / 14;
    const y = HORIZON + (H - HORIZON) * Math.pow(p, 2.1);
    ctx.globalAlpha = 0.15 + 0.6 * p;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// --- Crystal Cavern: light pooled in the dark, crystals growing from the corners.

function caveBack(ctx: CanvasRenderingContext2D, theme: Theme) {
  const pools: [number, number, number, string][] = [
    [70, 110, 190, "#9b5de5"],
    [420, 280, 200, "#06d6a0"],
    [170, 470, 170, "#3a86ff"],
  ];
  for (const [x, y, r, colour] of pools) {
    const pool = ctx.createRadialGradient(x, y, 0, x, y, r);
    pool.addColorStop(0, fade(colour, 0.22));
    pool.addColorStop(1, fade(colour, 0));
    ctx.fillStyle = pool;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // The roof of the cave, dripping.
  ctx.fillStyle = "#05020b";
  ctx.beginPath();
  ctx.moveTo(0, 0);
  for (const [x, depth] of [...layout("cave-roof", 24, (r) => [r(), 6 + r() * 30])].sort((a, b) => a[0] - b[0])) {
    ctx.lineTo(x * W - 6, 3);
    ctx.lineTo(x * W, depth);
    ctx.lineTo(x * W + 6, 3);
  }
  ctx.lineTo(W, 0);
  ctx.closePath();
  ctx.fill();
  for (const [x0, dir] of [
    [0, 1],
    [W, -1],
  ]) {
    for (const [offset, height, width, lean, tone] of layout(`cave-${dir}`, 6, (r) => [r() * 70, 40 + r() * 110, 10 + r() * 14, (r() - 0.5) * 0.5, Math.floor(r() * 6)])) {
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
}

function caveLive(ctx: CanvasRenderingContext2D, t: number) {
  ctx.fillStyle = "#ffffff";
  for (const [x, y, size, phase, speed] of layout("cave-glints", 34, (r) => [r() * W, r() * (GROUND - 20), 1.5 + r() * 3, r() * 6.28, 0.5 + r() * 1.2])) {
    const on = Math.pow(Math.max(0, Math.sin(t * speed + phase)), 6);
    if (on < 0.02) continue;
    ctx.globalAlpha = on * 0.9;
    sparkle(ctx, x, y, size * (0.6 + on));
  }
  ctx.globalAlpha = 1;
}

// --- Mainnet: a ledger grid, and value travelling along the beams.

const BEAM = GROUND * 0.9;
const beams = () => layout("pulse", 6, (r) => [r() * (W + GROUND) - GROUND * 0.5, 0.05 + r() * 0.12, r()]);

function pulseBack(ctx: CanvasRenderingContext2D) {
  for (const [x, y, r, colour] of [
    [W * 0.2, H * 0.15, 330, "153,69,255"],
    [W * 0.85, GROUND * 0.8, 300, "20,241,149"],
  ] as const) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${colour},0.24)`);
    g.addColorStop(1, `rgba(${colour},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
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
  for (const [offset] of beams()) {
    const beam = ctx.createLinearGradient(offset, GROUND, offset + BEAM, 0);
    beam.addColorStop(0, "rgba(153,69,255,0)");
    beam.addColorStop(0.5, "rgba(153,69,255,0.22)");
    beam.addColorStop(1, "rgba(20,241,149,0.22)");
    ctx.strokeStyle = beam;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(offset, GROUND);
    ctx.lineTo(offset + BEAM, 0);
    ctx.stroke();
  }
}

function pulseLive(ctx: CanvasRenderingContext2D, t: number) {
  for (const [offset, speed, start] of beams()) {
    const p = (start + t * speed) % 1;
    stamp(ctx, glow(p < 0.5 ? "#b57bff" : "#3dffb0"), offset + BEAM * p, GROUND - GROUND * p, 9);
  }
}

// --- Aurora: curtains of light over a ridge.

function auroraBack(ctx: CanvasRenderingContext2D, theme: Theme) {
  specks(ctx, "aurora-specks", 120, "#ffffff", 0.45, GROUND - 60);
  ridge(ctx, "aurora-far", GROUND - 70, 34, mix(theme.board.sky[1], "#000000", 0.25));
  ridge(ctx, "aurora-near", GROUND - 30, 26, mix(theme.board.floor, "#000000", 0.2));
}

const CURTAINS = ["#5cffc6", "#8f7cff", "#3ad6ff"];

function auroraLive(ctx: CanvasRenderingContext2D, t: number) {
  twinkle(ctx, "aurora", 50, 0.8, t, GROUND - 90);
  const scale = 0.25;
  const layer = liveLayer("aurora", scale, 15, t, GROUND, (g, time) => {
    g.globalCompositeOperation = "lighter";
    CURTAINS.forEach((colour, k) => {
      const curtain = g.createLinearGradient(0, 0, 0, 1);
      curtain.addColorStop(0, fade(colour, 0));
      curtain.addColorStop(0.55, fade(colour, 0.7));
      curtain.addColorStop(1, fade(colour, 0));
      g.fillStyle = curtain;
      for (let x = 0; x < W; x += 3) {
        const top = 70 + k * 46 + Math.sin(x * 0.011 + time * 0.22 + k * 1.7) * 30 + Math.sin(x * 0.029 - time * 0.37 + k) * 10;
        const height = 150 + Math.sin(x * 0.019 + time * 0.5 + k * 2.1) * 55;
        g.globalAlpha = Math.max(0, 0.3 + 0.16 * Math.sin(x * 0.034 + time * 0.8 + k * 3) + 0.06 * Math.sin(x * 0.11 - time * 1.3));
        g.setTransform(scale, 0, 0, scale * height, x * scale, top * scale);
        g.fillRect(0, 0, 3.2, 1);
      }
    });
    g.setTransform(scale, 0, 0, scale, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  });
  ctx.globalCompositeOperation = "lighter";
  ctx.drawImage(layer, 0, 0, W, GROUND);
  ctx.globalCompositeOperation = "source-over";
}

// --- High Roller: baize, with a pattern woven in and a gold rail round it.

function feltBack(ctx: CanvasRenderingContext2D, theme: Theme) {
  const light = ctx.createRadialGradient(W / 2, H * 0.42, 40, W / 2, H * 0.42, H * 0.75);
  light.addColorStop(0, "rgba(255,255,255,0.10)");
  light.addColorStop(0.6, "rgba(0,0,0,0)");
  light.addColorStop(1, "rgba(0,0,0,0.5)");
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, W, H);
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
  ctx.strokeStyle = fade(theme.board.line, 0.35);
  ctx.lineWidth = 1;
  ctx.strokeRect(5.5, 5.5, W - 11, H - 11);
}

function feltLive(ctx: CanvasRenderingContext2D, t: number) {
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
}

// --- Blueprint: the board as it was drawn before anyone played it — a drafting
// sheet ruled to the board's own cells, a protractor round the launch point,
// the dimensions down the side, a title block in the corner, and the plotter
// still crossing the sheet.

const DRAFT = "ui-monospace, monospace";

/** A dimension line: the extent between two ticks, with its figure in a gap at the middle. */
function dimension(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, label: string) {
  const vertical = x1 === x2;
  const mid = { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
  const gap = label.length * 3.6 + 8;
  ctx.beginPath();
  if (vertical) {
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1, mid.y - gap);
    ctx.moveTo(x1, mid.y + gap);
    ctx.lineTo(x1, y2);
    for (const y of [y1, y2]) {
      ctx.moveTo(x1 - 4, y);
      ctx.lineTo(x1 + 4, y);
    }
  } else {
    ctx.moveTo(x1, y1);
    ctx.lineTo(mid.x - gap, y1);
    ctx.moveTo(mid.x + gap, y1);
    ctx.lineTo(x2, y1);
    for (const x of [x1, x2]) {
      ctx.moveTo(x, y1 - 4);
      ctx.lineTo(x, y1 + 4);
    }
  }
  ctx.stroke();
  ctx.save();
  ctx.translate(mid.x, mid.y);
  if (vertical) ctx.rotate(-Math.PI / 2);
  ctx.fillText(label, 0, 0);
  ctx.restore();
}

function blueprintBack(ctx: CanvasRenderingContext2D, theme: Theme) {
  // The sheet, lit in the middle and darker at its edges.
  const light = ctx.createRadialGradient(W / 2, H * 0.38, 30, W / 2, H * 0.38, H * 0.82);
  light.addColorStop(0, "rgba(140,195,255,0.10)");
  light.addColorStop(1, "rgba(0,8,24,0.42)");
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, W, H);
  // Fine squares, then the board's own cells ruled over them.
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(170,215,255,0.045)";
  ctx.beginPath();
  for (let x = CW / 4; x < W; x += CW / 4) {
    ctx.moveTo(Math.round(x) + 0.5, 0);
    ctx.lineTo(Math.round(x) + 0.5, GROUND);
  }
  for (let y = RH / 4; y < GROUND; y += RH / 4) {
    ctx.moveTo(0, Math.round(y) + 0.5);
    ctx.lineTo(W, Math.round(y) + 0.5);
  }
  ctx.stroke();
  ctx.strokeStyle = "rgba(170,215,255,0.11)";
  ctx.beginPath();
  for (let x = CW; x < W - 1; x += CW) {
    ctx.moveTo(Math.round(x) + 0.5, 0);
    ctx.lineTo(Math.round(x) + 0.5, GROUND);
  }
  for (let y = RH; y < GROUND; y += RH) {
    ctx.moveTo(0, Math.round(y) + 0.5);
    ctx.lineTo(W, Math.round(y) + 0.5);
  }
  ctx.stroke();
  // A protractor round the launch point: the angles the game is played with.
  ctx.save();
  ctx.translate(W / 2, GROUND);
  ctx.strokeStyle = "rgba(190,228,255,0.12)";
  ctx.setLineDash([3, 5]);
  for (const r of [150, 236]) {
    ctx.beginPath();
    ctx.arc(0, 0, r, Math.PI, Math.PI * 2);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(190,228,255,0.26)";
  ctx.font = `9px ${DRAFT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.beginPath();
  for (let deg = 10; deg < 180; deg += 10) {
    const a = Math.PI + (deg * Math.PI) / 180;
    const long = deg % 30 === 0;
    ctx.moveTo(Math.cos(a) * 150, Math.sin(a) * 150);
    ctx.lineTo(Math.cos(a) * (long ? 162 : 156), Math.sin(a) * (long ? 162 : 156));
    if (long) ctx.fillText(`${deg}°`, Math.cos(a) * 174, Math.sin(a) * 174);
  }
  ctx.stroke();
  ctx.restore();
  // The board's dimensions, as a drafter would mark them.
  ctx.strokeStyle = "rgba(190,228,255,0.22)";
  ctx.fillStyle = "rgba(190,228,255,0.34)";
  ctx.font = `9px ${DRAFT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  dimension(ctx, 12, 12, W - 12, 12, `${W}`);
  dimension(ctx, W - 12, 26, W - 12, GROUND - 8, `${Math.round(GROUND)}`);
  // The title block, in the corner of the floor.
  const bw = 170;
  const bh = 46;
  const bx = W - bw - 10;
  const by = GROUND + (H - GROUND - bh) / 2;
  ctx.strokeStyle = "rgba(190,228,255,0.30)";
  ctx.strokeRect(bx + 0.5, by + 0.5, bw, bh);
  ctx.beginPath();
  ctx.moveTo(bx, by + 18.5);
  ctx.lineTo(bx + bw, by + 18.5);
  ctx.moveTo(bx + 112.5, by + 18);
  ctx.lineTo(bx + 112.5, by + bh);
  ctx.stroke();
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(220,240,255,0.55)";
  ctx.font = `bold 10px ${DRAFT}`;
  ctx.fillText("BOUNCE · BOARD 01", bx + 7, by + 10);
  ctx.font = `8px ${DRAFT}`;
  ctx.fillStyle = "rgba(190,228,255,0.4)";
  ctx.fillText("DRAWN BY THE FIRST", bx + 7, by + 27);
  ctx.fillText("PLAYERS", bx + 7, by + 38);
  ctx.fillText("REV. BETA", bx + 119, by + 27);
  ctx.fillText(`${COLS_LABEL} × ${ROWS_LABEL}`, bx + 119, by + 38);
  ctx.textBaseline = "alphabetic";
  // The sheet's border.
  ctx.strokeStyle = fade(theme.board.line, 0.3);
  ctx.strokeRect(4.5, 4.5, W - 9, H - 9);
}
const COLS_LABEL = Math.round(W / CW);
const ROWS_LABEL = Math.round(GROUND / RH);

function blueprintLive(ctx: CanvasRenderingContext2D, t: number) {
  // The plotter head crossing the sheet, its line and its crosshair.
  const run = (t * 0.07) % 1.25;
  if (run > 1) return;
  const x = run * W;
  const y = GROUND * (0.18 + 0.64 * (0.5 + 0.5 * Math.sin(t * 0.9)));
  const beam = ctx.createLinearGradient(x - 26, 0, x + 2, 0);
  beam.addColorStop(0, "rgba(190,228,255,0)");
  beam.addColorStop(1, "rgba(190,228,255,0.12)");
  ctx.fillStyle = beam;
  ctx.fillRect(x - 26, 0, 28, GROUND);
  ctx.strokeStyle = "rgba(220,240,255,0.45)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + 0.5, 0);
  ctx.lineTo(x + 0.5, GROUND);
  ctx.moveTo(x - 7, y);
  ctx.lineTo(x + 8, y);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x + 0.5, y, 3.5, 0, Math.PI * 2);
  ctx.stroke();
}

// ------------------------------------------------------------------ bricks

/** A brick's size, the same for every brick (lib/engine.ts brickRect). */
export const BRICK_W = CW - 10;
export const BRICK_H = RH - 10;
/** How far a brick's paint may spill outside its cell: a glow, a shadow, its depth. */
export const brickPad = (theme: Theme) => (theme.board.brick === "neon" ? 12 : theme.board.brick === "crt" ? 9 : theme.board.brick === "paper" ? 8 : 6);
/** Bricks that differ cell to cell (a brushstroke, a piece of card, a crust) come in this many cuts. */
export const VARIANTS = 4;
export const hasVariants = (theme: Theme) => theme.board.brick === "ink" || theme.board.brick === "paper" || theme.board.brick === "magma";
/** The cut a cell gets: fixed by where it is, so a brick never changes shape. */
export const variantAt = (x: number, y: number) => Math.floor(hash2(x, y) * VARIANTS);

type Rect = { x: number; y: number; w: number; h: number };

/**
 * Paints one brick in the theme's style inside `r`: into a sprite, once per
 * colour (and cut, for the styles that have them).
 */
export function paintBrick(ctx: CanvasRenderingContext2D, theme: Theme, r: Rect, face: string, shade: string, variant: number) {
  const radius = theme.board.radius;
  const vary = (k: number) => hash2(variant * 97 + k * 13, k * 7 + variant);
  switch (theme.board.brick ?? "flat") {
    case "flat": {
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
      return;
    }
    case "paper": {
      // A piece of card, never quite square, with its shadow on the page.
      ctx.save();
      ctx.translate(r.x + r.w / 2, r.y + r.h / 2);
      ctx.rotate((vary(1) - 0.5) * 0.035);
      ctx.translate(-r.w / 2, -r.h / 2);
      ctx.shadowColor = "rgba(80,55,20,0.32)";
      ctx.shadowBlur = 5;
      ctx.shadowOffsetY = 3;
      ctx.fillStyle = face;
      ctx.beginPath();
      ctx.roundRect(0, 0, r.w, r.h - 1, radius);
      ctx.fill();
      ctx.shadowColor = "transparent";
      // The fibres of the card.
      for (let k = 0; k < 14; k++) {
        ctx.fillStyle = k % 2 ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.05)";
        ctx.fillRect(2 + vary(k + 10) * (r.w - 10), 2 + vary(k + 40) * (r.h - 6), 3 + vary(k + 70) * 6, 0.8);
      }
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.fillRect(radius, 0.5, r.w - radius * 2, 1);
      ctx.fillStyle = fade(shade, 0.55);
      ctx.fillRect(radius, r.h - 2.5, r.w - radius * 2, 1.5);
      ctx.restore();
      return;
    }
    case "pixel": {
      // An eight-bit block: lit on two sides, shaded on the other two.
      const b = 4;
      const { x, y, w, h } = r;
      ctx.fillStyle = shade;
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = mix(face, "#ffffff", 0.5);
      ctx.fillRect(x, y, w - b, b);
      ctx.fillRect(x, y, b, h - b);
      ctx.fillStyle = face;
      ctx.fillRect(x + b, y + b, w - b * 2, h - b * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(x + b + 2, y + b + 2, 4, 4);
      ctx.fillRect(x + b + 6, y + b + 2, 4, 2);
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(x + w - b, y, b, b);
      ctx.fillRect(x, y + h - b, b, b);
      return;
    }
    case "pearl": {
      ctx.fillStyle = shade;
      ctx.beginPath();
      ctx.roundRect(r.x, r.y + 3, r.w, r.h, radius);
      ctx.fill();
      const body = ctx.createRadialGradient(r.x + r.w * 0.3, r.y + r.h * 0.22, 2, r.x + r.w * 0.5, r.y + r.h * 0.5, r.w * 0.78);
      body.addColorStop(0, mix(face, "#ffffff", 0.55));
      body.addColorStop(0.5, face);
      body.addColorStop(1, mix(face, shade, 0.55));
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.roundRect(r.x, r.y, r.w, r.h - 2, radius);
      ctx.fill();
      // The rainbow sheen a pearl carries round its edge.
      const nacre = ctx.createLinearGradient(r.x, r.y, r.x + r.w, r.y + r.h);
      nacre.addColorStop(0, "rgba(255,200,230,0.6)");
      nacre.addColorStop(0.5, "rgba(190,255,250,0.5)");
      nacre.addColorStop(1, "rgba(255,240,190,0.55)");
      ctx.strokeStyle = nacre;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.roundRect(r.x + 0.8, r.y + 0.8, r.w - 1.6, r.h - 3.6, radius);
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.beginPath();
      ctx.ellipse(r.x + r.w * 0.27, r.y + r.h * 0.2, 5, 2.6, -0.5, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    case "crt": {
      // A block of phosphor: glowing a little past its edge, with scanlines through it.
      ctx.fillStyle = shade;
      ctx.fillRect(r.x, r.y + 3, r.w, r.h - 1);
      ctx.save();
      ctx.shadowColor = fade(face, 0.6);
      ctx.shadowBlur = 9;
      const body = ctx.createRadialGradient(r.x + r.w / 2, r.y + r.h / 2, 4, r.x + r.w / 2, r.y + r.h / 2, r.w * 0.75);
      body.addColorStop(0, mix(face, "#ffffff", 0.22));
      body.addColorStop(1, face);
      ctx.fillStyle = body;
      ctx.fillRect(r.x, r.y, r.w, r.h - 2);
      ctx.restore();
      ctx.fillStyle = "rgba(0,0,0,0.13)";
      for (let y = r.y + 1; y < r.y + r.h - 3; y += 3) ctx.fillRect(r.x, y, r.w, 1.1);
      return;
    }
    case "petal": {
      ctx.fillStyle = shade;
      ctx.beginPath();
      ctx.roundRect(r.x, r.y + 3, r.w, r.h, radius);
      ctx.fill();
      const body = ctx.createLinearGradient(0, r.y, 0, r.y + r.h);
      body.addColorStop(0, mix(face, "#ffffff", 0.4));
      body.addColorStop(1, face);
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.roundRect(r.x, r.y, r.w, r.h - 2, radius);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.roundRect(r.x + 2.5, r.y + 2.5, r.w - 5, r.h - 7, Math.max(2, radius - 2.5));
      ctx.stroke();
      // A blossom pressed into the corner.
      ctx.globalAlpha = 0.7;
      flower(ctx, r.x + r.w - 10, r.y + 10, 6, "#ffffff", 0.3);
      ctx.globalAlpha = 1;
      return;
    }
    case "metal": {
      // Beaten gold leaf: bands of light across it, a bevel round it.
      ctx.fillStyle = mix(shade, "#000000", 0.35);
      ctx.fillRect(r.x, r.y + 3, r.w, r.h);
      const body = ctx.createLinearGradient(r.x, r.y, r.x + r.w * 0.6, r.y + r.h);
      body.addColorStop(0, mix(face, "#ffffff", 0.45));
      body.addColorStop(0.3, face);
      body.addColorStop(0.55, mix(face, shade, 0.3));
      body.addColorStop(0.75, face);
      body.addColorStop(1, mix(face, shade, 0.5));
      ctx.fillStyle = body;
      ctx.fillRect(r.x, r.y, r.w, r.h - 2);
      for (let k = 0; k < 18; k++) {
        ctx.fillStyle = k % 2 ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.05)";
        ctx.fillRect(r.x, r.y + 2 + hash2(k, face.length) * (r.h - 6), r.w, 0.7);
      }
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.fillRect(r.x, r.y, r.w, 1.2);
      ctx.fillRect(r.x, r.y, 1.2, r.h - 2);
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.fillRect(r.x, r.y + r.h - 3.2, r.w, 1.2);
      ctx.fillRect(r.x + r.w - 1.2, r.y, 1.2, r.h - 2);
      ctx.strokeStyle = fade(theme.board.stroke ?? "#fff3c8", 0.4);
      ctx.lineWidth = 0.8;
      ctx.strokeRect(r.x + 4.5, r.y + 4.5, r.w - 9, r.h - 11);
      return;
    }
    case "magma": {
      // A burning core inside a darker crust, with fire in the cracks.
      ctx.fillStyle = mix(shade, "#000000", 0.4);
      ctx.beginPath();
      ctx.roundRect(r.x, r.y + 4, r.w, r.h, radius);
      ctx.fill();
      const cx = r.x + r.w / 2;
      const cy = r.y + r.h / 2;
      const body = ctx.createRadialGradient(cx, cy - 2, 3, cx, cy, r.w * 0.72);
      body.addColorStop(0, mix(face, "#ffffff", 0.4));
      body.addColorStop(0.45, face);
      body.addColorStop(1, shade);
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.roundRect(r.x, r.y, r.w, r.h - 2, radius);
      ctx.fill();
      ctx.save();
      ctx.clip();
      // Flakes of cooled crust round the rim, never over the number.
      ctx.fillStyle = mix(shade, "#000000", 0.3, 0.32);
      for (let k = 0; k < 7; k++) {
        const side = k % 4;
        const along = vary(k) * (side % 2 ? r.h : r.w);
        const px = side === 0 ? r.x + along : side === 2 ? r.x + r.w - along : side === 1 ? r.x + r.w - 2 : r.x + 2;
        const py = side === 0 ? r.y + 2 : side === 2 ? r.y + r.h - 4 : r.y + along;
        ctx.beginPath();
        ctx.ellipse(px, py, 1.6 + vary(k + 20) * 3, 1 + vary(k + 30) * 1.6, vary(k + 40) * 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      ctx.strokeStyle = mix(face, "#fff4c0", 0.5, 0.55);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(r.x + 1.5, r.y + 1.5, r.w - 3, r.h - 5, Math.max(1, radius - 1.5));
      ctx.stroke();
      return;
    }
    case "glass": {
      ctx.fillStyle = fade(shade, 0.3);
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
      if (theme.board.scene === "snow") {
        // Frost creeping in from two corners.
        ctx.strokeStyle = "rgba(255,255,255,0.75)";
        ctx.lineWidth = 0.7;
        for (const [fx, fy, base] of [
          [r.x, r.y + r.h - 2, -Math.PI / 2],
          [r.x + r.w, r.y, Math.PI / 2],
        ]) {
          for (let k = 0; k < 4; k++) {
            const a = base + (k / 3) * (Math.PI / 2);
            const len = 6 + vary(k + (fx === r.x ? 0 : 20)) * 9;
            const ex = fx + Math.cos(a) * len;
            const ey = fy + Math.sin(a) * len;
            const mx = fx + (ex - fx) * 0.55;
            const my = fy + (ey - fy) * 0.55;
            ctx.beginPath();
            ctx.moveTo(fx, fy);
            ctx.lineTo(ex, ey);
            ctx.moveTo(mx, my);
            ctx.lineTo(mx + Math.cos(a + 0.7) * 3.5, my + Math.sin(a + 0.7) * 3.5);
            ctx.stroke();
          }
        }
      }
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
      return;
    }
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
      ctx.ellipse(r.x + r.w / 2, r.y + r.h * 0.22, r.w * 0.34, r.h * 0.11, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.2)";
      ctx.beginPath();
      ctx.ellipse(r.x + r.w / 2, r.y + r.h * 0.84, r.w * 0.26, r.h * 0.05, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.beginPath();
      ctx.arc(r.x + r.w * 0.2, r.y + r.h * 0.21, 2.4, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    case "ink": {
      // A brushstroke: the edges never quite straight, the paint never quite even.
      const jitter = (k: number) => (vary(k) - 0.5) * 4;
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
      ctx.strokeStyle = "rgba(245,237,220,0.18)";
      ctx.lineWidth = 1;
      for (let k = 0; k < 3; k++) {
        const sy = r.y + 8 + (r.h - 16) * vary(k + 50);
        ctx.beginPath();
        ctx.moveTo(r.x + 4 + k * 6, sy);
        ctx.lineTo(r.x + r.w - 6 - k * 3, sy + (k - 1) * 1.5);
        ctx.stroke();
      }
      return;
    }
    case "neon": {
      // A tube of light round a pane of dark glass the scene cannot shine through.
      ctx.beginPath();
      ctx.roundRect(r.x + 1, r.y + 1, r.w - 2, r.h - 4, radius);
      ctx.fillStyle = fade(neonInside(theme), 0.9);
      ctx.fill();
      ctx.fillStyle = fade(face, 0.1);
      ctx.fill();
      ctx.save();
      ctx.shadowColor = face;
      ctx.shadowBlur = 14;
      ctx.strokeStyle = face;
      ctx.lineWidth = 2.2;
      ctx.stroke();
      ctx.restore();
      ctx.strokeStyle = "rgba(255,255,255,0.6)";
      ctx.lineWidth = 0.7;
      ctx.stroke();
      return;
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
      return;
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
      return;
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
      // The edge inserts every casino chip carries: red on a pale chip, white on the rest.
      const [cr, cg] = rgba(face);
      ctx.fillStyle = cr > 200 && cg > 200 ? "#c8102e" : "rgba(255,255,255,0.88)";
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
      ctx.fillStyle = mixHex(face, "#000000", 0.28);
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
      return;
    }
  }
}

/** Whether a brick style has something that moves on it: a glint, a sheen. */
export const hasLiveBrick = (theme: Theme) => theme.board.brick === "gem" || theme.board.brick === "glass" || theme.board.brick === "metal";

/**
 * The part of a brick that moves, drawn over its sprite: a gem catching the
 * light now and then, a sheen sliding across glass or gold. Each brick gets
 * its turn, so only a few are ever being drawn at once.
 */
export function paintBrickLive(ctx: CanvasRenderingContext2D, theme: Theme, r: Rect, t: number) {
  const seed = hash2(r.x, r.y);
  if (theme.board.brick === "gem") {
    const on = Math.pow(Math.max(0, Math.sin(t * 1.4 + seed * 40)), 10);
    if (on < 0.02) return;
    ctx.fillStyle = `rgba(255,255,255,${on})`;
    sparkle(ctx, r.x + 12, r.y + 11, 4 + on * 5);
    return;
  }
  // A sheen crosses each pane in a little over a second, every seven or nine.
  const cycle = theme.board.brick === "metal" ? 7 : 9;
  const p = ((t + seed * cycle) % cycle) / 1.3;
  if (p >= 1) return;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h - 2, theme.board.radius);
  ctx.clip();
  ctx.translate(r.x - 20 + (r.w + 40) * p, r.y);
  ctx.rotate(0.45);
  ctx.fillStyle = theme.board.brick === "metal" ? "rgba(255,250,220,0.4)" : "rgba(255,255,255,0.22)";
  ctx.fillRect(-6, -20, 9, r.h + 40);
  ctx.fillRect(7, -20, 3, r.h + 40);
  ctx.restore();
}

export { glow as glowSprite };
