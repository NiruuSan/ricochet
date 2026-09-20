import { administrator } from "@/lib/auth-user";
import { adminPlayers, purgePlayer } from "@/lib/admin-players";
import { json, readBody, sameOrigin } from "@/lib/http";
import { GameError } from "@/lib/matches";
import { rateLimited, TOO_MANY_REQUESTS } from "@/lib/rate-limit";
import { TwoFactorError } from "@/lib/two-factor";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await administrator())) return json({ error: "Administrator access required." }, 403);
  try {
    return json(await adminPlayers());
  } catch (e) {
    console.error(e);
    return json({ error: "The player list is unavailable." }, 503);
  }
}

export async function POST(req: Request) {
  try {
    if (!sameOrigin(req)) return json({ error: "Request origin rejected." }, 403);
    const user = await administrator();
    if (!user) return json({ error: "Administrator access required." }, 403);
    if (await rateLimited("securityWrite", user.userId)) return json({ error: TOO_MANY_REQUESTS }, 429);
    const parsed = await readBody(req, 2048);
    if ("error" in parsed) return json({ error: parsed.error }, parsed.status);
    const b = parsed.body;
    // Development-phase tool: removes an account and everything attached to it.
    if (b.action === "delete") return json(await purgePlayer(user.userId, b.name, b.code, b.reason));
    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    if (e instanceof TwoFactorError) return json({ error: e.message, code: e.code }, e.code === "TWO_FACTOR_REQUIRED" ? 403 : 400);
    if (e instanceof GameError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: "The account could not be deleted." }, 503);
  }
}
