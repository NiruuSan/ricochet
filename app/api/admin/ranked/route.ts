import { administrator } from "@/lib/auth-user";
import { json } from "@/lib/http";
import { rankDistribution } from "@/lib/ranked";

export const dynamic = "force-dynamic";

/** How this season's ranked players spread over the divisions. */
export async function GET() {
  if (!(await administrator())) return json({ error: "Administrator access required." }, 403);
  try {
    return json(await rankDistribution());
  } catch (e) {
    console.error(e);
    return json({ error: "The rank distribution is unavailable." }, 503);
  }
}
