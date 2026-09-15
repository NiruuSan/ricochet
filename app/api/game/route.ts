import { currentUser } from "@/lib/auth-user";
import { database } from "@/db/raw";
import type { Asset } from "@/lib/api-types";
import { json, readBody, sameOrigin } from "@/lib/http";
import { GameError, playerSnapshot, playShot, startMatch, touchPlayer } from "@/lib/matches";
import { settings } from "@/lib/payments/accounts";
import { PaymentError } from "@/lib/payments/errors";
import { launchStatus } from "@/lib/payments/policy";
import { createPlayer } from "@/lib/profile";
import { rateLimited, TOO_MANY_REQUESTS } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const asset: Asset = new URL(req.url).searchParams.get("asset") === "devnet" ? "devnet" : "gems";
    const user = await currentUser();
    if (!user) return json({ authenticated: false });
    const [limited] = await Promise.all([rateLimited("gameRead", user.userId), touchPlayer(user.userId)]);
    if (limited) return json({ error: TOO_MANY_REQUESTS }, 429);
    return json({ authenticated: true, ...(await playerSnapshot(user.userId, asset)) });
  } catch (e) {
    console.error(e);
    return json({ error: "Unable to load your account. You can still play practice." }, 503);
  }
}

export async function POST(req: Request) {
  try {
    if (!sameOrigin(req)) return json({ error: "Request origin rejected." }, 403);
    const user = await currentUser();
    if (!user) return json({ error: "Sign in to save your games." }, 401);
    const uid = user.userId;
    const limited = rateLimited("gameWrite", uid);
    limited.catch(() => {}); // Still rethrown where awaited; avoids an unhandled rejection on early returns.
    const parsed = await readBody(req, 4096);
    if ("error" in parsed) return json({ error: parsed.error }, parsed.status);
    const b = parsed.body;

    // Shots are the hot path: the rate limit runs alongside loading the run, and
    // owning a run already proves the profile exists.
    if (b.action === "shot" || b.action === "forfeit") {
      return json({ run: await playShot(uid, b.runId, b.revision, b.action, b.angle, limited.then((over) => !over)) });
    }
    if (await limited) return json({ error: TOO_MANY_REQUESTS }, 429);

    if (b.action === "signup") {
      await createPlayer(uid, b.name);
      if (launchStatus(settings()).configured) {
        try {
          const { ensureCashAccount, ensureWallet } = await import("@/lib/payments/service");
          await ensureWallet(uid);
          await ensureCashAccount(uid);
        } catch {
          // The account survives a temporary wallet provisioning failure; the wallet page retries.
        }
      }
      return json(await playerSnapshot(uid, "gems"));
    }

    if (b.action === "start") {
      if (!(await database().prepare("SELECT 1 FROM players WHERE id = ?").bind(uid).first())) {
        return json({ error: "Create your player profile first." }, 403);
      }
      return json({ run: await startMatch(uid, b.stake, b.asset) });
    }
    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    if (e instanceof GameError) return json({ error: e.message }, e.status);
    if (e instanceof PaymentError) return json({ error: e.message }, 400);
    console.error(e);
    return json({ error: "The request could not be completed. Reload to check your saved game before trying again." }, 503);
  }
}
