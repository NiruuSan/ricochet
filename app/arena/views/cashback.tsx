"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Coins, Gem, HandCoins } from "lucide-react";
import { request } from "../api";
import { amount, units } from "../format";
import type { PlayerState } from "../arena";
import styles from "./cashback.module.css";

// What the player gets back, and the grid it came from. The money side of it is
// in lib/rewards.ts; this only shows it and asks for the tap.

type Tier = { from: number; share: number; gems: boolean; name: string };
type Reward = {
  scope: "weekly" | "monthly";
  period: number;
  endedAt: number;
  closesAt: number;
  volume: number;
  fees: number;
  amount: number;
  asset: "devnet" | "gems";
  tier: string;
  share: number;
  claimed: boolean;
};
type Board = { tiers: Tier[]; rewards: Reward[] };

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

  return (
    <section className={styles.panel}>
      <header className={styles.head}>
        <span className={styles.icon} aria-hidden>
          <HandCoins size={18} />
        </span>
        <div>
          <h2>Cashback</h2>
          <p>Part of the house fee you paid, back every week — and again at the end of a month you kept playing.</p>
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
                <b>
                  {reward.scope === "weekly" ? "Last week" : "Last month"} · {reward.tier}
                </b>
                <p>
                  {amount(reward.volume, "devnet")} wagered, {amount(reward.fees, "devnet")} of fees. You get {reward.share}% of it back.
                </p>
                <small>
                  {day(reward.period)} – {day(reward.endedAt - 1)} · claim before {day(reward.closesAt)}
                </small>
              </div>
              <div className={styles.action}>
                <strong className={reward.asset === "gems" ? styles.gems : undefined}>
                  {reward.asset === "gems" ? <Gem size={15} /> : <Coins size={15} />} {value(reward)}
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
        <table className={styles.grid}>
          <tbody>
            {board.tiers.map((tier) => (
              <tr key={tier.name}>
                <td>{tier.name}</td>
                <td className={styles.from}>{tier.from ? `${amount(tier.from, "devnet")}+ a week` : "Any play"}</td>
                <td>
                  <b>{tier.share}%</b> of your fees
                </td>
                <td className={styles.paid}>{tier.gems ? "in gems" : "in SOL"}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
