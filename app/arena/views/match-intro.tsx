"use client";
import { Gem, Zap } from "lucide-react";
import type { Asset } from "@/lib/api-types";
import { Avatar } from "../avatar";
import { currency, units } from "../format";
import { themeById, themeStyle } from "../theme";
import styles from "./screens.module.css";

export type IntroStage = "searching" | "ready" | "go" | "leaving";

// Decorative bricks drifting behind the stake; positions are fixed so renders stay stable.
const BRICKS = [
  { left: "12%", top: "22%", color: "#bb8cff", delay: "0s" },
  { left: "80%", top: "18%", color: "#68d9d6", delay: "0.6s" },
  { left: "18%", top: "72%", color: "#ffd17b", delay: "1.2s" },
  { left: "74%", top: "70%", color: "#fa98b4", delay: "0.3s" },
  { left: "6%", top: "46%", color: "#c6f564", delay: "1.8s" },
  { left: "88%", top: "44%", color: "#9fccfc", delay: "0.9s" },
  { left: "40%", top: "10%", color: "#c6f564", delay: "2.2s" },
  { left: "58%", top: "86%", color: "#bb8cff", delay: "1.5s" },
];

type Props = {
  asset: Asset;
  stake: number;
  stage: IntroStage;
  /** Undefined while searching; null when the player takes an open seat first. */
  opponent?: { name: string; avatar: string | null } | null;
  /** A tournament run: the number is the prize pool instead of a stake. */
  tournament?: string;
  /** The player's skin (lib/themes.ts): the drifting bricks wear its colours too. */
  theme?: string | null;
};

/** Full-screen matchmaking moment between choosing a stake and the first shot. */
export function MatchIntro({ asset, stake, stage, opponent, tournament, theme }: Props) {
  // The bricks drifting behind take their colours from the theme, in the order
  // they were written, so the arrangement never moves between renders.
  const palette = themeById(theme).board.bricks;
  const bricks = BRICKS.map((brick, i) => ({ ...brick, color: palette[i % palette.length][0] }));
  const ready = stage !== "searching";
  // On GO the stake and status clear out, so the word has the screen to itself.
  const go = stage === "go" || stage === "leaving";
  return (
    <div className={`${styles.intro} ${stage === "leaving" ? styles.introLeaving : ""}`} style={themeStyle(theme)} role="status" aria-live="polite">
      <div className={styles.rings} aria-hidden>
        <span />
        <span />
        <span />
      </div>
      <div className={styles.orbit} aria-hidden />
      <div className={styles.bricks} aria-hidden>
        {bricks.map((b, i) => (
          <span key={i} style={{ left: b.left, top: b.top, background: b.color, animationDelay: b.delay }} />
        ))}
      </div>
      <div className={`${styles.introCenter} ${go ? styles.introCleared : ""}`}>
        <p className={styles.introTag}>{tournament ? "TOURNAMENT RUN" : ready ? "MATCH READY" : "ENTERING THE ARENA"}</p>
        <div className={styles.stakeValue}>
          {asset === "gems" ? <Gem /> : <Zap fill="currentColor" />}
          {units(stake, asset)}
        </div>
        <div className={styles.introBelow}>
          <p className={styles.stakeUnit}>
            {currency(asset).toUpperCase()} {tournament ? "PRIZE POOL" : "ON THE LINE"}
          </p>
          <div className={styles.introStatus}>
            {tournament ? (
              !ready ? (
                <span className={styles.dots}>Loading your run</span>
              ) : (
                <span className={styles.found}>
                  One run in <b>{tournament}</b>. Make it count.
                </span>
              )
            ) : !ready ? (
              <span className={styles.dots}>Finding your opponent</span>
            ) : opponent ? (
              <span className={`${styles.introStatus} ${styles.found}`} style={{ marginTop: 0 }}>
                VS <Avatar name={opponent.name} src={opponent.avatar} size={44} /> <b>{opponent.name}</b>
              </span>
            ) : (
              <span className={styles.found}>Seat open · your score is the one to beat</span>
            )}
          </div>
        </div>
      </div>
      {ready && <div className={styles.flash} aria-hidden key={go ? "go" : "ready"} />}
      {go && (
        <div className={styles.go} aria-hidden>
          GO
        </div>
      )}
    </div>
  );
}
