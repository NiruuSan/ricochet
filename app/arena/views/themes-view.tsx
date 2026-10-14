"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, Gem, Lock, Palette, Play, Sparkles } from "lucide-react";
import type { Theme, ThemeId } from "@/lib/themes";
import { brickRect, initial } from "@/lib/engine";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { request } from "../api";
import { amount, units } from "../format";
import type { PlayerState } from "../arena";
import { brickColours, drawBoard } from "../board-canvas";
import { clearEffects, emitBounce, emitBreak, emitClear } from "../board-effects";
import { isAnimated } from "../board-scenes";
import { playSound } from "../sound";
import { themeStyle } from "../theme";
import styles from "./themes.module.css";
import { toast } from "../feedback";

type Store = { themes: Theme[]; owned: ThemeId[]; equipped: ThemeId };

/** The themes that arrived in the latest drop, marked as such in the shop. */
const NEW: ThemeId[] = ["candy", "frost", "sumi", "outrun", "crystal", "mainnet", "aurora", "highroller"];

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

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The same board, painted in one theme. A scene that moves comes alive while
 * the card is pointed at or focused, and rests otherwise: a page of eighteen
 * animated canvases would cost a phone more than it shows.
 */
function Preview({ theme, live }: { theme: Theme; live: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    drawBoard(canvas, null, SAMPLE, 68, theme, 12);
    if (!live || !isAnimated(theme) || reducedMotion()) return;
    let frame = 0;
    let last = 0;
    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      if (now - last < 33) return;
      last = now;
      drawBoard(canvas, null, SAMPLE, 68, theme, 12 + now / 1000);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [theme, live]);
  return <canvas ref={ref} className={styles.preview} width={472} height={612} aria-label={`${theme.name}: the board`} />;
}

/**
 * The theme at full size, playing itself: bricks go one by one with the
 * theme's own break, bounce and sound, and an emptied board gets its
 * celebration before the bricks come back.
 */
function Showcase({ theme }: { theme: Theme }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    clearEffects();
    if (reducedMotion()) {
      drawBoard(canvas, null, SAMPLE, 68, theme, 12);
      return;
    }
    let bricks = [...SAMPLE.bricks];
    let next = performance.now() + 650;
    let refill = 0;
    let frame = 0;
    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      if (refill && now >= refill) {
        bricks = [...SAMPLE.bricks];
        refill = 0;
        next = now + 700;
      } else if (!refill && now >= next) {
        const index = Math.floor(Math.random() * bricks.length);
        const brick = bricks[index];
        const rect = brickRect(brick);
        emitBounce(theme, rect.x + rect.w / 2, rect.y + rect.h);
        emitBreak(theme, rect.x + rect.w / 2, rect.y + rect.h / 2, brickColours(theme, brick.col, SAMPLE.round)[0]);
        playSound("break");
        bricks = bricks.filter((_, k) => k !== index);
        next = now + 430;
        if (!bricks.length) {
          emitClear(theme);
          playSound("clear");
          refill = now + 2400;
        }
      }
      drawBoard(canvas, null, { ...SAMPLE, bricks }, 68, theme, 12 + now / 1000);
    };
    frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      clearEffects();
    };
  }, [theme]);
  return <canvas ref={ref} className={styles.showcaseBoard} width={472} height={612} aria-label={`${theme.name}, playing`} />;
}

const priceOf = (theme: Theme) =>
  theme.price === null ? "Free" : theme.price.asset === "gems" ? `${units(theme.price.amount, "gems")} gems` : `${amount(theme.price.amount, "devnet")}`;

/** Free first, then gems from cheapest, then SOL from cheapest. */
const rank = (theme: Theme) => (theme.price === null ? 0 : theme.price.asset === "gems" ? 1 + theme.price.amount / 1e6 : 10 + theme.price.amount / 1e9);

/** What sets a theme apart, in a few words. */
function traits(theme: Theme) {
  const list = [theme.board.brick && theme.board.brick !== "flat" ? BRICKS[theme.board.brick] : theme.board.radius === 0 ? "Square bricks" : theme.board.radius >= 10 ? "Very round bricks" : "Rounded bricks"];
  if (theme.board.scene) list.push(isAnimated(theme) ? `${SCENES[theme.board.scene]} · animated` : SCENES[theme.board.scene]);
  list.push(BURSTS[theme.effects.burst]);
  if (theme.effects.trail) list.push("Ball trail");
  if (theme.effects.bounce !== "none") list.push(BOUNCES[theme.effects.bounce]);
  list.push(CLEARS[theme.effects.clear]);
  return list;
}

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
  const [hovered, setHovered] = useState<ThemeId | null>(null);
  const [showing, setShowing] = useState<Theme | null>(null);

  const load = useCallback(
    () => request<Store>("/api/themes").then((next) => setStore(next), (e: Error) => setError(e.message)),
    [],
  );
  useEffect(() => void load(), [load]);

  const act = async (theme: Theme, action: "buy" | "equip") => {
    setBusy(theme.id);
    setError("");
    try {
      const next = await request<Store>("/api/themes", { action, theme: theme.id });
      setStore((current) => (current ? { ...current, ...next } : current));
      toast(action === "buy" ? `${theme.name} is yours, and on the board.` : `${theme.name} it is.`);
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
  const themes = store ? [...store.themes].sort((a, b) => rank(a) - rank(b)) : [];

  /** The button under a theme: wear it, buy it, or say what it costs. */
  const action = (theme: Theme) => {
    if (!player.data.player || !store) return null;
    const owned = store.owned.includes(theme.id);
    const worn = store.equipped === theme.id;
    const affordable = theme.price === null || (theme.price.asset === "gems" ? gems >= theme.price.amount : sol >= theme.price.amount);
    if (worn)
      return (
        <button className="btn" disabled>
          On the board
        </button>
      );
    if (owned)
      return (
        <button className="btn btn-primary" disabled={busy === theme.id} onClick={() => void act(theme, "equip")}>
          {busy === theme.id ? "Changing…" : "Wear this"}
        </button>
      );
    return (
      <button className="btn btn-primary" disabled={busy === theme.id || !affordable} onClick={() => void act(theme, "buy")}>
        {busy === theme.id ? (
          "Buying…"
        ) : affordable ? (
          `Buy · ${priceOf(theme)}`
        ) : (
          <>
            <Lock size={13} /> {priceOf(theme)}
          </>
        )}
      </button>
    );
  };

  return (
    <section className="subpage">
      <div className="page-intro">
        <div>
          <div className="tag lime">THE SAME BOARD, YOUR WAY</div>
          <h1>Themes.</h1>
          <p>
            Eighteen looks for the arena: colours, scenes behind the board, bricks of glass, gems or light, what a brick does when it breaks, and the type on the
            board. A theme is paint and nothing else — the board, the physics and every angle stay exactly as they are, whichever one you wear.
          </p>
        </div>
      </div>

      {error && (
        <div className="error" role="alert">
          <span>{error}</span>
        </div>
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
          {themes.map((theme) => {
            const owned = store.owned.includes(theme.id);
            const worn = store.equipped === theme.id;
            const premium = theme.price?.asset === "devnet";
            return (
              <article
                key={theme.id}
                className={`${styles.card} ${worn ? styles.worn : ""} ${premium ? styles.premium : ""}`}
                style={themeStyle(theme)}
                onPointerEnter={() => setHovered(theme.id)}
                onPointerLeave={() => setHovered((h) => (h === theme.id ? null : h))}
                onFocus={() => setHovered(theme.id)}
              >
                <button type="button" className={styles.previewButton} onClick={() => setShowing(theme)} aria-label={`See ${theme.name} in play`}>
                  <Preview theme={theme} live={hovered === theme.id} />
                  <span className={styles.play}>
                    <Play size={14} /> See it in play
                  </span>
                  {NEW.includes(theme.id) && !owned && <span className={styles.newBadge}>NEW</span>}
                </button>
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
                    {traits(theme).map((trait) => (
                      <li key={trait}>{trait}</li>
                    ))}
                  </ul>
                  {action(theme)}
                </div>
              </article>
            );
          })}
        </div>
      )}

      <Dialog open={!!showing} onOpenChange={(open) => !open && setShowing(null)}>
        <DialogContent className={`dialog-dark ${styles.showcase}`} style={showing ? themeStyle(showing) : undefined}>
          {showing && (
            <>
              <Showcase theme={showing} />
              <div className={styles.showcaseSide}>
                <DialogTitle className={styles.showcaseTitle}>{showing.name}</DialogTitle>
                <DialogDescription>{showing.tagline}</DialogDescription>
                <ul className={styles.traits}>
                  {traits(showing).map((trait) => (
                    <li key={trait}>{trait}</li>
                  ))}
                </ul>
                <p className={styles.showcasePrice}>
                  {store?.owned.includes(showing.id) ? "In your collection" : showing.price === null ? "Free for everyone" : priceOf(showing)}
                </p>
                {action(showing)}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <p className={styles.footnote}>
        <Sparkles size={14} /> Bought with gems or devnet SOL, worn for good. A theme never changes a board, a bounce or a payout.
      </p>
    </section>
  );
}

const BRICKS: Record<Exclude<NonNullable<Theme["board"]["brick"]>, "flat">, string> = {
  glossy: "Jelly bricks",
  gem: "Cut-gem bricks",
  glass: "Glass bricks",
  neon: "Bricks of light",
  chip: "Casino-chip bricks",
  ink: "Brushstroke bricks",
  gradient: "Gradient bricks",
};

const SCENES: Record<NonNullable<Theme["board"]["scene"]>, string> = {
  stars: "Starfield",
  aurora: "Northern lights",
  outrun: "Sunset highway",
  ink: "Ink landscape",
  snow: "Falling snow",
  cave: "Glowing cavern",
  felt: "Gold-railed table",
  pulse: "Block beams",
  candy: "Sugar bokeh",
};

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
  crystals: "Bricks burst into crystals",
  stars: "Bricks burst into stars",
  snow: "Bricks turn to snow",
  ink: "Bricks bleed ink",
  coins: "Bricks pay out coins",
  sprinkles: "Bricks throw sprinkles",
};

const BOUNCES: Record<Exclude<Theme["effects"]["bounce"], "none">, string> = {
  ring: "Rings on impact",
  spark: "Sparks on impact",
  ripple: "Ripples on impact",
};

const CLEARS: Record<Theme["effects"]["clear"], string> = {
  wash: "A wash of colour on a clear",
  rays: "Rays on a clear",
  confetti: "Confetti on a clear",
  shockwave: "A shockwave on a clear",
  fireworks: "Fireworks on a clear",
  jackpot: "A jackpot on a clear",
};
