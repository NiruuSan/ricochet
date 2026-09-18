import { currentUser } from "@/lib/auth-user";
import { claimDailyGems } from "@/lib/daily";
import { json, sameOrigin } from "@/lib/http";
import { GameError } from "@/lib/matches";
import { rateLimited, TOO_MANY_REQUESTS } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** Claims the player's free gems for the day. The day's claim row makes it idempotent. */
export async function POST(req: Request) {
  try {
    if (!sameOrigin(req)) return json({ error: "Request origin rejected." }, 403);
    const user = await currentUser();
    if (!user) return json({ error: "Sign in to claim your daily gems." }, 401);
    if (await rateLimited("profileWrite", user.userId)) return json({ error: TOO_MANY_REQUESTS }, 429);
    return json(await claimDailyGems(user.userId));
  } catch (e) {
    if (e instanceof GameError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: "Your gems could not be claimed. Try again in a moment." }, 503);
  }
}
