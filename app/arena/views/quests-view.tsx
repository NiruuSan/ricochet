"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronsUp, Gem, Target } from "lucide-react";
import type { Quest, QuestBoard } from "@/lib/api-types";
import { request } from "../api";
import { units } from "../format";
import type { PlayerState } from "../arena";
import styles from "./quests.module.css";

/** How long a period has left, in words. */
export function closesIn(at: number, now: number) {
  const minutes = Math.max(0, Math.round((at - now) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
  return `${Math.floor(hours / 24)} days`;
}

/**
 * Today's quests and this week's. They are the same for every player and they
 * rotate with the period, so there is always something to come back for and
 * never an advantage in who was given what.
 */
export function QuestsView({ player }: { player: PlayerState }) {
  const [board, setBoard] = useState<QuestBoard | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(
    () =>
      request<QuestBoard>("/api/quests").then(
        (next) => (setBoard(next), setError("")),
        (e: Error) => setError(e.message),
      ),
    [],
  );

  useEffect(() => {
    void load();
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [load]);

  if (!player.loaded) return <section className="subpage"><p className="muted">Loading…</p></section>;
  if (!player.data.player) {
    return (
      <section className={`subpage ${styles.empty}`}>
        <Target size={30} />
        <h1>Quests need a player name.</h1>
        <p>Create your profile to take on the daily and weekly quests.</p>
        <Link className="btn btn-primary" href={player.data.authenticated ? "/signup" : "/login"}>
          {player.data.authenticated ? "Create your profile" : "Sign in"}
        </Link>
      </section>
    );
  }

  const claim = async (quest: Quest) => {
    setBusy(`${quest.scope}:${quest.id}`);
    setError("");
    setNotice("");
    try {
      setBoard(await request<QuestBoard>("/api/quests", { action: "claim", scope: quest.scope, quest: quest.id }));
      setNotice(`+${units(quest.reward, "gems")} gems. ${quest.title} is now worth more, and asks for more.`);
      await player.refresh();
    } catch (e) {
      setError((e as Error).message);
      void load();
    } finally {
      setBusy("");
    }
  };

  const row = (quest: Quest) => {
    const finished = quest.progress >= quest.target;
    const key = `${quest.scope}:${quest.id}`;
    return (
      <div key={key} className={`${styles.quest} ${finished ? styles.done : ""}`}>
        <span className={styles.icon} aria-hidden>
          {quest.tier > 0 ? <ChevronsUp size={20} /> : <Target size={20} />}
        </span>
        <div className={styles.copy}>
          <h3>
            {quest.title}
            {/* Each rung already taken is on the record: the bar rose because
                the player cleared it, not because the board is unkind. */}
            {quest.tier > 0 && <b className={styles.tier}>Tier {quest.tier + 1}</b>}
          </h3>
          <p>{quest.detail}</p>
          <div className={styles.bar} role="progressbar" aria-valuenow={quest.progress} aria-valuemin={0} aria-valuemax={quest.target} aria-label={quest.title}>
            <i className={styles.fill} style={{ width: `${Math.min(100, (quest.progress / quest.target) * 100)}%` }} />
          </div>
          <small className={styles.count}>
            {quest.progress.toLocaleString("en")} / {quest.target.toLocaleString("en")}
          </small>
        </div>
        <div className={styles.action}>
          <span className={styles.reward}>
            <Gem size={15} /> {units(quest.reward, "gems")}
          </span>
          <button className="btn btn-primary" disabled={!finished || busy === key} onClick={() => void claim(quest)}>
            {busy === key ? "Claiming…" : finished ? "Claim" : "Keep playing"}
          </button>
        </div>
      </div>
    );
  };

  return (
    <section className="subpage">
      <div className="page-intro">
        <div>
          <div className="tag lime">SOMETHING TO PLAY FOR</div>
          <h1>Quests.</h1>
          <p>
            Three a day and three a week, the same for everybody, and different tomorrow. Matches against a rival count, in gems or devnet SOL; practice does not.
            Claim one and it comes back asking for more, worth more — until the day or the week turns over and the board starts again.
          </p>
        </div>
      </div>

      {error && (
        <div className="error" role="alert">
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <p className="success" role="status">
          {notice}
        </p>
      )}

      {!board ? (
        <p className="muted">Loading your quests…</p>
      ) : (
        <>
          <div className={styles.group}>
            <div className={styles.groupHead}>
              <h2>Today</h2>
              <span>Resets in {closesIn(board.dailyEndsAt, now)}</span>
            </div>
            <div className={styles.list}>{board.daily.map(row)}</div>
          </div>
          <div className={styles.group}>
            <div className={styles.groupHead}>
              <h2>This week</h2>
              <span>Resets in {closesIn(board.weeklyEndsAt, now)}</span>
            </div>
            <div className={styles.list}>{board.weekly.map(row)}</div>
          </div>
        </>
      )}
    </section>
  );
}

/** The lobby's way in: how many quests are finished and waiting. */
export function QuestsCard({ player }: { player: PlayerState }) {
  const ready = player.data.questsReady ?? 0;
  if (!player.data.player) return null;
  return (
    <Link className={`${styles.card} ${ready ? styles.done : ""}`} href="/quests">
      <span className={styles.icon} aria-hidden>
        <Target size={20} />
      </span>
      <div className={styles.copy}>
        <h2>{ready ? `${ready} ${ready === 1 ? "quest is" : "quests are"} waiting for you` : "Quests of the day and the week"}</h2>
        <p>{ready ? "Finished, and paid in gems the moment you claim them." : "Three a day and three a week. Play a match and they start filling in."}</p>
      </div>
      <span className={styles.reward}>
        <Gem size={15} /> {ready ? "Claim" : "See quests"}
      </span>
    </Link>
  );
}
