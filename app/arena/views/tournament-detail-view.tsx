"use client";
import { RankBadge } from "../rank-badge";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Eye, Play } from "lucide-react";
import type { TournamentDetail } from "@/lib/api-types";
import { request } from "../api";
import { Avatar } from "../avatar";
import { amount } from "../format";
import type { PlayerState } from "../arena";
import { entryLabel, headlinePot, ordinal, PAYOUT_LABELS, STATUS_LABELS, timing } from "../tournament-format";
import { Podium } from "./podium";
import styles from "./tournaments.module.css";

const REFRESH_MS = 10_000;

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
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      active = false;
      clearInterval(poll);
      clearInterval(clock);
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
        <Link href="/tournaments" className="lime">
          ← Tournaments
        </Link>
        <p className="muted" style={{ marginTop: 24 }}>
          {error || "Loading tournament…"}
        </p>
      </section>
    );
  }

  const you = t.you;
  const signedIn = !!player.data.player;
  // Players who have played, in standings order; tied players keep their shared rank.
  const podium = t.standings.filter((s) => s.started && s.rank !== null).slice(0, 3);
  const full = t.entrants >= t.places;
  let action: React.ReactNode;
  if (t.status === "registration") {
    action = you ? (
      <span className="btn" aria-disabled>
        <Check /> You are registered
      </span>
    ) : !signedIn ? (
      <Link className="btn btn-primary" href={player.data.authenticated ? "/signup" : "/login"}>
        Sign in to register
      </Link>
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
        <span className="btn" aria-disabled>
          <Check /> Run finished · {you.score.toLocaleString("en")} points
        </span>
      ) : (
        <span className={styles.muted}>Registration closed when the tournament started.</span>
      );
  } else if (you?.rank) {
    action = (
      <span className="btn" aria-disabled>
        {ordinal(you.rank)} place{you.payout ? ` · won ${amount(you.payout, t.asset)}` : ""}
      </span>
    );
  }

  return (
    <section className={styles.page}>
      <Link href="/tournaments" className="lime" style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
        <ArrowLeft size={15} /> Tournaments
      </Link>
      {error && (
        <div className="error" role="alert" style={{ marginTop: 16 }}>
          <span>{error}</span>
        </div>
      )}
      <div className={styles.hero}>
        <div className={styles.panel}>
          <div className={styles.cardTop} style={{ justifyContent: "flex-start" }}>
            <span className={`${styles.chip} ${t.status === "live" ? styles.chipLive : ""}`}>{STATUS_LABELS[t.status].toUpperCase()}</span>
            <span className={`${styles.chip} ${t.asset === "devnet" ? styles.chipSol : styles.chipGems}`}>{t.asset === "devnet" ? "DEVNET SOL" : "GEMS"}</span>
            <span className={styles.muted}>{timing(t, now)}</span>
          </div>
          <h1 className={styles.heroTitle}>{t.name}</h1>
          <p className={styles.muted}>
            {new Date(t.startsAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })} →{" "}
            {new Date(t.endsAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
          </p>
          <div className={styles.stats}>
            <div className={`${styles.stat} ${styles.statPot}`}>
              <small>{t.status === "registration" && t.entryFee ? "POOL WHEN FULL" : "PRIZE POOL"}</small>
              <b>{amount(headlinePot(t), t.asset)}</b>
            </div>
            <div className={styles.stat}>
              <small>ENTRY</small>
              <b>{entryLabel(t)}</b>
            </div>
            <div className={styles.stat}>
              <small>PLAYERS</small>
              <b>
                {t.entrants}/{t.places}
              </b>
            </div>
            <div className={styles.stat}>
              <small>PAYOUT</small>
              <b>{PAYOUT_LABELS[t.payout]}</b>
            </div>
          </div>
          <div className={styles.action}>{action}</div>
          <p className="fine" style={{ marginTop: 14 }}>
            One run each on the same board. Registration closes at the start; play any time before the end. A run still in progress at the end counts with its score so far.
            {t.entryFee ? (t.asset === "devnet" ? " The prize pool is the entries minus the 12% house share." : " The prize pool is every entry.") : " The prize is put up by the house."}
          </p>
        </div>
        <div className={styles.panel}>
          <h2 style={{ fontSize: 18 }}>Prizes</h2>
          <ol className={styles.ladder}>
            {t.prizes.map((prize, i) => (
              <li key={i}>
                <span>{ordinal(i + 1)} place</span>
                <b>{amount(prize, t.asset)}</b>
              </li>
            ))}
          </ol>
          <p className="fine" style={{ marginTop: 12 }}>
            Equal scores share their places. With fewer players than paid places, the whole pool is still paid out.
          </p>
        </div>
      </div>

      <div className={styles.section}>
        <h2>{t.status === "settled" ? "Final standings" : "Standings"}</h2>
        {podium.length > 0 && (
          <div style={{ marginTop: 22 }}>
            <Podium
              label="Tournament top three"
              titles={t.status === "settled" ? ["CHAMPION", "SECOND PLACE", "THIRD PLACE"] : t.status === "cancelled" ? ["TOP SCORE", "SECOND", "THIRD"] : ["IN THE LEAD", "SECOND PLACE", "THIRD PLACE"]}
              entries={podium.map((s) => ({
                name: s.name,
                level: s.level,
                avatar: s.avatar,
                href: `/players/${encodeURIComponent(s.name)}`,
                rank: s.rank!,
                meta: s.payout
                  ? `${t.status === "settled" ? "Won" : "Projected"} ${amount(s.payout, t.asset)}`
                  : !s.done
                    ? "Still playing"
                    : "Outside the prizes",
                valueLabel: "SCORE",
                value: s.score.toLocaleString("en"),
                unit: "pts",
                isYou: s.isYou,
              }))}
            />
          </div>
        )}
        {t.standings.length ? (
          <div style={{ overflowX: "auto" }}>
            <table className={`${styles.table} ${styles.standings}`}>
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Player</th>
                  <th>Score</th>
                  <th>
                    <span className="sr-only">Watch</span>
                  </th>
                  <th>{t.status === "settled" ? "Prize" : "Projected prize"}</th>
                </tr>
              </thead>
              <tbody>
                {t.standings.map((s, i) => (
                  <tr key={i} className={s.isYou ? styles.mine : undefined}>
                    <td className={s.rank === 1 ? styles.gold : undefined}>{s.rank ? `#${s.rank}` : "—"}</td>
                    <td>
                      <Link className={styles.player} href={`/players/${encodeURIComponent(s.name)}`}>
                        <Avatar name={s.name} src={s.avatar} size={30} />
                        <span className={styles.identity}>
                          <b>{s.name}</b> <RankBadge level={s.level} />
                          {s.isYou && <span className={styles.muted}> · you</span>}
                          <br />
                          <span className={styles.muted}>{!s.started ? "Not played yet" : s.done ? "Finished" : "Playing"}</span>
                        </span>
                      </Link>
                    </td>
                    <td>{s.started ? s.score.toLocaleString("en") : "—"}</td>
                    <td>
                      {s.watchId && (
                        <Link className={styles.watch} href={`/watch/${s.watchId}`} aria-label={`Watch ${s.name}'s run`}>
                          <Eye size={14} /> <span className={styles.watchLabel}>{s.done ? "Replay" : "Watch"}</span>
                        </Link>
                      )}
                    </td>
                    <td className={s.payout ? styles.positive : styles.muted}>{s.payout ? amount(s.payout, t.asset) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={styles.empty}>Nobody has registered yet. Be the first.</p>
        )}
      </div>
    </section>
  );
}
