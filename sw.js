/* Talago Arch service worker: offline support + updates.
 * BUILD is replaced with the commit hash on deploy, so every release
 * gets a fresh cache and the app offers an "Update" button. */
const BUILD = '__BUILD__';
const CACHE = 'talago-arch-' + BUILD;
const ASSETS = [
  './', 'index.html', 'styles.css', 'app.js', 'dxf.js', 'schedule.js', 'manifest.webmanifest',
  'fonts/Inter.woff2',
  'icons/icon-192-v2.png', 'icons/icon-512-v2.png', 'icons/maskable-512-v2.png', 'icons/apple-touch-icon-v2.png', 'icons/favicon-64-v2.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('talago-arch-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', e => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(caches.match('index.html').then(r => r || fetch(req)));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(r => r || fetch(req)));
});
