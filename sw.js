// Koti service worker: the app opens offline, and updates arrive on the next launch.
// Bump VERSION with every release so phones pick up new files.
const VERSION = "koti-2026-10-31-6";
const SHELL = [
  "./", "index.html", "manifest.webmanifest", "css/app.css",
  "js/config.js", "js/vendor/supabase-2.117.3.js", "js/app.js", "js/data.js", "js/sync.js", "js/ui.js", "js/charts.js", "js/setup.js", "js/more.js", "js/money.js", "js/voice.js", "js/ptr.js", "js/plan.js", "js/receipts.js",
  "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png",
];

self.addEventListener("install", e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== "koti-fonts").map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET") return;
  // Fonts: keep a copy so the app looks right offline
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    e.respondWith(caches.open("koti-fonts").then(async c => { const hit = await c.match(req); const net = fetch(req).then(r => { if (r.ok || r.type === "opaque") c.put(req, r.clone()); return r; }).catch(() => hit); return hit || net; }));
    return;
  }
  if (url.origin !== self.location.origin) return; // Supabase and others go straight to the network
  // Pages: network first so updates show up, cache when offline
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).then(r => { const copy = r.clone(); caches.open(VERSION).then(c => c.put("index.html", copy)); return r; }).catch(() => caches.match("index.html")));
    return;
  }
  // App files: cache first, refresh in the background
  e.respondWith(caches.match(req).then(hit => { const net = fetch(req).then(r => { if (r.ok) { const copy = r.clone(); caches.open(VERSION).then(c => c.put(req, copy)); } return r; }).catch(() => hit); return hit || net; }));
});
