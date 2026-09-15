"use server";
import { signIn, signOut } from "@/auth";

/** Only same-site paths may be used as a post-login destination. */
function safeReturnPath(value: string) {
  return value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export async function signInWithGitHub(returnTo: string) {
  await signIn("github", { redirectTo: safeReturnPath(returnTo) });
}

export async function signOutToLogin() {
  await signOut({ redirectTo: "/login" });
}
