import NextAuth from "next-auth";
import Discord from "next-auth/providers/discord";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";

// Sessions are stateless JWTs. Auth.js reads AUTH_SECRET and each provider's
// AUTH_<PROVIDER>_ID / AUTH_<PROVIDER>_SECRET automatically. GitHub is always on;
// Google and Discord appear only once their credentials are configured, so a
// half-configured provider never shows a sign-in button that cannot work.
const providers = [
  GitHub,
  ...(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET ? [Google] : []),
  ...(process.env.AUTH_DISCORD_ID && process.env.AUTH_DISCORD_SECRET ? [Discord] : []),
];

const DAY_SECONDS = 86_400;

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers,
  // A stolen session cookie stops working after a week without use; an active
  // session is renewed at most once a day. Cookies are HttpOnly, SameSite=Lax
  // and, over HTTPS, Secure with the __Secure- prefix (Auth.js defaults).
  session: { strategy: "jwt", maxAge: 7 * DAY_SECONDS, updateAge: DAY_SECONDS },
  callbacks: {
    jwt({ token, account }) {
      // The provider-qualified account ID is the player's permanent identity
      // (`github:123`, `google:456`, `discord:789`). It is stable even if the
      // username or email changes. Each provider is a separate player account:
      // accounts are never merged by email.
      if (account) {
        token.uid = `${account.provider}:${account.providerAccountId}`;
        // When the player last proved who they are with their provider. Money
        // leaving the site requires this to be recent (see lib/auth-user.ts).
        token.authTime = Date.now();
      }
      return token;
    },
    session({ session, token }) {
      if (typeof token.uid === "string") session.user.id = token.uid;
      (session as { authTime?: number }).authTime = typeof token.authTime === "number" ? token.authTime : undefined;
      return session;
    },
  },
});
