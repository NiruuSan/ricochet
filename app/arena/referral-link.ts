"use client";

// What a visitor brought with them, kept across the trip to a sign-in provider
// and back: the referral code of the link they followed, and the page they
// were headed to (a challenge seat, usually). Both live in this browser only.

const REFERRAL_KEY = "ricochet:ref";
const NEXT_KEY = "bounce.next";

const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string | null) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Without storage the link's own query string still carries it.
  }
};

/** Only a path on this site may be a destination (browsers read "/\" like "//", another site). */
export const safeNext = (value: string | null | undefined) => (value && /^\/(?![/\\])/.test(value) ? value : null);

/** Keeps a referral code from any page's `?ref=` (shared replays and scores carry one). */
export function rememberReferral(code: string | null) {
  if (code && /^[a-z0-9]{4,32}$/i.test(code)) write(REFERRAL_KEY, code.toLowerCase());
}
export const rememberedReferral = () => read(REFERRAL_KEY);
export const forgetReferral = () => write(REFERRAL_KEY, null);

/** Where to go once the visitor has an account. */
export const rememberNext = (path: string) => write(NEXT_KEY, safeNext(path));
export const rememberedNext = () => safeNext(read(NEXT_KEY));
export const forgetNext = () => write(NEXT_KEY, null);
