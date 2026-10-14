import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/legal";

// Search engines may read every public page; a player's own pages, the sign-in
// flow and the API are of no use in search results. Preview deployments are
// kept out of search entirely, so only the real site is indexed.
export default function robots(): MetadataRoute.Robots {
  const site = siteUrl();
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/admin", "/wallet", "/profile", "/friends", "/quests", "/themes", "/matches", "/login", "/signup", "/*?join=", "/*?match=", "/*?tournament="],
    },
    sitemap: `${site}/sitemap.xml`,
  };
}
