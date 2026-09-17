import { administrator } from "@/lib/auth-user";
import { json, readBody, sameOrigin } from "@/lib/http";
import { GameError } from "@/lib/matches";
import { rateLimited, TOO_MANY_REQUESTS } from "@/lib/rate-limit";
import { adminRaces, payWeeklyRace, setRaceExclusion, setRacePrizes } from "@/lib/weekly-race";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await administrator())) return json({ error: "Administrator access required." }, 403);
  try {
    return json(await adminRaces());
  } catch (e) {
    console.error(e);
    return json({ error: "The weekly race is unavailable." }, 503);
  }
}

export async function POST(req: Request) {
  try {
    if (!sameOrigin(req)) return json({ error: "Request origin rejected." }, 403);
    const user = await administrator();
    if (!user) return json({ error: "Administrator access required." }, 403);
    if (await rateLimited("treasuryWrite", user.userId)) return json({ error: TOO_MANY_REQUESTS }, 429);
    const parsed = await readBody(req, 4096);
    if ("error" in parsed) return json({ error: parsed.error }, parsed.status);
    const b = parsed.body;
    if (b.action === "pay") return json({ winners: await payWeeklyRace(user.userId, b.week) });
    if (b.action === "exclude") return json({ ok: await setRaceExclusion(user.userId, { ...b, excluded: true }).then(() => true) });
    if (b.action === "include") return json({ ok: await setRaceExclusion(user.userId, { ...b, excluded: false }).then(() => true) });
    if (b.action === "prizes") return json({ prizes: await setRacePrizes(user.userId, b.prizes) });
    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    if (e instanceof GameError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: "The weekly race could not be updated." }, 503);
  }
}
