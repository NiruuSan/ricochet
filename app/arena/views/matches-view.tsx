"use client";
import { useState } from "react";
import { ENTRY_BATCH, ShowMore } from "@/components/ui/show-more";
import Link from "next/link";
import { ArrowRight, History, Medal } from "lucide-react";
import type { MatchSummary, TournamentHistoryItem } from "@/lib/api-types";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AssetTabs } from "../asset-tabs";
import { amount, CURRENCY, matchStats, outcome, shortDate, shortId, signedAmount } from "../format";
import type { PlayerState } from "../arena";
import { ordinal } from "../tournament-format";

type Filter = "all" | "open" | "settled";
type Row = { kind: "match"; at: number; settled: boolean; m: MatchSummary } | { kind: "tournament"; at: number; settled: boolean; t: TournamentHistoryItem };

const closed = (t: TournamentHistoryItem) => t.status === "settled" || t.status === "cancelled";

function tournamentOutcome(t: TournamentHistoryItem) {
  if (t.status === "cancelled") return "Cancelled · refunded";
  if (t.status === "settled") return t.rank ? `${ordinal(t.rank)} of ${t.players}${t.payout ? " · prize won" : ""}` : "Did not play";
  if (t.status === "registration") return "Registered · not started";
  if (t.status === "closing" || t.done) return "Waiting for results";
  return (
    <Link href={`/?tournament=${t.id}`} className="lime">
      {t.started ? "Resume run ↗" : "Play your run ↗"}
    </Link>
  );
}

export function MatchesView({ player }: { player: PlayerState }) {
  const { data, asset, setAsset } = player;
  const [filter, setFilter] = useState<Filter>("all");
  const [limit, setLimit] = useState(ENTRY_BATCH);
  const tournaments = data.tournaments ?? [];
  const stats = matchStats(data.matches);
  const settledTournaments = tournaments.filter((t) => t.status === "settled");
  const pnl = stats.pnl + settledTournaments.reduce((sum, t) => sum + t.net, 0);
  const wins = stats.wins + settledTournaments.filter((t) => t.rank === 1).length;
  const rows: Row[] = [
    ...data.matches.map((m) => ({ kind: "match" as const, at: m.created, settled: !!m.settled, m })),
    ...tournaments.map((t) => ({ kind: "tournament" as const, at: t.registered, settled: closed(t), t })),
  ].sort((a, b) => b.at - a.at);
  const shown = rows.filter((r) => filter === "all" || (filter === "settled" ? r.settled : !r.settled));

  return (
    <section className="subpage">
      <div className="tag lime" style={{ marginBottom: 12 }}>
        YOUR TRACK RECORD
      </div>
      <h1>Every run has a story.</h1>
      <AssetTabs asset={asset} onChange={(next) => { setAsset(next); setLimit(ENTRY_BATCH); }} />
      <p className="muted">Live runs, open challenges, tournaments and settled rivalries.</p>
      <div className="stat-grid">
        <div className="stat-card">
          <span className="muted">Matches & tournaments</span>
          <b>{rows.length}</b>
        </div>
        <div className="stat-card">
          <span className="muted">Victories · 1st places</span>
          <b>{wins}</b>
        </div>
        <div className="stat-card">
          <span className="muted">Settled P&L · {CURRENCY[asset]}</span>
          <b className={pnl >= 0 ? "lime" : ""}>{signedAmount(pnl, asset)}</b>
        </div>
      </div>
      <Tabs value={filter} onValueChange={(v) => { setFilter(v as Filter); setLimit(ENTRY_BATCH); }}>
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
              {shown.slice(0, limit).map((row) => {
                if (row.kind === "tournament") {
                  const t = row.t;
                  return (
                    <TableRow key={`t:${t.id}`}>
                      <TableCell>
                        <Link className="lime" href={`/tournaments/${t.id}`} style={{ fontWeight: 800, display: "inline-flex", alignItems: "center", gap: 6 }}>
                          <Medal size={14} style={{ flexShrink: 0 }} />
                          {t.name}
                        </Link>
                        <div className="fine">
                          Tournament · {shortDate(t.registered)}
                          {t.watchId && (
                            <>
                              {" · "}
                              <Link className="lime" href={`/watch/${t.watchId}`}>
                                {t.done ? "Replay" : "Watch"}
                              </Link>
                            </>
                          )}
                        </div>
                      </TableCell>
                      <TableCell data-label="Entry">{t.entryFee ? amount(t.entryFee, asset) : "Free"}</TableCell>
                      <TableCell data-label="Your score">{t.started ? t.score : "—"}</TableCell>
                      <TableCell data-label="Players">{t.status === "settled" ? `${t.players} ${t.players === 1 ? "player" : "players"}` : "—"}</TableCell>
                      <TableCell data-label="Result">{tournamentOutcome(t)}</TableCell>
                      <TableCell data-label="Net P&L">{closed(t) ? <span className={t.net > 0 ? "lime" : ""}>{signedAmount(t.net, asset)}</span> : "—"}</TableCell>
                    </TableRow>
                  );
                }
                const m = row.m;
                return (
                <TableRow key={m.id}>
                  <TableCell>
                    <b>{shortId(m.id)}</b>
                    <div className="fine">
                      {shortDate(m.created)}
                      {m.done && (m.joined || m.settled) ? (
                        <>
                          {" · "}
                          <Link className="lime" href={`/watch/m-${m.run_id}`}>
                            Replay
                          </Link>
                        </>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell data-label="Entry">{amount(m.stake, asset)}</TableCell>
                  <TableCell data-label="Your score">{m.score}</TableCell>
                  <TableCell data-label="Opponent">
                    {m.opponent ? <Link className="lime" href={`/players/${encodeURIComponent(m.opponent)}`}>{m.opponent}</Link> : (m.result === "cancelled" ? "-" : "Seat open")}
                    {m.opponent_score !== null && <span className="muted"> · {m.opponent_score}</span>}
                  </TableCell>
                  <TableCell data-label="Result">
                    {m.done ? (
                      outcome(m)
                    ) : (
                      <Link href="/" className="lime">
                        Resume run ↗
                      </Link>
                    )}
                  </TableCell>
                  <TableCell data-label="Net P&L">{m.settled ? <span className={m.net > 0 ? "lime" : ""}>{signedAmount(m.net, asset)}</span> : "—"}</TableCell>
                </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : (
          <div className="empty-big">
            <History />
            <h2>No matches here yet.</h2>
            <p>Choose an entry in the arena or join a tournament. Your match stays open until a challenger joins.</p>
            <Link href="/" className="btn btn-primary" style={{ marginTop: 15 }}>
              Find your angle <ArrowRight />
            </Link>
          </div>
        )}
      </div>
      <ShowMore shown={Math.min(limit, shown.length)} total={shown.length} onShowMore={() => setLimit((current) => current + ENTRY_BATCH)} label="matches" />
      <p className="fine" style={{ marginTop: 14 }}>
        History includes up to 50 matches and 50 tournament entries. Open entries are reserved and excluded from settled P&L.
      </p>
    </section>
  );
}
