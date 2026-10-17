import { elevate, elevatedUntil, requestNetwork, sessionKey } from "@/lib/admin-guard";
import { administrator } from "@/lib/auth-user";
import { json, readBody, sameOrigin } from "@/lib/http";
import { rateLimited, TOO_MANY_REQUESTS } from "@/lib/rate-limit";
import { TwoFactorError } from "@/lib/two-factor";

export const dynamic = "force-dynamic";

/** Whether this session may read the admin and make changes right now, and until when. */
export async function GET() {
  const user = await administrator();
  if (!user) return json({ error: "Administrator access required." }, 403);
  return json(await elevatedUntil(user.userId, await sessionKey(), Date.now(), await requestNetwork()));
}

/** A code from the administrator's authenticator opens a short window on this session. */
export async function POST(req: Request) {
  try {
    if (!sameOrigin(req)) return json({ error: "Request origin rejected." }, 403);
    const user = await administrator();
    if (!user) return json({ error: "Administrator access required." }, 403);
    if (await rateLimited("securityWrite", user.userId)) return json({ error: TOO_MANY_REQUESTS }, 429);
    const parsed = await readBody(req, 512);
    if ("error" in parsed) return json({ error: parsed.error }, parsed.status);
    return json(await elevate(user.userId, await sessionKey(), parsed.body.code, Date.now(), await requestNetwork()));
  } catch (e) {
    if (e instanceof TwoFactorError) return json({ error: e.message, code: e.code }, e.code === "TWO_FACTOR_REQUIRED" ? 403 : 400);
    console.error(e);
    return json({ error: "The code could not be checked. Try again." }, 503);
  }
}
