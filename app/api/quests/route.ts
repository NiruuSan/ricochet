import { currentUser } from "@/lib/auth-user";
import { json, readBody, sameOrigin } from "@/lib/http";
import { GameError } from "@/lib/matches";
import { claimQuest, questBoard } from "@/lib/quests";
import { rateLimited, TOO_MANY_REQUESTS } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** Today's quests, this week's, and how far the player is with each. */
export async function GET() {
  try {
    const user = await currentUser();
    if (!user) return json({ error: "Sign in to see your quests." }, 401);
    if (await rateLimited("gameRead", user.userId)) return json({ error: TOO_MANY_REQUESTS }, 429);
    return json(await questBoard(user.userId));
  } catch (e) {
    if (e instanceof GameError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: "Your quests are unavailable right now." }, 503);
  }
}

/** Takes the gems for one finished quest. */
export async function POST(req: Request) {
  try {
    if (!sameOrigin(req)) return json({ error: "Request origin rejected." }, 403);
    const user = await currentUser();
    if (!user) return json({ error: "Sign in first." }, 401);
    if (await rateLimited("gameWrite", user.userId)) return json({ error: TOO_MANY_REQUESTS }, 429);
    const parsed = await readBody(req, 1024);
    if ("error" in parsed) return json({ error: parsed.error }, parsed.status);
    if (parsed.body.action !== "claim") return json({ error: "Unknown action." }, 400);
    await claimQuest(user.userId, parsed.body.scope, parsed.body.quest);
    return json(await questBoard(user.userId));
  } catch (e) {
    if (e instanceof GameError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: "The quest could not be claimed. Try again." }, 503);
  }
}
