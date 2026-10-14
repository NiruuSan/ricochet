"use client";
import { GROUND, H, W } from "@/lib/engine";
import type { Theme } from "@/lib/themes";

// What a broken brick leaves behind.
//
// The engine is untouched by any of this: particles are drawn after the board
// and never asked about. They live in one flat array with a hard ceiling, so a
// forty-ball shot on a full board costs the same as a single one — a phone
// mid-match is the worst place to allocate.

type Kind = Theme["effects"]["burst"] | Theme["effects"]["bounce"] | "blot" | "firework";

type Particle = {
  kind: Kind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Seconds lived, and how many it gets. */
  age: number;
  life: number;
  size: number;
  colour: string;
  spin: number;
  turn: number;
  glyph?: string;
};

/** Past this, the oldest go. Well above what one shot ever asks for. */
const MAX = 260;
const particles: Particle[] = [];
let last = 0;

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const GLYPHS = "01<>{}[]#$%&*/\\|";

function add(p: Particle) {
  if (particles.length >= MAX) particles.shift();
  particles.push(p);
}

/** A brick has gone: throw something out of the cell it stood in. */
export function emitBreak(theme: Theme, x: number, y: number, colour: string) {
  const burst = theme.effects.burst;
  const count = burst === "pixels" ? 10 : burst === "dust" ? 14 : burst === "coins" ? 6 : burst === "sprinkles" ? 12 : 8;
  if (burst === "ink") {
    // One blot that spreads where the brick stood, and drops flicked off it.
    add({ kind: "blot", x, y, vx: 0, vy: 0, age: 0, life: 0.9, size: 8, colour, spin: 0, turn: 0 });
  }
  for (let i = 0; i < count; i++) {
    const angle = rand(0, Math.PI * 2);
    const speed = rand(30, 130);
    switch (burst) {
      case "shards":
        add({ kind: burst, x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 40, age: 0, life: rand(0.4, 0.75), size: rand(3, 7), colour, spin: rand(-8, 8), turn: 0 });
        break;
      case "sparks":
        add({ kind: burst, x, y, vx: Math.cos(angle) * speed * 1.6, vy: Math.sin(angle) * speed * 1.6, age: 0, life: rand(0.2, 0.45), size: rand(1.5, 3), colour, spin: 0, turn: 0 });
        break;
      case "pixels":
        add({ kind: burst, x: x + rand(-14, 14), y: y + rand(-10, 10), vx: rand(-40, 40), vy: rand(-90, -20), age: 0, life: rand(0.35, 0.6), size: 4, colour, spin: 0, turn: 0 });
        break;
      case "bubbles":
        add({ kind: burst, x: x + rand(-16, 16), y, vx: rand(-14, 14), vy: rand(-90, -40), age: 0, life: rand(0.8, 1.4), size: rand(2, 6), colour, spin: rand(1, 3), turn: rand(0, 6) });
        break;
      case "petals":
        add({ kind: burst, x, y, vx: rand(-40, 40), vy: rand(-20, 30), age: 0, life: rand(1, 1.8), size: rand(3, 6), colour, spin: rand(-3, 3), turn: rand(0, 6) });
        break;
      case "embers":
        add({ kind: burst, x: x + rand(-12, 12), y, vx: rand(-25, 25), vy: rand(-110, -45), age: 0, life: rand(0.6, 1.2), size: rand(1.5, 3.5), colour, spin: 0, turn: rand(0, 6) });
        break;
      case "dust":
        add({ kind: burst, x: x + rand(-18, 18), y: y + rand(-12, 12), vx: rand(-18, 18), vy: rand(-26, -4), age: 0, life: rand(0.9, 1.6), size: rand(0.8, 2.2), colour, spin: 0, turn: 0 });
        break;
      case "glyphs":
        add({ kind: burst, x: x + rand(-16, 16), y, vx: rand(-8, 8), vy: rand(20, 80), age: 0, life: rand(0.5, 1), size: 13, colour, spin: 0, turn: 0, glyph: GLYPHS[Math.floor(Math.random() * GLYPHS.length)] });
        break;
      case "scraps":
        add({ kind: burst, x, y, vx: rand(-55, 55), vy: rand(-70, -10), age: 0, life: rand(0.9, 1.5), size: rand(4, 8), colour, spin: rand(-5, 5), turn: rand(0, 6) });
        break;
      case "crystals":
        add({ kind: burst, x, y, vx: Math.cos(angle) * speed * 1.1, vy: Math.sin(angle) * speed - 70, age: 0, life: rand(0.55, 0.95), size: rand(4, 8), colour, spin: rand(-9, 9), turn: rand(0, 6) });
        break;
      case "stars":
        add({ kind: burst, x, y, vx: Math.cos(angle) * speed * 0.6, vy: Math.sin(angle) * speed * 0.6 - 25, age: 0, life: rand(0.7, 1.3), size: rand(3, 6.5), colour: i % 3 ? colour : "#ffffff", spin: rand(4, 9), turn: rand(0, 6) });
        break;
      case "snow":
        add({ kind: burst, x: x + rand(-18, 18), y: y + rand(-12, 12), vx: rand(-30, 30), vy: rand(-40, 10), age: 0, life: rand(1, 1.8), size: rand(1.2, 3), colour: "#ffffff", spin: rand(1, 2.5), turn: rand(0, 6) });
        break;
      case "ink":
        add({ kind: burst, x, y, vx: Math.cos(angle) * speed * 1.2, vy: Math.sin(angle) * speed - 30, age: 0, life: rand(0.4, 0.8), size: rand(1.5, 4), colour, spin: 0, turn: 0 });
        break;
      case "coins":
        add({ kind: burst, x, y, vx: rand(-70, 70), vy: rand(-190, -110), age: 0, life: rand(0.9, 1.3), size: rand(4.5, 6.5), colour: "#f2c94c", spin: rand(8, 14), turn: rand(0, 6) });
        break;
      case "sprinkles": {
        const [face] = theme.board.bricks[i % theme.board.bricks.length];
        add({ kind: burst, x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 60, age: 0, life: rand(0.7, 1.2), size: rand(4, 6), colour: face, spin: rand(-12, 12), turn: rand(0, 6) });
        break;
      }
    }
  }
}

/** A ball struck something here. */
export function emitBounce(theme: Theme, x: number, y: number) {
  const bounce = theme.effects.bounce;
  if (bounce === "none") return;
  if (bounce === "spark") {
    for (let i = 0; i < 3; i++) {
      const angle = rand(0, Math.PI * 2);
      add({ kind: bounce, x, y, vx: Math.cos(angle) * rand(40, 110), vy: Math.sin(angle) * rand(40, 110), age: 0, life: rand(0.12, 0.28), size: rand(1, 2.2), colour: theme.board.glow, spin: 0, turn: 0 });
    }
    return;
  }
  // A ring or a ripple: one expanding circle.
  add({ kind: bounce, x, y, vx: 0, vy: 0, age: 0, life: bounce === "ripple" ? 0.5 : 0.32, size: 3, colour: theme.board.glow, spin: 0, turn: 0 });
}

/** The board emptied: one big, short-lived flourish over everything. */
export function emitClear(theme: Theme) {
  const clear = theme.effects.clear;
  if (clear === "confetti") {
    for (let i = 0; i < 40; i++) {
      const [face] = theme.board.bricks[i % theme.board.bricks.length];
      add({ kind: "scraps", x: rand(0, W), y: rand(-40, 60), vx: rand(-30, 30), vy: rand(40, 120), age: 0, life: rand(1.2, 2), size: rand(4, 8), colour: face, spin: rand(-6, 6), turn: rand(0, 6) });
    }
    return;
  }
  if (clear === "shockwave") {
    add({ kind: "ring", x: W / 2, y: GROUND / 2, vx: 0, vy: 0, age: 0, life: 0.7, size: 10, colour: theme.board.glow, spin: 0, turn: 0 });
    return;
  }
  if (clear === "fireworks") {
    // Three shells, one after another, each in a colour of the board.
    for (let shell = 0; shell < 3; shell++) {
      const cx = rand(W * 0.2, W * 0.8);
      const cy = rand(GROUND * 0.15, GROUND * 0.55);
      const [face] = theme.board.bricks[(shell * 2) % theme.board.bricks.length];
      for (let i = 0; i < 26; i++) {
        const angle = (i / 26) * Math.PI * 2 + rand(-0.05, 0.05);
        const speed = rand(150, 230);
        add({ kind: "firework", x: cx, y: cy, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, age: -shell * 0.28, life: rand(0.9, 1.25), size: rand(1.6, 2.6), colour: i % 4 ? face : "#ffffff", spin: 0, turn: 0 });
      }
    }
    return;
  }
  if (clear === "jackpot") {
    for (let i = 0; i < 46; i++) {
      add({ kind: "coins", x: rand(0, W), y: rand(-160, -10), vx: rand(-20, 20), vy: rand(60, 160), age: 0, life: rand(1.6, 2.4), size: rand(5, 8), colour: "#f2c94c", spin: rand(6, 12), turn: rand(0, 6) });
    }
    add({ kind: "ring", x: W / 2, y: GROUND / 2, vx: 0, vy: 0, age: 0, life: 0.8, size: 12, colour: theme.board.glow, spin: 0, turn: 0 });
    return;
  }
  if (clear === "rays") {
    for (let i = 0; i < 18; i++) {
      const angle = (i / 18) * Math.PI * 2;
      add({ kind: "sparks", x: W / 2, y: GROUND / 2, vx: Math.cos(angle) * 260, vy: Math.sin(angle) * 260, age: 0, life: 0.6, size: 2.5, colour: theme.board.glow, spin: 0, turn: 0 });
    }
    return;
  }
  for (let i = 0; i < 24; i++) {
    const [face] = theme.board.bricks[i % theme.board.bricks.length];
    add({ kind: "dust", x: rand(0, W), y: rand(0, GROUND), vx: rand(-20, 20), vy: rand(-40, -10), age: 0, life: rand(0.8, 1.5), size: rand(2, 5), colour: face, spin: 0, turn: 0 });
  }
}

/** Everything goes: a new board, a new run, a board put away. */
export function clearEffects() {
  particles.length = 0;
}

export const hasEffects = () => particles.length > 0;

/**
 * Moves everything on by the time since the last frame and paints it. Called
 * from the board painter, after the bricks and before nothing.
 */
export function drawEffects(ctx: CanvasRenderingContext2D, now: number) {
  const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
  last = now;
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.age += dt;
    if (p.age >= p.life) {
      particles.splice(i, 1);
      continue;
    }
    // A particle may wait its turn (the second and third shells of a firework).
    if (p.age < 0) continue;
    const fade = 1 - p.age / p.life;
    // Each kind moves the way the thing it stands for would.
    switch (p.kind) {
      case "bubbles":
        p.turn += dt * p.spin;
        p.x += Math.sin(p.turn) * 14 * dt;
        p.y += p.vy * dt;
        p.vy *= 0.99;
        break;
      case "embers":
        p.turn += dt * 6;
        p.x += (p.vx + Math.sin(p.turn) * 20) * dt;
        p.y += p.vy * dt;
        p.vy += 24 * dt;
        break;
      case "dust":
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        break;
      case "snow":
        p.turn += dt * p.spin;
        p.x += (p.vx + Math.sin(p.turn) * 18) * dt;
        p.y += p.vy * dt;
        p.vx *= 0.97;
        p.vy = Math.min(45, p.vy + 60 * dt);
        break;
      case "stars":
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 0.96;
        p.vy = p.vy * 0.96 + 18 * dt;
        p.turn += dt * p.spin;
        break;
      case "blot":
        p.size += (22 - p.size) * Math.min(1, dt * 7);
        break;
      case "firework":
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 0.955;
        p.vy = p.vy * 0.955 + 60 * dt;
        break;
      case "coins":
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 380 * dt;
        p.turn += p.spin * dt;
        break;
      case "sprinkles":
        p.turn += dt * p.spin;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 0.98;
        p.vy += 260 * dt;
        break;
      case "petals":
      case "scraps":
        p.turn += dt * p.spin;
        p.x += (p.vx + Math.sin(p.turn) * 26) * dt;
        p.y += p.vy * dt;
        p.vy += 90 * dt;
        break;
      case "ring":
      case "ripple":
        p.size += (p.kind === "ripple" ? 90 : 130) * dt;
        break;
      case "sparks":
      case "spark":
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 0.94;
        p.vy *= 0.94;
        break;
      default:
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 420 * dt;
        p.turn += p.spin * dt;
    }
    if (p.y > H + 20 || p.x < -30 || p.x > W + 30) {
      particles.splice(i, 1);
      continue;
    }

    ctx.globalAlpha = Math.max(0, Math.min(1, fade));
    ctx.fillStyle = p.colour;
    ctx.strokeStyle = p.colour;
    switch (p.kind) {
      case "ring":
      case "ripple":
        ctx.lineWidth = p.kind === "ripple" ? 1.5 : 2.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.stroke();
        break;
      case "pixels":
        ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
        break;
      case "glyphs":
        ctx.font = `${p.size}px ui-monospace, monospace`;
        ctx.textAlign = "center";
        ctx.fillText(p.glyph ?? "0", p.x, p.y);
        break;
      case "petals":
      case "scraps":
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.turn);
        if (p.kind === "petals") {
          ctx.beginPath();
          ctx.ellipse(0, 0, p.size, p.size * 0.55, 0, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.7);
        }
        ctx.restore();
        break;
      case "shards":
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.turn);
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        ctx.restore();
        break;
      case "crystals":
        // A long diamond, lit along one edge.
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.turn);
        ctx.beginPath();
        ctx.moveTo(0, -p.size);
        ctx.lineTo(p.size * 0.45, 0);
        ctx.lineTo(0, p.size);
        ctx.lineTo(-p.size * 0.45, 0);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.8)";
        ctx.lineWidth = 0.8;
        ctx.stroke();
        ctx.restore();
        break;
      case "stars": {
        const r = p.size * (0.65 + 0.35 * Math.sin(p.turn));
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - r);
        ctx.quadraticCurveTo(p.x, p.y, p.x + r, p.y);
        ctx.quadraticCurveTo(p.x, p.y, p.x, p.y + r);
        ctx.quadraticCurveTo(p.x, p.y, p.x - r, p.y);
        ctx.quadraticCurveTo(p.x, p.y, p.x, p.y - r);
        ctx.fill();
        break;
      }
      case "blot":
        ctx.globalAlpha = Math.max(0, Math.min(0.55, fade * 0.7));
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        break;
      case "coins": {
        // A coin turning over: as wide as it is tall face-on, a sliver edge-on.
        const face = Math.abs(Math.cos(p.turn));
        ctx.fillStyle = face > 0.35 ? "#f2c94c" : "#b8860b";
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, Math.max(0.8, p.size * face), p.size, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#8a6510";
        ctx.lineWidth = 0.8;
        ctx.stroke();
        if (face > 0.6) {
          ctx.fillStyle = "rgba(255,248,214,0.85)";
          ctx.beginPath();
          ctx.ellipse(p.x - p.size * face * 0.3, p.y - p.size * 0.3, p.size * face * 0.25, p.size * 0.22, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case "sprinkles":
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.turn);
        ctx.lineCap = "round";
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.moveTo(-p.size / 2, 0);
        ctx.lineTo(p.size / 2, 0);
        ctx.stroke();
        ctx.restore();
        break;
      case "firework":
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.5 + fade * 0.5), 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha *= 0.35;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.05, p.y - p.vy * 0.05);
        ctx.lineWidth = p.size;
        ctx.stroke();
        break;
      default:
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = "center";
}
