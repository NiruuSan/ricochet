"use client";
import { RankBadge } from "../rank-badge";
import { useEffect, useRef, useState } from "react";
import { Swords, ArrowRight } from "lucide-react";
import type { Asset, MatchRecap, RecapSide, PlayerLevel } from "@/lib/api-types";
import type { Game } from "@/lib/engine";
import { request } from "../api";
import { Avatar } from "../avatar";
import { drawBoard } from "../board-canvas";
import { CURRENCY, signedAmount, units, amount } from "../format";
import styles from "./screens.module.css";

const POLL_MS = 4_000;

export type ResultTarget =
  | { kind: "practice"; game: Game; clears: number; name: string; avatar: string | null; level?: PlayerLevel }
  /** `ready` is false while the final shots are still being saved. */
  | { kind: "match"; matchId: string; ready: boolean };

type Props = {
  target: ResultTarget;
  onPlayAgain: (again: { asset: Asset; stake: number } | null) => void;
  /** Opens a private match for the same opponent, at the same entry. */
  onRematch?: (asset: Asset, stake: number, opponent: string) => Promise<unknown>;
  onClose: () => void;
  /** Called once when a match result becomes final, so balances can refresh. */
  onSettled?: () => void;
};

function useCountUp(value: number, duration = 900) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setShown(Math.round(value * (1 - Math.pow(1 - t, 3))));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);
  return shown;
}

export function FinalBoard({ game, label }: { game: Game; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) drawBoard(ref.current, null, { ...game, over: true }, 90);
  }, [game]);
  return (
    <div className={styles.boardCard}>
      <canvas ref={ref} width={472} height={612} aria-label={`${label}: final board`} />
      <span className={styles.boardLabel}>{label}</span>
    </div>
  );
}

/** Loads a match recap and keeps it fresh until the result is final. */
function useRecap(target: ResultTarget, onSettled?: () => void) {
  const [recap, setRecap] = useState<MatchRecap | null>(null);
  const [error, setError] = useState("");
  const settledRef = useRef(false);
  const matchId = target.kind === "match" ? target.matchId : null;
  const ready = target.kind === "match" && target.ready;
  useEffect(() => {
    if (!matchId || !ready) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const next = await request<MatchRecap>(`/api/matches/${encodeURIComponent(matchId)}`);
        if (!active) return;
        setRecap(next);
        setError("");
        if (next.status === "settled") {
          if (!settledRef.current) {
            settledRef.current = true;
            onSettled?.();
            // Seeing the result here is the notification; do not announce it again.
            void request("/api/notifications", { action: "read", matchId }).catch(() => {});
          }
          return;
        }
      } catch (e) {
        if (active) setError((e as Error).message);
      }
      if (active) timer = setTimeout(load, POLL_MS);
    };
    void load();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [matchId, ready, onSettled]);
  return { recap, error };
}

/** `missing` stands in for the opponent's value: "?" while hidden, "—" when there is no opponent. */
function StatRow({ label, you, them, missing, final = false }: { label: string; you: number; them: number | null; missing: string; final?: boolean }) {
  const mine = useCountUp(you);
  const theirs = useCountUp(them ?? 0);
  const leadYou = them !== null && you > them;
  const leadThem = them !== null && them > you;
  return (
    <tr className={final ? styles.finalRow : undefined}>
      <td className={leadYou ? styles.lead : undefined}>{mine.toLocaleString("en")}</td>
      <td>{label}</td>
      <td className={them === null ? styles.hidden : leadThem ? styles.lead : undefined}>{them === null ? missing : theirs.toLocaleString("en")}</td>
    </tr>
  );
}

function PracticeStat({ label, value, main = false }: { label: string; value: number; main?: boolean }) {
  const shown = useCountUp(value);
  return (
    <div className={`${styles.practiceStat} ${main ? styles.practiceScore : ""}`}>
      <strong>{shown.toLocaleString("en")}</strong>
      <span>{label}</span>
    </div>
  );
}

/** Practice has no opponent: the player's own run, without a versus layout. */
function PracticeDetails({ you }: { you: RecapSide }) {
  return (
    <section className={styles.details}>
      <header className={styles.practiceHeader}>
        <Avatar name={you.name} src={you.avatar} size={48} />
        <div className={styles.identity}>
          <div className={styles.nameRow}>
            <b>{you.name}</b>
            {you.level && <RankBadge level={you.level} />}
          </div>
          <span className={`${styles.chip} ${styles.you}`}>PRACTICE RUN</span>
        </div>
      </header>
      <div className={styles.practiceStats}>
        <PracticeStat label="Final score" value={you.score} main />
        <PracticeStat label="Rounds" value={you.rounds} />
        <PracticeStat label="Balls" value={you.balls} />
        <PracticeStat label="Boards cleared" value={you.clears} />
      </div>
      <div className={styles.boardsSection}>
        <p className={styles.eyebrow}>FINAL BOARD</p>
        <div className={styles.boards}>
          <div className={styles.boardSolo}>
            <FinalBoard game={you.board} label="Your board" />
          </div>
        </div>
      </div>
    </section>
  );
}

export function ResultScreen({ target, onPlayAgain, onRematch, onClose, onSettled }: Props) {
  const { recap, error } = useRecap(target, onSettled);
  // One rematch per result screen, so a double tap does not open two matches.
  const [rematched, setRematched] = useState(false);

  // Close on Escape, like any full-screen overlay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const practice = target.kind === "practice";
  const you: RecapSide | null = practice
    ? { name: target.name, avatar: target.avatar, level: target.level, score: target.game.score, balls: target.game.balls, clears: target.clears, rounds: target.game.round, forfeit: false, board: target.game }
    : (recap?.you ?? null);

  if (!you || (!practice && !recap)) {
    return (
      <div className={`${styles.result} ${styles.pending}`} role="dialog" aria-modal="true" aria-label="Run complete">
        <section className={styles.outcome}>
          <p className={styles.eyebrow}>OUTCOME</p>
          <h1 className={styles.title}>
            <span>RUN</span>
            <span>OVER</span>
          </h1>
          <p className={styles.summary}>{error || "Saving your final score…"}</p>
          {error && (
            <button className={styles.backLink} onClick={onClose}>
              Back to lobby
            </button>
          )}
        </section>
        <section className={styles.details} />
      </div>
    );
  }

  const opponent = recap?.opponent ?? null;
  const them = opponent?.stats ?? null;
  const status = recap?.status;
  const settled = status === "settled";
  const result = recap?.result ?? null;
  const tone = practice || !settled ? "pending" : result === "win" ? "win" : result === "loss" ? "loss" : result === "draw" ? "draw" : "pending";
  const title = practice || !settled ? ["RUN", "COMPLETE"] : result === "win" ? ["YOU", "WON"] : result === "loss" ? ["YOU", "LOST"] : result === "draw" ? ["IT'S A", "DRAW"] : ["MATCH", "CLOSED"];
  const score = you.score.toLocaleString("en");
  const asset = recap?.asset ?? "gems";

  let summary: React.ReactNode;
  if (practice) summary = <>You scored <b>{score}</b> in practice. No stake, just skill.</>;
  else if (status === "waiting") summary = <>You scored <b>{score}</b>. Nobody has taken the other seat yet, so yours is the score to beat. We will notify you when the match settles.</>;
  else if (status === "opponent_playing") summary = <>You scored <b>{score}</b>. <b>{opponent?.name}</b> is still playing. Their result appears here the moment they finish.</>;
  else if (status === "playing") summary = <>Saving your final score…</>;
  else if (result === "cancelled") summary = <>You forfeited before anyone joined, so the match closed.</>;
  else {
    const theirScore = them?.score.toLocaleString("en");
    const yours = you.forfeit ? <>You forfeited with <b>{score}</b></> : <>You scored <b>{score}</b></>;
    const theirs = them?.forfeit ? <>{opponent?.name} forfeited with <b>{theirScore}</b></> : <>{opponent?.name} scored <b>{theirScore}</b></>;
    if (result === "draw") summary = <>{yours}. {theirs}. Entries refunded.</>;
    else if (result === "win") summary = <>{you.forfeit ? "" : "Congratulations! "}{yours}. {theirs}.</>;
    else summary = <>{yours}. {theirs}.</>;
  }

  const again = recap ? { asset: recap.asset, stake: recap.stake } : null;
  const missing = !opponent || result === "cancelled" ? "—" : "?";
  const net = recap?.net ?? 0;

  return (
    <div className={`${styles.result} ${styles[tone]}`} role="dialog" aria-modal="true" aria-label={title.join(" ")}>
      <section className={styles.outcome} key={`${tone}-${status}`}>
        <p className={styles.eyebrow}>{practice ? "PRACTICE" : "OUTCOME"}</p>
        <h1 className={styles.title}>
          <span>{title[0]}</span>
          <span>{title[1]}</span>
        </h1>
        <p className={styles.summary}>{summary}</p>
        <div className={styles.payout}>
          <div>
            {practice ? (
              <>
                <small>PRACTICE</small>
                <strong>Free</strong>
                <em>No entry, no payout</em>
              </>
            ) : settled ? (
              <>
                <small>PAYOUT · NET</small>
                <strong className={net > 0 ? styles.positive : net < 0 ? styles.negative : undefined}>
                  {signedAmount(net, asset)} {CURRENCY[asset]}
                </strong>
                <em>
                  Entry {amount(recap!.stake, asset)}
                  {recap!.bonusGems > 0 && <b className={styles.gemBonus}> · +{recap!.bonusGems} gems bonus</b>}
                  {recap!.rebate > 0 && <b className={styles.gemBonus}> · +{amount(recap!.rebate, asset)} fee back</b>}
                </em>
              </>
            ) : (
              <>
                <small>ENTRY · IN PLAY</small>
                <strong>
                  {units(recap!.stake, asset)} {CURRENCY[asset]}
                </strong>
                <em>Settles when both runs are done</em>
              </>
            )}
          </div>
          <div className={styles.payoutActions}>
            <button className={`btn ${styles.playAgain}`} onClick={() => onPlayAgain(practice ? null : again)}>
              Play again <ArrowRight />
            </button>
            <small>{practice ? "NEW BOARD" : "SAME STAKE"}</small>
            {onRematch && opponent && again && (
              <button
                className={styles.rematch}
                disabled={rematched}
                onClick={() => {
                  setRematched(true);
                  void onRematch(again.asset, again.stake, opponent.name);
                }}
              >
                <Swords size={14} /> {rematched ? `${opponent.name} has been challenged` : `Rematch ${opponent.name}`}
              </button>
            )}
          </div>
        </div>
        <button className={styles.backLink} onClick={onClose}>
          Back to lobby
        </button>
      </section>

      {practice ? (
        <PracticeDetails you={you} />
      ) : (
        <section className={styles.details}>
          <header className={styles.versus}>
            <div className={styles.side}>
              <Avatar name={you.name} src={you.avatar} size={48} />
              <div className={styles.identity}>
                <div className={styles.nameRow}>
                  <b>{you.name}</b>
                  {you.level && <RankBadge level={you.level} />}
                </div>
                <span className={`${styles.chip} ${styles.you}`}>YOU</span>
              </div>
            </div>
            <span className={styles.vs}>VS</span>
            <div className={`${styles.side} ${styles.sideRight}`}>
              <div className={styles.identity}>
                <div className={styles.nameRow}>
                  <b>{opponent?.name ?? "Open seat"}</b>
                  {opponent && <RankBadge level={opponent.level} />}
                </div>
                <span className={`${styles.chip} ${status === "opponent_playing" ? styles.live : ""}`}>
                  {status === "opponent_playing" ? "PLAYING" : opponent ? (them?.forfeit ? "FORFEIT" : "OPP") : "WAITING"}
                </span>
              </div>
              {opponent ? <Avatar name={opponent.name} src={opponent.avatar} size={48} /> : <span className={styles.emptySeat}>?</span>}
            </div>
          </header>

          <table className={`${styles.stats} ${them ? styles.reveal : ""}`} key={them ? "revealed" : "hidden"}>
            <tbody>
              <StatRow label="Balls" you={you.balls} them={them?.balls ?? null} missing={missing} />
              <StatRow label="Boards cleared" you={you.clears} them={them?.clears ?? null} missing={missing} />
              <StatRow label="Rounds" you={you.rounds} them={them?.rounds ?? null} missing={missing} />
              <StatRow label="Final score" you={you.score} them={them?.score ?? null} missing={missing} final />
            </tbody>
          </table>

          <div className={styles.boardsSection}>
            <p className={styles.eyebrow}>FINAL BOARDS</p>
            <div className={styles.boards}>
              <FinalBoard game={you.board} label="Your board" />
              {them ? (
                <FinalBoard game={them.board} label={`${them.name}'s board`} />
              ) : (
                <div className={`${styles.boardCard} ${styles.boardHidden}`}>
                  {opponent ? `${opponent.name}'s board is revealed when they finish.` : "Waiting for a challenger to take the seat."}
                </div>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
