// SpareCube Service Worker
// Caches the app shell (HTML/manifest/icons + key CDN libraries) so the app
// can open even with no internet connection. Live data (Firestore) still
// needs a connection to sync — this only makes the app itself load offline.

const CACHE_NAME = "sparecube-shell-v2";

const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Only handle simple GET requests; never touch Firestore's own network
  // traffic so real-time sync keeps working normally when online.
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  const isFirestore = url.hostname.includes("firestore") || url.hostname.includes("googleapis");
  if (isFirestore) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          // Only cache successful, cacheable responses.
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return res;
        })
        .catch(() => cached); // offline fallback to whatever we have cached

      // Cache-first for speed + offline support; refresh cache in background.
      return cached || network;
    })
  );
});
