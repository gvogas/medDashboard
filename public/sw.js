// Rounds service worker: network first, cache as the fallback, so the shell opens
// offline and a deploy is picked up on the next load. /api is never cached.

const CACHE = 'rounds-shell-v8';
const SHELL = [
  '/', '/index.html', '/manifest.webmanifest', '/icon.svg',
  '/css/tokens.css', '/css/layout.css', '/css/components.css',
  '/js/main.js', '/js/api.js', '/js/db.js', '/js/store.js', '/js/sync.js', '/js/state.js', '/js/model.js',
  '/js/dates.js', '/js/dom.js', '/js/query.js', '/js/ornament.js', '/js/timepicker.js', '/js/fireworks.js', '/js/spotify.js', '/js/web-player.js',
  '/js/views/render.js', '/js/views/bits.js', '/js/views/sidebar.js', '/js/views/stats.js', '/js/views/week.js',
  '/js/views/month.js', '/js/views/table.js', '/js/views/drawer-base.js', '/js/views/drawer-item.js',
  '/js/views/drawer-course.js', '/js/views/drawer-settings.js', '/js/views/signin.js', '/js/views/player.js', '/js/views/spotify-view.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        /* Copy it now: once `res` is returned the page reads the body, and a later clone fails. */
        if (res.ok) {
          const copy = res.clone();
          e.waitUntil(caches.open(CACHE).then((c) => c.put(e.request, copy)));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || (e.request.mode === 'navigate' ? caches.match('/index.html') : undefined))),
  );
});
