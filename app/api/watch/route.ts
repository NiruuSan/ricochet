import { currentUser } from "@/lib/auth-user";
import { clientKey, json } from "@/lib/http";
import { liveGames } from "@/lib/spectate";
import { rateLimited, TOO_MANY_REQUESTS } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** The Live board: every run in progress the visitor may know about. */
export async function GET(req: Request) {
  try {
    const user = await currentUser();
    const [limited, games] = await Promise.all([rateLimited("publicRead", clientKey(req, user?.userId)), liveGames(user?.userId ?? null, Date.now(), 24)]);
    if (limited) return json({ error: TOO_MANY_REQUESTS }, 429);
    return json(games);
  } catch (e) {
    console.error(e);
    return json({ error: "Live games could not be loaded." }, 503);
  }
}
