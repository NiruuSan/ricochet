import { currentUser } from "@/lib/auth-user";
import { arenaOverview } from "@/lib/arena";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await currentUser();
    return json(await arenaOverview(user?.userId ?? null));
  } catch (e) {
    console.error(e);
    return json({ error: "The arena could not be loaded." }, 503);
  }
}
