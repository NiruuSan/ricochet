import { currentUser } from "@/lib/auth-user";
import { clientKey, json, readBody, sameOrigin } from "@/lib/http";
import { GameError } from "@/lib/matches";
import { PaymentError } from "@/lib/payments/errors";
import { rateLimited, TOO_MANY_REQUESTS } from "@/lib/rate-limit";
import { listTournaments, registerForTournament, startTournamentRun } from "@/lib/tournaments";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const user = await currentUser();
    const [limited, list] = await Promise.all([rateLimited("publicRead", clientKey(req, user?.userId)), listTournaments(user?.userId ?? null)]);
    if (limited) return json({ error: TOO_MANY_REQUESTS }, 429);
    return json(list);
  } catch (e) {
    console.error(e);
    return json({ error: "Tournaments are unavailable right now." }, 503);
  }
}

export async function POST(req: Request) {
  try {
    if (!sameOrigin(req)) return json({ error: "Request origin rejected." }, 403);
    const user = await currentUser();
    if (!user) return json({ error: "Sign in to enter tournaments." }, 401);
    if (await rateLimited("tournamentWrite", user.userId)) return json({ error: TOO_MANY_REQUESTS }, 429);
    const parsed = await readBody(req, 2048);
    if ("error" in parsed) return json({ error: parsed.error }, parsed.status);
    const b = parsed.body;
    if (b.action === "register") {
      await registerForTournament(user.userId, b.id);
      return json({ ok: true });
    }
    if (b.action === "play") return json({ run: await startTournamentRun(user.userId, b.id) });
    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    if (e instanceof GameError) return json({ error: e.message }, e.status);
    if (e instanceof PaymentError) return json({ error: e.message }, 400);
    console.error(e);
    return json({ error: "The request could not be completed. Please try again." }, 503);
  }
}
