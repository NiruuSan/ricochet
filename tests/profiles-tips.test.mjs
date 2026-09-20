import assert from "node:assert/strict";
import { createDatabase } from "./helpers/test-env.mjs";

Object.assign(process.env, { SOLANA_NETWORK: "devnet", SOLANA_RPC_URL: "https://rpc.invalid", SOLANA_VAULT_KEY: Buffer.alloc(32, 5).toString("base64") });
const { sqlite, close } = await createDatabase();
const { publicProfile } = await import("../lib/public-profile.ts");
const { createPlayer, renamePlayer } = await import("../lib/profile.ts");
const { sendTip } = await import("../lib/payments/tips.ts");
const { cashAccountId, ensureCashAccount } = await import("../lib/payments/accounts.ts");
const { playerSnapshot } = await import("../lib/matches.ts");
const { pnlSeries, profilePerformance } = await import("../lib/profile-performance.ts");
const { listNotifications } = await import("../lib/notifications.ts");
globalThis.fetch = async () => { throw new Error("Internal tips must not submit a blockchain transaction"); };

try {
  const ALICE = "private-alice", BOB = "private-bob", CAROL = "private-carol";
  for (const [uid, name] of [[ALICE, "Alice"], [BOB, "Bob"], [CAROL, "Carol"]]) {
    await createPlayer(uid, name);
    await ensureCashAccount(uid);
  }
  const fund = (uid, amount) => sqlite.prepare("INSERT INTO cash_ledger VALUES(?, ?, 'deposit', ?, 'test-funding', 0)").run(crypto.randomUUID(), cashAccountId(uid), amount);
  const balance = (uid) => sqlite.prepare("SELECT balance FROM cash_accounts WHERE id = ?").get(cashAccountId(uid)).balance;
  const total = () => sqlite.prepare("SELECT SUM(balance) AS total FROM cash_accounts").get().total;
  fund(ALICE, 2_000_000_000);
  const bob = await publicProfile("bOB", ALICE);
  assert.match(bob.publicId, /^[0-9a-f]{32}$/);
  assert.equal(bob.name, "Bob");
  assert.equal(bob.isYou, false);
  assert.equal((await publicProfile("Alice", ALICE)).isYou, true);
  assert.deepEqual(await publicProfile({ id: ALICE }, ALICE), await publicProfile("alice", ALICE), "Your own profile can be loaded by account, without knowing your name");
  assert.deepEqual((await profilePerformance({ id: BOB }, "gems")).history, (await profilePerformance("bob", "gems")).history);
  assert.deepEqual(bob.stats.gems, { pnl: 0, games: 0, wins: 0 });
  assert.deepEqual(Object.keys(bob).sort(), ["avatar", "created", "isYou", "level", "name", "publicId", "stats"]);
  await assert.rejects(() => publicProfile("Missing"), /not found/);
  await assert.rejects(() => publicProfile("' OR 1=1 --"), /not found/);

  // More than a page of history, including a legacy fee-bearing gem win.
  for (let i = 0; i < 61; i++) {
    const fee = i === 0 ? 24 : 0;
    sqlite.prepare("INSERT INTO matches(id, seed, stake, p1, p2, settled, winner, fee, created) VALUES(?, 1, 100, ?, ?, 1, ?, ?, ?)").run(`history-${i}`, BOB, ALICE, BOB, fee, i);
    sqlite.prepare("INSERT INTO ledger VALUES(?, ?, ?, 'entry', -100, ?)").run(`entry-${i}`, BOB, `history-${i}`, i);
    sqlite.prepare("INSERT INTO ledger VALUES(?, ?, ?, 'payout', ?, ?)").run(`payout-${i}`, BOB, `history-${i}`, 200 - fee, i);
  }
  sqlite.prepare("INSERT INTO matches(id, seed, stake, p1, created) VALUES('open', 1, 100, ?, 100)").run(BOB);
  sqlite.prepare("INSERT INTO ledger VALUES('open-entry', ?, 'open', 'entry', -100, 100)").run(BOB);
  sqlite.prepare("INSERT INTO runs(id, match_id, user_id, state, done, created) VALUES('historic-run', 'history-0', ?, '{}', 1, 0)").run(BOB);
  const before = await publicProfile("Bob");
  assert.deepEqual(before.stats.gems, { pnl: 6076, games: 61, wins: 61 });
  assert.equal((await playerSnapshot(BOB, "gems")).matches.find((m) => m.id === "history-0").net, 76, "Historical PNL keeps its actual fee");

  // Profile dashboard: the all-time chart ends at the same PNL as the public stats; recent ranges exclude old matches.
  const performance = await profilePerformance("bob", "gems");
  assert.equal(performance.series.all.total, before.stats.gems.pnl);
  assert.equal(performance.series.all.points.at(-1).value, before.stats.gems.pnl);
  assert.deepEqual([performance.series.day.total, performance.series.year.total], [0, 0], "1970 fixtures fall outside recent ranges");
  assert.deepEqual([performance.played, performance.openEntries, performance.bestWin], [62, 100, 100]);
  assert.equal(performance.history[0].id, "open");
  assert.equal(performance.history.find((m) => m.id === "history-0").net, 76);
  assert.ok(!JSON.stringify(performance).includes("private-"), "Performance carries no player IDs");
  await assert.rejects(() => profilePerformance("Missing", "gems"), /not found/);
  const now = Date.now();
  const recent = pnlSeries([{ id: "r", stake: 10, created: now - 3_600_000, settled: 1, opponent: null, opponentAvatar: null, result: "win", net: 7, ended: now - 3_600_000 }], now);
  assert.deepEqual([recent.day.total, recent.week.total, recent.all.total, recent.day.points[0].value], [7, 7, 7, 0]);

  // Tips are gated like a withdrawal past a day's free allowance, so each
  // scenario below gets its own UTC day, and the large ones carry a code.
  const DAY = 86_400_000;
  const tf = await import("../lib/two-factor.ts");
  const setup = await tf.beginTwoFactorSetup(ALICE, "Alice", DAY);
  const { recoveryCodes } = await tf.confirmTwoFactorSetup(ALICE, tf.totpCode(tf.base32Decode(setup.secret), tf.currentStep(DAY)), DAY);
  let spare = 0;
  const code = () => recoveryCodes[spare++];

  const id = crypto.randomUUID();
  const liabilities = total();
  const receipt = await sendTip(ALICE, id, bob.publicId, "0.25", code(), DAY);
  assert.equal(receipt.amount, 250_000_000);
  assert.equal(balance(ALICE), 1_750_000_000);
  assert.equal(balance(BOB), 250_000_000);
  assert.equal(total(), liabilities, "Tips conserve funded balances");
  const tipInbox = await listNotifications(BOB);
  assert.deepEqual([tipInbox.unread, tipInbox.items[0].kind, tipInbox.items[0].data], [1, "tip_received", { amount: 250_000_000, from: "Alice" }]);
  assert.deepEqual(await sendTip(ALICE, id, bob.publicId, "0.25", undefined, DAY), receipt, "A retry of a sent tip needs no new code");
  assert.equal(balance(BOB), 250_000_000);
  assert.equal((await listNotifications(BOB)).unread, 1, "A retried tip notifies once");
  assert.deepEqual((await publicProfile("Bob")).stats, before.stats, "Tips do not change PNL or match counts");
  await assert.rejects(() => sendTip(ALICE, id, bob.publicId, "0.5", code(), DAY), /different request/);
  await assert.rejects(() => sendTip(CAROL, id, bob.publicId, "0.25", undefined, DAY), /different request/);
  const carol = await publicProfile("Carol");
  await assert.rejects(() => sendTip(ALICE, id, carol.publicId, "0.25", undefined, DAY), /different request/);
  await assert.rejects(() => sendTip(BOB, crypto.randomUUID(), bob.publicId, "0.01"), /yourself/);
  await assert.rejects(() => sendTip("no-profile", crypto.randomUUID(), bob.publicId, "0.01"), /profile first/);
  await assert.rejects(() => sendTip(ALICE, crypto.randomUUID(), "a".repeat(32), "0.01"), /no longer available/);
  for (const amount of ["0", "-1", "1e3", "0.0000000001", "100001", 1]) {
    await assert.rejects(() => sendTip(ALICE, crypto.randomUUID(), bob.publicId, amount));
  }
  await assert.rejects(() => sendTip(ALICE, "bad-id", bob.publicId, "0.1"), /operation ID/i);
  const insufficientId = crypto.randomUUID();
  await assert.rejects(() => sendTip(CAROL, insufficientId, bob.publicId, "0.1"), /Not enough/);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM cash_ledger WHERE reference = ?").get(insufficientId).n, 0);

  // A tip at the free allowance needs no code, so identical submissions stay idempotent.
  const concurrentId = crypto.randomUUID();
  const repeated = await Promise.all(Array.from({ length: 5 }, () => sendTip(ALICE, concurrentId, bob.publicId, "0.1", undefined, 2 * DAY)));
  assert.ok(repeated.every((tip) => tip.id === concurrentId));
  assert.equal(balance(BOB), 350_000_000, "Concurrent identical submissions transfer once");
  // Two large tips at once, each with its own recovery code: only one is affordable.
  const spending = await Promise.allSettled(Array.from({ length: 2 }, () => sendTip(ALICE, crypto.randomUUID(), bob.publicId, "1", code(), 3 * DAY)));
  assert.equal(spending.filter((result) => result.status === "fulfilled").length, 1, "Concurrent tips cannot overdraw");
  assert.equal(balance(ALICE), 650_000_000);
  assert.equal(total(), liabilities);

  // The recipient identity survives a rename and someone else taking the old name.
  await renamePlayer(BOB, "Bobby");
  await createPlayer("new-bob-private", "Bob");
  await sendTip(ALICE, crypto.randomUUID(), bob.publicId, "0.000000001", undefined, 4 * DAY);
  assert.equal(balance(BOB), 1_350_000_001);
  assert.equal((await publicProfile("Bobby")).publicId, bob.publicId);
  assert.notEqual((await publicProfile("Bob")).publicId, bob.publicId);
  const { walletSnapshot } = await import("../lib/payments/service.ts");
  const senderWallet = await walletSnapshot(ALICE);
  const recipientWallet = await walletSnapshot(BOB);
  assert.ok(senderWallet.tips.every((tip) => tip.name === "Bobby" && tip.amount < 0), "Sender sees sent tips and current recipient names");
  assert.ok(recipientWallet.tips.every((tip) => tip.name === "Alice" && tip.amount > 0), "Recipient sees received tips");
  assert.equal(recipientWallet.tips.length, 4);
  sqlite.prepare("INSERT INTO matches(id, seed, stake, asset, p1, p2, settled, winner, fee, created) VALUES('cash-match', 1, 100000000, 'devnet', ?, ?, 1, ?, 24000000, 0)").run(BOB, ALICE, BOB);
  sqlite.prepare("INSERT INTO cash_ledger VALUES('cash-entry', ?, 'match_entry', -100000000, 'cash-match', 0)").run(cashAccountId(BOB));
  sqlite.prepare("INSERT INTO cash_ledger VALUES('cash-payout', ?, 'match_payout', 176000000, 'cash-match', 0)").run(cashAccountId(BOB));
  const cashStats = { pnl: 76_000_000, games: 1, wins: 1 };
  assert.deepEqual((await publicProfile("Bobby")).stats.devnet, cashStats);
  await sendTip(ALICE, crypto.randomUUID(), bob.publicId, "0.001", undefined, 5 * DAY);
  assert.deepEqual((await publicProfile("Bobby")).stats.devnet, cashStats, "Cash match PNL excludes incoming tips");

  // The daily allowance: small tips stay one tap, bigger ones need the code, and
  // the day's ceiling holds even with a code in hand.
  const { TIP_LIMITS } = await import("../lib/payments/tips.ts");
  const LIMIT_DAY = 8 * DAY;
  fund(ALICE, 20_000_000_000);
  const allowance = balance(ALICE);
  await sendTip(ALICE, crypto.randomUUID(), bob.publicId, "0.1", undefined, LIMIT_DAY);
  assert.equal(balance(ALICE), allowance - TIP_LIMITS.free, "A tip at the allowance needs nothing but the session");
  await assert.rejects(
    () => sendTip(ALICE, crypto.randomUUID(), bob.publicId, "0.05", undefined, LIMIT_DAY),
    (e) => e.enrolled === true && /authentication code/.test(e.message),
    "The next tip that day crosses the allowance and asks for the code",
  );
  const refusedId = crypto.randomUUID();
  await assert.rejects(() => sendTip(ALICE, refusedId, bob.publicId, "0.05", "000 000", LIMIT_DAY), (e) => e.code === "TWO_FACTOR_INVALID");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM cash_ledger WHERE reference = ?").get(refusedId).n, 0, "A refused code moves nothing");
  assert.equal(balance(ALICE), allowance - TIP_LIMITS.free);
  await sendTip(ALICE, crypto.randomUUID(), bob.publicId, "0.05", code(), LIMIT_DAY);
  assert.equal(balance(ALICE), allowance - TIP_LIMITS.free - 50_000_000, "A valid code sends it");
  const cappedId = crypto.randomUUID();
  await assert.rejects(
    () => sendTip(ALICE, cappedId, bob.publicId, String(TIP_LIMITS.daily / 1e9), code(), LIMIT_DAY),
    /limited to 10 devnet SOL a day/,
    "The day's ceiling holds whatever is presented",
  );
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM cash_ledger WHERE reference = ?").get(cappedId).n, 0);
  // Without an authenticator there is no way to send more than the allowance.
  await assert.rejects(
    () => sendTip(BOB, crypto.randomUUID(), carol.publicId, "0.2", undefined, LIMIT_DAY),
    (e) => e.enrolled === false && /two-factor/.test(e.message),
  );
  assert.equal(balance(CAROL), 0);
  const senderInbox = await listNotifications(ALICE);
  const alerts = senderInbox.items.filter((n) => n.kind === "security_alert");
  assert.ok(alerts.every((n) => n.data.event === "tip_sent"), "The sender is told their own money left");
  assert.ok(alerts.some((n) => n.data.amount === 50_000_000 && n.data.to === "Bobby"), "The notice carries the amount and the recipient");
  assert.ok(alerts.length >= 2, "Every sent tip leaves a notice for its sender");

  // A credit failure must roll back the debit too.
  sqlite.exec("CREATE TRIGGER reject_tip_credit BEFORE INSERT ON cash_ledger WHEN NEW.kind = 'tip_received' BEGIN SELECT RAISE(ABORT, 'test credit failure'); END;");
  const previous = balance(ALICE);
  await assert.rejects(() => sendTip(ALICE, crypto.randomUUID(), carol.publicId, "0.1", undefined, 6 * DAY), /test credit failure/);
  assert.equal(balance(ALICE), previous);
  assert.equal(balance(CAROL), 0);
  process.env.SOLANA_NETWORK = "mainnet-beta";
  await assert.rejects(() => sendTip(ALICE, crypto.randomUUID(), carol.publicId, "0.1", undefined, 7 * DAY), /devnet only/);
  const serialized = JSON.stringify(await publicProfile("Bobby"));
  for (const secret of [ALICE, BOB, CAROL, "balance", "encrypted_key", "account_id"]) assert.ok(!serialized.includes(secret));
  console.log("PASS: public profile privacy, all-time and historical PNL, dashboard PNL series and match history, zero stats, stable recipient IDs, tip conservation, tip notifications, idempotency, concurrent spending, rollback, validation, devnet-only tips, the daily free allowance and ceiling, the second factor above it, and the sender's own notice.");
} finally { close(); }
