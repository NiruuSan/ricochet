import { currentUser } from "@/lib/auth-user";
import { database } from "@/db/raw";
import { json, readBody, sameOrigin } from "@/lib/http";
import { safePaymentError } from "@/lib/payments/errors";
import { beginDeposit, beginWithdrawal, precheckWithdrawal, reconcileTransfer, transferStarted, walletSnapshot } from "@/lib/payments/service";
import { rateLimited, TOO_MANY_REQUESTS } from "@/lib/rate-limit";
import { TwoFactorError, verifySecondFactor } from "@/lib/two-factor";

export const dynamic = "force-dynamic";

const hasProfile = async (uid: string) => !!(await database().prepare("SELECT 1 FROM players WHERE id = ? AND deleted IS NULL").bind(uid).first());

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
      // Every new withdrawal needs a fresh authenticator or recovery code. Retrying
      // an operation that already started only reports its status.
      if (!(await transferStarted(b.id, user.userId))) {
        // A typo in the amount or address should not cost the player a code.
        await precheckWithdrawal(user.userId, b.destination, b.amount);
        await verifySecondFactor(user.userId, b.code);
      }
      return json(await beginWithdrawal(user.userId, b.id, b.destination, b.amount));
    }
    if (b.action === "reconcile" && typeof b.id === "string") return json(await reconcileTransfer(b.id, user.userId));
    return json({ error: "Unknown wallet action." }, 400);
  } catch (e) {
    if (e instanceof TwoFactorError) return json({ error: e.message, code: e.code }, e.code === "TWO_FACTOR_REQUIRED" ? 403 : 400);
    return json({ error: safePaymentError(e) }, 400);
  }
}
