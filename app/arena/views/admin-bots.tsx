"use client";
import { useCallback, useEffect, useState } from "react";
import { Bot, Coins, Play, Power, Trash2 } from "lucide-react";
import { useActionDialog } from "@/components/ui/action-dialog";
import type { BotConfig, BotRow, BotSkill } from "@/lib/bots";
import { request } from "../api";
import { Avatar } from "../avatar";
import { amount, units } from "../format";
import styles from "./admin.module.css";

const REFRESH_MS = 20_000;
const MAX = 20;
const SKILLS: { id: BotSkill; label: string; note: string }[] = [
  { id: "rookie", label: "Rookie", note: "Glances at three angles and misses" },
  { id: "steady", label: "Steady", note: "Reads the board, drops the odd shot" },
  { id: "sharp", label: "Sharp", note: "Takes the best angle it can find" },
];

type Board = { config: BotConfig; bots: BotRow[] };

/**
 * The house's practice opponents: the switch, how many sit down, how well they
 * play, and the button that takes them off the site at launch.
 */
export function AdminBots() {
  const dialog = useActionDialog();
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");

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
    setNotice("");
    try {
      const next = await request<Partial<Board> & Record<string, unknown>>("/api/admin/bots", body);
      if (next.config && next.bots) setBoard({ config: next.config, bots: next.bots });
      else await load();
      if (said) setNotice(said);
      return next;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy("");
    }
  };

  const save = (patch: Partial<BotConfig>, said?: string) => {
    if (!board) return;
    const next = { ...board.config, ...patch };
    setBoard({ ...board, config: next });
    void send({ action: "save", enabled: next.enabled, count: next.count, tournaments: next.tournaments, skills: next.skills }, said);
  };

  const retire = async () => {
    const ok = await dialog.confirm(
      "Take the house players off the site?\n\nThey stop playing, their names are freed and everything they hold goes back to the treasury. The matches and tournaments they played stay, because they are their opponents' history too.",
      { title: "Retire the house players", confirmLabel: "Retire them", danger: true },
    );
    if (!ok) return;
    const done = await send({ action: "remove" });
    if (done) setNotice(`${done.retired} retired · ${amount(Number(done.swept ?? 0), "devnet")} back in the treasury.`);
  };

  if (!board) return <p className={styles.loading}>{error || "Loading the house players…"}</p>;
  const { config, bots } = board;

  return (
    <section className={styles.section}>
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
              max={MAX}
              step={1}
              value={config.count}
              disabled={!!busy}
              onChange={(e) => setBoard({ ...board, config: { ...config, count: Math.max(0, Math.min(MAX, Number(e.target.value))) } })}
              onBlur={() => save({}, "Saved.")}
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

        <div className={styles.formActions}>
          <button className="btn" disabled={!!busy} onClick={() => void send({ action: "fund" }, "Wallets topped up from the treasury.")}>
            <Coins size={15} /> Top up wallets
          </button>
          <button className="btn" disabled={!!busy || !config.enabled} onClick={() => void send({ action: "play" }, "They took their turn.")}>
            <Play size={15} /> Take a turn now
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
