import { database } from "@/db/raw";
import { adminAudit, adminNote } from "./admin";
import { isSuspended } from "./anti-cheat";
import { SUSPENDED_MESSAGE } from "./anti-cheat-rules";
import type { BlockedPlayer, ReportKind, ReportRow } from "./api-types";
import { BLOCKED_MESSAGE, blockedBetween } from "./blocks";
import { avatarUrl, GameError } from "./matches";

export { BLOCKED_MESSAGE, blockedBetween };

/**
 * Blocking and reporting: the two things a player can do about another one.
 *
 * A block is directional — one row, from whoever asked for it — but it is
 * enforced both ways: once it exists, neither of the two can message, befriend,
 * challenge or tip the other. Blocking also clears whatever was already between
 * them, so a conversation cannot be read after the fact.
 *
 * A report goes to the administrator, not to the player it is about. It is kept
 * whatever is decided, because it is the record that a decision was asked for.
 */

export const REPORT_KINDS: ReportKind[] = ["cheating", "harassment", "spam", "other"];
const DETAIL_MAX = 1000;

/** The other player, by the name they are known by. Never the caller. */
async function other(uid: string, nameInput: unknown) {
  const name = String(nameInput ?? "").trim();
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(name)) throw new GameError("No player by that name.", 404);
  const row = await database().prepare("SELECT id, name FROM players WHERE lower(name) = lower(?) AND deleted IS NULL").bind(name).first<{ id: string; name: string }>();
  if (!row) throw new GameError("No player by that name.", 404);
  if (row.id === uid) throw new GameError("That is you.");
  return row;
}

/** Throws if these two have blocked each other, in either direction. */
export async function assertNotBlocked(a: string, b: string) {
  if (await blockedBetween(a, b)) throw new GameError(BLOCKED_MESSAGE, 403);
}

/** Stops hearing from a player, and clears whatever was already between you. */
export async function blockPlayer(uid: string, nameInput: unknown, now = Date.now()) {
  const them = await other(uid, nameInput);
  const [low, high] = uid < them.id ? [uid, them.id] : [them.id, uid];
  const db = database();
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO blocks(blocker_id, blocked_id, created) VALUES(?, ?, ?)").bind(uid, them.id, now),
    // Whatever they were to each other stops here, conversation included.
    db.prepare("DELETE FROM friend_links WHERE low_id = ? AND high_id = ?").bind(low, high),
    db.prepare("DELETE FROM messages WHERE low_id = ? AND high_id = ?").bind(low, high),
  ]);
  return { name: them.name };
}

/** Lets a player through again. Friendship is not restored; it has to be asked for. */
export async function unblockPlayer(uid: string, nameInput: unknown) {
  const them = await other(uid, nameInput);
  const removed = await database().prepare("DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?").bind(uid, them.id).run();
  if (!removed.meta.changes) throw new GameError("You have not blocked this player.", 404);
  return { name: them.name };
}

/** Everyone this player has blocked, newest first. */
export async function blockedList(uid: string): Promise<BlockedPlayer[]> {
  const { results } = await database()
    .prepare(
      `SELECT p.name, p.avatar, b.created FROM blocks b JOIN players p ON p.id = b.blocked_id
       WHERE b.blocker_id = ? AND p.deleted IS NULL ORDER BY b.created DESC`,
    )
    .bind(uid)
    .all<{ name: string; avatar: string | null; created: number }>();
  return results.map((r) => ({ name: r.name, avatar: avatarUrl(r.avatar), since: r.created }));
}

/**
 * Tells the house about a player. One open report per pair: saying it twice
 * adds nothing, and the answer is the same either way.
 */
export async function reportPlayer(uid: string, nameInput: unknown, kindInput: unknown, detailInput: unknown, now = Date.now()) {
  const them = await other(uid, nameInput);
  if (await isSuspended(uid)) throw new GameError(SUSPENDED_MESSAGE, 403);
  const kind = String(kindInput ?? "") as ReportKind;
  if (!REPORT_KINDS.includes(kind)) throw new GameError("Choose what this report is about.");
  const detail = String(detailInput ?? "").trim().slice(0, DETAIL_MAX);
  if (detail.length < 10) throw new GameError("Say what happened, in a sentence or two.");
  const db = database();
  const open = await db.prepare("SELECT 1 AS x FROM reports WHERE reporter_id = ? AND target_id = ? AND status = 'open'").bind(uid, them.id).first();
  if (open) throw new GameError(`Your report about ${them.name} is already with us.`, 409);
  await db
    .prepare("INSERT INTO reports(id, reporter_id, target_id, kind, detail, created, status) VALUES(?, ?, ?, ?, ?, ?, 'open')")
    .bind(crypto.randomUUID(), uid, them.id, kind, detail, now)
    .run();
  return { name: them.name, kind };
}

/** Reports for the administrator: open ones first, newest first. */
export async function adminReports(limit = 100): Promise<ReportRow[]> {
  const { results } = await database()
    .prepare(
      `SELECT r.id, r.kind, r.detail, r.created, r.status, r.note, r.reviewed_at AS reviewedAt,
         (SELECT p.name FROM players p WHERE p.id = r.reporter_id) AS reporter,
         (SELECT p.name FROM players p WHERE p.id = r.target_id) AS target,
         (SELECT COUNT(*) FROM reports o WHERE o.target_id = r.target_id) AS against
       FROM reports r ORDER BY CASE WHEN r.status = 'open' THEN 0 ELSE 1 END, r.created DESC LIMIT ?`,
    )
    .bind(limit)
    .all<ReportRow>();
  return results;
}

/** Closes a report, with the note that says what was done about it. */
export async function resolveReport(adminUid: string, idInput: unknown, noteInput: unknown, now = Date.now()) {
  const note = adminNote(noteInput, true);
  const id = String(idInput ?? "");
  const db = database();
  const report = await db.prepare("SELECT id, target_id, status FROM reports WHERE id = ?").bind(id).first<{ id: string; target_id: string; status: string }>();
  if (!report) throw new GameError("No such report.", 404);
  if (report.status !== "open") throw new GameError("This report has already been reviewed.", 409);
  await db.batch([
    db.prepare("UPDATE reports SET status = 'reviewed', reviewed_by = ?, reviewed_at = ?, note = ? WHERE id = ? AND status = 'open'").bind(adminUid, now, note, id),
    adminAudit(adminUid, "report_reviewed", report.target_id, note, now),
  ]);
  return { id, status: "reviewed" as const };
}
