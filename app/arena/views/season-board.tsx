"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowUpRight, Clock, Info, Medal, RefreshCw, Sparkles, Swords } from "lucide-react";
import type { PlayerRank, SeasonBoard } from "@/lib/api-types";
import { BOUNCER_FLOOR } from "@/lib/levels";
import { RANKED } from "@/lib/ranked-rules";
import { request } from "../api";
import { Avatar } from "../avatar";
import { RankBadge, RankProgress } from "../rank-badge";
import { BadgeChip } from "../badge-insignia";
import styles from "./leaderboard.module.css";
import race from "./weekly-race.module.css";
import season from "./season-board.module.css";
import { Podium } from "./podium";

// Keep the last table visible between visits.
let cached: SeasonBoard | null = null;
const profileHref = (name: string) => `/players/${encodeURIComponent(name)}`;
const count = (n: number) => n.toLocaleString("en");
const day = (at: number) => new Date(at).toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" });

function countdown(ms: number) {
  if (ms <= 0) return "Ending now";
  const hours = Math.floor(ms / 3_600_000);
  const d = Math.floor(hours / 24);
  return d ? `${d}d ${hours % 24}h` : `${hours}h ${Math.floor((ms % 3_600_000) / 60_000)}m`;
}

const record = (games: number, wins: number) => `${count(wins)}W · ${count(games - wins)}L`;

/**
 * The ranked season's table: the best fifty by RR, Bouncers first. The table
 * is the same for everyone; the player's own rank comes with their data, so
 * a player outside the fifty still sees where they stand.
 */
export function SeasonBoardView({ me, mine }: { me: string | undefined; mine: PlayerRank | undefined }) {
  const [data, setData] = useState<SeasonBoard | null>(cached);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [reload, setReload] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let active = true;
    request<SeasonBoard>("/api/ranked")
      .then(
        (next) => {
          cached = next;
          if (!active) return;
          setData(next);
          setError("");
        },
        (e: Error) => active && setError(e.message),
      )
      .finally(() => active && setRefreshing(false));
    const clock = setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      active = false;
      clearInterval(clock);
    };
  }, [reload]);

  if (!data) {
    return error ? (
      <div className={styles.error} role="alert">
        <Info size={17} />
        <span>{error}</span>
        <button onClick={() => setReload((n) => n + 1)}>Try again</button>
      </div>
    ) : (
      <div className={styles.podiumSkeleton} role="status" aria-label="Loading the ranked season">
        <div />
        <div />
        <div />
        <span className={styles.srOnly}>Loading the ranked season…</span>
      </div>
    );
  }

  const top = data.standings.slice(0, 3);
  const bouncers = data.standings.filter((s) => s.rank.tier === "bouncer").length;
  const listed = me ? data.standings.findIndex((s) => s.name === me) : -1;
  // The last of the fifty, the line a player outside it has to beat.
  const cut = data.standings.length >= RANKED.bouncers ? data.standings[data.standings.length - 1].rank.rating : null;
  return (
    <>
      {error && (
        <div className={styles.error} role="alert">
          <Info size={17} />
          <span>Could not refresh. Showing the last available standings.</span>
          <button onClick={() => setReload((n) => n + 1)}>Try again</button>
        </div>
      )}
      <section className={race.banner} aria-label="This ranked season">
        <div className={race.bannerText}>
          <div className={race.label}>
            <Medal size={14} /> SEASON {data.season} · {day(data.startsAt).toUpperCase()} – {day(data.endsAt - 1).toUpperCase()}
          </div>
          <h2>The ranked season</h2>
          <p>
            Every public SOL match moves your RR. The {RANKED.bouncers} best players of the season at {count(BOUNCER_FLOOR)} RR or more wear the Bouncer insignia,
            numbered by their place.
          </p>
        </div>
        <div className={race.clock}>
          <Clock size={16} />
          <div>
            <b>{countdown(data.endsAt - now)}</b>
            <span>Season ends {day(data.endsAt)}, 00:00 UTC</span>
          </div>
        </div>
        <ul className={race.tiers}>
          <li>
            <span>Bouncers</span>
            <b className={season.bouncerCount}>
              {bouncers} / {RANKED.bouncers}
            </b>
          </li>
          {cut !== null && (
            <li>
              <span>Top {RANKED.bouncers} from</span>
              <b className={season.rr}>{count(cut)} RR</b>
            </li>
          )}
          <li>
            <span>Seasons last</span>
            <b className={season.rr}>{Math.round(RANKED.seasonMs / (7 * 86_400_000))} weeks</b>
          </li>
        </ul>
      </section>

      {top.length > 0 && (
        <Podium
          variant="leaderboard"
          label="Top three of the season"
          titles={["TOP OF THE SEASON", "SECOND PLACE", "THIRD PLACE"]}
          entries={top.map((s, i) => ({
            name: s.name,
            avatar: s.avatar,
            ranked: s.rank,
            href: profileHref(s.name),
            rank: i + 1,
            meta: `${count(s.games)} ranked ${s.games === 1 ? "game" : "games"} · ${record(s.games, s.wins)}`,
            valueLabel: "RATING",
            value: count(s.rank.rating),
            unit: "RR",
            isYou: s.name === me,
          }))}
        />
      )}

      {listed >= 0 && (
        <a className={styles.positionSummary} href="#season-title">
          <Medal size={24} />
          <span>
            <b>You’re #{listed + 1} this season</b>
            <small>{count(data.standings[listed].rank.rating)} RR · View the standings</small>
          </span>
          <ArrowUpRight size={17} />
        </a>
      )}
      <div className={styles.contentGrid}>
        <section className={styles.standings} aria-labelledby="season-title">
          <div className={styles.standingsHeading}>
            <div>
              <h2 id="season-title">
                Season {data.season} <span>{data.standings.length}</span>
              </h2>
              <p>Placed players by RR. An earlier rating wins a tie.</p>
            </div>
            <button className={styles.refresh} aria-label="Refresh the season" disabled={refreshing} onClick={() => (setRefreshing(true), setReload((n) => n + 1))}>
              <RefreshCw size={16} className={refreshing ? styles.spinning : undefined} />
            </button>
          </div>
          {data.standings.length ? (
            <div className={styles.tableWrap}>
              <table className={`${styles.table} ${season.table}`}>
                <caption className={styles.srOnly}>Ranked season standings by rating</caption>
                <thead>
                  <tr>
                    <th scope="col">Rank</th>
                    <th scope="col">Player</th>
                    <th scope="col" className={styles.matchesColumn}>
                      Record
                    </th>
                    <th scope="col">RR</th>
                    <th scope="col" className={styles.arrowColumn}>
                      <span className={styles.srOnly}>Profile</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.standings.map((s, i) => (
                    <tr key={s.name} className={s.name === me ? styles.myRow : undefined}>
                      <td>
                        <span className={`${styles.rank} ${i < 3 ? styles[`rank${i + 1}`] : ""}`}>{String(i + 1).padStart(2, "0")}</span>
                      </td>
                      <td>
                        <Link href={profileHref(s.name)} className={styles.playerLink}>
                          <Avatar name={s.name} src={s.avatar} size={36} />
                          <span>
                            <b>
                              {s.name}
                              <RankBadge rank={s.rank} />
                              {s.badges?.map((badge) => <BadgeChip key={badge} badge={badge} compact />)}
                              {s.name === me && <small className={styles.you}>YOU</small>}
                            </b>
                            <small className={styles.mobileMatches}>{record(s.games, s.wins)}</small>
                          </span>
                        </Link>
                      </td>
                      <td className={`${styles.matchesColumn} ${season.record}`}>{record(s.games, s.wins)}</td>
                      <td className={season.rating}>{count(s.rank.rating)}</td>
                      <td className={styles.arrowColumn}>
                        <Link href={profileHref(s.name)} aria-label={`View ${s.name}'s profile`}>
                          <ArrowUpRight size={16} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className={styles.empty}>
              <Medal size={30} />
              <h3>Nobody is placed yet.</h3>
              <p>Play your {RANKED.placements} placement matches in SOL and your rank shows here, with everyone else&apos;s.</p>
              <Link className="btn btn-primary" href="/">
                Play a ranked match <ArrowUpRight size={16} />
              </Link>
            </div>
          )}
        </section>

        <aside className={styles.sidebar}>
          <section className={styles.personalCard}>
            <div className={styles.cardLabel}>
              <Swords size={15} />
              YOUR SEASON
            </div>
            {mine ? (
              <>
                <div className={season.mine}>
                  <RankProgress rank={mine} />
                </div>
                <div className={styles.myRank}>
                  {listed >= 0 ? `#${listed + 1}` : mine.placed ? count(mine.rating) : mine.placementsLeft}
                  <span>
                    {listed >= 0
                      ? `of the top ${RANKED.bouncers} this season`
                      : mine.placed
                        ? cut !== null
                          ? `RR · ${count(Math.max(1, cut - mine.rating + 1))} RR from the top ${RANKED.bouncers}`
                          : `RR this season`
                        : `placement ${mine.placementsLeft === 1 ? "match" : "matches"} to go`}
                  </span>
                </div>
              </>
            ) : (
              <>
                <h2 style={{ marginTop: 18 }}>
                  Earn your
                  <br />
                  insignia.
                </h2>
                <p>Sign in and play SOL matches: your first {RANKED.placements} place you on the ladder.</p>
              </>
            )}
            <Link href="/" className={`btn btn-primary ${styles.cardCta}`}>
              Play a ranked match <ArrowUpRight size={16} />
            </Link>
          </section>
          <section className={styles.explainer}>
            <div className={styles.cardLabel}>
              <Sparkles size={15} />
              HOW RANKED WORKS
            </div>
            <h3>RR is the score.</h3>
            <p>Win and you gain RR, lose and you drop it. Beating a higher rank pays more; losing to a lower one costs more.</p>
            <ul>
              <li>A rout moves up to half as much again</li>
              <li>{RANKED.shield} losses of shield after a promotion</li>
              <li>Gems, challenges and tournaments don&apos;t count</li>
            </ul>
            <Link href="/rules#ranked">How ranked play works <ArrowUpRight size={14} /></Link>
          </section>
        </aside>
      </div>
    </>
  );
}
