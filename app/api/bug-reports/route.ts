import { currentUser } from "@/lib/auth-user";
import { submitBugReport } from "@/lib/bug-reports";
import { json, readBody, sameOrigin } from "@/lib/http";
import { GameError } from "@/lib/matches";
import { rateLimited, TOO_MANY_REQUESTS } from "@/lib/rate-limit";

export async function POST(req: Request) {
  try {
    if (!sameOrigin(req)) return json({ error: "Request origin rejected." }, 403);
    const user = await currentUser();
    if (!user) return json({ error: "Sign in to report a bug." }, 401);
    if (await rateLimited("bugReportWrite", user.userId)) return json({ error: TOO_MANY_REQUESTS }, 429);
    const parsed = await readBody(req, 48_000);
    if ("error" in parsed) return json({ error: parsed.error }, parsed.status);
    return json(await submitBugReport(user.userId, parsed.body), 201);
  } catch (e) {
    if (e instanceof GameError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: "The bug report could not be sent. Please try again." }, 503);
  }
}
