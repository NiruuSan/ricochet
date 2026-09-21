import { currentUser } from "@/lib/auth-user";
import { answerFriend, conversation, friendList, removeFriend, requestFriend, sendMessage } from "@/lib/friends";
import { json, readBody, sameOrigin } from "@/lib/http";
import { GameError } from "@/lib/matches";
import { blockPlayer, reportPlayer, unblockPlayer } from "@/lib/moderation";
import { rateLimited, TOO_MANY_REQUESTS } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** The friends list, or one conversation with `?with=<name>`. */
export async function GET(req: Request) {
  try {
    const user = await currentUser();
    if (!user) return json({ error: "Sign in to see your friends." }, 401);
    if (await rateLimited("gameRead", user.userId)) return json({ error: TOO_MANY_REQUESTS }, 429);
    const name = new URL(req.url).searchParams.get("with");
    if (name) return json({ messages: await conversation(user.userId, name) });
    return json(await friendList(user.userId));
  } catch (e) {
    if (e instanceof GameError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: "Your friends are unavailable right now." }, 503);
  }
}

export async function POST(req: Request) {
  try {
    if (!sameOrigin(req)) return json({ error: "Request origin rejected." }, 403);
    const user = await currentUser();
    if (!user) return json({ error: "Sign in first." }, 401);
    if (await rateLimited("profileWrite", user.userId)) return json({ error: TOO_MANY_REQUESTS }, 429);
    const parsed = await readBody(req, 2048);
    if ("error" in parsed) return json({ error: parsed.error }, parsed.status);
    const b = parsed.body;
    switch (b.action) {
      case "request":
        return json(await requestFriend(user.userId, b.name));
      case "accept":
        return json(await answerFriend(user.userId, b.name, true));
      case "decline":
        return json(await answerFriend(user.userId, b.name, false));
      case "remove":
        return json(await removeFriend(user.userId, b.name));
      case "message":
        return json(await sendMessage(user.userId, b.name, b.body));
      case "block":
        return json(await blockPlayer(user.userId, b.name));
      case "unblock":
        return json(await unblockPlayer(user.userId, b.name));
      case "report":
        return json(await reportPlayer(user.userId, b.name, b.kind, b.detail));
      default:
        return json({ error: "Unknown action." }, 400);
    }
  } catch (e) {
    if (e instanceof GameError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: "That could not be done. Try again." }, 503);
  }
}
