"use client";
// The game's voice.
//
// Every sound here is synthesised on the spot: a few oscillators and one short
// noise buffer. Nothing is downloaded, nothing is decoded, and the whole
// soundtrack costs less than a favicon — which matters on a phone on mobile
// data, where the game already has a board to paint.
//
// The browser will not let a page make a sound before the player has touched
// it, so the audio context is created on the first shot and never before.
// Two notes on phones: iOS routes the Web Audio API through the ringer switch,
// so a muted phone stays muted whatever this file does, and `navigator.vibrate`
// does not exist on iOS at all — the taps below are an Android extra, never
// something the game leans on.

type Voice = "launch" | "hit" | "break" | "land" | "clear" | "over" | "win" | "lose";

const KEY = "bounce.sound";
/** Master level. The game is played next to other tabs; it does not shout. */
const MASTER = 0.22;

let context: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
let muted = false;
let loaded = false;
const listeners = new Set<() => void>();

/** The stored preference. Sound is on unless the player turned it off. */
function load() {
  if (loaded) return;
  loaded = true;
  try {
    muted = localStorage.getItem(KEY) === "off";
  } catch {
    // Private windows can refuse storage; the game still has a voice.
  }
}

export function isMuted() {
  load();
  return muted;
}

export function setMuted(value: boolean) {
  load();
  muted = value;
  try {
    localStorage.setItem(KEY, value ? "off" : "on");
  } catch {
    // Not remembering the choice is better than losing the click.
  }
  if (value && context) master?.gain.setTargetAtTime(0, context.currentTime, 0.01);
  else if (context && master) master.gain.setTargetAtTime(MASTER, context.currentTime, 0.01);
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** The audio context, made on the first sound the player asked for. */
function audio() {
  load();
  if (muted) return null;
  if (!context) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      context = new Ctor();
    } catch {
      return null;
    }
    master = context.createGain();
    master.gain.value = MASTER;
    // Round off the upper harmonics and keep dense ricochets from getting loud.
    const warmth = context.createBiquadFilter();
    warmth.type = "lowpass";
    warmth.frequency.value = 1_100;
    warmth.Q.value = 0.5;
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -16;
    compressor.knee.value = 12;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.12;
    master.connect(warmth).connect(compressor).connect(context.destination);
    const frames = Math.floor(context.sampleRate * 0.5);
    noise = context.createBuffer(1, frames, context.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  }
  // A context made before the first gesture, or suspended with the tab, wakes here.
  if (context.state === "suspended") void context.resume().catch(() => {});
  return context;
}

type Note = {
  /** Where it starts, in seconds from now. */
  at?: number;
  from: number;
  /** Slides to this pitch over its length, for a chirp. */
  to?: number;
  length: number;
  gain?: number;
  shape?: OscillatorType;
};

function play({ at = 0, from, to, length, gain = 1, shape = "sine" }: Note) {
  const ctx = audio();
  if (!ctx || !master) return;
  const start = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  const level = ctx.createGain();
  osc.type = shape;
  osc.frequency.setValueAtTime(from, start);
  if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), start + length);
  // A soft attack and a fuller decay give low notes time to speak without clicks.
  level.gain.setValueAtTime(0.0001, start);
  level.gain.linearRampToValueAtTime(gain, start + Math.min(0.009, length / 3));
  level.gain.exponentialRampToValueAtTime(gain * 0.12, start + length * 0.55);
  level.gain.exponentialRampToValueAtTime(0.0001, start + length);
  osc.connect(level).connect(master);
  osc.onended = () => {
    osc.disconnect();
    level.disconnect();
  };
  osc.start(start);
  osc.stop(start + length + 0.02);
}

/** A filtered burst of the noise buffer: the body of a thud or a break. */
function thud(at: number, frequency: number, gain: number, length = 0.12) {
  const ctx = audio();
  if (!ctx || !master || !noise) return;
  const start = ctx.currentTime + at;
  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const level = ctx.createGain();
  source.buffer = noise;
  filter.type = "lowpass";
  filter.frequency.value = frequency;
  filter.Q.value = 0.7;
  level.gain.setValueAtTime(0.0001, start);
  level.gain.linearRampToValueAtTime(gain, start + 0.006);
  level.gain.exponentialRampToValueAtTime(gain * 0.1, start + length * 0.5);
  level.gain.exponentialRampToValueAtTime(0.0001, start + length);
  source.connect(filter).connect(level).connect(master);
  source.onended = () => {
    source.disconnect();
    filter.disconnect();
    level.disconnect();
  };
  source.start(start);
  source.stop(start + length);
}

/** A short tap where the hardware has one. iOS has none; nothing breaks there. */
function tap(pattern: number | number[]) {
  load();
  if (muted) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Some browsers throw on a pattern they dislike rather than ignoring it.
  }
}

/**
 * Bricks hit in one shot climb a scale, so a long ricochet is heard as a run
 * rather than as the same click twenty times. The ladder resets with each shot.
 */
// Stay within one octave so even a long combo keeps its low, rounded character.
const STEPS = [0, 2, 4, 5, 7, 9, 10, 12];
let combo = 0;

export function resetCombo() {
  combo = 0;
}

/** One sound. `count` lets a frame full of hits arrive as a quick run of notes. */
export function playSound(voice: Voice, count = 1) {
  if (isMuted()) return;
  switch (voice) {
    case "launch":
      play({ from: 185, to: 65, length: 0.2, gain: 0.42 });
      play({ from: 370, to: 130, length: 0.12, gain: 0.09, shape: "triangle" });
      tap(8);
      break;
    case "hit":
      // Every hit in the same frame lands a moment after the one before it.
      for (let i = 0; i < Math.min(count, 4); i++) {
        const note = STEPS[Math.min(combo++, STEPS.length - 1)];
        const pitch = 146.83 * 2 ** (note / 12);
        play({ at: i * 0.022, from: pitch, to: pitch * 0.94, length: 0.13, gain: 0.28, shape: "triangle" });
      }
      break;
    case "break":
      for (let i = 0; i < Math.min(count, 3); i++) {
        play({ at: i * 0.03, from: 130, to: 58, length: 0.18, gain: 0.28 });
        thud(i * 0.03, 420, 0.2, 0.13);
      }
      break;
    case "land":
      play({ from: 98, to: 55, length: 0.2, gain: 0.25 });
      thud(0, 220, 0.12, 0.15);
      break;
    case "clear":
      play({ from: 73.42, length: 0.45, gain: 0.24 });
      [0, 4, 7, 12, 16].forEach((note, i) => play({ at: i * 0.085, from: 146.83 * 2 ** (note / 12), length: 0.32, gain: 0.25 }));
      tap([12, 40, 24]);
      break;
    case "over":
      play({ from: 146.83, to: 49, length: 0.6, gain: 0.32, shape: "triangle" });
      thud(0.05, 180, 0.2, 0.4);
      tap(28);
      break;
    case "win":
      play({ from: 73.42, length: 0.65, gain: 0.26 });
      [0, 7, 12, 19].forEach((note, i) => play({ at: i * 0.12, from: 146.83 * 2 ** (note / 12), length: 0.42, gain: 0.27 }));
      tap([14, 50, 30]);
      break;
    case "lose":
      [0, -3].forEach((note, i) => play({ at: i * 0.18, from: 146.83 * 2 ** (note / 12), length: 0.45, gain: 0.26 }));
      break;
  }
}
