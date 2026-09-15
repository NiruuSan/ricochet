import { currentUser } from "@/lib/auth-user";
import { json } from "@/lib/http";
import { liveGames } from "@/lib/spectate";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await currentUser();
    return json(await liveGames(user?.userId ?? null));
  } catch (e) {
    console.error(e);
    return json({ error: "Live games could not be loaded." }, 503);
  }
}
