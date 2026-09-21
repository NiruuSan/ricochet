import { BlobNotFoundError, del, head } from "@vercel/blob";
import { database } from "@/db/raw";
import { BUG_ATTACHMENT_LIMITS, BUG_ATTACHMENT_TYPES, type BugAttachment } from "./bug-report-types";
import { GameError } from "./matches";

export const ATTACHMENT_LIFETIME = 24 * 60 * 60_000;
/** How many uploads one player may have in flight before finishing a report. */
const PENDING_UPLOADS = 20;
const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
type UploadRow = BugAttachment & { user_id: string; report_id: string | null; pathname: string; created: number };

export function requireAttachmentStorage() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new GameError("File attachments are temporarily unavailable. You can send your report without files.", 503);
}

/** Reserve a unique, non-overwritable object for this authenticated uploader. */
export async function reserveBugAttachment(uid: string, pathname: string, input: Record<string, unknown>, now = Date.now()) {
  requireAttachmentStorage();
  const id = pathname.replace(/^bug-reports\//, "");
  if (!ID.test(id) || pathname !== `bug-reports/${id}`) throw new GameError("Invalid attachment path.");
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const type = typeof input.type === "string" ? input.type : "";
  const size = input.size;
  if (!name || name.length > BUG_ATTACHMENT_LIMITS.name || /[\\/\u0000-\u001f\u007f]/.test(name)) throw new GameError("Invalid attachment filename.");
  if (!BUG_ATTACHMENT_TYPES.includes(type)) throw new GameError("Choose a JPG, PNG, WebP, GIF, HEIC, MP4, WebM or MOV file.");
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size <= 0 || size > BUG_ATTACHMENT_LIMITS.bytes) throw new GameError("Each attachment must be between 1 byte and 25 MB.");
  const db = database();
  const player = await db.prepare("SELECT id FROM players WHERE id = ? AND deleted IS NULL").bind(uid).first();
  if (!player) throw new GameError("Create your player profile before uploading files.", 403);
  // A retry can reuse its reservation, but cannot change ownership or metadata.
  await db.prepare(`INSERT OR IGNORE INTO bug_report_attachments(id, user_id, pathname, name, type, size, created)
    SELECT ?, ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM bug_report_attachments WHERE user_id = ? AND report_id IS NULL AND created > ?) < ${PENDING_UPLOADS}`)
    .bind(id, uid, pathname, name, type, size, now, uid, now - ATTACHMENT_LIFETIME).run();
  const saved = await db.prepare("SELECT * FROM bug_report_attachments WHERE id = ?").bind(id).first<UploadRow>();
  if (!saved) throw new GameError("Too many unfinished uploads. Try again later.", 429);
  if (saved.user_id !== uid || saved.report_id || saved.name !== name || saved.type !== type || saved.size !== size || saved.created <= now - ATTACHMENT_LIFETIME) {
    throw new GameError("This attachment cannot be uploaded. Remove it and choose it again.", 409);
  }
  return { allowedContentTypes: [type], maximumSizeInBytes: size, addRandomSuffix: false, allowOverwrite: false,
    validUntil: Math.min(now + 10 * 60_000, saved.created + ATTACHMENT_LIFETIME) };
}

/** Verify storage metadata ourselves; never trust URLs or upload sizes from the browser. */
export async function verifyBugAttachments(uid: string, input: unknown, now = Date.now()): Promise<string[]> {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > BUG_ATTACHMENT_LIMITS.count || input.some((id) => typeof id !== "string" || !ID.test(id)) || new Set(input).size !== input.length) {
    throw new GameError("Choose up to five different attachments.");
  }
  if (!input.length) return [];
  requireAttachmentStorage();
  for (const id of input) {
    const row = await database().prepare("SELECT * FROM bug_report_attachments WHERE id = ? AND user_id = ? AND report_id IS NULL AND created > ?")
      .bind(id, uid, now - ATTACHMENT_LIFETIME).first<UploadRow>();
    if (!row) throw new GameError("An attachment is unavailable. Remove it and choose it again.", 400);
    let blob;
    try { blob = await head(row.pathname); }
    catch (e) { if (e instanceof BlobNotFoundError) throw new GameError(`Finish uploading ${row.name} before sending the report.`, 409); throw e; }
    if (!new URL(blob.url).hostname.endsWith(".private.blob.vercel-storage.com")) throw new GameError("Attachments require private file storage.", 503);
    if (blob.pathname !== row.pathname || blob.size !== row.size || blob.contentType !== row.type) throw new GameError("The uploaded file does not match its attachment details.");
  }
  return input as string[];
}

export async function bugAttachmentForReader(id: string, uid: string, isAdmin: boolean) {
  if (!ID.test(id)) return null;
  // Unsubmitted uploads are never readable through the app.
  return database().prepare(`SELECT a.* FROM bug_report_attachments a JOIN bug_reports b ON b.id = a.report_id
    WHERE a.id = ? AND (? = 1 OR a.user_id = ?)`)
    .bind(id, isAdmin ? 1 : 0, uid).first<UploadRow>();
}

/** The daily sweep removes abandoned uploads and files whose report was deleted. */
export async function cleanupBugAttachments(now = Date.now()) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return 0;
  const db = database();
  const { results } = await db.prepare(`SELECT a.id, a.pathname FROM bug_report_attachments a
    WHERE a.created <= ? AND (a.report_id IS NULL OR NOT EXISTS (SELECT 1 FROM bug_reports b WHERE b.id = a.report_id)) LIMIT 100`)
    .bind(now - ATTACHMENT_LIFETIME).all<{ id: string; pathname: string }>();
  for (const row of results) {
    await del(row.pathname);
    await db.prepare("DELETE FROM bug_report_attachments WHERE id = ?").bind(row.id).run();
  }
  return results.length;
}
