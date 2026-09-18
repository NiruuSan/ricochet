import assert from "node:assert/strict";
import webpush from "web-push";
import { createDatabase } from "./helpers/test-env.mjs";

const { sqlite, DB, close } = await createDatabase();
const { adminGrowth } = await import("../lib/admin-growth.ts");
const { touchPlayer } = await import("../lib/matches.ts");
const { parseSubscription, validPushEndpoint, saveSubscription, removeSubscription, dispatchPush } = await import("../lib/push.ts");
const { HOUSE } = await import("../lib/payments/accounts.ts");
const DAY = 86_400_000, now = 100 * DAY + DAY / 2;
const player = (id, at) => sqlite.prepare("INSERT INTO players(id, name, created) VALUES(?, ?, ?)").run(id, id, at);
const visit = (id, day) => sqlite.prepare("INSERT OR IGNORE INTO player_activity(user_id, day) VALUES(?, ?)").run(id, day * DAY);

try {
  sqlite.prepare("UPDATE analytics_metadata SET value = ? WHERE key = 'started'").run(60 * DAY + 123);
  let g = await adminGrowth(now);
  assert.equal(g.deposits.rate, null);
  assert.ok(g.retention.every(r => r.rate === null));
  player("old", 60 * DAY); // Incomplete first day: never eligible.
  player("returned", 68 * DAY + 1);
  player("missed", 68 * DAY + 2);
  player("immature", 99 * DAY + 1);
  player("recent", 90 * DAY + 1);
  player("late", 90 * DAY + 2);
  visit("returned", 69); visit("returned", 75); visit("returned", 98);
  visit("missed", 76); // A day-8 return must not count as day 7.
  visit("old", 90); visit("recent", 91);
  await touchPlayer("returned", now);
  await touchPlayer("returned", now + 21_000);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM player_activity WHERE user_id = 'returned' AND day = ?").get(100 * DAY).n, 1);

  let serial = 0;
  function deposit(uid, at, { status = "finalized", kind = "deposit", amount = 100 } = {}) {
    const id = `deposit-${++serial}`;
    sqlite.prepare(`INSERT INTO cash_transfers(id, network, user_id, account_id, kind, source, destination, amount, fee, signature, wire, last_valid_block_height, status, created, updated)
      VALUES(?, 'devnet', ?, ?, ?, ?, 'pool', ?, 1, ?, 'wire', 100, ?, ?, ?)`)
      .run(id, uid, `devnet:${uid}`, kind, id, amount, id, status, at - 1000, at);
  }
  deposit("returned", 74 * DAY); // First deposit within seven days.
  deposit("returned", now - 100); // Repeated deposit is not a new depositor.
  deposit("recent", 95 * DAY);
  deposit("late", 98 * DAY); // Converts all time but misses 7-day window.
  deposit("missed", now, { status: "pending" });
  deposit("missed", now, { status: "failed" });
  deposit("missed", now, { kind: "withdrawal" });
  deposit("missed", now, { amount: 0 });
  deposit(HOUSE, now);
  deposit("unknown", now);
  g = await adminGrowth(now);
  assert.deepEqual(g.active, { day: 1, week: 2, month: 6 });
  assert.deepEqual(g.retention.map(r => [r.day, r.eligible, r.returned]), [[1, 2, 1], [7, 4, 1], [30, 2, 1]]);
  assert.equal(g.deposits.registered, 6);
  assert.equal(g.deposits.converted, 3);
  assert.equal(g.deposits.rate, 0.5);
  assert.equal(g.deposits.eligible7d, 4);
  assert.equal(g.deposits.converted7d, 2);
  assert.deepEqual(g.deposits.firstDepositors, { day: 0, week: 2, month: 3 });
  assert.equal((await adminGrowth(100 * DAY)).retention.find(r => r.day === 1).eligible, 2, "Current return day excluded even at midnight");
  assert.equal((await adminGrowth(101 * DAY)).retention.find(r => r.day === 1).eligible, 3, "Mature signup enters sliding cohort");

  for (const url of ["http://fcm.googleapis.com/x", "https://localhost/x", "https://127.0.0.1/x", "https://fcm.googleapis.com.evil.test/x", "https://evil@fcm.googleapis.com/x", "https://fcm.googleapis.com:444/x"]) assert.equal(validPushEndpoint(url), false);
  const keys = { p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString("base64url"), auth: Buffer.alloc(16, 2).toString("base64url") };
  const subscription = { endpoint: "https://fcm.googleapis.com/fcm/send/test", keys };
  assert.deepEqual(parseSubscription(subscription), subscription);
  assert.equal(parseSubscription({ ...subscription, keys: { ...keys, auth: "bad" } }), null);
  await saveSubscription("returned", subscription, now);
  await saveSubscription("returned", subscription, now);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM push_subscriptions").get().n, 1);
  await removeSubscription("missed", subscription.endpoint);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM push_subscriptions").get().n, 1, "Cannot unsubscribe another account");
  sqlite.prepare("INSERT INTO matches(id, seed, stake, asset, p1, p2, created, ruleset) VALUES('push-match', 1, 25, 'gems', 'returned', 'missed', ?, 6)").run(now);
  sqlite.prepare("INSERT INTO runs(id, match_id, user_id, state, created) VALUES('push-run', 'push-match', 'missed', '{}', ?)").run(now);
  sqlite.prepare("UPDATE runs SET done = 1, finished = ? WHERE id = 'push-run'").run(now);
  sqlite.prepare("UPDATE runs SET done = 1 WHERE id = 'push-run'").run();
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM push_deliveries").get().n, 1, "One event for the opponent, once");

  const vapid = webpush.generateVAPIDKeys();
  process.env.VAPID_PUBLIC_KEY = vapid.publicKey;
  process.env.VAPID_PRIVATE_KEY = vapid.privateKey;
  process.env.VAPID_SUBJECT = "mailto:test@example.com";
  let calls = 0;
  const send = async (s, data, options) => {
    calls++;
    assert.equal(s.endpoint, subscription.endpoint);
    assert.equal(JSON.parse(data).url, "/?match=push-match");
    assert.ok(!data.includes("missed") && !data.includes("score"), "No opponent score or identity in push payload");
    assert.equal(options.vapidDetails.privateKey, vapid.privateKey);
    return { statusCode: 201, headers: {}, body: "" };
  };
  await Promise.all([dispatchPush(now, send), dispatchPush(now, send)]);
  await dispatchPush(now, send);
  assert.equal(calls, 1, "Concurrent workers and duplicate dispatch do not send twice");
  sqlite.prepare("UPDATE push_deliveries SET sent = NULL, next_attempt = 0, attempts = 0").run();
  await dispatchPush(now, async () => { throw { statusCode: 503 }; });
  assert.equal(sqlite.prepare("SELECT sent FROM push_deliveries").get().sent, null);
  await dispatchPush(now + 59_999, send);
  assert.equal(calls, 1, "Backoff honored");
  await dispatchPush(now + 60_000, send);
  assert.equal(calls, 2, "Transient failures retried");
  sqlite.prepare("UPDATE push_deliveries SET sent = NULL, next_attempt = 0").run();
  await saveSubscription("recent", subscription, now + 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM push_deliveries").get().n, 0, "Switching accounts discards old notices");
  const sid = sqlite.prepare("SELECT id FROM push_subscriptions").get().id;
  sqlite.prepare("INSERT INTO push_deliveries(id, subscription_id, match_id, created) VALUES('expired', ?, 'push-match', ?)").run(sid, now);
  await dispatchPush(now, async () => { throw { statusCode: 410 }; });
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM push_subscriptions").get().n, 0, "Expired subscriptions removed");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM push_deliveries").get().n, 0);

  await saveSubscription("returned", subscription, now);
  sqlite.prepare("UPDATE runs SET done = 0 WHERE id = 'push-run'").run();
  await assert.rejects(DB.batch([
    DB.prepare("UPDATE runs SET done = 1 WHERE id = 'push-run'"),
    DB.prepare("INSERT INTO players(id, name, created) VALUES('returned', 'duplicate', 0)"),
  ]));
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM push_deliveries").get().n, 0, "Failed game transaction never queues a push");
  console.log("PASS: exact UTC retention and mature cohorts, unique visits, confirmed first-deposit conversion, secure push subscriptions, atomic opponent-finished outbox, concurrency, retries, expiry, account switching and rollback.");
} finally { close(); }
