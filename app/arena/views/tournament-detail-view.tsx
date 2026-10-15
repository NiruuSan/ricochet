"use client";
import { RankBadge, RankEmblem, RankLimitTag } from "../rank-badge";
import { rankBlock, rankLimitLabel } from "@/lib/rank-limits";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Eye, Lock, Play, Search, Trophy } from "lucide-react";
import type { TournamentDetail, TournamentStanding } from "@/lib/api-types";
import { RANK_TIERS, rankName } from "@/lib/levels";
import type { RankLook } from "../rank-art";
import { request } from "../api";
import { Avatar } from "../avatar";
import { amount, assetName } from "../format";
import type { PlayerState } from "../arena";
import { duration, entryLabel, headlinePot, ordinal, PAYOUT_LABELS, STATUS_LABELS } from "../tournament-format";
import { Podium } from "./podium";
import styles from "./tournament-detail.module.css";

const REFRESH_MS = 10_000;
/** Players shown before "Show all", in the field before the start. */
const FIELD_PREVIEW = 24;
/** Rows of standings shown at a time once runs are being played. */
const STANDINGS_PAGE = 25;
/** Past this many players a list gets a search box. */
const SEARCHABLE = 12;

/** A search box for a long list of players. */
function FindPlayer({ value, onChange, count }: { value: string; onChange: (value: string) => void; count: number }) {
  return (
    <label className={styles.find}>
      <Search size={15} aria-hidden />
      <input className="input" type="search" placeholder={`Find a player among ${count}…`} value={value} onChange={(e) => onChange(e.target.value)} aria-label="Find a player" />
    </label>
  );
}

const matching = (list: TournamentStanding[], query: string) => {
  const q = query.trim().toLowerCase();
  return q ? list.filter((s) => s.name.toLowerCase().includes(q)) : list;
};

/**
 * Who is in, before a single run is played. With a field of hundreds a wall of
 * names says nothing, so it opens on what a player deciding whether to enter
 * wants to know — how many, and how strong — and then the names: you first,
 * the strongest next, a few rows of them until asked for all.
 */
function TheField({ t }: { t: TournamentDetail }) {
  const [query, setQuery] = useState("");
  const [all, setAll] = useState(false);
  // The server sends the first two hundred; your own entry comes with it wherever it is.
  const standings = useMemo(
    () => (t.yourStanding && !t.standings.some((s) => s.isYou) ? [t.yourStanding, ...t.standings] : t.standings),
    [t.standings, t.yourStanding],
  );
  const total = Math.max(t.entrants, standings.length);
  const sorted = useMemo(
    () => [...standings].sort((a, b) => Number(b.isYou) - Number(a.isYou) || b.ranked.rating - a.ranked.rating || a.name.localeCompare(b.name)),
    [standings],
  );
  const strongest = useMemo(() => [...standings].sort((a, b) => Number(b.ranked.placed) - Number(a.ranked.placed) || b.ranked.rating - a.ranked.rating), [standings]);
  const tiers = useMemo(
    () =>
      ([...RANK_TIERS].reverse() as RankLook[])
        .concat("unranked")
        .map((tier) => ({ tier, count: standings.filter((s) => s.ranked.tier === tier).length }))
        .filter((t) => t.count),
    [standings],
  );
  const matches = matching(sorted, query);
  const searching = !!query.trim();
  const shown = searching || all ? matches : matches.slice(0, FIELD_PREVIEW);
  const faces = strongest.slice(0, 6);

  return (
    <>
      <div className={styles.fieldSummary}>
        <div className={styles.faces}>
          <div className={styles.stack} aria-hidden>
            {faces.map((s) => (
              <Avatar key={s.name} name={s.name} src={s.avatar} size={30} />
            ))}
          </div>
          <span>
            <span>
              <b>{total}</b> {total === 1 ? "player" : "players"} in
            </span>
            {strongest[0] && (
              <small>
                Strongest: {strongest[0].name}, {strongest[0].ranked.name}
              </small>
            )}
          </span>
        </div>
        <div className={styles.strength}>
          <small>Field by rank</small>
          <ul>
            {tiers.map(({ tier, count }) => (
              <li key={tier} title={`${count} ${tier === "unranked" ? "unranked" : rankName(tier, null)}`}>
                <RankEmblem tier={tier} division={null} size={18} />
                <b>{count}</b> {tier === "unranked" ? "Unranked" : rankName(tier, null)}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {standings.length > SEARCHABLE && <FindPlayer value={query} onChange={setQuery} count={total} />}

      {shown.length ? (
        <ul className={styles.field}>
          {shown.map((s) => (
            <li key={s.name} className={s.isYou ? styles.mine : ""}>
              <Link href={`/players/${encodeURIComponent(s.name)}`}>
                <Avatar name={s.name} src={s.avatar} size={32} />
                <span className={styles.fieldName}>
                  <b>{s.name}</b>
                  <RankBadge rank={s.ranked} />
                </span>
                {s.isYou && <span className={styles.youTag}>You</span>}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.noMatch}>Nobody by that name in this field.</p>
      )}

      {!searching && matches.length > FIELD_PREVIEW && (
        <button type="button" className={`btn ${styles.showMore}`} onClick={() => setAll((v) => !v)}>
          {all ? "Show fewer" : `Show all ${matches.length} players`}
        </button>
      )}
      {all && total > standings.length && (
        <p className={styles.fieldNote}>
          The first {standings.length} to register are listed here, of {total}.
        </p>
      )}
    </>
  );
}

/** One line of the standings. */
function StandingRow({ s, t }: { s: TournamentStanding; t: TournamentDetail }) {
  const state = runState(s, t.status === "settled" || t.status === "cancelled");
  return (
    <div className={`${styles.row} ${s.isYou ? styles.mine : ""}`}>
      <span className={`${styles.rank} ${s.rank === 1 ? styles.first : ""}`}>{s.rank ? `#${s.rank}` : "—"}</span>
      <Link className={styles.who} href={`/players/${encodeURIComponent(s.name)}`}>
        <Avatar name={s.name} src={s.avatar} size={30} />
        <span>
          <span className={styles.name}>
            {s.name}
            <RankBadge rank={s.ranked} />
            {s.isYou && <span className={styles.youTag}>You</span>}
          </span>
          {state && <span className={`${styles.state2} ${state.live ? styles.playing : ""}`}>{state.label}</span>}
        </span>
      </Link>
      <span className={styles.score}>
        {s.started ? s.score.toLocaleString("en") : "—"}
        {s.started && <small>pts</small>}
      </span>
      {s.watchId ? (
        <Link className={styles.watch} href={`/watch/${s.watchId}`} aria-label={`Watch ${s.name}'s run`}>
          <Eye size={14} /> {s.done ? "Replay" : "Watch"}
        </Link>
      ) : (
        <span />
      )}
      <span className={`${styles.prize} ${s.payout ? "" : styles.noPrize}`}>{s.payout ? amount(s.payout, t.asset) : "—"}</span>
    </div>
  );
}

/**
 * The standings once runs are played: a page of them at a time, a search for
 * a long field, and your own line pinned at the top whenever it is further
 * down than the page shows.
 */
function Standings({ t }: { t: TournamentDetail }) {
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(STANDINGS_PAGE);
  const rows = t.standings;
  const matches = matching(rows, query);
  const searching = !!query.trim();
  const shown = searching ? matches : rows.slice(0, limit);
  // Past the two hundred the server sends, your own line still comes with them.
  const mine = rows.find((s) => s.isYou) ?? t.yourStanding ?? undefined;
  const left = rows.length - shown.length;

  return (
    <>
      {rows.length > STANDINGS_PAGE && <FindPlayer value={query} onChange={setQuery} count={rows.length} />}
      {mine && !searching && !shown.includes(mine) && (
        <div className={styles.pinned}>
          <small>Your position</small>
          <StandingRow s={mine} t={t} />
        </div>
      )}
      {shown.length ? (
        <div className={styles.rows}>
          {shown.map((s) => (
            <StandingRow key={s.name} s={s} t={t} />
          ))}
        </div>
      ) : (
        <p className={styles.noMatch}>Nobody by that name in this tournament.</p>
      )}
      {!searching && left > 0 && (
        <button type="button" className={`btn ${styles.showMore}`} onClick={() => setLimit((n) => n + STANDINGS_PAGE)}>
          Show {Math.min(STANDINGS_PAGE, left)} more · {left} to go
        </button>
      )}
    </>
  );
}

/** The clock, and how urgent it is: what is left to register, to play, or nothing. */
function clock(t: TournamentDetail, now: number) {
  if (t.status === "registration") return { label: "Starts in", value: duration(t.startsAt - now), urgent: t.startsAt - now < 15 * 60_000 };
  if (t.status === "live") return { label: "Ends in", value: duration(t.endsAt - now), urgent: true };
  if (t.status === "closing") return { label: "Results", value: "Any second", urgent: true };
  return { label: t.status === "cancelled" ? "Cancelled" : "Finished", value: new Date(t.endsAt).toLocaleDateString("en", { month: "short", day: "numeric" }), urgent: false };
}

/**
 * Where a player is in their one run. Once the tournament is over everybody has
 * finished, so saying it on every row says nothing.
 */
function runState(s: TournamentStanding, over: boolean) {
  if (!s.started) return over ? null : { label: "Not played yet", live: false };
  if (!s.done) return { label: "Playing now", live: true };
  return over ? null : { label: "Finished", live: false };
}

export function TournamentDetailView({ id, player }: { id: string; player: PlayerState }) {
  const [t, setT] = useState<TournamentDetail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    const load = () =>
      request<TournamentDetail>(`/api/tournaments/${encodeURIComponent(id)}`).then(
        (next) => active && (setT(next), setError("")),
        (e: Error) => active && setError(e.message),
      );
    void load();
    const poll = setInterval(() => !document.hidden && void load(), REFRESH_MS);
    const clockTick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      active = false;
      clearInterval(poll);
      clearInterval(clockTick);
    };
  }, [id, reload]);

  const register = async () => {
    setBusy(true);
    setError("");
    try {
      await request("/api/tournaments", { action: "register", id });
      await player.refresh();
      setReload((n) => n + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!t) {
    return (
      <section className={styles.page}>
        <Link href="/tournaments" className={styles.back}>
          <ArrowLeft size={15} /> Tournaments
        </Link>
        <p className={styles.loading}>{error || "Loading tournament…"}</p>
      </section>
    );
  }

  const you = t.you;
  const signedIn = !!player.data.player;
  // Players who have played, in standings order; tied players keep their shared rank.
  const podium = t.standings.filter((s) => s.started && s.rank !== null).slice(0, 3);
  const full = t.entrants >= t.places;
  const spots = Math.max(0, t.places - t.entrants);
  const time = clock(t, now);
  // A cup limited by rank says who it is for before anyone tries; the server checks again.
  const limit = rankLimitLabel(t.ranks);
  const barred = signedIn && !you ? rankBlock(player.data.player?.ranked, t.ranks) : null;

  let action: React.ReactNode;
  if (t.status === "registration") {
    action = you ? (
      <span className={`${styles.state} ${styles.stateIn}`}>
        <Check size={17} /> You are in the field
      </span>
    ) : !signedIn ? (
      <Link className="btn btn-primary" href={player.data.authenticated ? "/signup" : "/login"}>
        Sign in to register
      </Link>
    ) : barred ? (
      <span className={`${styles.state} ${styles.stateBarred}`}>
        <Lock size={16} /> {barred}
      </span>
    ) : (
      <button className="btn btn-primary" disabled={busy || full} onClick={() => void register()}>
        {full ? "Tournament full" : busy ? "Registering…" : `Register · ${entryLabel(t)}`}
      </button>
    );
  } else if (t.status === "live") {
    action =
      you && !you.done ? (
        <Link className="btn btn-primary" href={`/?tournament=${encodeURIComponent(t.id)}`}>
          <Play size={16} /> {you.started ? "Resume your run" : "Play your run"}
        </Link>
      ) : you ? (
        <span className={styles.state}>
          <Check size={17} /> Your run is in · {you.score.toLocaleString("en")} points
        </span>
      ) : (
        <span className={styles.state}>Registration closed when the tournament started</span>
      );
  } else if (you?.rank) {
    action = (
      <span className={`${styles.state} ${you.payout ? styles.stateWon : ""}`}>
        <Trophy size={16} /> You finished {ordinal(you.rank)}
        {you.payout ? ` and won ${amount(you.payout, t.asset)}` : ""}
      </span>
    );
  }

  const [first, second, third, ...rest] = t.prizes;
  const medals = [
    { prize: first, className: styles.gold, label: "1st" },
    { prize: second, className: styles.silver, label: "2nd" },
    { prize: third, className: styles.bronze, label: "3rd" },
  ].filter((m) => m.prize !== undefined);

  return (
    <section className={styles.page}>
      <Link href="/tournaments" className={styles.back}>
        <ArrowLeft size={15} /> Tournaments
      </Link>
      {error && (
        <div className="error" role="alert" style={{ marginTop: 16 }}>
          <span>{error}</span>
        </div>
      )}

      <header className={styles.head}>
        <div className={styles.headTop}>
          <div>
            <div className={styles.chips}>
              <span className={`${styles.chip} ${t.status === "live" ? styles.live : ""}`}>{STATUS_LABELS[t.status].toUpperCase()}</span>
              <span className={`${styles.chip} ${t.asset === "devnet" ? styles.sol : styles.gems}`}>{assetName(t.asset).toUpperCase()}</span>
              <RankLimitTag limits={t.ranks} />
            </div>
            <h1 className={styles.title}>{t.name}</h1>
            <p className={styles.when}>
              {new Date(t.startsAt).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" })} →{" "}
              {new Date(t.endsAt).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" })}
            </p>
          </div>
          <div className={`${styles.clock} ${time.urgent ? styles.urgent : ""}`}>
            <small>{time.label}</small>
            <b>{time.value}</b>
          </div>
        </div>

        <div className={styles.facts}>
          <div className={`${styles.fact} ${styles.pot}`}>
            <small>{t.status === "registration" && t.entryFee ? "Pool when full" : "Prize pool"}</small>
            <b>{amount(headlinePot(t), t.asset)}</b>
            <span>{PAYOUT_LABELS[t.payout]}</span>
          </div>
          <div className={styles.fact}>
            <small>Entry</small>
            <b>{entryLabel(t)}</b>
            <span>One run each</span>
          </div>
          <div className={styles.fact}>
            <small>Field</small>
            <b>
              {t.entrants}/{t.places}
            </b>
            <div className={styles.bar} aria-hidden>
              <span style={{ width: `${Math.min(100, (t.entrants / t.places) * 100)}%` }} />
            </div>
          </div>
          <div className={styles.fact}>
            <small>{t.status === "registration" ? "Seats left" : "Played"}</small>
            <b>{t.status === "registration" ? spots : t.standings.filter((s) => s.started).length}</b>
            <span>{t.status === "registration" ? (full ? "The field is full" : "Register before the start") : `of ${t.entrants} registered`}</span>
          </div>
        </div>

        <div className={styles.act}>
          {action}
          <p className={styles.rule}>
            One run each on the same board. Registration closes at the start; play any time before the end. A run still in progress at the end counts with its score so far.
            {t.entryFee ? (t.asset === "devnet" ? " The pool is the entries minus the 12% house share." : " The pool is every entry.") : " The prize is put up by the house."}
            {limit && ` Open to ${limit}: the rank you hold when you register is the one that counts, and players still in their placement matches cannot enter.`}
          </p>
        </div>
      </header>

      <div className={styles.body}>
        <section>
          <div className={styles.sectionHead}>
            <h2>{t.status === "settled" ? "Final standings" : t.status === "registration" ? "The field" : "Standings"}</h2>
            <span>
              {t.standings.length} {t.standings.length === 1 ? "player" : "players"}
              {t.status !== "settled" && t.standings.some((s) => s.started) ? " · live as runs finish" : ""}
            </span>
          </div>

          {podium.length > 0 && (
            <div className={styles.podium}>
              <Podium
                label="Tournament top three"
                titles={t.status === "settled" ? ["CHAMPION", "SECOND PLACE", "THIRD PLACE"] : t.status === "cancelled" ? ["TOP SCORE", "SECOND", "THIRD"] : ["IN THE LEAD", "SECOND PLACE", "THIRD PLACE"]}
                entries={podium.map((s) => ({
                  name: s.name,
                  ranked: s.ranked,
                  avatar: s.avatar,
                  href: `/players/${encodeURIComponent(s.name)}`,
                  rank: s.rank!,
                  meta: s.payout ? `${t.status === "settled" ? "Won" : "Projected"} ${amount(s.payout, t.asset)}` : !s.done ? "Still playing" : "Outside the prizes",
                  valueLabel: "SCORE",
                  value: s.score.toLocaleString("en"),
                  unit: "pts",
                  isYou: s.isYou,
                }))}
              />
            </div>
          )}

          {t.status === "registration" && t.standings.length ? (
            <TheField t={t} />
          ) : t.standings.length ? (
            <Standings t={t} />
          ) : (
            <p className={styles.empty}>Nobody has registered yet. Be the first.</p>
          )}
        </section>

        <aside className={styles.prizes}>
          <h2>Prizes</h2>
          <div className={styles.top}>
            {medals.map((m) => (
              <div key={m.label} className={`${styles.place} ${m.className}`}>
                <span className={styles.medal}>{m.label[0]}</span>
                <span>{m.label} place</span>
                <b>{amount(m.prize, t.asset)}</b>
              </div>
            ))}
          </div>
          {rest.length > 0 && (
            <div className={styles.rest}>
              {rest.map((prize, i) => (
                <div key={i}>
                  <span>{ordinal(i + 4)}</span>
                  <b>{amount(prize, t.asset)}</b>
                </div>
              ))}
            </div>
          )}
          <p>Equal scores share their places. With fewer players than paid places, the whole pool is still paid out.</p>
        </aside>
      </div>
    </section>
  );
}
