import { database } from "@/db/raw";
import { adminAudit } from "./admin";
import { BUG_REPORT_LIMITS, type BugReport, type BugReportPage } from "./bug-report-types";
import { GameError } from "./matches";

function textField(value: unknown, label: string, min: number, max: number) {
  if (typeof value !== "string" || value.trim().length < min || value.trim().length > max) {
    throw new GameError(`${label} must contain ${min}–${max} characters.`);
  }
  return value.trim();
}

export async function submitBugReport(uid: string, body: Record<string, unknown>, now = Date.now()) {
  const title = textField(body.title, "Title", 3, BUG_REPORT_LIMITS.title);
  const description = textField(body.description, "Description", 10, BUG_REPORT_LIMITS.description);
  const input = body.links ?? [];
  if (!Array.isArray(input) || input.length > BUG_REPORT_LIMITS.links) throw new GameError("Add up to five image or video links.");
  const links = input.map((value: unknown) => {
    const link = textField(value, "Each link", 1, BUG_REPORT_LIMITS.url);
    let url: URL;
    try { url = new URL(link); } catch { throw new GameError("Use a full https:// or http:// link."); }
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new GameError("Use a full https:// or http:// link without a username or password.");
    // Store the URL without fetching or embedding third-party content.
    return url.href;
  });
  const page = typeof body.page === "string" ? body.page : "";
  if (page.length > 500 || (page && (!page.startsWith("/") || page.startsWith("//") || /[\\?#\u0000-\u001f]/.test(page)))) throw new GameError("Invalid page path.");
  const db = database();
  const player = await db.prepare("SELECT id FROM players WHERE id = ? AND deleted IS NULL").bind(uid).first();
  if (!player) throw new GameError("Create your player profile before sending a bug report.", 403);
  const id = crypto.randomUUID();
  await db.prepare("INSERT INTO bug_reports(id, user_id, title, description, links, page, created, updated) VALUES(?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, uid, title, description, JSON.stringify(links), page, now, now).run();
  return { id };
}

export async function listBugReports(offset = 0): Promise<BugReportPage> {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new GameError("Invalid report page.");
  const db = database();
  const limit = 25;
  const [rows, count] = await Promise.all([
    db.prepare(`SELECT b.id, p.name AS reporter, b.title, b.description, b.links, b.page, b.status, b.created, b.updated
      FROM bug_reports b LEFT JOIN players p ON p.id = b.user_id AND p.deleted IS NULL
      ORDER BY b.created DESC, b.id DESC LIMIT ? OFFSET ?`).bind(limit, offset).all<Omit<BugReport, "links"> & { links: string }>(),
    db.prepare("SELECT COUNT(*) AS total FROM bug_reports").first<{ total: number }>(),
  ]);
  return { reports: rows.results.map((row) => ({ ...row, links: JSON.parse(row.links) as string[] })), total: count?.total ?? 0, offset, limit };
}

export async function updateBugReport(adminUid: string, id: unknown, status: unknown, now = Date.now()) {
  if (typeof id !== "string" || (status !== "open" && status !== "resolved")) throw new GameError("Choose a valid report and status.");
  const db = database();
  const report = await db.prepare("SELECT user_id FROM bug_reports WHERE id = ?").bind(id).first<{ user_id: string }>();
  if (!report) throw new GameError("Bug report not found.", 404);
  await db.batch([
    db.prepare("UPDATE bug_reports SET status = ?, updated = ? WHERE id = ?").bind(status, now, id),
    adminAudit(adminUid, "bug_report_updated", report.user_id, `Bug report ${id}: ${status}`, now),
  ]);
  return { id, status };
}
