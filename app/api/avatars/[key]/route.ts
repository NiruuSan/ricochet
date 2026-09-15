import { avatarImage } from "@/lib/profile";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ key: string }> }) {
  const image = await avatarImage((await params).key).catch(() => null);
  if (!image) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  return new Response(Buffer.from(image.data, "base64"), {
    headers: {
      "Content-Type": image.type,
      // A new picture always gets a new key, so a stored one never changes.
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
