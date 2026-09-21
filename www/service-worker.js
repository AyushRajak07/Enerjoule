// App-shell service worker. Everything needed to open and use the dashboard
// is cached on install, so the app opens and works with no network at all
// after the first successful load.

const CACHE_VERSION = "smart-energy-v2";
const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/reset.css",
  "./css/variables.css",
  "./css/layout.css",
  "./css/components.css",
  "./css/dashboard.css",
  "./css/devices.css",
  "./css/boards.css",
  "./css/responsive.css",
  "./js/app.js",
  "./js/storage.js",
  "./js/idb.js",
  "./js/bluetooth.js",
  "./js/demo.js",
  "./js/energy.js",
  "./js/devices.js",
  "./js/boards.js",
  "./js/settings.js",
  "./js/activity.js",
  "./js/ui.js",
  "./data/devices.json",
  "./data/boards.json",
  "./data/default-settings.json",
  "./assets/icons/icon.svg",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
      .catch((err) => console.warn("Precache failed:", err))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // The native bridge is provided by the app container; never cache or intercept it.
  if (url.pathname.endsWith("/capacitor.js") || url.pathname.includes("/_capacitor_") || url.pathname.endsWith("/cordova.js")) return;

  // Navigations: try network first (to pick up updates), fall back to cached shell.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put("./index.html", copy));
          return res;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  // Everything else: cache-first, update cache in background, fall back gracefully.
  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((res) => {
          if (res && res.status === 200 && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});
