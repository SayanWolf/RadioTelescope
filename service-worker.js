// Service Worker для RadioTelescope
// Стратегии:
// - stations.json → NetworkFirst (сначала сеть, иначе кэш) — всегда свежий список
// - навигация (index.html) → NetworkFirst с offline fallback
// - статика (CSS, JS, шрифты, иконки, manifest) → CacheFirst (быстро и стабильно)

const CACHE_STATIC = "rt-static-v2";      // статические ресурсы
const CACHE_DYNAMIC = "rt-dynamic-v2";    // сетевые запросы (stations.json, страницы)
const OFFLINE_PAGE = "offline.html";      // страница "нет интернета"

// Ресурсы, которые кэшируются сразу при установке SW
const PRECACHE = [
  "./",
  "./index.html",
  "./stations.json",
  "./manifest.json",
  "./icon-512.png",
  "./offline.html",   // создай этот файл (см. ниже)
];

importScripts('https://storage.googleapis.com/workbox-cdn/releases/5.1.2/workbox-sw.js');

/* ============== SKIP_WAITING ============== */
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

/* ============== INSTALL: pre-cache ключевых файлов ============== */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_STATIC)
      .then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

/* ============== ACTIVATE: чистим старые кэши ============== */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_STATIC && k !== CACHE_DYNAMIC)
            .map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

/* ============== NAVIGATION PRELOAD ============== */
if (workbox.navigationPreload.isSupported()) {
  workbox.navigationPreload.enable();
}

/* ============== СТРАТЕГИИ ============== */

// 1. stations.json — всегда свежий (NetworkFirst)
workbox.routing.registerRoute(
  ({ url }) => url.pathname.endsWith('stations.json'),
  new workbox.strategies.NetworkFirst({
    cacheName: CACHE_DYNAMIC,
    networkTimeoutSeconds: 5,   // если сеть медленная — ждём 5 сек, потом кэш
    plugins: [
      new workbox.expiration.ExpirationPlugin({
        maxEntries: 5,
        maxAgeSeconds: 7 * 24 * 60 * 60,  // храним неделю
      }),
    ],
  })
);

// 2. Навигация (страницы) — NetworkFirst + offline fallback
workbox.routing.registerRoute(
  ({ request }) => request.mode === 'navigate',
  new workbox.strategies.NetworkFirst({
    cacheName: CACHE_DYNAMIC,
    networkTimeoutSeconds: 5,
    plugins: [
      new workbox.expiration.ExpirationPlugin({
        maxEntries: 10,
      }),
    ],
  })
);

// 3. Статика (CSS, JS, шрифты, иконки, manifest) — CacheFirst
workbox.routing.registerRoute(
  ({ request }) =>
    request.destination === 'style' ||
    request.destination === 'script' ||
    request.destination === 'font' ||
    request.destination === 'image' ||
    request.destination === 'manifest',
  new workbox.strategies.CacheFirst({
    cacheName: CACHE_STATIC,
    plugins: [
      new workbox.expiration.ExpirationPlugin({
        maxEntries: 60,
        maxAgeSeconds: 30 * 24 * 60 * 60, // 30 дней
      }),
    ],
  })
);

/* ============== FALLBACK: если ничего не подошло и нет сети ============== */
self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const preloadResp = await event.preloadResponse;
        if (preloadResp) return preloadResp;
        return await fetch(event.request);
      } catch (error) {
        const cache = await caches.open(CACHE_STATIC);
        const cached = await cache.match(OFFLINE_PAGE);
        return cached || new Response('Offline', { status: 503 });
      }
    })());
  }
});
