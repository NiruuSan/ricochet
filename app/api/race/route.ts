import { clientKey } from "@/lib/http";
import { rateLimited, TOO_MANY_REQUESTS } from "@/lib/rate-limit";
import { weeklyRace } from "@/lib/weekly-race";

export const dynamic = "force-dynamic";

/**
 * The weekly race standings. They are the same for everyone (the page marks your
 * own row by name), so the CDN serves them for 30 seconds.
 */
export async function GET(req: Request) {
  try {
  // The CDN answers most of these; what reaches here is counted per visitor, so
  // cache-busting query strings cannot turn into a stream of database reads.
  if (await rateLimited("publicRead", clientKey(req))) return Response.json({ error: TOO_MANY_REQUESTS }, { status: 429, headers: { "Cache-Control": "no-store" } });
    return Response.json(await weeklyRace(), { headers: { "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=120" } });
  } catch (e) {
    console.error(e);
    return Response.json({ error: "The weekly race could not be loaded." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
