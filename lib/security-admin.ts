import { randomUUID } from "node:crypto";
import { adminId, database } from "@/db/raw";
import type { AdminSecuritySnapshot } from "./api-types";
import { notificationInsert } from "./notifications";
import { PaymentError } from "./payments/errors";
import { SECURITY_RESET_HOLD_MS, withdrawalHold } from "./security-holds";
import { twoFactorStatus, TwoFactorError, verifySecondFactor } from "./two-factor";

function playerName(input: unknown) {
  if (typeof input !== "string" || !input.trim() || input.trim().length > 32) throw new PaymentError("Enter the player's exact public name.");
  return input.trim();
}

export async function adminTwoFactorLookup(name = "", now = Date.now()): Promise<AdminSecuritySnapshot> {
  const db = database();
  const player = name.trim() ? await db.prepare("SELECT id, name FROM players WHERE lower(name) = lower(?)").bind(playerName(name)).first<{ id: string; name: string }>() : null;
  const recent = await db.prepare(`SELECT a.id, a.action, a.reason, a.created,
      COALESCE(admin.name, 'Administrator') AS adminName, COALESCE(target.name, 'Former player') AS playerName
    FROM admin_audit a LEFT JOIN players admin ON admin.id = a.admin_id
    LEFT JOIN players target ON target.id = a.target_user_id
    WHERE a.action <> 'tournament_delete'
    ORDER BY a.created DESC, a.id DESC LIMIT 30`).all<AdminSecuritySnapshot["recent"][number]>();
  let result: AdminSecuritySnapshot["player"] = null;
  if (player) {
    const [status, row, hold] = await Promise.all([
      twoFactorStatus(player.id, now),
      db.prepare("SELECT enabled_at FROM two_factor WHERE user_id = ? AND enabled = 1").bind(player.id).first<{ enabled_at: number | null }>(),
      withdrawalHold(player.id, now),
    ]);
    result = { name: player.name, ...status, enabledAt: row?.enabled_at ?? null, withdrawalHoldUntil: hold };
  }
  // Reasons are free text; an operator may have pasted a provider identity.
  const publicRecent = recent.results.map((entry) => ({ ...entry, reason: entry.reason.replace(/\b(?:github|google|discord):[^\s,;]+/gi, "[private account]") }));
  return { player: result, recent: publicRecent };
}

export async function adminResetTwoFactor(adminUid: string, nameInput: unknown, reasonInput: unknown, adminCode: unknown, now = Date.now()) {
  if (!adminId() || adminUid !== adminId()) throw new PaymentError("Administrator access required.");
  const name = playerName(nameInput);
  const reason = typeof reasonInput === "string" ? reasonInput.trim() : "";
  if (reason.length < 10 || reason.length > 300) throw new PaymentError("Enter a reason between 10 and 300 characters.");
  const db = database();
  const player = await db.prepare("SELECT id, name FROM players WHERE lower(name) = lower(?)").bind(name).first<{ id: string; name: string }>();
  if (!player) throw new PaymentError("Player not found. Search by their exact public name.");
  if (!(await twoFactorStatus(adminUid, now)).enabled) throw new TwoFactorError("Turn on your own two-factor authentication in your wallet before resetting a player.", "TWO_FACTOR_REQUIRED");
  await verifySecondFactor(adminUid, adminCode, now);
  const id = randomUUID();
  const until = Math.max(now + SECURITY_RESET_HOLD_MS, (await withdrawalHold(player.id, now)) ?? 0);
  await db.batch([
    db.prepare("DELETE FROM two_factor_recovery WHERE user_id = ?").bind(player.id),
    db.prepare("DELETE FROM two_factor WHERE user_id = ?").bind(player.id),
    db.prepare(`INSERT INTO security_holds(user_id, reason, "until", created_by, created) VALUES(?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET reason = excluded.reason, "until" = MAX(security_holds."until", excluded."until"), created_by = excluded.created_by, created = excluded.created`).bind(player.id, "admin_two_factor_reset", until, adminUid, now),
    db.prepare("INSERT INTO admin_audit(id, admin_id, action, target_user_id, reason, created) VALUES(?, ?, 'two_factor_reset', ?, ?, ?)").bind(id, adminUid, player.id, reason, now),
    notificationInsert(db, `security-reset:${id}`, player.id, "security_reset", { holdUntil: until }, now),
  ]);
  return { ok: true, name: player.name, withdrawalHoldUntil: until };
}
