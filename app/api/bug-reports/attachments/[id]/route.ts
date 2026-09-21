import { get } from "@vercel/blob";
import { adminId } from "@/db/raw";
import { currentUser } from "@/lib/auth-user";
import { bugAttachmentForReader } from "@/lib/bug-attachments";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await currentUser();
    if (!user) return json({ error: "Sign in to view this attachment." }, 401);
    const attachment = await bugAttachmentForReader((await params).id, user.userId, user.userId === adminId());
    if (!attachment) return json({ error: "Attachment not found." }, 404);
    const range = req.headers.get("range");
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      const start = match?.[1] ? Number(match[1]) : null;
      const end = match?.[2] ? Number(match[2]) : null;
      if (!match || (start === null && end === null) ||
        (start !== null && (!Number.isSafeInteger(start) || start >= attachment.size)) ||
        (end !== null && (!Number.isSafeInteger(end) || (start !== null ? end < start : end === 0)))) {
        return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${attachment.size}`, "Cache-Control": "private, no-store" } });
      }
    }
    const blob = await get(attachment.pathname, { access: "private", headers: range ? { Range: range } : undefined, abortSignal: req.signal });
    if (!blob || blob.statusCode !== 200) return json({ error: "Attachment not found." }, 404);
    const download = new URL(req.url).searchParams.has("download");
    const contentRange = blob.headers.get("content-range");
    return new Response(blob.stream, { status: contentRange ? 206 : 200, headers: {
      "Content-Type": attachment.type,
      "Content-Length": String(blob.blob.size),
      "Accept-Ranges": "bytes",
      ...(contentRange ? { "Content-Range": contentRange } : {}),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(attachment.name).replace(/'/g, "%27")}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    } });
  } catch (e) {
    console.error(e);
    return json({ error: "The attachment is unavailable." }, 503);
  }
}
