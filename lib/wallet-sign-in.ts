import { createPublicKey, randomBytes, verify } from "node:crypto";
import bs58 from "bs58";
import { database } from "@/db/raw";
import { readSignIn, type WalletChallenge } from "./wallet-message";

// Signing in with a Solana wallet.
//
// The player's account is their wallet's address (`solana:<address>`), proved
// by signing a one-time challenge. Nothing is ever sent on-chain and the wallet
// never hands over a key: the signature only shows the address is theirs.
//
// Each challenge is good once, for five minutes, on the site that issued it. A
// signature replayed later, or carried to another domain, opens nothing.

/** How long a challenge waits to be signed. */
export const CHALLENGE_MS = 5 * 60_000;

export const STATEMENT = "Sign in to Bounce. This proves the wallet is yours: it costs nothing and moves no funds.";

/** A fresh challenge for the site at `origin`. */
export async function createChallenge(origin: string, now = Date.now()): Promise<WalletChallenge> {
  const site = new URL(origin);
  const nonce = randomBytes(16).toString("hex");
  const db = database();
  await db.batch([
    db.prepare("DELETE FROM wallet_challenges WHERE expires <= ?").bind(now),
    db.prepare("INSERT INTO wallet_challenges(nonce, domain, expires) VALUES(?, ?, ?)").bind(nonce, site.host, now + CHALLENGE_MS),
  ]);
  return {
    domain: site.host,
    uri: site.origin,
    statement: STATEMENT,
    nonce,
    issuedAt: new Date(now).toISOString(),
    expirationTime: new Date(now + CHALLENGE_MS).toISOString(),
    version: "1",
  };
}

const decoder = new TextDecoder("utf-8", { fatal: true });

/** Whether `signature` is `address`'s ed25519 signature of `message`. */
function signedBy(address: string, message: Uint8Array, signature: Uint8Array) {
  let key: Uint8Array;
  try {
    key = bs58.decode(address);
  } catch {
    return false;
  }
  if (key.length !== 32 || signature.length !== 64) return false;
  try {
    const publicKey = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(key).toString("base64url") }, format: "jwk" });
    return verify(null, message, publicKey, signature);
  } catch {
    return false;
  }
}

/**
 * The address that signed this challenge, or null. Both arrive base64-encoded,
 * exactly as the wallet produced them. The signature is checked before the
 * challenge is spent, so nobody can burn another player's challenge; spending
 * it is a single delete, so two copies of one signature cannot both sign in.
 */
export async function verifyWalletSignIn(messageInput: unknown, signatureInput: unknown, now = Date.now()): Promise<string | null> {
  if (typeof messageInput !== "string" || typeof signatureInput !== "string") return null;
  if (messageInput.length > 4000 || signatureInput.length > 200) return null;
  const message = Buffer.from(messageInput, "base64");
  const signature = Buffer.from(signatureInput, "base64");
  let text: string;
  try {
    text = decoder.decode(message);
  } catch {
    return null;
  }
  const signed = readSignIn(text);
  if (!signed || !signedBy(signed.address, message, signature)) return null;
  if (signed.expirationTime !== null && !(Date.parse(signed.expirationTime) > now)) return null;
  if (signed.issuedAt !== null && !(Math.abs(now - Date.parse(signed.issuedAt)) <= CHALLENGE_MS + 60_000)) return null;
  const challenge = await database()
    .prepare("DELETE FROM wallet_challenges WHERE nonce = ? AND expires > ? RETURNING domain")
    .bind(signed.nonce, now)
    .first<{ domain: string }>();
  if (!challenge || challenge.domain !== signed.domain) return null;
  return signed.address;
}
