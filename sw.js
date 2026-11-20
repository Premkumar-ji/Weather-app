const CACHE = "atmos-static-v3";
const ASSETS = ["./", "index.html", "index.css", "index.js", "manifest.json"]
  .map(asset => new URL(asset, self.registration.scope).href);
const APP_SHELL = new URL("index.html", self.registration.scope).href;

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).catch(error => {
    if (event.request.mode === "navigate") return caches.match(APP_SHELL);
    throw error;
  })));
});
