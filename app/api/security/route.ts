import { currentUser, stepUpRequired } from "@/lib/auth-user";
import { withdrawalHold } from "@/lib/security-holds";
import { json, readBody, sameOrigin } from "@/lib/http";
import { rateLimited, TOO_MANY_REQUESTS } from "@/lib/rate-limit";
import { beginTwoFactorSetup, confirmTwoFactorSetup, disableTwoFactor, regenerateRecoveryCodes, TwoFactorError, twoFactorStatus } from "@/lib/two-factor";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await currentUser();
    if (!user) return json({ error: "Sign in to manage your security settings." }, 401);
    return json({ ...await twoFactorStatus(user.userId), withdrawalHoldUntil: await withdrawalHold(user.userId) });
  } catch (e) {
    console.error(e);
    return json({ error: "Security settings are unavailable." }, 503);
  }
}

/**
 * Two-factor authentication settings. Changing them needs a recent sign-in with
 * the provider: otherwise a stolen session could enrol the thief's own
 * authenticator and then withdraw with it.
 */
export async function POST(req: Request) {
  try {
    if (!sameOrigin(req)) return json({ error: "Request origin rejected." }, 403);
    const user = await currentUser();
    if (!user) return json({ error: "Sign in to manage your security settings." }, 401);
    if (await rateLimited("securityWrite", user.userId)) return json({ error: TOO_MANY_REQUESTS }, 429);
    const parsed = await readBody(req, 1024);
    if ("error" in parsed) return json({ error: parsed.error }, parsed.status);
    const b = parsed.body;
    const stepUp = stepUpRequired(user);
    if (stepUp) return json({ ...stepUp, error: "For your security, confirm it is you with your sign-in provider before changing two-factor authentication." }, 403);
    switch (b.action) {
      case "setup":
        return json(await beginTwoFactorSetup(user.userId, user.displayName));
      case "confirm":
        return json(await confirmTwoFactorSetup(user.userId, b.code));
      case "regenerate":
        return json(await regenerateRecoveryCodes(user.userId, b.code));
      case "disable":
        await disableTwoFactor(user.userId, b.code);
        return json({ ok: true });
      default:
        return json({ error: "Unknown action." }, 400);
    }
  } catch (e) {
    if (e instanceof TwoFactorError) return json({ error: e.message, code: e.code }, 400);
    console.error(e);
    return json({ error: "Security settings could not be updated." }, 503);
  }
}
