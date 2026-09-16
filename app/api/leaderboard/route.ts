import type { Asset } from "@/lib/api-types";
import { leaderboard } from "@/lib/matches";

export const dynamic = "force-dynamic";

/**
 * The public top 50 for one currency. It is the same for everyone (the page marks
 * your own row by name), so the CDN serves it for 30 seconds and refreshes it in
 * the background, instead of recomputing it for every visit.
 */
export async function GET(req: Request) {
  try {
    const asset: Asset = new URL(req.url).searchParams.get("asset") === "devnet" ? "devnet" : "gems";
    const leaders = (await leaderboard(null, asset)).map(({ name, avatar, pnl, games }) => ({ name, avatar, pnl, games }));
    return Response.json(leaders, { headers: { "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=300" } });
  } catch (e) {
    console.error(e);
    return Response.json({ error: "The leaderboard could not be loaded." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
