"use client";
import Link from "next/link";
import { FundedWallet } from "../funded-wallet";
import type { PlayerState } from "../arena";

export function WalletView({ player }: { player: PlayerState }) {
  const { data, loaded } = player;
  return (
    <section className="subpage">
      <div className="tag lime" style={{ marginBottom: 12 }}>
        YOUR WALLET
      </div>
      <h1>A little fuel for your next run.</h1>
      <p className="muted">Deposit and withdraw Solana devnet SOL. Test-network SOL has no monetary value.</p>
      {data.player ? (
        <FundedWallet />
      ) : (
        loaded && (
          <Link className="btn btn-primary" href={data.authenticated ? "/signup" : "/login"}>
            {data.authenticated ? "Create player profile" : "Sign in"}
          </Link>
        )
      )}
    </section>
  );
}
