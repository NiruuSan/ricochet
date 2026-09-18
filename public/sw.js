/* Push only: authenticated pages and responses are never cached. */
self.addEventListener("push", (event) => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(self.registration.showNotification(data.title || "Bounce", {
    body: data.body, icon: "/apple-icon.png", tag: data.tag, data: { url: data.url },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin);
  if (url.origin !== self.location.origin) return;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    // Do not navigate an active game away; reuse only an already-open recap.
    const existing = windows.find((client) => client.url === url.href);
    if (existing) return existing.focus();
    return self.clients.openWindow(url.href);
  })());
});
