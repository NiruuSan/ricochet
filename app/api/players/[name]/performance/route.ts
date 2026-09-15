import { json } from "@/lib/http";
import { GameError } from "@/lib/matches";
import { profilePerformance } from "@/lib/profile-performance";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ name: string }> }) {
  try {
    const { name } = await params;
    const asset = new URL(req.url).searchParams.get("asset") === "devnet" ? "devnet" : "gems";
    return json(await profilePerformance(name, asset));
  } catch (error) {
    if (error instanceof GameError) return json({ error: error.message }, error.status);
    return json({ error: "Match performance could not be loaded. Please try again." }, 503);
  }
}
