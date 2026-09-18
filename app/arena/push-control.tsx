"use client";
import { useEffect, useState } from "react";
import { request } from "./api";

export function PushControl() {
  const [key, setKey] = useState<string | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        if (active) { setMessage("Push is unavailable in this browser. On iPhone or iPad, add Bounce to your Home Screen and open it there."); setBusy(false); }
        return;
      }
      try {
        const config = await request<{ publicKey: string | null }>("/api/push");
        if (!active) return;
        setKey(config.publicKey);
        if (!config.publicKey) { setMessage("Push notifications are not available yet."); return; }
        const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
        const sub = await registration.pushManager.getSubscription();
        if (sub) {
          const status = await request<{ subscribed: boolean }>("/api/push", { action: "status", endpoint: sub.endpoint });
          if (active) setSubscribed(status.subscribed);
        }
      } catch { if (active) { setKey(null); setMessage("Unable to load push settings. Reopen notifications to retry."); } }
      finally { if (active) setBusy(false); }
    };
    void load();
    return () => { active = false; };
  }, []);

  const toggle = async () => {
    setBusy(true); setMessage("");
    try {
      // Request permission directly from the user's click, before any network wait.
      if (!subscribed && await Notification.requestPermission() !== "granted") {
        setMessage("Notifications are blocked. Allow them in your browser’s site settings to enable push.");
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      let sub = await registration.pushManager.getSubscription();
      if (subscribed) {
        if (sub) {
          await request("/api/push", { action: "unsubscribe", endpoint: sub.endpoint });
          await sub.unsubscribe();
        }
        setSubscribed(false);
      } else {
        const applicationServerKey = Uint8Array.from(atob(key!.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
        sub ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
        await request("/api/push", { action: "subscribe", subscription: sub.toJSON() });
        setSubscribed(true);
      }
    } catch (e) { setMessage(e instanceof Error ? e.message : "Unable to update push notifications."); }
    finally { setBusy(false); }
  };

  return <div style={{ padding: 16, borderTop: "1px solid var(--border)" }}>
    <p className="fine">Get notified on this device when your opponent finishes, even when Bounce is closed.</p>
    {key && <button className="btn" style={{ marginTop: 8 }} disabled={busy} onClick={() => void toggle()}>{busy ? "Please wait…" : subscribed ? "Disable push notifications" : "Enable push notifications"}</button>}
    {message && <p className="fine" role="status">{message}</p>}
  </div>;
}
