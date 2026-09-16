export const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });

/** Rejects cross-site posts: only same-origin browser requests may mutate state. */
export const sameOrigin = (req: Request) => req.headers.get("origin") === new URL(req.url).origin;

type Body = Record<string, unknown>;

/** Reads a small JSON object body, or explains why it was rejected. */
export async function readBody(req: Request, maxBytes: number): Promise<{ body: Body } | { error: string; status: number }> {
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return { error: "Send JSON.", status: 415 };
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return { error: "Request too large.", status: 413 };
  // Read at most maxBytes, whatever the declared length says.
  const reader = req.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        return { error: "Request too large.", status: 413 };
      }
      chunks.push(value);
    }
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    const body: unknown = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "Invalid request.", status: 400 };
    return { body: body as Body };
  } catch {
    return { error: "Invalid request.", status: 400 };
  }
}

/**
 * Who a public read is counted against: the signed-in user, or the client IP.
 * On Vercel, x-forwarded-for is set by the platform, so clients cannot forge it.
 */
export function clientKey(req: Request, userId?: string | null) {
  if (userId) return userId;
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return `ip:${forwarded || req.headers.get("x-real-ip") || "unknown"}`;
}
