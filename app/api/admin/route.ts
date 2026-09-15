import { adminOverview } from "@/lib/admin";
import { administrator } from "@/lib/auth-user";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await administrator())) return json({ error: "Administrator access required." }, 403);
  try {
    return json(await adminOverview());
  } catch (e) {
    console.error(e);
    return json({ error: "Statistics are unavailable." }, 503);
  }
}
