# Spotify player Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A strip at the bottom of the sidebar showing what is playing on the signed-in user's Spotify, with previous, play/pause and next, connected per user from Settings.

**Architecture:** The Worker holds each user's Spotify tokens in D1 (refresh token AES-GCM encrypted under a key derived from `SESSION_SECRET`) and proxies every Spotify call through five routes under `/api/spotify`. The browser polls `GET /api/spotify/player` (5 s playing, 20 s idle) and draws the strip; it never talks to Spotify. Tests run against a fake Spotify wired in as the Miniflare outbound service.

**Tech Stack:** Cloudflare Workers + D1, Web Crypto (HKDF, AES-GCM), vanilla ES modules in `public/js`, vitest with `@cloudflare/vitest-pool-workers`.

Spec: `docs/superpowers/specs/2026-09-22-spotify-player-design.md`.

---

## File map

| File | Does |
| --- | --- |
| `migrations/0004_spotify.sql` (new) | `spotify_tokens` table |
| `worker/db.js` | `getSpotifyTokens`, `saveSpotifyTokens`, `deleteSpotifyTokens` |
| `worker/spotify.js` (new) | encryption, OAuth token calls, token freshness, player state, controls |
| `worker/auth.js` | export `parseCookies`, `secureFlag`, `hex` |
| `worker/api.js` | the five routes |
| `test/spotify-stub.js` (new) | fake accounts.spotify.com and api.spotify.com |
| `test/spotify.test.js` (new) | Worker tests |
| `test/spotify-player.test.js` (new) | `nextDelayMs`, `previousAction` |
| `vitest.config.js` | test client id/secret, outbound stub |
| `wrangler.jsonc`, `.dev.vars.example` (new), `.gitignore` | config |
| `public/js/spotify.js` (new) | the poller |
| `public/js/views/player.js` (new) | the strip |
| `public/js/api.js`, `main.js`, `state.js`, `views/drawer-base.js`, `views/drawer-settings.js` | wiring and the Settings group |
| `public/index.html`, `css/layout.css`, `css/components.css`, `_headers`, `sw.js` | container, styles, CSP, shell cache |
| `README.md`, `PLAN.md`, `docs/DATA-MODEL.md`, `docs/DEPLOYING.md` | docs |

---

### Task 1: Config and schema

**Files:**
- Create: `migrations/0004_spotify.sql`, `.dev.vars.example`, `test/spotify-stub.js`
- Modify: `wrangler.jsonc`, `vitest.config.js`, `.gitignore`

- [ ] **Step 1: Migration**

`migrations/0004_spotify.sql`:

```sql
-- One Spotify connection per user. The refresh token is AES-GCM ciphertext under a
-- key derived from SESSION_SECRET (see worker/spotify.js); the access token lives
-- an hour and is kept in clear.

CREATE TABLE spotify_tokens (
  user_id        TEXT PRIMARY KEY REFERENCES users(id),
  refresh_token  TEXT NOT NULL,     -- base64(iv ‖ ciphertext)
  access_token   TEXT NOT NULL,
  expires_at     INTEGER NOT NULL,  -- ms since epoch
  updated_at     INTEGER NOT NULL
);
```

- [ ] **Step 2: `wrangler.jsonc`** — add after `"preview_urls": false,`:

```jsonc
  // Spotify's public client id. The secret is `wrangler secret put SPOTIFY_CLIENT_SECRET`.
  "vars": { "SPOTIFY_CLIENT_ID": "62b89b6543c947e194605aaa91ecce85" },
```

- [ ] **Step 3: `.dev.vars.example`** and un-ignore it (`.gitignore` ignores `.dev.vars.*`; add `!.dev.vars.example` below that line):

```
# Copy to .dev.vars (git-ignored) for `npm run dev`.
SESSION_SECRET=any-long-random-string
# From the Spotify app's settings at developer.spotify.com. Without them the connect
# route answers 503. Open the dev server at http://127.0.0.1:8787, not localhost:
# Spotify only accepts the 127.0.0.1 redirect.
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
```

- [ ] **Step 4: `test/spotify-stub.js`** — the fake Spotify:

```js
// A fake Spotify for the tests. The Worker's outbound fetches land here (see
// vitest.config.js). Behaviour is chosen by the bearer token or the posted code, so a
// test picks its case by what it seeds. Any other host is refused: tests never touch
// the network.

const BASIC = 'Basic ' + btoa('test-client:test-secret');

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const track = (playing) => ({
  is_playing: playing,
  progress_ms: 42000,
  currently_playing_type: 'track',
  device: { name: 'Laptop', is_active: true },
  item: {
    name: 'Everlong',
    duration_ms: 250000,
    artists: [{ name: 'Foo Fighters' }],
    album: {
      name: 'The Colour and the Shape',
      images: [
        { url: 'https://i.scdn.co/image/640', width: 640, height: 640 },
        { url: 'https://i.scdn.co/image/300', width: 300, height: 300 },
        { url: 'https://i.scdn.co/image/64', width: 64, height: 64 },
      ],
    },
    external_urls: { spotify: 'https://open.spotify.com/track/abc' },
  },
});

// A control sent with the wrong method or path gets a 405, so a mismapping fails.
const CONTROLS = new Set([
  'PUT /v1/me/player/play', 'PUT /v1/me/player/pause', 'POST /v1/me/player/next',
  'POST /v1/me/player/previous', 'PUT /v1/me/player/seek',
]);

async function accounts(request, url) {
  if (request.method !== 'POST' || url.pathname !== '/api/token') return new Response('not found', { status: 404 });
  if (request.headers.get('authorization') !== BASIC) return json({ error: 'invalid_client' }, 401);
  const form = new URLSearchParams(await request.text());
  if (form.get('grant_type') === 'authorization_code') {
    if (form.get('code') !== 'good') return json({ error: 'invalid_grant' }, 400);
    return json({ access_token: 'tok-playing', refresh_token: 'refresh-good', expires_in: 3600, token_type: 'Bearer' });
  }
  if (form.get('grant_type') === 'refresh_token') {
    if (form.get('refresh_token') === 'revoked') return json({ error: 'invalid_grant', error_description: 'Refresh token revoked' }, 400);
    return json({ access_token: 'tok-refreshed', expires_in: 3600, token_type: 'Bearer' });
  }
  return json({ error: 'unsupported_grant_type' }, 400);
}

function webApi(request, url) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer /, '');
  if (token === 'tok-expired') return json({ error: { status: 401, message: 'The access token expired' } }, 401);
  if (token === 'tok-down') return new Response('unavailable', { status: 503 });
  if (token === 'tok-limited') return new Response(null, { status: 429, headers: { 'retry-after': '7' } });
  if (request.method === 'GET' && url.pathname === '/v1/me/player') {
    if (token === 'tok-idle') return new Response(null, { status: 204 });
    return json(track(token !== 'tok-paused'));
  }
  const route = `${request.method} ${url.pathname}`;
  if (!CONTROLS.has(route)) return new Response('wrong method or path: ' + route, { status: 405 });
  if (url.pathname.endsWith('/seek') && url.searchParams.get('position_ms') !== '0') return new Response('bad seek', { status: 400 });
  if (token === 'tok-nodevice') return json({ error: { status: 404, reason: 'NO_ACTIVE_DEVICE' } }, 404);
  if (token === 'tok-free') return json({ error: { status: 403, reason: 'PREMIUM_REQUIRED' } }, 403);
  return new Response(null, { status: 204 });
}

export async function spotifyStub(request) {
  const url = new URL(request.url);
  if (url.host === 'accounts.spotify.com') return accounts(request, url);
  if (url.host === 'api.spotify.com') return webApi(request, url);
  return new Response('outbound fetch blocked in tests: ' + request.url, { status: 502 });
}
```

- [ ] **Step 5: `vitest.config.js`** — import the stub, add bindings, replace the outbound service:

```js
import { spotifyStub } from './test/spotify-stub.js';
...
          bindings: {
            TEST_MIGRATIONS: migrations,
            SESSION_SECRET: 'test-secret-not-for-production',
            SPOTIFY_CLIENT_ID: 'test-client',
            SPOTIFY_CLIENT_SECRET: 'test-secret',
          },
          // The only outbound calls are to Spotify, answered by a fake; anything else is refused.
          outboundService: spotifyStub,
```

- [ ] **Step 6: Run** `npx vitest run` — expected: 53 passed (migration applies, nothing else changed).

- [ ] **Step 7: Commit** — `git add migrations/0004_spotify.sql wrangler.jsonc vitest.config.js .gitignore .dev.vars.example test/spotify-stub.js && git commit -m "Spotify: schema, config and a fake Spotify for tests"`

---

### Task 2: Token storage and encryption

**Files:**
- Modify: `worker/db.js`, `worker/auth.js`
- Create: `worker/spotify.js` (encryption part), `test/spotify.test.js`

- [ ] **Step 1: Failing tests** — `test/spotify.test.js`:

```js
import { SELF, env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../worker/index.js';
import { BASE, createUser, login } from './helpers.js';
import { encryptToken, decryptToken } from '../worker/spotify.js';
import { getSpotifyTokens, saveSpotifyTokens, deleteSpotifyTokens } from '../worker/db.js';

let n = 0;

/** A fresh user and their session cookie. */
async function session() {
  const username = `sp${++n}`;
  const userId = await createUser(username);
  const res = await login(username);
  return { userId, cookie: res.headers.get('set-cookie').split(';')[0] };
}

/** A request that does not follow redirects, so a test can read them. */
function get(path, cookie, init = {}) {
  return SELF.fetch(`${BASE}${path}`, {
    redirect: 'manual',
    ...init,
    headers: { ...(cookie ? { cookie } : {}), ...(init.headers || {}) },
  });
}

/** Store a token row directly, the way the callback would. */
async function seed(userId, { access = 'tok-playing', refresh = 'refresh-good', expiresAt = Date.now() + 3600_000 } = {}) {
  await saveSpotifyTokens(env.DB, userId, { refreshToken: await encryptToken(env, refresh), accessToken: access, expiresAt });
}

describe('token encryption', () => {
  it('round-trips and never contains the plaintext', async () => {
    const stored = await encryptToken(env, 'refresh-good');
    expect(stored).not.toContain('refresh-good');
    expect(await decryptToken(env, stored)).toBe('refresh-good');
  });

  it('encrypts the same token differently each time', async () => {
    expect(await encryptToken(env, 'x')).not.toBe(await encryptToken(env, 'x'));
  });

  it('cannot be read under another SESSION_SECRET', async () => {
    const stored = await encryptToken(env, 'x');
    await expect(decryptToken({ ...env, SESSION_SECRET: 'rotated' }, stored)).rejects.toThrow();
  });
});

describe('token rows', () => {
  it('save, read and delete are scoped to the user', async () => {
    const a = await createUser('rowa'), b = await createUser('rowb');
    await saveSpotifyTokens(env.DB, a, { refreshToken: 'enc', accessToken: 'acc', expiresAt: 5 });
    expect(await getSpotifyTokens(env.DB, a)).toEqual({ refreshToken: 'enc', accessToken: 'acc', expiresAt: 5 });
    expect(await getSpotifyTokens(env.DB, b)).toBeNull();
    await saveSpotifyTokens(env.DB, a, { refreshToken: 'enc2', accessToken: 'acc2', expiresAt: 6 });
    expect((await getSpotifyTokens(env.DB, a)).accessToken).toBe('acc2');
    await deleteSpotifyTokens(env.DB, b);
    expect(await getSpotifyTokens(env.DB, a)).not.toBeNull();
    await deleteSpotifyTokens(env.DB, a);
    expect(await getSpotifyTokens(env.DB, a)).toBeNull();
  });
});
```

- [ ] **Step 2: Run** `npx vitest run test/spotify.test.js` — expected: FAIL, `worker/spotify.js` not found.

- [ ] **Step 3: Queries** — append to `worker/db.js`:

```js
// ── Spotify: one connection per user; see worker/spotify.js ────────────────

export async function getSpotifyTokens(db, userId) {
  const r = await db.prepare('SELECT refresh_token, access_token, expires_at FROM spotify_tokens WHERE user_id = ?').bind(userId).first();
  return r ? { refreshToken: r.refresh_token, accessToken: r.access_token, expiresAt: r.expires_at } : null;
}

/** `refreshToken` arrives already encrypted. */
export async function saveSpotifyTokens(db, userId, t, now = Date.now()) {
  await db
    .prepare(
      `INSERT INTO spotify_tokens (user_id, refresh_token, access_token, expires_at, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET refresh_token = excluded.refresh_token, access_token = excluded.access_token,
         expires_at = excluded.expires_at, updated_at = excluded.updated_at`,
    )
    .bind(userId, t.refreshToken, t.accessToken, t.expiresAt, now)
    .run();
}

export async function deleteSpotifyTokens(db, userId) {
  await db.prepare('DELETE FROM spotify_tokens WHERE user_id = ?').bind(userId).run();
}
```

- [ ] **Step 4: `worker/spotify.js`, encryption** (the rest is added in Tasks 3–5):

```js
// Spotify, on behalf of one signed-in user. The browser never talks to Spotify: the
// Worker holds each user's tokens and makes every call. The refresh token is encrypted
// at rest under a key derived from SESSION_SECRET, so rotating that secret disconnects
// everyone, the way it signs everyone out.

import { HttpError } from './http.js';
import { getSpotifyTokens, saveSpotifyTokens, deleteSpotifyTokens } from './db.js';

async function tokenKey(env) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.SESSION_SECRET), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: new TextEncoder().encode('spotify-refresh') },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** base64(iv ‖ ciphertext), a fresh iv every time. */
export async function encryptToken(env, plain) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await tokenKey(env), new TextEncoder().encode(plain)));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return btoa(String.fromCharCode(...out));
}

/** Throws if the ciphertext was made under another secret or was altered. */
export async function decryptToken(env, stored) {
  const bytes = Uint8Array.from(atob(stored), (c) => c.charCodeAt(0));
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, await tokenKey(env), bytes.slice(12));
  return new TextDecoder().decode(plain);
}
```

- [ ] **Step 5: `worker/auth.js`** — export three helpers the routes need: change `function hex(`, `function parseCookies(` and `function secureFlag(` to `export function ...`.

- [ ] **Step 6: Run** `npx vitest run test/spotify.test.js` — expected: 4 passed.

- [ ] **Step 7: Commit** — `git commit -am "Spotify: encrypted token storage"` (add the new files first).

---

### Task 3: Connect and callback

**Files:** Modify `worker/spotify.js`, `worker/api.js`, `test/spotify.test.js`

- [ ] **Step 1: Failing tests** — append to `test/spotify.test.js`:

```js
describe('connect', () => {
  it('needs a session', async () => {
    expect((await get('/api/spotify/connect')).status).toBe(401);
  });

  it('sends you to Spotify with a state that matches the cookie', async () => {
    const { cookie } = await session();
    const res = await get('/api/spotify/connect', cookie);
    expect(res.status).toBe(302);
    const to = new URL(res.headers.get('location'));
    expect(to.origin + to.pathname).toBe('https://accounts.spotify.com/authorize');
    expect(to.searchParams.get('client_id')).toBe('test-client');
    expect(to.searchParams.get('response_type')).toBe('code');
    expect(to.searchParams.get('redirect_uri')).toBe(`${BASE}/api/spotify/callback`);
    expect(to.searchParams.get('scope')).toBe('user-read-playback-state user-modify-playback-state');
    const state = to.searchParams.get('state');
    expect(state).toMatch(/^[0-9a-f]{32}$/);
    const set = res.headers.get('set-cookie');
    expect(set).toContain(`rounds_spotify_state=${state};`);
    expect(set).toMatch(/HttpOnly/);
    expect(set).toMatch(/SameSite=Lax/);
    expect(set).toMatch(/Max-Age=600/);
  });

  it('is 503 when Spotify is not configured', async () => {
    const { cookie } = await session();
    const res = await worker.fetch(new Request(`${BASE}/api/spotify/connect`, { headers: { cookie } }), { ...env, SPOTIFY_CLIENT_SECRET: '' });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'spotify_not_configured' });
  });
});

describe('callback', () => {
  const callback = (query, cookie) => get(`/api/spotify/callback?${query}`, cookie);

  it('stores encrypted tokens for a good code and goes back to the app', async () => {
    const { userId, cookie } = await session();
    const res = await callback('code=good&state=s1', `${cookie}; rounds_spotify_state=s1`);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`${BASE}/#spotify=connected`);
    expect(res.headers.get('set-cookie')).toMatch(/rounds_spotify_state=;.*Max-Age=0/);
    const row = await getSpotifyTokens(env.DB, userId);
    expect(row.accessToken).toBe('tok-playing');
    expect(row.refreshToken).not.toBe('refresh-good');
    expect(await decryptToken(env, row.refreshToken)).toBe('refresh-good');
    expect(row.expiresAt).toBeGreaterThan(Date.now());
  });

  for (const [name, query, stateCookie] of [
    ['a state that does not match', 'code=good&state=s1', 'rounds_spotify_state=s2'],
    ['no state cookie', 'code=good&state=s1', ''],
    ['no state in the query', 'code=good', 'rounds_spotify_state=s1'],
    ['Spotify saying no', 'error=access_denied&state=s1', 'rounds_spotify_state=s1'],
    ['a code Spotify refuses', 'code=bad&state=s1', 'rounds_spotify_state=s1'],
  ]) {
    it(`goes back with an error and stores nothing for ${name}`, async () => {
      const { userId, cookie } = await session();
      const res = await callback(query, stateCookie ? `${cookie}; ${stateCookie}` : cookie);
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe(`${BASE}/#spotify=error`);
      expect(await getSpotifyTokens(env.DB, userId)).toBeNull();
    });
  }

  it('goes back with an error without a session', async () => {
    const res = await callback('code=good&state=s1', 'rounds_spotify_state=s1');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`${BASE}/#spotify=error`);
  });
});
```

- [ ] **Step 2: Run** — expected: the new tests FAIL (404 not_found).

- [ ] **Step 3: OAuth in `worker/spotify.js`** — append:

```js
const ACCOUNTS = 'https://accounts.spotify.com';
export const SCOPES = 'user-read-playback-state user-modify-playback-state';

const notConnected = () => new HttpError(409, { error: 'not_connected' });
const unavailable = () => new HttpError(502, { error: 'spotify_unavailable' });

export function isConfigured(env) {
  return Boolean(env.SPOTIFY_CLIENT_ID && env.SPOTIFY_CLIENT_SECRET);
}

export function authorizeUrl(env, redirectUri, state) {
  const q = new URLSearchParams({ client_id: env.SPOTIFY_CLIENT_ID, response_type: 'code', redirect_uri: redirectUri, scope: SCOPES, state });
  return `${ACCOUNTS}/authorize?${q}`;
}

/** POST to Spotify's token endpoint. Resolves to {status, body}; a network failure is a 502. */
async function tokenRequest(env, params) {
  let res;
  try {
    res = await fetch(`${ACCOUNTS}/api/token`, {
      method: 'POST',
      headers: {
        authorization: 'Basic ' + btoa(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`),
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(params),
    });
  } catch {
    throw unavailable();
  }
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

function tokensFrom(body, now) {
  return { accessToken: body.access_token, refreshToken: body.refresh_token, expiresAt: now + body.expires_in * 1000 };
}

/** Trade the callback's code for tokens. Throws on any refusal. */
export async function exchangeCode(env, code, redirectUri, now = Date.now()) {
  const { status, body } = await tokenRequest(env, { grant_type: 'authorization_code', code, redirect_uri: redirectUri });
  if (status !== 200 || !body.access_token || !body.refresh_token) throw new Error(`Spotify refused the code (${status})`);
  return tokensFrom(body, now);
}

/** Store tokens, encrypting the refresh token. */
export async function storeTokens(env, userId, t, now = Date.now()) {
  const refreshToken = await encryptToken(env, t.refreshToken);
  await saveSpotifyTokens(env.DB, userId, { refreshToken, accessToken: t.accessToken, expiresAt: t.expiresAt }, now);
}
```

- [ ] **Step 4: Routes in `worker/api.js`**

Imports: add `parseCookies, secureFlag, hex` to the `./auth.js` import; add `deleteSpotifyTokens` to the `./db.js` import; add `import * as spotify from './spotify.js';`.

Before `const ROW = ...`:

```js
// ── Spotify: the OAuth round trip. The state cookie is its CSRF guard. ──
const SPOTIFY_STATE = 'rounds_spotify_state';

function spotifyStateCookie(value, url, maxAge) {
  return `${SPOTIFY_STATE}=${value}; Path=/api/spotify; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureFlag(url)}`;
}

/** Back to the app, with the result in the hash. The callback is a navigation, so never JSON. */
function backToApp(url, result) {
  return new Response(null, {
    status: 302,
    headers: { location: `${url.origin}/#spotify=${result}`, 'set-cookie': spotifyStateCookie('', url, 0) },
  });
}

async function spotifyCallback({ request, env, url }) {
  let userId;
  try {
    userId = await requireUser(request, env);
  } catch {
    return backToApp(url, 'error');
  }
  const expected = parseCookies(request.headers.get('cookie'))[SPOTIFY_STATE];
  const code = url.searchParams.get('code');
  if (!expected || url.searchParams.get('state') !== expected || url.searchParams.has('error') || !code) {
    return backToApp(url, 'error');
  }
  try {
    await spotify.storeTokens(env, userId, await spotify.exchangeCode(env, code, `${url.origin}/api/spotify/callback`));
  } catch (e) {
    console.error('spotify callback', e);
    return backToApp(url, 'error');
  }
  return backToApp(url, 'connected');
}
```

In `routes`, after the `ROW` entries:

```js
  // Spotify, proxied: see worker/spotify.js.
  ['GET', /^\/api\/spotify\/connect$/, async ({ request, env, url }) => {
    await requireUser(request, env);
    if (!spotify.isConfigured(env)) throw new HttpError(503, { error: 'spotify_not_configured' });
    const state = hex(crypto.getRandomValues(new Uint8Array(16)));
    return new Response(null, {
      status: 302,
      headers: {
        location: spotify.authorizeUrl(env, `${url.origin}/api/spotify/callback`, state),
        'set-cookie': spotifyStateCookie(state, url, 600),
      },
    });
  }],
  ['GET', /^\/api\/spotify\/callback$/, spotifyCallback],
```

- [ ] **Step 5: Run** `npx vitest run test/spotify.test.js` — expected: 14 passed.

- [ ] **Step 6: Commit** — `git commit -am "Spotify: connect and callback routes"`

---

### Task 4: Player state

**Files:** Modify `worker/spotify.js`, `worker/api.js`, `test/spotify.test.js`

- [ ] **Step 1: Failing tests** — append:

```js
async function player(cookie) {
  const res = await get('/api/spotify/player', cookie);
  return { status: res.status, headers: res.headers, body: await res.json() };
}

const EVERLONG = {
  title: 'Everlong',
  artists: 'Foo Fighters',
  album: 'The Colour and the Shape',
  art: 'https://i.scdn.co/image/300',
  url: 'https://open.spotify.com/track/abc',
  durationMs: 250000,
  progressMs: 42000,
};

describe('player', () => {
  it('is not connected without a row', async () => {
    const { cookie } = await session();
    expect(await player(cookie)).toMatchObject({ status: 200, body: { connected: false } });
  });

  it('maps a playing track', async () => {
    const { userId, cookie } = await session();
    await seed(userId);
    expect((await player(cookie)).body).toEqual({ connected: true, playing: true, device: 'Laptop', track: EVERLONG });
  });

  it('maps a paused track', async () => {
    const { userId, cookie } = await session();
    await seed(userId, { access: 'tok-paused' });
    expect((await player(cookie)).body).toEqual({ connected: true, playing: false, device: 'Laptop', track: EVERLONG });
  });

  it('is idle when Spotify has nothing playing', async () => {
    const { userId, cookie } = await session();
    await seed(userId, { access: 'tok-idle' });
    expect((await player(cookie)).body).toEqual({ connected: true, playing: false, track: null, device: null });
  });

  it('refreshes an access token about to expire, and stores the new one', async () => {
    const { userId, cookie } = await session();
    await seed(userId, { access: 'tok-expired', expiresAt: Date.now() + 30_000 });
    expect((await player(cookie)).body.track).toEqual(EVERLONG);
    const row = await getSpotifyTokens(env.DB, userId);
    expect(row.accessToken).toBe('tok-refreshed');
    expect(await decryptToken(env, row.refreshToken)).toBe('refresh-good');
  });

  it('refreshes once when Spotify turns the token down', async () => {
    const { userId, cookie } = await session();
    await seed(userId, { access: 'tok-expired' });
    expect((await player(cookie)).body.track).toEqual(EVERLONG);
    expect((await getSpotifyTokens(env.DB, userId)).accessToken).toBe('tok-refreshed');
  });

  it('forgets a revoked connection', async () => {
    const { userId, cookie } = await session();
    await seed(userId, { access: 'tok-expired', refresh: 'revoked', expiresAt: 0 });
    expect((await player(cookie)).body).toEqual({ connected: false });
    expect(await getSpotifyTokens(env.DB, userId)).toBeNull();
  });

  it('says Spotify is unavailable when it is down', async () => {
    const { userId, cookie } = await session();
    await seed(userId, { access: 'tok-down' });
    expect(await player(cookie)).toMatchObject({ status: 502, body: { error: 'spotify_unavailable' } });
  });

  it('passes a rate limit through', async () => {
    const { userId, cookie } = await session();
    await seed(userId, { access: 'tok-limited' });
    const res = await player(cookie);
    expect(res).toMatchObject({ status: 429, body: { error: 'rate_limited', retryAfter: 7 } });
    expect(res.headers.get('retry-after')).toBe('7');
  });
});
```

- [ ] **Step 2: Run** — expected: new tests FAIL (404).

- [ ] **Step 3: `worker/spotify.js`** — append:

```js
const API = 'https://api.spotify.com/v1';
const REFRESH_WITHIN_MS = 60 * 1000;

/** A new access token. A revoked refresh token is not_connected; Spotify may send a new refresh token too. */
export async function refreshAccessToken(env, refreshToken, now = Date.now()) {
  const { status, body } = await tokenRequest(env, { grant_type: 'refresh_token', refresh_token: refreshToken });
  if (status === 400 && body.error === 'invalid_grant') throw notConnected();
  if (status !== 200 || !body.access_token) throw unavailable();
  return tokensFrom(body, now);
}

/** A usable access token for this user; `force` refreshes even one that looks fresh. */
export async function freshAccessToken(env, userId, force = false, now = Date.now()) {
  const row = await getSpotifyTokens(env.DB, userId);
  if (!row) throw notConnected();
  if (!force && row.expiresAt - now > REFRESH_WITHIN_MS) return row.accessToken;
  let refreshToken;
  try {
    refreshToken = await decryptToken(env, row.refreshToken);
  } catch {
    await deleteSpotifyTokens(env.DB, userId);   // SESSION_SECRET was rotated
    throw notConnected();
  }
  let t;
  try {
    t = await refreshAccessToken(env, refreshToken, now);
  } catch (e) {
    if (e instanceof HttpError && e.status === 409) await deleteSpotifyTokens(env.DB, userId);
    throw e;
  }
  await storeTokens(env, userId, { ...t, refreshToken: t.refreshToken || refreshToken }, now);
  return t.accessToken;
}

/** One Web API call as this user, refreshing and retrying once on a 401. */
async function call(env, userId, method, path) {
  const send = async (token) => {
    try {
      return await fetch(API + path, {
        method,
        headers: { authorization: `Bearer ${token}` },
        body: method === 'GET' ? undefined : '',
      });
    } catch {
      throw unavailable();
    }
  };
  let res = await send(await freshAccessToken(env, userId));
  if (res.status === 401) res = await send(await freshAccessToken(env, userId, true));
  return res;
}

/** A rate limit passes through with its wait; anything else unexpected is Spotify's trouble. */
function failure(res) {
  if (res.status === 429) {
    const wait = Number(res.headers.get('retry-after')) || 30;
    return new HttpError(429, { error: 'rate_limited', retryAfter: wait }, { 'retry-after': String(wait) });
  }
  return unavailable();
}

function artOf(images = []) {
  const img = images.find((i) => i.width === 300) || images[0];
  return img ? img.url : null;
}

/** What is playing, in the compact shape the strip draws. */
export async function playerState(env, userId) {
  const res = await call(env, userId, 'GET', '/me/player');
  if (res.status === 204) return { connected: true, playing: false, track: null, device: null };
  if (res.status !== 200) throw failure(res);
  const p = await res.json();
  const it = p.item;
  return {
    connected: true,
    playing: Boolean(p.is_playing),
    device: p.device?.name ?? null,
    track: it
      ? {
          title: it.name,
          artists: (it.artists || []).map((a) => a.name).join(', ') || it.show?.name || '',
          album: it.album?.name || it.show?.name || '',
          art: artOf(it.album?.images || it.images),
          url: it.external_urls?.spotify || null,
          durationMs: it.duration_ms,
          progressMs: p.progress_ms ?? 0,
        }
      : null,
  };
}
```

- [ ] **Step 4: Route** — in `routes` after the callback entry:

```js
  ['GET', /^\/api\/spotify\/player$/, async ({ request, env }) => {
    const userId = await requireUser(request, env);
    try {
      return json(await spotify.playerState(env, userId));
    } catch (e) {
      if (e instanceof HttpError && e.body.error === 'not_connected') return json({ connected: false });
      throw e;
    }
  }],
```

- [ ] **Step 5: Run** — expected: 23 passed. **Commit** — `git commit -am "Spotify: what is playing"`

---

### Task 5: Controls and disconnect

**Files:** Modify `worker/spotify.js`, `worker/api.js`, `test/spotify.test.js`

- [ ] **Step 1: Failing tests** — append:

```js
const control = (action, cookie) => get(`/api/spotify/player/${action}`, cookie, { method: 'POST' });

describe('controls', () => {
  for (const action of ['play', 'pause', 'next', 'previous', 'restart']) {
    it(`${action} reaches Spotify`, async () => {
      const { userId, cookie } = await session();
      await seed(userId);
      expect((await control(action, cookie)).status).toBe(204);
    });
  }

  it('explains a missing device', async () => {
    const { userId, cookie } = await session();
    await seed(userId, { access: 'tok-nodevice' });
    const res = await control('play', cookie);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no_device' });
  });

  it('explains that controls need Premium', async () => {
    const { userId, cookie } = await session();
    await seed(userId, { access: 'tok-free' });
    const res = await control('next', cookie);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'premium_required' });
  });

  it('is 409 with no connection', async () => {
    const { cookie } = await session();
    const res = await control('play', cookie);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'not_connected' });
  });

  it('is 409 and forgets a revoked connection', async () => {
    const { userId, cookie } = await session();
    await seed(userId, { access: 'tok-expired', refresh: 'revoked', expiresAt: 0 });
    expect((await control('pause', cookie)).status).toBe(409);
    expect(await getSpotifyTokens(env.DB, userId)).toBeNull();
  });

  it('is 404 for an action it does not know', async () => {
    const { userId, cookie } = await session();
    await seed(userId);
    const res = await control('shuffle', cookie);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });
});

describe('isolation', () => {
  it("never uses one user's Spotify for another", async () => {
    const a = await session(), b = await session();
    await seed(a.userId);
    expect((await player(b.cookie)).body).toEqual({ connected: false });
    expect((await control('pause', b.cookie)).status).toBe(409);
  });
});

describe('disconnect', () => {
  it('deletes the row, and a second call is still fine', async () => {
    const { userId, cookie } = await session();
    await seed(userId);
    expect((await get('/api/spotify', cookie, { method: 'DELETE' })).status).toBe(204);
    expect(await getSpotifyTokens(env.DB, userId)).toBeNull();
    expect((await get('/api/spotify', cookie, { method: 'DELETE' })).status).toBe(204);
  });
});
```

- [ ] **Step 2: Run** — expected: new tests FAIL.

- [ ] **Step 3: `worker/spotify.js`** — append:

```js
/** Each control the strip can send, as Spotify's method and path. */
const CONTROLS = {
  play: ['PUT', '/me/player/play'],
  pause: ['PUT', '/me/player/pause'],
  next: ['POST', '/me/player/next'],
  previous: ['POST', '/me/player/previous'],
  restart: ['PUT', '/me/player/seek?position_ms=0'],
};
export const ACTIONS = Object.keys(CONTROLS);

/** Send a control; throws the mapped error unless Spotify took it. */
export async function control(env, userId, action) {
  const [method, path] = CONTROLS[action];
  const res = await call(env, userId, method, path);
  if (res.ok) return;
  if (res.status === 404) throw new HttpError(404, { error: 'no_device' });
  if (res.status === 403) throw new HttpError(403, { error: 'premium_required' });
  throw failure(res);
}
```

- [ ] **Step 4: Routes** — after the player route:

```js
  ['POST', /^\/api\/spotify\/player\/([a-z]+)$/, async ({ request, env, params: [action] }) => {
    const userId = await requireUser(request, env);
    if (!spotify.ACTIONS.includes(action)) throw new HttpError(404, { error: 'not_found' });
    await spotify.control(env, userId, action);
    return new Response(null, { status: 204 });
  }],
  ['DELETE', /^\/api\/spotify$/, async ({ request, env }) => {
    await deleteSpotifyTokens(env.DB, await requireUser(request, env));
    return new Response(null, { status: 204 });
  }],
```

- [ ] **Step 5: Run** `npx vitest run` — expected: all pass (53 + 35 = 88). **Commit** — `git commit -am "Spotify: controls and disconnect"`

---

### Task 6: The poller

**Files:** Create `public/js/spotify.js`, `test/spotify-player.test.js`; modify `public/js/api.js`

- [ ] **Step 1: Failing test** — `test/spotify-player.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { nextDelayMs, previousAction } from '../public/js/spotify.js';

describe('nextDelayMs', () => {
  it('polls every 5 s while playing', () => {
    expect(nextDelayMs({ connected: true, playing: true })).toBe(5000);
  });
  it('every 20 s when paused or idle', () => {
    expect(nextDelayMs({ connected: true, playing: false, track: null })).toBe(20000);
  });
  it('stops when not connected or unknown', () => {
    expect(nextDelayMs({ connected: false })).toBeNull();
    expect(nextDelayMs(null)).toBeNull();
  });
});

describe('previousAction', () => {
  it('restarts a track more than 3 s in', () => {
    expect(previousAction({ track: { progressMs: 3001 } })).toBe('restart');
  });
  it('goes back near the start, or with nothing playing', () => {
    expect(previousAction({ track: { progressMs: 2000 } })).toBe('previous');
    expect(previousAction({ track: null })).toBe('previous');
  });
});
```

- [ ] **Step 2: Run** — FAIL, module not found.

- [ ] **Step 3: `public/js/api.js`** — add to `api`:

```js
  spotifyPlayer: () => request('GET', '/api/spotify/player'),
  spotifyControl: (action) => request('POST', `/api/spotify/player/${action}`),
  spotifyDisconnect: () => request('DELETE', '/api/spotify'),
```

- [ ] **Step 4: `public/js/spotify.js`**:

```js
// The Spotify strip's data. Polls the Worker while the tab is visible and online:
// every 5 s while something plays, every 20 s otherwise, and not at all once we know
// there is no connection (connecting reloads the page, which starts it again).
// Between polls the progress is advanced locally so the line moves.

import { api, ApiError } from './api.js';

const PLAYING_MS = 5000;
const IDLE_MS = 20000;
const BACKOFF_MS = 30000;
const SETTLE_MS = 300;        // Spotify's state lags a command by a moment

/** How long until the next poll; null stops polling. */
export function nextDelayMs(state) {
  if (!state || !state.connected) return null;
  return state.playing ? PLAYING_MS : IDLE_MS;
}

/** Previous, the way Spotify's own apps do it: a few seconds in, it restarts the track. */
export function previousAction(state) {
  return (state?.track?.progressMs ?? 0) > 3000 ? 'restart' : 'previous';
}

let state = null;             // the Worker's last answer, plus `stale`
let polledAt = 0;
let timer = null;
let ticker = null;
let running = false;
let wired = false;
let listener = () => {};
let signedOut = () => {};

/** fn(state, tick): tick is true for the once-a-second progress update. */
export function onState(fn) { listener = fn; }
export function onUnauthenticated(fn) { signedOut = fn; }

/** The last state, its progress advanced to now while playing. */
export function current() {
  if (!state?.track || !state.playing) return state;
  const progressMs = Math.min(state.track.durationMs, state.track.progressMs + (Date.now() - polledAt));
  return { ...state, track: { ...state.track, progressMs } };
}

function wake(ms) {
  clearTimeout(timer);
  timer = ms == null ? null : setTimeout(poll, ms);
}

/** Ask the Worker now. Hidden or offline, it waits for the tab or network to come back. */
export async function poll() {
  clearTimeout(timer);
  timer = null;
  if (!running || document.visibilityState !== 'visible' || navigator.onLine === false) return;
  try {
    const next = await api.spotifyPlayer();
    if (!running) return;
    state = { ...next, stale: false };
    polledAt = Date.now();
    listener(current(), false);
    wake(nextDelayMs(state));
  } catch (e) {
    if (!running) return;
    if (e instanceof ApiError && e.status === 401) { stop(); signedOut(); return; }
    if (state) { state = { ...state, stale: true }; listener(current(), false); }
    wake(e instanceof ApiError && e.status === 429 ? (Number(e.body?.retryAfter) || 30) * 1000 : BACKOFF_MS);
  }
}

function resume() {
  if (running && (!state || state.connected)) poll();
}

/** Start polling; resolves once the first answer is in. */
export function start() {
  if (running) return Promise.resolve();
  running = true;
  if (!wired) {
    wired = true;
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') resume(); });
    window.addEventListener('online', resume);
  }
  ticker = setInterval(() => {
    if (state?.playing && document.visibilityState === 'visible') listener(current(), true);
  }, 1000);
  return poll();
}

export function stop() {
  running = false;
  clearTimeout(timer);
  timer = null;
  clearInterval(ticker);
  ticker = null;
  state = null;
}

/** Send a control, then look again shortly after. Throws for the caller to explain. */
export async function control(action) {
  try {
    await api.spotifyControl(action);
    if (state && (action === 'play' || action === 'pause')) {
      state = { ...current(), playing: action === 'play' };
      polledAt = Date.now();
      listener(current(), false);
    }
  } finally {
    wake(SETTLE_MS);
  }
}
```

- [ ] **Step 5: Run** `npx vitest run test/spotify-player.test.js` — 5 passed. **Commit** — `git add public/js/spotify.js test/spotify-player.test.js && git commit -am "Spotify: the poller"`

---

### Task 7: The strip

**Files:** Create `public/js/views/player.js`; modify `public/index.html`, `public/css/layout.css`, `public/_headers`, `public/sw.js`

- [ ] **Step 1: `public/js/views/player.js`**:

```js
// The Spotify strip at the bottom of the sidebar. The strip is rebuilt only when what
// it shows changes, so a button keeps its focus through a poll; the progress line is
// moved on its own every second.

import { esc, $ } from '../dom.js';

const MARK = '<svg class="spmark" viewBox="0 0 24 24" role="img" aria-label="Spotify"><path fill="currentColor" d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>';
const icon = (d) => '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="' + d + '"/></svg>';
const ICONS = {
  previous: icon('M6 5h2v14H6zM20 5v14L9 12z'),
  next: icon('M16 5h2v14h-2zM4 5v14l11-7z'),
  play: icon('M7 5v14l12-7z'),
  pause: icon('M6 5h4v14H6zM14 5h4v14h-4z'),
};

const NOTES = {
  no_device: 'Open Spotify on a device first',
  premium_required: 'Controls need Spotify Premium',
  spotify_unavailable: 'Spotify is not answering',
};
const NOTE_MS = 4000;

let last = null, note = '', noteTimer = null, drawn = '';

function markup(s) {
  if (!s.connected) {
    return ['connect', '<button class="player-connect" type="button" data-spotify-connect>' + MARK + '<span>Connect Spotify</span></button>'];
  }
  const noteHtml = note ? '<div class="player-note" role="status">' + esc(note) + '</div>' : '';
  const t = s.track;
  if (!t) return ['idle', '<div class="player-idle">' + MARK + '<span>Nothing playing</span></div>' + noteHtml];
  const link = (cls, inner) => (t.url
    ? '<a class="' + cls + '" href="' + esc(t.url) + '" target="_blank" rel="noopener">' + inner + '</a>'
    : '<span class="' + cls + '">' + inner + '</span>');
  return ['track',
    '<div class="player-now">'
      + (t.art ? link('player-art', '<img src="' + esc(t.art) + '" alt="' + esc(t.album) + '" width="36" height="36">') : '')
      + '<div class="player-meta">' + link('player-title', esc(t.title)) + '<div class="player-artist">' + esc(t.artists) + '</div></div>'
      + MARK
    + '</div>'
    + '<div class="player-bar"><i id="playerBar"></i></div>'
    + '<div class="player-ctl">'
      + '<button type="button" data-spotify="previous" aria-label="Previous">' + ICONS.previous + '</button>'
      + '<button type="button" data-spotify="toggle" aria-label="' + (s.playing ? 'Pause' : 'Play') + '">' + (s.playing ? ICONS.pause : ICONS.play) + '</button>'
      + '<button type="button" data-spotify="next" aria-label="Next">' + ICONS.next + '</button>'
    + '</div>'
    + noteHtml];
}

/** Draw the strip for this state; null hides it. */
export function renderPlayer(s) {
  const el = $('player');
  if (!el) return;
  last = s;
  if (!s) { el.hidden = true; el.innerHTML = ''; drawn = ''; return; }
  el.hidden = false;
  el.toggleAttribute('data-stale', !!s.stale);
  const [mode, html] = markup(s);
  el.dataset.mode = mode;
  if (html !== drawn) { el.innerHTML = html; drawn = html; }
  renderProgress(s);
}

/** Move the progress line only. */
export function renderProgress(s) {
  const bar = $('playerBar'), t = s?.track;
  if (bar && t && t.durationMs) bar.style.width = Math.min(100, (t.progressMs / t.durationMs) * 100).toFixed(2) + '%';
}

/** A short explanation under the controls after a command fails, for four seconds. */
export function showPlayerNote(code) {
  note = NOTES[code] || NOTES.spotify_unavailable;
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => { note = ''; renderPlayer(last); }, NOTE_MS);
  renderPlayer(last);
}
```

- [ ] **Step 2: `public/index.html`** — after the pocket's closing `</div>`, before `</aside>`:

```html
    <div class="player" id="player" hidden></div>
```

(Body markup only; the inline script and its CSP hash are untouched.)

- [ ] **Step 3: `public/css/layout.css`** — after the `.pocket .tuck` rule:

```css
/* ─── Spotify strip, under the pocket ─── */
.player{display:flex;flex-direction:column;gap:6px;padding:8px 9px;border:1px solid var(--line);border-radius:9px;background:var(--panel);font-size:12px}
.player[hidden]{display:none}
.player[data-stale]{opacity:.55}
.player[data-mode="connect"]{border:0;background:transparent;padding:2px 8px}
.player .spmark{width:14px;height:14px;flex:none;color:#1DB954}
.player-now{display:flex;align-items:center;gap:8px;min-width:0}
.player-art{flex:none;line-height:0}
.player-art img{width:36px;height:36px;border-radius:3px}
.player-meta{min-width:0;flex:1}
.player-title{display:block;color:var(--ink);font-weight:600;text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
a.player-title:hover{text-decoration:underline}
.player-artist{color:var(--ink-3);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.player-bar{height:2px;border-radius:2px;background:var(--line)}
.player-bar i{display:block;height:100%;width:0;border-radius:inherit;background:var(--accent)}
.player-ctl{display:flex;justify-content:center;gap:4px}
.player-ctl button{border:0;background:transparent;color:var(--ink-2);border-radius:6px;padding:4px 8px;line-height:0}
.player-ctl button:hover{background:var(--panel-2);color:var(--accent)}
.player-ctl svg{width:14px;height:14px}
.player-ctl [data-spotify="toggle"] svg{width:17px;height:17px}
.player-idle,.player-connect{display:flex;align-items:center;gap:8px;color:var(--ink-3)}
.player-connect{border:0;background:transparent;padding:0;font-size:12px;text-align:left}
.player-connect:hover{color:var(--accent)}
.player-note{font-size:11px;color:var(--warn);text-align:center}
```

- [ ] **Step 4: `public/_headers`** — in the CSP, `img-src 'self' data:` becomes `img-src 'self' data: https://i.scdn.co`.

- [ ] **Step 5: `public/sw.js`** — `CACHE` becomes `'rounds-shell-v5'`; add `'/js/spotify.js'` after `'/js/fireworks.js'` and `'/js/views/player.js'` after `'/js/views/signin.js'`.

- [ ] **Step 6: Commit** — `git add public && git commit -m "Spotify: the strip in the sidebar"`

---

### Task 8: Settings and wiring

**Files:** Modify `public/js/state.js`, `public/js/views/drawer-base.js`, `public/js/views/drawer-settings.js`, `public/js/main.js`, `public/css/components.css`

- [ ] **Step 1: state** — in `state.js` `ui`, add `spotifyFlash: null,` after `quoteIx: 0,`. In `drawer-base.js` `resetDrawerState`, append `ui.spotifyFlash = null;`.

- [ ] **Step 2: `drawer-settings.js`**

Import: `import { current as spotifyState } from '../spotify.js';`

`openSettings` takes the flash:

```js
export function openSettings(focus, spotifyFlash = null) {
  resetDrawerState();
  ui.settings = true;
  ui.focusField = focus || null;
  ui.spotifyFlash = spotifyFlash;
  renderSettings();
}
```

Add:

```js
function spotifyGroup() {
  const s = spotifyState();
  let h = '<div class="setgrp"><h4>Spotify<em>' + (!s ? 'checking…' : s.connected ? 'connected' : 'not connected') + '</em></h4>';
  if (ui.spotifyFlash === 'connected') h += '<span class="note ok">Connected. What is playing shows under your coat.</span>';
  if (ui.spotifyFlash === 'error') h += '<span class="note err">Spotify did not connect. Try again; if it keeps failing, George has to add your Spotify email first.</span>';
  if (s) {
    h += s.connected
      ? '<span><button class="btn ghost" type="button" id="spDisconnect" data-act="spotify-disconnect">Disconnect</button></span>'
      : '<span><a class="btn" id="spConnect" href="/api/spotify/connect">Connect Spotify</a></span>';
  }
  return h + '<span class="note">Shows what is playing in the sidebar. Play, pause and skip need Spotify Premium. '
    + 'George has to add your Spotify email to the app before you can connect.</span></div>';
}
```

In `renderSettings`, just before `// ── data: sync, import, account ──`: `body += spotifyGroup();`

- [ ] **Step 3: `components.css`** — after `.setgrp .note{...}`:

```css
.setgrp .note.ok{color:var(--good)}
.setgrp .note.err{color:var(--crit)}
a.btn{display:inline-block;text-decoration:none}
```

- [ ] **Step 4: `main.js`**

Imports:

```js
import * as spotify from './spotify.js';
import { renderPlayer, renderProgress, showPlayerNote } from './views/player.js';
```

After `sync.onUnauthenticated(...)`:

```js
/* ═════════ Spotify strip ═════════ */
let spotifyConnected = null;
spotify.onState((s, tick) => {
  if (tick) { renderProgress(s); return; }
  renderPlayer(s);
  if (s && s.connected !== spotifyConnected) { spotifyConnected = s.connected; if (ui.settings) renderSettings(); }
});
spotify.onUnauthenticated(() => showSignIn('Your session has ended. Sign in again.'));

/* Back from Spotify's consent page: the Worker put the result in the hash. */
function spotifyReturn(started) {
  const m = /^#spotify=(connected|error)$/.exec(location.hash);
  if (!m) return;
  history.replaceState(null, '', location.pathname + location.search);
  started.then(() => openSettings(m[1] === 'connected' ? 'spDisconnect' : 'spConnect', m[1]));
}

async function spotifyButton(which) {
  const s = spotify.current();
  const action = which === 'toggle' ? (s?.playing ? 'pause' : 'play') : which === 'previous' ? spotify.previousAction(s) : which;
  try {
    await spotify.control(action);
  } catch (err) {
    const code = err instanceof ApiError ? err.body?.error : 'spotify_unavailable';
    if (code !== 'not_connected') showPlayerNote(code);
  }
}
```

In `start()`, after `sync.syncNow();`: `spotifyReturn(spotify.start());`

In `signOut()`, before `showSignIn();`: `spotify.stop(); renderPlayer(null); spotifyConnected = null;`

In the click handler, before `if (e.target.closest('#syncPill'))`:

```js
  if ((el = e.target.closest('[data-spotify]'))) { spotifyButton(el.dataset.spotify); return; }
  if (e.target.closest('[data-spotify-connect]')) { $('side').classList.remove('on'); openSettings('spConnect'); return; }
```

In the `data-act` chain, after `signout-all`:

```js
    else if (act === 'spotify-disconnect') {
      try { await api.spotifyDisconnect(); } catch {}
      await spotify.poll();
      renderSettings();
    }
```

- [ ] **Step 5: Run** `npx vitest run` — all pass. **Commit** — `git commit -am "Spotify: Settings group and wiring"`

---

### Task 9: Docs

- [ ] `README.md`: test count to what vitest prints; `npm run dev` line notes 127.0.0.1 for Spotify; a **Spotify** step in Going live; Features bullet.
- [ ] `docs/DEPLOYING.md`: test count.
- [ ] `docs/DATA-MODEL.md`: a `spotify_tokens` section after `quotes`; the five routes in the API table.
- [ ] `PLAN.md`: `### 8 — Spotify in the sidebar — done` before `## What stays exactly as designed`, pointing at the spec.
- [ ] Commit — `git commit -am "Docs: the Spotify player"`

---

### Task 10: Verify

- [ ] `npx vitest run` — all pass, count noted.
- [ ] `npm run db:local`, `npm run dev`, open http://127.0.0.1:8787, sign in: the strip shows "Connect Spotify"; Settings shows the Spotify group; Connect goes to Spotify's consent page and back to `#spotify=connected`; with Spotify playing, the strip shows the track and the controls work.
- [ ] Deploy only when George says so: `npm run deploy` (applies `0004` remotely first).
