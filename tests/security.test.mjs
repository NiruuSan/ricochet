import assert from "node:assert/strict";
// Importing the harness registers the resolver these modules import each other with.
import { readFile } from "node:fs/promises";
import "./helpers/test-env.mjs";

// Security building blocks: step-up sign-in for withdrawals, request parsing
// limits, same-origin checks, client keys for rate limits, and HTTP headers.
const { stepUpRequired, STEP_UP_WINDOW_MS } = await import("../lib/step-up.ts");
const { clientKey, readBody, sameOrigin } = await import("../lib/http.ts");

// Step-up: only a recent provider sign-in may move money out.
const now = Date.UTC(2026, 8, 16, 12);
assert.equal(stepUpRequired({ userId: "github:1", authTime: now - 60_000 }, now), null);
assert.equal(stepUpRequired({ userId: "github:1", authTime: now - STEP_UP_WINDOW_MS }, now), null);
const stale = stepUpRequired({ userId: "google:7", authTime: now - STEP_UP_WINDOW_MS - 1 }, now);
assert.deepEqual([stale.code, stale.provider], ["REAUTH_REQUIRED", "google"], "An old sign-in must be confirmed again with the same provider");
assert.equal(stepUpRequired({ userId: "discord:9", authTime: null }, now).code, "REAUTH_REQUIRED", "Sessions without a sign-in time must confirm");
assert.equal(stepUpRequired({ userId: "github:1", authTime: now + 10 * 60_000 }, now).code, "REAUTH_REQUIRED", "A sign-in time from the future is not trusted");

// Request bodies: JSON only, size-capped before and while reading.
const post = (body, headers = {}) => new Request("https://ricochet.test/api/x", { method: "POST", body, headers: { "content-type": "application/json", ...headers } });
assert.deepEqual(await readBody(post('{"action":"read"}'), 100), { body: { action: "read" } });
assert.equal((await readBody(post('{"a":1}', { "content-type": "text/plain" }), 100)).status, 415, "Form posts and text bodies are refused");
assert.equal((await readBody(post("x".repeat(20), { "content-length": "5000" }), 100)).status, 413, "A declared oversize body is refused unread");
const streamed = new Request("https://ricochet.test/api/x", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: new ReadableStream({ start(c) { for (let i = 0; i < 10; i++) c.enqueue(new TextEncoder().encode("x".repeat(50))); c.close(); } }),
  duplex: "half",
});
assert.equal((await readBody(streamed, 100)).status, 413, "An undeclared oversize body stops being read at the limit");
for (const bad of ["[1,2]", "null", "42", "{nope"]) assert.equal((await readBody(post(bad), 100)).status, 400, `Rejects ${bad}`);

// Cross-site posts are rejected: the Origin must be this site.
const at = (origin) => new Request("https://ricochet.test/api/wallet", { method: "POST", headers: origin ? { origin } : {} });
assert.equal(sameOrigin(at("https://ricochet.test")), true);
assert.equal(sameOrigin(at("https://evil.test")), false);
assert.equal(sameOrigin(at("null")), false);
assert.equal(sameOrigin(at(null)), false, "Requests without an Origin cannot mutate state");

// Rate-limit keys: the user when signed in, otherwise the platform-provided client IP.
const ipReq = new Request("https://ricochet.test/api/arena", { headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" } });
assert.equal(clientKey(ipReq, "github:1"), "github:1");
assert.equal(clientKey(ipReq), "ip:203.0.113.9");
assert.equal(clientKey(new Request("https://ricochet.test/")), "ip:unknown");

// HTTP security headers on every route, stricter in production.
process.env.NODE_ENV = "production";
const config = (await import(`../next.config.ts?production`)).default;
const [rule, api] = await config.headers();
const header = (name) => rule.headers.find((h) => h.key.toLowerCase() === name.toLowerCase())?.value;
assert.equal(rule.source, "/:path*");
assert.equal(header("Content-Security-Policy"), undefined, "The page policy carries a nonce, so it is set per request");

// The Content-Security-Policy proxy.ts builds for one request.
const { contentSecurityPolicy, API_CSP } = await import("../lib/security-headers.ts");
const csp = contentSecurityPolicy("abc123", true);
for (const directive of ["default-src 'self'", "object-src 'none'", "frame-ancestors 'none'", "base-uri 'self'", "connect-src 'self'"]) assert.ok(csp.includes(directive), `CSP has ${directive}`);
assert.ok(csp.includes("script-src 'self' 'nonce-abc123' 'strict-dynamic'"), "Scripts must carry this request's nonce");
assert.ok(!/script-src[^;]*unsafe-inline/.test(csp), "No inline script may run in production");
assert.ok(!csp.includes("unsafe-eval"), "No eval in production");
assert.ok(/script-src[^;]*unsafe-inline/.test(contentSecurityPolicy("abc123", false)), "Development keeps the tooling working");
assert.equal(api.source, "/api/:path*");
assert.equal(api.headers[0].value, API_CSP);
assert.ok(API_CSP.startsWith("default-src 'none'"), "API responses are data, nothing else");

// The proxy hands each request its own nonce, and runs on pages only. It imports
// the Next.js server runtime, so what can be checked here is how it is wired.
const proxySource = await readFile(new URL("../proxy.ts", import.meta.url), "utf8");
assert.match(proxySource, /headers\.set\("x-nonce", nonce\)/, "The renderer is told the nonce");
assert.match(proxySource, /response\.headers\.set\("Content-Security-Policy", csp\)/, "The browser is told the policy");
assert.match(proxySource, /crypto\.randomUUID\(\)/, "The nonce is unguessable and fresh per request");
assert.match(proxySource, /\(\?!api\|_next\/static/, "Static assets and the API are left out");

assert.match(header("Strict-Transport-Security"), /max-age=63072000; includeSubDomains/);
assert.equal(header("X-Frame-Options"), "DENY");
assert.equal(header("X-Content-Type-Options"), "nosniff");
assert.ok(header("Permissions-Policy").includes("camera=()"));
assert.equal(config.poweredByHeader, false);

console.log("PASS: step-up sign-in for withdrawals, JSON-only size-capped bodies, same-origin posts, rate-limit client keys, production security headers, per-request script nonce and API data-only policy.");
