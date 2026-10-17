import { database, type Statement } from "@/db/raw";
import { BADGES, isBadge, type BadgeId } from "./badges";
import { GameError } from "./matches";
import { notificationInsert } from "./notifications";

// Giving and taking badges (lib/badges.ts has what they are). Only the
// administrator gives them, one player at a time or to everyone at once, and
// every grant is written to the audit log and told to the player.

function badgeOrFail(input: unknown): BadgeId {
  if (!isBadge(input)) throw new GameError("Choose a badge.");
  return input;
}

async function playerNamed(nameInput: unknown) {
  const name = String(nameInput ?? "").trim();
  const player = await database().prepare("SELECT id, name FROM players WHERE lower(name) = lower(?) AND deleted IS NULL").bind(name).first<{ id: string; name: string }>();
  if (!player) throw new GameError("No player by that name.", 404);
  return player;
}

const audit = (adminUid: string, action: string, target: string, note: string, now: number) =>
  database().prepare("INSERT INTO admin_audit(id, admin_id, action, target_user_id, reason, created) VALUES(?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), adminUid, action, target, note, now);

/** Gives one player a badge. Giving it twice changes nothing and tells nobody twice. */
export async function grantBadge(adminUid: string, nameInput: unknown, badgeInput: unknown, now = Date.now()) {
  const badge = badgeOrFail(badgeInput);
  const player = await playerNamed(nameInput);
  const db = database();
  const added = await db.prepare("INSERT OR IGNORE INTO player_badges(user_id, badge, granted_by, granted) VALUES(?, ?, ?, ?)").bind(player.id, badge, adminUid, now).run();
  if (!added.meta.changes) throw new GameError(`${player.name} already has this badge.`, 409);
  await db.batch([notificationInsert(db, `badge:${badge}:${player.id}`, player.id, "badge_granted", { badge }, now), audit(adminUid, "badge.grant", player.id, BADGES[badge].name, now)]);
  return { name: player.name, badge };
}

/** Takes a badge back. */
export async function revokeBadge(adminUid: string, nameInput: unknown, badgeInput: unknown, now = Date.now()) {
  const badge = badgeOrFail(badgeInput);
  const player = await playerNamed(nameInput);
  const gone = await database().prepare("DELETE FROM player_badges WHERE user_id = ? AND badge = ?").bind(player.id, badge).run();
  if (!gone.meta.changes) throw new GameError(`${player.name} does not have this badge.`, 404);
  await audit(adminUid, "badge.revoke", player.id, BADGES[badge].name, now).run();
  return { name: player.name, badge };
}

/**
 * Gives a badge to every player there is right now — people, not the house's
 * players, and not closed accounts. Each new holder is told; anyone who already
 * had it is not told again.
 */
export async function grantToEveryone(adminUid: string, badgeInput: unknown, now = Date.now()) {
  const badge = badgeOrFail(badgeInput);
  const db = database();
  const { results } = await db
    .prepare("SELECT p.id FROM players p WHERE p.bot = 0 AND p.deleted IS NULL AND NOT EXISTS (SELECT 1 FROM player_badges b WHERE b.user_id = p.id AND b.badge = ?)")
    .bind(badge)
    .all<{ id: string }>();
  for (let i = 0; i < results.length; i += 40) {
    const ops: Statement[] = results.slice(i, i + 40).flatMap(({ id }) => [
      db.prepare("INSERT OR IGNORE INTO player_badges(user_id, badge, granted_by, granted) VALUES(?, ?, ?, ?)").bind(id, badge, adminUid, now),
      notificationInsert(db, `badge:${badge}:${id}`, id, "badge_granted", { badge }, now),
    ]);
    await db.batch(ops);
  }
  await audit(adminUid, "badge.grant_all", adminUid, `${BADGES[badge].name} · ${results.length} players`, now).run();
  return { badge, granted: results.length };
}

/** For the administrator: how many hold each badge, and who got one last. */
export async function badgeRoster() {
  const db = database();
  const [counts, recent, without] = await Promise.all([
    db.prepare("SELECT b.badge, COUNT(*) AS n FROM player_badges b JOIN players p ON p.id = b.user_id WHERE p.deleted IS NULL GROUP BY b.badge").all<{ badge: string; n: number }>(),
    db
      .prepare("SELECT p.name, b.badge, b.granted FROM player_badges b JOIN players p ON p.id = b.user_id WHERE p.deleted IS NULL ORDER BY b.granted DESC, p.name LIMIT 12")
      .all<{ name: string; badge: string; granted: number }>(),
    db.prepare("SELECT COUNT(*) AS n FROM players WHERE bot = 0 AND deleted IS NULL").first<{ n: number }>(),
  ]);
  const held = Object.fromEntries(counts.results.filter((row) => isBadge(row.badge)).map((row) => [row.badge, Number(row.n)])) as Partial<Record<BadgeId, number>>;
  return {
    counts: { founder: held.founder ?? 0, beta: held.beta ?? 0 },
    players: Number(without?.n ?? 0),
    recent: recent.results.filter((row) => isBadge(row.badge)).map((row) => ({ name: row.name, badge: row.badge as BadgeId, granted: row.granted })),
  };
}
