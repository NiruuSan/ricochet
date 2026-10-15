import { useId, useMemo } from "react";
import { Tooltip } from "@/components/ui/tooltip";
import type { AccountLevel, PlayerRank } from "@/lib/api-types";
import { cashbackFor, DIVISION_RR, LAMPORTS_PER_XP, rankName, RANKS } from "@/lib/levels";
import { amount } from "./format";
import { rankArt, type RankLook } from "./rank-art";
import styles from "./rank-badge.module.css";

/** Below this many pixels tall, the insignia is drawn in its compact form. */
const COMPACT_BELOW = 28;

/**
 * The rank's insignia (app/arena/rank-art.ts). `size` is its height; winged
 * ranks are wider than they are tall.
 */
export function RankEmblem({ tier, division, size = 22 }: { tier: RankLook; division: 1 | 2 | 3 | null; size?: number }) {
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

/** What a rank says in a tooltip: its RR, or how many placement games are left. */
export function rankDetail(rank: PlayerRank) {
  if (!rank.placed) return `${rank.placementsLeft} placement ${rank.placementsLeft === 1 ? "match" : "matches"} to go`;
  if (rank.tier === "bouncer") return `Bouncer #${rank.position} · ${rank.rating.toLocaleString("en")} RR`;
  return `${rank.name} · ${rank.rating.toLocaleString("en")} RR${rank.position ? ` · #${rank.position} this season` : ""}`;
}

/** Insignia and rank name, for lists. */
export function RankBadge({ rank, className = "" }: { rank: PlayerRank; className?: string }) {
  return (
    <Tooltip content={rankDetail(rank)}>
      <span className={`${styles.badge} ${styles[rank.tier]} ${className}`}>
        <RankEmblem tier={rank.tier} division={rank.division} size={15} />
        {rank.tier === "bouncer" && rank.position ? `Bouncer #${rank.position}` : rank.name}
      </span>
    </Tooltip>
  );
}

/** The next division up, and the RR it starts at; null at Diamond 3 and above. */
function nextDivision(rank: PlayerRank) {
  const at = RANKS.findIndex((r) => r.tier === rank.tier && r.division === rank.division);
  const next = at >= 0 && at < 17 ? RANKS[at + 1] : null;
  return next ? { name: rankName(next.tier, next.division), rating: next.rating } : null;
}

/** The ranked rank with its RR bar towards the next division, for profiles. */
export function RankProgress({ rank }: { rank: PlayerRank }) {
  const next = rank.placed ? nextDivision(rank) : null;
  const progress = !rank.placed ? 0 : next ? rank.points / DIVISION_RR : 1;
  const done = rank.placed ? 0 : rank.placementsLeft;
  return (
    <div className={`${styles.progress} ${styles[rank.tier]}`}>
      <RankEmblem tier={rank.tier} division={rank.division} size={44} />
      <div className={styles.progressBody}>
        <div className={styles.progressTop}>
          <b>{rank.tier === "bouncer" && rank.position ? `Bouncer #${rank.position}` : rank.name}</b>
          <span>{rank.placed ? `${next ? rank.points : rank.rating.toLocaleString("en")} RR` : `Season ${rank.season}`}</span>
        </div>
        <div
          className={styles.bar}
          role="progressbar"
          aria-label={rank.placed ? `RR towards ${next?.name ?? "the top"}` : "Placement matches played"}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
        >
          <span style={{ width: `${Math.max(2, progress * 100)}%` }} />
        </div>
        <small>
          {!rank.placed
            ? `${done} ranked ${done === 1 ? "match" : "matches"} to place you on the ladder`
            : next
              ? `${DIVISION_RR - rank.points} RR to ${next.name}`
              : rank.tier === "bouncer"
                ? "Among the fifty best this season."
                : "The top fifty at Diamond 3 are Bouncers."}
        </small>
      </div>
    </div>
  );
}

/** The account level with its bar to the next one, and the cashback it earns. */
export function LevelProgress({ level, own }: { level: AccountLevel; own: boolean }) {
  const span = level.next === null ? 1 : level.next - level.floor;
  const progress = level.next === null ? 1 : (level.xp - level.floor) / span;
  const step = cashbackFor(level.level);
  return (
    <div className={`${styles.progress} ${styles.levelCard}`}>
      <span className={styles.levelMark} aria-hidden>
        {level.level}
      </span>
      <div className={styles.progressBody}>
        <div className={styles.progressTop}>
          <b>Level {level.level}</b>
          <span>{step.share}% cashback</span>
        </div>
        <div className={styles.bar} role="progressbar" aria-label="Progress to the next level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
          <span style={{ width: `${Math.max(2, progress * 100)}%` }} />
        </div>
        <small>
          {level.next === null
            ? "The last level. It never goes down."
            : `${own ? "Wager" : "Another"} ${amount((level.next - level.xp) * LAMPORTS_PER_XP, "devnet")} ${own ? "more for" : "to"} level ${level.level + 1}. A level is never lost.`}
        </small>
      </div>
    </div>
  );
}
