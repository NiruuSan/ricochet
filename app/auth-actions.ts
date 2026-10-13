"use server";
import { AuthError } from "next-auth";
import { signIn, signOut } from "@/auth";

const PROVIDERS = ["github", "google", "discord"] as const;
export type SignInProvider = (typeof PROVIDERS)[number];

/** Only same-site paths may be used as a post-login destination. Browsers read "/\" like "//", another site. */
function safeReturnPath(value: string) {
  return typeof value === "string" && /^\/(?![/\\])/.test(value) ? value : "/";
}

export async function signInWith(provider: SignInProvider, returnTo: string) {
  if (!PROVIDERS.includes(provider)) throw new Error("Unknown sign-in provider.");
  await signIn(provider, { redirectTo: safeReturnPath(returnTo) });
}

/**
 * Signs in with a wallet's signature of a challenge from /api/wallet-sign-in.
 * Both arrive base64-encoded, as the wallet produced them. On success this
 * redirects; on a signature that does not check out it says so.
 */
export async function signInWithSolana(message: string, signature: string, returnTo: string) {
  try {
    await signIn("solana", { message, signature, redirectTo: safeReturnPath(returnTo) });
  } catch (e) {
    // The redirect that ends a good sign-in is thrown too, and must go through.
    if (e instanceof AuthError) return { error: "That signature could not be checked. Ask your wallet for a new one and try again." };
    throw e;
  }
  return { error: null };
}

export async function signOutToLogin() {
  await signOut({ redirectTo: "/login" });
}
