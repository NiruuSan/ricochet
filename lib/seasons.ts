import { database } from "@/db/raw";

// Seasons.
//
// Rank comes from what a player has wagered (lib/experience.ts), so it is the
// one marker of standing on the site that cannot be bought — only played for.
// That makes it worth resetting: a season gives every player a ladder to climb
// again, and gives the ones at the top something to defend.
//
// A season is two numbers in `app_settings`, not a table: the number of the
// season and the moment it began. Before an administrator ever starts one, the
// season is all of time, so nothing changes until it is used.

const KEY = "season";
export type Season = { number: number; startedAt: number };
const FIRST: Season = { number: 1, startedAt: 0 };

/** The snapshot is polled constantly; the season changes once in a while. */
let cached: { at: number; season: Season } | null = null;
const TTL = 60_000;

export async function currentSeason(now = Date.now()): Promise<Season> {
  if (cached && now - cached.at < TTL) return cached.season;
  const row = await database().prepare("SELECT value FROM app_settings WHERE key = ?").bind(KEY).first<{ value: string }>();
  let season = FIRST;
  if (row) {
    try {
      const parsed = JSON.parse(row.value) as Partial<Season>;
      const number = Number(parsed.number);
      const startedAt = Number(parsed.startedAt);
      if (Number.isSafeInteger(number) && number > 0 && Number.isSafeInteger(startedAt) && startedAt >= 0) season = { number, startedAt };
    } catch {
      // A malformed row is the first season, which is all of time.
    }
  }
  cached = { at: now, season };
  return season;
}

/** The moment the current season began, for the SQL that counts wagering. */
export const seasonStart = async (now = Date.now()) => (await currentSeason(now)).startedAt;

/** Administrator: closes the running season and opens the next one, from now. */
export async function startSeason(adminUid: string, now = Date.now()): Promise<Season> {
  const previous = await currentSeason(now);
  const season: Season = { number: previous.number + 1, startedAt: now };
  const db = database();
  await db.batch([
    db
      .prepare(
        "INSERT INTO app_settings(key, value, updated_by, updated) VALUES(?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated = excluded.updated",
      )
      .bind(KEY, JSON.stringify(season), adminUid, now),
    db
      .prepare("INSERT INTO admin_audit(id, admin_id, action, target_user_id, reason, created) VALUES(?, ?, 'season_start', 'seasons', ?, ?)")
      .bind(crypto.randomUUID(), adminUid, `Season ${season.number} opened`, now),
  ]);
  cached = { at: now, season };
  return season;
}

/** Tests and the admin: forget what was read, so the next call goes to the database. */
export const forgetSeason = () => void (cached = null);
