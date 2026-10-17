import { useId } from "react";
import { Tooltip } from "@/components/ui/tooltip";
import { BADGES, type BadgeId } from "@/lib/badges";
import styles from "./badge-insignia.module.css";

// The insignia of a badge (lib/badges.ts): a shield, not a hexagon, so it is
// never mistaken for a rank. Beta tester wears the Blueprint theme's drafting
// blue with a compass on it; Founding player wears gold, with a star.

const LOOK: Record<BadgeId, { light: string; face: string; shadow: string; edge: string }> = {
  beta: { light: "#e3f3ff", face: "#6fb8ff", shadow: "#2a6fc0", edge: "#0b2a52" },
  founder: { light: "#fff3c4", face: "#f5c542", shadow: "#b8801a", edge: "#4a2e05" },
};

/** The insignia alone; `size` is its height. */
export function BadgeInsignia({ badge, size = 18 }: { badge: BadgeId; size?: number }) {
  const id = `badge${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const c = LOOK[badge];
  return (
    <svg className={styles.insignia} width={Math.round(size * (24 / 28))} height={size} viewBox="0 0 24 28" aria-hidden>
      <defs>
        <linearGradient id={`${id}-metal`} x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor={c.light} />
          <stop offset="0.5" stopColor={c.face} />
          <stop offset="1" stopColor={c.shadow} />
        </linearGradient>
      </defs>
      <path d="M12 1.2 22.4 4.9V13c0 6.7-4.6 11.9-10.4 13.8C6.2 24.9 1.6 19.7 1.6 13V4.9Z" fill={c.edge} />
      <path d="M12 2.9 20.8 6V13c0 5.7-3.9 10.2-8.8 12C7.1 23.2 3.2 18.7 3.2 13V6Z" fill={`url(#${id}-metal)`} />
      <path d="M12 5.2 18.6 7.6V13c0 4.5-3 8.2-6.6 9.7C8.4 21.2 5.4 17.5 5.4 13V7.6Z" fill={c.edge} opacity="0.88" />
      {badge === "founder" ? (
        <path d="m12 8.4 1.35 2.75 3.05.45-2.2 2.15.52 3.03L12 15.35l-2.72 1.43.52-3.03-2.2-2.15 3.05-.45Z" fill={`url(#${id}-metal)`} />
      ) : (
        // A drafting compass: the hinge, two legs, and the arc it draws.
        <g fill="none" stroke={`url(#${id}-metal)`} strokeWidth="1.5" strokeLinecap="round">
          <circle cx="12" cy="9.1" r="1.1" />
          <path d="M11.4 10.2 8.6 17.2M12.6 10.2l2.8 7" />
          <path d="M8.9 15.2a4.6 4.6 0 0 0 6.2 0" strokeWidth="1.1" opacity="0.85" />
        </g>
      )}
    </svg>
  );
}

/** Insignia and name, with what the badge means in its tooltip. */
export function BadgeChip({ badge, compact = false, className = "" }: { badge: BadgeId; compact?: boolean; className?: string }) {
  return (
    <Tooltip content={`${BADGES[badge].name}: ${BADGES[badge].blurb}`}>
      <span className={`${styles.chip} ${styles[badge]} ${compact ? styles.compact : ""} ${className}`} aria-label={BADGES[badge].name}>
        <BadgeInsignia badge={badge} size={compact ? 15 : 17} />
        {!compact && BADGES[badge].name}
      </span>
    </Tooltip>
  );
}
