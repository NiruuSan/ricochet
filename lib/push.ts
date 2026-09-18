import webpush from "web-push";
import { database } from "@/db/raw";

export function pushConfig() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  return publicKey && privateKey && subject ? { publicKey, privateKey, subject } : null;
}

/** An endpoint is untrusted input: only browser push services may receive requests. */
export function validPushEndpoint(input: unknown): input is string {
  if (typeof input !== "string" || input.length > 2048) return false;
  try {
    const u = new URL(input);
    return u.protocol === "https:" && !u.username && !u.password && !u.port && !u.hash && (
      u.hostname === "fcm.googleapis.com" || u.hostname === "updates.push.services.mozilla.com" ||
      u.hostname === "web.push.apple.com" || u.hostname.endsWith(".push.apple.com") ||
      u.hostname === "wns.windows.com" || u.hostname.endsWith(".notify.windows.com")
    );
  } catch { return false; }
}

export function parseSubscription(input: unknown): webpush.PushSubscription | null {
  if (!input || typeof input !== "object") return null;
  const s = input as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  const key = (value: unknown, bytes: number) => typeof value === "string" && /^[\w-]+={0,2}$/.test(value) && Buffer.from(value, "base64url").length === bytes;
  if (!validPushEndpoint(s.endpoint) || !key(s.keys?.p256dh, 65) || !key(s.keys?.auth, 16)) return null;
  if (Buffer.from(s.keys!.p256dh as string, "base64url")[0] !== 4) return null;
  return { endpoint: s.endpoint, keys: { p256dh: s.keys!.p256dh as string, auth: s.keys!.auth as string } };
}

export async function saveSubscription(uid: string, s: webpush.PushSubscription, now = Date.now()) {
  const db = database();
  // A browser can belong to one account at a time. Moving it drops queued notices for the previous account.
  await db.batch([
    db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id <> ?").bind(s.endpoint, uid),
    db.prepare(`INSERT INTO push_subscriptions(id, user_id, endpoint, p256dh, auth, created)
      VALUES(?, ?, ?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth`)
      .bind(crypto.randomUUID(), uid, s.endpoint, s.keys.p256dh, s.keys.auth, now),
    db.prepare(`DELETE FROM push_subscriptions WHERE user_id = ? AND id NOT IN
      (SELECT id FROM push_subscriptions WHERE user_id = ? ORDER BY created DESC LIMIT 10)`).bind(uid, uid),
  ]);
}

export async function removeSubscription(uid: string, endpoint: string) {
  await database().prepare("DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?").bind(uid, endpoint).run();
}

type Delivery = { id: string; subscription_id: string; match_id: string; attempts: number; endpoint: string; p256dh: string; auth: string };
type Sender = typeof webpush.sendNotification;

/** Leased, bounded work. A stable notification tag collapses a retry after a process crash. */
export async function dispatchPush(now = Date.now(), send: Sender = webpush.sendNotification) {
  const config = pushConfig();
  if (!config) return;
  const db = database();
  await db.prepare("DELETE FROM push_deliveries WHERE created < ?").bind(now - 7 * 86_400_000).run();
  const rows = await db.prepare(`SELECT d.*, s.endpoint, s.p256dh, s.auth FROM push_deliveries d
    JOIN push_subscriptions s ON s.id = d.subscription_id
    WHERE d.sent IS NULL AND d.next_attempt <= ? AND d.attempts < 6 ORDER BY d.created LIMIT 30`)
    .bind(now).all<Delivery>();
  // Small batches bound open sockets and the time spent in a serverless invocation.
  for (let i = 0; i < rows.results.length; i += 10) {
    await Promise.all(rows.results.slice(i, i + 10).map(async (d) => {
      const claim = await db.prepare(`UPDATE push_deliveries SET attempts = attempts + 1, next_attempt = ?
        WHERE id = ? AND sent IS NULL AND next_attempt <= ? AND attempts = ?`)
        .bind(now + 60_000, d.id, now, d.attempts).run();
      if (!claim.meta.changes) return;
      try {
        if (!validPushEndpoint(d.endpoint)) throw { statusCode: 410 };
        await send({ endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } }, JSON.stringify({
          title: "Your opponent has finished", body: "Open Bounce to view your match.",
          url: `/?match=${encodeURIComponent(d.match_id)}`, tag: `match:${d.match_id}`,
        }), { vapidDetails: config, TTL: 86_400, timeout: 5_000 });
        await db.prepare("UPDATE push_deliveries SET sent = ? WHERE id = ?").bind(now, d.id).run();
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await db.prepare("DELETE FROM push_subscriptions WHERE id = ?").bind(d.subscription_id).run();
        } else {
          await db.prepare("UPDATE push_deliveries SET next_attempt = ? WHERE id = ?")
            .bind(now + Math.min(3_600_000, 60_000 * 2 ** d.attempts), d.id).run();
          // Never log the endpoint, encryption keys or vendor error body.
          console.warn("Web push delivery will retry", status ?? "transport failure");
        }
      }
    }));
  }
}
