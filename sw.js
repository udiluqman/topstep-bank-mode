const CACHE = "bankmode-full-v6"; // bump this to force updates

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(["./","./index.html","./app.js","./manifest.webmanifest","./sw.js"]);
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k !== CACHE ? caches.delete(k) : null)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  const isCore =
    url.pathname.endsWith("/index.html") ||
    url.pathname.endsWith("/app.js") ||
    url.pathname.endsWith("/sw.js") ||
    url.pathname.endsWith("/manifest.webmanifest") ||
    e.request.mode === "navigate";

  if (isCore) {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(e.request);
        const cache = await caches.open(CACHE);
        cache.put(e.request, fresh.clone());
        return fresh;
      } catch {
        const cached = await caches.match(e.request);
        return cached || caches.match("./");
      }
    })());
    return;
  }
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
