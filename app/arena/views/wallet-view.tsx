"use client";
import Link from "next/link";
import { ArrowUpRight, Gem, Wallet } from "lucide-react";
import { FundedWallet } from "../funded-wallet";
import { CashbackPanel } from "./cashback";
import type { PlayerState } from "../arena";
import styles from "../wallet.module.css";

export function WalletView({ player }: { player: PlayerState }) {
  const { data, loaded } = player;
  return (
    <section className={styles.page}>
      <header className={styles.hero}>
        <div>
          <div className={styles.eyebrow}><Wallet size={15} />YOUR WALLET</div>
          <h1>Ready for<br /><span>your next run.</span></h1>
          <p>Your balances, transfers, and the next good angle.<br />Manage your devnet SOL and keep the game going.</p>
          <Link href="/" className={styles.heroLink}>Back to the arena <ArrowUpRight size={15} /></Link>
        </div>
        <div className={styles.heroArt} aria-hidden="true">
          <div className={styles.heroRing} />
          <div className={styles.walletArt}>
            <div className={styles.artCard}><Gem size={25} /><span>BOUNCE</span></div>
            <div className={styles.artBody}><span>ONE MORE ROUND.</span><div className={styles.artClasp}><i /></div></div>
          </div>
          <span className={styles.artCaption}>A LITTLE FUEL. A GOOD ANGLE.</span>
        </div>
      </header>
      {data.player ? (
        <>
          <CashbackPanel player={player} />
          <FundedWallet gems={data.player.balance} />
        </>
      ) : (
        <div className={styles.empty}>
          <Wallet size={30} />
          <h2>{loaded ? "Your next run starts here" : "Loading your wallet…"}</h2>
          {loaded && <>
            <p>Sign in to see your balances and manage your devnet SOL.</p>
            <Link className="btn btn-primary" href={data.authenticated ? "/signup" : "/login"}>
              {data.authenticated ? "Create player profile" : "Sign in"}<ArrowUpRight size={16} />
            </Link>
          </>}
        </div>
      )}
    </section>
  );
}
