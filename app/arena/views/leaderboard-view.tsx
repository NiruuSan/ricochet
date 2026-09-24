"use client";
import { Tooltip } from "@/components/ui/tooltip";

import { Form } from "@/components/ui/form";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowRight, ArrowUpRight, ChevronLeft, ChevronRight, Crown, Flag, Gem, Info, RefreshCw, Search, Sparkles, Swords, Trophy, Wallet, X } from "lucide-react";
import { RankBadge } from "../rank-badge";
import { Avatar } from "../avatar";
import type { Asset, Leader } from "@/lib/api-types";
import { request } from "../api";
import { assetName, currency, signedAmount } from "../format";
import type { PlayerState } from "../arena";
import styles from "./leaderboard.module.css";
import { Podium } from "./podium";
import { WeeklyRaceBoard } from "./weekly-race";

type Board = Omit<Leader, "is_you">;
type CachedBoard = { rows: Board[]; updated: number };
// Keep the last standings visible between visits and currency changes.
const boards: Partial<Record<Asset, CachedBoard>> = {};
const PAGE_SIZE = 10;
const profileHref = (name: string) => `/players/${encodeURIComponent(name)}`;
const count = (n: number) => n.toLocaleString("en");
const noSubscription = () => () => {};

export function LeaderboardView({ player }: { player: PlayerState }) {
  const { data, asset, setAsset } = player;
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [leaders, setLeaders] = useState<Partial<Record<Asset, CachedBoard>>>(() => ({ ...boards }));
  const [errors, setErrors] = useState<Partial<Record<Asset, string>>>({});
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  // "race" shows the weekly race; race notifications link to it as ?board=race.
  const raceLink = useSyncExternalStore(noSubscription, () => new URLSearchParams(window.location.search).get("board") === "race", () => false);
  const [chosenBoard, setBoard] = useState<"profit" | "race" | null>(null);
  const boardMode = chosenBoard ?? (raceLink ? "race" : "profit");

  useEffect(() => {
    let active = true;
    const load = (which: Asset) => request<Board[]>(`/api/leaderboard?asset=${which}`).then(
      (rows) => {
        const next = { rows, updated: Date.now() };
        boards[which] = next;
        if (active) {
          setLeaders((current) => ({ ...current, [which]: next }));
          setErrors((current) => ({ ...current, [which]: "" }));
        }
      },
      (e: Error) => { if (active) setErrors((current) => ({ ...current, [which]: e.message })); },
    ).finally(() => { if (active && which === asset) setRefreshing(false); });
    void load(asset);
    const other = asset === "gems" ? "devnet" : "gems";
    if (!boards[other]) void load(other);
    return () => { active = false; };
  }, [asset, refreshKey]);

  const board = leaders[asset];
  const rows = board?.rows;
  const error = errors[asset];
  const me = data.player?.name;
  const myIndex = me ? rows?.findIndex((p) => p.name === me) ?? -1 : -1;
  const mine = myIndex >= 0 ? rows?.[myIndex] : undefined;
  const query = search.trim().toLowerCase();
  const filtered = rows?.map((p, i) => ({ ...p, rank: i + 1 })).filter((p) => p.name.toLowerCase().includes(query)) ?? [];
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  const visible = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const validProfileName = /^[a-zA-Z0-9_]{3,20}$/.test(search.trim());
  const refresh = () => { setRefreshing(true); setRefreshKey((n) => n + 1); };

  return <section className={styles.page}>
    <header className={styles.hero}>
      <div>
        <div className={styles.eyebrow}><span />THE LEADERBOARD</div>
        <h1>Make your mark.<br /><span>Climb the ranks.</span></h1>
        <p>Good angles get noticed. Great players keep climbing.<br />Meet the names setting the pace in the arena.</p>
        <Link href="/" className={styles.heroLink}>Your next match could move you up <ArrowUpRight size={15} /></Link>
      </div>
      <div className={styles.heroArt} aria-hidden="true">
        <div className={styles.heroRing} />
        <div className={styles.emblem}>
          <div className={styles.ribbons}><span /><span /></div>
          <div className={styles.medal}><Crown strokeWidth={1.4} /><strong>01</strong></div>
        </div>
        <span className={styles.artCaption}>EVERY PLACE IS EARNED</span>
      </div>
    </header>

    <div className={styles.boardBar}>
      <div className={styles.currencyTabs} role="group" aria-label="Leaderboard view">
        {(["devnet", "gems"] as const).map((which) => <button key={which} aria-pressed={boardMode === "profit" && asset === which} onClick={() => { setAsset(which); setBoard("profit"); setPage(0); }}>
          {which === "devnet" ? <Wallet size={16} /> : <Gem size={16} />}{assetName(which)}
        </button>)}
        <button aria-pressed={boardMode === "race"} onClick={() => setBoard("race")}><Flag size={16} />Weekly race</button>
      </div>
      <div className={styles.boardScope}><span>{boardMode === "race" ? "THIS WEEK" : "ALL TIME"}</span><span>TOP 50</span></div>
    </div>

    {boardMode === "race" ? <WeeklyRaceBoard me={me} /> : <>

    {error && <div className={styles.error} role="alert"><Info size={17} /><span>{rows ? "Could not refresh. Showing the last available standings." : error}</span><button onClick={refresh} disabled={refreshing}>Try again</button></div>}
    {rows?.length ? (
      <section aria-labelledby="leaders-title">
        <div className={styles.leadersHeading}><h2 id="leaders-title">Leading the way</h2><span>All-time net profit · {assetName(asset)}</span></div>
        <Podium variant="leaderboard" entries={rows.slice(0, 3).map((p, i) => ({ name: p.name, avatar: p.avatar, href: profileHref(p.name), rank: i + 1, meta: `${count(p.games)} settled ${p.games === 1 ? "game" : "games"}`, valueLabel: "NET PROFIT", value: signedAmount(p.pnl, asset), unit: currency(asset), negative: p.pnl < 0, isYou: p.name === me }))} />
      </section>
    ) : !rows && !error ? <div className={styles.podiumSkeleton} role="status" aria-label="Loading leaderboard"><div /><div /><div /><span className={styles.srOnly}>Loading leaderboard…</span></div> : null}

    {mine && (
      <a className={styles.positionSummary} href="#standings" onClick={() => { setSearch(""); setPage(Math.floor(myIndex / PAGE_SIZE)); }}>
        <Avatar name={mine.name} src={mine.avatar} size={36} />
        <span><b>You’re #{myIndex + 1}</b><small>{signedAmount(mine.pnl, asset)} {currency(asset)} net profit · Find your position</small></span>
        <ArrowRight size={17} />
      </a>
    )}
    <div className={styles.contentGrid}>
      <section className={styles.standings} id="standings" aria-labelledby="standings-title">
        <div className={styles.standingsHeading}>
          <div><h2 id="standings-title">The full standings <span>{rows ? count(rows.length) : "—"}</span></h2><p>Ranked by net profit from settled matches and tournaments.</p></div>
          <button className={styles.refresh} aria-label="Refresh standings" disabled={refreshing} onClick={refresh}><RefreshCw size={16} className={refreshing ? styles.spinning : undefined} /></button>
        </div>
        <Form className={styles.search} onSubmit={(event) => { event.preventDefault(); if (validProfileName) router.push(profileHref(search.trim())); }}>
          <Search size={17} aria-hidden />
          <input aria-label="Find a player" placeholder="Find a player…" value={search} maxLength={20} onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
          {search && <button type="button" aria-label="Clear search" onClick={() => { setSearch(""); setPage(0); }}><X size={15} /></button>}
          <Tooltip content="Open a profile by its exact public name"><button className={styles.profileSearch} disabled={!validProfileName}>View profile <ArrowUpRight size={14} /></button></Tooltip>
        </Form>

        {rows && rows.length > 0 && filtered.length > 0 ? <>
          <div className={styles.tableWrap}><table className={styles.table}>
            <caption className={styles.srOnly}>All-time {currency(asset)} standings ranked by net profit from settled matches and tournaments</caption>
            <thead><tr><th scope="col">Rank</th><th scope="col">Player</th><th scope="col" className={styles.matchesColumn}>Games</th><th scope="col">Net profit <ArrowDown size={12} aria-hidden /></th><th scope="col" className={styles.arrowColumn}><span className={styles.srOnly}>Profile</span></th></tr></thead>
            <tbody>{visible.map((p) => <tr key={p.name} className={p.name === me ? styles.myRow : undefined}>
              <td><span className={`${styles.rank} ${p.rank <= 3 ? styles[`rank${p.rank}`] : ""}`}>{p.rank === 1 ? <Crown size={16} aria-label="First place" /> : String(p.rank).padStart(2, "0")}</span></td>
              <td><Link href={profileHref(p.name)} className={styles.playerLink}><Avatar name={p.name} src={p.avatar} size={36} /><span><b>{p.name}{p.level && <RankBadge level={p.level} />}{p.name === me && <small className={styles.you}>YOU</small>}</b><small className={styles.mobileMatches}>{count(p.games)} {p.games === 1 ? "game" : "games"}</small></span></Link></td>
              <td className={styles.matchesColumn}>{count(p.games)}</td>
              <td className={styles.profit}><strong className={p.pnl > 0 ? styles.positive : p.pnl < 0 ? styles.negative : styles.neutral}>{signedAmount(p.pnl, asset)}</strong><span>{currency(asset)}</span></td>
              <td className={styles.arrowColumn}><Link href={profileHref(p.name)} aria-label={`View ${p.name}'s profile`}><ArrowUpRight size={16} /></Link></td>
            </tr>)}</tbody>
          </table></div>
          <div className={styles.tableFooter}><span aria-live="polite">{currentPage * PAGE_SIZE + 1}–{Math.min((currentPage + 1) * PAGE_SIZE, filtered.length)} of {filtered.length} players</span>
            {pages > 1 && <nav className={styles.pagination} aria-label="Standings pages"><button aria-label="Previous page" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={16} /></button><span>{currentPage + 1} / {pages}</span><button aria-label="Next page" disabled={currentPage === pages - 1} onClick={() => setPage(currentPage + 1)}><ChevronRight size={16} /></button></nav>}
          </div>
        </> : !rows && !error ? <div className={styles.loadingRows} role="status"><span className={styles.srOnly}>Loading standings…</span>{[0, 1, 2, 3, 4].map((n) => <div key={n}><i /><span /><b /></div>)}</div> : <div className={styles.empty}>
          {query && rows?.length ? <Search size={28} /> : <Trophy size={32} />}
          <h3>{!rows && error ? "A short timeout." : query && rows?.length ? "No players found." : "The first spot could be yours."}</h3>
          <p>{!rows && error ? "The standings are unavailable right now. Try refreshing in a moment." : query && rows?.length ? "Try another name, or open their profile directly. This board shows the top 50 players." : "Finish a 1v1 match to join the standings. Every climb starts with one good shot."}</p>
          {query && rows?.length ? <button className="btn" onClick={() => { setSearch(""); setPage(0); }}>Clear search</button> : !error && <Link href="/" className="btn btn-primary">Enter the arena <ArrowRight /></Link>}
        </div>}
        {board && <div className={styles.updated}>Updated {new Date(board.updated).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}<span>·</span>Settled matches and tournaments</div>}
      </section>

      <aside className={styles.sidebar}>
        <section className={styles.personalCard}>
          <div className={styles.cardLabel}><Swords size={15} />{mine ? "YOUR POSITION" : "YOUR NEXT MOVE"}</div>
          {mine ? <>
            <div className={styles.myIdentity}><Avatar name={mine.name} src={mine.avatar} size={42} /><div><b>{mine.name}</b><span>{mine.level ? `${mine.level.name} · ${mine.level.xp.toLocaleString("en")} XP` : "Your place in the pack"}</span></div></div>
            <div className={styles.myRank}>#{myIndex + 1}<span>of {rows!.length} ranked players</span></div>
            <div className={styles.myProfit}><span>Net profit</span><b className={mine.pnl < 0 ? styles.negative : styles.positive}>{signedAmount(mine.pnl, asset)} {currency(asset)}</b></div>
            <a className={styles.positionLink} href="#standings" onClick={() => { setSearch(""); setPage(Math.floor(myIndex / PAGE_SIZE)); }}>Find my position <ArrowRight size={15} /></a>
          </> : <>
            <div className={styles.orbit} aria-hidden><span /><Trophy size={30} /><span /></div>
            <h2>Aim for your<br />name up here.</h2>
            <p>{!rows ? "One good angle can change the game. Your next match is waiting." : me ? `Build your net profit in ${asset === "gems" ? "gem" : "devnet SOL"} matches to reach the top 50.` : "Find your angle, challenge a player, and start your climb."}</p>
          </>}
          <Link href="/" className={`btn btn-primary ${styles.cardCta}`}>Play a match <ArrowUpRight size={16} /></Link>
        </section>
        <section className={styles.explainer}>
          <div className={styles.cardLabel}><Sparkles size={15} />HOW THE RANKS WORK</div>
          <h3>Profit is the score.</h3><p>Your match payouts minus your entries. The higher your net profit, the higher you climb.</p>
          <ul><li>All-time results, top 50 players</li><li>Settled 1v1 matches and tournaments count</li><li>Separate boards for SOL and gems</li></ul>
          <Link href="/rules">Get to know the game <ArrowUpRight size={14} /></Link>
        </section>
      </aside>
    </div>
    </>}
    <p className={styles.footnote}><Info size={13} />{boardMode === "race" || asset === "devnet" ? "Devnet SOL is test currency with no monetary value." : "Gems are free in-game currency with no monetary value."}</p>
  </section>;
}
