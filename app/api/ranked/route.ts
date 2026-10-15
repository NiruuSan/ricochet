import { clientKey } from "@/lib/http";
import { avatarUrl } from "@/lib/matches";
import { rateLimited, TOO_MANY_REQUESTS } from "@/lib/rate-limit";
import { seasonStandings } from "@/lib/ranked";

export const dynamic = "force-dynamic";

/**
 * The ranked season's table: the best fifty, Bouncers first. It is the same
 * for everyone — a player's own rank comes with their own data — so the CDN
 * serves it for 30 seconds.
 */
export async function GET(req: Request) {
  try {
    if (await rateLimited("publicRead", clientKey(req))) return Response.json({ error: TOO_MANY_REQUESTS }, { status: 429, headers: { "Cache-Control": "no-store" } });
    return Response.json(await seasonStandings(null, Date.now(), undefined, avatarUrl), { headers: { "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=120" } });
  } catch (e) {
    console.error(e);
    return Response.json({ error: "The ranked table could not be loaded." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
