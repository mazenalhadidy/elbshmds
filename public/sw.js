// Service worker: lets the app open instantly and without a connection (where the browser allows it: localhost or https).
// Data requests (/api) are never cached here: the app keeps its own copy of the data.
const CACHE = 'elb-v3';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== CACHE).map(x => caches.delete(x)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api')) return;
  if (e.request.mode === 'navigate') {   // pages: newest when online, stored copy when offline
    e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put('/', c)); return r; }).catch(() => caches.match('/')));
    return;
  }
  // files (scripts, styles, icons): stored copy first (their names change with every version)
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); } return r; })));
});
