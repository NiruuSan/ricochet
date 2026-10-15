import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import bs58 from "bs58";
import { createDatabase } from "./helpers/test-env.mjs";

// The way in for new players and the way out for results: signing in with a
// Solana wallet, depositing from it, a challenge link a visitor can read
// before signing up, the in-app browsers that need a way out, and a settled
// match that shares with both scores on its card.
Object.assign(process.env, {
  SOLANA_VAULT_KEY: Buffer.alloc(32, 7).toString("base64"),
  SOLANA_NETWORK: "devnet",
  SOLANA_RPC_URL: "https://rpc.invalid",
});
const { sqlite, close } = await createDatabase();
globalThis.fetch = async () => {
  throw new Error("These checks must not touch the network");
};
const walletSignIn = await import("../lib/wallet-sign-in.ts");
const { signInText } = await import("../lib/wallet-message.ts");
const matches = await import("../lib/matches.ts");
const spectate = await import("../lib/spectate.ts");
const service = await import("../lib/payments/service.ts");
const { stepUpRequired } = await import("../lib/step-up.ts");
const { inAppBrowser, openInBrowserLink } = await import("../app/arena/in-app.ts");
const { safeNext } = await import("../app/arena/referral-link.ts");
const { Keypair, SystemProgram, Transaction } = await import("@solana/web3.js");

const wallet = () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return { privateKey, address: bs58.encode(Buffer.from(publicKey.export({ format: "jwk" }).x, "base64url")) };
};
const signed = (text, key) => ({ message: Buffer.from(text).toString("base64"), signature: sign(null, Buffer.from(text), key).toString("base64") });
const count = (sql, ...args) => sqlite.prepare(sql).get(...args).n;

try {
  // ------------------------------------------------------- wallet sign-in
  const now = Date.UTC(2026, 9, 13, 12, 0, 0);
  const ann = wallet();
  const challenge = await walletSignIn.createChallenge("https://bounce.test", now);
  assert.equal(challenge.domain, "bounce.test");
  assert.match(challenge.nonce, /^[0-9a-f]{32}$/);
  assert.equal(Date.parse(challenge.expirationTime) - now, walletSignIn.CHALLENGE_MS);

  // A signature by someone else, or of a message changed after signing, opens nothing — and spends nothing.
  const text = signInText(challenge, ann.address);
  const ben = wallet();
  const forged = { message: Buffer.from(text).toString("base64"), signature: signed(text, ben.privateKey).signature };
  assert.equal(await walletSignIn.verifyWalletSignIn(forged.message, forged.signature, now + 1000), null, "Signed by another key");
  const good = signed(text, ann.privateKey);
  const edited = Buffer.from(text.replace("bounce.test", "b0unce.test")).toString("base64");
  assert.equal(await walletSignIn.verifyWalletSignIn(edited, good.signature, now + 1000), null, "Message changed after signing");
  assert.equal(count("SELECT COUNT(*) AS n FROM wallet_challenges WHERE nonce = ?", challenge.nonce), 1, "A bad signature cannot burn the challenge");

  // The real one signs in once, as the wallet's own address.
  assert.equal(await walletSignIn.verifyWalletSignIn(good.message, good.signature, now + 1000), ann.address);
  assert.equal(await walletSignIn.verifyWalletSignIn(good.message, good.signature, now + 2000), null, "A signature is good once");

  // Too late, too early, another site, or never issued.
  const late = await walletSignIn.createChallenge("https://bounce.test", now);
  const lateSigned = signed(signInText(late, ann.address), ann.privateKey);
  assert.equal(await walletSignIn.verifyWalletSignIn(lateSigned.message, lateSigned.signature, now + walletSignIn.CHALLENGE_MS + 1), null, "Expired");
  const elsewhere = await walletSignIn.createChallenge("https://bounce.test", now);
  const moved = signed(signInText({ ...elsewhere, domain: "evil.test" }, ann.address), ann.privateKey);
  assert.equal(await walletSignIn.verifyWalletSignIn(moved.message, moved.signature, now + 1000), null, "A challenge from this site signed for another one");
  const invented = signed(signInText({ ...challenge, nonce: "a".repeat(32) }, ann.address), ann.privateKey);
  assert.equal(await walletSignIn.verifyWalletSignIn(invented.message, invented.signature, now + 1000), null, "A nonce the site never issued");

  // A wallet with Sign In With Solana writes the message itself, possibly with fields of its own: still read.
  const issued = await walletSignIn.createChallenge("https://bounce.test", now);
  const walletWritten = `bounce.test wants you to sign in with your Solana account:\n${ann.address}\n\n${issued.statement}\n\nURI: https://bounce.test\nVersion: 1\nChain ID: devnet\nNonce: ${issued.nonce}\nIssued At: ${issued.issuedAt}\nExpiration Time: ${issued.expirationTime}`;
  const fromWallet = signed(walletWritten, ann.privateKey);
  assert.equal(await walletSignIn.verifyWalletSignIn(fromWallet.message, fromWallet.signature, now + 1000), ann.address);

  // Nonsense of every shape is refused without an exception.
  for (const [m, s] of [[undefined, undefined], [42, "x"], ["", ""], ["a".repeat(5000), "x"], [good.message, "x".repeat(300)], [Buffer.from([0xff, 0xfe]).toString("base64"), good.signature]]) {
    assert.equal(await walletSignIn.verifyWalletSignIn(m, s, now), null);
  }
  // Expired challenges are swept as new ones are made.
  await walletSignIn.createChallenge("https://bounce.test", now + walletSignIn.CHALLENGE_MS * 3);
  assert.equal(count("SELECT COUNT(*) AS n FROM wallet_challenges WHERE expires <= ?", now + walletSignIn.CHALLENGE_MS * 3), 0);

  // Confirming it is you again, for a wallet account, says which wallet.
  assert.deepEqual(
    [stepUpRequired({ userId: `solana:${ann.address}`, authTime: null }).provider, stepUpRequired({ userId: `solana:${ann.address}`, authTime: null }).account],
    ["solana", ann.address],
  );
  assert.equal(stepUpRequired({ userId: "github:7", authTime: null }).account, undefined, "Other providers' IDs stay out of it");

  // ------------------------------------------------- depositing from a wallet
  const UID = `solana:${ann.address}`;
  sqlite.prepare("INSERT INTO players(id, name, created) VALUES(?, 'walletann', 0)").run(UID);
  const custody = await service.ensureWallet(UID);
  const payer = Keypair.generate();
  await assert.rejects(() => service.fundingTransaction(UID, payer.publicKey.toBase58(), "0.0001"), /at least 0.001/);
  await assert.rejects(() => service.fundingTransaction(UID, custody.address, "1"), /your Bounce deposit address/);
  await assert.rejects(() => service.fundingTransaction(UID, "not-an-address", "1"), /Invalid Solana address/);
  const blockhash = Keypair.generate().publicKey.toBase58();
  const transfer = (to, lamports) =>
    new Transaction({ feePayer: payer.publicKey, recentBlockhash: blockhash }).add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: to, lamports }));
  const elsewhereTx = transfer(Keypair.generate().publicKey, 1e8);
  elsewhereTx.sign(payer);
  await assert.rejects(() => service.sendFunding(UID, elsewhereTx.serialize().toString("base64")), /does not pay your deposit address/, "Not a general-purpose relay");
  const unsigned = transfer(new (await import("@solana/web3.js")).PublicKey(custody.address), 1e8);
  await assert.rejects(
    () => service.sendFunding(UID, unsigned.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64")),
    /did not sign/,
  );
  await assert.rejects(() => service.sendFunding(UID, "%%%"), /could not be read|missing/);
  await assert.rejects(() => service.sendFunding(UID, "a".repeat(2001)), /missing/);

  // ---------------------------------------------- a challenge link, read first
  const HOST = "share-host";
  const GUEST = "share-guest";
  sqlite.prepare("INSERT INTO players(id, name, created) VALUES(?, 'hostess', 0)").run(HOST);
  sqlite.prepare("INSERT INTO players(id, name, created) VALUES(?, 'guesto', 0)").run(GUEST);
  const opened = await matches.createChallenge(HOST, 100, "gems");
  const preview = await matches.challengePreview(opened.invite.toUpperCase());
  assert.deepEqual(
    { from: preview.from, asset: preview.asset, stake: preview.stake, open: preview.open, direct: preview.direct },
    { from: "hostess", asset: "gems", stake: 100, open: true, direct: false },
  );
  assert.ok(preview.ranked.tier, "The sender's rank comes with it");
  assert.ok(!JSON.stringify(preview).includes(HOST), "No player ID");
  assert.ok(!("seed" in preview) && !("state" in preview), "Nothing of the board");
  assert.equal(await matches.challengePreview("nope"), null);
  assert.equal(await matches.challengePreview("x"), null);
  assert.equal(await matches.challengePreview("'; DROP TABLE matches; --"), null);

  // --------------------------------------------- a settled match, shared
  sqlite.prepare("UPDATE runs SET done = 1, score = 1840 WHERE match_id = ?").run(opened.match_id);
  const joined = await matches.joinChallenge(GUEST, opened.invite);
  assert.equal((await matches.challengePreview(opened.invite)).open, false, "A taken seat says so");
  const before = await spectate.runCard(`m-${opened.id}`);
  assert.equal(before.versus, null, "No opponent score before the match is over");
  sqlite.prepare("UPDATE runs SET done = 1, score = 1320 WHERE id = ?").run(joined.id);
  const recap = await matches.matchRecap(HOST, opened.match_id);
  assert.equal(recap.status, "settled");
  assert.equal(recap.watchId, `m-${opened.id}`, "The recap links the player's own replay");
  assert.equal(await matches.challengePreview(opened.invite), null, "A played challenge is closed");
  const hostCard = await spectate.runCard(recap.watchId);
  assert.deepEqual(hostCard.versus, { opponent: "guesto", score: 1320, result: "win", stake: 100 });
  const guestCard = await spectate.runCard(`m-${joined.id}`);
  assert.deepEqual(guestCard.versus, { opponent: "hostess", score: 1840, result: "loss", stake: 100 });

  // --------------------------------------------------------- in-app browsers
  const UA = {
    instagram: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0.0.40.92",
    tiktok: "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0 Mobile Safari/537.36 musical_ly_2023405030 BytedanceWebview/d8a21c6",
    facebook: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0]",
    webview: "Mozilla/5.0 (Linux; Android 13; SM-S911B; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0 Mobile Safari/537.36",
    safari: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    chromeIos: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0 Mobile/15E148 Safari/604.1",
    chrome: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36",
    desktop: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  };
  assert.deepEqual(inAppBrowser(UA.instagram), { app: "Instagram", ios: true, android: false });
  assert.equal(inAppBrowser(UA.tiktok).app, "TikTok");
  assert.equal(inAppBrowser(UA.facebook).app, "Facebook");
  assert.equal(inAppBrowser(UA.webview).app, "this app");
  for (const real of ["safari", "chromeIos", "chrome", "desktop"]) assert.equal(inAppBrowser(UA[real]), null, `${real} is a real browser`);
  const page = "https://bounce.test/?join=abc123";
  assert.equal(openInBrowserLink(inAppBrowser(UA.instagram), page), "x-safari-https://bounce.test/?join=abc123", "iOS hands over to Safari");
  assert.match(openInBrowserLink(inAppBrowser(UA.tiktok), page), /^intent:\/\/bounce\.test\/\?join=abc123#Intent;scheme=https;package=com\.android\.chrome;S\.browser_fallback_url=https%3A%2F%2Fbounce\.test%2F%3Fjoin%3Dabc123;end$/);

  // Where a sign-in may send someone afterwards: this site only.
  for (const ok of ["/", "/?join=abc", "/watch/m-1?ref=ann"]) assert.equal(safeNext(ok), ok);
  for (const bad of ["//evil.test", "/\\evil.test", "https://evil.test", "javascript:alert(1)", "", null, undefined]) assert.equal(safeNext(bad), null, String(bad));

  console.log(
    "PASS: wallet sign-in (one-time challenges bound to the site, good once, expiring, forged or edited signatures refused without spending the challenge, wallet-written messages read, nonsense refused, wallet accounts confirming with the same wallet), deposits from a wallet (minimum, own address, only transfers to the player's deposit address and only signed ones relayed), challenge links readable before signing up (sender, rank, entry, open or taken, no IDs, no board), settled matches sharing both scores from either side and linking the player's own replay, in-app browsers told apart from real ones with a way out, and post-sign-in destinations kept on this site.",
  );
} finally {
  close();
}
