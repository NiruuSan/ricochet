import { administrator } from "@/lib/auth-user";
import { setAntiCheatEnabled } from "@/lib/anti-cheat";
import { adminBan, adminLift, adminSuspend, antiCheatOverview } from "@/lib/anti-cheat-admin";
import { json, readBody, sameOrigin } from "@/lib/http";
import { GameError } from "@/lib/matches";
import { rateLimited, TOO_MANY_REQUESTS } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await administrator())) return json({ error: "Administrator access required." }, 403);
  try {
    return json(await antiCheatOverview());
  } catch (e) {
    console.error(e);
    return json({ error: "Anti-cheat data is unavailable." }, 503);
  }
}

export async function POST(req: Request) {
  try {
    if (!sameOrigin(req)) return json({ error: "Request origin rejected." }, 403);
    const user = await administrator();
    if (!user) return json({ error: "Administrator access required." }, 403);
    if (await rateLimited("treasuryWrite", user.userId)) return json({ error: TOO_MANY_REQUESTS }, 429);
    const parsed = await readBody(req, 4096);
    if ("error" in parsed) return json({ error: parsed.error }, parsed.status);
    const b = parsed.body;
    if (b.action === "suspend") return json({ ok: await adminSuspend(user.userId, b.name, b.note).then(() => true) });
    if (b.action === "lift") return json({ ok: await adminLift(user.userId, b.name, b.note).then(() => true) });
    if (b.action === "ban") return json({ seized: await adminBan(user.userId, b.name, b.note) });
    if (b.action === "toggle" && typeof b.enabled === "boolean") return json({ enabled: await setAntiCheatEnabled(user.userId, b.enabled).then(() => b.enabled) });
    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    if (e instanceof GameError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: "The anti-cheat action failed." }, 503);
  }
}
