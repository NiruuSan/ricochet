"use server";
import { signIn, signOut } from "@/auth";

const PROVIDERS = ["github", "google", "discord"] as const;
export type SignInProvider = (typeof PROVIDERS)[number];

/** Only same-site paths may be used as a post-login destination. */
function safeReturnPath(value: string) {
  return value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export async function signInWith(provider: SignInProvider, returnTo: string) {
  if (!PROVIDERS.includes(provider)) throw new Error("Unknown sign-in provider.");
  await signIn(provider, { redirectTo: safeReturnPath(returnTo) });
}

export async function signOutToLogin() {
  await signOut({ redirectTo: "/login" });
}
