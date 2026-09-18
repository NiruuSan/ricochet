import { currentUser } from "@/lib/auth-user";
import { database } from "@/db/raw";
import { json, readBody, sameOrigin } from "@/lib/http";
import { parseSubscription, pushConfig, removeSubscription, saveSubscription, validPushEndpoint } from "@/lib/push";
import { rateLimited, TOO_MANY_REQUESTS } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await currentUser())) return json({ error: "Sign in first." }, 401);
  return json({ publicKey: pushConfig()?.publicKey ?? null });
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: "Request origin rejected." }, 403);
  const user = await currentUser();
  if (!user) return json({ error: "Sign in first." }, 401);
  try {
    if (await rateLimited("gameWrite", user.userId)) return json({ error: TOO_MANY_REQUESTS }, 429);
    const parsed = await readBody(req, 4096);
    if ("error" in parsed) return json({ error: parsed.error }, parsed.status);
    const b = parsed.body;
    if (b.action === "status" || b.action === "unsubscribe") {
      if (!validPushEndpoint(b.endpoint)) return json({ error: "Invalid subscription." }, 400);
      if (b.action === "unsubscribe") await removeSubscription(user.userId, b.endpoint);
      const row = await database().prepare("SELECT 1 FROM push_subscriptions WHERE user_id = ? AND endpoint = ?").bind(user.userId, b.endpoint).first();
      return json({ subscribed: !!row });
    }
    if (b.action !== "subscribe") return json({ error: "Unknown action." }, 400);
    if (!pushConfig()) return json({ error: "Push notifications are not configured yet." }, 503);
    if (!(await database().prepare("SELECT 1 FROM players WHERE id = ?").bind(user.userId).first())) return json({ error: "Create your profile first." }, 403);
    const subscription = parseSubscription(b.subscription);
    if (!subscription) return json({ error: "Invalid subscription." }, 400);
    await saveSubscription(user.userId, subscription);
    return json({ subscribed: true });
  } catch {
    return json({ error: "Unable to update push notifications. Try again." }, 503);
  }
}
