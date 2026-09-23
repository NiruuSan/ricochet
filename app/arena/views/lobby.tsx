"use client";
import { Tooltip } from "@/components/ui/tooltip";

import Link from "next/link";
import { ArrowLeft, ArrowRight, ArrowUpRight, Gem, Link2, Target, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { feeRebate, REFERRAL_FEES, STAKES, winnerPayout, type Asset, type Run } from "@/lib/api-types";
import { amount, CURRENCY, shareChallenge, units } from "../format";
import type { PlayerState } from "../arena";
import styles from "./screens.module.css";
import { ArenaDashboard, useArenaOverview } from "./arena-dashboard";
import { DailyGemsCard } from "./daily-gems";
import { QuestsCard } from "./quests-view";
import { CashbackCard } from "./cashback";
import { Fiat } from "../fiat";
import dashboard from "./arena-dashboard.module.css";

export type LobbyChoice = "practice" | Asset;

const HERO_BRICKS = [
  [0, 0, "#bb8cff", 8], [76, 0, "#68d9d6", 12], [152, 0, "#c6f564", 6], [228, 0, "#ffd17b", 9],
  [0, 76, "#9fccfc", 4], [76, 76, "#fa98b4", 7], [228, 76, "#bb8cff", 5],
  [0, 152, "#c6f564", 3], [228, 152, "#68d9d6", 2],
] as const;

type Props = {
  player: PlayerState;
  choice: Asset | null;
  onChoose: (choice: LobbyChoice | null) => void;
  stakeIndex: number;
  setStakeIndex: (index: number) => void;
  onFindMatch: (asset: Asset, stake: number) => void;
  /** Opens a private match at this entry and returns it, with the code its link carries. */
  onChallenge: (asset: Asset, stake: number, opponent?: string) => Promise<Run | null>;
  busy: boolean;
  /** Opens the recap of one of the player's matches. */
  onOpenMatch: (matchId: string) => void;
};

/** Step one: how to play. Step two, for a 1v1: the entry. Picking the same mode again closes it. */
export function Lobby({ player, choice, onChoose, stakeIndex, setStakeIndex, onFindMatch, onChallenge, busy, onOpenMatch }: Props) {
  const { data } = player;
  const solConfigured = !!data.launch?.configured;
  const balance = (asset: Asset) => (asset === "gems" ? (data.player?.balance ?? 0) : (data.cashBalance ?? 0));
  const stake = choice ? STAKES[choice][stakeIndex] : 0;
  const affordable = choice ? balance(choice) >= stake : false;
  // A reduced house fee never changes the pot: it comes back afterwards, which
  // is worth saying here rather than leaving it to be noticed in the wallet.
  const rebate = data.discountUntil && choice ? feeRebate(stake, choice) : 0;
  const { overview, now } = useArenaOverview();
  const [inviting, setInviting] = useState(false);
  const stakePanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!choice || !window.matchMedia("(max-width: 720px)").matches) return;
    // Wait for the entry panel to mount before bringing it into view.
    const frame = window.requestAnimationFrame(() => {
      stakePanelRef.current?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
        block: "start",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [choice]);

  /** Opens a private match and puts its link where the player can send it. */
  const openChallenge = async () => {
    if (!choice) return;
    setInviting(true);
    const run = await onChallenge(choice, stake);
    setInviting(false);
    if (run?.invite) await shareChallenge(run.invite);
  };

  return (
    <section className={styles.lobby}>
      <div className={styles.lobbyHead}>
        <div className={styles.heroCopy}>
          <div className={styles.heroEyebrow}><span /> THE BRICK-BREAKER ARENA</div>
          <h1>Same board.<br /><span>Your angle.</span></h1>
          <p>Find your shot. Break the board. Beat your rival.<br />One good angle can change everything.</p>
          <Link href="/rules" className={styles.heroLink}>New to bounce? Here’s how to play <ArrowUpRight size={15} /></Link>
        </div>
        <div className={styles.heroArt} aria-hidden="true">
          <svg viewBox="0 0 520 290" fill="none">
            <g transform="translate(110 28) rotate(-9 150 90)">
              {HERO_BRICKS.map(([x, y, color, hp]) => (
                <g key={`${x}:${y}`}>
                  <rect x={x} y={y + 5} width="65" height="65" rx="8" fill={color} opacity=".35" />
                  <rect x={x} y={y} width="65" height="65" rx="8" fill={color} />
                  <path d={`M${x + 10} ${y + 5}h45`} stroke="white" strokeOpacity=".3" strokeWidth="2" />
                  <text x={x + 32.5} y={y + 39} fill="#162238" textAnchor="middle" fontSize="18" fontWeight="800">{hp}</text>
                </g>
              ))}
              {/* Reflect below brick 6, then off brick 2's left edge; allow for the ball's radius. */}
              <path d="M132 253 184 71 222 204 212 239" stroke="#c6f564" strokeWidth="2" strokeDasharray="3 9" strokeLinecap="round" opacity=".65" />
              <circle cx="212" cy="239" r="23" stroke="#c6f564" strokeOpacity=".2" />
              <circle cx="212" cy="239" r="13" fill="#c6f564" fillOpacity=".1" />
              <circle cx="212" cy="239" r="6" fill="#eaffc0" />
            </g>
          </svg>
          <span className={styles.artCaption}>EVERY BOUNCE COUNTS <span>↗</span></span>
        </div>
      </div>

      <div className={styles.modeHeading}>
        <h2>Make your next move</h2>
        <span>Three ways to play. One more round.</span>
      </div>
      <div className={styles.modes} aria-label="Game modes">
        <button className={styles.mode} onClick={() => onChoose("practice")}>
          <small>01 / SOLO · FREE</small>
          <span className={styles.modeIcon}>
            <Target />
          </span>
          <strong>Practice</strong>
          <span className={styles.modeDescription}>Chase your best score.<br />No entry. No pressure. Just bounce.</span>
          <span className={styles.modeAction}>Play for free <ArrowUpRight size={19} /></span>
        </button>
        <button
          className={`${styles.mode} ${styles.modeSol}`}
          aria-pressed={choice === "devnet"}
          disabled={!solConfigured}
          onClick={() => onChoose(choice === "devnet" ? null : "devnet")}
        >
          <small>02 / 1V1 · DEVNET SOL</small>
          <span className={styles.modeIcon}>
            <Zap />
          </span>
          <strong>Solana match</strong>
          <span className={styles.modeDescription}>{!solConfigured ? "Solana matches are not available yet." : "Same board. Head to head. Put your angles to the test."}</span>
          <span className={styles.modeBalance}>{data.player && solConfigured ? `${units(balance("devnet"), "devnet")} SOL available · Test SOL only` : "Devnet test SOL · No monetary value"}</span>
          <span className={styles.modeAction}>{!solConfigured ? "Coming soon" : choice === "devnet" ? "Choosing your entry" : "Play with SOL"}<ArrowUpRight size={19} /></span>
        </button>
        <button className={`${styles.mode} ${styles.modeGems}`} aria-pressed={choice === "gems"} onClick={() => onChoose(choice === "gems" ? null : "gems")}>
          <small>03 / 1V1 · GEMS</small>
          <span className={styles.modeIcon}>
            <Gem />
          </span>
          <strong>Gem match</strong>
          <span className={styles.modeDescription}>Bring your best shot.<br />The winner takes both entries.</span>
          <span className={styles.modeBalance}>{data.player ? `${units(balance("gems"), "gems")} gems available` : "Start with 2,000 free gems when you sign up"}</span>
          <span className={styles.modeAction}>{choice === "gems" ? "Choosing your entry" : "Play with gems"}<ArrowUpRight size={19} /></span>
        </button>
      </div>

      {choice && (
        <div ref={stakePanelRef} className={styles.stakePanel} key={choice}>
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
                <small>
                  {CURRENCY[choice].toUpperCase()}
                  {!!overview?.openSeats[choice][s] && <Tooltip content="A rival is waiting at this entry: your match starts right away"><span className={dashboard.waiting} /></Tooltip>}
                </small>
              </button>
            ))}
          </div>
          <div className={styles.stakeFoot}>
            <div className={styles.prizeLine}>
              <div>
                <span>Your entry</span>
                <b>{amount(stake, choice)}</b>
                {choice === "devnet" && <Fiat lamports={stake} />}
              </div>
              <div>
                <span>Winner receives</span>
                <b className="lime">{amount(winnerPayout(stake, choice), choice)}</b>
                {choice === "devnet" && <Fiat lamports={winnerPayout(stake, choice)} />}
              </div>
              {rebate > 0 && (
                <div>
                  <span>Back to you, win or lose</span>
                  <b className="lime">+{amount(rebate, choice)}</b>
                </div>
              )}
            </div>
            <div className="row-actions">
              <button className="btn" onClick={() => onChoose(null)}>
                <ArrowLeft /> Back
              </button>
              {data.player ? (
                <>
                  <button className="btn" disabled={busy || inviting || !affordable} onClick={() => void openChallenge()}>
                    <Link2 /> {inviting ? "Opening…" : "Challenge a friend"}
                  </button>
                  <button className={`btn btn-primary ${styles.findButton}`} disabled={busy || !affordable} onClick={() => onFindMatch(choice, stake)}>
                    Find a match <ArrowRight />
                  </button>
                </>
              ) : (
                <Link className={`btn btn-primary ${styles.findButton}`} href={data.authenticated ? "/signup" : "/login"}>
                  Sign in to play <ArrowRight />
                </Link>
              )}
            </div>
          </div>
          {rebate > 0 && (
            <p className={styles.lobbyNote} style={{ color: "#c6f564" }}>
              Your referral window is open: you fund {REFERRAL_FEES.discounted}% of the fee instead of {REFERRAL_FEES.standard}%. The pot and the payout are the same for
              everyone — the difference comes back to you once the match settles.
            </p>
          )}
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

      {/* The entry panel answers the mode above it, so it comes first; the free
          gems are an aside either way. */}
      <DailyGemsCard player={player} />
      <QuestsCard player={player} />
      <CashbackCard player={player} />

      {!choice && <ArenaDashboard overview={overview} now={now} signedIn={!!data.player} onOpenMatch={onOpenMatch} />}
    </section>
  );
}
