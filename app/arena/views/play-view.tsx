"use client";
import { useCallback, useState } from "react";
import { ChevronLeft, ChevronRight, Flag, LogOut, Play } from "lucide-react";
import type { Asset, MatchRecap } from "@/lib/api-types";
import { MAX_ANGLE, MIN_ANGLE } from "@/lib/engine";
import { request } from "../api";
import { Avatar } from "../avatar";
import { Board } from "../board";
import { amount } from "../format";
import type { GameSession } from "../use-game-session";
import type { PlayerState } from "../arena";
import { Lobby, type LobbyChoice } from "./lobby";
import { MatchIntro, type IntroStage } from "./match-intro";
import { ResultScreen, type ResultTarget } from "./result-screen";
import styles from "./screens.module.css";

type Props = {
  player: PlayerState;
  session: GameSession;
  onForfeit: () => void;
  /** A match whose recap was opened from a notification or link. */
  recapMatchId: string | null;
  setRecapMatchId: (id: string | null) => void;
};

type Intro = { asset: Asset; stake: number; stage: IntroStage; opponent?: { name: string; avatar: string | null } | null };

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The arena flow: lobby (practice or a 1v1 entry), the matchmaking intro, the
 * game itself, and the end-of-run screen.
 */
export function PlayView({ player, session, onForfeit, recapMatchId, setRecapMatchId }: Props) {
  const { data, setAsset, setError, refresh } = player;
  const { game, run, started, flying, busy, syncing, angle, clears } = session;
  const [choice, setChoice] = useState<Asset | null>(null);
  const [stakeIndex, setStakeIndex] = useState(1);
  const [intro, setIntro] = useState<Intro | null>(null);

  const currentMatch = data.matches.find((m) => m.id === run?.match_id);

  const findMatch = async (asset: Asset, stake: number) => {
    if (!data.player) {
      window.location.href = "/signup";
      return;
    }
    setError("");
    setIntro({ asset, stake, stage: "searching" });
    // The intro always plays long enough to land, even when matchmaking is instant.
    const [entered] = await Promise.all([session.startMatch(stake, asset), wait(1900)]);
    if (!entered) {
      setIntro(null);
      return;
    }
    setAsset(entered.asset);
    let ready: Intro = { asset, stake, stage: "ready", opponent: null };
    try {
      const recap = await request<MatchRecap>(`/api/matches/${encodeURIComponent(entered.match_id)}`);
      // An unfinished run is resumed as it was, whatever entry was just picked.
      ready = { asset: recap.asset, stake: recap.stake, stage: "ready", opponent: recap.opponent && { name: recap.opponent.name, avatar: recap.opponent.avatar } };
    } catch {
      // The intro still finishes; the HUD shows the opponent once the player list refreshes.
    }
    setIntro(ready);
    await wait(1300);
    setIntro({ ...ready, stage: "go" });
    await wait(650);
    setIntro({ ...ready, stage: "leaving" });
    await wait(420);
    setIntro(null);
  };

  const choose = (next: LobbyChoice | null) => {
    if (next === "practice") {
      setChoice(null);
      session.startPractice();
      return;
    }
    if (next !== choice) setStakeIndex(1);
    setChoice(next);
  };

  const closeResult = useCallback(() => {
    setRecapMatchId(null);
    if (session.game.over) session.reset();
  }, [session, setRecapMatchId]);

  const playAgain = (again: { asset: Asset; stake: number } | null) => {
    setRecapMatchId(null);
    session.reset();
    if (again) void findMatch(again.asset, again.stake);
    else session.startPractice();
  };

  const onSettled = useCallback(() => void refresh(), [refresh]);

  const resultTarget: ResultTarget | null = recapMatchId
    ? { kind: "match", matchId: recapMatchId, ready: true }
    : started && game.over && !intro
      ? run
        ? { kind: "match", matchId: run.match_id, ready: !syncing }
        : { kind: "practice", game, clears, name: data.player?.name ?? "You", avatar: data.player?.avatar ?? null }
      : null;

  return (
    <>
      {!started ? (
        <Lobby
          player={player}
          choice={choice}
          onChoose={choose}
          stakeIndex={stakeIndex}
          setStakeIndex={setStakeIndex}
          onFindMatch={(asset, stake) => void findMatch(asset, stake)}
          busy={busy || !!intro}
        />
      ) : (
        <section className={styles.game}>
          <div className={styles.hud}>
            <span className={styles.hudChip}>
              {run ? `1V1 · ${currentMatch ? amount(currentMatch.stake, run.asset).toUpperCase() : run.asset === "gems" ? "GEMS" : "SOL"}` : "PRACTICE"}
            </span>
            <span className={styles.hudVs}>
              {run ? (
                currentMatch?.opponent ? (
                  <>
                    vs <Avatar name={currentMatch.opponent} src={currentMatch.opponent_avatar} size={26} /> <b>{currentMatch.opponent}</b>
                  </>
                ) : (
                  "Seat open · you set the score"
                )
              ) : (
                "Free play"
              )}
            </span>
            {run ? (
              <button className="btn" onClick={onForfeit} disabled={flying || busy || game.over}>
                <Flag /> Forfeit
              </button>
            ) : (
              <button className="btn" onClick={session.reset} disabled={flying}>
                <LogOut /> Quit
              </button>
            )}
          </div>
          <Board session={session} />
          <div className="aim-controls">
            <button className="btn" aria-label="Aim more left" disabled={flying || busy} onClick={() => session.setAngle((a) => Math.min(MAX_ANGLE, a + 3))}>
              <ChevronLeft />
            </button>
            <output>{Math.round(angle)}°</output>
            <button className="btn" aria-label="Aim more right" disabled={flying || busy} onClick={() => session.setAngle((a) => Math.max(MIN_ANGLE, a - 3))}>
              <ChevronRight />
            </button>
            <button className="btn btn-primary" disabled={game.over || flying || busy} onClick={session.shoot}>
              <Play size={14} />
              Launch
            </button>
          </div>
          <p className="round-banner">{game.bonus ? "Board cleared! +4 bonus balls +1 round ball." : ""}</p>
        </section>
      )}
      {intro && <MatchIntro asset={intro.asset} stake={intro.stake} stage={intro.stage} opponent={intro.opponent} />}
      {resultTarget && (
        <ResultScreen
          key={resultTarget.kind === "match" ? resultTarget.matchId : "practice"}
          target={resultTarget}
          onPlayAgain={playAgain}
          onClose={closeResult}
          onSettled={onSettled}
        />
      )}
    </>
  );
}
