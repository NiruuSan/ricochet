import { currentUser } from "@/lib/auth-user";
import { json, readBody, sameOrigin } from "@/lib/http";
import { safePaymentError } from "@/lib/payments/errors";
import { sendTip, TipNotSentError } from "@/lib/payments/tips";
import { rateLimited, TOO_MANY_REQUESTS } from "@/lib/rate-limit";

export async function POST(req: Request) {
  try {
    if (!sameOrigin(req)) return json({ error: "Request origin rejected." }, 403);
    const user = await currentUser();
    if (!user) return json({ error: "Sign in to tip a player." }, 401);
    if (await rateLimited("walletWrite", user.userId)) return json({ error: TOO_MANY_REQUESTS }, 429);
    const parsed = await readBody(req, 2048);
    if ("error" in parsed) return json({ error: parsed.error }, parsed.status);
    const { id, recipient, amount } = parsed.body;
    return json(await sendTip(user.userId, id, recipient, amount));
  } catch (error) {
    return json({ error: safePaymentError(error), code: error instanceof TipNotSentError ? "TIP_NOT_SENT" : undefined }, 400);
  }
}
