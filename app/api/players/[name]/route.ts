import { currentUser } from "@/lib/auth-user";
import { json } from "@/lib/http";
import { GameError } from "@/lib/matches";
import { publicProfile } from "@/lib/public-profile";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  try {
    const [{ name }, user] = await Promise.all([params, currentUser()]);
    return json(await publicProfile(name, user?.userId));
  } catch (error) {
    if (error instanceof GameError) return json({ error: error.message }, error.status);
    return json({ error: "This profile could not be loaded. Please try again." }, 503);
  }
}
