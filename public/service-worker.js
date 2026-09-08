const CACHE_NAME = "prime-wallet-v1";

const urlsToCache = [
  "/",
  "/index.html",
  "/dashboard.html",
  "/deposit.html",
  "/withdraw.html",
  "/gift.html",
  "/more.html",
  "/profile.html",
  "/site.webmanifest",
  "/prime_wallet_logo_192x192.png",
  "/prime_wallet_logo_512x512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(urlsToCache);
    })
  );

  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      )
    )
  );

  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});
