// Badges: marks of who was there, given by the administrator and never
// earned by playing — the rank is for that. Pure data, shared by the server and
// the browser.
//
// Beta tester is for everyone who played before the launch; Founding player
// for the very first, the ones who shaped it. Either opens the Blueprint theme
// (lib/themes.ts), the one theme no amount of gems or SOL can buy.

export const BADGE_IDS = ["founder", "beta"] as const;
export type BadgeId = (typeof BADGE_IDS)[number];

export const BADGES: Record<BadgeId, { name: string; blurb: string }> = {
  founder: { name: "Founding player", blurb: "One of the very first players: there from the start, and part of how Bounce was shaped." },
  beta: { name: "Beta tester", blurb: "Played Bounce before it went live, and helped make it better." },
};

export const isBadge = (value: unknown): value is BadgeId => typeof value === "string" && (BADGE_IDS as readonly string[]).includes(value);

/** A player's badges in display order, the rarest first. */
export const inOrder = (badges: readonly string[]) => BADGE_IDS.filter((id) => badges.includes(id));
