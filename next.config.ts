import type { NextConfig } from "next";
import { API_CSP, securityHeaders } from "./lib/security-headers";

const production = process.env.NODE_ENV === "production";

// Production builds use webpack (`next build --webpack`). Turbopack rewrites
// server-external packages such as @libsql/client to hashed aliases backed by
// symlinks in .next/node_modules, which do not survive a pnpm deploy to Vercel
// and made every route using the database fail at module load.
const nextConfig: NextConfig = {
  // Node-only packages that should be required at runtime rather than bundled.
  serverExternalPackages: ["@libsql/client", "@solana/web3.js"],
  // Do not advertise the framework in every response.
  poweredByHeader: false,
  // Identifies the deployed client in shot reports (lib/anti-cheat-rules.ts): a tab from an older deployment is asked to reload.
  env: { BOUNCE_BUILD: (process.env.VERCEL_GIT_COMMIT_SHA ?? "dev").slice(0, 12) },
  async headers() {
    // The Content-Security-Policy is set per request in proxy.ts, where the
    // script nonce is generated; these are the headers that never change.
    return [
      { source: "/:path*", headers: securityHeaders(production) },
      { source: "/api/:path*", headers: [{ key: "Content-Security-Policy", value: API_CSP }] },
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }] },
    ];
  },
};

export default nextConfig;
