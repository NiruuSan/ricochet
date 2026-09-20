import assert from "node:assert/strict";
import { createDatabase } from "./helpers/test-env.mjs";

// Signing out everywhere. Sessions are cookies the server does not keep, so the
// test is about the line in time: what was issued before the reset is refused.
const { sqlite, close } = await createDatabase();
const { sessionCurrent, signOutEverywhere, forgetSessionCache } = await import("../lib/sessions.ts");
const { listNotifications } = await import("../lib/notifications.ts");

const UID = "github:sessions";
const NOW = Date.UTC(2026, 8, 20, 10);
const MINUTE = 60_000;

try {
  sqlite.prepare("INSERT INTO players(id, name, created) VALUES(?, 'Sess', 0)").run(UID);

  // Nothing has been reset: every session stands, however old.
  assert.equal(await sessionCurrent(UID, NOW - 1000, NOW), true);
  assert.equal(await sessionCurrent(UID, null, NOW), true, "Sessions from before sign-in times were recorded still work");
  forgetSessionCache();

  const { signedOutAt } = await signOutEverywhere(UID, NOW);
  assert.equal(signedOutAt, NOW);
  assert.equal(await sessionCurrent(UID, NOW - 1, NOW + 1), false, "A session from before the reset is refused");
  assert.equal(await sessionCurrent(UID, null, NOW + 1), false, "So is one that never recorded when it signed in");
  assert.equal(await sessionCurrent(UID, NOW, NOW + 1), true, "The sign-in that asked for it still counts");
  assert.equal(await sessionCurrent(UID, NOW + MINUTE, NOW + 2 * MINUTE), true, "A later sign-in works again");
  assert.equal(await sessionCurrent("github:someone-else", NOW - MINUTE, NOW + 1), true, "One player's reset is not another's");

  // The player is told, so a reset they did not ask for is visible.
  const inbox = await listNotifications(UID);
  assert.deepEqual([inbox.items[0].kind, inbox.items[0].data.event], ["security_alert", "signed_out_everywhere"]);

  // Signing out again moves the line forward.
  const later = NOW + 10 * MINUTE;
  await signOutEverywhere(UID, later);
  assert.equal(await sessionCurrent(UID, NOW + MINUTE, later + 1), false, "The sessions opened since the last reset go too");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM session_resets WHERE user_id = ?").get(UID).n, 1, "One row per player, moved forward");

  // The answer is cached briefly, so a reset performed elsewhere lands within
  // that window rather than instantly. This is the documented trade.
  forgetSessionCache();
  const other = "github:other-instance";
  assert.equal(await sessionCurrent(other, later, later), true);
  sqlite.prepare("INSERT INTO session_resets(user_id, invalid_before, created) VALUES(?, ?, ?)").run(other, later + 1, later + 1);
  assert.equal(await sessionCurrent(other, later, later + 10_000), true, "Within the cache window the previous answer stands");
  assert.equal(await sessionCurrent(other, later, later + 31_000), false, "Past it, the reset applies");

  console.log("PASS: sign out everywhere (sessions before the reset refused, undated sessions refused, later sign-ins accepted, per player, notified, repeatable, cache window).");
} finally {
  close();
}
