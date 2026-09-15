import { env } from "cloudflare:workers";

export type Database = D1Database;

export function database(): Database {
  if (!env.DB) throw Error("Demo accounts are temporarily unavailable. Practice is still available.");
  return env.DB;
}

export function adminId() {
  return (env as unknown as Record<string, string | undefined>).RICOCHET_ADMIN_USER_ID;
}
