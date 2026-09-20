// The headers every response carries, in one place: next.config.ts sets the
// fixed ones, and proxy.ts sets the Content-Security-Policy, which needs a
// fresh nonce per request.

// OAuth sign-in may leave through a form submission that redirects to the provider.
const SIGN_IN_ORIGINS = "https://github.com https://accounts.google.com https://discord.com";

/**
 * Content Security Policy. Scripts must carry this request's nonce: Next.js
 * reads it from this header and puts it on the small inline scripts that boot
 * the app, so an injected `<script>` has no way to run. `strict-dynamic` lets
 * those nonced scripts load the page's own bundles.
 *
 * Inline *styles* stay allowed. The app styles elements with `style={{…}}`
 * attributes throughout, which a nonce cannot cover, and a style injection is
 * not a code execution. Development also needs eval, for React's error overlay.
 */
export function contentSecurityPolicy(nonce: string, production: boolean) {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${production ? "" : " 'unsafe-eval' 'unsafe-inline'"}`,
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
}

/** Nothing but data ever comes back from the API, and nothing may frame or embed it. */
export const API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; sandbox";

/** The fixed headers, which do not depend on the request. */
export function securityHeaders(production: boolean) {
  return [
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
}
