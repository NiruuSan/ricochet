import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Node-only packages that should be required at runtime rather than bundled.
  serverExternalPackages: ["@libsql/client", "@solana/web3.js"],
};

export default nextConfig;
