import { administrator } from "@/lib/auth-user";
import { json, readBody, sameOrigin } from "@/lib/http";
import { GameError } from "@/lib/matches";
import { PaymentError } from "@/lib/payments/errors";
import { rateLimited, TOO_MANY_REQUESTS } from "@/lib/rate-limit";
import { adminTournaments, cancelTournament, closeTournamentNow, createTournament } from "@/lib/tournaments";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await administrator())) return json({ error: "Administrator access required." }, 403);
  try {
    return json(await adminTournaments());
  } catch (e) {
    console.error(e);
    return json({ error: "Tournaments are unavailable." }, 503);
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
    if (b.action === "create") return json({ id: await createTournament(b) });
    if (b.action === "cancel") return json({ ok: await cancelTournament(b.id).then(() => true) });
    if (b.action === "close") return json({ ok: await closeTournamentNow(b.id).then(() => true) });
    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    if (e instanceof GameError) return json({ error: e.message }, e.status);
    if (e instanceof PaymentError) return json({ error: e.message }, 400);
    console.error(e);
    return json({ error: "The tournament could not be updated." }, 503);
  }
}
