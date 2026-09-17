import { weeklyRace } from "@/lib/weekly-race";

export const dynamic = "force-dynamic";

/**
 * The weekly race standings. They are the same for everyone (the page marks your
 * own row by name), so the CDN serves them for 30 seconds.
 */
export async function GET() {
  try {
    return Response.json(await weeklyRace(), { headers: { "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=120" } });
  } catch (e) {
    console.error(e);
    return Response.json({ error: "The weekly race could not be loaded." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
