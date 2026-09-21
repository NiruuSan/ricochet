import { handleUpload } from "@vercel/blob/client";
import { currentUser } from "@/lib/auth-user";
import { reserveBugAttachment } from "@/lib/bug-attachments";
import { json, readBody, sameOrigin } from "@/lib/http";
import { GameError } from "@/lib/matches";
import { rateLimited, TOO_MANY_REQUESTS } from "@/lib/rate-limit";

export async function POST(req: Request) {
  try {
    if (!sameOrigin(req)) return json({ error: "Request origin rejected." }, 403);
    const user = await currentUser();
    if (!user) return json({ error: "Sign in to attach files." }, 401);
    if (await rateLimited("bugAttachmentWrite", user.userId)) return json({ error: TOO_MANY_REQUESTS }, 429);
    const parsed = await readBody(req, 4096);
    if ("error" in parsed) return json({ error: parsed.error }, parsed.status);
    if (parsed.body.type !== "blob.generate-client-token") return json({ error: "Invalid upload request." }, 400);
    const payload = parsed.body.payload as Record<string, unknown> | null;
    if (!payload || typeof payload.pathname !== "string" || typeof payload.multipart !== "boolean" || (payload.clientPayload !== null && typeof payload.clientPayload !== "string")) {
      return json({ error: "Invalid upload details." }, 400);
    }
    let metadata;
    try { metadata = JSON.parse(payload.clientPayload ?? "null"); } catch { throw new GameError("Invalid attachment details."); }
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw new GameError("Invalid attachment details.");
    // The reservation is made before the SDK is asked for anything. It refuses
    // with a reason a player can act on, and `handleUpload` would otherwise
    // fail first — on a missing store token — and bury it.
    const reserved = await reserveBugAttachment(user.userId, payload.pathname, metadata as Record<string, unknown>);
    return json(await handleUpload({
      request: req,
      body: { type: "blob.generate-client-token", payload: { pathname: payload.pathname, multipart: payload.multipart, clientPayload: payload.clientPayload } },
      onBeforeGenerateToken: async () => reserved,
    }));
  } catch (e) {
    if (e instanceof GameError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: "The attachment could not be uploaded. Please try again." }, 503);
  }
}
