import type { NextConfig } from "next";

const production = process.env.NODE_ENV === "production";

// OAuth sign-in may leave through a form submission that redirects to the provider.
const SIGN_IN_ORIGINS = "https://github.com https://accounts.google.com https://discord.com";

/**
 * Content Security Policy. Scripts, styles, images and requests are limited to
 * this site; the page cannot be framed (clickjacking) and plugins are off.
 * Next.js injects small inline scripts to boot the app, so inline scripts stay
 * allowed; no external script can run. Development needs eval for hot reload.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${production ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${production ? "" : " ws: wss:"}`,
  "object-src 'none'",
  "base-uri 'self'",
  `form-action 'self' ${SIGN_IN_ORIGINS}`,
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  ...(production ? ["upgrade-insecure-requests"] : []),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  // Browsers only ever reach the site over HTTPS, for two years, subdomains included.
  ...(production ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }] : []),
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), interest-cohort=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
];

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
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
