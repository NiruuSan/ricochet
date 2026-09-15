import { currentUser } from "@/lib/auth-user";
import { adminId, database } from "@/db/raw";
import type { Asset } from "@/lib/api-types";
import { json, readBody, sameOrigin } from "@/lib/http";
import { demoTreasurySummary, GameError, playerSnapshot, playShot, startMatch } from "@/lib/matches";
import { PaymentError } from "@/lib/payments/errors";
import { ensureCashAccount, ensureWallet, settings } from "@/lib/payments/service";
import { launchStatus } from "@/lib/payments/policy";
import { rateLimited, TOO_MANY_REQUESTS } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const asset: Asset = new URL(req.url).searchParams.get("asset") === "devnet" ? "devnet" : "demo";
    const user = await currentUser();
    if (!user) return json({ authenticated: false });
    if (await rateLimited("gameRead", user.userId)) return json({ error: TOO_MANY_REQUESTS }, 429);
    return json({ authenticated: true, ...(await playerSnapshot(user.userId, asset)) });
  } catch (e) {
    console.error(e);
    return json({ error: "Unable to load demo accounts. You can still play practice." }, 503);
  }
}

export async function POST(req: Request) {
  try {
    if (!sameOrigin(req)) return json({ error: "Request origin rejected." }, 403);
    const user = await currentUser();
    if (!user) return json({ error: "Sign in to save your games." }, 401);
    const uid = user.userId;
    if (await rateLimited("gameWrite", uid)) return json({ error: TOO_MANY_REQUESTS }, 429);
    const parsed = await readBody(req, 4096);
    if ("error" in parsed) return json({ error: parsed.error }, parsed.status);
    const b = parsed.body;
    const db = database();

    if (b.action === "signup") {
      const name = String(b.name ?? "").trim();
      if (!/^[a-zA-Z0-9_]{3,20}$/.test(name)) return json({ error: "Use 3–20 letters, numbers or underscores." }, 400);
      await db.prepare("INSERT OR IGNORE INTO players(id, name, created) VALUES(?, ?, ?)").bind(uid, name, Date.now()).run();
      if (launchStatus(settings()).configured) {
        try {
          await ensureWallet(uid);
          await ensureCashAccount(uid);
        } catch {
          // The account survives a temporary wallet provisioning failure; the wallet page retries.
        }
      }
      return json(await playerSnapshot(uid, "demo"));
    }

    if (!(await db.prepare("SELECT 1 FROM players WHERE id = ?").bind(uid).first())) {
      return json({ error: "Create your player profile first." }, 403);
    }

    switch (b.action) {
      case "start":
        return json({ run: await startMatch(uid, b.stake, b.asset) });
      case "shot":
      case "forfeit":
        return json({ run: await playShot(uid, b.runId, b.revision, b.action, b.angle) });
      case "admin": {
        const admin = adminId();
        if (!admin || uid !== admin) return json({ error: "Treasury access is restricted to the configured administrator." }, 403);
        return json(await demoTreasurySummary());
      }
      default:
        return json({ error: "Unknown action." }, 400);
    }
  } catch (e) {
    if (e instanceof GameError) return json({ error: e.message }, e.status);
    if (e instanceof PaymentError) return json({ error: e.message }, 400);
    console.error(e);
    return json({ error: "The request could not be completed. Reload to check your saved game before trying again." }, 503);
  }
}
