"use client";
import { RankBadge } from "../rank-badge";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { TournamentDetail } from "@/lib/api-types";
import type { Game } from "@/lib/engine";
import { request } from "../api";
import { Avatar } from "../avatar";
import { amount } from "../format";
import { ordinal } from "../tournament-format";
import { FinalBoard } from "./result-screen";
import { themeStyle } from "../theme";
import screens from "./screens.module.css";
import styles from "./tournaments.module.css";

const POLL_MS = 8_000;

type Props = {
  tournamentId: string;
  /** False while the final shots are still being saved. */
  ready: boolean;
  board: Game;
  onClose: () => void;
  /** The player's skin (lib/themes.ts). */
  theme?: string | null;
};

/** Full-screen end of a tournament run: the score, where it ranks, and the standings so far. */
export function TournamentResult({ tournamentId, ready, board, onClose, theme }: Props) {
  const [t, setT] = useState<TournamentDetail | null>(null);

  useEffect(() => {
    if (!ready) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const next = await request<TournamentDetail>(`/api/tournaments/${encodeURIComponent(tournamentId)}`);
        if (!active) return;
        setT(next);
        if (next.status === "settled" || next.status === "cancelled") return;
      } catch {
        // Keep the last standings; the next poll retries.
      }
      if (active) timer = setTimeout(load, POLL_MS);
    };
    void load();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [ready, tournamentId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const you = t?.you;
  const mine = t?.yourStanding;
  const settled = t?.status === "settled";
  const top = t?.standings.slice(0, 8) ?? [];
  const tone = settled && (you?.payout ?? 0) > 0 ? "win" : "pending";
  const title = settled ? (you?.rank === 1 ? ["YOU", "WON"] : ["FINAL", "RANK"]) : ["RUN", "COMPLETE"];

  return (
    <div className={`${screens.result} ${screens[tone]}`} style={themeStyle(theme)} role="dialog" aria-modal="true" aria-label="Tournament run complete">
      <section className={screens.outcome}>
        <p className={screens.eyebrow}>{t ? t.name.toUpperCase() : "TOURNAMENT"}</p>
        <h1 className={screens.title}>
          <span>{title[0]}</span>
          <span>{title[1]}</span>
        </h1>
        {mine && <RankBadge level={mine.level} />}
        <p className={screens.summary}>
          {!t || !mine ? (
            "Saving your final score…"
          ) : settled ? (
            <>
              You finished <b>{ordinal(you?.rank ?? 0)}</b> of {t.standings.filter((s) => s.started).length} with <b>{mine.score.toLocaleString("en")}</b> points.
            </>
          ) : (
            <>
              You scored <b>{mine.score.toLocaleString("en")}</b>. That is <b>{mine.rank ? ordinal(mine.rank) : "—"}</b> of {t.standings.filter((s) => s.started).length} so far; the
              standings can still change until the tournament ends.
            </>
          )}
        </p>
        {t && mine && (
          <div className={screens.payout}>
            <div>
              <small>{settled ? "PRIZE" : "PROJECTED PRIZE"}</small>
              <strong className={mine.payout ? screens.positive : undefined}>{mine.payout ? `+${amount(mine.payout, t.asset)}` : "—"}</strong>
              <em>{settled ? (mine.payout ? "Paid to your balance" : "Outside the prize places") : `Pool ${amount(t.pot, t.asset)} · paid when the tournament ends`}</em>
            </div>
            <div className={screens.payoutActions}>
              <Link className={`btn ${screens.playAgain}`} href={`/tournaments/${t.id}`} onClick={onClose}>
                Standings <ArrowRight />
              </Link>
            </div>
          </div>
        )}
        <button className={screens.backLink} onClick={onClose}>
          Back to lobby
        </button>
      </section>
      <section className={screens.details}>
        <p className={screens.eyebrow}>{settled ? "FINAL STANDINGS" : "STANDINGS SO FAR"}</p>
        {t ? (
          <table className={`${styles.table} ${styles.standings}`}>
            <tbody>
              {top.map((s, i) => (
                <tr key={i} className={s.isYou ? styles.mine : undefined}>
                  <td className={s.rank === 1 ? styles.gold : undefined}>{s.rank ? `#${s.rank}` : "—"}</td>
                  <td>
                    <span className={styles.player}>
                      <Avatar name={s.name} src={s.avatar} size={28} />
                      <span className={styles.identity}><b>{s.name}</b> <RankBadge level={s.level} /></span>
                    </span>
                  </td>
                  <td>{s.started ? s.score.toLocaleString("en") : "—"}</td>
                  <td className={s.payout ? styles.positive : styles.muted}>{s.payout ? amount(s.payout, t.asset) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">Loading standings…</p>
        )}
        <div className={screens.boardsSection}>
          <p className={screens.eyebrow}>YOUR FINAL BOARD</p>
          <div className={screens.boards}>
            <FinalBoard game={board} label="Your board" theme={theme} />
          </div>
        </div>
      </section>
    </div>
  );
}
