// Rounds service worker: network first, cache as the fallback, so the shell opens
// offline and a deploy is picked up on the next load. /api is never cached.

const CACHE_PREFIX = 'rounds-shell-';
// `npm run build` replaces both: CACHE with the release's hash, SHELL with every built
// file (Vite's hashed /assets/*). Under `npm run dev` only these static files are listed.
const CACHE = CACHE_PREFIX + 'dev';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg'];

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
      if (shell && url.pathname.startsWith('/assets/')) {
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
