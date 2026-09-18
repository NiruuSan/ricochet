"use client";
import { Tooltip } from "@/components/ui/tooltip";

import { useEffect, useId, useState, type PointerEvent } from "react";
import Link from "next/link";
import { ArrowDownUp, ArrowLeft, ArrowUpRight, Check, Crosshair, Eye, Flame, Gem, History, Medal, Swords, Search, Settings2, Share2, TrendingUp, UserRound, Wallet, Zap } from "lucide-react";
import { Select } from "@/components/ui/select";
import { ENTRY_BATCH, ShowMore } from "@/components/ui/show-more";
import type { Asset, PnlRange, ProfileMatch, ProfilePerformance, ProfileStats, PublicPlayerProfile } from "@/lib/api-types";
import type { PlayerState } from "../arena";
import { request } from "../api";
import { RankEmblem, RankProgress } from "../rank-badge";
import { Avatar } from "../avatar";
import { fullSol } from "../funded-wallet";
import { shortId } from "../format";
import { ordinal } from "../tournament-format";
import { TipButton } from "../tip-button";
import styles from "./profile-dashboard.module.css";

const RANGES = [["day", "1D", "Last 24 hours"], ["week", "1W", "Last 7 days"], ["month", "1M", "Last 30 days"], ["year", "1Y", "Last 365 days"], ["all", "ALL", "All time"]] as const;
const number = (value: number, asset: Asset) => asset === "devnet" ? fullSol(value) : value.toLocaleString("en");
const signed = (value: number, asset: Asset) => `${value > 0 ? "+" : ""}${number(value, asset)}`;
const currency = (asset: Asset) => asset === "gems" ? "gems" : "SOL";
const RESULTS = { win: "Won", loss: "Lost", draw: "Draw", cancelled: "Cancelled" };
const TOURNAMENT_STATUS = { registration: "Registered", live: "Live", closing: "Paying out", settled: "Did not play", cancelled: "Cancelled" };

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
      <span className={styles.watermark}><img src="/brand/bounce-white.svg" alt="Bounce" width={65} height={16} /></span>
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
    <div className={styles.chartDates}><span>{new Date(points[0].at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span><span>{high === 0 && low === 0 ? "No settled PNL in this period" : "Settled PNL"}</span><span>Now</span></div>
    <span className={styles.srOnly} aria-live="polite">{selected && `${signed(selected.value, asset)} ${currency(asset)}`}</span>
  </section>;
}

function StatsSection({ stats, asset }: { stats: ProfileStats; asset: Asset }) {
  const { matches, runs, tournaments } = stats;
  const decided = matches.wins + matches.losses;
  const ratio = matches.losses ? (matches.wins / matches.losses).toFixed(2) : matches.wins ? `${matches.wins}.00` : "—";
  const pct = (n: number) => (matches.played ? `${(n / matches.played) * 100}%` : "0%");
  const streak = matches.streak > 0 ? `${matches.streak}W` : matches.streak < 0 ? `${-matches.streak}L` : "—";
  const whole = (n: number | null) => (n === null ? "—" : n.toLocaleString("en"));
  return <section className={styles.statsSection} aria-label="Player statistics">
    <div className={styles.sectionHeading}><div><h2>Performance breakdown</h2><p>A closer look at the finished games.</p></div><span className={styles.statsScope}>{asset === "gems" ? "Gems" : "Devnet SOL"} · finished games</span></div>
    <div className={styles.statsGrid}>
      <div className={`${styles.card} ${styles.statsCard}`}>
        <h3><Swords size={15} /> Matches</h3>
        <div className={styles.winRate}>
          <strong>{matches.winRate === null ? "—" : `${Math.round(matches.winRate * 100)}%`}</strong>
          <span>win rate · {matches.played.toLocaleString("en")} {matches.played === 1 ? "match" : "matches"}</span>
        </div>
        <div className={styles.recordBar} role="img" aria-label={`${matches.wins} wins, ${matches.draws} draws, ${matches.losses} losses`}>
          <span className={styles.barWin} style={{ width: pct(matches.wins) }} />
          <span className={styles.barDraw} style={{ width: pct(matches.draws) }} />
          <span className={styles.barLoss} style={{ width: pct(matches.losses) }} />
        </div>
        <div className={styles.statTiles}>
          <div><b className={styles.positive}>{matches.wins}</b><span>Wins</span></div>
          <div><b className={styles.negative}>{matches.losses}</b><span>Losses</span></div>
          <div><b>{matches.draws}</b><span>Draws</span></div>
          <div><Tooltip content={decided ? `${matches.wins} wins for ${matches.losses} losses` : undefined}><b>{ratio}</b></Tooltip><span>W/L ratio</span></div>
          <div><b className={matches.streak > 0 ? styles.positive : matches.streak < 0 ? styles.negative : ""}>{streak}</b><span>Current streak</span></div>
          <div><b>{matches.bestWinStreak}</b><span><Flame size={11} /> Best win streak</span></div>
        </div>
      </div>
      <div className={`${styles.card} ${styles.statsCard}`}>
        <h3><Crosshair size={15} /> Runs</h3>
        <div className={styles.winRate}>
          <strong className={styles.positive}>{runs.bestScore.toLocaleString("en")}</strong>
          <span>best score · {runs.played.toLocaleString("en")} {runs.played === 1 ? "run" : "runs"}</span>
        </div>
        <div className={styles.statTiles}>
          <div><b>{whole(runs.averageScore)}</b><span>Average score</span></div>
          <div><b>{runs.bestRound ? runs.bestRound : "—"}</b><span>Best round</span></div>
          <div><b>{runs.clears.toLocaleString("en")}</b><span>Boards cleared</span></div>
        </div>
      </div>
      <div className={`${styles.card} ${styles.statsCard}`}>
        <h3><Medal size={15} /> Tournaments</h3>
        <div className={styles.winRate}>
          <strong>{tournaments.bestRank ? ordinal(tournaments.bestRank) : "—"}</strong>
          <span>best finish · {tournaments.played.toLocaleString("en")} played</span>
        </div>
        <div className={styles.statTiles}>
          <div><b className={tournaments.wins ? styles.positive : ""}>{tournaments.wins}</b><span>Wins</span></div>
          <div><b>{tournaments.podiums}</b><span>Podiums</span></div>
          <div><b>{tournaments.played ? `${Math.round((tournaments.podiums / tournaments.played) * 100)}%` : "—"}</b><span>Podium rate</span></div>
        </div>
      </div>
    </div>
  </section>;
}

function MatchRows({ performance, asset }: { performance: ProfilePerformance; asset: Asset }) {
  const [filter, setFilter] = useState<"open" | "settled">("settled");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("recent");
  const [limit, setLimit] = useState(ENTRY_BATCH);
  const matches = performance.history.filter((match) => (filter === "settled" ? !!match.settled : !match.settled) && `${match.tournament ? `tournament ${match.tournament.name}` : match.opponent ?? "open seat"} ${match.id} ${match.result ?? "open"}`.toLowerCase().includes(search.toLowerCase().trim()))
    .sort((a, b) => sort === "pnl" ? b.net - a.net : sort === "stake" ? b.stake - a.stake : b.created - a.created);
  const status = (match: ProfileMatch) => {
    const t = match.tournament;
    if (t) return t.status === "settled" && t.rank ? `${ordinal(t.rank)} of ${t.players}` : TOURNAMENT_STATUS[t.status];
    return match.result ? RESULTS[match.result] : match.opponent ? "In progress" : "Seat open";
  };
  const won = (match: ProfileMatch) => match.tournament ? match.settled && match.net > 0 : match.result === "win";
  const lost = (match: ProfileMatch) => match.tournament ? match.tournament.status === "settled" && match.net < 0 : match.result === "loss";
  return <section className={styles.historySection} aria-label="Player match history">
    <div className={styles.sectionHeading}><div><h2><History size={18} />Match history</h2><p>The wins, the lessons, and the close calls.</p></div><span className={styles.statsScope}>{matches.length} {matches.length === 1 ? "result" : "results"}</span></div>
    <div className={styles.toolbar}>
      <div className={styles.filters} role="group" aria-label="Match status"><button aria-pressed={filter === "open"} onClick={() => { setFilter("open"); setLimit(ENTRY_BATCH); }}>Open</button><button aria-pressed={filter === "settled"} onClick={() => { setFilter("settled"); setLimit(ENTRY_BATCH); }}>Settled</button></div>
      <label className={styles.search}><Search size={18} /><input value={search} onChange={(event) => { setSearch(event.target.value); setLimit(ENTRY_BATCH); }} placeholder="Search matches, players or tournaments" aria-label="Search match history" /></label>
      <div className={styles.sort}><ArrowDownUp size={15} /><Select label="Sort match history" value={sort} onValueChange={(value) => { setSort(value); setLimit(ENTRY_BATCH); }} options={[{ value: "recent", label: "Recent" }, { value: "pnl", label: "Profit / Loss" }, { value: "stake", label: "Entry value" }]} /></div>
    </div>
    <div className={styles.tableScroll}>
      <table className={styles.table}>
        <thead><tr><th>Match</th><th>Entry</th><th>Result</th><th>Profit / Loss</th></tr></thead>
        <tbody>{matches.slice(0, limit).map((match) => <tr key={match.id}>
          <td><div className={styles.matchIdentity}>
            {match.opponent ? <Avatar name={match.opponent} src={match.opponentAvatar} size={40} /> : <span className={styles.matchIcon}>{match.tournament ? <Medal size={22} /> : <Zap size={22} />}</span>}
            <div><div className={styles.matchName}>{match.tournament ? <Link href={`/tournaments/${match.id}`}>{match.tournament.name}</Link> : match.opponent ? <>vs <Link href={`/players/${encodeURIComponent(match.opponent)}`}>{match.opponent}</Link></> : "Open challenge"}</div>
              <span className={styles.matchSub}>{match.tournament ? "Tournament" : `#${shortId(match.id)}`} <span>·</span> {new Date(match.created).toLocaleDateString(undefined, { month: "short", day: "numeric" })}{match.watchId && <> <span>·</span> <Link className={styles.watchLink} href={`/watch/${match.watchId}`}><Eye size={12} /> Watch</Link></>}</span></div>
          </div></td>
          <td data-label="Entry"><span>{match.stake ? <>{number(match.stake, asset)} <small>{currency(asset)}</small></> : "Free"}</span></td>
          <td data-label="Result"><span className={`${styles.status} ${won(match) ? styles.won : lost(match) ? styles.lost : ""}`}>{status(match)}</span></td>
          <td data-label="Profit / Loss"><div><strong className={match.net > 0 ? styles.positive : match.net < 0 ? styles.negative : ""}>{match.settled ? `${signed(match.net, asset)} ${currency(asset)}` : "—"}</strong><span className={styles.return}>{!match.settled ? (match.stake ? "Entry committed" : "Free entry") : match.stake ? `${match.net > 0 ? "+" : ""}${Math.round(match.net / match.stake * 100)}% return` : "Free entry"}</span></div></td>
        </tr>)}</tbody>
      </table>
    </div>
    {!matches.length && <div className={styles.empty}><History size={28} /><h3>{search ? "No matching games" : filter === "open" ? "No open matches" : "No settled matches yet"}</h3><p>{search ? "Try another player, tournament or match ID." : "Every angle counts. Your matches and tournaments will appear here."}</p></div>}
    <ShowMore shown={Math.min(limit, matches.length)} total={matches.length} onShowMore={() => setLimit((current) => current + ENTRY_BATCH)} label="matches" />
    <p className={styles.historyNote}>Latest {performance.history.length} of {performance.played} matches and tournaments · PNL chart includes all settled history. Tips and wallet transfers are excluded.</p>
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
    const load = () => request<{ profile: PublicPlayerProfile; performance: ProfilePerformance }>(`/api/players/${encodeURIComponent(name)}/dashboard?asset=${asset}`)
      .then(({ profile, performance }) => { if (active) { setData({ name, asset, profile, performance }); setError(""); } }, (e: Error) => { if (active) setError(e.message); });
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
    {profile && <header className={styles.hero}>
      <div className={styles.heroContent}>
        <div className={styles.eyebrow}><UserRound size={15} />{own ? "YOUR PLAYER PROFILE" : "PLAYER PROFILE"}</div>
        <div className={styles.identity}>
          <div className={styles.avatar}><Avatar name={profile.name} src={own ? player.data.player?.avatar : profile.avatar} size={88} /></div>
          <div className={styles.nameBlock}><h1>{profile.name}</h1><p>In the arena since {new Date(profile.created).toLocaleDateString(undefined, { month: "short", year: "numeric" })}</p></div>
        </div>
        <p className={styles.heroDescription}>{own ? "Your best runs, closest matches, and next milestone." : "The runs, results, and ranks behind the player."}</p>
        <div className={styles.profileActions}>
          {own ? <><button className={styles.editButton} onClick={onEdit}><Settings2 size={15} />Edit profile</button><Link href={`/players/${encodeURIComponent(profile.name)}`}>Public profile <ArrowUpRight size={14} /></Link></> : profile.isYou ? <Link className={styles.editButton} href="/profile"><Settings2 size={15} />Manage profile</Link> : <TipButton profile={profile} player={player} />}
          <button className={styles.shareButton} aria-label="Copy public profile link" onClick={async () => {
            try { await navigator.clipboard.writeText(`${window.location.origin}/players/${encodeURIComponent(profile.name)}`); setShared(true); setShareError(""); }
            catch { setShareError("Could not copy the link. Open the public profile to copy its address."); }
          }}>{shared ? <Check size={15} /> : <Share2 size={15} />}{shared ? "Link copied" : "Share profile"}</button>
          <span className={styles.srOnly} role="status">{shared ? "Public profile link copied" : ""}</span>
        </div>
      </div>
      <div className={styles.rankShowcase}>
        <div className={styles.rankArt} aria-hidden="true"><div className={styles.rankRing} /><RankEmblem tier={profile.level.tier} division={profile.level.division} size={110} /></div>
        <div className={styles.rankCaption}>EVERY RUN. A LITTLE HIGHER.</div>
        <div className={styles.rankProgress}><RankProgress level={profile.level} own={!!profile.isYou} /></div>
      </div>
    </header>}
    <div className={styles.assetBar}>
      <div className={styles.assetTabs} role="group" aria-label="Profile currency"><button aria-pressed={asset === "devnet"} onClick={() => player.setAsset("devnet")}><Zap size={17} /> Devnet SOL</button><button aria-pressed={asset === "gems"} onClick={() => player.setAsset("gems")}><Gem size={17} /> Gems</button></div>
      <Link className={styles.back} href={privateView ? "/wallet" : "/leaderboard"}>{privateView ? <Wallet size={15} /> : <ArrowLeft size={15} />}{privateView ? "My wallet" : "Leaderboard"}</Link>
    </div>
    {error && <div className={styles.error} role="alert"><span>{error}</span><button onClick={() => setRetry((value) => value + 1)}>Retry</button></div>}
    {shareError && <p className="error" role="alert">{shareError}</p>}
    {!profile || !performance ? <div className={styles.empty} aria-busy={!error}><UserRound size={30} /><h1>{error ? "Profile unavailable" : "Loading player profile…"}</h1><p>{error ? "Try again to load this player's profile." : "Getting the latest runs, results, and rank."}</p></div> : <>
      <div className={styles.summary}>
        <PnlCard key={asset} performance={performance} asset={asset} />
        <section className={`${styles.card} ${styles.overviewCard}`} aria-label="Player summary">
          <div className={styles.overviewHeading}><h2><Crosshair size={16} />At a glance</h2><span>{asset === "gems" ? "GEMS" : "DEVNET SOL"}</span></div>
          <div className={styles.playerStats}>
            <div><span><Wallet size={16} />{own ? "Available balance" : "Open stakes"}</span><strong>{number(own ? available : performance.openEntries, asset)} <small>{currency(asset)}</small></strong></div>
            <div><span><Zap size={16} />Biggest win</span><strong>{number(performance.bestWin, asset)} <small>{currency(asset)}</small></strong></div>
            <div><span><Swords size={16} />Games played</span><strong>{performance.played.toLocaleString("en")}</strong></div>
          </div>
          <Link className={styles.overviewLink} href={own ? "/" : "/leaderboard"}>{own ? "Make your next run count" : "Explore the leaderboard"}<ArrowUpRight size={16} /></Link>
        </section>
      </div>
      <StatsSection stats={performance.stats} asset={asset} />
      <MatchRows key={`${name}:${asset}`} performance={performance} asset={asset} />
    </>}
  </section>;
}
