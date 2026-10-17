import { adminReader, elevationRequired } from "@/lib/admin-guard";
import { administrator } from "@/lib/auth-user";
import { badgeRoster, grantBadge, grantToEveryone, revokeBadge } from "@/lib/badge-admin";
import { json, readBody, sameOrigin } from "@/lib/http";
import { GameError } from "@/lib/matches";
import { rateLimited, TOO_MANY_REQUESTS } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** How many hold each badge, and who got one last. */
export async function GET() {
  const { locked } = await adminReader();
  if (locked) return locked;
  try {
    return json(await badgeRoster());
  } catch (e) {
    console.error(e);
    return json({ error: "Badges are unavailable right now." }, 503);
  }
}

/** Gives or takes a badge, for one player or for every player at once. */
export async function POST(req: Request) {
  try {
    if (!sameOrigin(req)) return json({ error: "Request origin rejected." }, 403);
    const user = await administrator();
    if (!user) return json({ error: "Administrator access required." }, 403);
    if (await rateLimited("treasuryWrite", user.userId)) return json({ error: TOO_MANY_REQUESTS }, 429);
    const locked = await elevationRequired(user.userId);
    if (locked) return locked;
    const parsed = await readBody(req, 1024);
    if ("error" in parsed) return json({ error: parsed.error }, parsed.status);
    const b = parsed.body;
    let done: unknown;
    if (b.action === "grant") done = await grantBadge(user.userId, b.name, b.badge);
    else if (b.action === "revoke") done = await revokeBadge(user.userId, b.name, b.badge);
    else if (b.action === "grant-all") done = await grantToEveryone(user.userId, b.badge);
    else return json({ error: "Unknown action." }, 400);
    return json({ done, roster: await badgeRoster() });
  } catch (e) {
    if (e instanceof GameError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: "The badge could not be changed." }, 503);
  }
}
