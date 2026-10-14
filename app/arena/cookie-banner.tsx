"use client";
import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Cookie } from "lucide-react";
import styles from "./cookie-banner.module.css";

// The cookie notice.
//
// Bounce stores only what it needs to work (the sign-in session) or what the
// player asked it to remember (sound, currency, a dismissed guide), which the
// ePrivacy rules exempt from consent. So the notice informs once and asks
// nothing: an Accept / Refuse pair here would offer a choice that changes
// nothing. The day an optional tracker is added, it must ask first, and this
// is where: bump VERSION so everyone sees the new question.

const KEY = "bounce.cookies";
const VERSION = "1";
const noSubscription = () => () => {};
const seen = () => {
  try {
    return localStorage.getItem(KEY) === VERSION;
  } catch {
    // Storage refused: the notice shows, and closes for this page only.
    return false;
  }
};

export function CookieBanner() {
  // Read after hydration, so the server and first paint agree that nothing is shown.
  const already = useSyncExternalStore(noSubscription, seen, () => true);
  const [closed, setClosed] = useState(false);
  if (already || closed) return null;

  const close = () => {
    setClosed(true);
    try {
      localStorage.setItem(KEY, VERSION);
    } catch {
      // Hidden for this page.
    }
  };

  return (
    <aside className={styles.banner} role="region" aria-label="Cookies">
      <Cookie className={styles.icon} aria-hidden />
      <p>
        <b>No tracking here.</b> Bounce only uses a sign-in cookie and a few settings saved in your browser. No analytics, no ads, nothing to accept.
      </p>
      <div className={styles.actions}>
        <Link className="btn" href="/privacy#cookies" onClick={close}>
          Details
        </Link>
        <button type="button" className="btn btn-primary" onClick={close}>
          Got it
        </button>
      </div>
    </aside>
  );
}
