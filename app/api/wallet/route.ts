import { currentUser, stepUpRequired } from "@/lib/auth-user";
import { database } from "@/db/raw";
import { json, readBody, sameOrigin } from "@/lib/http";
import { safePaymentError } from "@/lib/payments/errors";
import { beginDeposit, beginWithdrawal, reconcileTransfer, walletSnapshot } from "@/lib/payments/service";
import { rateLimited, TOO_MANY_REQUESTS } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const hasProfile = async (uid: string) => !!(await database().prepare("SELECT 1 FROM players WHERE id = ?").bind(uid).first());

export async function GET() {
  try {
    const user = await currentUser();
    if (!user) return json({ error: "Sign in to view your wallet." }, 401);
    if (await rateLimited("walletRead", user.userId)) return json({ error: TOO_MANY_REQUESTS }, 429);
    if (!(await hasProfile(user.userId))) return json({ error: "Create a player profile first." }, 403);
    return json(await walletSnapshot(user.userId));
  } catch {
    return json({ error: "Wallet service is unavailable. No funds were moved." }, 503);
  }
}

export async function POST(req: Request) {
  try {
    if (!sameOrigin(req)) return json({ error: "Request origin rejected." }, 403);
    const user = await currentUser();
    if (!user) return json({ error: "Sign in to use your wallet." }, 401);
    if (await rateLimited("walletWrite", user.userId)) return json({ error: TOO_MANY_REQUESTS }, 429);
    if (!(await hasProfile(user.userId))) return json({ error: "Create a player profile first." }, 403);
    const parsed = await readBody(req, 2048);
    if ("error" in parsed) return json({ error: parsed.error }, parsed.status);
    const b = parsed.body;
    if (b.action === "deposit") return json(await beginDeposit(user.userId, b.id));
    if (b.action === "withdraw") {
      const stepUp = stepUpRequired(user);
      if (stepUp) return json(stepUp, 403);
      return json(await beginWithdrawal(user.userId, b.id, b.destination, b.amount));
    }
    if (b.action === "reconcile" && typeof b.id === "string") return json(await reconcileTransfer(b.id, user.userId));
    return json({ error: "Unknown wallet action." }, 400);
  } catch (e) {
    return json({ error: safePaymentError(e) }, 400);
  }
}
