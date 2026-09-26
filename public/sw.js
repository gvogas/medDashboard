// Rounds service worker: network first, cache as the fallback, so the shell opens
// offline and a deploy is picked up on the next load. /api is never cached.

const CACHE_PREFIX = 'rounds-shell-';
const CACHE = CACHE_PREFIX + 'v10';
const SHELL = [
  '/', '/index.html', '/manifest.webmanifest', '/icon.svg',
  '/css/tokens.css', '/css/layout.css', '/css/components.css', '/css/study.css',
  '/js/main.js', '/js/api.js', '/js/db.js', '/js/store.js', '/js/sync.js', '/js/state.js', '/js/model.js',
  '/js/dates.js', '/js/dom.js', '/js/query.js', '/js/ornament.js', '/js/timepicker.js', '/js/fireworks.js', '/js/spotify.js', '/js/web-player.js',
  '/js/timer.js', '/js/focus.js', '/js/grades.js', '/js/reviews.js', '/js/pdftext.js', '/js/prep.js', '/js/importers/ics.js', '/js/importers/csv.js', '/js/importers/plan.js',
  '/js/views/render.js', '/js/views/bits.js', '/js/views/sidebar.js', '/js/views/stats.js', '/js/views/week.js',
  '/js/views/month.js', '/js/views/table.js', '/js/views/drawer-base.js', '/js/views/drawer-item.js',
  '/js/views/drawer-course.js', '/js/views/drawer-settings.js', '/js/views/signin.js', '/js/views/player.js', '/js/views/spotify-view.js', '/js/views/drawer-import.js', '/js/views/study.js', '/js/views/flipclock.js', '/js/views/keys.js', '/js/views/drawer-session.js', '/js/history.js', '/js/views/busy.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname === '/api' || url.pathname.startsWith('/api/')) return;
  const shell = SHELL.includes(url.pathname) && !url.search;
  if (!shell && e.request.mode !== 'navigate') return;
  const fallback = async () => {
    const cache = await caches.open(CACHE);
    return (shell ? await cache.match(e.request) : null)
      || (e.request.mode === 'navigate' ? await cache.match('/index.html') : null);
  };
  e.respondWith(
    (async () => {
      // Release URLs never change. An older open page must keep using its cached
      // modules even after the server has deployed a different release.
      if (shell && url.pathname.startsWith('/releases/')) {
        const cached = await (await caches.open(CACHE)).match(e.request);
        if (cached) return cached;
      }
      return fetch(e.request);
    })()
      .then(async (res) => {
        if (res.status >= 500) return (await fallback()) || res;
        /* Copy it now: once `res` is returned the page reads the body, and a later clone fails. */
        if (shell && res.ok && !res.redirected && !/\b(?:no-store|private)\b/i.test(res.headers.get('cache-control') || '')) {
          const copy = res.clone();
          e.waitUntil(caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {}));
        }
        return res;
      })
      .catch(async () => (await fallback()) || new Response('Offline', { status: 503, headers: { 'content-type': 'text/plain' } })),
  );
});
