import type { Metadata } from "next";
import Link from "next/link";
import styles from "./not-found.module.css";

export const metadata: Metadata = { title: "Off the board — Bounce", robots: { index: false } };

/** Three bricks wide, five tall, per digit. A filled cell is a brick. */
const DIGITS: Record<string, string[]> = {
  "4": ["x.x", "x.x", "xxx", "..x", "..x"],
  "0": ["xxx", "x.x", "x.x", "x.x", "xxx"],
};
/** One colour per digit. A brick each, as on the board, would scatter the shapes
 *  so far that the number stops being a number. */
const PALETTE = ["#bb8cff", "#68d9d6", "#ffd17b"];
const CELL = 46;
const GAP = 7;
const STEP = CELL + GAP;
/** One digit to the next. The space between them is wider than the space between
 *  bricks, or the three digits read as one wall. */
const DIGIT_STEP = STEP * 3 + 54;

/** Every brick of "404", with the colour it is painted and the number it carries. */
const BRICKS = "404".split("").flatMap((digit, index) =>
  DIGITS[digit].flatMap((row, y) =>
    [...row].map((cell, x) =>
      cell === "x"
        ? { key: `${index}:${x}:${y}`, x: index * DIGIT_STEP + x * STEP, y: y * STEP, colour: PALETTE[index], hp: ((x + y * 2 + index) % 9) + 1 }
        : null,
    ),
  ),
).filter((brick): brick is NonNullable<typeof brick> => brick !== null);

const WIDTH = DIGIT_STEP * 2 + STEP * 3 - GAP;
const HEIGHT = STEP * 5 - GAP;
/**
 * The corridor between the last two digits: the only column that is empty from
 * the floor to the ceiling. A zero is a closed ring, so a shot "through the
 * hole" has to break the bar above or below it — this one breaks nothing.
 */
const CORRIDOR = (DIGIT_STEP + STEP * 2 + CELL + DIGIT_STEP * 2) / 2;
const LAUNCH = { x: CORRIDOR - 6, y: HEIGHT + 100 };
const TRAIL = `M${LAUNCH.x} ${LAUNCH.y} L${CORRIDOR + 9} -34`;

/**
 * The page that is not there. A brick-breaker knows what a miss looks like, so
 * this one says it that way: the shot goes up the one gap where there is
 * nothing to hit, and the way back to the arena is the brightest thing on
 * screen.
 */
export default function NotFound() {
  return (
    <div className={styles.page}>
      <header className={styles.bar}>
        <Link href="/" aria-label="Bounce home">
          {/* eslint-disable-next-line @next/next/no-img-element -- the brand mark is a fixed SVG, not a photograph to optimise. */}
          <img src="/brand/bounce-white.svg" alt="Bounce" width={147} height={36} />
        </Link>
      </header>

      <main className={styles.body}>
        <div className={styles.copy}>
          <div className={styles.eyebrow}>
            <i />
            <span className="tag">ERROR 404 · OFF THE BOARD</span>
          </div>
          <h1>
            That angle
            <span>missed.</span>
          </h1>
          <p>
            There is no page at this address. The shot went straight up the gap and out of the board without touching a brick, and nothing came back. Take another
            angle from the arena, or find a rival waiting at an entry.
          </p>
          <div className={styles.actions}>
            <Link className="btn btn-primary" href="/">
              Back to the arena
            </Link>
            <Link className="btn" href="/faq">
              How to play
            </Link>
          </div>
          <nav className={styles.links} aria-label="Elsewhere on Bounce">
            <Link href="/live">Live games</Link>
            <Link href="/tournaments">Tournaments</Link>
            <Link href="/leaderboard">Leaderboard</Link>
            <Link href="/quests">Quests</Link>
          </nav>
        </div>

        <div className={styles.art}>
          <svg viewBox={`-34 -34 ${WIDTH + 68} ${HEIGHT + 168}`} fill="none" role="img" aria-label="The digits 404 built out of bricks, with a shot passing up the empty gap between them">
            <g transform={`rotate(-4 ${WIDTH / 2} ${HEIGHT / 2})`}>
              {/* Behind the bricks, so the shot only shows where there is nothing to hit. */}
              <path d={TRAIL} stroke="#c6f564" strokeWidth="2.5" strokeDasharray="3 10" strokeLinecap="round" opacity=".6" />
              {BRICKS.map(({ key, x, y, colour, hp }) => (
                <g key={key}>
                  <rect x={x} y={y + 5} width={CELL} height={CELL} rx="8" fill={colour} opacity=".32" />
                  <rect x={x} y={y} width={CELL} height={CELL} rx="8" fill={colour} />
                  <path d={`M${x + 9} ${y + 6}h${CELL - 18}`} stroke="white" strokeOpacity=".3" strokeWidth="2" />
                  <text x={x + CELL / 2} y={y + CELL / 2 + 6} fill="#162238" textAnchor="middle" fontSize="17" fontWeight="800">
                    {hp}
                  </text>
                </g>
              ))}
              <circle cx={LAUNCH.x} cy={LAUNCH.y} r="22" stroke="#c6f564" strokeOpacity=".18" />
              <circle cx={LAUNCH.x} cy={LAUNCH.y} r="12" fill="#c6f564" fillOpacity=".12" />
              <circle cx={LAUNCH.x} cy={LAUNCH.y} r="6" fill="#eaffc0" />
            </g>
          </svg>
          <p className={styles.caption}>
            EVERY BOUNCE COUNTS <span>↗</span>
          </p>
        </div>
      </main>
    </div>
  );
}
