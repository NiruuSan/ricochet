import { createHash } from "node:crypto";
import { database } from "@/db/raw";
import { json } from "./http";
import { notificationInsert } from "./notifications";
import { verifySecondFactor } from "./two-factor";

// Sudo mode for the administrator.
//
// An administrator can move the house's money: fund a prize, pay a race, put
// the house players at the tables. A session cookie alone must not be enough
// for that, or a stolen cookie is a stolen treasury. So every administrator
// change needs a fresh code from the administrator's authenticator, which opens
// a short window on this one session. The window is keyed by a hash of the
// session cookie (never stored in clear), so every other login needs its own
// code; a cookie stolen outside the window is worth nothing without the phone.
// One copied during the window would share it, which is why the window is
// short, announced to the owner, and closed by signing out everywhere.

/** How long one code keeps administrator changes open on one session. */
export const ELEVATION_MS = 15 * 60_000;

/** Auth.js keeps the session in this cookie, split into .0, .1 … when it is large. */
const SESSION_COOKIES = ["__Secure-authjs.session-token", "authjs.session-token"];

/** The session this request rides on, hashed. Null without one. */
export async function sessionKey(): Promise<string | null> {
  // Loaded here rather than at the top so the rest of this module runs outside a request (in tests).
  const { cookies } = await import("next/headers");
  const jar = await cookies();
  for (const name of SESSION_COOKIES) {
    const whole = jar.get(name)?.value;
    const parts = whole
      ? [whole]
      : jar
          .getAll()
          .filter((c) => c.name.startsWith(`${name}.`))
          .sort((a, b) => Number(a.name.slice(name.length + 1)) - Number(b.name.slice(name.length + 1)))
          .map((c) => c.value);
    if (parts.length) return createHash("sha256").update(parts.join("")).digest("hex");
  }
  return null;
}

/** Whether this session has a confirmed window open right now. */
export async function isElevated(uid: string, session: string | null, now = Date.now()) {
  if (!session) return false;
  const row = await database().prepare("SELECT until FROM admin_elevations WHERE session = ? AND user_id = ?").bind(session, uid).first<{ until: number }>();
  return !!row && row.until > now;
}

/** When the window on this session closes, or null when it is shut. */
export async function elevatedUntil(uid: string, session: string | null, now = Date.now()) {
  if (!session) return null;
  const row = await database().prepare("SELECT until FROM admin_elevations WHERE session = ? AND user_id = ?").bind(session, uid).first<{ until: number }>();
  return row && row.until > now ? row.until : null;
}

/**
 * Opens the window, after a valid authenticator or recovery code. The code goes
 * through the same counted, locking check as a withdrawal, and the owner is
 * told — if it was not them, they know at once.
 */
export async function elevate(uid: string, session: string | null, code: unknown, now = Date.now()) {
  if (!session) throw new Error("No session to confirm.");
  await verifySecondFactor(uid, code, now);
  const until = now + ELEVATION_MS;
  const db = database();
  await db.batch([
    db.prepare("DELETE FROM admin_elevations WHERE user_id = ? AND until <= ?").bind(uid, now),
    db
      .prepare(
        `INSERT INTO admin_elevations(session, user_id, until, created) VALUES(?, ?, ?, ?)
         ON CONFLICT(session) DO UPDATE SET user_id = excluded.user_id, until = excluded.until, created = excluded.created`,
      )
      .bind(session, uid, until, now),
    notificationInsert(db, `security:admin_elevated:${now}`, uid, "security_alert", { event: "admin_elevated", until }, now),
  ]);
  return { until };
}

/** Closes every window this administrator has open, on every device. */
export const dropElevations = (uid: string) => database().prepare("DELETE FROM admin_elevations WHERE user_id = ?").bind(uid);

/**
 * For administrator routes that change something: null when this session has
 * confirmed with a code in the last few minutes, otherwise the response that
 * asks the page for one (the client opens the code prompt and retries).
 */
export async function elevationRequired(uid: string, now = Date.now()) {
  if (await isElevated(uid, await sessionKey(), now)) return null;
  return json(
    { error: "Confirm with a code from your authenticator app to make administrator changes.", code: "ADMIN_ELEVATION_REQUIRED" },
    403,
  );
}
