import { Tooltip } from "@/components/ui/tooltip";
import type { PlayerLevel, RankTier } from "@/lib/api-types";
import { LAMPORTS_PER_XP } from "@/lib/levels";
import styles from "./rank-badge.module.css";

const NUMERALS = { 1: "I", 2: "II", 3: "III" } as const;

/** A shield in the tier's colour with the division numeral; Bouncer gets the Bounce icon. */
export function RankEmblem({ tier, division, size = 22 }: { tier: RankTier; division: 1 | 2 | 3 | null; size?: number }) {
  if (tier === "bouncer") {
    return <img className={styles.emblem} src="/brand/bounce-icon.svg" alt="" width={size} height={size} />;
  }
  return (
    <svg className={`${styles.emblem} ${styles[tier]}`} width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <path className={styles.shield} d="M12 1.8 20.6 5v6.1c0 5.5-3.6 9.7-8.6 11.1C7 20.8 3.4 16.6 3.4 11.1V5L12 1.8Z" />
      <path className={styles.shine} d="M12 3.9 5.4 6.4v4.7c0 1.1.2 2.2.5 3.2L12 3.9Z" />
      {division && (
        <text x="12" y="15.6" textAnchor="middle" className={styles.numeral}>
          {NUMERALS[division]}
        </text>
      )}
    </svg>
  );
}

/** Emblem and rank name, for lists. */
export function RankBadge({ level, className = "" }: { level: PlayerLevel; className?: string }) {
  return (
    <Tooltip content={`${level.name} · ${level.xp.toLocaleString("en")} XP`}><span className={`${styles.badge} ${styles[level.tier]} ${className}`}>
      <RankEmblem tier={level.tier} division={level.division} size={14} />
      {level.name}
    </span></Tooltip>
  );
}

const sol = (lamports: number) => (lamports / 1_000_000_000).toLocaleString("en", { maximumFractionDigits: 2 });

/** The rank with a progress bar towards the next one, for profiles. */
export function RankProgress({ level, own }: { level: PlayerLevel; own: boolean }) {
  const span = level.next === null ? 1 : level.next - level.floor;
  const progress = level.next === null ? 1 : (level.xp - level.floor) / span;
  return (
    <div className={`${styles.progress} ${styles[level.tier]}`}>
      <RankEmblem tier={level.tier} division={level.division} size={40} />
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
              ? `Wager ${sol((level.next - level.xp) * LAMPORTS_PER_XP)} more SOL to reach ${level.nextName}`
              : `${sol((level.next - level.xp) * LAMPORTS_PER_XP)} SOL away from ${level.nextName}`}
        </small>
      </div>
    </div>
  );
}
