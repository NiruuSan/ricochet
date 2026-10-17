import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/legal";

// The public pages, most important first. Players' own pages, sign-in and
// replays are left to links: they change by the minute or belong to one person.
const PAGES: { path: string; changeFrequency: "hourly" | "daily" | "weekly" | "monthly"; priority: number }[] = [
  { path: "/", changeFrequency: "daily", priority: 1 },
  { path: "/welcome", changeFrequency: "monthly", priority: 0.9 },
  { path: "/tournaments", changeFrequency: "hourly", priority: 0.8 },
  { path: "/leaderboard", changeFrequency: "hourly", priority: 0.8 },
  { path: "/live", changeFrequency: "hourly", priority: 0.7 },
  { path: "/rules", changeFrequency: "monthly", priority: 0.6 },
  { path: "/terms", changeFrequency: "monthly", priority: 0.3 },
  { path: "/whats-new", changeFrequency: "weekly", priority: 0.4 },
  { path: "/privacy", changeFrequency: "monthly", priority: 0.3 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const site = siteUrl();
  return PAGES.map(({ path, changeFrequency, priority }) => ({ url: `${site}${path === "/" ? "" : path}`, changeFrequency, priority }));
}
