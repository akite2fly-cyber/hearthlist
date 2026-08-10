/* Hearthlist service worker — reminder notification popups */
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow("/app");
      return undefined;
    })
  );
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "SHOW_REMINDER" && data.title) {
    event.waitUntil(
      self.registration.showNotification(data.title, {
        body: data.body || "Hearthlist household reminder",
        tag: data.tag || "hearthlist-reminder",
        renotify: true,
        requireInteraction: true,
      })
    );
  }
});
