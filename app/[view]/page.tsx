import { notFound } from "next/navigation";
import Arena from "../arena/arena";
import { VIEWS, type View } from "../arena/views";

export default async function Page({ params }: { params: Promise<{ view: string }> }) {
  const { view } = await params;
  // "play" is served at the site root; "watch" needs a game, at /watch/<id>.
  if (view === "play" || view === "watch" || !(VIEWS as readonly string[]).includes(view)) notFound();
  return <Arena view={view as View} />;
}
