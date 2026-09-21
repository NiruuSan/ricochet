import { administrator } from "@/lib/auth-user";
import { json, readBody, sameOrigin } from "@/lib/http";
import { GameError } from "@/lib/matches";
import { adminReports, resolveReport } from "@/lib/moderation";
import { rateLimited, TOO_MANY_REQUESTS } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await administrator())) return json({ error: "Administrator access required." }, 403);
  try {
    return json(await adminReports());
  } catch (e) {
    console.error(e);
    return json({ error: "Reports are unavailable." }, 503);
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
    if (parsed.body.action !== "resolve") return json({ error: "Unknown action." }, 400);
    return json(await resolveReport(user.userId, parsed.body.id, parsed.body.note));
  } catch (e) {
    if (e instanceof GameError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: "The report could not be updated." }, 503);
  }
}
