import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createDatabase } from "./helpers/test-env.mjs";

const { sqlite, close } = await createDatabase();
globalThis.bugReportUser = null;
const hook = registerHooks({
  resolve(specifier, context, next) {
    return specifier === "@/lib/auth-user" ? { url: "test:bug-report-auth", shortCircuit: true } : next(specifier, context);
  },
  load(url, context, next) {
    return url === "test:bug-report-auth" ? { format: "module", shortCircuit: true, source: `
      export async function currentUser() { return globalThis.bugReportUser; }
      export async function administrator() { const u = globalThis.bugReportUser; return u?.userId === 'admin' ? u : null; }
    ` } : next(url, context);
  },
});

try {
  const { submitBugReport, listBugReports, updateBugReport } = await import("../lib/bug-reports.ts");
  const { exportAccount, deleteAccount } = await import("../lib/account.ts");
  const submit = await import("../app/api/bug-reports/route.ts");
  const admin = await import("../app/api/admin/bug-reports/route.ts");
  for (const name of ["Player", "Other", "admin"]) sqlite.prepare("INSERT INTO players(id, name, created) VALUES(?, ?, 0)").run(name, name);
  const payload = { title: "  Entry button stopped working  ", description: "I selected a match, then tapped the entry button. Nothing happened.\nExpected: start the match.", links: ["https://example.com/screenshot.png", "https://example.com/video.mp4"], page: "/friends" };
  const post = (route, body, origin = "https://ricochet.test") => route.POST(new Request("https://ricochet.test/api/bug-reports", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) }));
  const get = (query = "") => admin.GET(new Request(`https://ricochet.test/api/admin/bug-reports${query}`));

  assert.equal((await post(submit, payload)).status, 401);
  assert.equal((await get()).status, 403);
  globalThis.bugReportUser = { userId: "Player" };
  assert.equal((await post(submit, payload, "https://evil.test")).status, 403);
  assert.equal((await get()).status, 403, "Player reports are admin-only");
  assert.equal((await post(admin, { id: "anything", status: "resolved" })).status, 403);

  const response = await post(submit, payload);
  assert.equal(response.status, 201);
  const { id } = await response.json();
  const saved = (await listBugReports()).reports[0];
  assert.equal(saved.id, id);
  assert.equal(saved.title, payload.title.trim());
  assert.equal(saved.description, payload.description, "Text and line breaks are retained");
  assert.deepEqual(saved.links, payload.links, "Both image and video links are retained");
  assert.equal(saved.reporter, "Player");
  assert.equal(saved.status, "open");
  assert.equal(saved.page, "/friends");

  for (const patch of [
    { title: " " }, { title: "x".repeat(121) }, { description: "short" }, { description: "x".repeat(6001) },
    { links: "https://example.com" }, { links: Array(6).fill("https://example.com") },
    { links: ["javascript:alert(1)"] }, { links: ["data:image/png;base64,abc"] }, { links: ["file:///secret"] },
    { links: ["https://user:password@example.com"] }, { links: ["not a link"] }, { links: [null] },
    { page: "//evil.test" }, { page: "/?token=secret" }, { page: "/\\evil.test" },
  ]) await assert.rejects(() => submitBugReport("Player", { ...payload, ...patch }), (e) => e.status === 400);
  await assert.rejects(() => submitBugReport("missing", payload), (e) => e.status === 403);
  const plain = await submitBugReport("Other", { ...payload, links: [] }, 1);
  assert.deepEqual((await listBugReports()).reports.find((r) => r.id === plain.id).links, [], "Text-only reports work");

  globalThis.bugReportUser = { userId: "admin" };
  const inbox = await get();
  assert.equal(inbox.status, 200);
  assert.equal(inbox.headers.get("cache-control"), "no-store");
  assert.equal((await inbox.json()).total, 2);
  assert.equal((await post(admin, { id, status: "resolved" }, "https://evil.test")).status, 403);
  assert.equal((await post(admin, { id, status: "resolved" })).status, 200);
  assert.equal((await listBugReports()).reports.find((r) => r.id === id).status, "resolved");
  assert.equal((await post(admin, { id, status: "open" })).status, 200);
  assert.equal((await listBugReports()).reports.find((r) => r.id === id).status, "open");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM admin_audit WHERE action = 'bug_report_updated'").get().n, 2);
  await assert.rejects(() => updateBugReport("admin", id, "invalid"), (e) => e.status === 400);
  await assert.rejects(() => updateBugReport("admin", "missing", "resolved"), (e) => e.status === 404);
  assert.equal((await get("?offset=-1")).status, 400);
  assert.equal((await get("?offset=oops")).status, 400);

  for (let i = 0; i < 27; i++) await submitBugReport("Other", { ...payload, title: `Bug ${i}` }, 100);
  const first = await listBugReports();
  const second = await listBugReports(25);
  assert.equal(first.reports.length, 25);
  assert.equal(second.reports.length, 4);
  assert.equal(new Set([...first.reports, ...second.reports].map((r) => r.id)).size, 29, "Every report can be reached, including tied timestamps");

  globalThis.bugReportUser = { userId: "Player" };
  sqlite.prepare('UPDATE rate_limits SET count = 5 WHERE key = ? AND "window" = ?').run("bugReportWrite:Player", Math.floor(Date.now() / 60_000));
  assert.equal((await post(submit, payload)).status, 429);
  assert.equal((await exportAccount("Player")).bugReports.length, 1, "Reports are included in account exports");
  await deleteAccount("Player");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM bug_reports WHERE user_id = 'Player'").get().n, 0, "Account deletion removes submitted content");
  assert.equal((await listBugReports()).total, 28, "Other players' reports remain");
  console.log("PASS: bug reports (submission, media links, text-only reports, validation, access controls, resolve/reopen, audit, pagination, rate limits and account lifecycle).");
} finally {
  hook.deregister();
  delete globalThis.bugReportUser;
  close();
}
