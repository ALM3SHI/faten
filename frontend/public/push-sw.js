/* Faten service worker: offline app shell + push notifications.
 *
 * One worker per scope, so caching lives here beside push (lib/push.ts and
 * components/service-worker-host.tsx register this same file).
 *
 * Caching, chosen so nobody gets stuck on an old version:
 *   pages            network first; the cached copy only when offline
 *   /_next/static/*  cache first (file names change with every build)
 *   fonts, map, icons stale-while-revalidate
 *   everything else  not touched (the API, Firebase, other origins)
 *
 * Push: shows FCM notifications (data-only messages sent by
 * backend/services/push.py) and opens the right page on tap. Kept free of
 * the Firebase SDK: FCM delivers a plain Web Push event here. */

// Replaced per build by scripts/stamp-sw.mjs: each deploy is a new worker.
const VERSION = "dev";
const PAGES = `faten-pages-${VERSION}`;
// Hashed file names never change meaning, so these survive deploys: a tab
// still running the old version can keep loading its own chunks.
const STATIC = "faten-static";
const ASSETS = "faten-assets";
const KEEP = new Set([PAGES, STATIC, ASSETS]);
const STATIC_LIMIT = 400;
const PAGE_TIMEOUT_MS = 4000;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.startsWith("faten-") && !KEEP.has(n)).map((n) => caches.delete(n)));
      // Oldest first: drop what is beyond the limit.
      const statics = await caches.open(STATIC);
      const keys = await statics.keys();
      await Promise.all(keys.slice(0, Math.max(0, keys.length - STATIC_LIMIT)).map((k) => statics.delete(k)));
      await self.clients.claim();
    })(),
  );
});

const isAsset = (path) => /\.(?:woff2?|webp|png|svg|ico|jpg|jpeg)$/.test(path);

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    event.respondWith(networkFirst(req));
  } else if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(req, STATIC));
  } else if (isAsset(url.pathname)) {
    event.respondWith(staleWhileRevalidate(req, ASSETS));
  }
});

async function networkFirst(req) {
  const cache = await caches.open(PAGES);
  try {
    const res = await withTimeout(fetch(req), PAGE_TIMEOUT_MS);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const cached = await cache.match(req, { ignoreSearch: true });
    if (cached) return cached;
    return offlinePage();
  }
}

// A page never opened while online: say so, and point to what works offline.
function offlinePage() {
  const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>غير متصل — فطن</title>
<style>body{font-family:system-ui,sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;background:#f7f7fb;color:#16161d}
@media (prefers-color-scheme:dark){body{background:#0a0a0f;color:#ececf1}}main{max-width:28rem;padding:1.5rem;text-align:center;line-height:1.8}
a{color:#4f46e5;font-weight:600}</style></head><body><main><h1>أنت غير متصل</h1>
<p>هذه الصفحة لم تُفتح من قبل على هذا الجهاز، فلا نسخة محفوظة منها.</p>
<p>تعمل بلا اتصال: <a href="/time/">وقتي</a> · <a href="/schedule/">الجدول</a> · <a href="/locations/">الخريطة</a></p></main></body></html>`;
  return new Response(html, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

async function cacheFirst(req, name) {
  const cache = await caches.open(name);
  const cached = await cache.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

async function staleWhileRevalidate(req, name) {
  const cache = await caches.open(name);
  const cached = await cache.match(req);
  const fresh = fetch(req)
    .then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => cached);
  return cached || fresh;
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

// The app asks for its core screens to be kept for offline use (signed-in
// pages only): each page and the scripts and styles it loads.
self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "warm" && Array.isArray(data.paths)) event.waitUntil(warm(data.paths));
  // Files the page loaded before this worker controlled it (lazy chunks such
  // as the sign-in code): keep them too, or the offline page cannot start.
  if (data.type === "keep" && Array.isArray(data.urls)) event.waitUntil(keep(data.urls));
});

async function keep(urls) {
  const statics = await caches.open(STATIC);
  await Promise.all(
    urls
      .filter((u) => typeof u === "string" && new URL(u, self.location.origin).pathname.startsWith("/_next/static/"))
      .map(async (u) => {
        if (!(await statics.match(u))) await statics.add(u).catch(() => undefined);
      }),
  );
}

async function warm(paths) {
  const pages = await caches.open(PAGES);
  const statics = await caches.open(STATIC);
  for (const path of paths) {
    try {
      const res = await fetch(path, { credentials: "same-origin" });
      if (!res.ok) continue;
      const html = await res.clone().text();
      await pages.put(path, res);
      const files = [...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/g)].map((m) => m[1]);
      await Promise.all(
        files.map(async (f) => {
          if (!(await statics.match(f))) await statics.add(f).catch(() => undefined);
        }),
      );
    } catch (_) {
      /* offline or a page failed: the rest still warm */
    }
  }
  // The map image is large: keep it once, for the offline map.
  const assets = await caches.open(ASSETS);
  if (!(await assets.match("/base-map.webp"))) await assets.add("/base-map.webp").catch(() => undefined);
}

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
