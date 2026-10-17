"use client";
import { useSyncExternalStore } from "react";
import { LATEST_RELEASE, unreadReleases } from "@/lib/changelog";

// Which updates this browser has read (lib/changelog.ts): the newest release
// date it has seen, kept locally. The account menu counts the ones since.

const KEY = "bounce.news.seen";
const EVENT = "bounce:news-seen";

function seen() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return LATEST_RELEASE;
  }
}

/** Marks every release read, and tells the menu. */
export function markNewsSeen() {
  try {
    localStorage.setItem(KEY, LATEST_RELEASE);
  } catch {
    // Without storage the count simply stays.
  }
  window.dispatchEvent(new Event(EVENT));
}

const subscribe = (change: () => void) => {
  window.addEventListener(EVENT, change);
  window.addEventListener("storage", change);
  return () => {
    window.removeEventListener(EVENT, change);
    window.removeEventListener("storage", change);
  };
};

/** Updates not read yet; none on the server, where nobody has read anything. */
export const useUnreadNews = () => useSyncExternalStore(subscribe, () => unreadReleases(seen()), () => 0);
