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

// The morning digest (worker/push.js). The push is empty: what it says is fetched here with
// the session cookie, in this device's time zone. A browser must show something for every
// push, so a failed fetch still says that something is due.
self.addEventListener('push', (e) => {
  e.waitUntil((async () => {
    let title = 'Term', body = 'You have things due soon.';
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      const res = await fetch('/api/digest?tz=' + encodeURIComponent(tz), { credentials: 'same-origin', cache: 'no-store' });
      const d = res.ok ? await res.json() : null;
      if (d && typeof d.title === 'string') { title = d.title; body = typeof d.body === 'string' ? d.body : ''; }
    } catch { /* offline or signed out: the plain words */ }
    await self.registration.showNotification(title, { body, icon: '/apple-touch-icon.png', badge: '/apple-touch-icon.png', tag: 'digest', renotify: true, data: { url: '/' } });
  })());
});

// A tap on the digest: back to an open tab of the app, or a new one.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = tabs.find((c) => new URL(c.url).origin === location.origin);
    if (open) return open.focus();
    return self.clients.openWindow(e.notification.data?.url || '/');
  })());
});
