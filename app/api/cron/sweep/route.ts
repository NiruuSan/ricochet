import { dispatchPush } from "@/lib/push";
import { sweepStaleMatches } from "@/lib/expiry";
import { json } from "@/lib/http";
import { ensureDailyTournaments, settleDueTournaments } from "@/lib/tournaments";
import { cleanupBugAttachments } from "@/lib/bug-attachments";

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
    // The daily cup: the next few days are always on the board.
    const dailyCups = (await ensureDailyTournaments()).length;
    await dispatchPush();
    const attachmentsRemoved = await cleanupBugAttachments();
    return json({ ok: true, ...swept, dailyCups, attachmentsRemoved });
  } catch (e) {
    console.error(e);
    return json({ error: "The sweep failed." }, 503);
  }
}
