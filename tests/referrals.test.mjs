import assert from "node:assert/strict";
import { createDatabase } from "./helpers/test-env.mjs";

// Bringing players in: the code, the window it opens, and the money that moves
// because of it. The invariant under all of it is that a match settles exactly
// as it would without any referral — the discount is paid afterwards, by the
// house, out of the fee it just took.
const { sqlite, close } = await createDatabase();

const { applyReferral, chooseReferralCode, claimPartnerEarnings, referralCode, referralCodeHistory, referralCredits, referralSummary, referralRoster, setReferralLevel, REFERRAL } =
  await import("../lib/referrals.ts");
const { createPlayer } = await import("../lib/profile.ts");
const { settle } = await import("../lib/matches.ts");
const { cashAccountId, ensureCashAccount, HOUSE } = await import("../lib/payments/accounts.ts");
const { listNotifications } = await import("../lib/notifications.ts");

const PARTNER = "github:partner";
const FRIEND = "github:friend";
const ALPHA = "github:alpha";
const BETA = "github:beta";
const GAMMA = "github:gamma";
const DELTA = "github:delta";
const SOL = 1_000_000_000;
// The moment the players below sign up. Settlement reads the real clock, and a
// signup opens a fee window measured from the moment it happened, so this has
// to track the clock: pinned to a date, the windows close as the calendar moves
// past it and the suite quietly starts testing the wrong path.
const NOW = Date.now() - 3 * 60 * 60_000;
const DAY = 86_400_000;

const balance = (uid) => Number(sqlite.prepare("SELECT balance FROM cash_accounts WHERE id = ?").get(cashAccountId(uid))?.balance ?? 0);
const credit = (uid, amount, id = crypto.randomUUID()) => sqlite.prepare("INSERT INTO cash_ledger VALUES(?, ?, 'deposit', ?, 'test', 0)").run(id, cashAccountId(uid), amount);
const liabilities = () => Number(sqlite.prepare("SELECT COALESCE(SUM(balance), 0) AS n FROM cash_accounts").get().n);
/** What a partner has earned and not yet taken. */
const pending = (uid) => balance("earnings:" + uid);

/** A finished devnet match, staked and escrowed, ready for the real settlement. */
async function played(id, winner, loser, stake = SOL) {
  await ensureCashAccount("escrow:" + id);
  sqlite.prepare("INSERT INTO matches(id, seed, stake, asset, p1, p2, created, ruleset) VALUES(?, 1, ?, 'devnet', ?, ?, 0, 6)").run(id, stake, winner, loser);
  for (const [uid, score] of [[winner, 900], [loser, 400]]) {
    sqlite.prepare("INSERT INTO runs(id, match_id, user_id, state, score, done, created) VALUES(?, ?, ?, '{}', ?, 1, 0)").run(id + uid, id, uid, score);
    sqlite.prepare("INSERT INTO cash_ledger VALUES(?, ?, 'match_entry', ?, ?, 0)").run(id + uid + "entry", cashAccountId(uid), -stake, id);
  }
  credit("escrow:" + id, stake * 2, id + "escrow");
}

try {
  for (const [uid, name] of [[PARTNER, "Partner"], [FRIEND, "Friend"], [ALPHA, "Alpha"], [BETA, "Beta"], [GAMMA, "Gamma"], [DELTA, "Delta"]]) await createPlayer(uid, name);
  for (const uid of [PARTNER, FRIEND, ALPHA, BETA, GAMMA]) {
    await ensureCashAccount(uid);
    credit(uid, 10 * SOL);
  }
  await ensureCashAccount(HOUSE);

  // 1. Codes: one per player, stable, and never anyone else's.
  const partnerCode = await referralCode(PARTNER);
  const friendCode = await referralCode(FRIEND);
  assert.match(partnerCode, /^[a-z0-9]{8}$/);
  assert.equal(await referralCode(PARTNER), partnerCode, "A code is made once and kept");
  assert.notEqual(partnerCode, friendCode);

  // 1b. A code you choose, and the one it replaces, which stays yours for good.
  for (const bad of ["abc", "a".repeat(21), "with space", "hey!", "", null, "ADMIN", "deletedme", "bounce"]) {
    await assert.rejects(() => chooseReferralCode(FRIEND, bad), /4 to 20 letters|reserved/);
  }
  assert.equal((await chooseReferralCode(FRIEND, "  BigFriend  ")).code, "bigfriend", "A chosen code is trimmed and lowercased");
  assert.equal(sqlite.prepare("SELECT referral_code FROM players WHERE id = ?").get(FRIEND).referral_code, "bigfriend");
  await assert.rejects(() => chooseReferralCode(PARTNER, "bigfriend"), (e) => e.status === 409, "Nobody takes a code that is already owned");
  await assert.rejects(() => chooseReferralCode(PARTNER, friendCode), (e) => e.status === 409, "Not even one its owner has moved on from");
  assert.equal((await chooseReferralCode(FRIEND, friendCode)).code, friendCode, "Its owner can go back to it");
  assert.equal((await chooseReferralCode(FRIEND, "bigfriend")).code, "bigfriend");
  assert.deepEqual((await referralCodeHistory(FRIEND)).results.map((r) => r.code).sort(), [friendCode, "bigfriend"].sort(), "Every code they ever had is still theirs");

  // Two players reaching for the same free code: the table decides, once.
  const race = await Promise.allSettled([chooseReferralCode(PARTNER, "sameidea"), chooseReferralCode(GAMMA, "sameidea")]);
  assert.equal(race.filter((r) => r.status === "fulfilled").length, 1, "Only one of them gets it");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM referral_codes WHERE code = 'sameidea'").get().n, 1);
  await chooseReferralCode(PARTNER, partnerCode);

  // 2. A code only counts at signup, and never your own.
  assert.equal(await applyReferral(ALPHA, "nosuchcode", NOW), null, "An unknown code is ignored");
  assert.equal(await applyReferral(PARTNER, partnerCode, NOW), null, "Nobody refers themselves");
  await setReferralLevel("admin", "Partner", 2, "Signed partnership");
  assert.equal((await referralRoster())[0].siteEarned, 0, "A partner with no referred play has no site earnings");
  const joinedAlpha = await applyReferral(ALPHA, partnerCode.toUpperCase(), NOW);
  assert.deepEqual([joinedAlpha.referrer, joinedAlpha.level, joinedAlpha.discountUntil], ["Partner", 2, NOW + 7 * DAY], "A partner's code opens a week");
  const joinedBeta = await applyReferral(BETA, friendCode, NOW);
  assert.deepEqual([joinedBeta.referrer, joinedBeta.level, joinedBeta.discountUntil], ["Friend", 1, NOW + DAY], "A code they have moved on from still brings players to them");
  assert.equal((await applyReferral(DELTA, "bigfriend", NOW)).referrer, "Friend", "And so does the one they chose");
  await applyReferral(ALPHA, friendCode, NOW);
  assert.equal(sqlite.prepare("SELECT referrer_id FROM referrals WHERE user_id = ?").get(ALPHA).referrer_id, PARTNER, "A player has one referrer, for good");
  // Found by kind, not by position: the partnership notice beside it is written
  // against the real clock, so which of the two comes first depends on the hour.
  const inbox = await listNotifications(PARTNER);
  assert.equal(inbox.items.find((n) => n.kind === "referral_joined")?.data.name, "Alpha");

  // 3. A settled match pays exactly what it always did, whoever is at the table.
  const control = { house: balance(HOUSE) };
  await played("control", GAMMA, FRIEND);
  const gammaBefore = balance(GAMMA);
  await settle("control");
  assert.equal(balance(GAMMA) - gammaBefore, 1.76 * SOL, "The winner takes 176% of their stake");
  assert.equal(balance(HOUSE) - control.house, 0.24 * SOL, "The house takes 12% of the pot");

  // 4. The same match with a referred player: identical payout, plus a rebate.
  await played("discount", ALPHA, GAMMA);
  const before = { house: balance(HOUSE), alpha: balance(ALPHA), partner: balance(PARTNER), pot: pending(PARTNER), pool: liabilities() };
  await settle("discount");
  assert.equal(balance(ALPHA) - before.alpha, 1.76 * SOL + 0.04 * SOL, "The winner's payout is untouched; the rebate is its own line");
  assert.equal(balance(PARTNER) - before.partner, 0, "A partner's share is not dropped into their balance");
  assert.equal(pending(PARTNER) - before.pot, 0.008 * SOL, "It waits in their own pot: 10% of what the house kept from their player");
  assert.equal(balance(HOUSE) - before.house, 0.24 * SOL - 0.04 * SOL - 0.008 * SOL, "Both come out of the fee the house just took");
  assert.equal(liabilities(), before.pool, "Nothing was created: the pool still owes what it owed");

  // 5. A referred player who loses is refunded the same way.
  await played("lost", GAMMA, ALPHA);
  const losing = { alpha: balance(ALPHA), house: balance(HOUSE) };
  await settle("lost");
  assert.equal(balance(ALPHA) - losing.alpha, 0.04 * SOL, "The fee comes back win or lose");
  assert.equal(balance(HOUSE) - losing.house, 0.24 * SOL - 0.04 * SOL - 0.008 * SOL);

  // 6. Settling twice pays once.
  const twice = balance(ALPHA);
  await settle("lost");
  assert.equal(balance(ALPHA), twice);

  // 7. An ordinary referrer earns nothing from the matches they brought in.
  await played("ordinary", BETA, GAMMA);
  const friendBefore = balance(FRIEND);
  const betaBefore = balance(BETA);
  await settle("ordinary");
  assert.equal(balance(BETA) - betaBefore, 1.76 * SOL + 0.04 * SOL, "Beta plays at the reduced fee too");
  assert.equal(balance(FRIEND) - friendBefore, 0, "Only a partner earns a share");

  // 8. Once the window closes the rebate stops; a partnership does not.
  // Settlement reads the clock, so the window has to be closed against it.
  sqlite.prepare("UPDATE referrals SET discount_until = 1 WHERE user_id = ?").run(ALPHA);
  await played("later", ALPHA, GAMMA);
  const after = { alpha: balance(ALPHA), partner: pending(PARTNER), house: balance(HOUSE) };
  await settle("later");
  assert.equal(balance(ALPHA) - after.alpha, 1.76 * SOL, "No rebate once the window has closed");
  assert.equal(pending(PARTNER) - after.partner, 0.012 * SOL, "The partner still earns 10% of the full fee share");
  assert.equal(balance(HOUSE) - after.house, 0.24 * SOL - 0.012 * SOL);

  // 9. A draw takes no fee, so there is nothing to give back.
  sqlite.prepare("UPDATE referrals SET discount_until = ? WHERE user_id = ?").run(Date.now() + 7 * DAY, ALPHA);
  await ensureCashAccount("escrow:drawn");
  sqlite.prepare("INSERT INTO matches(id, seed, stake, asset, p1, p2, created, ruleset) VALUES('drawn', 1, ?, 'devnet', ?, ?, 0, 6)").run(SOL, ALPHA, GAMMA);
  for (const uid of [ALPHA, GAMMA]) {
    sqlite.prepare("INSERT INTO runs(id, match_id, user_id, state, score, done, created) VALUES(?, 'drawn', ?, '{}', 500, 1, 0)").run("drawn" + uid, uid);
    sqlite.prepare("INSERT INTO cash_ledger VALUES(?, ?, 'match_entry', ?, 'drawn', 0)").run("drawn" + uid + "entry", cashAccountId(uid), -SOL);
  }
  credit("escrow:drawn", 2 * SOL, "drawnescrow");
  const draw = { alpha: balance(ALPHA), partner: pending(PARTNER) };
  await settle("drawn");
  assert.equal(balance(ALPHA) - draw.alpha, SOL, "A draw returns both entries");
  assert.equal(pending(PARTNER) - draw.partner, 0, "And pays no commission");

  // 10. Gem matches are fee-free, so referrals never touch them.
  assert.deepEqual(await referralCredits({ prepare: () => { throw new Error("no query for gems"); } }, { id: "g", asset: "gems", fee: 0 }, [ALPHA]), { ops: [], rebates: {} });

  // 11. What each side sees of it.
  const mine = await referralSummary(ALPHA, NOW);
  assert.deepEqual([mine.level, mine.referredBy, mine.joined, mine.earned], [1, "Partner", 0, 0]);
  assert.ok(mine.discountUntil > Date.now(), "A window still open is reported with its end");
  const theirs = await referralSummary(PARTNER, NOW);
  assert.deepEqual([theirs.level, theirs.joined, theirs.earned, theirs.pending], [2, 1, 0.028 * SOL, 0.028 * SOL], "A partner sees what they brought in, and what is waiting");
  const roster = await referralRoster();
  assert.deepEqual(roster.map((r) => r.name), ["Partner", "Friend"], "The administrator sees partners first, then anyone who referred");
  assert.equal(roster.find((r) => r.name === "Partner").siteEarned, 0.252 * SOL,
    "Only the referred player's fee share counts, less actual rebates and commissions; draws and repeated settlement add nothing");
  assert.equal(roster.find((r) => r.name === "Friend").siteEarned, 0.08 * SOL,
    "Ordinary referrals also generate site revenue, without a commission deduction");

  // 12. A partnership is granted and withdrawn by an administrator, on the record.
  await assert.rejects(() => setReferralLevel("admin", "Nobody", 2, "who?"), /No player by that name/);
  await assert.rejects(() => setReferralLevel("admin", "Friend", 3, "too high"), /level is 1 or 2/);
  await assert.rejects(() => setReferralLevel("admin", "Friend", 2, ""), /note explaining/);
  await setReferralLevel("admin", "Partner", 1, "Partnership ended");
  await played("expartner", ALPHA, GAMMA);
  const ended = { partner: pending(PARTNER) };
  await settle("expartner");
  assert.equal(pending(PARTNER) - ended.partner, 0, "A withdrawn partnership stops earning");
  assert.equal((await referralRoster()).find((r) => r.name === "Partner").siteEarned, 0.332 * SOL,
    "Ending a partnership keeps historical deductions and adds new fees without a commission");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM admin_audit WHERE action LIKE 'referral_%'").get().n, 2, "Both decisions are on the record");
  assert.equal(REFERRAL.standardFee - REFERRAL.discountedFee, 4, "The discount is four points of the player's own stake");

  // 13. Claiming: the pot crosses into the balance in one move, and only once.
  await assert.rejects(() => claimPartnerEarnings(FRIEND), /nothing to claim yet/);
  const owed = pending(PARTNER);
  assert.ok(owed > 0);
  const claim = { balance: balance(PARTNER), pool: liabilities() };
  assert.deepEqual(await claimPartnerEarnings(PARTNER), { claimed: owed });
  assert.equal(balance(PARTNER) - claim.balance, owed, "All of it, in one line");
  assert.equal(pending(PARTNER), 0, "And the pot is empty");
  assert.equal(liabilities(), claim.pool, "It was already owed: the pool's total does not move");
  assert.equal((await referralSummary(PARTNER, NOW)).earned, owed, "What was earned is still counted once it is taken");
  assert.equal((await referralRoster()).find((r) => r.name === "Partner").siteEarned, 0.332 * SOL,
    "Claiming a commission does not deduct it from site earnings a second time");
  await assert.rejects(() => claimPartnerEarnings(PARTNER), /nothing to claim yet/, "There is nothing left to take");

  // Two claims at once cannot both pay: the pot cannot go below zero.
  await played("racing", ALPHA, GAMMA);
  await setReferralLevel("admin", "Partner", 2, "Back on");
  await settle("racing");
  const racing = pending(PARTNER);
  assert.ok(racing > 0);
  const both = await Promise.allSettled([claimPartnerEarnings(PARTNER), claimPartnerEarnings(PARTNER)]);
  assert.equal(both.filter((r) => r.status === "fulfilled").length, 1, "Only one of them pays");
  assert.equal(pending(PARTNER), 0);

  // Each side belongs to its own referrer, even when both players were referred.
  const revenue = async (name) => (await referralRoster()).find((r) => r.name === name).siteEarned;
  const separate = { partner: await revenue("Partner"), friend: await revenue("Friend"), house: balance(HOUSE) };
  await played("two-referrers", ALPHA, BETA);
  assert.equal(await revenue("Partner"), separate.partner, "Unsettled stakes are not site earnings");
  await settle("two-referrers");
  assert.equal(await revenue("Partner") - separate.partner, 0.072 * SOL);
  assert.equal(await revenue("Friend") - separate.friend, 0.08 * SOL);
  assert.equal((await revenue("Partner") - separate.partner) + (await revenue("Friend") - separate.friend),
    balance(HOUSE) - separate.house, "Attributed earnings sum to the actual net house fee");

  await ensureCashAccount(DELTA);
  credit(DELTA, SOL);
  const shared = { friend: await revenue("Friend"), house: balance(HOUSE) };
  await played("same-referrer", BETA, DELTA);
  await settle("same-referrer");
  assert.equal(await revenue("Friend") - shared.friend, 0.16 * SOL,
    "Two players from one referrer contribute both shares, without double counting the fee");
  assert.equal(await revenue("Friend") - shared.friend, balance(HOUSE) - shared.house);

  console.log(
    "PASS: referrals (codes made once or chosen, old codes kept and never reused, reserved names refused, races settled once, signup only, no self-referral, one referrer for good, a day or a week by level, payouts untouched, rebates win or lose, partner share of the net, idempotent settlement, no fee no rebate, gems untouched, summaries, admin grant and withdrawal, earnings that wait in their own pot until claimed, claimed once and never twice at a time).",
  );
} finally {
  close();
}
