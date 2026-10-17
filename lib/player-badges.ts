import { database } from "@/db/raw";
import { inOrder, isBadge, type BadgeId } from "./badges";

// Who holds which badge (lib/badges.ts has what they are; lib/badge-admin.ts
// gives and takes them). Read beside names on profiles and leaderboards.

/** Badges for many players at once, rarest first. Players with none are left out. */
export async function badgesFor(uids: string[]): Promise<Map<string, BadgeId[]>> {
  const ids = [...new Set(uids.filter(Boolean))];
  const out = new Map<string, BadgeId[]>();
  for (let i = 0; i < ids.length; i += 400) {
    const chunk = ids.slice(i, i + 400);
    const { results } = await database()
      .prepare(`SELECT user_id, badge FROM player_badges WHERE user_id IN (${chunk.map(() => "?").join(", ")})`)
      .bind(...chunk)
      .all<{ user_id: string; badge: string }>();
    for (const row of results) if (isBadge(row.badge)) out.set(row.user_id, [...(out.get(row.user_id) ?? []), row.badge]);
  }
  for (const [uid, badges] of out) out.set(uid, inOrder(badges));
  return out;
}

export async function badgesOf(uid: string) {
  return (await badgesFor([uid])).get(uid) ?? [];
}
