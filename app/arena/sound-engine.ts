"use client";
// The synthesiser every theme's sounds are played on.
//
// Every sound is made on the spot: a few oscillators and one short noise
// buffer. Nothing is downloaded, nothing is decoded, and the whole soundtrack
// costs less than a favicon — which matters on a phone on mobile data, where
// the game already has a board to paint.
//
// The browser will not let a page make a sound before the player has touched
// it, so the audio context is created on the first shot and never before.
// Two notes on phones: iOS routes the Web Audio API through the ringer switch,
// so a muted phone stays muted whatever this file does, and `navigator.vibrate`
// does not exist on iOS at all — the taps below are an Android extra, never
// something the game leans on.

const KEY = "bounce.sound";
/** Master level. The game is played next to other tabs; it does not shout. */
const MASTER = 0.22;
/**
 * The most sources sounding at once. A forty-ball ricochet asks for far more
 * notes than anyone can hear; past this the extra ones are simply not played,
 * so a long rally never costs a phone its frame rate.
 */
const VOICES = 40;

let context: AudioContext | null = null;
let master: GainNode | null = null;
let warmth: BiquadFilterNode | null = null;
let echo: GainNode | null = null;
let noise: AudioBuffer | null = null;
let active = 0;
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
    // How bright the theme sounds: each kit sets the top of this filter.
    warmth = context.createBiquadFilter();
    warmth.type = "lowpass";
    warmth.frequency.value = 1_100;
    warmth.Q.value = 0.5;
    // Keep dense ricochets from getting loud.
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -16;
    compressor.knee.value = 12;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.12;
    master.connect(warmth).connect(compressor).connect(context.destination);
    // One shared echo, for the themes that want a little space around them.
    echo = context.createGain();
    const delay = context.createDelay(1);
    delay.delayTime.value = 0.21;
    const feedback = context.createGain();
    feedback.gain.value = 0.34;
    const damp = context.createBiquadFilter();
    damp.type = "lowpass";
    damp.frequency.value = 2_400;
    echo.connect(delay).connect(damp).connect(feedback).connect(delay);
    damp.connect(master);
    const frames = Math.floor(context.sampleRate * 0.5);
    noise = context.createBuffer(1, frames, context.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  }
  // A context made before the first gesture, or suspended with the tab, wakes here.
  if (context.state === "suspended") void context.resume().catch(() => {});
  return context;
}

/** Sets how bright everything sounds, in hertz at the top of the master filter. */
export function brightness(hz: number) {
  const ctx = audio();
  if (!ctx || !warmth) return;
  if (Math.abs(warmth.frequency.value - hz) > 1) warmth.frequency.setTargetAtTime(hz, ctx.currentTime, 0.02);
}

/** Room for `cost` more sources? Counted down again as each one ends. */
function room(cost: number) {
  if (active + cost > VOICES) return false;
  active += cost;
  return true;
}
const release = (cost: number) => (active = Math.max(0, active - cost));

/** A gain that rises, holds a moment and falls away: the shape of every note here. */
function envelope(ctx: AudioContext, start: number, length: number, gain: number, attack: number, gate: boolean) {
  const level = ctx.createGain();
  level.gain.setValueAtTime(0.0001, start);
  level.gain.linearRampToValueAtTime(gain, start + attack);
  if (gate) {
    // Held, then cut off dead: the gated snare of an eighties record.
    level.gain.setValueAtTime(gain, start + length * 0.8);
    level.gain.linearRampToValueAtTime(0.0001, start + length);
  } else {
    level.gain.exponentialRampToValueAtTime(gain * 0.12, start + Math.max(attack + 0.005, length * 0.55));
    level.gain.exponentialRampToValueAtTime(0.0001, start + length);
  }
  return level;
}

/** Sends a note to the speakers, and some of it into the echo. */
function route(ctx: AudioContext, level: GainNode, wet: number) {
  level.connect(master!);
  if (wet > 0 && echo) {
    const send = ctx.createGain();
    send.gain.value = wet;
    level.connect(send).connect(echo);
  }
}

export type Note = {
  /** Where it starts, in seconds from now. */
  at?: number;
  from: number;
  /** Slides to this pitch over its length, for a chirp. */
  to?: number;
  length: number;
  gain?: number;
  shape?: OscillatorType;
  /** Seconds to reach full level: a pad swells, a pluck does not. */
  attack?: number;
  /** How much of it goes into the echo, 0 to 1. */
  echo?: number;
  /** A wobble in pitch: [times a second, hertz either way]. */
  wobble?: [number, number];
  /** Cents off pitch, to thicken a chord of two. */
  detune?: number;
};

/** One oscillator: the building block of nearly everything. */
export function tone({ at = 0, from, to, length, gain = 1, shape = "sine", attack, echo: wet = 0, wobble, detune = 0 }: Note) {
  const ctx = audio();
  const cost = wobble ? 2 : 1;
  if (!ctx || !master || !room(cost)) return;
  const start = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  osc.type = shape;
  osc.detune.value = detune;
  osc.frequency.setValueAtTime(from, start);
  if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), start + length);
  let lfo: OscillatorNode | null = null;
  if (wobble) {
    lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    lfo.frequency.value = wobble[0];
    depth.gain.value = wobble[1];
    lfo.connect(depth).connect(osc.frequency);
    lfo.start(start);
    lfo.stop(start + length + 0.02);
  }
  const level = envelope(ctx, start, length, gain, attack ?? Math.min(0.009, length / 3), false);
  osc.connect(level);
  route(ctx, level, wet);
  osc.onended = () => {
    release(cost);
    osc.disconnect();
    lfo?.disconnect();
    level.disconnect();
  };
  osc.start(start);
  osc.stop(start + length + 0.02);
}

export type Hiss = {
  at?: number;
  /** The filter that shapes the noise: a thud is lowpassed, a tear bandpassed, a click highpassed. */
  type?: BiquadFilterType;
  from: number;
  to?: number;
  q?: number;
  length: number;
  gain?: number;
  echo?: number;
  gate?: boolean;
};

/** Filtered noise: the body of a thud, a tear, a crackle or a snare. */
export function hiss({ at = 0, type = "lowpass", from, to, q = 0.7, length, gain = 1, echo: wet = 0, gate = false }: Hiss) {
  const ctx = audio();
  if (!ctx || !master || !noise || !room(1)) return;
  const start = ctx.currentTime + at;
  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  source.buffer = noise;
  filter.type = type;
  filter.Q.value = q;
  filter.frequency.setValueAtTime(from, start);
  if (to) filter.frequency.exponentialRampToValueAtTime(Math.max(20, to), start + length);
  const level = envelope(ctx, start, length, gain, Math.min(0.006, length / 3), gate);
  source.connect(filter).connect(level);
  route(ctx, level, wet);
  source.onended = () => {
    release(1);
    source.disconnect();
    filter.disconnect();
    level.disconnect();
  };
  source.start(start);
  source.stop(start + length + 0.01);
}

/**
 * A struck bell, glass or bowl: partials that are not whole multiples of the
 * note, each dying away faster than the one below it.
 */
export function bell(at: number, freq: number, length: number, gain: number, partials = [1, 2.76, 5.4], wet = 0) {
  partials.forEach((ratio, k) => tone({ at, from: freq * ratio, length: length / (1 + k * 0.8), gain: gain / (1 + k * 1.2), echo: wet }));
}

/** Two oscillators, one bending the other: metal, coins and digital chirps. */
export function fm({ at = 0, from, ratio, index, length, gain = 1, echo: wet = 0 }: { at?: number; from: number; ratio: number; index: number; length: number; gain?: number; echo?: number }) {
  const ctx = audio();
  if (!ctx || !master || !room(2)) return;
  const start = ctx.currentTime + at;
  const carrier = ctx.createOscillator();
  const modulator = ctx.createOscillator();
  const depth = ctx.createGain();
  carrier.frequency.value = from;
  modulator.frequency.value = from * ratio;
  depth.gain.setValueAtTime(from * index, start);
  depth.gain.exponentialRampToValueAtTime(Math.max(1, from * index * 0.05), start + length);
  modulator.connect(depth).connect(carrier.frequency);
  const level = envelope(ctx, start, length, gain, Math.min(0.005, length / 3), false);
  carrier.connect(level);
  route(ctx, level, wet);
  carrier.onended = () => {
    release(2);
    carrier.disconnect();
    modulator.disconnect();
    depth.disconnect();
    level.disconnect();
  };
  modulator.start(start);
  carrier.start(start);
  modulator.stop(start + length + 0.02);
  carrier.stop(start + length + 0.02);
}

/** A short tap where the hardware has one. iOS has none; nothing breaks there. */
export function tap(pattern: number | number[]) {
  load();
  if (muted) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Some browsers throw on a pattern they dislike rather than ignoring it.
  }
}
