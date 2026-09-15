"use client";
import { useEffect, useState } from "react";
import { Lock, RefreshCw } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AdminOverview, PeriodTotals } from "@/lib/api-types";
import { request } from "../api";
import { Avatar } from "../avatar";
import { FundedWallet, fullSol } from "../funded-wallet";
import { units } from "../format";
import type { PlayerState } from "../arena";

const REFRESH_MS = 15_000;
const PERIODS = [
  ["day", "24 hours"],
  ["week", "7 days"],
  ["month", "30 days"],
] as const;

function VolumeRow({ label, totals, format }: { label: string; totals: PeriodTotals; format: (value: number) => string }) {
  return (
    <TableRow>
      <TableCell>{label}</TableCell>
      {PERIODS.map(([key]) => (
        <TableCell key={key}>
          <b>{format(totals[key])}</b>
        </TableCell>
      ))}
    </TableRow>
  );
}

export function AdminView({ player }: { player: PlayerState }) {
  const { data, loaded } = player;
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!data.isAdmin) return;
    let active = true;
    const load = () =>
      request<AdminOverview>("/api/admin").then(
        (next) => active && (setOverview(next), setError("")),
        (e: Error) => active && setError(e.message),
      );
    void load();
    const timer = setInterval(() => !document.hidden && void load(), REFRESH_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [data.isAdmin]);

  if (!data.isAdmin) {
    return (
      <section className="subpage">
        <section className="panel">
          <Lock style={{ marginBottom: 20 }} />
          <h2>{loaded ? "Administrator access required." : "Checking access…"}</h2>
          <p className="muted" style={{ marginTop: 12 }}>
            This area is available only to the configured administrator account.
          </p>
        </section>
      </section>
    );
  }

  const solAmount = (value: number) => `${fullSol(value)} SOL`;
  const count = (value: number) => units(value, "gems");
  const gemAmount = (value: number) => `${units(value, "gems")} gems`;

  return (
    <section className="subpage">
      <div className="tag lime" style={{ marginBottom: 12 }}>
        ADMIN
      </div>
      <h1>House overview.</h1>
      <p className="muted">
        Live players, volumes and the devnet treasury. Refreshes every 15 seconds
        {overview && ` · updated ${new Date(overview.generated).toLocaleTimeString()}`}.
      </p>
      {error && (
        <div className="error" role="alert">
          <span>{error}</span>
        </div>
      )}

      <h2 style={{ marginBottom: 4 }}>Players</h2>
      <div className="stat-grid">
        <div className="stat-card">
          <span className="muted">Registered</span>
          <b>{overview ? count(overview.players.registered) : "—"}</b>
        </div>
        <div className="stat-card">
          <span className="muted">
            <span className="online-dot" /> Online now
          </span>
          <b className="lime">{overview ? count(overview.players.online) : "—"}</b>
        </div>
        <div className="stat-card">
          <span className="muted">Offline</span>
          <b>{overview ? count(overview.players.offline) : "—"}</b>
        </div>
      </div>
      {overview && overview.players.onlineNames.length > 0 && (
        <div className="online-list">
          {overview.players.onlineNames.map((p) => (
            <span key={p.name} className="online-chip">
              <Avatar name={p.name} src={p.avatar} size={24} />
              {p.name}
            </span>
          ))}
        </div>
      )}
      <p className="fine">Online means active in the last minute. Open pages check in every 15 seconds.</p>

      <h2 style={{ margin: "35px 0 20px" }}>Volume</h2>
      <div className="table-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Devnet SOL</TableHead>
              {PERIODS.map(([key, label]) => (
                <TableHead key={key}>{label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {overview ? (
              <>
                <VolumeRow label="Staked in matches" totals={overview.devnet.entries} format={solAmount} />
                <VolumeRow label="Matches created" totals={overview.devnet.matches} format={count} />
                <VolumeRow label="Player deposits" totals={overview.devnet.deposits} format={solAmount} />
                <VolumeRow label="Player withdrawals" totals={overview.devnet.withdrawals} format={solAmount} />
                <VolumeRow label="House fees earned" totals={overview.devnet.fees} format={solAmount} />
              </>
            ) : (
              <TableRow>
                <TableCell colSpan={4}>
                  <RefreshCw size={14} className="spin" /> Loading…
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="table-card" style={{ marginTop: 18 }}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Gems</TableHead>
              {PERIODS.map(([key, label]) => (
                <TableHead key={key}>{label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {overview && (
              <>
                <VolumeRow label="Staked in matches" totals={overview.gems.entries} format={gemAmount} />
                <VolumeRow label="Matches created" totals={overview.gems.matches} format={count} />
                <VolumeRow label="House fees" totals={overview.gems.fees} format={gemAmount} />
              </>
            )}
          </TableBody>
        </Table>
      </div>
      <p className="fine" style={{ marginTop: 12 }}>
        Rolling windows ending now. Deposits and withdrawals count once confirmed on-chain.
      </p>

      <h2 style={{ marginTop: 35 }}>Treasury</h2>
      <FundedWallet treasury />
    </section>
  );
}
