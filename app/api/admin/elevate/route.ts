import { elevate, elevatedUntil, elevateWithPasskey, requestNetwork, sessionKey } from "@/lib/admin-guard";
import { authenticationOptions, PasskeyError, passkeyOnly, passkeysHere } from "@/lib/admin-passkeys";
import { administrator } from "@/lib/auth-user";
import { json, readBody, sameOrigin } from "@/lib/http";
import { rateLimited, TOO_MANY_REQUESTS } from "@/lib/rate-limit";
import { TwoFactorError } from "@/lib/two-factor";

export const dynamic = "force-dynamic";

/**
 * Whether this session may read the admin and make changes right now, and
 * until when; and how it can open them: how many passkeys work on this site,
 * and whether an app code still does.
 */
export async function GET(req: Request) {
  const user = await administrator();
  if (!user) return json({ error: "Administrator access required." }, 403);
  const origin = new URL(req.url).origin;
  const [windows, passkeys, only] = await Promise.all([elevatedUntil(user.userId, await sessionKey(), Date.now(), await requestNetwork()), passkeysHere(user.userId, origin), passkeyOnly()]);
  return json({ ...windows, passkeys, passkeyOnly: only });
}

/**
 * Opens the admin on this session: with a code from the administrator's
 * authenticator, or with a passkey — first `{ action: "passkey-options" }` for
 * the challenge, then `{ passkey }` with the browser's answer to it.
 */
export async function POST(req: Request) {
  try {
    if (!sameOrigin(req)) return json({ error: "Request origin rejected." }, 403);
    const user = await administrator();
    if (!user) return json({ error: "Administrator access required." }, 403);
    if (await rateLimited("securityWrite", user.userId)) return json({ error: TOO_MANY_REQUESTS }, 429);
    const parsed = await readBody(req, 8192);
    if ("error" in parsed) return json({ error: parsed.error }, parsed.status);
    const body = parsed.body;
    const session = await sessionKey();
    if (!session) return json({ error: "Sign in again to open the admin." }, 401);
    // Checked as same-origin above: the address the page was served from.
    const origin = new URL(req.url).origin;
    if (body.action === "passkey-options") return json(await authenticationOptions(user.userId, session, origin));
    if (body.passkey) return json(await elevateWithPasskey(user.userId, session, origin, body.passkey, Date.now(), await requestNetwork()));
    return json(await elevate(user.userId, session, body.code, Date.now(), await requestNetwork()));
  } catch (e) {
    if (e instanceof TwoFactorError) return json({ error: e.message, code: e.code }, e.code === "TWO_FACTOR_REQUIRED" ? 403 : 400);
    if (e instanceof PasskeyError) return json({ error: e.message, code: e.code }, 400);
    console.error(e);
    return json({ error: "The code could not be checked. Try again." }, 503);
  }
}
