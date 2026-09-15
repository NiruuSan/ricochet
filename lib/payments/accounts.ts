import { database } from "@/db/raw";

// Ledger account helpers. Kept apart from service.ts so game routes do not load
// @solana/web3.js, which noticeably slows their cold starts.

export const settings = () => process.env as Record<string, string | undefined>;
export const cashAccountId = (uid: string) => `devnet:${uid}`;
export const HOUSE = "__house__";
export const POOL = "__player_pool__";

export async function ensureCashAccount(uid: string) {
  await database()
    .prepare("INSERT OR IGNORE INTO cash_accounts(id, network, user_id, created) VALUES(?, ?, ?, ?)")
    .bind(cashAccountId(uid), "devnet", uid, Date.now())
    .run();
  return cashAccountId(uid);
}
