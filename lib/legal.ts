// Who runs Bounce and where it may be played: the facts the Privacy Policy and
// the Terms are built from. No imports, so pages and the server share it.
//
// The operator's identity and a contact address are required by the GDPR
// (article 13) before the site opens to the public. Until they are filled in,
// the pages say "the operator of Bounce" and send requests through the in-app
// report form, rather than printing a placeholder.

export const LEGAL = {
  /** The person or company responsible for Bounce, as it should appear in the policies. */
  operator: null as string | null,
  /** The operator's postal address. */
  address: null as string | null,
  /** Where privacy and legal requests go. */
  email: null as string | null,
  /** When the Privacy Policy and the Terms last changed, as shown at their top. */
  updated: "14 October 2026",
  /** Nobody younger plays. */
  minimumAge: 18,
  /**
   * Countries Bounce is not offered in. The Terms name these and add every
   * country where online play for money is prohibited or needs a licence the
   * operator does not hold.
   */
  restricted: ["France"],
} as const;

/** How the policies name the operator. */
export const operatorName = () => LEGAL.operator ?? "the operator of Bounce";

/**
 * The site's public address, for the sitemap, robots.txt and absolute links in
 * shared cards: an explicit setting first, then the production domain Vercel
 * provides, then the current deployment.
 */
export function siteUrl() {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (production) return `https://${production}`;
  const deployment = process.env.VERCEL_URL;
  if (deployment) return `https://${deployment}`;
  return "http://localhost:3000";
}
