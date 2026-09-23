import assert from "node:assert/strict";
import { createDatabase } from "./helpers/test-env.mjs";

// Themes: the catalogue, and the shop that sells it.
//
// A skin is the one thing on this site somebody can buy that cannot change a
// result, so the catalogue is checked for exactly that — no theme may carry
// anything the engine reads — and the shop is checked like every other place
// money moves: the purchase row is the lock, a second tap pays nothing, and an
// empty wallet buys nothing.
Object.assign(process.env, {
  SOLANA_NETWORK: "devnet",
  SOLANA_RPC_URL: "https://rpc.invalid",
  SOLANA_VAULT_KEY: Buffer.alloc(32, 7).toString("base64"),
});
const { sqlite, close } = await createDatabase();

const { THEMES, DEFAULT_THEME, themeById } = await import("../lib/themes.ts");
const store = await import("../lib/theme-store.ts");
const { cashAccountId, ensureCashAccount, HOUSE } = await import("../lib/payments/accounts.ts");
const { playerSnapshot } = await import("../lib/matches.ts");

const ANA = "github:ana";
const BEN = "github:ben";
const SOL = 1_000_000_000;
const gems = (uid) => sqlite.prepare("SELECT balance FROM players WHERE id = ?").get(uid).balance;
const cash = (owner) => sqlite.prepare("SELECT balance FROM cash_accounts WHERE id = ?").get(cashAccountId(owner))?.balance ?? 0;
const count = (sql, ...args) => sqlite.prepare(sql).get(...args).n;

try {
  // --- The catalogue --------------------------------------------------------
  assert.equal(THEMES.length, 10, "Ten themes");
  assert.equal(new Set(THEMES.map((t) => t.id)).size, 10, "No two share an id");
  assert.equal(new Set(THEMES.map((t) => t.name)).size, 10, "Nor a name");
  assert.deepEqual(THEMES.filter((t) => t.price === null).map((t) => t.id), [DEFAULT_THEME], "One free theme, and it is the default");
  for (const theme of THEMES) {
    assert.ok(theme.board.bricks.length >= 4, `${theme.id} has a palette`);
    assert.ok(theme.board.radius >= 0 && theme.board.radius <= 20, `${theme.id} has a sane brick corner`);
    assert.ok(theme.tagline.length > 20 && theme.tagline.length < 140, `${theme.id} says what it is`);
    // Nothing a theme carries may be something the engine reads.
    const keys = Object.keys({ ...theme.board, ...theme.effects });
    for (const forbidden of ["speed", "radius_hit", "gravity", "angle", "ticks", "hp"]) {
      assert.ok(!keys.includes(forbidden), `${theme.id} must not carry ${forbidden}`);
    }
  }
  const paid = THEMES.filter((t) => t.price);
  assert.equal(paid.filter((t) => t.price.asset === "gems").length, 6, "Six bought with gems");
  assert.equal(paid.filter((t) => t.price.asset === "devnet").length, 3, "Three bought with devnet SOL");
  assert.ok(
    paid.filter((t) => t.price.asset === "gems").every((t) => t.price.amount >= 1_000 && t.price.amount <= 50_000),
    "Gem prices stay within a day or two of play",
  );
  assert.equal(themeById("nothing-like-this").id, DEFAULT_THEME, "An unknown skin falls back to the default");

  // --- Fixtures -------------------------------------------------------------
  sqlite.prepare("INSERT INTO players(id, name, balance, created) VALUES(?, 'Ana', 30000, 0)").run(ANA);
  sqlite.prepare("INSERT INTO players(id, name, balance, created) VALUES(?, 'Ben', 100, 0)").run(BEN);
  await ensureCashAccount(ANA);
  await ensureCashAccount(HOUSE);
  // Enough for the cheapest premium skin and not for the dearest.
  sqlite.prepare("INSERT INTO cash_ledger VALUES('fund-ana', ?, 'fixture', ?, 'fixture', 0)").run(cashAccountId(ANA), 1.1 * SOL);

  // Everybody starts with the free theme and nothing else.
  assert.deepEqual(await store.themeInventory(ANA), { equipped: DEFAULT_THEME, owned: [DEFAULT_THEME] });

  // --- Buying with gems -----------------------------------------------------
  const neon = THEMES.find((t) => t.id === "neon");
  const before = gems(ANA);
  const bought = await store.buyTheme(ANA, "neon");
  assert.deepEqual(bought, { equipped: "neon", owned: [DEFAULT_THEME, "neon"] }, "Bought is worn");
  assert.equal(gems(ANA), before - neon.price.amount, "The gems are gone, once");
  assert.equal(count("SELECT COUNT(*) AS n FROM ledger WHERE user_id = ? AND kind = 'theme_purchase'", ANA), 1);
  assert.equal(count("SELECT COUNT(*) AS n FROM theme_purchases WHERE user_id = ?", ANA), 1, "One receipt");

  // A second tap buys nothing and pays nothing.
  await assert.rejects(() => store.buyTheme(ANA, "neon"), (e) => e.status === 409);
  assert.equal(gems(ANA), before - neon.price.amount);
  assert.equal(count("SELECT COUNT(*) AS n FROM ledger WHERE user_id = ? AND kind = 'theme_purchase'", ANA), 1);

  // --- An empty wallet ------------------------------------------------------
  await assert.rejects(() => store.buyTheme(BEN, "neon"), (e) => e.status === 409 && /Not enough gems/.test(e.message));
  assert.equal(count("SELECT COUNT(*) AS n FROM theme_purchases WHERE user_id = ?", BEN), 0, "Nothing bought on credit");
  assert.equal(gems(BEN), 100, "And nothing taken");

  // --- Buying with devnet SOL ----------------------------------------------
  const obsidian = THEMES.find((t) => t.id === "obsidian");
  const house = cash(HOUSE);
  const wallet = cash(ANA);
  await store.buyTheme(ANA, "obsidian");
  assert.equal(cash(ANA), wallet - obsidian.price.amount, "The player paid");
  assert.equal(cash(HOUSE), house + obsidian.price.amount, "The house was paid");
  assert.equal(count("SELECT COUNT(*) AS n FROM cash_ledger WHERE reference = 'obsidian'"), 2, "Both sides, once");
  await assert.rejects(() => store.buyTheme(ANA, "void"), /Not enough devnet SOL/, "One SOL is more than is left");

  // --- Wearing --------------------------------------------------------------
  await assert.rejects(() => store.equipTheme(ANA, "sakura"), (e) => e.status === 403, "A theme nobody bought cannot be worn");
  assert.equal((await store.equipTheme(ANA, "neon")).equipped, "neon");
  assert.equal(await store.equippedTheme(ANA), "neon");
  assert.equal((await store.equipTheme(ANA, DEFAULT_THEME)).equipped, DEFAULT_THEME, "The free one is always available");
  await assert.rejects(() => store.equipTheme(ANA, "not-a-theme"), (e) => e.status === 404);

  // A theme in the player's row that they do not own is not worn.
  sqlite.prepare("UPDATE players SET theme = 'void' WHERE id = ?").run(ANA);
  assert.equal(await store.equippedTheme(ANA), DEFAULT_THEME, "Only what is owned reaches the board");
  sqlite.prepare("UPDATE players SET theme = 'neon' WHERE id = ?").run(ANA);

  // --- The arena knows what to paint ---------------------------------------
  assert.equal((await playerSnapshot(ANA, "gems")).theme, "neon", "The snapshot carries the skin");

  // --- A case open on the account ------------------------------------------
  // Proof closes the shop; a statistical review holds the money and leaves the
  // gem shelf open (lib/anti-cheat.ts).
  sqlite
    .prepare("INSERT INTO player_suspensions(user_id, status, source, reason, evidence, created, restricted) VALUES(?, 'suspended', 'stats', 'review', '{}', 0, 1)")
    .run(ANA);
  assert.ok(await store.buyTheme(ANA, "paper"), "Gems still buy paint under review");
  await assert.rejects(() => store.buyTheme(ANA, "solar"), /under review/, "Real money does not move");
  sqlite.prepare("UPDATE player_suspensions SET restricted = 0, source = 'proof' WHERE user_id = ?").run(ANA);
  await assert.rejects(() => store.buyTheme(ANA, "arcade"), (e) => e.status === 403, "A closed account buys nothing");
  sqlite.prepare("DELETE FROM player_suspensions WHERE user_id = ?").run(ANA);

  // --- The store as the page sees it ---------------------------------------
  const page = await store.themeStore(ANA);
  assert.equal(page.themes.length, 10);
  assert.deepEqual(page.owned.sort(), [DEFAULT_THEME, "neon", "obsidian", "paper"].sort());
  const visitor = await store.themeStore(null);
  assert.deepEqual(visitor.owned, [DEFAULT_THEME], "A visitor owns the free one");

  console.log(
    "PASS: themes (catalogue of ten with one free and nothing the engine reads, gem purchase through the ledger, the receipt as the lock, a second tap free, an empty wallet refused, devnet SOL to the house, wearing only what is owned, a skin the player lost falling back, the snapshot, and the shop under an open case).",
  );
} finally {
  close();
}
