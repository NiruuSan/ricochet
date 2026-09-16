import { currentUser } from "@/lib/auth-user";
import { clientKey, json } from "@/lib/http";
import { GameError } from "@/lib/matches";
import { profilePerformance } from "@/lib/profile-performance";
import { findPlayer, publicProfile } from "@/lib/public-profile";
import { rateLimited, TOO_MANY_REQUESTS } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** A profile page in one request: the player card and their match performance. `me` is your own profile. */
export async function GET(req: Request, { params }: { params: Promise<{ name: string }> }) {
  try {
    const [{ name }, user] = await Promise.all([params, currentUser()]);
    const asset = new URL(req.url).searchParams.get("asset") === "devnet" ? "devnet" : "gems";
    if (name === "me" && !user) return json({ error: "Sign in to see your profile." }, 401);
    const limited = rateLimited("publicRead", clientKey(req, user?.userId));
    limited.catch(() => {});
    const player = await findPlayer(name === "me" ? { id: user!.userId } : name);
    const [profile, performance] = await Promise.all([publicProfile(player, user?.userId), profilePerformance(player, asset)]);
    if (await limited) return json({ error: TOO_MANY_REQUESTS }, 429);
    return json({ profile, performance });
  } catch (error) {
    if (error instanceof GameError) return json({ error: error.message }, error.status);
    console.error(error);
    return json({ error: "This profile could not be loaded. Please try again." }, 503);
  }
}
