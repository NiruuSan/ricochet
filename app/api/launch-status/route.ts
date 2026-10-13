import { rateLimited, TOO_MANY_REQUESTS } from "@/lib/rate-limit";
import { clientKey, json } from "@/lib/http";
import { launchStatus } from "@/lib/payments/policy";
import { settings } from "@/lib/payments/service";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // The CDN answers most of these; what reaches here is counted per visitor, so
  // cache-busting query strings cannot turn into a stream of database reads.
  if (await rateLimited("publicRead", clientKey(req))) return Response.json({ error: TOO_MANY_REQUESTS }, { status: 429, headers: { "Cache-Control": "no-store" } });
  return json(launchStatus(settings()));
}
