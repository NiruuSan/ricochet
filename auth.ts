import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";

// Sessions are stateless JWTs. Configure with AUTH_SECRET, AUTH_GITHUB_ID and
// AUTH_GITHUB_SECRET (Auth.js reads them automatically).
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [GitHub],
  session: { strategy: "jwt" },
  callbacks: {
    jwt({ token, account }) {
      // The provider-qualified account ID is the player's permanent identity.
      // It is stable even if the GitHub username or email changes.
      if (account) token.uid = `${account.provider}:${account.providerAccountId}`;
      return token;
    },
    session({ session, token }) {
      if (typeof token.uid === "string") session.user.id = token.uid;
      return session;
    },
  },
});
