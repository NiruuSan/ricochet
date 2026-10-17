import { adminReader } from "@/lib/admin-guard";
import { json } from "@/lib/http";
import { rankDistribution } from "@/lib/ranked";

export const dynamic = "force-dynamic";

/** How this season's ranked players spread over the divisions. */
export async function GET() {
  const { locked } = await adminReader();
  if (locked) return locked;
  try {
    return json(await rankDistribution());
  } catch (e) {
    console.error(e);
    return json({ error: "The rank distribution is unavailable." }, 503);
  }
}
