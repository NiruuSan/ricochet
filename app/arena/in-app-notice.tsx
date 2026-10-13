"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Check, Compass, Copy, X } from "lucide-react";
import { inAppBrowser, openInBrowserLink, type InApp } from "./in-app";
import { insideWalletBrowser } from "./solana-wallet";
import { toast } from "./feedback";
import styles from "./in-app.module.css";

const DISMISSED = "bounce.inAppDismissed";
const noSubscription = () => () => {};
const dismissedBefore = () => {
  try {
    return !!sessionStorage.getItem(DISMISSED);
  } catch {
    // Without storage the notice simply comes back on the next page.
    return false;
  }
};

/**
 * The social app whose browser this page is in, or null. Read after mounting,
 * so the first paint matches the server's HTML. A wallet's own browser is a
 * web view too, but there the wallet is built in and nothing needs escaping.
 */
export function useInApp() {
  const [where, setWhere] = useState<InApp | null>(null);
  useEffect(() => {
    const detected = inAppBrowser(navigator.userAgent);
    if (!detected) return;
    // Wallets announce themselves as the page loads; give them a moment first.
    const timer = setTimeout(() => setWhere(insideWalletBrowser() ? null : detected), 400);
    return () => clearTimeout(timer);
  }, []);
  return where;
}

/**
 * Says the page is inside a social app's browser and hands it to the real one.
 * `firm` is for the sign-in page, where staying put does not work: it cannot be
 * dismissed and says why.
 */
export function InAppNotice({ firm = false }: { firm?: boolean }) {
  const where = useInApp();
  const [closed, setClosed] = useState(false);
  const [copied, setCopied] = useState(false);
  const href = useSyncExternalStore(noSubscription, () => window.location.href, () => "");
  const before = useSyncExternalStore(noSubscription, dismissedBefore, () => false);
  const hidden = closed || (!firm && before);

  if (!where || hidden || !href) return null;
  const browser = where.ios ? "Safari" : where.android ? "Chrome" : "your browser";
  const open = openInBrowserLink(where, href);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
      toast("Link copied", { detail: `Paste it in ${browser} to carry on there.` });
    } catch {
      toast("Copy the address from the menu", { detail: `Use “Open in ${browser}” from ${where.app}’s ••• menu.`, tone: "info" });
    }
  };

  const dismiss = () => {
    setClosed(true);
    try {
      sessionStorage.setItem(DISMISSED, "1");
    } catch {
      // Hidden for this page only.
    }
  };

  return (
    <aside className={`${styles.notice} ${firm ? styles.firm : ""}`} aria-label="Open Bounce in your browser">
      <Compass className={styles.icon} aria-hidden />
      <div className={styles.text}>
        <b>You’re in {where.app === "this app" ? "an app’s" : `${where.app}’s`} browser.</b>
        <span>
          {firm
            ? `Signing in and connecting a wallet only work in ${browser}. Open Bounce there: your game and your link come with you.`
            : `Practice works here, but signing in and wallets work best in ${browser}.`}
        </span>
        {firm && <span className={styles.how}>Or tap ••• at the top of the screen, then “Open in {browser === "your browser" ? "browser" : browser}”.</span>}
      </div>
      <div className={styles.actions}>
        {open && (
          <a className="btn btn-primary" href={open}>
            Open in {browser}
          </a>
        )}
        <button type="button" className="btn" onClick={() => void copy()}>
          {copied ? <Check size={15} className="pop-in" /> : <Copy size={15} />} Copy link
        </button>
      </div>
      {!firm && (
        <button type="button" className={styles.close} aria-label="Hide this notice" onClick={dismiss}>
          <X size={16} />
        </button>
      )}
    </aside>
  );
}
