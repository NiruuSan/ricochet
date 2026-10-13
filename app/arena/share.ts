"use client";
import { useEffect, useState } from "react";
import { request } from "./api";
import { toast } from "./feedback";

// Sharing a result. A shared link carries the sharer's referral code, so a
// friend who signs up from it pays the reduced fee and the sharer is credited
// (lib/referrals.ts) — every result posted is an invitation.

let mine: Promise<string | null> | null = null;

/** The player's own referral code, asked for once per page. Null for visitors or while it loads. */
export function useReferralCode(enabled: boolean) {
  const [code, setCode] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    mine ??= request<{ code: string }>("/api/referrals").then(
      (r) => r.code ?? null,
      () => {
        mine = null;
        return null;
      },
    );
    void mine.then((found) => active && setCode(found));
    return () => {
      active = false;
    };
  }, [enabled]);
  return code;
}

/** A path on this site as a full link, with the sharer's code when there is one. */
export function sharedLink(path: string, code: string | null) {
  const url = new URL(path, window.location.origin);
  if (code) url.searchParams.set("ref", code);
  return url.toString();
}

/**
 * Hands a result to whatever the device shares with (the share sheet on a
 * phone), or copies it. Says so either way; a share the player backed out of
 * says nothing.
 */
export async function shareResult(title: string, text: string, url: string) {
  try {
    if (navigator.share) {
      await navigator.share({ title, text, url });
      return;
    }
    await navigator.clipboard.writeText(`${text} ${url}`);
    toast("Link copied", { detail: "Paste it anywhere: it opens with the score on its card." });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") return;
    toast("Could not share", { detail: "Copy the address from your browser instead.", tone: "info" });
  }
}
