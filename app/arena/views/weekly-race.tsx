"use client";
import { Tooltip } from "@/components/ui/tooltip";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowUpRight, Clock, Eye, Flag, Gem, Info, RefreshCw, Trophy, Wallet } from "lucide-react";
import type { RacePrize, WeeklyRace } from "@/lib/api-types";
import { request } from "../api";
import { Avatar } from "../avatar";
import { amount, units } from "../format";
import styles from "./leaderboard.module.css";
import race from "./weekly-race.module.css";
import { Podium } from "./podium";

const PLACE_TITLES = ["1ST PLACE", "2ND PLACE", "3RD PLACE"];
// Keep the last race visible between visits.
let cached: WeeklyRace | null = null;
const profileHref = (name: string) => `/players/${encodeURIComponent(name)}`;

function countdown(ms: number) {
  if (ms <= 0) return "Ending now";
  const minutes = Math.floor(ms / 60_000);
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  return d ? `${d}d ${h}h ${String(m).padStart(2, "0")}m` : `${h}h ${String(m).padStart(2, "0")}m`;
}

const weekLabel = (start: number) => new Date(start).toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" });

export const prizeLabel = (p: RacePrize | undefined) =>
  p ? [p.sol ? `${amount(p.sol, "devnet")}` : "", p.gems ? `${units(p.gems, "gems")} gems` : ""].filter(Boolean).join(" + ") || "No prize" : "No prize";

export function WeeklyRaceBoard({ me }: { me: string | undefined }) {
  const [data, setData] = useState<WeeklyRace | null>(cached);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [reload, setReload] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let active = true;
    const load = () =>
      request<WeeklyRace>("/api/race").then(
        (next) => {
          cached = next;
          if (active) (setData(next), setError(""));
        },
        (e: Error) => active && setError(e.message),
      ).finally(() => active && setRefreshing(false));
    void load();
    const poll = setInterval(() => !document.hidden && void load(), 30_000);
    const clock = setInterval(() => setNow(Date.now()), 15_000);
    return () => {
      active = false;
      clearInterval(poll);
      clearInterval(clock);
    };
  }, [reload]);

  const ended = !!data && now >= data.weekEnd;
  useEffect(() => {
    // The week rolled over while the page was open: load the new one.
    if (!ended) return;
    const timer = setTimeout(() => setReload((n) => n + 1), 5_000);
    return () => clearTimeout(timer);
  }, [ended]);

  if (!data) {
    return error ? (
      <div className={styles.error} role="alert">
        <Info size={17} />
        <span>{error}</span>
        <button onClick={() => setReload((n) => n + 1)}>Try again</button>
      </div>
    ) : (
      <div className={styles.podiumSkeleton} role="status" aria-label="Loading the weekly race">
        <div />
        <div />
        <div />
        <span className={styles.srOnly}>Loading the weekly race…</span>
      </div>
    );
  }

  const mine = me ? data.standings.find((s) => s.name === me) : undefined;
  const top = data.standings.slice(0, 3);
  return (
    <>
      {error && (
        <div className={styles.error} role="alert">
          <Info size={17} />
          <span>Could not refresh. Showing the last available standings.</span>
          <button onClick={() => setReload((n) => n + 1)}>Try again</button>
        </div>
      )}
      <section className={race.banner} aria-label="This week's race">
        <div className={race.bannerText}>
          <div className={race.label}>
            <Flag size={14} /> WEEK OF {weekLabel(data.weekStart).toUpperCase()}
          </div>
          <h2>The weekly race</h2>
          <p>Your best single score of the week in SOL matches and paid SOL tournaments. The top 3 win SOL when the week closes, and every place on the board wins gems.</p>
        </div>
        <div className={race.clock}>
          <Clock size={16} />
          <div>
            <b>{countdown(data.weekEnd - now)}</b>
            <span>Ends Monday 00:00 UTC</span>
          </div>
        </div>
        <ol className={race.prizes}>
          {data.prizes.map((p, i) => (
            <li key={i} className={race[`prize${i + 1}`]}>
              <span>{PLACE_TITLES[i]}</span>
              {p.sol > 0 && (
                <b>
                  <Wallet size={14} /> {amount(p.sol, "devnet")}
                </b>
              )}
              {p.gems > 0 && (
                <b>
                  <Gem size={14} /> {units(p.gems, "gems")} gems
                </b>
              )}
              {!p.sol && !p.gems && <b>—</b>}
            </li>
          ))}
        </ol>
        {/* Below the podium the race pays in gems, so the other 47 places on
            the board are worth watching too. */}
        <ul className={race.tiers}>
          {data.tiers?.map((tier) => (
            <li key={tier.from}>
              <span>
                #{tier.from}–{tier.to}
              </span>
              <b>{units(tier.gems, "gems")} gems</b>
            </li>
          ))}
        </ul>
      </section>

      {top.length > 0 && (
        <Podium
          variant="leaderboard"
          label="Weekly race top three"
          titles={["LEADING THE RACE", "SECOND PLACE", "THIRD PLACE"]}
          entries={top.map((s, i) => ({
            name: s.name,
            avatar: s.avatar,
            href: profileHref(s.name),
            rank: s.rank,
            meta: `Prize: ${prizeLabel(data.prizes[i])}`,
            valueLabel: "BEST SCORE",
            value: s.score.toLocaleString("en"),
            unit: "pts",
            isYou: s.name === me,
          }))}
        />
      )}

      {mine && (
        <a className={styles.positionSummary} href="#race-title">
          <Trophy size={24} />
          <span><b>You’re #{mine.rank} this week</b><small>{mine.score.toLocaleString("en")} points · View the standings</small></span>
          <ArrowUpRight size={17} />
        </a>
      )}
      <div className={styles.contentGrid}>
        <section className={styles.standings} aria-labelledby="race-title">
          <div className={styles.standingsHeading}>
            <div>
              <h2 id="race-title">
                This week <span>{data.standings.length}</span>
              </h2>
              <p>One best score per player. An earlier score wins a tie.</p>
            </div>
            <button
              className={styles.refresh}
              aria-label="Refresh the race"
              disabled={refreshing}
              onClick={() => (setRefreshing(true), setReload((n) => n + 1))}
            >
              <RefreshCw size={16} className={refreshing ? styles.spinning : undefined} />
            </button>
          </div>
          {data.standings.length ? (
            <div className={styles.tableWrap}>
              <table className={`${styles.table} ${race.table}`}>
                <caption className={styles.srOnly}>Weekly race standings by best single score</caption>
                <thead>
                  <tr>
                    <th scope="col">Rank</th>
                    <th scope="col">Player</th>
                    <th scope="col">Best score</th>
                    <th scope="col" className={race.whenColumn}>
                      Set
                    </th>
                    <th scope="col" className={styles.arrowColumn}>
                      <span className={styles.srOnly}>Watch</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.standings.map((s) => (
                    <tr key={s.name} className={s.name === me ? styles.myRow : undefined}>
                      <td>
                        <span className={`${styles.rank} ${s.rank <= 3 ? styles[`rank${s.rank}`] : ""}`}>{s.rank === 1 ? <Trophy size={15} aria-label="First place" /> : String(s.rank).padStart(2, "0")}</span>
                      </td>
                      <td>
                        <Link href={profileHref(s.name)} className={styles.playerLink}>
                          <Avatar name={s.name} src={s.avatar} size={36} />
                          <span>
                            <b>
                              {s.name}
                              {s.name === me && <small className={styles.you}>YOU</small>}
                            </b>
                            {s.reward && <small className={race.prizeNote}>{prizeLabel(s.reward)}</small>}
                          </span>
                        </Link>
                      </td>
                      <td className={race.score}>{s.score.toLocaleString("en")}</td>
                      <td className={race.whenColumn}>{new Date(s.at).toLocaleDateString("en", { weekday: "short", hour: "2-digit", minute: "2-digit" })}</td>
                      <td className={styles.arrowColumn}>
                        {s.watchId && (
                          <Tooltip content="Replay this run"><Link href={`/watch/${s.watchId}`} aria-label={`Replay ${s.name}'s best run`}>
                            <Eye size={16} />
                          </Link></Tooltip>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className={styles.empty}>
              <Flag size={30} />
              <h3>No scores yet this week.</h3>
              <p>Play a SOL match or a paid SOL tournament. Your first finished run puts you on the board.</p>
              <Link className="btn btn-primary" href="/">
                Play a SOL match <ArrowUpRight size={16} />
              </Link>
            </div>
          )}
        </section>

        <aside className={styles.sidebar}>
          <section className={styles.personalCard}>
            <div className={styles.cardLabel}>
              <Flag size={15} />
              YOUR RACE
            </div>
            {mine ? (
              <>
                <div className={styles.myRank}>
                  #{mine.rank}
                  <span>
                    Best score {mine.score.toLocaleString("en")} · {mine.reward ? `on course for ${prizeLabel(mine.reward)}` : `${(data.standings[2].score - mine.score + 1).toLocaleString("en")} pts from the podium`}
                  </span>
                </div>
              </>
            ) : (
              <>
                <h2 style={{ marginTop: 18 }}>
                  Not on the
                  <br />
                  board yet.
                </h2>
                <p>{me ? "Finish a SOL match or a paid SOL tournament run this week to set your score." : "Sign in and play a SOL match to join this week's race."}</p>
              </>
            )}
            <Link href="/" className={`btn btn-primary ${styles.cardCta}`}>
              Set a new best <ArrowUpRight size={16} />
            </Link>
          </section>
          {data.previous && (
            <section className={race.lastWeek}>
              <div className={styles.cardLabel}>
                <Trophy size={15} />
                WEEK OF {weekLabel(data.previous.weekStart).toUpperCase()}
              </div>
              <ol>
                {data.previous.winners.map((w) => (
                  <li key={w.rank}>
                    <span className={race.place}>{w.rank}</span>
                    <Link href={profileHref(w.name)}>{w.name}</Link>
                    <span className={race.lastScore}>{w.score.toLocaleString("en")}</span>
                  </li>
                ))}
              </ol>
              <p>{data.previous.paid ? "Prizes paid." : "Final standings under review. Prizes are paid once confirmed."}</p>
            </section>
          )}
        </aside>
      </div>
    </>
  );
}
