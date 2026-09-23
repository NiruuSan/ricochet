import { database } from "@/db/raw";
import { isLockedOut } from "./anti-cheat";
import { SUSPENDED_MESSAGE } from "./anti-cheat-rules";
import { MESSAGE_MAX, type FriendList, type FriendMessage } from "./api-types";
import { avatarUrl, GameError } from "./matches";
import { assertNotBlocked, blockedList } from "./moderation";
import { notificationInsert } from "./notifications";

/**
 * Friends, and what they say to each other.
 *
 * A pair is one row, with the lower player ID first, so the same two people can
 * never hold two links in opposite directions. A request is that row as
 * `pending`; accepting moves it to `accepted` and refusing deletes it, which is
 * also what removing a friend does.
 *
 * Messages hang off the same pair. Only an accepted pair may write to one, so
 * nobody can be messaged by a stranger, and a removed friend stops being able
 * to write immediately.
 */

/** The canonical order of a pair: the same two players always key the same row. */
const pair = (a: string, b: string) => (a < b ? { low: a, high: b } : { low: b, high: a });

/** The other player, by the name they are known by. Never returns the caller. */
async function other(uid: string, nameInput: unknown) {
  const name = String(nameInput ?? "").trim();
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(name)) throw new GameError("No player by that name.", 404);
  const row = await database()
    .prepare("SELECT id, name FROM players WHERE lower(name) = lower(?) AND deleted IS NULL")
    .bind(name)
    .first<{ id: string; name: string }>();
  if (!row) throw new GameError("No player by that name.", 404);
  if (row.id === uid) throw new GameError("That is you.");
  return row;
}

const linkFor = (uid: string, them: string) => {
  const { low, high } = pair(uid, them);
  return database()
    .prepare("SELECT low_id, high_id, requested_by, status FROM friend_links WHERE low_id = ? AND high_id = ?")
    .bind(low, high)
    .first<{ low_id: string; high_id: string; requested_by: string; status: string }>();
};

/** Asks someone to be friends. Answering a request they already sent accepts it. */
export async function requestFriend(uid: string, nameInput: unknown, now = Date.now()) {
  const them = await other(uid, nameInput);
  if (await isLockedOut(uid)) throw new GameError(SUSPENDED_MESSAGE, 403);
  await assertNotBlocked(uid, them.id);
  const existing = await linkFor(uid, them.id);
  if (existing?.status === "accepted") throw new GameError(`You and ${them.name} are already friends.`, 409);
  if (existing?.status === "pending") {
    // They asked first: saying it back is the same as accepting.
    if (existing.requested_by !== uid) return answerFriend(uid, nameInput, true, now);
    throw new GameError(`${them.name} has not answered yet.`, 409);
  }
  const { low, high } = pair(uid, them.id);
  const me = await database().prepare("SELECT name FROM players WHERE id = ?").bind(uid).first<{ name: string }>();
  const db = database();
  await db.batch([
    db.prepare("INSERT INTO friend_links(low_id, high_id, requested_by, status, created) VALUES(?, ?, ?, 'pending', ?)").bind(low, high, uid, now),
    notificationInsert(db, `friend:${low}:${high}:${now}`, them.id, "friend_request", { name: me?.name ?? "A player" }, now),
  ]);
  return { name: them.name, status: "pending" as const };
}

/** Accepts or refuses a request somebody else sent. */
export async function answerFriend(uid: string, nameInput: unknown, accept: boolean, now = Date.now()) {
  const them = await other(uid, nameInput);
  const link = await linkFor(uid, them.id);
  if (!link || link.status !== "pending") throw new GameError("There is no request from this player.", 404);
  if (link.requested_by === uid) throw new GameError("This is your own request. They have to answer it.", 409);
  const db = database();
  const me = await db.prepare("SELECT name FROM players WHERE id = ?").bind(uid).first<{ name: string }>();
  await db.batch(
    accept
      ? [
          db.prepare("UPDATE friend_links SET status = 'accepted', answered = ? WHERE low_id = ? AND high_id = ? AND status = 'pending'").bind(now, link.low_id, link.high_id),
          notificationInsert(db, `friend-ok:${link.low_id}:${link.high_id}:${now}`, them.id, "friend_accepted", { name: me?.name ?? "A player" }, now),
        ]
      : [db.prepare("DELETE FROM friend_links WHERE low_id = ? AND high_id = ? AND status = 'pending'").bind(link.low_id, link.high_id)],
  );
  return { name: them.name, status: accept ? ("accepted" as const) : ("declined" as const) };
}

/** Removes a friend, or withdraws a request. The conversation goes with it. */
export async function removeFriend(uid: string, nameInput: unknown) {
  const them = await other(uid, nameInput);
  const { low, high } = pair(uid, them.id);
  const db = database();
  const [removed] = await db.batch([
    db.prepare("DELETE FROM friend_links WHERE low_id = ? AND high_id = ?").bind(low, high),
    db.prepare("DELETE FROM messages WHERE low_id = ? AND high_id = ?").bind(low, high),
  ]);
  if (!removed.meta.changes) throw new GameError("You are not friends with this player.", 404);
  return { name: them.name };
}

type Row = {
  id: string;
  name: string;
  avatar: string | null;
  status: string;
  requested_by: string;
  created: number;
  last_seen: number;
  unread: number;
  last_message: string | null;
  last_at: number | null;
};

/** Everyone this player is friends with, plus the requests waiting on either side. */
export async function friendList(uid: string): Promise<FriendList> {
  const { results } = await database()
    .prepare(
      `SELECT p.id, p.name, p.avatar, f.status, f.requested_by, f.created, p.last_seen,
         (SELECT COUNT(*) FROM messages m WHERE m.low_id = f.low_id AND m.high_id = f.high_id AND m.from_id <> ? AND m.read_at IS NULL) AS unread,
         (SELECT m.body FROM messages m WHERE m.low_id = f.low_id AND m.high_id = f.high_id ORDER BY m.created DESC LIMIT 1) AS last_message,
         (SELECT m.created FROM messages m WHERE m.low_id = f.low_id AND m.high_id = f.high_id ORDER BY m.created DESC LIMIT 1) AS last_at
       FROM friend_links f
       JOIN players p ON p.id = CASE WHEN f.low_id = ? THEN f.high_id ELSE f.low_id END
       WHERE (f.low_id = ? OR f.high_id = ?) AND p.deleted IS NULL
       ORDER BY COALESCE(last_at, f.created) DESC`,
    )
    .bind(uid, uid, uid, uid)
    .all<Row>();
  const seen = (row: Row) => ({
    name: row.name,
    avatar: avatarUrl(row.avatar),
    online: Date.now() - row.last_seen < 90_000,
    since: row.created,
    unread: Number(row.unread ?? 0),
    lastMessage: row.last_message,
    lastAt: row.last_at,
  });
  return {
    friends: results.filter((r) => r.status === "accepted").map(seen),
    incoming: results.filter((r) => r.status === "pending" && r.requested_by !== uid).map(seen),
    outgoing: results.filter((r) => r.status === "pending" && r.requested_by === uid).map(seen),
    blocked: await blockedList(uid),
  };
}

/** How many messages are waiting for this player, across every friend. */
export async function unreadMessages(uid: string) {
  const row = await database()
    .prepare(
      `SELECT COUNT(*) AS n FROM messages m JOIN friend_links f ON f.low_id = m.low_id AND f.high_id = m.high_id AND f.status = 'accepted'
       WHERE (f.low_id = ? OR f.high_id = ?) AND m.from_id <> ? AND m.read_at IS NULL`,
    )
    .bind(uid, uid, uid)
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}

/** What is waiting for this player: requests to answer, and messages to read. */
export async function friendAlerts(uid: string) {
  const row = await database()
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM friend_links f WHERE f.status = 'pending' AND f.requested_by <> ? AND (f.low_id = ? OR f.high_id = ?)) AS requests,
         (SELECT COUNT(*) FROM messages m JOIN friend_links f ON f.low_id = m.low_id AND f.high_id = m.high_id AND f.status = 'accepted'
            WHERE (f.low_id = ? OR f.high_id = ?) AND m.from_id <> ? AND m.read_at IS NULL) AS unread`,
    )
    .bind(uid, uid, uid, uid, uid, uid)
    .first<{ requests: number; unread: number }>();
  return { requests: Number(row?.requests ?? 0), unread: Number(row?.unread ?? 0) };
}

/** Writes to a friend. Only an accepted pair may. */
export async function sendMessage(uid: string, nameInput: unknown, bodyInput: unknown, now = Date.now()) {
  const them = await other(uid, nameInput);
  const body = String(bodyInput ?? "").trim().slice(0, MESSAGE_MAX);
  if (!body) throw new GameError("Write something first.");
  if (await isLockedOut(uid)) throw new GameError(SUSPENDED_MESSAGE, 403);
  await assertNotBlocked(uid, them.id);
  const link = await linkFor(uid, them.id);
  if (link?.status !== "accepted") throw new GameError(`You can only message friends. Add ${them.name} first.`, 403);
  const { low, high } = pair(uid, them.id);
  const id = crypto.randomUUID();
  await database()
    .prepare("INSERT INTO messages(id, low_id, high_id, from_id, body, created) VALUES(?, ?, ?, ?, ?, ?)")
    .bind(id, low, high, uid, body, now)
    .run();
  // The id and the time come back so the sender's own screen, which already
  // shows the message, can settle it without asking for the thread again.
  return { id, name: them.name, body, created: now };
}

/**
 * A conversation, oldest first, marked as read on the way out.
 *
 * `after` asks for only what is newer than the last message the caller already
 * holds, which is what an open thread polls for a few times a minute. The
 * boundary itself comes back again — `>=`, not `>` — so two messages written in
 * the same millisecond cannot fall through the gap; the caller drops what it
 * knows by id. Marking read is a write, so it only happens when the answer
 * actually carries something of theirs, or when the thread is being opened.
 */
export async function conversation(uid: string, nameInput: unknown, now = Date.now(), afterInput?: unknown): Promise<FriendMessage[]> {
  const them = await other(uid, nameInput);
  const link = await linkFor(uid, them.id);
  if (link?.status !== "accepted") throw new GameError("You can only read a conversation with a friend.", 403);
  const { low, high } = pair(uid, them.id);
  const since = Number(afterInput);
  const after = Number.isFinite(since) && since > 0 ? since : null;
  const db = database();
  const { results } = await (after === null
    ? db.prepare("SELECT id, from_id, body, created FROM messages WHERE low_id = ? AND high_id = ? ORDER BY created DESC LIMIT 100").bind(low, high)
    : db
        .prepare("SELECT id, from_id, body, created FROM messages WHERE low_id = ? AND high_id = ? AND created >= ? ORDER BY created DESC LIMIT 100")
        .bind(low, high, after)
  ).all<{ id: string; from_id: string; body: string; created: number }>();
  if (after === null || results.some((m) => m.from_id !== uid))
    await db
      .prepare("UPDATE messages SET read_at = ? WHERE low_id = ? AND high_id = ? AND from_id <> ? AND read_at IS NULL")
      .bind(now, low, high, uid)
      .run();
  return results.reverse().map((m) => ({ id: m.id, mine: m.from_id === uid, body: m.body, created: m.created }));
}
