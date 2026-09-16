import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowUpRight, Crown, Trophy } from "lucide-react";
import { Avatar } from "../avatar";
import styles from "./podium.module.css";

export type PodiumEntry = {
  name: string;
  avatar: string | null;
  href: string;
  /** Displayed place; tied players can share one. */
  rank: number;
  /** Small line under the name. */
  meta: ReactNode;
  valueLabel: string;
  value: string;
  unit?: string;
  negative?: boolean;
  isYou?: boolean;
};

const DEFAULT_TITLES = ["LEADING THE PACK", "SECOND PLACE", "THIRD PLACE"];

/**
 * The top three as podium cards: first place in the middle and highlighted.
 * Card styles follow the position on the podium; the badge shows the real rank,
 * so ties display correctly.
 */
export function Podium({ entries, titles = DEFAULT_TITLES, label = "Top three players" }: { entries: PodiumEntry[]; titles?: string[]; label?: string }) {
  return (
    <div className={styles.podium} aria-label={label}>
      {entries.slice(0, 3).map((p, i) => (
        <Link key={`${p.name}:${i}`} href={p.href} className={`${styles.podiumCard} ${styles[`place${i + 1}`]}`}>
          <span className={styles.podiumWatermark} aria-hidden>
            {String(p.rank).padStart(2, "0")}
          </span>
          <div className={styles.podiumTop}>
            <span>
              {i === 0 ? <Crown size={15} /> : <Trophy size={14} />}
              {titles[i]}
            </span>
            <ArrowUpRight size={16} aria-hidden />
          </div>
          <div className={styles.podiumIdentity}>
            <div className={styles.podiumAvatar}>
              <Avatar name={p.name} src={p.avatar} size={62} />
              <span>#{p.rank}</span>
            </div>
            <h2>{p.name}</h2>
            <span className={styles.podiumMeta}>
              {p.meta}
              {p.isYou && <span className={styles.you}>YOU</span>}
            </span>
          </div>
          <div className={styles.podiumProfit}>
            <span>{p.valueLabel}</span>
            <strong className={p.negative ? styles.negative : undefined}>
              {p.value} {p.unit && <small>{p.unit}</small>}
            </strong>
          </div>
        </Link>
      ))}
    </div>
  );
}
