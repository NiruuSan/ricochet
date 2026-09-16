import { currentUser } from "@/lib/auth-user";
import { clientKey, json } from "@/lib/http";
import { GameError } from "@/lib/matches";
import { tournamentDetail } from "@/lib/tournaments";
import { rateLimited, TOO_MANY_REQUESTS } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await currentUser();
    const [limited, detail] = await Promise.all([rateLimited("publicRead", clientKey(req, user?.userId)), tournamentDetail(user?.userId ?? null, (await params).id)]);
    if (limited) return json({ error: TOO_MANY_REQUESTS }, 429);
    return json(detail);
  } catch (e) {
    if (e instanceof GameError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: "This tournament could not be loaded." }, 503);
  }
}
