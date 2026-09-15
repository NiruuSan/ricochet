"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Trophy } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AssetTabs } from "../asset-tabs";
import { Avatar } from "../avatar";
import { CURRENCY, signedAmount } from "../format";
import type { PlayerState } from "../arena";

export function LeaderboardView({ player }: { player: PlayerState }) {
  const { data, asset, setAsset, loaded } = player;
  const [name, setName] = useState("");
  const router = useRouter();
  return (
    <section className="subpage">
      <div className="tag lime" style={{ marginBottom: 12 }}>
        THE SCORE THAT COUNTS
      </div>
      <h1>Meet the angle masters.</h1>
      <form className="row-actions" style={{ margin: "20px 0" }} onSubmit={(event) => { event.preventDefault(); router.push(`/players/${encodeURIComponent(name.trim())}`); }}>
        <input className="input" aria-label="Find a player by name" placeholder="Find a player by name" value={name} onChange={(event) => setName(event.target.value)} pattern="[a-zA-Z0-9_]{3,20}" minLength={3} maxLength={20} required style={{ maxWidth: 320 }} />
        <button className="btn">View profile</button>
      </form>
      <AssetTabs asset={asset} onChange={setAsset} />
      <p className="muted">Ranked by net profit from settled {asset === "gems" ? "gem" : "devnet SOL"} matches. Entry fees included.</p>
      <div className="table-card">
        {data.leaders.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Rank</TableHead>
                <TableHead>Player</TableHead>
                <TableHead>Settled matches</TableHead>
                <TableHead>Net P&L · {CURRENCY[asset]}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.leaders.map((p, i) => (
                // Names are unique; private authentication IDs are never sent.
                <TableRow key={p.name}>
                  <TableCell>
                    <b className={i === 0 ? "lime" : ""}>{String(i + 1).padStart(2, "0")}</b>
                  </TableCell>
                  <TableCell>
                    <Link href={`/players/${encodeURIComponent(p.name)}`} className="you-card">
                      <Avatar name={p.name} src={p.avatar} />
                      <b>
                        {p.name}
                        {p.is_you ? " (you)" : ""}
                      </b>
                    </Link>
                  </TableCell>
                  <TableCell>{p.games}</TableCell>
                  <TableCell className={p.pnl >= 0 ? "lime" : ""}>
                    <b>{signedAmount(p.pnl, asset)}</b>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="empty-big">
            <Trophy />
            <h2>The top spot is wide open.</h2>
            <p>{loaded ? "Rankings appear when the first matches settle. No bots, no invented champions." : "Loading the leaderboard…"}</p>
            <Link href="/" className="btn btn-primary" style={{ marginTop: 15 }}>
              Enter the arena <ArrowRight />
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}
