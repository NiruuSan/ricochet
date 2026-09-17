import { after } from "next/server";
import { currentUser } from "@/lib/auth-user";
import { database } from "@/db/raw";
import type { Asset } from "@/lib/api-types";
import { clientKey, json, readBody, sameOrigin } from "@/lib/http";
import { OUTDATED_CLIENT, parseProof } from "@/lib/anti-cheat-rules";
import { GameError, playerSnapshot, playShot, startMatch, touchPlayer, type ShotGuard } from "@/lib/matches";
import { settings } from "@/lib/payments/accounts";
import { PaymentError } from "@/lib/payments/errors";
import { launchStatus } from "@/lib/payments/policy";
import { createPlayer } from "@/lib/profile";
import { playTournamentShot, settleDueTournaments } from "@/lib/tournaments";
import { rateLimited, TOO_MANY_REQUESTS } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const asset: Asset = new URL(req.url).searchParams.get("asset") === "devnet" ? "devnet" : "gems";
    const user = await currentUser();
    // Visitors still learn whether Solana matches are available.
    if (!user) {
      if (await rateLimited("publicRead", clientKey(req))) return json({ error: TOO_MANY_REQUESTS }, 429);
      return json({ authenticated: false, launch: launchStatus(settings()) });
    }
    const uid = user.userId;
    // Presence and payouts of ended tournaments (so results reach players who never
    // open the tournament page) do not change this response: run them afterwards.
    after(() => Promise.all([touchPlayer(uid), settleDueTournaments()]).catch((e) => console.error(e)));
    const [limited, snapshot] = await Promise.all([rateLimited("gameRead", uid), playerSnapshot(uid, asset)]);
    if (limited) return json({ error: TOO_MANY_REQUESTS }, 429);
    return json({ authenticated: true, ...snapshot });
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
      const allowed = limited.then((over) => !over);
      // Every shot carries the client's anti-cheat report; a client without one is out of date.
      const proof = b.action === "shot" ? parseProof(b.proof) : null;
      if (b.action === "shot" && !proof) return json({ error: OUTDATED_CLIENT }, 426);
      const guard: ShotGuard = { proof: proof ?? undefined, defer: (task) => after(() => task().catch((e) => console.error("Shot analysis failed", e))) };
      // Tournament runs are addressed as `t:<entry id>`.
      if (typeof b.runId === "string" && b.runId.startsWith("t:")) {
        return json({ run: await playTournamentShot(uid, b.runId.slice(2), b.revision, b.action, b.angle, allowed, Date.now(), guard) });
      }
      return json({ run: await playShot(uid, b.runId, b.revision, b.action, b.angle, allowed, guard) });
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
