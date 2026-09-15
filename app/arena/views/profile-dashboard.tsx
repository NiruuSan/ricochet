"use client";
import { useEffect, useId, useState, type PointerEvent } from "react";
import Link from "next/link";
import { ArrowDownUp, ArrowLeft, ArrowUpRight, Check, ChevronDown, Gem, History, Search, Settings2, Share2, TrendingUp, Wallet, Zap } from "lucide-react";
import type { Asset, PnlRange, ProfileMatch, ProfilePerformance, PublicPlayerProfile } from "@/lib/api-types";
import type { PlayerState } from "../arena";
import { request } from "../api";
import { Avatar } from "../avatar";
import { fullSol } from "../funded-wallet";
import { shortId } from "../format";
import { TipButton } from "../tip-button";
import styles from "./profile-dashboard.module.css";

const RANGES = [["day", "1D", "Last 24 hours"], ["week", "1W", "Last 7 days"], ["month", "1M", "Last 30 days"], ["year", "1Y", "Last 365 days"], ["all", "ALL", "All time"]] as const;
const number = (value: number, asset: Asset) => asset === "devnet" ? fullSol(value) : value.toLocaleString("en");
const signed = (value: number, asset: Asset) => `${value > 0 ? "+" : ""}${number(value, asset)}`;
const currency = (asset: Asset) => asset === "gems" ? "gems" : "SOL";
const RESULTS = { win: "Won", loss: "Lost", draw: "Draw", cancelled: "Cancelled" };

function PnlCard({ performance, asset }: { performance: ProfilePerformance; asset: Asset }) {
  const [range, setRange] = useState<PnlRange>("all");
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  const { points, total } = performance.series[range];
  const selected = hover === null ? null : points[hover];
  const value = selected?.value ?? total;
  const low = Math.min(0, ...points.map((point) => point.value));
  const high = Math.max(0, ...points.map((point) => point.value));
  const span = high - low || 1;
  const x = (i: number) => 8 + i / (points.length - 1) * 484;
  const y = (n: number) => 151 - (n - low) / span * 128;
  const path = points.map((point, i) => `${i ? "L" : "M"}${x(i)},${y(point.value)}`).join(" ");
  const inspect = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const fraction = ((event.clientX - rect.left) / rect.width * 500 - 8) / 484;
    setHover(Math.max(0, Math.min(points.length - 1, Math.round(fraction * (points.length - 1)))));
  };
  return <section className={`${styles.card} ${styles.pnlCard}`} aria-label="Profit and loss chart">
    <div className={styles.chartHeader}>
      <h2><TrendingUp size={16} /> Profit / Loss</h2>
      <div className={styles.ranges} role="group" aria-label="PNL date range">
        {RANGES.map(([key, label, description]) => <button key={key} type="button" aria-pressed={range === key} aria-label={description} onClick={() => { setRange(key); setHover(null); }}>{label}</button>)}
      </div>
    </div>
    <div className={`${styles.pnlValue} ${value < 0 ? styles.negative : ""}`}>{signed(value, asset)} <span>{currency(asset)}</span></div>
    <div className={styles.chartMeta}>
      <span>{selected ? new Date(selected.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : RANGES.find(([key]) => key === range)![2]}</span>
      <span className={styles.watermark}><Zap size={15} fill="currentColor" /> ricochet.</span>
    </div>
    <div className={styles.chartWrap}>
      {/* The drawing stretches to the box, so pointer positions map straight onto the viewBox; strokes keep their width. */}
      <svg className={styles.chart} viewBox="0 0 500 175" preserveAspectRatio="none" role="img" tabIndex={0} aria-label={`${RANGES.find(([key]) => key === range)![2]} PNL: ${signed(total, asset)} ${currency(asset)}. Use left and right arrow keys to inspect points.`}
        onPointerMove={inspect} onPointerDown={inspect} onPointerLeave={() => setHover(null)} onBlur={() => setHover(null)} onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          setHover((previous) => event.key === "Home" ? 0 : event.key === "End" ? points.length - 1 : Math.max(0, Math.min(points.length - 1, (previous ?? points.length - 1) + (event.key === "ArrowLeft" ? -1 : 1))));
        }}>
        <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="currentColor" stopOpacity=".23" /><stop offset="1" stopColor="currentColor" stopOpacity="0" /></linearGradient></defs>
        <line x1="8" x2="492" y1={y(0)} y2={y(0)} className={styles.baseline} vectorEffect="non-scaling-stroke" />
        <path d={`${path} L492,166 L8,166 Z`} fill={`url(#${id})`} />
        <path d={path} stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {hover !== null && selected && <line x1={x(hover)} x2={x(hover)} y1="10" y2="165" className={styles.crosshair} vectorEffect="non-scaling-stroke" />}
      </svg>
      {/* A round marker in HTML, since the stretched SVG would squash a circle. */}
      {hover !== null && selected && <span className={styles.marker} style={{ left: `${x(hover) / 5}%`, top: `${y(selected.value) / 1.75}%` }} aria-hidden />}
    </div>
    <div className={styles.chartDates}><span>{new Date(points[0].at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span><span>{high === 0 && low === 0 ? "No settled PNL in this period" : "Settled match PNL"}</span><span>Now</span></div>
    <span className={styles.srOnly} aria-live="polite">{selected && `${signed(selected.value, asset)} ${currency(asset)}`}</span>
  </section>;
}

function MatchRows({ performance, asset }: { performance: ProfilePerformance; asset: Asset }) {
  const [filter, setFilter] = useState<"open" | "settled">("settled");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("recent");
  const matches = performance.history.filter((match) => (filter === "settled" ? !!match.settled : !match.settled) && `${match.opponent ?? "open seat"} ${match.id} ${match.result ?? "open"}`.toLowerCase().includes(search.toLowerCase().trim()))
    .sort((a, b) => sort === "pnl" ? b.net - a.net : sort === "stake" ? b.stake - a.stake : b.created - a.created);
  const status = (match: ProfileMatch) => match.result ? RESULTS[match.result] : match.opponent ? "In progress" : "Seat open";
  return <section className={styles.historySection} aria-label="Player match history">
    <h2 className={styles.historyTitle}>Matches</h2>
    <div className={styles.toolbar}>
      <div className={styles.filters} role="group" aria-label="Match status"><button aria-pressed={filter === "open"} onClick={() => setFilter("open")}>Open</button><button aria-pressed={filter === "settled"} onClick={() => setFilter("settled")}>Settled</button></div>
      <label className={styles.search}><Search size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search matches or players" aria-label="Search match history" /></label>
      <label className={styles.sort}><ArrowDownUp size={15} /><select aria-label="Sort match history" value={sort} onChange={(event) => setSort(event.target.value)}><option value="recent">Recent</option><option value="pnl">Profit / Loss</option><option value="stake">Entry value</option></select><ChevronDown size={13} /></label>
    </div>
    <div className={styles.tableScroll}>
      <table className={styles.table}>
        <thead><tr><th>Match</th><th>Entry</th><th>Result</th><th>Profit / Loss</th></tr></thead>
        <tbody>{matches.map((match) => <tr key={match.id}>
          <td><div className={styles.matchIdentity}>
            {match.opponent ? <Avatar name={match.opponent} src={match.opponentAvatar} size={40} /> : <span className={styles.matchIcon}><Zap size={22} /></span>}
            <div><div className={styles.matchName}>{match.opponent ? <>vs <Link href={`/players/${encodeURIComponent(match.opponent)}`}>{match.opponent}</Link></> : "Open challenge"}</div>
              <span className={styles.matchSub}>#{shortId(match.id)} <span>·</span> {new Date(match.created).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span></div>
          </div></td>
          <td>{number(match.stake, asset)} <small>{currency(asset)}</small></td>
          <td><span className={`${styles.status} ${match.result === "win" ? styles.won : match.result === "loss" ? styles.lost : ""}`}>{status(match)}</span></td>
          <td><strong className={match.net > 0 ? styles.positive : match.net < 0 ? styles.negative : ""}>{match.settled ? `${signed(match.net, asset)} ${currency(asset)}` : "—"}</strong><span className={styles.return}>{match.settled ? `${match.net > 0 ? "+" : ""}${Math.round(match.net / match.stake * 100)}% return` : "Entry committed"}</span></td>
        </tr>)}</tbody>
      </table>
    </div>
    {!matches.length && <div className={styles.empty}><History size={28} /><h3>{search ? "No matching games" : filter === "open" ? "No open matches" : "No settled matches yet"}</h3><p>{search ? "Try another player name or match ID." : "Every angle counts. Your matches will appear here."}</p></div>}
    <p className={styles.historyNote}>Latest {performance.history.length} of {performance.played} matches · PNL chart includes all settled history. Tips and wallet transfers are excluded.</p>
  </section>;
}

type ProfileData = { name: string; asset: Asset; profile: PublicPlayerProfile; performance: ProfilePerformance };

export function ProfileDashboard({ name, player, privateView = false, onEdit }: { name: string; player: PlayerState; privateView?: boolean; onEdit?: () => void }) {
  const [data, setData] = useState<ProfileData | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [shared, setShared] = useState(false);
  const [shareError, setShareError] = useState("");
  const { asset } = player;
  useEffect(() => {
    let active = true;
    const load = () => Promise.all([
      request<PublicPlayerProfile>(`/api/players/${encodeURIComponent(name)}`),
      request<ProfilePerformance>(`/api/players/${encodeURIComponent(name)}/performance?asset=${asset}`),
    ]).then(([profile, performance]) => { if (active) { setData({ name, asset, profile, performance }); setError(""); } }, (e: Error) => { if (active) setError(e.message); });
    void load();
    const timer = setInterval(() => { if (!document.hidden) void load(); }, 15_000);
    return () => { active = false; clearInterval(timer); };
  }, [name, asset, retry]);
  const current = data?.name === name && data?.asset === asset ? data : null;
  const profile = current?.profile;
  const performance = current?.performance;
  const own = privateView && profile?.isYou;
  const available = asset === "gems" ? player.data.player?.balance ?? 0 : player.data.cashBalance ?? 0;
  return <section className={styles.page}>
    <div className={styles.assetBar}>
      <div className={styles.assetTabs} role="group" aria-label="Profile currency"><button aria-pressed={asset === "devnet"} onClick={() => player.setAsset("devnet")}><Zap size={17} /> Devnet SOL</button><button aria-pressed={asset === "gems"} onClick={() => player.setAsset("gems")}><Gem size={17} /> Gems</button></div>
      <Link className={styles.back} href={privateView ? "/wallet" : "/leaderboard"}>{privateView ? <Wallet size={15} /> : <ArrowLeft size={15} />}{privateView ? "My wallet" : "Leaderboard"}</Link>
    </div>
    {error && <div className="error" role="alert"><span>{error}</span><button onClick={() => setRetry((value) => value + 1)}>Retry</button></div>}
    {shareError && <p className="error" role="alert">{shareError}</p>}
    {!profile || !performance ? <div className={styles.summary} aria-busy="true"><div className={`${styles.card} ${styles.loading}`}>{error ? "Profile unavailable" : "Loading player profile…"}</div><div className={`${styles.card} ${styles.loading}`}>Loading performance…</div></div> : <>
      <div className={styles.summary}>
        <section className={`${styles.card} ${styles.identityCard}`} aria-label="Player summary">
          <div className={styles.identity}>
            <div className={styles.avatar}><Avatar name={profile.name} src={own ? player.data.player?.avatar : profile.avatar} size={76} /><span className={styles.badge}><Zap size={13} fill="currentColor" /></span></div>
            <div className={styles.nameBlock}><h1>{profile.name}</h1><p>Joined {new Date(profile.created).toLocaleDateString(undefined, { month: "short", year: "numeric" })}<span>·</span>{privateView ? "Your profile" : "Player profile"}</p></div>
            <div className={styles.iconActions}>
              {own && <button className={styles.iconButton} aria-label="Edit profile" title="Edit profile" onClick={onEdit}><Settings2 size={18} /></button>}
              <button className={styles.iconButton} aria-label="Copy public profile link" title="Copy public profile link" onClick={async () => {
                try { await navigator.clipboard.writeText(`${window.location.origin}/players/${encodeURIComponent(profile.name)}`); setShared(true); setShareError(""); }
                catch { setShareError("Could not copy the link. Open the public profile to copy its address."); }
              }}>{shared ? <Check size={18} /> : <Share2 size={18} />}</button>
            </div>
          </div>
          <div className={styles.profileActions}>
            {own ? <><button className={styles.editButton} onClick={onEdit}>Edit profile</button><Link href={`/players/${encodeURIComponent(profile.name)}`}>Public profile <ArrowUpRight size={14} /></Link></> : profile.isYou ? <Link className={styles.editButton} href="/profile">Manage profile</Link> : <TipButton profile={profile} player={player} />}
            {shared && <span className={styles.copied} role="status">Link copied</span>}
          </div>
          <div className={styles.playerStats}>
            <div><strong>{number(own ? available : performance.openEntries, asset)} <small>{currency(asset)}</small></strong><span>{own ? "Available balance" : "Open stakes"}</span></div>
            <div><strong>{number(performance.bestWin, asset)} <small>{currency(asset)}</small></strong><span>Biggest win</span></div>
            <div><strong>{performance.played.toLocaleString()}</strong><span>Matches played</span></div>
          </div>
        </section>
        <PnlCard key={asset} performance={performance} asset={asset} />
      </div>
      <MatchRows key={asset} performance={performance} asset={asset} />
    </>}
  </section>;
}
