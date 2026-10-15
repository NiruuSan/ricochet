"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Coins, Gem, HandCoins } from "lucide-react";
import type { AccountLevel } from "@/lib/api-types";
import { request } from "../api";
import { amount, assetName, currency, units } from "../format";
import type { PlayerState } from "../arena";
import { reward as payOut } from "../feedback";
import styles from "./cashback.module.css";

// What the player gets back, and the grid it came from. The money side of it is
// in lib/rewards.ts; this only shows it and asks for the tap.

type Tier = { from: number; share: number; gems: boolean };
type Reward = {
  scope: "weekly" | "monthly";
  period: number;
  endedAt: number;
  closesAt: number;
  amount: number;
  asset: "devnet" | "gems";
  level: AccountLevel;
  share: number;
  claimed: boolean;
};
type Board = { tiers: Tier[]; rewards: Reward[] };

/** "Level 10+", the way a step of the ladder reads. */
const stepName = (tier: Tier) => `Level ${tier.from}${tier.from < 60 ? "+" : ""}`;

const day = (at: number) => new Date(at).toLocaleDateString("en", { day: "numeric", month: "short" });
const value = (reward: Pick<Reward, "amount" | "asset">) =>
  reward.asset === "gems" ? `${units(reward.amount, "gems")} gems` : amount(reward.amount, "devnet");

/** The panel in the wallet: what each period gave back, and the button. */
export function CashbackPanel({ player }: { player: PlayerState }) {
  const [board, setBoard] = useState<Board | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(
    () => request<Board>("/api/rewards").then(setBoard, (e: Error) => setError(e.message)),
    [],
  );
  useEffect(() => {
    if (player.data.player) void load();
  }, [load, player.data.player]);

  if (!player.data.player) return null;

  const claim = async (reward: Reward, from: Element) => {
    setBusy(reward.scope);
    setError("");
    try {
      setBoard(await request<Board>("/api/rewards", { action: "claim", scope: reward.scope }));
      payOut(reward.asset, reward.amount, from, `${reward.scope === "weekly" ? "Weekly" : "Monthly"} cashback`);
      await player.refresh();
    } catch (e) {
      setError((e as Error).message);
      void load();
    } finally {
      setBusy("");
    }
  };

  const waiting = board?.rewards.filter((r) => !r.claimed) ?? [];
  // The step the player's level is on, and the one worth climbing to. A level
  // never goes down, so a step once reached is kept.
  const level = player.data.player?.level.level ?? 1;
  const at = board ? [...board.tiers].reverse().findIndex((t) => level >= t.from) : -1;
  const index = board && at >= 0 ? board.tiers.length - 1 - at : -1;
  const mine = index >= 0 ? board?.tiers[index] : undefined;
  const next = index >= 0 ? board?.tiers[index + 1] : undefined;

  return (
    <section className={styles.panel}>
      <header className={styles.head}>
        <span className={styles.icon} aria-hidden>
          <HandCoins size={18} />
        </span>
        <div>
          <h2>Cashback</h2>
          <p>
            Part of the house fee comes back every week, and again at the end of a month you kept playing. The higher your level, the bigger the share — and a level
            is never lost, whatever the ranked season does to your rank.
          </p>
        </div>
      </header>

      {error && (
        <div className="error" role="alert">
          <span>{error}</span>
        </div>
      )}

      {!board ? (
        <p className="muted">Loading your cashback…</p>
      ) : board.rewards.length === 0 ? (
        <p className={styles.empty}>
          Nothing yet. Cashback is worked out on your finished {assetName("devnet")} matches, and lands the day the week turns over.
        </p>
      ) : (
        <div className={styles.rewards}>
          {board.rewards.map((reward) => (
            <div key={reward.scope} className={`${styles.reward} ${reward.claimed ? styles.done : ""}`}>
              <div className={styles.copy}>
                <b>{reward.scope === "weekly" ? "Last week" : "Last month"}</b>
                <p>
                  Level {reward.level.level} · {reward.share}%
                </p>
                <small>
                  {day(reward.period)} – {day(reward.endedAt - 1)} · claim before {day(reward.closesAt)}
                </small>
              </div>
              <div className={styles.action}>
                <strong className={reward.asset === "gems" ? styles.gems : undefined}>
                  {reward.asset === "gems" ? <Gem size={15} /> : <Coins size={15} />} {value(reward)}
                </strong>
                <button className="btn btn-primary" disabled={reward.claimed || busy === reward.scope} onClick={(e) => void claim(reward, e.currentTarget)}>
                  {reward.claimed ? "Claimed" : busy === reward.scope ? "Claiming…" : "Claim"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {board && (
        <ul className={styles.ladder}>
          {board.tiers.map((tier) => {
            const here = mine === tier;
            return (
              <li key={tier.from} className={`${here ? styles.here : ""} ${tier.gems ? styles.inGems : ""}`}>
                <span>{stepName(tier)}</span>
                <b>{tier.share}%</b>
                {here && <em>You</em>}
              </li>
            );
          })}
        </ul>
      )}
      <p className={styles.footnote}>
        {next ? (
          <>
            Reach <b>level {next.from}</b> and every week comes back at <b>{next.share}%</b>
            {next.gems ? "" : `, paid in ${currency("devnet")}`}.{" "}
          </>
        ) : null}
        Levels 1 to 29 come back in gems; level 30 and above in {currency("devnet")}.
      </p>
      {waiting.length > 0 && <p className={styles.footnote}>A period that closes unclaimed is gone, so take it while it is there.</p>}
    </section>
  );
}

/** The lobby's nudge: only when something is actually waiting. */
export function CashbackCard({ player }: { player: PlayerState }) {
  const ready = player.data.rewardsReady ?? 0;
  if (!player.data.player || !ready) return null;
  return (
    <Link className={styles.card} href="/wallet">
      <span className={styles.icon} aria-hidden>
        <HandCoins size={20} />
      </span>
      <div className={styles.copy}>
        <b>{ready === 1 ? "Your cashback is waiting" : "Two cashbacks are waiting"}</b>
        <p>Part of the fees you paid, back in your balance. It closes when the next period does.</p>
      </div>
      <span className={styles.claim}>Claim</span>
    </Link>
  );
}
