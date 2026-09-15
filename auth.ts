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

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers,
  session: { strategy: "jwt" },
  callbacks: {
    jwt({ token, account }) {
      // The provider-qualified account ID is the player's permanent identity
      // (`github:123`, `google:456`, `discord:789`). It is stable even if the
      // username or email changes. Each provider is a separate player account:
      // accounts are never merged by email.
      if (account) token.uid = `${account.provider}:${account.providerAccountId}`;
      return token;
    },
    session({ session, token }) {
      if (typeof token.uid === "string") session.user.id = token.uid;
      return session;
    },
  },
});
