import { PaymentError } from "./errors";
import { Keypair } from "@solana/web3.js";

function bytes(value: string) {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

function base64(value: Uint8Array) {
  return btoa(String.fromCharCode(...value));
}

async function key(secret: string) {
  const raw = bytes(secret);
  if (raw.byteLength !== 32) throw new PaymentError("The wallet vault key must contain 32 random bytes.");
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

// The wallet identity is bound as additional authenticated data, so a
// ciphertext cannot be moved to another owner or network.
export async function encryptWallet(wallet: Keypair, secret: string, identity: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = Uint8Array.from(wallet.secretKey);
  try {
    const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(identity) }, await key(secret), plain);
    return JSON.stringify({ v: 1, iv: base64(iv), data: base64(new Uint8Array(encrypted)) });
  } finally {
    plain.fill(0);
  }
}

export async function decryptWallet(ciphertext: string, secret: string, identity: string) {
  const c = JSON.parse(ciphertext);
  if (c.v !== 1) throw new PaymentError("Unsupported wallet encryption version.");
  // Keypair keeps a reference to this buffer, so it must not be zeroed here.
  const raw = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes(c.iv), additionalData: new TextEncoder().encode(identity) }, await key(secret), bytes(c.data));
  return Keypair.fromSecretKey(new Uint8Array(raw));
}
