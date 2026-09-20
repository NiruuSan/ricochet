import { currentUser } from "@/lib/auth-user";
import { json, readBody, sameOrigin } from "@/lib/http";
import { safePaymentError } from "@/lib/payments/errors";
import { sendTip, TipCodeRequiredError, TipNotSentError } from "@/lib/payments/tips";
import { rateLimited, TOO_MANY_REQUESTS } from "@/lib/rate-limit";
import { TwoFactorError } from "@/lib/two-factor";

export async function POST(req: Request) {
  try {
    if (!sameOrigin(req)) return json({ error: "Request origin rejected." }, 403);
    const user = await currentUser();
    if (!user) return json({ error: "Sign in to tip a player." }, 401);
    if (await rateLimited("walletWrite", user.userId)) return json({ error: TOO_MANY_REQUESTS }, 429);
    const parsed = await readBody(req, 2048);
    if ("error" in parsed) return json({ error: parsed.error }, parsed.status);
    const { id, recipient, amount, code } = parsed.body;
    return json(await sendTip(user.userId, id, recipient, amount, code));
  } catch (error) {
    // A tip over the free daily allowance asks for the second factor; nothing has moved yet.
    if (error instanceof TipCodeRequiredError) return json({ error: error.message, code: "TIP_CODE_REQUIRED", enrolled: error.enrolled }, 403);
    if (error instanceof TwoFactorError) return json({ error: error.message, code: error.code }, 400);
    return json({ error: safePaymentError(error), code: error instanceof TipNotSentError ? "TIP_NOT_SENT" : undefined }, 400);
  }
}
