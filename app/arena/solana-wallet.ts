"use client";
import { useEffect, useState } from "react";
import { signInWithSolana } from "../auth-actions";
import { signInText, type WalletChallenge } from "@/lib/wallet-message";
import { request } from "./api";

// The Solana wallets in this browser, found through the Wallet Standard: every
// current wallet (Phantom, Solflare, Backpack…) announces itself with the same
// two events, so there is no wallet library to ship, and no wallet is favoured.

type Account = { address: string; publicKey: Uint8Array; chains: readonly string[]; features: readonly string[] };
type Features = {
  "standard:connect"?: { connect(input?: { silent?: boolean }): Promise<{ accounts: readonly Account[] }> };
  "solana:signIn"?: {
    signIn(...inputs: Record<string, string>[]): Promise<{ account: Account; signedMessage: Uint8Array; signature: Uint8Array }[]>;
  };
  "solana:signMessage"?: { signMessage(...inputs: { account: Account; message: Uint8Array }[]): Promise<{ signedMessage: Uint8Array; signature: Uint8Array }[]> };
  "solana:signTransaction"?: {
    signTransaction(...inputs: { account: Account; transaction: Uint8Array; chain?: string }[]): Promise<{ signedTransaction: Uint8Array }[]>;
  };
  "solana:signAndSendTransaction"?: {
    signAndSendTransaction(...inputs: { account: Account; transaction: Uint8Array; chain: string }[]): Promise<{ signature: Uint8Array }[]>;
  };
};
export type SolanaWallet = { name: string; icon: string; chains: readonly string[]; accounts: readonly Account[]; features: Features & Record<string, unknown> };

const found = new Set<SolanaWallet>();
const listeners = new Set<() => void>();
let listening = false;
let snapshot: SolanaWallet[] = [];

const usable = (wallet: SolanaWallet) =>
  wallet.chains.some((chain) => chain.startsWith("solana:")) &&
  !!wallet.features["standard:connect"] &&
  !!(wallet.features["solana:signIn"] || wallet.features["solana:signMessage"]);

function register(...wallets: SolanaWallet[]) {
  for (const wallet of wallets) if (usable(wallet)) found.add(wallet);
  snapshot = [...found];
  listeners.forEach((l) => l());
  return () => {
    wallets.forEach((wallet) => found.delete(wallet));
    snapshot = [...found];
    listeners.forEach((l) => l());
  };
}

/** Starts listening once per page: wallets that loaded first answer the call, later ones announce themselves. */
function listen() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  const api = Object.freeze({ register });
  window.addEventListener("wallet-standard:register-wallet", ((event: CustomEvent<(api: { register: typeof register }) => void>) => {
    try {
      event.detail(api);
    } catch {
      // A wallet that fails to register is simply not offered.
    }
  }) as EventListener);
  window.dispatchEvent(new CustomEvent("wallet-standard:app-ready", { detail: api }));
}

/** The wallets found so far, for a click handler that cannot wait for a render. */
export function currentWallets() {
  listen();
  return snapshot;
}

/** The Solana wallets this browser has, as they appear. */
export function useSolanaWallets() {
  const [wallets, setWallets] = useState<SolanaWallet[]>([]);
  useEffect(() => {
    listen();
    const update = () => setWallets(snapshot);
    listeners.add(update);
    update();
    return () => void listeners.delete(update);
  }, []);
  return wallets;
}

/** Whether this page is already inside a wallet's own browser, where the wallet is built in. */
export function insideWalletBrowser() {
  if (typeof window === "undefined") return false;
  const w = window as unknown as Record<string, unknown>;
  return !!(w.phantom || w.solflare || w.backpack || w.solana) || found.size > 0;
}

/**
 * On a phone, wallets live in their own app: these open this very page in the
 * wallet's browser, where it is available. Desktop browsers use the extension.
 */
export function walletAppLinks(url: string) {
  const target = encodeURIComponent(url);
  const ref = encodeURIComponent(new URL(url).origin);
  return [
    { name: "Phantom", href: `https://phantom.app/ul/browse/${target}?ref=${ref}` },
    { name: "Solflare", href: `https://solflare.com/ul/v1/browse/${target}?ref=${ref}` },
  ];
}

const base64 = (bytes: Uint8Array) => btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""));
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

/** A wallet that turned the request down: not an error worth a red message. */
export const declined = (e: unknown) => /reject|declin|cancel|denied|closed/i.test(String((e as Error)?.message ?? e));

/**
 * Signs in with `wallet` and goes on to `returnTo`. Wallets that implement
 * Sign In With Solana write and check the message themselves; the others sign
 * the same text. Resolves only when something went wrong (a good sign-in
 * navigates away), with the reason.
 */
export async function signInWithWallet(wallet: SolanaWallet, returnTo: string, expected?: string): Promise<string | null> {
  const other = (address: string) =>
    expected && address !== expected ? `Switch your wallet to the account ${expected.slice(0, 4)}…${expected.slice(-4)}, the one this player signed in with.` : null;
  try {
    const challenge = await request<WalletChallenge>("/api/wallet-sign-in", {});
    let message: Uint8Array;
    let signature: Uint8Array;
    const signIn = wallet.features["solana:signIn"];
    if (signIn) {
      const [output] = await signIn.signIn({ ...challenge });
      const wrong = other(output.account.address);
      if (wrong) return wrong;
      message = output.signedMessage;
      signature = output.signature;
    } else {
      const { accounts } = await wallet.features["standard:connect"]!.connect();
      const account = accounts[0];
      if (!account) return "Your wallet did not share an account. Unlock it and try again.";
      const wrong = other(account.address);
      if (wrong) return wrong;
      message = new TextEncoder().encode(signInText(challenge, account.address));
      [{ signature }] = await wallet.features["solana:signMessage"]!.signMessage({ account, message });
    }
    const result = await signInWithSolana(base64(message), base64(signature), returnTo);
    return result?.error ?? null;
  } catch (e) {
    if (declined(e)) return "The request was cancelled in your wallet.";
    return (e as Error).message || "Your wallet could not sign in. Try again.";
  }
}

/** The account a wallet shares with this page, asking for it if needed. */
export async function walletAccount(wallet: SolanaWallet) {
  const known = wallet.accounts[0];
  if (known) return known;
  const { accounts } = await wallet.features["standard:connect"]!.connect();
  if (!accounts[0]) throw new Error("Your wallet did not share an account. Unlock it and try again.");
  return accounts[0];
}

/**
 * Has the wallet sign a transfer the server prepared. Where the wallet can sign
 * without sending, the server sends it, on the network it is configured for;
 * otherwise the wallet sends it itself. Returns the signed bytes for the server
 * to send, or null when the wallet already sent them.
 */
export async function signFunding(wallet: SolanaWallet, account: Account, transaction: string, chain: string) {
  const bytes = fromBase64(transaction);
  const sign = wallet.features["solana:signTransaction"];
  if (sign) {
    const [{ signedTransaction }] = await sign.signTransaction({ account, transaction: bytes, chain });
    return base64(signedTransaction);
  }
  const send = wallet.features["solana:signAndSendTransaction"];
  if (!send) throw new Error(`${wallet.name} cannot send a transfer from this page. Copy your deposit address instead.`);
  await send.signAndSendTransaction({ account, transaction: bytes, chain });
  return null;
}

export type { Account as WalletAccount };
