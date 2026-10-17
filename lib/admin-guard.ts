import { createHash } from "node:crypto";
import { database } from "@/db/raw";
import { json } from "./http";
import { notificationInsert } from "./notifications";
import { TwoFactorError, verifySecondFactor } from "./two-factor";
import { passkeyOnly, verifyPasskey } from "./admin-passkeys";
import type { SignedInUser } from "./auth-user";

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
//
// The same code opens the admin itself for reading, for longer: the players,
// the balances, the reports and the anti-cheat cases are not for a stolen
// cookie either. And both windows belong to the network the code was typed on
// — an IPv4 address, or the /64 an IPv6 home or phone keeps — so a cookie
// carried to another network finds the admin shut and needs the phone again.

/** How long one code keeps administrator changes open on one session. */
export const ELEVATION_MS = 15 * 60_000;
/** How long one code keeps the admin open for reading on one session. */
export const VIEWING_MS = 12 * 3_600_000;

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

/** The first four groups of an IPv6 address, written out: the /64 a home or a phone keeps. */
function v6Prefix(address: string) {
  const [head, tail = ""] = address.split("%")[0].split("::");
  const front = head ? head.split(":") : [];
  const back = tail ? tail.split(":") : [];
  const groups = address.includes("::") ? [...front, ...Array<string>(Math.max(0, 8 - front.length - back.length)).fill("0"), ...back] : front;
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":");
}

/** A network, hashed: the IPv4 address, or the IPv6 /64. */
export function networkOf(address: string | null | undefined) {
  const ip = (address ?? "").trim().toLowerCase();
  const v4 = /^(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
  const key = !ip ? "unknown" : v4 ? v4[1] : ip.includes(":") ? v6Prefix(ip) : ip;
  return createHash("sha256").update(`network:${key}`).digest("hex");
}

/** The network the request being served comes from (behind Vercel, the first forwarded address). */
export async function requestNetwork() {
  const { headers } = await import("next/headers");
  const h = await headers();
  return networkOf(h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip"));
}

type Window = { until: number; viewing_until: number | null; network: string | null };

async function windowOf(uid: string, session: string | null) {
  if (!session) return null;
  return database().prepare("SELECT until, viewing_until, network FROM admin_elevations WHERE session = ? AND user_id = ?").bind(session, uid).first<Window>();
}

/** A window opened on one network does not open on another. */
const fromHere = (row: Window, network: string | null) => row.network === null || row.network === network;

/** Whether this session may make administrator changes right now, from this network. */
export async function isElevated(uid: string, session: string | null, now = Date.now(), network: string | null = null) {
  const row = await windowOf(uid, session);
  return !!row && row.until > now && fromHere(row, network);
}

/** Whether this session may read the admin right now, from this network. */
export async function isViewing(uid: string, session: string | null, now = Date.now(), network: string | null = null) {
  const row = await windowOf(uid, session);
  return !!row && (row.viewing_until ?? 0) > now && fromHere(row, network);
}

/** When the two windows on this session close; null for one that is shut. */
export async function elevatedUntil(uid: string, session: string | null, now = Date.now(), network: string | null = null) {
  const row = await windowOf(uid, session);
  const here = !!row && fromHere(row, network);
  return {
    until: here && row.until > now ? row.until : null,
    viewingUntil: here && (row.viewing_until ?? 0) > now ? row.viewing_until : null,
  };
}

/**
 * Opens the window, after a valid authenticator or recovery code. The code goes
 * through the same counted, locking check as a withdrawal, and the owner is
 * told — if it was not them, they know at once. Once the administrator has
 * chosen "passkey only" (lib/admin-passkeys.ts), an app code is refused before
 * it is even checked; a recovery code still opens it, as the way back in.
 */
export async function elevate(uid: string, session: string | null, code: unknown, now = Date.now(), network: string | null = null) {
  if (!session) throw new Error("No session to confirm.");
  if (/^\d{3}\s?\d{3}$/.test(typeof code === "string" ? code.trim() : "") && (await passkeyOnly())) {
    throw new TwoFactorError("The admin opens with your passkey only. Use it, or one of your recovery codes.", "PASSKEY_REQUIRED");
  }
  await verifySecondFactor(uid, code, now);
  return openWindows(uid, session, now, network, "code");
}

/** Opens the window with one of the administrator's passkeys, answering this session's challenge. */
export async function elevateWithPasskey(uid: string, session: string | null, origin: string, response: unknown, now = Date.now(), network: string | null = null) {
  if (!session) throw new Error("No session to confirm.");
  await verifyPasskey(uid, session, origin, response, now);
  return openWindows(uid, session, now, network, "passkey");
}

async function openWindows(uid: string, session: string, now: number, network: string | null, by: "code" | "passkey") {
  const until = now + ELEVATION_MS;
  const viewingUntil = now + VIEWING_MS;
  const db = database();
  await db.batch([
    db.prepare("DELETE FROM admin_elevations WHERE user_id = ? AND COALESCE(viewing_until, until) <= ?").bind(uid, now),
    db
      .prepare(
        `INSERT INTO admin_elevations(session, user_id, until, viewing_until, network, created) VALUES(?, ?, ?, ?, ?, ?)
         ON CONFLICT(session) DO UPDATE SET user_id = excluded.user_id, until = excluded.until, viewing_until = excluded.viewing_until,
           network = excluded.network, created = excluded.created`,
      )
      .bind(session, uid, until, viewingUntil, network, now),
    notificationInsert(db, `security:admin_elevated:${now}`, uid, "security_alert", { event: "admin_elevated", until, by }, now),
  ]);
  return { until, viewingUntil };
}

/** Closes every window this administrator has open, on every device. */
export const dropElevations = (uid: string) => database().prepare("DELETE FROM admin_elevations WHERE user_id = ?").bind(uid);

/**
 * For administrator routes that change something: null when this session has
 * confirmed with a code in the last few minutes, otherwise the response that
 * asks the page for one (the client opens the code prompt and retries).
 */
export async function elevationRequired(uid: string, now = Date.now()) {
  if (await isElevated(uid, await sessionKey(), now, await requestNetwork())) return null;
  return json(
    { error: "Confirm with a code from your authenticator app to make administrator changes.", code: "ADMIN_ELEVATION_REQUIRED" },
    403,
  );
}

/**
 * For administrator routes that read: the administrator, once this session
 * has opened the admin with a code in the last 12 hours from this network.
 * Otherwise `locked` is the answer to send: a plain refusal for anyone else,
 * or, for the administrator, the one that asks the page for a code.
 */
export async function adminReader(now = Date.now()): Promise<{ user: SignedInUser; locked: null } | { user: null; locked: Response }> {
  const { administrator } = await import("@/lib/auth-user");
  const user = await administrator();
  if (!user) return { user: null, locked: json({ error: "Administrator access required." }, 403) };
  if (await isViewing(user.userId, await sessionKey(), now, await requestNetwork())) return { user, locked: null };
  return {
    user: null,
    locked: json({ error: "Enter a code from your authenticator app to open the admin on this device.", code: "ADMIN_VIEW_REQUIRED" }, 403),
  };
}
