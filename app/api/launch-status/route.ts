import { json } from "@/lib/http";
import { launchStatus } from "@/lib/payments/policy";
import { settings } from "@/lib/payments/service";

export const dynamic = "force-dynamic";

export function GET() {
  return json(launchStatus(settings()));
}
