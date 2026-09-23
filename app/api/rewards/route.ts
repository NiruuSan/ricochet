import { currentUser } from "@/lib/auth-user";
import { json, readBody, sameOrigin } from "@/lib/http";
import { GameError } from "@/lib/matches";
import { rateLimited, TOO_MANY_REQUESTS } from "@/lib/rate-limit";
import { claimReward, rewards, TIERS } from "@/lib/rewards";

export const dynamic = "force-dynamic";

/** The cashback waiting for this player, and the grid it comes from. */
export async function GET() {
  try {
    const user = await currentUser();
    if (!user) return json({ error: "Sign in to see your cashback." }, 401);
    return json({ tiers: TIERS, rewards: await rewards(user.userId) });
  } catch (e) {
    console.error(e);
    return json({ error: "Cashback is unavailable." }, 503);
  }
}

export async function POST(req: Request) {
  try {
    if (!sameOrigin(req)) return json({ error: "Request origin rejected." }, 403);
    const user = await currentUser();
    if (!user) return json({ error: "Sign in to claim your cashback." }, 401);
    if (await rateLimited("themeWrite", user.userId)) return json({ error: TOO_MANY_REQUESTS }, 429);
    const parsed = await readBody(req, 512);
    if ("error" in parsed) return json({ error: parsed.error }, parsed.status);
    if (parsed.body.action !== "claim") return json({ error: "Unknown reward action." }, 400);
    await claimReward(user.userId, parsed.body.scope);
    return json({ tiers: TIERS, rewards: await rewards(user.userId) });
  } catch (e) {
    if (e instanceof GameError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: "That did not go through. Please try again." }, 503);
  }
}
