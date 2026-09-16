import { currentUser } from "@/lib/auth-user";
import { arenaOverview } from "@/lib/arena";
import { clientKey, json } from "@/lib/http";
import { rateLimited, TOO_MANY_REQUESTS } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const user = await currentUser();
    const [limited, overview] = await Promise.all([rateLimited("publicRead", clientKey(req, user?.userId)), arenaOverview(user?.userId ?? null)]);
    if (limited) return json({ error: TOO_MANY_REQUESTS }, 429);
    return json(overview);
  } catch (e) {
    console.error(e);
    return json({ error: "The arena could not be loaded." }, 503);
  }
}
