import { currentUser } from "@/lib/auth-user";
import { clientKey, json } from "@/lib/http";
import { liveGames } from "@/lib/spectate";
import { rateLimited, TOO_MANY_REQUESTS } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const user = await currentUser();
    const [limited, games] = await Promise.all([rateLimited("publicRead", clientKey(req, user?.userId)), liveGames(user?.userId ?? null)]);
    if (limited) return json({ error: TOO_MANY_REQUESTS }, 429);
    return json(games);
  } catch (e) {
    console.error(e);
    return json({ error: "Live games could not be loaded." }, 503);
  }
}
