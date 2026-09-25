"use client";
import { RankBadge } from "../rank-badge";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { TournamentDetail, TournamentStanding, WatchData } from "@/lib/api-types";
import type { Game } from "@/lib/engine";
import { request } from "../api";
import { Avatar } from "../avatar";
import { drawBoard } from "../board-canvas";
import { amount } from "../format";
import { ordinal } from "../tournament-format";
import { themeStyle, themeById } from "../theme";
import screens from "./screens.module.css";
import styles from "./tournaments.module.css";

const POLL_MS = 8_000;
/** The peeked board, sized here because the card is placed by hand. */
const PEEK_W = 248;
const PEEK_H = Math.round((PEEK_W * 612) / 472);

type Props = {
  tournamentId: string;
  /** False while the final shots are still being saved. */
  ready: boolean;
  board: Game;
  onClose: () => void;
  /** The player's skin (lib/themes.ts). */
  theme?: string | null;
};

/** A board held for a name the viewer pointed at; null while it is on its way. */
type Peeked = { board: Game } | { note: string } | null;
/** The name being pointed at, and where its card belongs on screen. */
type Peek = { key: number; name: string; watchId: string | null; started: boolean; isYou: boolean; top: number; left: number };

/**
 * Level with the name, and clear of the standings: the card hangs off the left
 * of the table, or off its right when the screen runs out on that side.
 */
function place(name: HTMLElement, table: HTMLElement | null) {
  const r = name.getBoundingClientRect();
  const beside = (table ?? name).getBoundingClientRect();
  const gap = 14;
  const room = beside.left - PEEK_W - gap;
  const left = Math.max(12, room < 12 ? Math.min(beside.right + gap, window.innerWidth - PEEK_W - 12) : room);
  const top = Math.max(12, Math.min(r.top + r.height / 2 - PEEK_H / 2, window.innerHeight - PEEK_H - 12));
  return { top, left };
}

/** One board, drawn as it stood on the last shot. */
function PeekBoard({ game, theme }: { game: Game; theme?: string | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) drawBoard(ref.current, null, { ...game, over: true }, 90, themeById(theme));
  }, [game, theme]);
  return <canvas ref={ref} width={472} height={612} />;
}

/** Full-screen end of a tournament run: the score, where it ranks, and the standings so far. */
export function TournamentResult({ tournamentId, ready, board, onClose, theme }: Props) {
  const [t, setT] = useState<TournamentDetail | null>(null);
  const [peek, setPeek] = useState<Peek | null>(null);
  // One fetch per run, kept for as long as the screen is open.
  const [boards, setBoards] = useState<Record<string, Peeked>>({});

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

  // Nobody else's run is in hand, so the first look at a name goes and gets it.
  // Asked runs are held in a ref: pointing away must not cancel the fetch that
  // pointing at the name started.
  const asked = useRef(new Set<string>());
  const watching = peek && !peek.isYou ? peek.watchId : null;
  useEffect(() => {
    if (!watching || asked.current.has(watching)) return;
    asked.current.add(watching);
    void request<WatchData>(`/api/watch/${encodeURIComponent(watching)}`).then(
      (run) => setBoards((held) => ({ ...held, [watching]: { board: run.state } })),
      (e: Error) => setBoards((held) => ({ ...held, [watching]: { note: e.message } })),
    );
  }, [watching]);

  const table = useRef<HTMLTableElement>(null);
  const show = useCallback((key: number, s: TournamentStanding, el: HTMLElement) => {
    setPeek({ key, name: s.name, watchId: s.watchId, started: s.started, isYou: s.isYou, ...place(el, table.current) });
  }, []);
  const hide = useCallback(() => setPeek(null), []);

  const you = t?.you;
  const mine = t?.yourStanding;
  const settled = t?.status === "settled";
  const top = t?.standings.slice(0, 8) ?? [];
  const tone = settled && (you?.payout ?? 0) > 0 ? "win" : "pending";
  const title = settled ? (you?.rank === 1 ? ["YOU", "WON"] : ["FINAL", "RANK"]) : ["RUN", "COMPLETE"];
  // Your own run is already in hand; everyone else's is fetched, or refused.
  const peeked: Peeked = !peek
    ? null
    : peek.isYou
      ? { board }
      : peek.watchId
        ? (boards[peek.watchId] ?? null)
        : { note: peek.started ? "Their board is not open yet." : "They have not played their run yet." };

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
      <section className={`${screens.details} ${screens.detailsCentred}`}>
        <p className={screens.eyebrow}>{settled ? "FINAL STANDINGS" : "STANDINGS SO FAR"}</p>
        {t ? (
          <>
            <table className={`${styles.table} ${styles.standings}`} ref={table}>
              <tbody>
                {top.map((s, i) => (
                  <tr key={i} className={s.isYou ? styles.mine : undefined}>
                    <td className={s.rank === 1 ? styles.gold : undefined}>{s.rank ? `#${s.rank}` : "—"}</td>
                    <td>
                      <button
                        type="button"
                        className={`${styles.player} ${screens.peekName}`}
                        aria-label={`Show the board ${s.name} finished on`}
                        aria-expanded={peek?.key === i}
                        onMouseEnter={(e) => show(i, s, e.currentTarget)}
                        onFocus={(e) => show(i, s, e.currentTarget)}
                        onMouseLeave={hide}
                        onBlur={hide}
                        onClick={(e) => (peek?.key === i ? hide() : show(i, s, e.currentTarget))}
                      >
                        <Avatar name={s.name} src={s.avatar} size={28} />
                        <span className={styles.identity}>
                          <b>{s.name}</b> <RankBadge level={s.level} />
                        </span>
                      </button>
                    </td>
                    <td>{s.started ? s.score.toLocaleString("en") : "—"}</td>
                    <td className={s.payout ? styles.positive : styles.muted}>{s.payout ? amount(s.payout, t.asset) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className={screens.peekHint}>Point at a name — yours too — to see the board they finished on.</p>
          </>
        ) : (
          <p className="muted">Loading standings…</p>
        )}
      </section>
      {peek && (
        <div className={screens.peek} style={{ top: peek.top, left: peek.left, width: PEEK_W, height: PEEK_H }} role="presentation">
          {peeked && "board" in peeked ? (
            <PeekBoard game={peeked.board} theme={peek.isYou ? theme : null} />
          ) : (
            <p className={screens.peekNote}>{peeked?.note ?? "Loading their board…"}</p>
          )}
          <span className={screens.peekLabel}>{peek.isYou ? "Your board" : peek.name}</span>
        </div>
      )}
    </div>
  );
}
