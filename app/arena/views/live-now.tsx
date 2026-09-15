"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Eye, Medal, Radio, Swords } from "lucide-react";
import type { LiveGame } from "@/lib/api-types";
import { request } from "../api";
import { Avatar } from "../avatar";
import { amount } from "../format";
import styles from "./watch.module.css";

const REFRESH_MS = 15_000;

/** Match and tournament runs being played right now, for the lobby. Hidden when there are none. */
export function LiveNow() {
  const [games, setGames] = useState<LiveGame[]>([]);

  useEffect(() => {
    let active = true;
    const load = () =>
      request<LiveGame[]>("/api/watch").then(
        (next) => active && setGames(next),
        () => {},
      );
    void load();
    const poll = setInterval(() => !document.hidden && void load(), REFRESH_MS);
    return () => {
      active = false;
      clearInterval(poll);
    };
  }, []);

  if (!games.length) return null;
  return (
    <div className={styles.liveSection}>
      <h2>
        <Radio size={18} className={styles.liveIcon} /> Live now
      </h2>
      <div className={styles.liveGrid}>
        {games.slice(0, 6).map((g) => (
          <Link key={g.watchId} href={`/watch/${g.watchId}`} className={styles.liveCard}>
            <Avatar name={g.name} src={g.avatar} size={38} />
            <span className={styles.liveInfo}>
              <b>{g.name}</b>
              <small>
                {g.kind === "tournament" ? <Medal size={12} /> : <Swords size={12} />} {g.kind === "tournament" ? g.context : `vs ${g.context} · ${amount(g.stake, g.asset)}`}
              </small>
            </span>
            <span className={styles.liveScore}>
              <b>{g.score.toLocaleString("en")}</b>
              <small>Round {g.round}</small>
            </span>
            <Eye size={16} className={styles.liveEye} aria-label="Watch" />
          </Link>
        ))}
      </div>
    </div>
  );
}
