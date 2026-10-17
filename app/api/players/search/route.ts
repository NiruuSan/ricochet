import { adminReader } from "@/lib/admin-guard";
import { currentUser } from "@/lib/auth-user";
import { json } from "@/lib/http";
import { searchPlayerNames } from "@/lib/player-search";
import { rateLimited, TOO_MANY_REQUESTS } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const params = new URL(req.url).searchParams;
    const scope = params.get("scope") ?? "friends";
    if (scope !== "admin" && scope !== "friends") return json({ error: "Unknown search scope." }, 400);
    const admin = scope === "admin" ? await adminReader() : null;
    if (admin?.locked) return admin.locked;
    const user = admin ? admin.user : await currentUser();
    if (!user) return json({ error: "Sign in to find players." }, 401);
    if (await rateLimited("gameRead", user.userId)) return json({ error: TOO_MANY_REQUESTS }, 429);
    return json(await searchPlayerNames(params.get("q") ?? "", scope === "friends" ? user.userId : undefined));
  } catch (e) {
    console.error(e);
    return json({ error: "Player suggestions are unavailable right now." }, 503);
  }
}
