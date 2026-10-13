/* Faten push service worker — shows FCM notifications (data-only messages
 * sent by backend/services/push.py) and opens the right page on tap.
 * Kept free of the Firebase SDK: the page registers it and passes it to
 * getToken(), FCM delivers a plain Web Push event here. */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (_) {
    payload = { data: { body: event.data ? event.data.text() : "" } };
  }
  const n = payload.notification || {};
  const d = payload.data || {};
  const title = d.title || n.title || "فطن";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: d.body || n.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      dir: "rtl",
      lang: "ar",
      tag: d.tag || undefined,
      data: { url: d.url || "/dashboard" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/dashboard", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (w.url.startsWith(self.location.origin) && "focus" in w) {
          w.navigate(url);
          return w.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
