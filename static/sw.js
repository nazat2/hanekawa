const CACHE_NAME = "hanekawa-v1";
const ASSETS = [
    "/",
    "/index.html",
    "/static/style.css",
    "/static/script.js",
    "/static/favicon-96x96.png",
    "/static/favicon.svg",
    "/static/favicon.ico",
    "/static/apple-touch-icon.png",
    "/static/site.webmanifest"
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return Promise.allSettled(
                ASSETS.map(asset => cache.add(asset).catch(err => console.warn("Gagal cache:", asset, err)))
            );
        })
    );
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
            );
        })
    );
    self.clients.claim();
});

self.addEventListener("fetch", (event) => {
    if (event.request.method !== "GET") return;
    if (event.request.url.includes("/api/")) return;

    // Network-first: selalu coba ambil versi TERBARU dari server dulu.
    // Cache cuma dipakai sebagai cadangan kalau offline / server gagal diakses.
    // Ini penting supaya setiap update yang di-deploy langsung kepakai,
    // tidak nyangkut di versi lama seperti strategi cache-first sebelumnya.
    event.respondWith(
        fetch(event.request).then((response) => {
            if (response && response.status === 200 && response.type !== "opaque") {
                const clone = response.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put(event.request, clone).catch(() => {});
                });
            }
            return response;
        }).catch(() => {
            return caches.match(event.request).then((cached) => cached || new Response("Offline", { status: 503 }));
        })
    );
});
