"use client";
import type { SoundKit } from "@/lib/themes";
import { bell, fm, hiss, tone } from "./sound-engine";

// How each theme sounds. Every kit answers the same eight moments — the
// launch, a hit, a break, a ball landing, a cleared board, the run ending, a
// match won and a match lost — in its own voice: eight-bit squares for the
// arcade, a koto under the blossom, chips clacking at the high-roller table.
//
// Hits climb the kit's own ladder through a shot, so a long ricochet is heard
// as a run of notes rather than the same click twenty times.

export type Kit = {
  /** The top of the master filter: how bright the theme sounds. */
  bright: number;
  /** The note hits start from, and the steps they climb, in semitones. */
  root: number;
  ladder: number[];
  launch(): void;
  hit(pitch: number, at: number): void;
  break(at: number, i: number): void;
  land(): void;
  clear(): void;
  over(): void;
  win(): void;
  lose(): void;
};

/** `semis` semitones above `root`. */
const n = (root: number, semis: number) => root * 2 ** (semis / 12);
/** Plays `fn` on each step of `steps` above `root`, `gap` seconds apart. */
const run = (root: number, steps: number[], gap: number, fn: (freq: number, at: number, i: number) => void) => steps.forEach((s, i) => fn(n(root, s), i * gap, i));

const MAJOR = [0, 2, 4, 5, 7, 9, 11, 12];
const PENTATONIC = [0, 2, 4, 7, 9, 12, 14, 16];
const MINOR_PENTATONIC = [0, 3, 5, 7, 10, 12, 15, 17];

// --- Voices shared by more than one kit.

const kalimba = (f: number, at: number, g = 0.16, length = 0.4) => {
  tone({ at, from: f, length, gain: g });
  tone({ at, from: f * 4, length: 0.06, gain: g * 0.18 });
};
const pluck = (f: number, at: number, g = 0.14, length = 0.45) => {
  tone({ at, from: f * 1.012, to: f, length, gain: g, shape: "triangle", echo: 0.22 });
  tone({ at, from: f * 2, length: length * 0.4, gain: g * 0.3, echo: 0.15 });
};
const pop = (f: number, at: number, g = 0.16) => tone({ at, from: f, to: f * 1.7, length: 0.07, gain: g });
const woodblock = (f: number, at: number, g = 0.2) => {
  tone({ at, from: f * 2, to: f * 1.9, length: 0.07, gain: g });
  tone({ at, from: f * 5.3, length: 0.02, gain: g * 0.25 });
};
const supersaw = (f: number, at: number, length: number, g: number, to?: number, wet = 0) => {
  tone({ at, from: f, to, length, gain: g, shape: "sawtooth", detune: -9, echo: wet });
  tone({ at, from: f, to, length, gain: g, shape: "sawtooth", detune: 9, echo: wet });
};
const crackle = (at: number, count: number) => {
  for (let k = 0; k < count; k++) hiss({ at: at + k * 0.017 + ((k * k) % 3) * 0.006, type: "bandpass", from: 1800 + ((k * 733) % 1700), q: 4, length: 0.012, gain: 0.12 });
};
const clack = (at: number, g: number) => {
  hiss({ at, type: "bandpass", from: 2800, q: 3, length: 0.018, gain: g });
  hiss({ at: at + 0.011, type: "bandpass", from: 1700, q: 3, length: 0.022, gain: g * 0.6 });
  tone({ at, from: 620, length: 0.025, gain: g * 0.3 });
};
const kick = (at = 0, g = 0.32) => tone({ at, from: 150, to: 45, length: 0.18, gain: g });

export const KITS: Record<SoundKit, Kit> = {
  // The original voice: low, round and warm.
  classic: {
    bright: 1_100,
    root: 146.83,
    ladder: [0, 2, 4, 5, 7, 9, 10, 12],
    launch() {
      tone({ from: 185, to: 65, length: 0.2, gain: 0.42 });
      tone({ from: 370, to: 130, length: 0.12, gain: 0.09, shape: "triangle" });
    },
    hit: (p, at) => tone({ at, from: p, to: p * 0.94, length: 0.13, gain: 0.28, shape: "triangle" }),
    break(at) {
      tone({ at, from: 130, to: 58, length: 0.18, gain: 0.28 });
      hiss({ at, from: 420, length: 0.13, gain: 0.2 });
    },
    land() {
      tone({ from: 98, to: 55, length: 0.2, gain: 0.25 });
      hiss({ from: 220, length: 0.15, gain: 0.12 });
    },
    clear() {
      tone({ from: 73.42, length: 0.45, gain: 0.24 });
      run(146.83, [0, 4, 7, 12, 16], 0.085, (f, at) => tone({ at, from: f, length: 0.32, gain: 0.25 }));
    },
    over() {
      tone({ from: 146.83, to: 49, length: 0.6, gain: 0.32, shape: "triangle" });
      hiss({ at: 0.05, from: 180, length: 0.4, gain: 0.2 });
    },
    win() {
      tone({ from: 73.42, length: 0.65, gain: 0.26 });
      run(146.83, [0, 7, 12, 19], 0.12, (f, at) => tone({ at, from: f, length: 0.42, gain: 0.27 }));
    },
    lose: () => run(146.83, [0, -3], 0.18, (f, at) => tone({ at, from: f, length: 0.45, gain: 0.26 })),
  },

  // Neon Grid: square-wave blips and a laser for a launch.
  synth: {
    bright: 3_200,
    root: 164.81,
    ladder: MINOR_PENTATONIC,
    launch() {
      tone({ from: 220, to: 880, length: 0.12, gain: 0.08, shape: "square" });
      tone({ from: 110, to: 55, length: 0.22, gain: 0.3 });
    },
    hit(p, at) {
      tone({ at, from: p * 2, length: 0.07, gain: 0.07, shape: "square" });
      tone({ at, from: p, length: 0.1, gain: 0.13, shape: "triangle" });
    },
    break(at) {
      tone({ at, from: 330, to: 110, length: 0.14, gain: 0.1, shape: "sawtooth" });
      hiss({ at, type: "highpass", from: 2500, length: 0.06, gain: 0.1 });
      tone({ at: at + 0.02, from: 660, length: 0.05, gain: 0.05, shape: "square" });
    },
    land: () => tone({ from: 82.4, to: 70, length: 0.12, gain: 0.24, shape: "triangle" }),
    clear() {
      run(329.63, [0, 3, 7, 12, 15, 19, 24], 0.06, (f, at) => tone({ at, from: f, length: 0.12, gain: 0.07, shape: "square", echo: 0.3 }));
      tone({ from: 82.4, length: 0.5, gain: 0.2, shape: "triangle" });
    },
    over() {
      tone({ from: 330, to: 55, length: 0.8, gain: 0.1, shape: "sawtooth" });
      hiss({ from: 400, length: 0.4, gain: 0.15 });
    },
    win() {
      run(329.63, [0, 4, 7, 12, 16, 19, 24], 0.07, (f, at) => tone({ at, from: f, length: 0.16, gain: 0.08, shape: "square", echo: 0.3 }));
      tone({ from: 82.4, length: 0.6, gain: 0.22, shape: "triangle" });
    },
    lose: () => run(329.63, [7, 3, 0, -5], 0.14, (f, at) => tone({ at, from: f, length: 0.25, gain: 0.07, shape: "square" })),
  },

  // Paper Cut: a kalimba for hits, and card tearing when a brick goes.
  paper: {
    bright: 2_800,
    root: 196,
    ladder: PENTATONIC,
    launch: () => hiss({ type: "bandpass", from: 1200, to: 3200, q: 1.2, length: 0.12, gain: 0.16 }),
    hit(p, at) {
      kalimba(p * 2, at, 0.14, 0.12);
      hiss({ at, type: "highpass", from: 3000, length: 0.015, gain: 0.05 });
    },
    break(at) {
      hiss({ at, type: "bandpass", from: 900, to: 2800, q: 1.4, length: 0.16, gain: 0.22 });
      hiss({ at: at + 0.07, type: "bandpass", from: 1600, to: 3400, q: 1.6, length: 0.08, gain: 0.14 });
      tone({ at, from: 140, to: 90, length: 0.1, gain: 0.1 });
    },
    land() {
      hiss({ from: 500, length: 0.1, gain: 0.16 });
      tone({ from: 90, length: 0.1, gain: 0.14 });
    },
    clear: () => run(392, [0, 4, 7, 12, 16], 0.08, (f, at) => kalimba(f, at, 0.18)),
    over() {
      for (const at of [0, 0.06, 0.13, 0.21]) hiss({ at, type: "bandpass", from: 1400 + at * 4000, q: 1.5, length: 0.07, gain: 0.14 });
      tone({ from: 120, to: 60, length: 0.4, gain: 0.15 });
    },
    win: () => run(392, [0, 4, 7, 12, 16, 19], 0.1, (f, at) => kalimba(f, at, 0.18, 0.5)),
    lose: () => run(392, [7, 4, 0], 0.18, (f, at) => kalimba(f, at, 0.16, 0.5)),
  },

  // Arcade 84: pure eight-bit — square waves and a noise channel.
  chip: {
    bright: 6_500,
    root: 261.63,
    ladder: MAJOR,
    launch: () => tone({ from: 1046, to: 262, length: 0.11, gain: 0.08, shape: "square" }),
    hit: (p, at) => tone({ at, from: p, length: 0.05, gain: 0.07, shape: "square" }),
    break(at) {
      hiss({ at, from: 4000, to: 300, length: 0.16, gain: 0.2 });
      tone({ at, from: 220, to: 110, length: 0.08, gain: 0.07, shape: "square" });
    },
    land: () => tone({ from: 110, to: 98, length: 0.07, gain: 0.22, shape: "triangle" }),
    clear: () => run(523.25, [0, 4, 7, 12, 7, 12, 16, 19, 24], 0.055, (f, at, i) => tone({ at, from: f, length: i === 8 ? 0.22 : 0.07, gain: 0.07, shape: "square" })),
    over() {
      run(261.63, [7, 6, 5, 4, 3, 2, 1, 0], 0.09, (f, at) => tone({ at, from: f, length: 0.1, gain: 0.07, shape: "square" }));
      hiss({ at: 0.72, from: 1000, length: 0.5, gain: 0.16 });
    },
    win: () => [0, 0, 0, 4, 7, 12].forEach((s, i) => tone({ at: [0, 0.1, 0.2, 0.3, 0.45, 0.6][i], from: n(523.25, s), length: i === 5 ? 0.4 : 0.09, gain: 0.07, shape: "square" })),
    lose: () => run(261.63, [4, 3, 2, 1, 0], 0.16, (f, at) => tone({ at, from: f, length: 0.18, gain: 0.12, shape: "triangle" })),
  },

  // Deep Sea: bubbles rising, muffled thumps, and a sonar ping for a clear.
  bubble: {
    bright: 1_900,
    root: 220,
    ladder: PENTATONIC,
    launch() {
      hiss({ from: 300, to: 1100, length: 0.3, gain: 0.16 });
      tone({ from: 80, to: 60, length: 0.25, gain: 0.2 });
    },
    hit: (p, at) => tone({ at, from: p * 1.4, to: p * 2.8, length: 0.07, gain: 0.16, echo: 0.2 }),
    break(at) {
      [1, 1.3, 0.85].forEach((m, k) => tone({ at: at + k * 0.035, from: 440 * m, to: 880 * m, length: 0.06, gain: 0.12, echo: 0.2 }));
      hiss({ at, from: 300, length: 0.15, gain: 0.15 });
    },
    land() {
      tone({ from: 70, to: 48, length: 0.28, gain: 0.26 });
      hiss({ from: 160, length: 0.2, gain: 0.12 });
    },
    clear() {
      tone({ from: 1046, length: 0.9, gain: 0.12, echo: 0.65 });
      run(440, [0, 2, 4, 7, 9, 12], 0.05, (f, at) => tone({ at: at + 0.1, from: f, to: f * 2, length: 0.06, gain: 0.1 }));
    },
    over() {
      run(440, [12, 7, 4, 0], 0.12, (f, at) => tone({ at, from: f * 1.4, to: f * 2.8, length: 0.08, gain: 0.12 }));
      tone({ from: 110, to: 40, length: 1, gain: 0.2 });
    },
    win() {
      tone({ from: 1046, length: 1, gain: 0.1, echo: 0.6 });
      run(440, [0, 4, 7, 12, 16], 0.08, (f, at) => tone({ at, from: f, to: f * 2, length: 0.08, gain: 0.12, echo: 0.3 }));
    },
    lose: () => run(220, [0, -5], 0.2, (f, at) => tone({ at, from: f * 1.4, to: f * 2, length: 0.12, gain: 0.14, echo: 0.3 })),
  },

  // Terminal: keyboard clicks and a PC speaker's beeps.
  terminal: {
    bright: 3_500,
    root: 440,
    ladder: MAJOR,
    launch() {
      hiss({ type: "highpass", from: 4000, length: 0.012, gain: 0.16 });
      tone({ at: 0.015, from: 880, length: 0.04, gain: 0.05, shape: "square" });
      tone({ at: 0.05, from: 440, length: 0.06, gain: 0.05, shape: "square" });
    },
    hit(p, at) {
      tone({ at, from: p * 2, length: 0.028, gain: 0.05, shape: "square" });
      hiss({ at, type: "highpass", from: 5000, length: 0.008, gain: 0.06 });
    },
    break: (at) => {
      [3, 2.5, 4, 3.5].forEach((m, k) => tone({ at: at + k * 0.024, from: 440 * m, length: 0.02, gain: 0.04, shape: "square" }));
      hiss({ at, type: "highpass", from: 3000, length: 0.04, gain: 0.06 });
    },
    land: () => hiss({ type: "highpass", from: 2500, length: 0.012, gain: 0.14 }),
    clear() {
      for (let k = 0; k < 8; k++) tone({ at: k * 0.035, from: k % 2 ? 2400 : 1200, length: 0.03, gain: 0.04, shape: "square" });
      tone({ at: 0.3, from: 600, to: 2400, length: 0.4, gain: 0.05 });
    },
    over() {
      tone({ from: 98, length: 0.5, gain: 0.1, shape: "sawtooth" });
      tone({ from: 49, length: 0.5, gain: 0.08, shape: "square" });
    },
    win: () => run(880, [0, 4, 7, 12], 0.09, (f, at) => tone({ at, from: f, length: 0.08, gain: 0.05, shape: "square" })),
    lose() {
      tone({ from: 220, length: 0.25, gain: 0.06, shape: "square" });
      tone({ at: 0.28, from: 165, length: 0.4, gain: 0.06, shape: "square" });
    },
  },

  // Sakura: a koto in the old in scale, and wind chimes when a brick goes.
  koto: {
    bright: 2_800,
    root: 293.66,
    ladder: [0, 1, 5, 7, 8, 12, 13, 17],
    launch() {
      hiss({ type: "bandpass", from: 700, to: 900, q: 2, length: 0.3, gain: 0.07 });
      pluck(146.83, 0, 0.12, 0.6);
    },
    hit: (p, at) => pluck(p, at, 0.14, 0.4),
    break(at) {
      pluck(587.33, at, 0.1, 0.5);
      pluck(880, at + 0.02, 0.06, 0.4);
      bell(at + 0.03, 2637, 0.5, 0.03, [1, 2.76], 0.3);
    },
    land() {
      tone({ from: 196, length: 0.06, gain: 0.1 });
      hiss({ from: 800, length: 0.04, gain: 0.06 });
    },
    clear: () => run(293.66, [0, 1, 5, 7, 8, 12, 13, 17, 19, 24], 0.045, (f, at, i) => pluck(f, at, 0.1, i === 9 ? 0.9 : 0.4)),
    over: () => run(293.66, [12, 8, 7, 5, 1, 0], 0.16, (f, at) => pluck(f, at, 0.12, 0.6)),
    win: () => run(293.66, [0, 5, 7, 12, 17, 19, 24], 0.1, (f, at) => pluck(f, at, 0.12, 0.7)),
    lose: () => run(293.66, [7, 5, 1, 0], 0.22, (f, at) => pluck(f, at, 0.12, 0.7)),
  },

  // Obsidian & Gold: struck metal, a gong for a launch and bells for a clear.
  gold: {
    bright: 3_800,
    root: 220,
    ladder: [0, 4, 7, 11, 12, 16, 19, 23],
    launch: () => fm({ from: 110, ratio: 1.4, index: 2.5, length: 0.7, gain: 0.14, echo: 0.3 }),
    hit: (p, at) => fm({ at, from: p * 2, ratio: 3.5, index: 1.2, length: 0.16, gain: 0.07 }),
    break(at) {
      bell(at, 1174.66, 0.55, 0.07, [1, 2.76, 5.4], 0.25);
      hiss({ at, type: "highpass", from: 6000, length: 0.03, gain: 0.05 });
    },
    land() {
      tone({ from: 120, to: 80, length: 0.08, gain: 0.14 });
      hiss({ from: 600, length: 0.05, gain: 0.08 });
    },
    clear: () => run(440, [0, 4, 7, 11, 14], 0.07, (f, at) => bell(at, f, 1.2, 0.06, [1, 2.76, 5.4], 0.3)),
    over() {
      fm({ from: 55, ratio: 1.4, index: 3, length: 1.4, gain: 0.16, echo: 0.3 });
      run(440, [7, 3, 0], 0.2, (f, at) => bell(at + 0.1, f, 0.8, 0.05));
    },
    win: () => run(440, [0, 4, 7, 12, 16, 19, 24], 0.08, (f, at) => bell(at, f, 1, 0.06, [1, 2.76, 5.4], 0.3)),
    lose: () => run(220, [7, 3], 0.3, (f, at) => bell(at, f, 1, 0.07)),
  },

  // Solar Flare: fire — crackles, whooshes and a boom for a clear.
  fire: {
    bright: 2_200,
    root: 110,
    ladder: MINOR_PENTATONIC,
    launch() {
      hiss({ type: "bandpass", from: 300, to: 1600, q: 0.8, length: 0.32, gain: 0.2 });
      crackle(0.05, 3);
    },
    hit(p, at) {
      tone({ at, from: p, to: p * 0.7, length: 0.1, gain: 0.18 });
      crackle(at, 1);
    },
    break(at) {
      hiss({ at, from: 2400, to: 200, length: 0.26, gain: 0.22 });
      crackle(at, 4);
      tone({ at, from: 80, to: 40, length: 0.2, gain: 0.18 });
    },
    land: () => hiss({ from: 180, length: 0.3, gain: 0.2 }),
    clear() {
      tone({ from: 62, to: 30, length: 0.9, gain: 0.3 });
      hiss({ from: 900, to: 100, length: 0.8, gain: 0.25 });
      hiss({ at: 0.15, type: "bandpass", from: 400, to: 3000, length: 0.6, gain: 0.12 });
      crackle(0.1, 8);
    },
    over() {
      hiss({ from: 120, length: 1, gain: 0.25 });
      tone({ from: 110, to: 40, length: 0.9, gain: 0.08, shape: "sawtooth" });
    },
    win() {
      run(220, [0, 7, 12, 19], 0.1, (f, at) => tone({ at, from: f, length: 0.4, gain: 0.14, shape: "triangle" }));
      crackle(0.1, 6);
    },
    lose: () => run(220, [0, -2, -5], 0.2, (f, at) => tone({ at, from: f, to: f * 0.9, length: 0.4, gain: 0.14, shape: "triangle" })),
  },

  // Void: notes that ring out into a lot of empty space.
  space: {
    bright: 3_000,
    root: 196,
    ladder: [0, 2, 4, 6, 7, 9, 11, 12],
    launch() {
      tone({ from: 1400, to: 90, length: 0.45, gain: 0.1, echo: 0.4 });
      tone({ from: 55, length: 0.3, gain: 0.2 });
    },
    hit(p, at) {
      tone({ at, from: p * 2, length: 0.22, gain: 0.1, echo: 0.45 });
      tone({ at, from: p * 2, length: 0.22, gain: 0.05, detune: 10 });
    },
    break(at) {
      bell(at, 2349, 0.3, 0.05, [1, 2.4, 3.9], 0.4);
      tone({ at, from: 120, to: 40, length: 0.25, gain: 0.2 });
    },
    land: () => tone({ from: 65, length: 0.2, gain: 0.2 }),
    clear: () => [0, 7, 11, 14, 19].forEach((s) => tone({ from: n(196, s), length: 1.6, gain: 0.06, attack: 0.25, echo: 0.5 })),
    over() {
      tone({ from: 400, to: 50, length: 1.2, gain: 0.12, echo: 0.5 });
      hiss({ from: 300, length: 0.8, gain: 0.1 });
    },
    win: () => run(392, [0, 4, 7, 11, 14, 19, 23], 0.07, (f, at) => tone({ at, from: f, length: 0.5, gain: 0.07, echo: 0.5 })),
    lose: () => [0, 3, 7].forEach((s) => tone({ from: n(130.81, s), length: 1.4, gain: 0.07, attack: 0.2, echo: 0.4 })),
  },

  // Candy Pop: pops, a slide whistle and a jelly boing.
  candy: {
    bright: 3_400,
    root: 392,
    ladder: PENTATONIC,
    launch: () => tone({ from: 400, to: 1300, length: 0.22, gain: 0.1, wobble: [14, 25] }),
    hit: (p, at) => pop(p, at, 0.16),
    break(at) {
      tone({ at, from: 220, to: 330, length: 0.28, gain: 0.18, wobble: [16, 40] });
      pop(784, at + 0.02, 0.1);
    },
    land: () => tone({ from: 300, to: 190, length: 0.09, gain: 0.16 }),
    clear: () => run(523.25, [0, 4, 7, 12, 16, 19, 24], 0.06, (f, at) => kalimba(f, at, 0.14, 0.25)),
    over: () => tone({ from: 900, to: 180, length: 0.65, gain: 0.1, wobble: [8, 20] }),
    win: () => run(523.25, [0, 4, 7, 12, 7, 12, 16, 24], 0.07, (f, at) => kalimba(f, at, 0.14, 0.3)),
    lose() {
      tone({ from: 392, to: 349, length: 0.3, gain: 0.1, wobble: [6, 8] });
      tone({ at: 0.3, from: 349, to: 330, length: 0.3, gain: 0.1, wobble: [6, 8] });
      tone({ at: 0.6, from: 330, to: 262, length: 0.55, gain: 0.1, wobble: [6, 8] });
    },
  },

  // Frostbite: glass bells, shattering ice and wind.
  ice: {
    bright: 7_500,
    root: 523.25,
    ladder: PENTATONIC,
    launch: () => hiss({ type: "bandpass", from: 2600, to: 1200, q: 2, length: 0.35, gain: 0.1 }),
    hit: (p, at) => bell(at, p, 0.25, 0.07, [1, 2.76], 0.25),
    break(at) {
      hiss({ at, type: "highpass", from: 4500, length: 0.12, gain: 0.12 });
      [2, 2.52, 3].forEach((m, k) => bell(at + 0.02 + k * 0.03, 523.25 * m, 0.3, 0.04, [1, 2.76], 0.3));
    },
    land() {
      hiss({ from: 1200, length: 0.1, gain: 0.14 });
      hiss({ type: "bandpass", from: 3000, length: 0.03, gain: 0.05 });
    },
    clear: () => run(1046.5, [0, 4, 7, 12, 16, 19, 24, 28], 0.055, (f, at) => bell(at, f, 0.5, 0.05, [1, 2.76], 0.35)),
    over() {
      run(1046.5, [12, 7, 4, 0, -5], 0.14, (f, at) => bell(at, f, 0.6, 0.05, [1, 2.76], 0.3));
      hiss({ type: "bandpass", from: 1800, to: 900, q: 2, length: 0.9, gain: 0.08 });
    },
    win: () => run(1046.5, [0, 4, 7, 12, 16, 19, 24], 0.07, (f, at) => bell(at, f, 0.7, 0.06, [1, 2.76], 0.35)),
    lose: () => run(1046.5, [7, 3, 0], 0.25, (f, at) => bell(at, f, 0.8, 0.06, [1, 2.76], 0.3)),
  },

  // Sumi-e: a woodblock, a brush and a taiko drum, and a singing bowl to finish.
  zen: {
    bright: 2_200,
    root: 220,
    ladder: [0, 2, 5, 7, 9, 12, 14, 17],
    launch() {
      hiss({ type: "bandpass", from: 900, q: 3, length: 0.4, gain: 0.08 });
      tone({ from: 440, length: 0.45, gain: 0.05, attack: 0.12, wobble: [5, 6] });
    },
    hit: (p, at) => woodblock(p, at, 0.2),
    break(at) {
      hiss({ at, type: "bandpass", from: 600, to: 2400, q: 1, length: 0.2, gain: 0.13 });
      tone({ at, from: 90, to: 55, length: 0.32, gain: 0.3 });
      hiss({ at, from: 200, length: 0.15, gain: 0.12 });
    },
    land: () => woodblock(110, 0, 0.12),
    clear() {
      bell(0, 220, 2.4, 0.1, [1, 2.71, 5.1], 0.3);
      bell(0.25, 329.63, 2, 0.07, [1, 2.71, 5.1], 0.3);
    },
    over() {
      bell(0, 110, 2.6, 0.1, [1, 2.71, 5.1], 0.3);
      tone({ from: 80, to: 50, length: 0.5, gain: 0.3 });
    },
    win() {
      run(220, [0, 2, 5, 7, 9, 12], 0.07, (f, at) => woodblock(f, at, 0.16));
      bell(0.45, 440, 2, 0.08, [1, 2.71, 5.1], 0.3);
    },
    lose: () => bell(0, 146.83, 2.2, 0.1, [1, 2.71, 5.1], 0.3),
  },

  // Outrun: detuned saws, a kick and a gated snare — the eighties at full tilt.
  retro: {
    bright: 3_600,
    root: 110,
    ladder: [0, 3, 7, 10, 12, 15, 19, 22],
    launch() {
      supersaw(110, 0, 0.25, 0.05, 440);
      hiss({ type: "bandpass", from: 1800, length: 0.1, gain: 0.1, gate: true });
    },
    hit(p, at) {
      tone({ at, from: p * 2, length: 0.12, gain: 0.06, shape: "sawtooth" });
      tone({ at, from: p, length: 0.12, gain: 0.1 });
    },
    break(at) {
      hiss({ at, type: "bandpass", from: 1800, q: 0.9, length: 0.12, gain: 0.2, gate: true });
      supersaw(220, at, 0.1, 0.03);
      supersaw(329.63, at, 0.1, 0.03);
    },
    land: () => kick(),
    clear() {
      kick();
      run(220, [0, 3, 7, 10, 12, 15, 19, 24], 0.07, (f, at) => supersaw(f, at, 0.14, 0.03, undefined, 0.35));
    },
    over: () => supersaw(440, 0, 0.9, 0.05, 55),
    win() {
      kick();
      [0, 4, 7, 12].forEach((s) => supersaw(n(220, s), 0, 0.9, 0.025, undefined, 0.35));
    },
    lose: () => run(220, [7, 3, 0], 0.2, (f, at) => supersaw(f, at, 0.35, 0.03)),
  },

  // Crystal Cavern: shimmering pairs of tones, a harp for a clear.
  crystal: {
    bright: 6_500,
    root: 392,
    ladder: [0, 2, 4, 6, 7, 9, 11, 12],
    launch() {
      tone({ from: 600, to: 1800, length: 0.3, gain: 0.05, echo: 0.3 });
      tone({ from: 98, length: 0.3, gain: 0.1 });
    },
    hit(p, at) {
      tone({ at, from: p * 2, length: 0.35, gain: 0.06, echo: 0.35 });
      tone({ at, from: p * 2, length: 0.35, gain: 0.06, detune: 5 });
      tone({ at, from: p * 4, length: 0.1, gain: 0.025 });
    },
    break(at) {
      [3, 4.2, 5.1].forEach((m, k) => bell(at + k * 0.015, 392 * m, 0.35, 0.04, [1, 2.4], 0.35));
      hiss({ at, type: "highpass", from: 6000, length: 0.05, gain: 0.05 });
    },
    land: () => tone({ from: 98, length: 0.15, gain: 0.12 }),
    clear: () => run(392, [0, 2, 4, 6, 7, 9, 11, 12, 14, 16, 18, 19], 0.04, (f, at) => tone({ at, from: f * 2, length: 0.5, gain: 0.05, echo: 0.35 })),
    over: () => run(392, [12, 11, 9, 7, 6, 4, 2, 0], 0.06, (f, at) => tone({ at, from: f, length: 0.5, gain: 0.06, echo: 0.35 })),
    win() {
      run(392, [0, 4, 7, 11, 14, 19, 23, 24], 0.05, (f, at) => tone({ at, from: f * 2, length: 0.6, gain: 0.05, echo: 0.35 }));
      [0, 4, 7].forEach((s) => tone({ at: 0.45, from: n(392, s), length: 1.2, gain: 0.05, attack: 0.1, echo: 0.4 }));
    },
    lose: () => run(392, [4, 2, 0], 0.25, (f, at) => tone({ at, from: f, length: 0.7, gain: 0.07, echo: 0.35 })),
  },

  // Mainnet: digital chirps, and a two-tone confirmation for every block.
  chain: {
    bright: 4_200,
    root: 261.63,
    ladder: PENTATONIC,
    launch() {
      fm({ from: 440, ratio: 2, index: 3, length: 0.15, gain: 0.07 });
      tone({ at: 0.02, from: 880, to: 1760, length: 0.06, gain: 0.04, shape: "square" });
    },
    hit: (p, at) => fm({ at, from: p * 2, ratio: 2, index: 1.2, length: 0.07, gain: 0.08 }),
    break(at) {
      tone({ at, from: 1046.5, length: 0.04, gain: 0.05, shape: "square" });
      tone({ at: at + 0.045, from: 1568, length: 0.06, gain: 0.05, shape: "square" });
      hiss({ at, type: "highpass", from: 4000, length: 0.02, gain: 0.05 });
    },
    land: () => tone({ from: 100, length: 0.08, gain: 0.14 }),
    clear() {
      run(523.25, [0, 4, 7, 12, 16, 19], 0.06, (f, at) => fm({ at, from: f, ratio: 2, index: 1, length: 0.1, gain: 0.07 }));
      [0, 4, 7].forEach((s) => fm({ at: 0.38, from: n(523.25, s), ratio: 2, index: 0.6, length: 0.6, gain: 0.05 }));
    },
    over: () => run(523.25, [12, 7, 4, 0, -5], 0.08, (f, at) => fm({ at, from: f, ratio: 2, index: 1.5, length: 0.12, gain: 0.07 })),
    win() {
      run(523.25, [0, 4, 7, 12, 16, 19, 24], 0.06, (f, at) => fm({ at, from: f, ratio: 2, index: 1, length: 0.12, gain: 0.07 }));
      [0, 4, 7, 12].forEach((s) => fm({ at: 0.45, from: n(523.25, s), ratio: 2, index: 0.6, length: 0.8, gain: 0.045 }));
    },
    lose: () => run(523.25, [7, 3, 0], 0.15, (f, at) => fm({ at, from: f, ratio: 2, index: 1.5, length: 0.2, gain: 0.07 })),
  },

  // Aurora: soft bells with a long tail, and a pad that swells for a clear.
  aurora: {
    bright: 3_200,
    root: 261.63,
    ladder: PENTATONIC,
    launch() {
      tone({ from: 196, to: 392, length: 0.5, gain: 0.06, attack: 0.15, echo: 0.4 });
      hiss({ type: "bandpass", from: 1500, length: 0.3, gain: 0.04 });
    },
    hit: (p, at) => tone({ at, from: p * 2, length: 0.55, gain: 0.07, echo: 0.5 }),
    break(at) {
      tone({ at, from: 1046.5, length: 0.6, gain: 0.04, echo: 0.5 });
      tone({ at, from: 1046.5, length: 0.6, gain: 0.04, detune: 12 });
      bell(at + 0.02, 2093, 0.25, 0.025, [1, 2.76], 0.4);
    },
    land: () => tone({ from: 130.81, length: 0.3, gain: 0.1 }),
    clear: () => [0, 4, 7, 11, 14, 19].forEach((s) => tone({ from: n(261.63, s), length: 1.8, gain: 0.045, attack: 0.3, echo: 0.6 })),
    over: () => [0, 3, 7].forEach((s) => tone({ from: n(130.81, s), length: 1.6, gain: 0.06, attack: 0.25, echo: 0.5 })),
    win() {
      [0, 4, 7, 11].forEach((s) => tone({ from: n(261.63, s), length: 1.8, gain: 0.045, attack: 0.3, echo: 0.6 }));
      run(523.25, [0, 4, 7, 12, 16], 0.09, (f, at) => tone({ at: at + 0.2, from: f, length: 0.6, gain: 0.05, echo: 0.5 }));
    },
    lose: () => [0, 3, 7].forEach((s) => tone({ from: n(196, s), length: 1.6, gain: 0.055, attack: 0.25, echo: 0.5 })),
  },

  // High Roller: chips clacking, coins ringing, and a slot machine for a clear.
  casino: {
    bright: 5_000,
    root: 293.66,
    ladder: [0, 4, 7, 12, 16, 19, 24, 28],
    launch() {
      hiss({ type: "highpass", from: 3000, length: 0.05, gain: 0.12 });
      clack(0.04, 0.18);
    },
    hit(p, at) {
      clack(at, 0.16);
      tone({ at, from: p * 2, length: 0.08, gain: 0.035 });
    },
    break(at) {
      fm({ at, from: 2349, ratio: 2.4, index: 0.8, length: 0.32, gain: 0.06 });
      fm({ at: at + 0.05, from: 2793, ratio: 2.4, index: 0.8, length: 0.28, gain: 0.05 });
      clack(at, 0.12);
    },
    land() {
      clack(0, 0.16);
      clack(0.03, 0.12);
      clack(0.055, 0.09);
    },
    clear() {
      run(587.33, [0, 4, 0, 4, 7, 12], 0.07, (f, at) => bell(at, f, 0.3, 0.06, [1, 2.76]));
      [0, 4, 7, 12].forEach((s) => bell(0.5, n(587.33, s), 1, 0.04, [1, 2.76, 5.4], 0.25));
      for (let k = 0; k < 6; k++) fm({ at: 0.5 + k * 0.05, from: 2349 + k * 120, ratio: 2.4, index: 0.8, length: 0.2, gain: 0.03 });
    },
    over() {
      run(293.66, [7, 4, 0], 0.15, (f, at) => bell(at, f, 0.6, 0.06));
      clack(0.5, 0.14);
    },
    win() {
      run(587.33, [0, 4, 7, 12, 7, 12, 16, 24], 0.07, (f, at) => bell(at, f, 0.5, 0.06, [1, 2.76, 5.4], 0.25));
      for (let k = 0; k < 10; k++) fm({ at: 0.55 + k * 0.045, from: 2349 + ((k * 170) % 600), ratio: 2.4, index: 0.8, length: 0.2, gain: 0.03 });
    },
    lose: () => run(293.66, [4, 0], 0.3, (f, at) => bell(at, f, 0.9, 0.07)),
  },
};
