import { adminReader, elevationRequired, sessionKey } from "@/lib/admin-guard";
import { listPasskeys, MAX_PASSKEYS, PasskeyError, passkeyOnly, registerPasskey, registrationOptions, removePasskey, setPasskeyOnly } from "@/lib/admin-passkeys";
import { administrator } from "@/lib/auth-user";
import { json, readBody, sameOrigin } from "@/lib/http";
import { rateLimited, TOO_MANY_REQUESTS } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const snapshot = async (uid: string) => ({ passkeys: await listPasskeys(uid), passkeyOnly: await passkeyOnly(), max: MAX_PASSKEYS });

/** The administrator's passkeys, and whether an app code still opens the admin. */
export async function GET() {
  const { user, locked } = await adminReader();
  if (locked) return locked;
  try {
    return json(await snapshot(user.userId));
  } catch (e) {
    console.error(e);
    return json({ error: "Passkeys are unavailable right now." }, 503);
  }
}

/**
 * Adds a passkey (`options`, then `register` with the browser's answer),
 * removes one, or turns "passkey only" on or off. Each is an administrator
 * change, so each needs the window a fresh code or passkey opens.
 */
export async function POST(req: Request) {
  try {
    if (!sameOrigin(req)) return json({ error: "Request origin rejected." }, 403);
    const user = await administrator();
    if (!user) return json({ error: "Administrator access required." }, 403);
    if (await rateLimited("securityWrite", user.userId)) return json({ error: TOO_MANY_REQUESTS }, 429);
    const locked = await elevationRequired(user.userId);
    if (locked) return locked;
    const parsed = await readBody(req, 16_384);
    if ("error" in parsed) return json({ error: parsed.error }, parsed.status);
    const body = parsed.body;
    const session = await sessionKey();
    if (!session) return json({ error: "Sign in again to manage passkeys." }, 401);
    const origin = new URL(req.url).origin;
    if (body.action === "options") return json(await registrationOptions(user.userId, user.displayName, session, origin));
    if (body.action === "register") await registerPasskey(user.userId, session, origin, body.response, body.name);
    else if (body.action === "remove") await removePasskey(user.userId, body.id);
    else if (body.action === "only") await setPasskeyOnly(user.userId, body.on === true);
    else return json({ error: "Unknown action." }, 400);
    return json(await snapshot(user.userId));
  } catch (e) {
    if (e instanceof PasskeyError) return json({ error: e.message, code: e.code }, 400);
    console.error(e);
    return json({ error: "The passkey could not be saved. Try again." }, 503);
  }
}
