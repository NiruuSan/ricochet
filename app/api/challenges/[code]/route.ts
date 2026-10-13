import { clientKey, json } from "@/lib/http";
import { challengePreview } from "@/lib/matches";
import { rateLimited, TOO_MANY_REQUESTS } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** Who sent a challenge link and for how much, so a visitor knows what they are signing in for. */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    if (await rateLimited("publicRead", clientKey(req))) return json({ error: TOO_MANY_REQUESTS }, 429);
    const challenge = await challengePreview((await params).code);
    if (!challenge) return json({ error: "This challenge has expired or was already played." }, 404);
    return json(challenge);
  } catch (e) {
    console.error(e);
    return json({ error: "This challenge could not be loaded." }, 503);
  }
}
