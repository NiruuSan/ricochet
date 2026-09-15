import type { NextConfig } from "next";

// Production builds use webpack (`next build --webpack`). Turbopack rewrites
// server-external packages such as @libsql/client to hashed aliases backed by
// symlinks in .next/node_modules, which do not survive a pnpm deploy to Vercel
// and made every route using the database fail at module load.
const nextConfig: NextConfig = {
  // Node-only packages that should be required at runtime rather than bundled.
  serverExternalPackages: ["@libsql/client", "@solana/web3.js"],
};

export default nextConfig;
