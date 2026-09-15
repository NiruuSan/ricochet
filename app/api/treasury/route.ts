import { administrator } from "@/lib/auth-user";
import { database } from "@/db/raw";
import { json, readBody, sameOrigin } from "@/lib/http";
import { safePaymentError } from "@/lib/payments/errors";
import { beginDeposit, beginWithdrawal, HOUSE, reconcileOpenTransfers, reconcileTransfer, treasurySnapshot } from "@/lib/payments/service";
import { rateLimited, TOO_MANY_REQUESTS } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await administrator())) return json({ error: "Administrator access required." }, 403);
  try {
    return json(await treasurySnapshot());
  } catch (e) {
    console.error(e);
    return json({ error: "Treasury is unavailable." }, 503);
  }
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: "Request origin rejected." }, 403);
  const user = await administrator();
  if (!user) return json({ error: "Administrator access required." }, 403);
  try {
    if (await rateLimited("treasuryWrite", user.userId)) return json({ error: TOO_MANY_REQUESTS }, 429);
    const parsed = await readBody(req, 2048);
    if ("error" in parsed) return json({ error: parsed.error }, parsed.status);
    const b = parsed.body;
    // Treasury deposits sweep the house deposit address into the pool and credit the house account.
    if (b.action === "deposit") return json(await beginDeposit(HOUSE, b.id));
    if (b.action === "withdraw") return json(await beginWithdrawal(user.userId, b.id, b.destination, b.amount, true));
    if (b.action === "reconcile_all") return json(await reconcileOpenTransfers());
    if (b.action === "reconcile" && typeof b.id === "string") {
      const transfer = await database().prepare("SELECT user_id FROM cash_transfers WHERE id = ?").bind(b.id).first<{ user_id: string }>();
      if (!transfer) return json({ error: "Transfer not found." }, 404);
      return json(await reconcileTransfer(b.id, transfer.user_id));
    }
    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    return json({ error: safePaymentError(e) }, 400);
  }
}
