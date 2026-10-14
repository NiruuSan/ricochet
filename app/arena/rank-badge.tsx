import { useId, useMemo } from "react";
import { Tooltip } from "@/components/ui/tooltip";
import type { PlayerLevel, RankTier } from "@/lib/api-types";
import { LAMPORTS_PER_XP } from "@/lib/levels";
import { amount } from "./format";
import { rankArt } from "./rank-art";
import styles from "./rank-badge.module.css";

/** Below this many pixels tall, the insignia is drawn in its compact form. */
const COMPACT_BELOW = 28;

/**
 * The rank's insignia (app/arena/rank-art.ts). `size` is its height; winged
 * ranks are wider than they are tall.
 */
export function RankEmblem({ tier, division, size = 22 }: { tier: RankTier; division: 1 | 2 | 3 | null; size?: number }) {
  // Gradient ids of their own, so two badges on a page never borrow each other's.
  const id = `rank${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const compact = size < COMPACT_BELOW;
  const art = useMemo(() => rankArt(tier, division, id, compact), [tier, division, id, compact]);
  return (
    <svg
      className={styles.emblem}
      width={Math.round(size * art.width)}
      height={size}
      viewBox={art.viewBox}
      aria-hidden
      // Markup built from the rank alone, never from anything a player typed.
      dangerouslySetInnerHTML={{ __html: art.body }}
    />
  );
}

/** Emblem and rank name, for lists. */
export function RankBadge({ level, className = "" }: { level: PlayerLevel; className?: string }) {
  return (
    <Tooltip content={`${level.name} · ${level.xp.toLocaleString("en")} XP`}><span className={`${styles.badge} ${styles[level.tier]} ${className}`}>
      <RankEmblem tier={level.tier} division={level.division} size={15} />
      {level.name}
    </span></Tooltip>
  );
}


/** The rank with a progress bar towards the next one, for profiles. */
export function RankProgress({ level, own }: { level: PlayerLevel; own: boolean }) {
  const span = level.next === null ? 1 : level.next - level.floor;
  const progress = level.next === null ? 1 : (level.xp - level.floor) / span;
  return (
    <div className={`${styles.progress} ${styles[level.tier]}`}>
      <RankEmblem tier={level.tier} division={level.division} size={44} />
      <div className={styles.progressBody}>
        <div className={styles.progressTop}>
          <b>{level.name}</b>
          <span>
            {level.xp.toLocaleString("en")}
            {level.next !== null && <> / {level.next.toLocaleString("en")}</>} XP
          </span>
        </div>
        <div className={styles.bar} role="progressbar" aria-label={`Progress to ${level.nextName ?? "the top rank"}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
          <span style={{ width: `${Math.max(2, progress * 100)}%` }} />
        </div>
        <small>
          {level.next === null
            ? "Top rank reached."
            : own
              ? `Wager ${amount((level.next - level.xp) * LAMPORTS_PER_XP, "devnet")} more to reach ${level.nextName}`
              : `${amount((level.next - level.xp) * LAMPORTS_PER_XP, "devnet")} away from ${level.nextName}`}
        </small>
      </div>
    </div>
  );
}
