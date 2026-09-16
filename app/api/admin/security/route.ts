import { administrator, stepUpRequired } from "@/lib/auth-user";
import { json, readBody, sameOrigin } from "@/lib/http";
import { PaymentError } from "@/lib/payments/errors";
import { rateLimited, TOO_MANY_REQUESTS } from "@/lib/rate-limit";
import { adminResetTwoFactor, adminTwoFactorLookup } from "@/lib/security-admin";
import { TwoFactorError } from "@/lib/two-factor";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const user = await administrator();
    if (!user) return json({ error: "Administrator access required." }, 403);
    if (await rateLimited("walletRead", user.userId)) return json({ error: TOO_MANY_REQUESTS }, 429);
    return json(await adminTwoFactorLookup(new URL(req.url).searchParams.get("name") ?? ""));
  } catch (e) {
    if (e instanceof PaymentError) return json({ error: e.message }, 400);
    return json({ error: "Security records are unavailable." }, 503);
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
    const stepUp = stepUpRequired(user);
    if (stepUp) return json({ ...stepUp, error: "Confirm it is you with your sign-in provider before resetting a player's two-factor authentication." }, 403);
    const b = parsed.body;
    if (b.action !== "reset") return json({ error: "Unknown action." }, 400);
    return json(await adminResetTwoFactor(user.userId, b.name, b.reason, b.code));
  } catch (e) {
    if (e instanceof TwoFactorError) return json({ error: e.message, code: e.code }, e.code === "TWO_FACTOR_REQUIRED" ? 403 : 400);
    if (e instanceof PaymentError) return json({ error: e.message }, 400);
    return json({ error: "The security reset could not be completed." }, 503);
  }
}
