"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Coins, Gem, HandCoins } from "lucide-react";
import type { PlayerLevel, RankTier } from "@/lib/api-types";
import { RankEmblem } from "../rank-badge";
import { Fiat } from "../fiat";
import { request } from "../api";
import { amount, units } from "../format";
import type { PlayerState } from "../arena";
import styles from "./cashback.module.css";

// What the player gets back, and the grid it came from. The money side of it is
// in lib/rewards.ts; this only shows it and asks for the tap.

type Tier = { tier: RankTier; share: number; gems: boolean };
type Reward = {
  scope: "weekly" | "monthly";
  period: number;
  endedAt: number;
  closesAt: number;
  amount: number;
  asset: "devnet" | "gems";
  rank: PlayerLevel;
  share: number;
  claimed: boolean;
};
type Board = { tiers: Tier[]; rewards: Reward[] };

const TIER_NAMES: Record<RankTier, string> = {
  iron: "Iron",
  bronze: "Bronze",
  silver: "Silver",
  gold: "Gold",
  platinum: "Platinum",
  diamond: "Diamond",
  bouncer: "Bouncer",
};

const day = (at: number) => new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short" });
const value = (reward: Pick<Reward, "amount" | "asset">) =>
  reward.asset === "gems" ? `${units(reward.amount, "gems")} gems` : amount(reward.amount, "devnet");

/** The panel in the wallet: what each period gave back, and the button. */
export function CashbackPanel({ player }: { player: PlayerState }) {
  const [board, setBoard] = useState<Board | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(
    () => request<Board>("/api/rewards").then(setBoard, (e: Error) => setError(e.message)),
    [],
  );
  useEffect(() => {
    if (player.data.player) void load();
  }, [load, player.data.player]);

  if (!player.data.player) return null;

  const claim = async (reward: Reward) => {
    setBusy(reward.scope);
    setError("");
    setNotice("");
    try {
      setBoard(await request<Board>("/api/rewards", { action: "claim", scope: reward.scope }));
      setNotice(`${value(reward)} back. That is yours.`);
      await player.refresh();
    } catch (e) {
      setError((e as Error).message);
      void load();
    } finally {
      setBusy("");
    }
  };

  const waiting = board?.rewards.filter((r) => !r.claimed) ?? [];
  // The rank the player is on, and the one worth climbing to.
  const mine = player.data.player?.level.tier;
  const at = board?.tiers.findIndex((t) => t.tier === mine) ?? -1;
  const next = at >= 0 ? board?.tiers[at + 1] : undefined;

  return (
    <section className={styles.panel}>
      <header className={styles.head}>
        <span className={styles.icon} aria-hidden>
          <HandCoins size={18} />
        </span>
        <div>
          <h2>Cashback</h2>
          <p>Part of the house fee comes back to you every week, and again at the end of a month you kept playing. The higher your rank, the bigger the share.</p>
        </div>
      </header>

      {error && (
        <div className="error" role="alert">
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <p className="success" role="status">
          {notice}
        </p>
      )}

      {!board ? (
        <p className="muted">Loading your cashback…</p>
      ) : board.rewards.length === 0 ? (
        <p className={styles.empty}>
          Nothing yet. Cashback is worked out on your finished SOL matches, and lands the day the week turns over.
        </p>
      ) : (
        <div className={styles.rewards}>
          {board.rewards.map((reward) => (
            <div key={reward.scope} className={`${styles.reward} ${reward.claimed ? styles.done : ""}`}>
              <div className={styles.copy}>
                <b>{reward.scope === "weekly" ? "Last week" : "Last month"}</b>
                <p>
                  <RankEmblem tier={reward.rank.tier} division={reward.rank.division} size={15} /> {reward.rank.name} · {reward.share}%
                </p>
                <small>
                  {day(reward.period)} – {day(reward.endedAt - 1)} · claim before {day(reward.closesAt)}
                </small>
              </div>
              <div className={styles.action}>
                <strong className={reward.asset === "gems" ? styles.gems : undefined}>
                  {reward.asset === "gems" ? <Gem size={15} /> : <Coins size={15} />} {value(reward)}
                  {reward.asset === "devnet" && <Fiat lamports={reward.amount} />}
                </strong>
                <button className="btn btn-primary" disabled={reward.claimed || busy === reward.scope} onClick={() => void claim(reward)}>
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
            const here = mine === tier.tier;
            return (
              <li key={tier.tier} className={here ? styles.here : ""}>
                <RankEmblem tier={tier.tier} division={null} size={18} />
                <b>{tier.share}%</b>
                <span>{tier.gems ? "in gems" : "in SOL"}</span>
              </li>
            );
          })}
        </ul>
      )}
      {next && (
        <p className={styles.footnote}>
          Reach <b>{TIER_NAMES[next.tier]}</b> and every week comes back at <b>{next.share}%</b>
          {next.gems ? "" : ", paid in SOL"}.
        </p>
      )}
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
