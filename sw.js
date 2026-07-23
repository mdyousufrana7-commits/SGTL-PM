// sw.js — minimal service worker: only makes the app "installable" and
// caches the static shell. API calls (/api/*) always go to the network,
// so data is always fresh — this is a live monitoring tool, not an
// offline-first app.
const CACHE = 'solar-epc-shell-v1';
const SHELL = ['/', '/manifest.json', '/icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api/')) return; // never cache API/data
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
