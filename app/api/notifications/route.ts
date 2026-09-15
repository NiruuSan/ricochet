import { currentUser } from "@/lib/auth-user";
import { json, readBody, sameOrigin } from "@/lib/http";
import { markNotificationsRead } from "@/lib/notifications";
import { rateLimited, TOO_MANY_REQUESTS } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    if (!sameOrigin(req)) return json({ error: "Request origin rejected." }, 403);
    const user = await currentUser();
    if (!user) return json({ error: "Sign in to manage notifications." }, 401);
    if (await rateLimited("gameWrite", user.userId)) return json({ error: TOO_MANY_REQUESTS }, 429);
    const parsed = await readBody(req, 4096);
    if ("error" in parsed) return json({ error: parsed.error }, parsed.status);
    if (parsed.body.action !== "read") return json({ error: "Unknown action." }, 400);
    await markNotificationsRead(user.userId, parsed.body);
    return json({ ok: true });
  } catch (e) {
    console.error(e);
    return json({ error: "Notifications could not be updated." }, 503);
  }
}
