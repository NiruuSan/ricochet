import { currentUser } from "@/lib/auth-user";
import { json, readBody, sameOrigin } from "@/lib/http";
import { rateLimited, TOO_MANY_REQUESTS } from "@/lib/rate-limit";
import { submitSurvey, SurveyError } from "@/lib/survey";

export const dynamic = "force-dynamic";

/** A player's answer to the beta survey: a score from 0 to 10, and a few words. */
export async function POST(req: Request) {
  try {
    if (!sameOrigin(req)) return json({ error: "Request origin rejected." }, 403);
    const user = await currentUser();
    if (!user) return json({ error: "Sign in to answer." }, 401);
    if (await rateLimited("profileWrite", user.userId)) return json({ error: TOO_MANY_REQUESTS }, 429);
    const parsed = await readBody(req, 4096);
    if ("error" in parsed) return json({ error: parsed.error }, parsed.status);
    return json(await submitSurvey(user.userId, parsed.body));
  } catch (e) {
    if (e instanceof SurveyError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: "Your answer could not be saved. Try again in a moment." }, 503);
  }
}
