import { dispatchPush } from "@/lib/push";
import { sweepStaleMatches } from "@/lib/expiry";
import { json } from "@/lib/http";
import { settleDueTournaments } from "@/lib/tournaments";

export const dynamic = "force-dynamic";

/**
 * The scheduled sweep (vercel.json): ends runs nobody came back to, closes seats
 * nobody took and pays out tournaments that have ended. Vercel Cron sends
 * `Authorization: Bearer $CRON_SECRET`; without the secret set, only a request
 * carrying it is accepted, so the route is never open.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return json({ error: "Not found." }, 404);
  try {
    const swept = await sweepStaleMatches();
    await settleDueTournaments();
    await dispatchPush();
    return json({ ok: true, ...swept });
  } catch (e) {
    console.error(e);
    return json({ error: "The sweep failed." }, 503);
  }
}
