import { notFound } from "next/navigation";
import Arena from "../arena/arena";
import { VIEWS, type View } from "../arena/views";

// Every view page is the same client shell. Each request renders its own copy
// because each carries its own script nonce (proxy.ts): a prerendered page
// would hold a nonce from build time, which no browser would accept.
export const dynamic = "force-dynamic";
export const dynamicParams = false;
export function generateStaticParams() {
  return VIEWS.filter((view) => view !== "play" && view !== "watch").map((view) => ({ view }));
}

export default async function Page({ params }: { params: Promise<{ view: string }> }) {
  const { view } = await params;
  // "play" is served at the site root; "watch" needs a game, at /watch/<id>.
  if (view === "play" || view === "watch" || !(VIEWS as readonly string[]).includes(view)) notFound();
  return <Arena view={view as View} />;
}
