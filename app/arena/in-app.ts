// The browsers built into social apps.
//
// A link opened from TikTok, Instagram or X lands in that app's own browser.
// Google refuses to sign anyone in there (it rejects embedded browsers
// outright), other providers often lose the session on the way back, and no
// wallet extension runs there. So the page says where it is and offers a way
// out, instead of letting a new player hit a wall at the sign-in button.

const APPS: [RegExp, string][] = [
  [/Instagram/i, "Instagram"],
  [/FBAN|FBAV|FB_IAB|FBIOS|FB4A/i, "Facebook"],
  [/musical_ly|BytedanceWebview|TikTok|trill_/i, "TikTok"],
  [/Snapchat/i, "Snapchat"],
  [/TwitterAndroid|Twitter for iPhone|\bTwitter\b/i, "X"],
  [/LinkedInApp/i, "LinkedIn"],
  [/Pinterest/i, "Pinterest"],
  [/\bLine\//i, "LINE"],
];

export type InApp = { app: string; ios: boolean; android: boolean };

/** The app whose browser this is, or null in a real browser. */
export function inAppBrowser(ua: string): InApp | null {
  const ios = /iPhone|iPad|iPod/i.test(ua);
  const android = /Android/i.test(ua);
  const named = APPS.find(([pattern]) => pattern.test(ua))?.[1];
  if (named) return { app: named, ios, android };
  // Unnamed embedded browsers: Android's WebView marks itself; on iOS a web
  // view is a WebKit browser without Safari's own token. Safari, Chrome,
  // Firefox and Edge on iOS all carry it.
  if (android && /; wv\)/.test(ua)) return { app: "this app", ios, android };
  if (ios && /AppleWebKit/i.test(ua) && !/Safari\//i.test(ua)) return { app: "this app", ios, android };
  return null;
}

/**
 * A link that hands this page to the phone's real browser: Chrome through an
 * Android intent (falling back to the page itself), Safari through its own
 * scheme on iOS 17 and later. Null where no such link exists.
 */
export function openInBrowserLink(where: InApp, href: string) {
  const url = new URL(href);
  if (where.android) {
    return `intent://${url.host}${url.pathname}${url.search}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(href)};end`;
  }
  if (where.ios) return `x-safari-${href}`;
  return null;
}
