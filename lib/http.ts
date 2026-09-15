export const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });

/** Rejects cross-site posts: only same-origin browser requests may mutate state. */
export const sameOrigin = (req: Request) => req.headers.get("origin") === new URL(req.url).origin;

type Body = Record<string, unknown>;

/** Reads a small JSON object body, or explains why it was rejected. */
export async function readBody(req: Request, maxBytes: number): Promise<{ body: Body } | { error: string; status: number }> {
  const raw = await req.text();
  if (raw.length > maxBytes) return { error: "Request too large.", status: 413 };
  try {
    const body: unknown = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "Invalid request.", status: 400 };
    return { body: body as Body };
  } catch {
    return { error: "Invalid request.", status: 400 };
  }
}
