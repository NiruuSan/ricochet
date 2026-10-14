import type { Metadata } from "next";
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

// Each public page names itself in the tab, in search results and in link previews.
const PAGES: Partial<Record<View, { title: string; description: string }>> = {
  welcome: { title: "Bounce · Same board. Your angle.", description: "A head-to-head brick-breaker: both players get the same board, the better angle wins." },
  live: { title: "Live games · Bounce", description: "Watch the runs being played right now, shot by shot." },
  tournaments: { title: "Tournaments · Bounce", description: "Daily cups and tournaments: everyone plays the same board, the best scores share the pool." },
  leaderboard: { title: "Leaderboard · Bounce", description: "The best players on Bounce, and this week's race." },
  faq: { title: "How to play · Bounce", description: "Good questions, straight answers: everything you need before your first run." },
  rules: { title: "Game rules · Bounce", description: "How matches, forfeits, ties, fees and tournaments work on Bounce." },
  privacy: { title: "Privacy Policy · Bounce", description: "What Bounce collects, why, who handles it, how long it is kept and how to use your GDPR rights." },
  terms: { title: "Terms of Use · Bounce", description: "The rules of the house: who may play, entries and fees, deposits and withdrawals, fair play." },
  login: { title: "Sign in · Bounce", description: "Sign in with a Solana wallet, GitHub, Google or Discord." },
  signup: { title: "Sign up · Bounce", description: "Pick a player name and start with free gems." },
};

export async function generateMetadata({ params }: { params: Promise<{ view: string }> }): Promise<Metadata> {
  const page = PAGES[(await params).view as View];
  if (!page) return {};
  return { title: page.title, description: page.description, openGraph: { title: page.title, description: page.description }, twitter: { title: page.title, description: page.description } };
}

export default async function Page({ params }: { params: Promise<{ view: string }> }) {
  const { view } = await params;
  // "play" is served at the site root; "watch" needs a game, at /watch/<id>.
  if (view === "play" || view === "watch" || !(VIEWS as readonly string[]).includes(view)) notFound();
  return <Arena view={view as View} />;
}
