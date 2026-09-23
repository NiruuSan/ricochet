import { database, type Statement } from "@/db/raw";
import { isLockedOut, suspensionMessage } from "./anti-cheat";
import { GameError } from "./matches";
import { cashAccountId, ensureCashAccount, HOUSE, settings } from "./payments/accounts";
import { requireDevnet } from "./payments/policy";
import { DEFAULT_THEME, THEMES, themeById, type ThemeId } from "./themes";

// Buying and wearing a skin (lib/themes.ts holds the looks themselves).
//
// A theme changes nothing a shot can feel, so this is the one shop on the site
// where nobody can buy an advantage. It still moves money, so it is written
// like everything else that does: the purchase row is the lock — its key is the
// player and the theme — and the payment only exists if this call is the one
// that took the row. A second tap finds the row already there and pays nothing.

export type ThemeInventory = {
  equipped: ThemeId;
  /** Every theme the player owns, the free one included. */
  owned: ThemeId[];
};

const FREE = THEMES.filter((t) => t.price === null).map((t) => t.id);

export async function themeInventory(uid: string): Promise<ThemeInventory> {
  const db = database();
  const [player, bought] = await Promise.all([
    db.prepare("SELECT theme FROM players WHERE id = ?").bind(uid).first<{ theme: string | null }>(),
    db.prepare("SELECT theme FROM theme_purchases WHERE user_id = ?").bind(uid).all<{ theme: string }>(),
  ]);
  const owned = [...FREE, ...bought.results.map((row) => row.theme as ThemeId)].filter((id) => THEMES.some((t) => t.id === id));
  const equipped = (player?.theme as ThemeId | null) ?? DEFAULT_THEME;
  return { equipped: owned.includes(equipped) ? equipped : DEFAULT_THEME, owned };
}

/** The theme a player wears, for the board and the screens around it. */
export async function equippedTheme(uid: string): Promise<ThemeId> {
  return (await themeInventory(uid)).equipped;
}

function themeOrFail(input: unknown) {
  const theme = THEMES.find((t) => t.id === input);
  if (!theme) throw new GameError("That theme does not exist.", 404);
  return theme;
}

/**
 * Buys a theme, once. Gems come out of the same ledger every other gem spend
 * uses, so the balance check that protects it protects this too; devnet SOL
 * moves from the player to the house in the cash ledger, which is the only way
 * a balance there ever changes.
 */
export async function buyTheme(uid: string, input: unknown, now = Date.now()): Promise<ThemeInventory> {
  const theme = themeOrFail(input);
  if (!theme.price) throw new GameError("This theme is already yours.", 409);
  // A locked-out account buys nothing; a case under review may still spend
  // gems, but never real money (lib/anti-cheat.ts).
  if (await isLockedOut(uid)) throw new GameError(await suspensionMessage(uid), 403);
  const db = database();
  const owned = await db.prepare("SELECT 1 AS yes FROM theme_purchases WHERE user_id = ? AND theme = ?").bind(uid, theme.id).first<{ yes: number }>();
  if (owned) throw new GameError("You already own this theme.", 409);

  const { asset, amount } = theme.price;
  const ops: Statement[] = [
    db
      .prepare("INSERT OR IGNORE INTO theme_purchases(user_id, theme, asset, price, created) VALUES(?, ?, ?, ?, ?)")
      .bind(uid, theme.id, asset, amount, now),
  ];
  if (asset === "devnet") {
    requireDevnet(settings());
    const { assertCanMoveMoney } = await import("./anti-cheat");
    await assertCanMoveMoney(uid);
    await Promise.all([ensureCashAccount(uid), ensureCashAccount(HOUSE)]);
    // Only if this call took the row: the money follows the receipt.
    ops.push(
      db
        .prepare("INSERT INTO cash_ledger(id, account_id, kind, amount, reference, created) SELECT ?, ?, 'theme_purchase', ?, ?, ? FROM theme_purchases WHERE user_id = ? AND theme = ? AND created = ?")
        .bind(`theme:${uid}:${theme.id}:paid`, cashAccountId(uid), -amount, theme.id, now, uid, theme.id, now),
      db
        .prepare("INSERT INTO cash_ledger(id, account_id, kind, amount, reference, created) SELECT ?, ?, 'theme_sale', ?, ?, ? FROM theme_purchases WHERE user_id = ? AND theme = ? AND created = ?")
        .bind(`theme:${uid}:${theme.id}:house`, cashAccountId(HOUSE), amount, theme.id, now, uid, theme.id, now),
    );
  } else {
    ops.push(
      db
        .prepare("INSERT INTO ledger(id, user_id, match_id, kind, amount, created) SELECT ?, ?, NULL, 'theme_purchase', ?, ? FROM theme_purchases WHERE user_id = ? AND theme = ? AND created = ?")
        .bind(`theme:${uid}:${theme.id}`, uid, -amount, now, uid, theme.id, now),
    );
  }

  try {
    await db.batch(ops);
  } catch (e) {
    // The balance checks are in the database, so an empty wallet arrives here.
    const message = e instanceof Error ? e.message : "";
    if (/balance|CHECK|constraint/i.test(message)) {
      throw new GameError(asset === "gems" ? "Not enough gems for this theme yet." : "Not enough devnet SOL for this theme.", 409);
    }
    throw e;
  }
  // Bought is worn: nobody buys a look to leave it in a drawer.
  await db.prepare("UPDATE players SET theme = ? WHERE id = ?").bind(theme.id, uid).run();
  return themeInventory(uid);
}

/** Wears a theme the player owns. */
export async function equipTheme(uid: string, input: unknown): Promise<ThemeInventory> {
  const theme = themeOrFail(input);
  const inventory = await themeInventory(uid);
  if (!inventory.owned.includes(theme.id)) throw new GameError("You do not own this theme yet.", 403);
  await database().prepare("UPDATE players SET theme = ? WHERE id = ?").bind(theme.id, uid).run();
  return { ...inventory, equipped: theme.id };
}

/** Everything the store page shows: the catalogue, and what this player has. */
export async function themeStore(uid: string | null) {
  const inventory = uid ? await themeInventory(uid) : { equipped: DEFAULT_THEME, owned: FREE };
  return { themes: THEMES, ...inventory };
}

export { themeById };
