import { elevationRequired } from "@/lib/admin-guard";
import { administrator } from "@/lib/auth-user";
import { botConfig, bots, botWork, fillTournament, fundBots, MAX_BOTS, MAX_TOP_UP, MIN_TOP_UP, removeBots, setBotConfig, tickBots, type BotSkill } from "@/lib/bots";
import { database } from "@/db/raw";
import { cashAccountId, HOUSE } from "@/lib/payments/accounts";
import { json, readBody, sameOrigin } from "@/lib/http";
import { GameError } from "@/lib/matches";
import { rateLimited, TOO_MANY_REQUESTS } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
// Playing everything waiting is real work: each turn is given up to twenty
// seconds (below), with room to spare before the platform would cut it off.
export const maxDuration = 60;

/** What the treasury holds, in lamports: what the bots are funded from. */
const treasury = async () =>
  Number((await database().prepare("SELECT balance FROM cash_accounts WHERE id = ?").bind(cashAccountId(HOUSE)).first<{ balance: number }>())?.balance ?? 0);

/** The bounds the form is held to, so it says what the server will accept. */
const LIMITS = { count: MAX_BOTS, minTopUp: MIN_TOP_UP, maxTopUp: MAX_TOP_UP };

/** The house's practice opponents: who they are, how they are set, and what the treasury can give them. */
export async function GET() {
  if (!(await administrator())) return json({ error: "Administrator access required." }, 403);
  try {
    const [config, roster, work, held] = await Promise.all([botConfig(), bots(), botWork(), treasury()]);
    return json({ config, bots: roster, work, treasury: held, limits: LIMITS });
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
    // Every administrator change needs a fresh authenticator code on this session (lib/admin-guard.ts).
    const locked = await elevationRequired(user.userId);
    if (locked) return locked;
    const parsed = await readBody(req, 4096);
    if ("error" in parsed) return json({ error: parsed.error }, parsed.status);
    const b = parsed.body;
    if (b.action === "save") {
      const config = await setBotConfig(user.userId, {
        enabled: !!b.enabled,
        count: Number(b.count),
        tournaments: !!b.tournaments,
        skills: Array.isArray(b.skills) ? (b.skills as BotSkill[]) : undefined,
        // Lamports, as whole numbers; the form converts from SOL.
        topUp: b.topUp === undefined ? undefined : Number(b.topUp),
        floor: b.floor === undefined ? undefined : Number(b.floor),
      });
      return json({ config, bots: await bots(), treasury: await treasury() });
    }
    // The button: every bot in service is brought up to the amount it is given.
    if (b.action === "fund") {
      const funded = await fundBots(Date.now(), { everyone: true });
      return json({ ...funded, bots: await bots(), treasury: await treasury() });
    }
    // Their turn, now: everything that is waiting, without the pauses that make
    // them look human and without a cap on how much — only twenty seconds of it
    // per request. `more` says the clock ran out first; the screen asks again.
    if (b.action === "play") {
      const { more, ...done } = await tickBots(Date.now(), { immediate: true, seconds: 20 });
      return json({ done, more, bots: await bots(), work: await botWork() });
    }
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
