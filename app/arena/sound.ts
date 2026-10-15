"use client";
// The game's voice: what to play, and in which theme's voice.
//
// The synthesiser lives in sound-engine.ts and every theme's sounds in
// sound-kits.ts; this file is the one the rest of the game calls. A sound is
// always asked for in a kit — the theme the board is wearing — so a player who
// changes their skin changes what the game sounds like too.

import type { SoundKit } from "@/lib/themes";
import { bell, brightness, hiss, isMuted, tap, tone } from "./sound-engine";
import { KITS } from "./sound-kits";

export { isMuted, setMuted, subscribe } from "./sound-engine";

type Voice = "launch" | "hit" | "break" | "land" | "clear" | "over" | "win" | "lose" | "coin";

/**
 * Bricks hit in one shot climb the kit's ladder, so a long ricochet is heard as
 * a run rather than as the same click twenty times. The ladder resets with each
 * shot.
 */
let combo = 0;

export function resetCombo() {
  combo = 0;
}

/**
 * One sound. `count` lets a frame full of hits arrive as a quick run of notes;
 * `kit` is the theme's voice, the original one when none is given.
 */
export function playSound(voice: Voice, count = 1, kit: SoundKit = "classic") {
  if (isMuted()) return;
  // Money landing in the balance belongs to the site, not to a theme.
  const sound = KITS[voice === "coin" ? "classic" : kit] ?? KITS.classic;
  brightness(sound.bright);
  switch (voice) {
    case "launch":
      sound.launch();
      tap(8);
      break;
    case "hit":
      // Every hit in the same frame lands a moment after the one before it.
      for (let i = 0; i < Math.min(count, 4); i++) {
        const step = sound.ladder[Math.min(combo++, sound.ladder.length - 1)];
        sound.hit(sound.root * 2 ** (step / 12), i * 0.022);
      }
      break;
    case "break":
      for (let i = 0; i < Math.min(count, 3); i++) sound.break(i * 0.03, i);
      break;
    case "land":
      sound.land();
      break;
    case "clear":
      sound.clear();
      tap([12, 40, 24]);
      break;
    case "over":
      sound.over();
      tap(28);
      break;
    case "win":
      sound.win();
      tap([14, 50, 30]);
      break;
    case "lose":
      sound.lose();
      break;
    case "coin":
      coins(count);
      break;
  }
}

/**
 * A promotion, timed to the insignia landing `at` seconds from now: a rush
 * rising to it, a deep hit as it lands, then a chord of bells. A new tier, a
 * first rank or a place among the Bouncers is `big`: a fourth bell and a
 * shimmer climbing above the chord. It is the site's own voice, whatever
 * theme the board wears.
 */
export function playRankUp(big: boolean, at = 1.05) {
  if (isMuted()) return;
  brightness(KITS.classic.bright);
  hiss({ at: Math.max(0, at - 0.95), type: "bandpass", from: 300, to: 5200, q: 1.1, length: 0.95, gain: 0.07 });
  tone({ at, from: 124, to: 38, length: 0.55, gain: 0.55 });
  hiss({ at, type: "lowpass", from: 2600, to: 160, length: 0.45, gain: 0.22 });
  const chord = big ? [523.25, 659.25, 783.99, 1046.5] : [587.33, 739.99, 880];
  chord.forEach((freq, i) => bell(at + 0.06 + i * 0.09, freq, 1.9, 0.16, [1, 2.76, 5.4], 0.35));
  if (big) [0, 4, 7, 12, 7, 12].forEach((step, i) => tone({ at: at + 0.55 + i * 0.07, from: 1046.5 * 2 ** (step / 12), length: 0.5, gain: 0.05, shape: "triangle", echo: 0.5 }));
  tap([18, 70, 36]);
}

/** Money landing in the balance: a quick climbing patter, one note a gem. */
function coins(count: number) {
  const steps = [0, 2, 4, 5, 7, 9, 10, 12];
  for (let i = 0; i < Math.min(count, 8); i++) tone({ at: i * 0.04, from: 293.66 * 2 ** (steps[i] / 12), length: 0.14, gain: 0.16, shape: "triangle" });
  tone({ at: Math.min(count, 8) * 0.04, from: 587.33, length: 0.3, gain: 0.12 });
}
