// Koti service worker: the app opens offline, and updates arrive on the next launch.
// Bump VERSION with every release so phones pick up new files.
const VERSION = "koti-2026-11-05-32";
const SHELL = [
  "./", "index.html", "manifest.webmanifest", "css/app.css",
  "js/config.js", "js/theme.js", "js/vendor/supabase-2.117.3.js", "js/app.js", "js/data.js", "js/sync.js", "js/ui.js", "js/charts.js", "js/setup.js", "js/more.js", "js/money.js", "js/voice.js", "js/ptr.js", "js/plan.js", "js/receipts.js", "js/income.js", "js/lists.js", "js/version.js", "js/update.js", "js/scan.js", "js/ledger.js", "js/push.js", "js/now.js", "js/month.js", "js/place.js", "js/composer.js", "js/onboarding.js", "js/paydays.js", "js/reminders.js", "js/remindparse.js", "js/install.js", "js/spent.js", "js/hear.js", "js/period.js", "js/receipt.js", "js/engine.js",
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
  // Big versioned libraries (receipt reader, Supabase): cache first, they never change at the same address
  if (url.pathname.includes("/js/vendor/")) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => { if (r.ok) { const copy = r.clone(); caches.open(VERSION).then(c => c.put(req, copy)); } return r; })));
    return;
  }
  // App code and styles: always fresh when online, so updates show up on the next open; cached copy when offline or slow
  e.respondWith(new Promise(resolve => {
    let done = false;
    const fromCache = () => caches.match(req).then(hit => { if (!done && hit) { done = true; resolve(hit); } return hit; });
    const timer = setTimeout(fromCache, 4000);
    fetch(req, { cache: "no-cache" }).then(r => {
      clearTimeout(timer);
      if (r.ok) { const copy = r.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      if (!done) { done = true; resolve(r); }
    }).catch(() => { clearTimeout(timer); fromCache().then(hit => { if (!done) { done = true; resolve(hit || Response.error()); } }); });
  }));
});

/* ---------- Reminders (push notifications) ---------- */
// A reminder can carry two buttons (Paid / Not yet, It landed / Not yet) and a signed token. Tapping a button
// sends the answer straight to Koti's server, without opening the app; if that fails, Koti opens instead.
self.addEventListener("push", e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch { d = { title: "Koti", body: e.data && e.data.text() }; }
  const opts = { body: d.body || "", tag: d.tag || undefined, icon: "icons/icon-192.png", badge: "icons/icon-192.png", data: { url: d.url || "./", token: d.token || null, answer: d.answer || null } };
  if (Array.isArray(d.actions) && d.token) opts.actions = d.actions.slice(0, 2);
  e.waitUntil(self.registration.showNotification(d.title || "Koti", opts));
});
function openKoti(url) {
  return self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    const open = list.find(c => c.url.startsWith(self.registration.scope));
    if (open) { open.navigate(url).catch(() => {}); return open.focus(); }
    return self.clients.openWindow(url);
  });
}
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const data = e.notification.data || {}, url = new URL(data.url || "./", self.registration.scope).href;
  if (e.action && data.token && data.answer) {
    e.waitUntil(fetch(data.answer, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "answer", token: data.token, choice: e.action }) })
      .then(r => { if (!r.ok) throw new Error(String(r.status)); return self.clients.matchAll({ type: "window", includeUncontrolled: true }); })
      .then(list => list.forEach(c => c.postMessage({ type: "koti-refresh" })))
      .catch(() => openKoti(url)));
    return;
  }
  e.waitUntil(openKoti(url));
});
