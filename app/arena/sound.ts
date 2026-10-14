"use client";
// The game's voice: what to play, and in which theme's voice.
//
// The synthesiser lives in sound-engine.ts and every theme's sounds in
// sound-kits.ts; this file is the one the rest of the game calls. A sound is
// always asked for in a kit — the theme the board is wearing — so a player who
// changes their skin changes what the game sounds like too.

import type { SoundKit } from "@/lib/themes";
import { brightness, isMuted, tap, tone } from "./sound-engine";
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

/** Money landing in the balance: a quick climbing patter, one note a gem. */
function coins(count: number) {
  const steps = [0, 2, 4, 5, 7, 9, 10, 12];
  for (let i = 0; i < Math.min(count, 8); i++) tone({ at: i * 0.04, from: 293.66 * 2 ** (steps[i] / 12), length: 0.14, gain: 0.16, shape: "triangle" });
  tone({ at: Math.min(count, 8) * 0.04, from: 587.33, length: 0.3, gain: 0.12 });
}
