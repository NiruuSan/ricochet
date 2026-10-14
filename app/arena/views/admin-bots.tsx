"use client";
import { useCallback, useEffect, useState } from "react";
import { Bot, Coins, Play, Power, Trash2 } from "lucide-react";
import { useActionDialog } from "@/components/ui/action-dialog";
import type { BotConfig, BotRow, BotSkill } from "@/lib/bots";
import { request } from "../api";
import { Avatar } from "../avatar";
import { amount, exactSol, units } from "../format";
import styles from "./admin.module.css";
import { toast } from "../feedback";

/** What the house still owes: runs in matches, runs in cups, and cups ahead. */
type Work = { matches: number; cupRuns: number; cupsAhead: number };

const REFRESH_MS = 20_000;
const SOL = 1_000_000_000;
/**
 * How many turns one press may ask for. Each turn plays everything it can in
 * twenty seconds; this only stops a loop that somehow never runs dry.
 */
const MAX_TURNS = 200;
const SKILLS: { id: BotSkill; label: string; note: string }[] = [
  { id: "rookie", label: "Rookie", note: "Glances at three angles and misses" },
  { id: "steady", label: "Steady", note: "Reads the board, drops the odd shot" },
  { id: "sharp", label: "Sharp", note: "Takes the best angle it can find" },
];

type Limits = { count: number; minTopUp: number; maxTopUp: number };
type Board = { config: BotConfig; bots: BotRow[]; work: Work; treasury: number; limits: Limits };

/** What the form says in SOL, as lamports; null for something that is not an amount. */
const toLamports = (text: string) => {
  const n = Number(text.replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * SOL) : null;
};

/**
 * The house's practice opponents: the switch, how many sit down, how well they
 * play, and the button that takes them off the site at launch.
 */
export function AdminBots() {
  const dialog = useActionDialog();
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  /** What one press of "Play everything waiting" has done so far. */
  const [progress, setProgress] = useState<number | null>(null);

  const load = useCallback(
    () =>
      request<Board>("/api/admin/bots").then(
        (next) => (setBoard(next), setError("")),
        (e: Error) => setError(e.message),
      ),
    [],
  );
  useEffect(() => {
    void load();
    const timer = setInterval(() => !document.hidden && void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const send = async (body: Record<string, unknown>, said?: string) => {
    setBusy(String(body.action));
    setError("");
    try {
      const next = await request<Partial<Board> & Record<string, unknown>>("/api/admin/bots", body);
      if (next.config && next.bots && board)
        setBoard({ ...board, config: next.config, bots: next.bots, work: next.work ?? board.work, treasury: next.treasury ?? board.treasury });
      else await load();
      if (said) toast(said);
      return next;
    } catch (e) {
      setError((e as Error).message);
      // The switch moved before the answer came back: put it back to what is true.
      void load();
      return null;
    } finally {
      setBusy("");
    }
  };

  const save = (patch: Partial<BotConfig>, said?: string) => {
    if (!board) return;
    const next = { ...board.config, ...patch };
    setBoard({ ...board, config: next });
    void send({ action: "save", enabled: next.enabled, count: next.count, tournaments: next.tournaments, skills: next.skills, topUp: next.topUp, floor: next.floor }, said);
  };

  /** Sets one of the two amounts from what was typed, in SOL. */
  const saveAmount = (field: "topUp" | "floor", text: string) => {
    if (!board) return;
    const value = toLamports(text);
    if (value === null) {
      setError("Write the amount in SOL, for example 2.5.");
      return;
    }
    if (value === board.config[field]) return;
    save({ [field]: value }, field === "topUp" ? `Each bot is now given ${exactSol(value)} SOL.` : "Saved.");
  };

  /**
   * Plays everything waiting, however much that is. The server plays for twenty
   * seconds a turn and says when there is more; a seat taken or a cup entered
   * makes new runs to play, so the turns go on until one finds nothing to do.
   */
  const playAll = async () => {
    setBusy("play");
    setError("");
    setProgress(0);
    const total = { played: 0, joined: 0, entered: 0 };
    try {
      for (let turn = 0; turn < MAX_TURNS; turn++) {
        const next = await request<{ done: typeof total; more: boolean; bots: BotRow[]; work: Work }>("/api/admin/bots", { action: "play" });
        total.played += next.done.played;
        total.joined += next.done.joined;
        total.entered += next.done.entered;
        setProgress(total.played + total.joined + total.entered);
        setBoard((current) => (current ? { ...current, bots: next.bots, work: next.work } : current));
        if (!next.more && !next.done.played && !next.done.joined && !next.done.entered) break;
      }
      const said = [
        total.played ? `${total.played} ${total.played === 1 ? "run" : "runs"} played` : "",
        total.joined ? `${total.joined} ${total.joined === 1 ? "seat" : "seats"} taken` : "",
        total.entered ? `${total.entered} ${total.entered === 1 ? "cup" : "cups"} entered` : "",
      ].filter(Boolean);
      toast(said.length ? `${said.join(" · ")}.` : "Nothing was waiting for them.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
      setProgress(null);
      void load();
    }
  };

  const topUpAll = async () => {
    const next = await send({ action: "fund" });
    if (!next) return;
    const funded = Number(next.funded ?? 0);
    const short = Number(next.unaffordable ?? 0);
    const said = funded ? `${funded} ${funded === 1 ? "wallet" : "wallets"} topped up · ${exactSol(Number(next.moved ?? 0))} SOL from the treasury.` : "Every bot already has its amount.";
    toast(short ? `${said} ${short} could not be covered: the treasury is short.` : said);
  };

  const retire = async () => {
    const ok = await dialog.confirm(
      "Take the house players off the site?\n\nThey stop playing at once. A match run they have not played yet ends where it is, as an abandoned run would, so their opponents are settled; they leave every tournament that has not started, so the places are free for people; everything they hold goes back to the treasury and their names are freed. The matches and tournaments they played stay, because they are their opponents' history too.",
      { title: "Retire the house players", confirmLabel: "Retire them", danger: true },
    );
    if (!ok) return;
    const done = await send({ action: "remove" });
    if (!done) return;
    const ended = Number(done.ended ?? 0);
    const withdrawn = Number(done.withdrawn ?? 0);
    toast(
      [
        `${done.retired} retired`,
        ended ? `${ended} unplayed ${ended === 1 ? "run" : "runs"} ended` : "",
        withdrawn ? `${withdrawn} tournament ${withdrawn === 1 ? "place" : "places"} given back` : "",
        `${amount(Number(done.swept ?? 0), "devnet")} back in the treasury`,
      ]
        .filter(Boolean)
        .join(" · ") + ".",
    );
  };

  if (!board) return <p className={styles.loading}>{error || "Loading the house players…"}</p>;
  const { config, bots, limits } = board;
  // What topping every bot in service up to its amount would take from the treasury.
  const serving = bots.slice(0, config.count);
  const needed = serving.reduce((sum, bot) => sum + Math.max(0, config.topUp - bot.sol), 0) + Math.max(0, config.count - serving.length) * config.topUp;

  return (
    <section className={styles.section}>
      {error && (
        <div className="error" role="alert">
          <span>{error}</span>
        </div>
      )}

      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <h3>
            <Bot size={16} /> House players
          </h3>
          <button
            className={`btn ${config.enabled ? "" : "btn-danger"}`}
            role="switch"
            aria-checked={config.enabled}
            disabled={!!busy}
            style={config.enabled ? { borderColor: "#c6f564", color: "#c6f564" } : undefined}
            onClick={() => save({ enabled: !config.enabled }, config.enabled ? "The house players have stopped." : "The house players are on.")}
          >
            <Power size={15} /> {config.enabled ? "Playing" : "Off"}
          </button>
        </div>
        <p className={styles.fine}>
          Players the house sits at the tables while the site fills up. They take seats nobody has taken after a minute, enter tournaments, and play the same boards through
          the same engine as everybody else — their wallets are topped up from the treasury. They never take cashback, quests, daily gems or a weekly race prize, so they
          cannot win anything away from a person. Retire them on launch day.
        </p>

        <div className={styles.form}>
          <label className="field">
            How many sit down
            <input
              className="input"
              type="number"
              min={0}
              max={limits.count}
              step={1}
              value={config.count}
              disabled={!!busy}
              onChange={(e) => setBoard({ ...board, config: { ...config, count: Math.max(0, Math.min(limits.count, Math.floor(Number(e.target.value) || 0))) } })}
              onBlur={() => save({}, "Saved.")}
            />
          </label>
          <label className="field">
            SOL given to each bot
            <input
              key={`top-${config.topUp}`}
              className="input"
              type="number"
              inputMode="decimal"
              min={limits.minTopUp / SOL}
              max={limits.maxTopUp / SOL}
              step="any"
              defaultValue={config.topUp / SOL}
              disabled={!!busy}
              onBlur={(e) => saveAmount("topUp", e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            />
          </label>
          <label className="field">
            Topped up again below (SOL)
            <input
              key={`floor-${config.floor}`}
              className="input"
              type="number"
              inputMode="decimal"
              min={0}
              max={config.topUp / SOL}
              step="any"
              defaultValue={config.floor / SOL}
              disabled={!!busy}
              onBlur={(e) => saveAmount("floor", e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            />
          </label>
          <div className="field">
            How well they play
            <div className={styles.skills}>
              {SKILLS.map((skill) => {
                const on = config.skills.includes(skill.id);
                return (
                  <button
                    key={skill.id}
                    type="button"
                    aria-pressed={on}
                    disabled={!!busy}
                    onClick={() => save({ skills: on ? config.skills.filter((s) => s !== skill.id) : [...config.skills, skill.id] }, "Saved.")}
                  >
                    <b>{skill.label}</b>
                    <small>{skill.note}</small>
                  </button>
                );
              })}
            </div>
          </div>
          <label className={`field ${styles.full}`} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <input type="checkbox" checked={config.tournaments} disabled={!!busy} onChange={(e) => save({ tournaments: e.target.checked }, "Saved.")} />
            They enter tournaments on their own, and fill a cup on the button in the Tournaments tab
          </label>
        </div>

        <p className={styles.fine}>
          The treasury holds {exactSol(board.treasury)} SOL. Each bot is given {exactSol(config.topUp)} SOL and topped up again whenever it falls below{" "}
          {exactSol(config.floor)} SOL; bringing all {config.count} up to their amount now would take {exactSol(needed)} SOL
          {needed > board.treasury ? ", more than the treasury holds — the ones it cannot cover are left as they are" : ""}.
        </p>

        <p className={styles.fine}>
          Waiting for them right now: {board.work.cupRuns} {board.work.cupRuns === 1 ? "cup run" : "cup runs"} · {board.work.matches}{" "}
          {board.work.matches === 1 ? "match" : "matches"} · {board.work.cupsAhead} {board.work.cupsAhead === 1 ? "entry" : "entries"} in cups still to start. On an ordinary
          turn they play a few at a time and spread a cup run over the first minutes of its window; the button below skips the waiting and plays all of it, however much
          there is.
        </p>

        <div className={styles.formActions}>
          <button className="btn" disabled={!!busy || !config.count} onClick={() => void topUpAll()}>
            <Coins size={15} /> Top up every bot to {exactSol(config.topUp)} SOL
          </button>
          <button className="btn" disabled={!!busy || !config.enabled} onClick={() => void playAll()} aria-live="polite">
            <Play size={15} /> {progress === null ? "Play everything waiting" : `Playing… ${progress} done so far`}
          </button>
          <button className="btn btn-danger" disabled={!!busy || !bots.length} onClick={() => void retire()}>
            <Trash2 size={15} /> Retire them all
          </button>
        </div>
      </section>

      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>
            On the site {bots.length > 0 && <small>· {bots.length}</small>}
          </h2>
        </div>
        {!bots.length ? (
          <p className={styles.empty}>Nobody yet. Turn them on and they sit down at the next turn.</p>
        ) : (
          <div className={styles.list}>
            {bots.map((bot) => (
              <div key={bot.id} className={styles.row}>
                <div className={styles.who}>
                  <Avatar name={bot.name} src={null} size={34} />
                  <div>
                    <b>
                      {bot.name}
                      <span className={`${styles.chip} ${styles.calm}`}>{SKILLS.find((s) => s.id === bot.skill)?.label ?? bot.skill}</span>
                    </b>
                    <span>House player</span>
                  </div>
                </div>
                <div className={styles.cells}>
                  <div className={styles.cell}>
                    <span>Devnet SOL</span>
                    <b>{units(bot.sol, "devnet")}</b>
                  </div>
                  <div className={styles.cell}>
                    <span>Gems</span>
                    <b>{units(bot.balance, "gems")}</b>
                  </div>
                  <div className={styles.cell}>
                    <span>Matches</span>
                    <b>{bot.matches}</b>
                  </div>
                  <div className={styles.cell}>
                    <span>Won</span>
                    <b>{bot.wins}</b>
                  </div>
                </div>
                <div />
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
