/* Service Worker Absensi Paduan Suara
   Strategi:
    - Navigation (HTML): cache-first, jangan timpa cache sampai Hard Refresh.
   - Aset statis same-origin (CSS, JS, gambar, ikon): cache-first agar akses cepat.
   - Font Google (lintas-origin): stale-while-revalidate agar muat berikutnya instan.
   - Cache diberi versi; saat aktivasi, cache lama dihapus dan varian
     aset app.js/styles.css yang tidak lagi dipakai dibersihkan agar
     cache tetap ramping.
*/
var CACHE_NAME = 'choir-absensi-v109';
var ASSET_VERSION = '20260928m';
var CORE_ASSETS = [
  './',
  './app.js?v=' + ASSET_VERSION,
  './config.js?v=' + ASSET_VERSION,
  './styles.css?v=' + ASSET_VERSION,
  './Absensi.md',
  './qrpadus.png',
  './favicon.png',
  './choir-icon-128.png',
  './choir-icon-128.webp'
];
var MAX_ENTRIES = 100;

// Cloudflare Pages (dan host statis lain) sering mengalihkan /index.html -> /.
// Respons hasil redirect TIDAK boleh dipakai untuk navigasi (Chrome menolaknya
// sebagai "site can't be reached"), jadi kita netralkan flag redirect-nya.
function cleanResponse(response) {
  if (!response || !response.redirected) return response;
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  });
}

function precache(cache, url) {
  return fetch(url, { redirect: 'follow' }).then(function (response) {
    if (!response || response.status !== 200) return;
    return cache.put(url, cleanResponse(response));
  }).catch(function () {});
}

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return Promise.all(CORE_ASSETS.map(function (url) {
        return precache(cache, url);
      }));
    })
  );
});

self.addEventListener('message', function (event) {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
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
              var isConfigJs = /\/config\.js(?:\?|$)/.test(url);
              var isCurrent = url.indexOf('app.js?v=' + ASSET_VERSION) !== -1 ||
                              url.indexOf('styles.css?v=' + ASSET_VERSION) !== -1 ||
                              url.indexOf('config.js?v=' + ASSET_VERSION) !== -1;
              return (isAppJs || isStylesCss || isConfigJs) && !isCurrent;
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
  if (/\/sw\.js(?:\?|$)/.test(request.url)) return;
  if (request.url.indexOf('update-check=') !== -1) return;
  if (request.cache === 'no-store' || request.cache === 'reload') {
    var followRequest = new Request(request, { redirect: 'follow' });
    event.respondWith(
      fetch(followRequest, { cache: 'no-store' }).then(cleanResponse).catch(function () {
        return fetch(event.request);
      })
    );
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match('./').then(function (cached) {
        if (cached) return cached;
        var followNavRequest = new Request(request, { redirect: 'follow' });
        return fetch(followNavRequest).then(function (response) {
          var clean = cleanResponse(response);
          if (clean && clean.status === 200) {
            var copy = clean.clone();
            caches.open(CACHE_NAME).then(function (cache) {
              cache.put('./', copy);
            });
          }
          if (clean) return clean;
          return fetch(event.request);
        }).catch(function () {
          return caches.match('./').then(function (cachedNav) {
            return cachedNav || fetch(event.request);
          });
        });
      })
    );
    return;
  }

  // Font Google lintas-origin: stale-while-revalidate.
  if (request.url.indexOf('https://fonts.googleapis.com') === 0 ||
      request.url.indexOf('https://fonts.gstatic.com') === 0) {
    event.respondWith(
      caches.match(request).then(function (cached) {
        var network = fetch(request).then(function (response) {
          if (response && (response.status === 200 || response.type === 'opaque')) {
            var copy = response.clone();
            caches.open(CACHE_NAME).then(function (cache) {
              cache.put(request, copy);
            });
          }
          return response;
        }).catch(function () { return cached; });
        return cached || network;
      })
    );
    return;
  }

  // config.js: network-first agar URL default yang diubah admin langsung
  // terpakai di semua perangkat; fallback ke cache saat offline.
  if (/\/config\.js(?:\?|$)/.test(request.url)) {
    event.respondWith(
      fetch(request, { cache: 'no-store' }).then(function (response) {
        if (response && response.status === 200) {
          var copy = response.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(request, copy);
          });
        }
        return response;
      }).catch(function () {
        return caches.match(request);
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
          if (response && response.status === 200 &&
              (response.type === 'basic' || response.type === 'cors')) {
            var copy = response.clone();
            caches.open(CACHE_NAME).then(function (cache) {
              cache.put(request, copy).then(function () {
                trimCache(cache);
              });
            });
          }
          if (response) return response;
          return fetch(event.request);
        });
      }).catch(function () {
        return fetch(event.request);
      })
    );
    return;
  }
});

function trimCache(cache) {
  cache.keys().then(function (keys) {
    if (keys.length > MAX_ENTRIES) {
      cache.delete(keys[0]);
    }
  });
}
