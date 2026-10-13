"use client";
import { signInWith, type SignInProvider } from "../auth-actions";
import type { RequestError } from "./api";
import { currentWallets, signInWithWallet } from "./solana-wallet";

/** Who has to prove it again before something irreversible: the provider, and for a wallet, which account. */
export type Reauth = { provider: string; account?: string };

export const reauthFrom = (e: RequestError): Reauth => ({
  provider: typeof e.details?.provider === "string" ? e.details.provider : "github",
  account: typeof e.details?.account === "string" ? e.details.account : undefined,
});

/**
 * Proves it is still the player: back through their sign-in provider, or a
 * fresh signature from the wallet they signed in with. Comes back to this page.
 * Resolves with a reason when that cannot happen here.
 */
export async function reauthenticate(reauth: Reauth, returnTo = window.location.pathname): Promise<string | null> {
  if (reauth.provider !== "solana") {
    await signInWith(reauth.provider as SignInProvider, returnTo);
    return null;
  }
  const wallets = currentWallets();
  const wallet = wallets.find((w) => w.accounts.some((a) => a.address === reauth.account)) ?? wallets[0];
  if (!wallet) return "Open Bounce in the browser where your wallet is installed, then confirm with it.";
  return signInWithWallet(wallet, returnTo, reauth.account);
}
