import { currentUser } from "@/lib/auth-user";
import { json } from "@/lib/http";
import { GameError } from "@/lib/matches";
import { watchRun } from "@/lib/spectate";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await currentUser();
    const since = new URL(req.url).searchParams.get("since");
    return json(await watchRun(user?.userId ?? null, (await params).id, since));
  } catch (e) {
    if (e instanceof GameError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: "This game could not be loaded." }, 503);
  }
}
