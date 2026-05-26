const CACHE = "taskboard-v1";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const { request } = e;
  const url = new URL(request.url);

  // Only handle same-origin GET requests
  if (request.method !== "GET" || url.origin !== location.origin) return;

  // Skip Next.js HMR and internal dev endpoints
  if (url.pathname.startsWith("/_next/webpack-hmr") ||
      url.pathname.startsWith("/__nextjs_original-stack-frame") ||
      url.searchParams.has("_rsc")) return;

  // Skip API calls — handled by app-layer write queue + IndexedDB
  if (url.pathname.startsWith("/api/")) return;

  // Navigation requests: network first, fall back to cached page or "/"
  if (request.mode === "navigate") {
    e.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) caches.open(CACHE).then((c) => c.put(request, res.clone()));
          return res;
        })
        .catch(() =>
          caches.match(request).then((r) => r ?? caches.match("/"))
        )
    );
    return;
  }

  // Static assets: network first, cache on success, serve from cache when offline
  e.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok || res.status === 0) {
          caches.open(CACHE).then((c) => c.put(request, res.clone()));
        }
        return res;
      })
      .catch(() => caches.match(request))
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow("/"));
});
