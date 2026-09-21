import { administrator } from "@/lib/auth-user";
import { listBugReports, updateBugReport } from "@/lib/bug-reports";
import { json, readBody, sameOrigin } from "@/lib/http";
import { GameError } from "@/lib/matches";
import { rateLimited, TOO_MANY_REQUESTS } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const user = await administrator();
    if (!user) return json({ error: "Administrator access required." }, 403);
    if (await rateLimited("gameRead", user.userId)) return json({ error: TOO_MANY_REQUESTS }, 429);
    return json(await listBugReports(Number(new URL(req.url).searchParams.get("offset") ?? 0)));
  } catch (e) {
    if (e instanceof GameError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: "Bug reports are unavailable." }, 503);
  }
}

export async function POST(req: Request) {
  try {
    if (!sameOrigin(req)) return json({ error: "Request origin rejected." }, 403);
    const user = await administrator();
    if (!user) return json({ error: "Administrator access required." }, 403);
    if (await rateLimited("securityWrite", user.userId)) return json({ error: TOO_MANY_REQUESTS }, 429);
    const parsed = await readBody(req, 1024);
    if ("error" in parsed) return json({ error: parsed.error }, parsed.status);
    return json(await updateBugReport(user.userId, parsed.body.id, parsed.body.status));
  } catch (e) {
    if (e instanceof GameError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: "The bug report could not be updated." }, 503);
  }
}
