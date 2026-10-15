"use client";
import { RankBadge, RankEmblem } from "../rank-badge";
import { divisionIndex } from "@/lib/levels";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Swords, ArrowRight, Share2 } from "lucide-react";
import { STARTING_GEMS, type Asset, type MatchRecap, type RecapSide, type PlayerRank, type RatingChange } from "@/lib/api-types";
import type { Game } from "@/lib/engine";
import { request } from "../api";
import { Avatar } from "../avatar";
import { drawBoard } from "../board-canvas";
import { currency, signedAmount, units, amount } from "../format";
import { themeStyle, themeById } from "../theme";
import { playSound } from "../sound";
import { sharedLink, shareResult, useReferralCode } from "../share";
import { celebrated, RankUp, rankUpOf, rememberCelebration, type RankUpKind } from "../rank-up";
import styles from "./screens.module.css";

const POLL_MS = 4_000;

export type ResultTarget =
  | { kind: "practice"; game: Game; clears: number; name: string; avatar: string | null; ranked?: PlayerRank }
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
  /** The player's skin, worn by the screen and by the final boards on it. */
  theme?: string | null;
  /** A visitor without a player: practice ends on the way in rather than a share. */
  guest?: boolean;
};

/** What a shared result says, in the sharer's own words. */
function shareText(recap: MatchRecap | null, score: number) {
  const mine = score.toLocaleString("en");
  if (!recap) return `I scored ${mine} on Bounce. Same board for you: beat it.`;
  const opponent = recap.opponent?.name ?? "my rival";
  const theirs = (recap.opponent?.stats?.score ?? 0).toLocaleString("en");
  if (recap.result === "win") return `I beat ${opponent} ${mine} to ${theirs} on Bounce. Watch how.`;
  if (recap.result === "draw") return `${mine} each: a dead heat with ${opponent} on Bounce.`;
  return `${opponent} edged me ${theirs} to ${mine} on Bounce. Rematch incoming.`;
}

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

export function FinalBoard({ game, label, theme }: { game: Game; label: string; theme?: string | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) drawBoard(ref.current, null, { ...game, over: true }, 90, themeById(theme));
  }, [game, theme]);
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

/**
 * What a ranked match did to the player's rating: the RR won or lost, the
 * rank it leaves them on, a promotion when there was one, and the placement
 * games still to play before the rank shows.
 */
function RankedResult({ change, settled, cancelled }: { change: RatingChange | null; settled: boolean; cancelled: boolean }) {
  if (cancelled) return null;
  if (!settled || !change) {
    return (
      <div className={styles.ranked}>
        <div>
          <small>RANKED</small>
          <span>RR moves when both runs are in.</span>
        </div>
      </div>
    );
  }
  const { delta, rankAfter, rankBefore } = change;
  const promoted = rankAfter.placed && rankBefore.placed && divisionIndex(rankAfter.rating) > divisionIndex(rankBefore.rating);
  const demoted = rankAfter.placed && rankBefore.placed && divisionIndex(rankAfter.rating) < divisionIndex(rankBefore.rating);
  const revealed = rankAfter.placed && !rankBefore.placed;
  return (
    <div className={`${styles.ranked} ${promoted || revealed ? styles.rankedUp : ""}`}>
      <RankEmblem tier={rankAfter.tier} division={rankAfter.division} size={40} />
      <div>
        <small>{change.placement ? "PLACEMENT MATCH" : "RANKED"}</small>
        <b className={delta > 0 ? styles.positive : delta < 0 ? styles.negative : undefined}>{change.unrated ? "No RR" : `${delta > 0 ? "+" : ""}${delta} RR`}</b>
        <span>
          {change.unrated
            ? "Too many ranked matches against this player today: this one counts for nothing."
            : revealed
              ? `Placed: ${rankAfter.name}, ${rankAfter.points} RR.`
              : !rankAfter.placed
                ? `${rankAfter.placementsLeft} placement ${rankAfter.placementsLeft === 1 ? "match" : "matches"} to go before your rank shows.`
                : promoted
                  ? `Promoted to ${rankAfter.name}.`
                  : demoted
                    ? `Down to ${rankAfter.name}, ${rankAfter.points} RR.`
                    : `${rankAfter.name} · ${rankAfter.points} RR`}
        </span>
      </div>
    </div>
  );
}

/** Practice has no opponent: the player's own run, without a versus layout. */
function PracticeDetails({ you, theme }: { you: RecapSide; theme?: string | null }) {
  return (
    <section className={styles.details}>
      <header className={styles.practiceHeader}>
        <Avatar name={you.name} src={you.avatar} size={48} />
        <div className={styles.identity}>
          <div className={styles.nameRow}>
            <b>{you.name}</b>
            {you.ranked && <RankBadge rank={you.ranked} />}
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
            <FinalBoard game={you.board} label="Your board" theme={theme} />
          </div>
        </div>
      </div>
    </section>
  );
}

export function ResultScreen({ target, onPlayAgain, onRematch, onClose, onSettled, theme, guest = false }: Props) {
  const { recap, error } = useRecap(target, onSettled);
  // Asked for as the screen opens, so the share sheet opens straight from the tap.
  const code = useReferralCode(!guest);
  // One rematch per result screen, so a double tap does not open two matches.
  const [rematched, setRematched] = useState(false);

  // The result has a sound, once. The recap is polled until the match settles,
  // so the answer arriving again must not ring again.
  const sounded = useRef(false);
  const settledResult = recap?.status === "settled" ? recap.result : null;
  useEffect(() => {
    if (!settledResult || sounded.current) return;
    sounded.current = true;
    const kit = themeById(theme).effects.sound;
    if (settledResult === "win") playSound("win", 1, kit);
    else if (settledResult === "loss" || settledResult === "draw") playSound("lose", 1, kit);
  }, [settledResult, theme]);

  // A promotion, a first rank or a place among the Bouncers takes the whole
  // screen, once per match, a moment after the result itself has landed.
  const matchId = target.kind === "match" ? target.matchId : null;
  const rankUp = recap?.status === "settled" ? rankUpOf(recap.ratingChange, recap.you.ranked) : null;
  const [celebrating, setCelebrating] = useState<RankUpKind | null>(null);
  useEffect(() => {
    if (!rankUp || !matchId || celebrated(matchId)) return;
    const timer = setTimeout(() => {
      rememberCelebration(matchId);
      setCelebrating(rankUp);
    }, 900);
    return () => clearTimeout(timer);
  }, [rankUp, matchId]);

  // Close on Escape, like any full-screen overlay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const practice = target.kind === "practice";
  const you: RecapSide | null = practice
    ? { name: target.name, avatar: target.avatar, ranked: target.ranked, score: target.game.score, balls: target.game.balls, clears: target.clears, rounds: target.game.round, forfeit: false, board: target.game }
    : (recap?.you ?? null);

  if (!you || (!practice && !recap)) {
    return (
      <div className={`${styles.result} ${styles.pending}`} style={themeStyle(theme)} role="dialog" aria-modal="true" aria-label="Run complete">
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
  // A settled match points to the replay, whose card shows both scores; practice is not saved, so it invites to the site.
  const shareable = practice ? !guest : settled && result !== "cancelled";
  const share = () =>
    void shareResult(
      practice ? "My Bounce score" : title.join(" "),
      shareText(practice ? null : recap, you.score),
      sharedLink(practice ? "/" : `/watch/${recap!.watchId}`, code),
    );

  return (
    <div className={`${styles.result} ${styles[tone]}`} style={themeStyle(theme)} role="dialog" aria-modal="true" aria-label={title.join(" ")}>
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
                  {signedAmount(net, asset)} {currency(asset)}
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
                  {units(recap!.stake, asset)} {currency(asset)}
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
            {shareable && (
              <button className={styles.rematch} onClick={share}>
                <Share2 size={14} /> {practice ? "Share your score" : result === "win" ? "Share the win" : "Share the result"}
              </button>
            )}
          </div>
        </div>
        {!practice && recap?.ranked && <RankedResult change={recap.ratingChange} settled={settled} cancelled={result === "cancelled"} />}
        {celebrating && recap?.ratingChange && <RankUp change={recap.ratingChange} kind={celebrating} current={recap.you.ranked} onDone={() => setCelebrating(null)} />}
        {practice && guest && (
          <Link className={`btn btn-primary ${styles.guestCta}`} href="/signup">
            Play a real rival · {STARTING_GEMS.toLocaleString("en")} free gems <ArrowRight />
          </Link>
        )}
        <button className={styles.backLink} onClick={onClose}>
          Back to lobby
        </button>
      </section>

      {practice ? (
        <PracticeDetails you={you} theme={theme} />
      ) : (
        <section className={styles.details}>
          <header className={styles.versus}>
            <div className={styles.side}>
              <Avatar name={you.name} src={you.avatar} size={48} />
              <div className={styles.identity}>
                <div className={styles.nameRow}>
                  <b>{you.name}</b>
                  {you.ranked && <RankBadge rank={you.ranked} />}
                </div>
                <span className={`${styles.chip} ${styles.you}`}>YOU</span>
              </div>
            </div>
            <span className={styles.vs}>VS</span>
            <div className={`${styles.side} ${styles.sideRight}`}>
              <div className={styles.identity}>
                <div className={styles.nameRow}>
                  <b>{opponent?.name ?? "Open seat"}</b>
                  {opponent && <RankBadge rank={opponent.ranked} />}
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
              <FinalBoard game={you.board} label="Your board" theme={theme} />
              {them ? (
                <FinalBoard game={them.board} label={`${them.name}'s board`} theme={theme} />
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
