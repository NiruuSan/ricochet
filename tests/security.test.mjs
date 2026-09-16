import assert from "node:assert/strict";

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
const [rule] = await config.headers();
const header = (name) => rule.headers.find((h) => h.key.toLowerCase() === name.toLowerCase())?.value;
assert.equal(rule.source, "/:path*");
const csp = header("Content-Security-Policy");
for (const directive of ["default-src 'self'", "object-src 'none'", "frame-ancestors 'none'", "base-uri 'self'", "connect-src 'self'"]) assert.ok(csp.includes(directive), `CSP has ${directive}`);
assert.ok(!csp.includes("unsafe-eval"), "No eval in production");
assert.match(header("Strict-Transport-Security"), /max-age=63072000; includeSubDomains/);
assert.equal(header("X-Frame-Options"), "DENY");
assert.equal(header("X-Content-Type-Options"), "nosniff");
assert.ok(header("Permissions-Policy").includes("camera=()"));
assert.equal(config.poweredByHeader, false);

console.log("PASS: step-up sign-in for withdrawals, JSON-only size-capped bodies, same-origin posts, rate-limit client keys, production security headers.");
