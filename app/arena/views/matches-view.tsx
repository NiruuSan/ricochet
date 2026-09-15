"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowRight, History } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AssetTabs } from "../asset-tabs";
import { amount, CURRENCY, matchStats, outcome, shortDate, shortId, signedAmount } from "../format";
import type { PlayerState } from "../arena";

type Filter = "all" | "open" | "settled";

export function MatchesView({ player }: { player: PlayerState }) {
  const { data, asset, setAsset } = player;
  const [filter, setFilter] = useState<Filter>("all");
  const { pnl, wins } = matchStats(data.matches);
  const shown = data.matches.filter((m) => filter === "all" || (filter === "settled" ? m.settled : !m.settled));

  return (
    <section className="subpage">
      <div className="tag lime" style={{ marginBottom: 12 }}>
        YOUR TRACK RECORD
      </div>
      <h1>Every run has a story.</h1>
      <AssetTabs asset={asset} onChange={setAsset} />
      <p className="muted">Live runs, open challenges, and settled rivalries.</p>
      <div className="stat-grid">
        <div className="stat-card">
          <span className="muted">Matches entered</span>
          <b>{data.matches.length}</b>
        </div>
        <div className="stat-card">
          <span className="muted">Victories</span>
          <b>{wins}</b>
        </div>
        <div className="stat-card">
          <span className="muted">Settled P&L · {CURRENCY[asset]}</span>
          <b className={pnl >= 0 ? "lime" : ""}>{signedAmount(pnl, asset)}</b>
        </div>
      </div>
      <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
        <TabsList className="mode-tabs" style={{ maxWidth: 390, marginBottom: 20 }}>
          <TabsTrigger value="all">All matches</TabsTrigger>
          <TabsTrigger value="open">Open</TabsTrigger>
          <TabsTrigger value="settled">Settled</TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="table-card">
        {shown.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Match</TableHead>
                <TableHead>Entry</TableHead>
                <TableHead>Your score</TableHead>
                <TableHead>Opponent</TableHead>
                <TableHead>Result</TableHead>
                <TableHead>Net P&L</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>
                    <b>{shortId(m.id)}</b>
                    <div className="fine">{shortDate(m.created)}</div>
                  </TableCell>
                  <TableCell>{amount(m.stake, asset)}</TableCell>
                  <TableCell>{m.score}</TableCell>
                  <TableCell>
                    {m.opponent ?? (m.result === "cancelled" ? "—" : "Seat open")}
                    {m.opponent_score !== null && <span className="muted"> · {m.opponent_score}</span>}
                  </TableCell>
                  <TableCell>
                    {m.done ? (
                      outcome(m)
                    ) : (
                      <Link href="/" className="lime">
                        Resume run ↗
                      </Link>
                    )}
                  </TableCell>
                  <TableCell>{m.settled ? <span className={m.net > 0 ? "lime" : ""}>{signedAmount(m.net, asset)}</span> : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="empty-big">
            <History />
            <h2>No matches here yet.</h2>
            <p>Choose an entry in the arena. Your match stays open until a challenger joins.</p>
            <Link href="/" className="btn btn-primary" style={{ marginTop: 15 }}>
              Find your angle <ArrowRight />
            </Link>
          </div>
        )}
      </div>
      <p className="fine" style={{ marginTop: 14 }}>
        Showing your latest 50 matches. Open entries are reserved and excluded from settled P&L.
      </p>
    </section>
  );
}
