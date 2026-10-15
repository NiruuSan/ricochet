"use client";
import { useCallback, useEffect, useId, useRef, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { PlayerRank, RatingChange } from "@/lib/api-types";
import { divisionIndex, tierIndex } from "@/lib/levels";
import { RANKED } from "@/lib/ranked-rules";
import { RankEmblem } from "./rank-badge";
import { rankMetal, type RankLook } from "./rank-art";
import { playRankUp } from "./sound";
import styles from "./rank-up.module.css";

// A rank earned, on the whole screen.
//
// The old insignia shakes and breaks, the new one lands with a flash, a
// shockwave and a burst of sparks in its metal, and the rank's name rises
// under it. A new tier is louder than a division, and a first rank or a place
// among the Bouncers louder still. It plays once per match: a recap opened
// again later does not celebrate twice. With reduced motion the screen shows
// its last frame and nothing moves.

export type RankUpKind = "division" | "tier" | "placed" | "bouncer";

/** What a ranked result is worth celebrating, if anything. */
export function rankUpOf(change: RatingChange | null | undefined, current?: PlayerRank): RankUpKind | null {
  if (!change || change.unrated) return null;
  const { rankBefore: before, rankAfter: after } = change;
  if (!after.placed) return null;
  if (!before.placed) return "placed";
  if (divisionIndex(after.rating) <= divisionIndex(before.rating)) return null;
  // Diamond 3 reached, and the player stands among the fifty best right now.
  if (current?.tier === "bouncer" && after.tier === "diamond" && after.division === 3) return "bouncer";
  return tierIndex(after.rating) > tierIndex(before.rating) ? "tier" : "division";
}

const SEEN = "bounce.rankups";

/** Whether this browser has already celebrated this match. */
export function celebrated(matchId: string) {
  try {
    return (JSON.parse(localStorage.getItem(SEEN) ?? "[]") as string[]).includes(matchId);
  } catch {
    return false;
  }
}

/** Remembers a celebration, keeping the last thirty. */
export function rememberCelebration(matchId: string) {
  try {
    const seen = (JSON.parse(localStorage.getItem(SEEN) ?? "[]") as string[]).filter((id) => id !== matchId);
    localStorage.setItem(SEEN, JSON.stringify([...seen, matchId].slice(-30)));
  } catch {
    // It may simply play again next time.
  }
}

/** When the new insignia lands, in seconds: the sound and the CSS share it. */
const LANDS = 1.05;
const SPARKS: Record<RankUpKind, number> = { division: 22, tier: 36, placed: 30, bouncer: 44 };
const EYEBROW: Record<RankUpKind, string> = { division: "PROMOTED", tier: "NEW TIER", placed: "PLACEMENT COMPLETE", bouncer: "BOUNCER" };

/** Sparks spread round the insignia: even angles, nudged so they never look ruled. */
function sparks(count: number) {
  return Array.from({ length: count }, (_, i) => {
    const wobble = Math.sin(i * 12.9898) * 43758.5453;
    const r = wobble - Math.floor(wobble);
    return {
      angle: (360 / count) * i + (r - 0.5) * (300 / count),
      distance: 120 + r * 190,
      size: 3 + ((i * 7) % 5),
      delay: (i % 6) * 0.025,
      length: 0.8 + r * 0.6,
      shade: i % 3,
    };
  });
}

type Props = {
  change: RatingChange;
  kind: RankUpKind;
  /** The player's rank now: for a Bouncer, the place they hold. */
  current?: PlayerRank;
  onDone: () => void;
};

export function RankUp({ change, kind, current, onDone }: Props) {
  const to = kind === "bouncer" && current ? current : change.rankAfter;
  const from: { tier: RankLook; division: 1 | 2 | 3 | null } = kind === "placed" ? { tier: "unranked", division: null } : change.rankBefore;
  const metal = rankMetal(to.tier);
  const big = kind !== "division";
  const titleId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const finished = useRef(false);
  const done = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    onDone();
  }, [onDone]);

  // The dialog takes the focus, so a screen reader announces it; the keys
  // below work wherever the focus is, so the button does not need it.
  useEffect(() => {
    playRankUp(big, LANDS);
    dialog.current?.focus();
  }, [big]);
  // Escape, Enter or Space close it, before the result screen underneath hears them.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" && e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      done();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [done]);

  const title = kind === "bouncer" && to.position ? `Bouncer #${to.position}` : to.name;
  const rating = `${to.rating.toLocaleString("en")} RR`;
  const line =
    kind === "placed"
      ? `Your rank for season ${to.season} · ${rating}`
      : kind === "bouncer"
        ? `Among the ${RANKED.bouncers} best this season · ${rating}`
        : `${change.rankBefore.name} → ${to.name} · ${rating}`;
  const note =
    kind === "placed"
      ? "Every ranked match moves it from here."
      : kind === "bouncer"
        ? "Hold your place: the top fifty change with every match."
        : `Shielded: your next ${RANKED.shield} losses can't drop you out of ${to.name}.`;

  const look = { "--light": metal.light, "--face": metal.face, "--shadow": metal.shadow, "--lands": `${LANDS}s` } as CSSProperties;
  return createPortal(
    <div ref={dialog} tabIndex={-1} className={`${styles.overlay} ${big ? styles.big : ""}`} style={look} role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={done}>
      <div className={styles.backdrop} />
      <div className={styles.tint} aria-hidden />
      <div className={styles.rays} aria-hidden />
      <div className={styles.flash} aria-hidden />
      <div className={styles.stage}>
        <div className={styles.emblems} aria-hidden>
          <span className={styles.glow} />
          <span className={styles.ring} />
          <span className={`${styles.ring} ${styles.ringLate}`} />
          <span className={styles.sparks}>
            {sparks(SPARKS[kind]).map((s, i) => (
              <i
                key={i}
                className={styles[`shade${s.shade}`]}
                style={{ "--a": `${s.angle}deg`, "--d": `${s.distance}px`, "--s": `${s.size}px`, "--t": `${s.length}s`, "--late": `${s.delay}s` } as CSSProperties}
              />
            ))}
          </span>
          <span className={styles.from}>
            <RankEmblem tier={from.tier} division={from.division} size={150} />
          </span>
          <span className={styles.to}>
            <span className={styles.float}>
              <RankEmblem tier={to.tier} division={to.division} size={big ? 200 : 176} />
            </span>
          </span>
        </div>
        <p className={styles.eyebrow}>{EYEBROW[kind]}</p>
        <h2 id={titleId} className={styles.title}>
          {title}
        </h2>
        <p className={styles.line}>
          {change.delta > 0 && <b>+{change.delta} RR</b>}
          {line}
        </p>
        <p className={styles.note}>{note}</p>
        <button className={styles.continue} onClick={done}>
          Continue
        </button>
      </div>
    </div>,
    document.body,
  );
}
