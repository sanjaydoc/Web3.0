// Web3.0 Console service worker — offline app shell + installability.
// Strategy: precache the shell, then serve same-origin GETs stale-while-revalidate. API traffic
// (the node, a different origin) is never intercepted — it must always hit the live node.
//
// CACHE embeds a per-BUILD id (stamped into this file at build time — see vite.config's
// stampServiceWorker plugin). Because the id changes every release, (a) this file's bytes change so the
// browser detects the SW update and installs it, and (b) `activate` below purges every cache whose name
// isn't the current one — so a returning visitor never gets stuck on a stale shell that points at
// deleted asset hashes (which showed as a blank page). In dev the literal placeholder is fine.
const CACHE = 'web3-console-__BUILD_ID__';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  // Only same-origin GETs are cached; cross-origin (the node API) passes straight through.
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  // SPA navigations: network-first, fall back to the cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('./index.html').then((r) => r || caches.match('./'))),
    );
    return;
  }

  // Static assets: serve from cache immediately, refresh the cache in the background.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          if (res?.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
