"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { PublicPlayerProfile } from "@/lib/api-types";
import type { PlayerState } from "../arena";
import { request } from "../api";
import { Avatar } from "../avatar";
import { AssetTabs } from "../asset-tabs";
import { signedAmount, CURRENCY } from "../format";
import { TipButton } from "../tip-button";

export function PublicProfileView({ name, player }: { name: string; player: PlayerState }) {
  const [profile, setProfile] = useState<PublicPlayerProfile | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    const load = () => request<PublicPlayerProfile>(`/api/players/${encodeURIComponent(name)}`).then(
      (next) => { if (active) { setProfile(next); setError(""); } },
      (e: Error) => { if (active) setError(e.message); },
    );
    void load();
    const timer = setInterval(() => { if (!document.hidden) void load(); }, 15_000);
    return () => { active = false; clearInterval(timer); };
  }, [name, retry]);
  const stats = profile?.stats[player.asset];
  return (
    <section className="subpage">
      <Link href="/leaderboard" className="lime">← Leaderboard</Link>
      {error && <div className="error" role="alert" style={{ marginTop: 20 }}><span>{error}</span><button onClick={() => setRetry((value) => value + 1)}>Retry</button></div>}
      {!profile ? <h1 style={{ marginTop: 25 }}>{error ? "Profile unavailable." : "Loading player…"}</h1> : <>
        <div className="panel" style={{ margin: "25px 0" }}>
          <div className="profile-picture">
            <Avatar name={profile.name} src={profile.avatar} size={96} />
            <div>
              <div className="tag lime" style={{ marginBottom: 10 }}>PLAYER PROFILE</div>
              <h1>{profile.name}</h1>
              <p className="fine">Member since {new Date(profile.created).toLocaleDateString(undefined, { month: "long", year: "numeric" })}</p>
              <div className="row-actions" style={{ marginTop: 16 }}>
                {profile.isYou ? <Link href="/profile" className="btn">Edit your profile</Link> : <TipButton profile={profile} player={player} />}
              </div>
            </div>
          </div>
        </div>
        <h2>Match performance</h2>
        <AssetTabs asset={player.asset} onChange={player.setAsset} />
        <div className="stat-grid">
          <div className="stat-card"><span className="muted">All-time PNL · {CURRENCY[player.asset]}</span><b className={stats!.pnl >= 0 ? "lime" : ""}>{signedAmount(stats!.pnl, player.asset)}</b></div>
          <div className="stat-card"><span className="muted">Settled matches</span><b>{stats!.games.toLocaleString()}</b></div>
          <div className="stat-card"><span className="muted">Victories</span><b>{stats!.wins.toLocaleString()}</b></div>
        </div>
        <p className="fine">PNL is profit or loss from all settled matches, including entries and payouts. Open matches, deposits, withdrawals and tips are excluded.</p>
        {stats!.games === 0 && <p className="muted" style={{ marginTop: 20 }}>No settled {player.asset === "gems" ? "gem" : "devnet SOL"} matches yet.</p>}
      </>}
    </section>
  );
}
