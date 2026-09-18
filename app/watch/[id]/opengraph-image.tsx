import { ImageResponse } from "next/og";
import { runCard } from "@/lib/spectate";

export const size = { width: 1200, height: 600 };
export const contentType = "image/png";
export const alt = "A run on Bounce";

const LIME = "#c6f564";
const BRICKS = ["#bb8cff", "#68d9d6", "#c6f564", "#ffd17b", "#9fccfc", "#fa98b4"];

/**
 * The card a shared replay shows in a message or a post: whose run it is and
 * what it scored. Runs nobody may watch yet (a seat still open) fall back to the
 * plain brand card, so a link never leaks a board.
 *
 * Every element here is laid out with flex on purpose: the renderer refuses a
 * box that holds more than one child without one.
 */
export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const card = await runCard(decodeURIComponent(id)).catch(() => null);
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
          <div style={{ fontSize: 22, letterSpacing: 4, color: "#93a1b8" }}>{card ? (card.done ? "FINISHED RUN" : "PLAYING NOW") : "BRICK BATTLE"}</div>
        </div>
        {card ? (
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 30, color: "#93a1b8" }}>{`${card.name} · ${card.context}`}</div>
            <div style={{ display: "flex", alignItems: "baseline", marginTop: 8 }}>
              <div style={{ fontSize: 150, fontWeight: 800, letterSpacing: -6, color: LIME, lineHeight: 1 }}>{card.score.toLocaleString("en")}</div>
              <div style={{ fontSize: 40, color: "#93a1b8", marginLeft: 20 }}>points</div>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 96, fontWeight: 800, letterSpacing: -4, lineHeight: 1.05 }}>Same board.</div>
            <div style={{ fontSize: 96, fontWeight: 800, letterSpacing: -4, lineHeight: 1.05, color: "#8b97aa" }}>Your angle.</div>
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div style={{ fontSize: 26, color: "#93a1b8" }}>{card ? "Watch the replay, shot by shot" : "A brick-breaker with a competitive streak"}</div>
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
