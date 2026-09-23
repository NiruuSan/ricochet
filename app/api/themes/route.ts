import { currentUser } from "@/lib/auth-user";
import { json, readBody, sameOrigin } from "@/lib/http";
import { GameError } from "@/lib/matches";
import { PaymentError } from "@/lib/payments/errors";
import { rateLimited, TOO_MANY_REQUESTS } from "@/lib/rate-limit";
import { buyTheme, equipTheme, themeStore } from "@/lib/theme-store";

export const dynamic = "force-dynamic";

/** The catalogue, and what the signed-in player owns and wears. */
export async function GET() {
  try {
    const user = await currentUser();
    return json(await themeStore(user?.userId ?? null));
  } catch (e) {
    console.error(e);
    return json({ error: "Themes are unavailable." }, 503);
  }
}

export async function POST(req: Request) {
  try {
    if (!sameOrigin(req)) return json({ error: "Request origin rejected." }, 403);
    const user = await currentUser();
    if (!user) return json({ error: "Sign in to change your theme." }, 401);
    if (await rateLimited("themeWrite", user.userId)) return json({ error: TOO_MANY_REQUESTS }, 429);
    const parsed = await readBody(req, 1024);
    if ("error" in parsed) return json({ error: parsed.error }, parsed.status);
    const b = parsed.body;
    switch (b.action) {
      case "buy":
        return json(await buyTheme(user.userId, b.theme));
      case "equip":
        return json(await equipTheme(user.userId, b.theme));
      default:
        return json({ error: "Unknown theme action." }, 400);
    }
  } catch (e) {
    if (e instanceof GameError) return json({ error: e.message }, e.status);
    if (e instanceof PaymentError) return json({ error: e.message }, 409);
    console.error(e);
    return json({ error: "That did not go through. Please try again." }, 503);
  }
}
