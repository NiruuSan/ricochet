"use client";
import { useCallback, useEffect, useState } from "react";
import { Flag, Link2, LogOut } from "lucide-react";
import type { Asset, MatchRecap, Run, TournamentDetail } from "@/lib/api-types";
import { request } from "../api";
import { Avatar } from "../avatar";
import { Board } from "../board";
import { amount, shareChallenge } from "../format";
import type { GameSession } from "../use-game-session";
import type { PlayerState } from "../arena";
import { Lobby, type LobbyChoice } from "./lobby";
import { MatchIntro, type IntroStage } from "./match-intro";
import { ResultScreen, type ResultTarget } from "./result-screen";
import { TournamentResult } from "./tournament-result";
import styles from "./screens.module.css";

type Props = {
  player: PlayerState;
  session: GameSession;
  onForfeit: () => void;
  /** A match whose recap was opened from a notification or link. */
  recapMatchId: string | null;
  setRecapMatchId: (id: string | null) => void;
  /** A tournament whose run should start or resume, from a `/?tournament=<id>` link. */
  tournamentId: string | null;
  clearTournament: () => void;
  /** A challenge code from a link or a notice; its seat is taken once. */
  invite: string | null;
  clearInvite: () => void;
};

type Intro = { asset: Asset; stake: number; stage: IntroStage; opponent?: { name: string; avatar: string | null } | null; tournament?: string };

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The arena flow: lobby (practice or a 1v1 entry), the matchmaking intro, the
 * game itself, and the end-of-run screen.
 */
export function PlayView({ player, session, onForfeit, recapMatchId, setRecapMatchId, tournamentId, clearTournament, invite, clearInvite }: Props) {
  const { data, setAsset, setError, refresh } = player;
  const { game, run, started, flying, syncing, clears } = session;
  // Waiting for the server's next row counts as busy: no shot or forfeit until it lands.
  const busy = session.busy || session.awaitingRow;
  const [choice, setChoice] = useState<Asset | null>(null);
  const [stakeIndex, setStakeIndex] = useState(1);
  const [intro, setIntro] = useState<Intro | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  const currentMatch = data.matches.find((m) => m.id === run?.match_id);
  const [tournamentName, setTournamentName] = useState("");

  // Enter a tournament run: the intro shows the prize pool, then the board.
  const { resume } = session;
  useEffect(() => {
    if (!tournamentId) return;
    let active = true;
    void (async () => {
      try {
        const detail = await request<TournamentDetail>(`/api/tournaments/${encodeURIComponent(tournamentId)}`);
        if (!active) return;
        const base: Intro = { asset: detail.asset, stake: detail.pot, stage: "searching", tournament: detail.name };
        setTournamentName(detail.name);
        setIntro(base);
        const [{ run: entered }] = await Promise.all([request<{ run: Run }>("/api/tournaments", { action: "play", id: tournamentId }), wait(1500)]);
        if (!active) return;
        resume(entered);
        setIntro({ ...base, stage: "ready" });
        await wait(1100);
        setIntro({ ...base, stage: "go" });
        await wait(650);
        setIntro({ ...base, stage: "leaving" });
        await wait(420);
        setIntro(null);
      } catch (e) {
        if (!active) return;
        setIntro(null);
        setError((e as Error).message);
        clearTournament();
      }
    })();
    return () => {
      active = false;
    };
  }, [clearTournament, resume, setError, tournamentId]);

  /** Plays the matchmaking intro around `enter`, whichever seat it takes. */
  const enterMatch = async (asset: Asset, stake: number, enter: () => Promise<Run | null>) => {
    if (!data.player) {
      window.location.href = "/signup";
      return;
    }
    setError("");
    setIntro({ asset, stake, stage: "searching" });
    // The intro always plays long enough to land, even when matchmaking is instant.
    const [entered] = await Promise.all([enter(), wait(1900)]);
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

  const findMatch = (asset: Asset, stake: number) => enterMatch(asset, stake, () => session.startMatch(stake, asset));
  /** Opens a private match and hands its link back, so the player can send it. */
  const challenge = async (asset: Asset, stake: number, opponent?: string) => {
    const run = await session.challenge(stake, asset, opponent);
    if (run) {
      setAsset(run.asset);
      void refresh();
    }
    return run;
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

  // A challenge link: take the seat, then play the same intro as any other match.
  const { joinChallenge } = session;
  useEffect(() => {
    if (!invite) return;
    let active = true;
    void (async () => {
      const joined = await joinChallenge(invite);
      if (!active) return;
      clearInvite();
      if (!joined) return;
      setAsset(joined.asset);
      void refresh();
    })();
    return () => {
      active = false;
    };
  }, [clearInvite, invite, joinChallenge, refresh, setAsset]);

  const closeResult = useCallback(() => {
    setRecapMatchId(null);
    if (session.run?.tournamentId) clearTournament();
    if (session.game.over) session.reset();
  }, [clearTournament, session, setRecapMatchId]);

  const playAgain = (again: { asset: Asset; stake: number } | null) => {
    setRecapMatchId(null);
    session.reset();
    if (again) void findMatch(again.asset, again.stake);
    else session.startPractice();
  };

  const onSettled = useCallback(() => void refresh(), [refresh]);

  const resultTarget: ResultTarget | null = recapMatchId
    ? { kind: "match", matchId: recapMatchId, ready: true }
    : started && game.over && !intro && !run?.tournamentId
      ? run
        ? { kind: "match", matchId: run.match_id, ready: !syncing }
        : { kind: "practice", game, clears, name: data.player?.name ?? "You", avatar: data.player?.avatar ?? null, level: data.player?.level }
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
          onChallenge={challenge}
          busy={busy || !!intro}
          onOpenMatch={setRecapMatchId}
        />
      ) : (
        <section className={styles.game}>
          <div className={styles.hud}>
            <span className={styles.hudChip}>
              {run?.tournamentId
                ? "TOURNAMENT"
                : run
                  ? `1V1 · ${currentMatch ? amount(currentMatch.stake, run.asset).toUpperCase() : run.asset === "gems" ? "GEMS" : "SOL"}`
                  : "PRACTICE"}
            </span>
            <span className={styles.hudVs}>
              {run?.tournamentId ? (
                <>
                  <b>{tournamentName || "Tournament"}</b> · one run
                </>
              ) : run ? (
                currentMatch?.opponent ? (
                  <>
                    vs <Avatar name={currentMatch.opponent} src={currentMatch.opponent_avatar} size={26} /> <b>{currentMatch.opponent}</b>
                  </>
                ) : run.invite ? (
                  <button className={styles.hudLink} onClick={() => void shareChallenge(run.invite!).then((copied) => copied && setLinkCopied(true))}>
                    <Link2 size={14} /> {linkCopied ? "Link copied" : "Copy the challenge link"}
                  </button>
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
          <p className="round-banner">{game.bonus ? "Board cleared! +4 bonus balls +1 round ball." : ""}</p>
        </section>
      )}
      {intro && <MatchIntro asset={intro.asset} stake={intro.stake} stage={intro.stage} opponent={intro.opponent} tournament={intro.tournament} />}
      {run?.tournamentId && started && game.over && !intro && (
        <TournamentResult tournamentId={run.tournamentId} ready={!syncing} board={game} onClose={closeResult} />
      )}
      {resultTarget && (
        <ResultScreen
          key={resultTarget.kind === "match" ? resultTarget.matchId : "practice"}
          target={resultTarget}
          onPlayAgain={playAgain}
          onRematch={(asset, stake, opponent) => challenge(asset, stake, opponent)}
          onClose={closeResult}
          onSettled={onSettled}
        />
      )}
    </>
  );
}
