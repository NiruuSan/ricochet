"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, Gem, Lock, Palette, Sparkles } from "lucide-react";
import type { Theme, ThemeId } from "@/lib/themes";
import { initial } from "@/lib/engine";
import { request } from "../api";
import { amount, units } from "../format";
import type { PlayerState } from "../arena";
import { drawBoard } from "../board-canvas";
import { themeStyle } from "../theme";
import styles from "./themes.module.css";

type Store = { themes: Theme[]; owned: ThemeId[]; equipped: ThemeId };

/** One board, the same for every card, so the only difference is the skin. */
const SAMPLE = (() => {
  const game = initial(20_260_923);
  return {
    ...game,
    round: 4,
    balls: 12,
    score: 1_240,
    bricks: [
      { col: 0, row: 7, hp: 4 },
      { col: 1, row: 7, hp: 12 },
      { col: 3, row: 7, hp: 7 },
      { col: 4, row: 7, hp: 4 },
      { col: 6, row: 7, hp: 9 },
      { col: 1, row: 6, hp: 2 },
      { col: 2, row: 6, hp: 6 },
      { col: 5, row: 6, hp: 3 },
      { col: 0, row: 5, hp: 8 },
      { col: 3, row: 5, hp: 1 },
      { col: 4, row: 5, hp: 5 },
      { col: 6, row: 5, hp: 2 },
    ],
  };
})();

/** The same board, painted in one theme. Nothing here is interactive. */
function Preview({ theme }: { theme: Theme }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) drawBoard(ref.current, null, SAMPLE, 68, theme);
  }, [theme]);
  return <canvas ref={ref} className={styles.preview} width={472} height={612} aria-label={`${theme.name}: the board`} />;
}

const priceOf = (theme: Theme) =>
  theme.price === null ? "Free" : theme.price.asset === "gems" ? `${units(theme.price.amount, "gems")} gems` : `${amount(theme.price.amount, "devnet")}`;

/**
 * The skin shop.
 *
 * Everything on sale here is paint: the same board, the same physics, the same
 * odds. That is said plainly on the page, because a shop attached to a game
 * played for money has to be obvious about what it does not sell.
 */
export function ThemesView({ player }: { player: PlayerState }) {
  const [store, setStore] = useState<Store | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(
    () => request<Store>("/api/themes").then((next) => setStore(next), (e: Error) => setError(e.message)),
    [],
  );
  useEffect(() => void load(), [load]);

  const act = async (theme: Theme, action: "buy" | "equip") => {
    setBusy(theme.id);
    setError("");
    setNotice("");
    try {
      const next = await request<Store>("/api/themes", { action, theme: theme.id });
      setStore((current) => (current ? { ...current, ...next } : current));
      setNotice(action === "buy" ? `${theme.name} is yours, and on the board.` : `${theme.name} it is.`);
      await player.refresh();
    } catch (e) {
      setError((e as Error).message);
      void load();
    } finally {
      setBusy("");
    }
  };

  const gems = player.data.player?.balance ?? 0;
  const sol = player.data.cashBalance ?? 0;

  return (
    <section className="subpage">
      <div className="page-intro">
        <div>
          <div className="tag lime">THE SAME BOARD, YOUR WAY</div>
          <h1>Themes.</h1>
          <p>
            Ten looks for the arena: colours, brick shapes, what a brick does when it breaks, and the type on the board. A theme is paint and nothing else — the
            board, the physics and every angle stay exactly as they are, whichever one you wear.
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

      {!player.data.player ? (
        <div className={styles.empty}>
          <Palette size={30} />
          <h2>Themes need a player name.</h2>
          <p>Create your profile to wear one.</p>
          <Link className="btn btn-primary" href={player.data.authenticated ? "/signup" : "/login"}>
            {player.data.authenticated ? "Create your profile" : "Sign in"}
          </Link>
        </div>
      ) : (
        <p className={styles.balances}>
          <span>
            <Gem size={14} /> {units(gems, "gems")} gems
          </span>
          <span>{amount(sol, "devnet")} available</span>
        </p>
      )}

      {!store ? (
        <p className="muted">Loading the themes…</p>
      ) : (
        <div className={styles.grid}>
          {store.themes.map((theme) => {
            const owned = store.owned.includes(theme.id);
            const worn = store.equipped === theme.id;
            const affordable =
              theme.price === null || (theme.price.asset === "gems" ? gems >= theme.price.amount : sol >= theme.price.amount);
            return (
              <article key={theme.id} className={`${styles.card} ${worn ? styles.worn : ""}`} style={themeStyle(theme)}>
                <Preview theme={theme} />
                <div className={styles.body}>
                  <header className={styles.head}>
                    <h2>{theme.name}</h2>
                    {worn ? (
                      <span className={styles.badge}>
                        <Check size={12} /> WEARING
                      </span>
                    ) : owned ? (
                      <span className={`${styles.badge} ${styles.ownedBadge}`}>OWNED</span>
                    ) : (
                      <span className={styles.price}>{priceOf(theme)}</span>
                    )}
                  </header>
                  <p className={styles.tagline}>{theme.tagline}</p>
                  <ul className={styles.traits}>
                    <li>{theme.board.radius === 0 ? "Square bricks" : theme.board.radius >= 10 ? "Very round bricks" : "Rounded bricks"}</li>
                    <li>{BURSTS[theme.effects.burst]}</li>
                    {theme.effects.trail && <li>Ball trail</li>}
                    {theme.effects.bounce !== "none" && <li>{BOUNCES[theme.effects.bounce]}</li>}
                  </ul>
                  {player.data.player &&
                    (worn ? (
                      <button className="btn" disabled>
                        On the board
                      </button>
                    ) : owned ? (
                      <button className="btn btn-primary" disabled={busy === theme.id} onClick={() => void act(theme, "equip")}>
                        {busy === theme.id ? "Changing…" : "Wear this"}
                      </button>
                    ) : (
                      <button className="btn btn-primary" disabled={busy === theme.id || !affordable} onClick={() => void act(theme, "buy")}>
                        {busy === theme.id ? "Buying…" : affordable ? `Buy · ${priceOf(theme)}` : <><Lock size={13} /> {priceOf(theme)}</>}
                      </button>
                    ))}
                </div>
              </article>
            );
          })}
        </div>
      )}

      <p className={styles.footnote}>
        <Sparkles size={14} /> Bought with gems or devnet SOL, worn for good. A theme never changes a board, a bounce or a payout.
      </p>
    </section>
  );
}

const BURSTS: Record<Theme["effects"]["burst"], string> = {
  shards: "Bricks shatter",
  sparks: "Bricks spark",
  pixels: "Bricks pixelate",
  bubbles: "Bricks release bubbles",
  petals: "Bricks scatter petals",
  embers: "Bricks throw embers",
  dust: "Bricks turn to dust",
  glyphs: "Bricks drop characters",
  scraps: "Bricks tear into scraps",
};

const BOUNCES: Record<Exclude<Theme["effects"]["bounce"], "none">, string> = {
  ring: "Rings on impact",
  spark: "Sparks on impact",
  ripple: "Ripples on impact",
};
