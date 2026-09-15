"use client";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Gem, Target, Zap } from "lucide-react";
import { STAKES, winnerPayout, type Asset } from "@/lib/api-types";
import { amount, CURRENCY, units } from "../format";
import type { PlayerState } from "../arena";
import styles from "./screens.module.css";

export type LobbyChoice = "practice" | Asset;

type Props = {
  player: PlayerState;
  choice: Asset | null;
  onChoose: (choice: LobbyChoice | null) => void;
  stakeIndex: number;
  setStakeIndex: (index: number) => void;
  onFindMatch: (asset: Asset, stake: number) => void;
  busy: boolean;
};

/** Step one: how to play. Step two, for a 1v1: the entry. */
export function Lobby({ player, choice, onChoose, stakeIndex, setStakeIndex, onFindMatch, busy }: Props) {
  const { data } = player;
  const solConfigured = !!data.launch?.configured;
  const balance = (asset: Asset) => (asset === "gems" ? (data.player?.balance ?? 0) : (data.cashBalance ?? 0));
  const stake = choice ? STAKES[choice][stakeIndex] : 0;
  const affordable = choice ? balance(choice) >= stake : false;

  return (
    <section className={styles.lobby}>
      <div className={styles.lobbyHead}>
        <div className="tag lime">THE BRICK-BREAKER ARENA</div>
        <h1>
          Pick your <span className="lime">game.</span>
        </h1>
        <p>Same seed. Same chances. Make every bounce count.</p>
      </div>

      <div className={styles.modes}>
        <button className={styles.mode} onClick={() => onChoose("practice")}>
          <span className={styles.modeIcon}>
            <Target />
          </span>
          <small>SOLO · FREE</small>
          <strong>Practice</strong>
          <span>No entry, no wallet. Jump straight onto a fresh board.</span>
        </button>
        <button
          className={`${styles.mode} ${styles.modeSol}`}
          aria-pressed={choice === "devnet"}
          disabled={!solConfigured}
          onClick={() => onChoose("devnet")}
        >
          <span className={styles.modeIcon}>
            <Zap />
          </span>
          <small>1V1 · DEVNET SOL</small>
          <strong>Solana match</strong>
          <span>{!solConfigured ? "Solana matches are not available yet." : data.player ? `${units(balance("devnet"), "devnet")} SOL available. Test SOL only.` : "Sign in and fund your wallet with devnet SOL."}</span>
        </button>
        <button className={`${styles.mode} ${styles.modeGems}`} aria-pressed={choice === "gems"} onClick={() => onChoose("gems")}>
          <span className={styles.modeIcon}>
            <Gem />
          </span>
          <small>1V1 · GEMS</small>
          <strong>Gem match</strong>
          <span>{data.player ? `${units(balance("gems"), "gems")} gems available. Winner takes both entries.` : "Sign in to play for gems. Every profile starts with 2,000."}</span>
        </button>
      </div>

      {choice && (
        <div className={styles.stakePanel} key={choice}>
          <div className={styles.stakeTop}>
            <h2>Choose your entry</h2>
            <span>
              {data.player ? `Balance ${amount(balance(choice), choice)}` : "Sign in to enter a match"}
              {choice === "devnet" && data.player && (
                <>
                  {" · "}
                  <Link className="lime" href="/wallet">
                    Fund wallet
                  </Link>
                </>
              )}
            </span>
          </div>
          <div className={styles.stakes}>
            {STAKES[choice].map((s, i) => (
              <button key={s} className={styles.stakeChoice} aria-pressed={i === stakeIndex} onClick={() => setStakeIndex(i)}>
                {units(s, choice)}
                <small>{CURRENCY[choice].toUpperCase()}</small>
              </button>
            ))}
          </div>
          <div className={styles.stakeFoot}>
            <div className={styles.prizeLine}>
              <div>
                <span>Your entry</span>
                <b>{amount(stake, choice)}</b>
              </div>
              <div>
                <span>Winner receives</span>
                <b className="lime">{amount(winnerPayout(stake, choice), choice)}</b>
              </div>
            </div>
            <div className="row-actions">
              <button className="btn" onClick={() => onChoose(null)}>
                <ArrowLeft /> Back
              </button>
              {data.player ? (
                <button className={`btn btn-primary ${styles.findButton}`} disabled={busy || !affordable} onClick={() => onFindMatch(choice, stake)}>
                  Find a match <ArrowRight />
                </button>
              ) : (
                <Link className={`btn btn-primary ${styles.findButton}`} href={data.authenticated ? "/signup" : "/login"}>
                  Sign in to play <ArrowRight />
                </Link>
              )}
            </div>
          </div>
          <p className={styles.lobbyNote}>
            {data.player && !affordable
              ? choice === "gems"
                ? "Not enough gems for this entry. Pick a smaller one or practice for free."
                : "Not enough devnet SOL for this entry. Fund your wallet or pick a smaller one."
              : choice === "gems"
                ? "Gems are free and have no monetary value. No house fee on gem matches."
                : "Devnet SOL has no monetary value. The house keeps 12% of each entry when a match has a winner."}
          </p>
        </div>
      )}
    </section>
  );
}
