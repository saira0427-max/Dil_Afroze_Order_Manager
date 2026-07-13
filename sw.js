/* Dil Afroze Order Manager — service worker (offline app shell caching) */
var CACHE_NAME = 'dil-afroze-v4';
var PRECACHE = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './firebase-config.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(PRECACHE);
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE_NAME; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return; // never intercept sync POSTs etc.

  // Never cache calls to the Apps Script webhook or other cross-origin APIs
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Network-first: always prefer the live version when online (this app
  // changes frequently), only falling back to the cache when offline.
  // A cache-first strategy here meant updates were silently one load
  // behind forever, since the stale cached copy was always served
  // immediately while the network response only updated the cache for
  // "next time."
  // Bypass the browser's own HTTP cache too, not just this service worker's
  // cache -- fetch(req) alone still honours normal HTTP caching semantics,
  // which was letting a stale response slip through even after switching
  // to a network-first strategy.
  event.respondWith(
    fetch(req.url, { cache: 'no-store' }).then(function (res) {
      if (res && res.status === 200) {
        caches.open(CACHE_NAME).then(function (cache) { cache.put(req, res.clone()); });
      }
      return res;
    }).catch(function () {
      return caches.match(req);
    })
  );
});
