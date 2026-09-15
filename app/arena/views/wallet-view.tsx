"use client";
import Link from "next/link";
import { Gem } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FundedWallet } from "../funded-wallet";
import { LEDGER_LABELS, matchStats, shortDate, signedAmount, units } from "../format";
import type { PlayerState } from "../arena";

export function WalletView({ player }: { player: PlayerState }) {
  const { data } = player;
  // The snapshot's match list follows the selected currency; only use it for gems.
  const { pnl, openEntries } = matchStats(player.asset === "gems" ? data.matches : []);
  return (
    <section className="subpage">
      <div className="tag lime" style={{ marginBottom: 12 }}>
        YOUR BALANCES
      </div>
      <h1>A little fuel for your next run.</h1>
      <p className="muted">Gems are free and power gem matches. The devnet wallet holds Solana test-network SOL. Neither has monetary value.</p>
      <h2 style={{ marginBottom: 20 }}>Gems</h2>
      <div className="wallet-grid">
        <div className="panel">
          <div className="panel-title">
            <h3>Available gems</h3>
            <Gem />
          </div>
          <div className="wallet-value">
            {units(data.player?.balance ?? 0, "gems")} <small>gems</small>
          </div>
          <p className="fine">New profiles receive 2,000 gems. Gems cannot be bought, sold, deposited or withdrawn.</p>
          {!data.player && (
            <Link className="btn full" href="/signup" style={{ marginTop: 20 }}>
              Create player profile
            </Link>
          )}
        </div>
        <div className="panel">
          <h3>Gem matches</h3>
          <p className="muted" style={{ marginTop: 14 }}>
            Your gem balance and completed rounds are saved to your account.
          </p>
          {player.asset === "gems" && (
            <>
              <div className="math-line" style={{ marginTop: 25 }}>
                <span>Settled profit / loss</span>
                <strong className="lime">{signedAmount(pnl, "gems")} gems</strong>
              </div>
              <div className="math-line">
                <span>Open entries</span>
                <strong>{units(openEntries, "gems")} gems</strong>
              </div>
            </>
          )}
        </div>
      </div>
      <h2 style={{ margin: "35px 0 20px" }}>Gem activity</h2>
      <div className="table-card">
        {data.transactions.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Amount · gems</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.transactions.map((t, i) => (
                <TableRow key={i}>
                  <TableCell>{LEDGER_LABELS[t.kind] ?? t.kind}</TableCell>
                  <TableCell>{shortDate(t.created)}</TableCell>
                  <TableCell className={t.amount > 0 ? "lime" : ""}>{signedAmount(t.amount, "gems")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="empty-big" style={{ padding: 35 }}>
            <p>Your gem match entries and payouts will appear here.</p>
          </div>
        )}
      </div>
      {data.player && <FundedWallet />}
    </section>
  );
}
