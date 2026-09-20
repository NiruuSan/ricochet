import { currentUser } from "@/lib/auth-user";
import { json, readBody, sameOrigin } from "@/lib/http";
import { GameError } from "@/lib/matches";
import { chooseReferralCode, referralSummary } from "@/lib/referrals";
import { rateLimited, TOO_MANY_REQUESTS } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** The player's own code, the window it may have opened for them, and what it brought in. */
export async function GET() {
  try {
    const user = await currentUser();
    if (!user) return json({ error: "Sign in to see your referrals." }, 401);
    if (await rateLimited("gameRead", user.userId)) return json({ error: TOO_MANY_REQUESTS }, 429);
    return json(await referralSummary(user.userId));
  } catch (e) {
    if (e instanceof GameError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: "Referrals are unavailable right now." }, 503);
  }
}

/** Choosing your own code. The one you had stays yours, and keeps working. */
export async function POST(req: Request) {
  try {
    if (!sameOrigin(req)) return json({ error: "Request origin rejected." }, 403);
    const user = await currentUser();
    if (!user) return json({ error: "Sign in to change your referral code." }, 401);
    if (await rateLimited("profileWrite", user.userId)) return json({ error: TOO_MANY_REQUESTS }, 429);
    const parsed = await readBody(req, 1024);
    if ("error" in parsed) return json({ error: parsed.error }, parsed.status);
    if (parsed.body.action !== "code") return json({ error: "Unknown action." }, 400);
    return json(await chooseReferralCode(user.userId, parsed.body.code));
  } catch (e) {
    if (e instanceof GameError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: "Your referral code could not be changed." }, 503);
  }
}
