import type { Metadata } from "next";
import { runCard } from "@/lib/spectate";
import Arena from "../../arena/arena";

/** A shared replay says whose run it is and what it scored, next to its card. */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const card = await runCard(decodeURIComponent(id)).catch(() => null);
  if (!card) return {};
  const title = `${card.name} · ${card.score.toLocaleString("en")} points on Bounce`;
  const description = `${card.context} · watch the run shot by shot, aiming included.`;
  return { title, description, openGraph: { title, description, type: "article" }, twitter: { card: "summary_large_image", title, description } };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Arena view="watch" watchId={decodeURIComponent(id)} />;
}
