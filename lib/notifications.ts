import { database, type Database } from "@/db/raw";
import type { NotificationItem } from "./api-types";

const PAGE = 20;

/**
 * A notification insert for an existing batch. IDs are derived from the event
 * (a match and player, a tip), so recording the same event twice is a no-op.
 */
export function notificationInsert(db: Database, id: string, uid: string, kind: NotificationItem["kind"], data: unknown, created: number) {
  return db
    .prepare("INSERT OR IGNORE INTO notifications(id, user_id, kind, data, created) VALUES(?, ?, ?, ?, ?)")
    .bind(id, uid, kind, JSON.stringify(data), created);
}

type Row = { id: string; kind: NotificationItem["kind"]; data: string; created: number; read_at: number | null; unread: number };

/** The player's latest notifications, newest first, with the total still unread. */
export async function listNotifications(uid: string): Promise<{ items: NotificationItem[]; unread: number }> {
  const [rows, count] = await Promise.all([
    database()
      .prepare("SELECT id, kind, data, created, read_at FROM notifications WHERE user_id = ? ORDER BY created DESC, id DESC LIMIT ?")
      .bind(uid, PAGE)
      .all<Omit<Row, "unread">>(),
    database().prepare("SELECT COUNT(*) AS unread FROM notifications WHERE user_id = ? AND read_at IS NULL").bind(uid).first<Pick<Row, "unread">>(),
  ]);
  return {
    items: rows.results.map((r) => ({ id: r.id, kind: r.kind, created: r.created, read: r.read_at !== null, data: JSON.parse(r.data) }) as NotificationItem),
    unread: Number(count?.unread ?? 0),
  };
}

/** Marks the player's notifications read: the given IDs, one match's, or all of them. */
export async function markNotificationsRead(uid: string, { ids, matchId }: { ids?: unknown; matchId?: unknown }, now = Date.now()) {
  const db = database();
  if (Array.isArray(ids)) {
    const list = ids.filter((id): id is string => typeof id === "string").slice(0, 50);
    if (!list.length) return;
    await db
      .prepare(`UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL AND id IN (${list.map(() => "?").join(", ")})`)
      .bind(now, uid, ...list)
      .run();
  } else if (typeof matchId === "string") {
    await db
      .prepare("UPDATE notifications SET read_at = ? WHERE id IN (?, ?) AND user_id = ? AND read_at IS NULL")
      .bind(now, `${matchId}:result:p1`, `${matchId}:result:p2`, uid)
      .run();
  } else {
    await db.prepare("UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL").bind(now, uid).run();
  }
}
