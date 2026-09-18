/* ============================================
   UNIVERSE WALLET — SERVICE WORKER
   ============================================ */

const CACHE_NAME = "universe-wallet-v1";

/* 🔹 যে ফাইলগুলো offline-এও কাজ করবে */
const urlsToCache = [
    "/",
    "/index.html",
    "/dashboard.html",
    "/deposit.html",
    "/withdraw.html",
    "/gift.html",
    "/more.html",
    "/profile.html",
    "/transactions.html",
    "/transfer.html",
    "/site.webmanifest",
    "/universe-wallet-logo-192.png",
    "/universe-wallet-logo-512.png"
];

/* ============================================
   INSTALL — ফাইল cache করুন
   ============================================ */
self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            // 🔹 addAll fail হলেও SW install হবে
            return Promise.allSettled(
                urlsToCache.map((url) =>
                    cache.add(url).catch((err) => {
                        console.warn("⚠️ Cache failed:", url, err.message);
                    })
                )
            );
        })
    );
    self.skipWaiting();
});

/* ============================================
   ACTIVATE — পুরনো cache মুছুন
   ============================================ */
self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) =>
            Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        console.log("🗑️ Deleting old cache:", cacheName);
                        return caches.delete(cacheName);
                    }
                })
            )
        )
    );
    self.clients.claim();
});

/* ============================================
   FETCH — Smart strategy
   ============================================ */
self.addEventListener("fetch", (event) => {
    const request = event.request;

    // শুধু GET request handle করি
    if (request.method !== "GET") return;

    const url = new URL(request.url);

    // 🔹 API request কখনো cache করি না — সবসময় network
    if (url.pathname.startsWith("/api/")) {
        event.respondWith(
            fetch(request).catch(() => {
                return new Response(
                    JSON.stringify({ error: "offline", message: "No internet connection" }),
                    { status: 503, headers: { "Content-Type": "application/json" } }
                );
            })
        );
        return;
    }

    // 🔹 External (CDN, fonts) — network first, fallback cache
    if (url.origin !== self.location.origin) {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
                    return response;
                })
                .catch(() => caches.match(request))
        );
        return;
    }

    // 🔹 HTML pages — network first (সবসময় নতুন version)
    if (request.headers.get("accept")?.includes("text/html")) {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
                    return response;
                })
                .catch(() => caches.match(request).then((r) => r || caches.match("/dashboard.html")))
        );
        return;
    }

    // 🔹 Static assets (images, css, js) — cache first
    event.respondWith(
        caches.match(request).then((cached) => {
            if (cached) return cached;

            return fetch(request).then((response) => {
                // কেবল successful response cache করি
                if (response.status === 200) {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
                }
                return response;
            });
        })
    );
});

/* ============================================
   MESSAGE — Update trigger
   ============================================ */
self.addEventListener("message", (event) => {
    if (event.data === "SKIP_WAITING") {
        self.skipWaiting();
    }
});
