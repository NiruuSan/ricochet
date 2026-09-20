import { NextResponse, type NextRequest } from "next/server";
import { contentSecurityPolicy } from "./lib/security-headers";

/**
 * Every page gets its own script nonce. Next.js reads it back out of this
 * header while rendering and puts it on the scripts it writes into the page, so
 * the policy can refuse every other inline script instead of allowing them all.
 *
 * The cost is that a page carrying a nonce cannot be prerendered: each request
 * renders its own HTML. The pages here are thin shells around a client app, and
 * their scripts, styles and images stay static and cached.
 */
export function proxy(request: NextRequest) {
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const csp = contentSecurityPolicy(nonce, process.env.NODE_ENV === "production");
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    // Pages only: the API sets its own policy, and static assets, images and
    // files in public/ do not need one. Prefetches are skipped as well.
    {
      source: "/((?!api|_next/static|_next/image|.*\\.(?:png|jpg|jpeg|svg|ico|webmanifest|txt|xml|js)$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
