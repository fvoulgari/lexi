/* global __STATIC_FILES__ */
const cacheName = "notebook-static-__CACHE_VERSION__";
const staticFiles = __STATIC_FILES__;
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(cacheName);
      // No credentials are ever sent while fetching the public shell.
      await cache.addAll(
        staticFiles.map(
          (path) => new Request(path, { credentials: "omit", cache: "reload" }),
        ),
      );
    })(),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith("notebook-static-") && key !== cacheName)
          await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname === "/api" ||
    url.pathname.startsWith("/api/")
  )
    return;
  // Navigation returns only the generic build shell, never a runtime response.
  const path = event.request.mode === "navigate" ? "/index.html" : url.pathname;
  if (url.search || !staticFiles.includes(path)) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(cacheName);
      return (await cache.match(path)) || fetch(event.request);
    })(),
  );
});
