import { database } from "@/db/raw";
import { applyReferral } from "./referrals";
import { GameError } from "./matches";

const NAME = /^[a-zA-Z0-9_]{3,20}$/;
const MAX_AVATAR_BYTES = 100_000;

/** Browser-resized pictures only. Recognised by their bytes, never by a claimed type. */
const IMAGE_SIGNATURES: [type: string, matches: (b: Buffer) => boolean][] = [
  ["image/jpeg", (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ["image/png", (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
  ["image/webp", (b) => b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP"],
];

function validName(input: unknown) {
  const name = String(input ?? "").trim();
  if (!NAME.test(name)) throw new GameError("Use 3–20 letters, numbers or underscores.");
  return name;
}

const nameTaken = (e: unknown) => e instanceof Error && /UNIQUE constraint failed.*(player_name_unique|players\.name)/i.test(e.message);

/** Creates the player's profile once. Returns false if they already had one. */
export async function createPlayer(uid: string, nameInput: unknown, referral?: unknown) {
  const name = validName(nameInput);
  try {
    // A player who deleted their account and comes back takes their row over
    // again, with a new name; an existing profile is left exactly as it is.
    const result = await database()
      .prepare("INSERT INTO players(id, name, created) VALUES(?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, deleted = NULL WHERE players.deleted IS NOT NULL")
      .bind(uid, name, Date.now())
      .run();
    // A code only counts for a profile that was just created, and never fails it.
    if (result.meta.changes > 0 && referral) await applyReferral(uid, referral).catch(() => null);
    return result.meta.changes > 0;
  } catch (e) {
    if (nameTaken(e)) throw new GameError("That player name is taken. Try another one.", 409);
    throw e;
  }
}

export async function renamePlayer(uid: string, nameInput: unknown) {
  const name = validName(nameInput);
  try {
    const result = await database().prepare("UPDATE players SET name = ? WHERE id = ? AND deleted IS NULL").bind(name, uid).run();
    if (!result.meta.changes) throw new GameError("Create your player profile first.", 403);
  } catch (e) {
    if (nameTaken(e)) throw new GameError("That player name is taken. Try another one.", 409);
    throw e;
  }
  return name;
}

/** Stores a new picture under a fresh random key and drops the previous one. */
export async function setAvatar(uid: string, dataUrl: unknown) {
  const match = typeof dataUrl === "string" ? /^data:image\/[a-z]+;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl) : null;
  if (!match) throw new GameError("Upload a JPEG, PNG or WebP picture.");
  const bytes = Buffer.from(match[1], "base64");
  if (bytes.length > MAX_AVATAR_BYTES) throw new GameError("That picture is too large. Choose a smaller one.", 413);
  const type = IMAGE_SIGNATURES.find(([, matches]) => bytes.length > 12 && matches(bytes))?.[0];
  if (!type) throw new GameError("Upload a JPEG, PNG or WebP picture.");

  const db = database();
  const key = crypto.randomUUID().replaceAll("-", "");
  const [, updated] = await db.batch([
    db.prepare("INSERT INTO avatars(key, user_id, type, data, created) SELECT ?, id, ?, ?, ? FROM players WHERE id = ?").bind(key, type, bytes.toString("base64"), Date.now(), uid),
    db.prepare("UPDATE players SET avatar = ? WHERE id = ?").bind(key, uid),
    db.prepare("DELETE FROM avatars WHERE user_id = ? AND key <> ?").bind(uid, key),
  ]);
  if (!updated.meta.changes) throw new GameError("Create your player profile first.", 403);
  return key;
}

export async function removeAvatar(uid: string) {
  const db = database();
  await db.batch([db.prepare("UPDATE players SET avatar = NULL WHERE id = ?").bind(uid), db.prepare("DELETE FROM avatars WHERE user_id = ?").bind(uid)]);
}

export async function avatarImage(key: string) {
  if (!/^[0-9a-f]{32}$/.test(key)) return null;
  return database().prepare("SELECT type, data FROM avatars WHERE key = ?").bind(key).first<{ type: string; data: string }>();
}
