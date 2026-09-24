import { administrator } from "@/lib/auth-user";
import { botConfig, bots, fillTournament, fundBots, removeBots, setBotConfig, tickBots, type BotSkill } from "@/lib/bots";
import { json, readBody, sameOrigin } from "@/lib/http";
import { GameError } from "@/lib/matches";
import { rateLimited, TOO_MANY_REQUESTS } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** The house's practice opponents: who they are, and how they are set. */
export async function GET() {
  if (!(await administrator())) return json({ error: "Administrator access required." }, 403);
  try {
    const [config, roster] = await Promise.all([botConfig(), bots()]);
    return json({ config, bots: roster });
  } catch (e) {
    console.error(e);
    return json({ error: "The house players are unavailable." }, 503);
  }
}

export async function POST(req: Request) {
  try {
    if (!sameOrigin(req)) return json({ error: "Request origin rejected." }, 403);
    const user = await administrator();
    if (!user) return json({ error: "Administrator access required." }, 403);
    if (await rateLimited("treasuryWrite", user.userId)) return json({ error: TOO_MANY_REQUESTS }, 429);
    const parsed = await readBody(req, 4096);
    if ("error" in parsed) return json({ error: parsed.error }, parsed.status);
    const b = parsed.body;
    if (b.action === "save") {
      const config = await setBotConfig(user.userId, {
        enabled: !!b.enabled,
        count: Number(b.count),
        tournaments: !!b.tournaments,
        skills: Array.isArray(b.skills) ? (b.skills as BotSkill[]) : undefined,
      });
      return json({ config, bots: await bots() });
    }
    if (b.action === "fund") return json({ moved: await fundBots(), bots: await bots() });
    // Their turn, now, rather than on the next page somebody loads.
    if (b.action === "play") return json({ done: await tickBots(), bots: await bots() });
    if (b.action === "fill") return json(await fillTournament(user.userId, b.id));
    if (b.action === "remove") {
      const gone = await removeBots(user.userId);
      return json({ ...gone, config: await botConfig(), bots: await bots() });
    }
    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    if (e instanceof GameError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: "The house players could not be changed." }, 503);
  }
}
