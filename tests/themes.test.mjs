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
const { contrast, labelContrast, over, mixHex, READABLE } = await import("../lib/colour.ts");
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
  assert.equal(THEMES.length, 18, "Eighteen themes");
  assert.equal(new Set(THEMES.map((t) => t.id)).size, 18, "No two share an id");
  assert.equal(new Set(THEMES.map((t) => t.name)).size, 18, "Nor a name");
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
  assert.equal(paid.filter((t) => t.price.asset === "gems").length, 11, "Eleven bought with gems");
  assert.equal(paid.filter((t) => t.price.asset === "devnet").length, 6, "Six bought with devnet SOL");
  // A scene or a brick style is paint too: only names the painter knows.
  const SCENES = ["skyline", "papercraft", "arcade", "sea", "rain", "blossom", "marble", "flare", "nebula", "candy", "snow", "ink", "outrun", "cave", "pulse", "aurora", "felt"];
  const STYLES = ["flat", "paper", "pixel", "pearl", "crt", "petal", "metal", "magma", "glass", "glossy", "ink", "neon", "gem", "gradient", "chip"];
  for (const theme of THEMES) {
    if (theme.board.scene) assert.ok(SCENES.includes(theme.board.scene), `${theme.id} has a known scene`);
    if (theme.board.brick) assert.ok(STYLES.includes(theme.board.brick), `${theme.id} has a known brick style`);
    for (const [face, shade] of theme.board.bricks) assert.match(face + shade, /^#[0-9a-f]{6,8}#[0-9a-f]{6,8}$/i, `${theme.id} colours are hex`);
    assert.ok(["none", "dots", "comet"].includes(theme.effects.trail), `${theme.id} has a known trail`);
  }
  // Every paid theme has a picture behind its board; no two share one, nor a voice.
  assert.ok(paid.every((t) => t.board.scene), "Every theme on sale has a scene");
  assert.equal(new Set(paid.map((t) => t.board.scene)).size, paid.length, "No two themes share a scene");
  assert.equal(new Set(THEMES.map((t) => t.effects.sound)).size, THEMES.length, "Every theme has its own sound");

  // --- Legibility ---------------------------------------------------------
  // A theme may be dark, pale or loud; the game must still be readable in it.
  for (const theme of THEMES) {
    for (const [face, shade] of theme.board.bricks) {
      const ratio = labelContrast(theme, face, shade);
      assert.ok(ratio >= READABLE, `${theme.id}: the number on ${face} reads at ${ratio.toFixed(2)}:1, under ${READABLE}:1`);
    }
    // The ball against the sky it flies through, top to bottom.
    for (const sky of theme.board.sky) {
      const ratio = contrast(theme.board.ball, sky);
      assert.ok(ratio >= 3, `${theme.id}: the ball shows at ${ratio.toFixed(2)}:1 against ${sky}`);
    }
    // The aim guide, at its strongest, against the sky.
    const aim = `#${theme.board.aim.split(",").map((c) => Number(c).toString(16).padStart(2, "0")).join("")}`;
    const sky = mixHex(theme.board.sky[0], theme.board.sky[1], 0.5);
    assert.ok(contrast(over(`${aim}b3`, sky), sky) >= 2, `${theme.id}: the aim guide is visible`);
    // The screens round the board: text on panels, and the accent used as text.
    assert.ok(contrast(theme.ui.ink, theme.ui.surface) >= 7, `${theme.id}: text on its panels reads`);
    assert.ok(contrast(theme.ui.accent, theme.ui.surface) >= 3, `${theme.id}: its accent shows on its panels (${contrast(theme.ui.accent, theme.ui.surface).toFixed(2)}:1)`);
  }
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
  assert.equal(page.themes.length, 18);
  assert.deepEqual(page.owned.sort(), [DEFAULT_THEME, "neon", "obsidian", "paper"].sort());
  const visitor = await store.themeStore(null);
  assert.deepEqual(visitor.owned, [DEFAULT_THEME], "A visitor owns the free one");

  console.log(
    "PASS: themes (catalogue of eighteen with one free and nothing the engine reads, gem purchase through the ledger, the receipt as the lock, a second tap free, an empty wallet refused, devnet SOL to the house, wearing only what is owned, a skin the player lost falling back, the snapshot, and the shop under an open case).",
  );
} finally {
  close();
}
