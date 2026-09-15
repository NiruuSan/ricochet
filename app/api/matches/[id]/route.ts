import { currentUser } from "@/lib/auth-user";
import { json } from "@/lib/http";
import { GameError, matchRecap } from "@/lib/matches";
import { rateLimited, TOO_MANY_REQUESTS } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await currentUser();
    if (!user) return json({ error: "Sign in to see your match." }, 401);
    if (await rateLimited("gameRead", user.userId)) return json({ error: TOO_MANY_REQUESTS }, 429);
    return json(await matchRecap(user.userId, (await params).id));
  } catch (e) {
    if (e instanceof GameError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: "The match result could not be loaded. Please try again." }, 503);
  }
}
