import { ImageResponse } from "next/og";
import type { Asset } from "@/lib/api-types";
import { runCard } from "@/lib/spectate";

export const size = { width: 1200, height: 600 };
export const contentType = "image/png";
export const alt = "A run on Bounce";

const LIME = "#c6f564";
const MUTED = "#93a1b8";
const BRICKS = ["#bb8cff", "#68d9d6", "#c6f564", "#ffd17b", "#9fccfc", "#fa98b4"];

/** An entry as a post reads it: SOL to four places, gems whole. */
const entry = (stake: number, asset: Asset) =>
  asset === "gems" ? `${stake.toLocaleString("en")} gems` : `${(stake / 1e9).toLocaleString("en", { maximumFractionDigits: 4 })} SOL`;

/** One side of a settled match: the name above, the score below, lit up for the winner (both, on a draw). */
function Side({ name, score, chip, right = false }: { name: string; score: number; chip: string | null; right?: boolean }) {
  const tag = chip && (
    <div style={{ display: "flex", padding: "4px 12px", borderRadius: 999, background: LIME, color: "#12170b", fontSize: 18, letterSpacing: 2, [right ? "marginLeft" : "marginRight"]: 14 }}>
      {chip}
    </div>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: right ? "flex-end" : "flex-start", width: 470 }}>
      <div style={{ display: "flex", alignItems: "center", fontSize: 32, color: chip ? "#f6f8fd" : MUTED, fontWeight: 700 }}>
        {!right && tag}
        {name}
        {right && tag}
      </div>
      <div style={{ fontSize: 132, fontWeight: 800, letterSpacing: -6, lineHeight: 1, marginTop: 6, color: chip ? LIME : "#5d6a80" }}>{score.toLocaleString("en")}</div>
    </div>
  );
}

/**
 * The card a shared replay shows in a message or a post: whose run it is and
 * what it scored, and once a match is over, both scores side by side. Runs
 * nobody may watch yet (a seat still open) fall back to the plain brand card,
 * so a link never leaks a board.
 *
 * Every element here is laid out with flex on purpose: the renderer refuses a
 * box that holds more than one child without one.
 */
export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const card = await runCard(decodeURIComponent(id)).catch(() => null);
  const versus = card?.versus ?? null;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background: "#0c1018",
          color: "#f6f8fd",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <div style={{ width: 54, height: 54, borderRadius: 16, background: LIME, marginRight: 18 }} />
            <div style={{ fontSize: 42, fontWeight: 800, letterSpacing: -1 }}>bounce.</div>
          </div>
          <div style={{ display: "flex", fontSize: 22, letterSpacing: 4, color: MUTED }}>
            {versus ? `1V1 · ${entry(versus.stake, card!.asset).toUpperCase()}` : card ? (card.done ? "FINISHED RUN" : "PLAYING NOW") : "BRICK BATTLE"}
          </div>
        </div>
        {card && versus ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <Side name={card.name} score={card.score} chip={versus.result === "draw" ? "DRAW" : versus.result === "win" ? "WIN" : null} />
            <div style={{ display: "flex", fontSize: 30, fontWeight: 800, color: "#4b5870", letterSpacing: 2 }}>VS</div>
            <Side name={versus.opponent} score={versus.score} chip={versus.result === "draw" ? "DRAW" : versus.result === "loss" ? "WIN" : null} right />
          </div>
        ) : card ? (
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 30, color: MUTED }}>{`${card.name} · ${card.context}`}</div>
            <div style={{ display: "flex", alignItems: "baseline", marginTop: 8 }}>
              <div style={{ fontSize: 150, fontWeight: 800, letterSpacing: -6, color: LIME, lineHeight: 1 }}>{card.score.toLocaleString("en")}</div>
              <div style={{ fontSize: 40, color: MUTED, marginLeft: 20 }}>points</div>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 96, fontWeight: 800, letterSpacing: -4, lineHeight: 1.05 }}>Same board.</div>
            <div style={{ fontSize: 96, fontWeight: 800, letterSpacing: -4, lineHeight: 1.05, color: "#8b97aa" }}>Your angle.</div>
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div style={{ fontSize: 26, color: MUTED }}>
            {versus ? "Same board. One run each. Watch how it was won." : card ? "Watch the replay, shot by shot" : "A brick-breaker with a competitive streak"}
          </div>
          <div style={{ display: "flex" }}>
            {BRICKS.map((color, i) => (
              <div key={color} style={{ width: 54, height: 54, borderRadius: 10, marginLeft: 10, background: color, opacity: card ? 1 - i * 0.12 : 0.5 }} />
            ))}
          </div>
        </div>
      </div>
    ),
    size,
  );
}
