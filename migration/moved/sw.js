// The old address's last service worker (put it beside the "moved" page as sw.js). Phones that installed Koti at
// casanda00.github.io/koti/ keep running the cached copy until a new sw.js replaces the old one, and a missing sw.js
// doesn't remove it. This one takes over, clears the old copy and reloads open windows onto the "moved" page.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil((async () => {
  for (const k of await caches.keys()) await caches.delete(k);
  await self.registration.unregister();
  for (const c of await self.clients.matchAll({ type: "window" })) c.navigate(c.url).catch(() => {});
})()));
