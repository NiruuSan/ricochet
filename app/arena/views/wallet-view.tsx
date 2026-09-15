"use client";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpFromLine, Wallet } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { signOutToLogin } from "../../auth-actions";
import { FundedWallet } from "../funded-wallet";
import { LEDGER_LABELS, matchStats, shortDate, signed, sol } from "../format";
import type { PlayerState } from "../arena";

export function WalletView({ player, onDemoFundsInfo }: { player: PlayerState; onDemoFundsInfo: () => void }) {
  const { data } = player;
  const { pnl, openEntries } = matchStats(data.matches);
  return (
    <section className="subpage">
      <div className="tag lime" style={{ marginBottom: 12 }}>
        YOUR GAME BALANCE
      </div>
      <h1>A little fuel for your next run.</h1>
      <p className="muted">Use the devnet wallet for test-network transfers. Demo credits have no monetary value and cannot be withdrawn.</p>
      <FundedWallet />
      <h2 style={{ marginBottom: 20 }}>Demo credits</h2>
      <div className="wallet-grid">
        <div className="panel">
          <div className="panel-title">
            <h3>Available balance</h3>
            <Wallet />
          </div>
          <div className="wallet-value">
            {sol(data.player?.balance ?? 0)} <small>demo SOL</small>
          </div>
          <p className="fine">New profiles receive 20 demo SOL to try the arena.</p>
          <div className="wallet-actions">
            <button className="btn btn-primary" onClick={onDemoFundsInfo}>
              <ArrowDownLeft />
              Deposit
            </button>
            <button className="btn" onClick={onDemoFundsInfo}>
              <ArrowUpFromLine />
              Withdraw
            </button>
          </div>
          {!data.player && (
            <Link className="btn full" href="/signup">
              Create player profile
            </Link>
          )}
        </div>
        <div className="panel">
          <h3>{data.player ? data.player.name : "Your player profile"}</h3>
          <p className="muted" style={{ marginTop: 14 }}>
            Your balance and completed rounds are saved to your account.
          </p>
          <div className="math-line" style={{ marginTop: 25 }}>
            <span>Settled profit / loss</span>
            <strong className="lime">{signed(pnl)} SOL</strong>
          </div>
          <div className="math-line">
            <span>Open entries</span>
            <strong>{sol(openEntries)} SOL</strong>
          </div>
          {data.authenticated && (
            <form action={signOutToLogin}>
              <button className="btn" style={{ marginTop: 12 }}>
                Sign out
              </button>
            </form>
          )}
        </div>
      </div>
      <h2 style={{ margin: "35px 0 20px" }}>Activity</h2>
      <div className="table-card">
        {data.transactions.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Amount · demo SOL</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.transactions.map((t, i) => (
                <TableRow key={i}>
                  <TableCell>{LEDGER_LABELS[t.kind] ?? t.kind}</TableCell>
                  <TableCell>{shortDate(t.created)}</TableCell>
                  <TableCell className={t.amount > 0 ? "lime" : ""}>{signed(t.amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="empty-big" style={{ padding: 35 }}>
            <p>Your match entries and payouts will appear here.</p>
          </div>
        )}
      </div>
    </section>
  );
}
