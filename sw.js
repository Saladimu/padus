/* Service Worker Absensi Paduan Suara
   Strategi:
   - Navigation (HTML): network-first, fallback ke cache (offline).
   - Aset statis (CSS, JS, gambar, ikon): cache-first agar akses cepat.
   - Cache diberi versi; saat aktivasi, cache lama dihapus dan varian
     aset app.js/styles.css yang tidak lagi dipakai dibersihkan agar
     cache tetap ramping.
*/
var CACHE_NAME = 'choir-absensi-v7';
var ASSET_VERSION = '20260831o';
var CORE_ASSETS = [
  './',
  './index.html',
  './app.js?v=' + ASSET_VERSION,
  './styles.css?v=' + ASSET_VERSION,
  './Absensi.md',
  './favicon.png',
  './choir-icon-128.png',
  './choir-icon-128.webp'
];
var MAX_ENTRIES = 100;

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function (cache) { return cache.addAll(CORE_ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function (cache) {
        return cache.keys().then(function (keys) {
          return Promise.all(
            keys.filter(function (req) {
              var url = req.url;
              var isAppJs = /\/app\.js(?:\?|$)/.test(url);
              var isStylesCss = /\/styles\.css(?:\?|$)/.test(url);
              var isCurrent = url.indexOf('app.js?v=' + ASSET_VERSION) !== -1 ||
                              url.indexOf('styles.css?v=' + ASSET_VERSION) !== -1;
              return (isAppJs || isStylesCss) && !isCurrent;
            }).map(function (req) { return cache.delete(req); })
          );
        });
      })
      .then(function () {
        return caches.keys().then(function (keys) {
          return Promise.all(
            keys.filter(function (key) { return key !== CACHE_NAME; })
                .map(function (key) { return caches.delete(key); })
          );
        });
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;

  // Navigasi halaman: selalu ambil versi terbaru, fallback cache saat offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).then(function (response) {
        var copy = response.clone();
        caches.open(CACHE_NAME).then(function (cache) {
          cache.put('./index.html', copy);
        });
        return response;
      }).catch(function () {
        return caches.match('./index.html');
      })
    );
    return;
  }

  // Aset statis same-origin: cache-first.
  if (request.url.indexOf(self.location.origin) === 0) {
    event.respondWith(
      caches.match(request).then(function (cached) {
        if (cached) return cached;
        return fetch(request).then(function (response) {
          if (response && response.status === 200 && response.type === 'basic') {
            var copy = response.clone();
            caches.open(CACHE_NAME).then(function (cache) {
              cache.put(request, copy).then(function () {
                trimCache(cache);
              });
            });
          }
          return response;
        });
      })
    );
  }
});

function trimCache(cache) {
  cache.keys().then(function (keys) {
    if (keys.length > MAX_ENTRIES) {
      cache.delete(keys[0]);
    }
  });
}
