import { clientKey, json, sameOrigin } from "@/lib/http";
import { rateLimited, TOO_MANY_REQUESTS } from "@/lib/rate-limit";
import { createChallenge } from "@/lib/wallet-sign-in";

export const dynamic = "force-dynamic";

/** A one-time challenge for a wallet to sign; the sign-in itself goes through Auth.js (auth.ts). */
export async function POST(req: Request) {
  try {
    if (!sameOrigin(req)) return json({ error: "Request origin rejected." }, 403);
    if (await rateLimited("walletSignIn", clientKey(req))) return json({ error: TOO_MANY_REQUESTS }, 429);
    return json(await createChallenge(new URL(req.url).origin));
  } catch (e) {
    console.error(e);
    return json({ error: "Wallet sign-in is unavailable right now. Try again in a moment." }, 503);
  }
}
