import { adminReader } from "@/lib/admin-guard";
import { adminOverview } from "@/lib/admin";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  const { locked } = await adminReader();
  if (locked) return locked;
  try {
    return json(await adminOverview());
  } catch (e) {
    console.error(e);
    return json({ error: "Statistics are unavailable." }, 503);
  }
}
