// Speichert die App-Dateien, damit sie auch ohne Internet startet.
// Bei Änderungen an der App die Versionsnummer erhöhen.
const CACHE = 'toepferbuch-v23';
const FILES = [
  './',
  'index.html',
  'css/style.css',
  'fonts/patrick-hand.woff2',
  'js/app.js',
  'js/db.js',
  'js/image.js',
  'js/blueprint.js',
  'js/kontur.js',
  'js/erkennung.js',
  'js/formprior.js',
  'js/formen-modell.js',
  'js/kamera.js',
  'js/massband.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Erst aus dem Netz laden (damit Updates ankommen), ohne Netz aus dem Speicher.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    // am Server nachfragen statt den Browser-Zwischenspeicher zu nehmen (sonst bis zu 10 min alt)
    fetch(e.request, { cache: 'no-cache' })
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))),
  );
});
