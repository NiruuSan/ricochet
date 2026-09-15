import { currentUser } from "@/lib/auth-user";
import { json } from "@/lib/http";
import { GameError } from "@/lib/matches";
import { tournamentDetail } from "@/lib/tournaments";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await currentUser();
    return json(await tournamentDetail(user?.userId ?? null, (await params).id));
  } catch (e) {
    if (e instanceof GameError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: "This tournament could not be loaded." }, 503);
  }
}
