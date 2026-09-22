# Spotify playback in the browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Rounds tab becomes a Spotify device named "Rounds" so music plays without the Spotify app.

**Architecture:** The Worker gains a token route, a transfer route, and an optional `deviceId` on play and controls. A new `public/js/web-player.js` loads Spotify's Web Playback SDK once connected and exposes the device's state; the poller and the Spotify view retry a `no_device` on the Rounds device, and the badge offers **Play here**. Spec: `docs/superpowers/specs/2026-09-22-spotify-web-playback-design.md`.

**Tech Stack:** Cloudflare Worker + D1, vanilla ES modules, vitest with `@cloudflare/vitest-pool-workers` (Spotify is faked by `test/spotify-stub.js`).

---

## Files

- Modify `worker/spotify.js`: scopes, `deviceId` in player state, `withDevice`, `transfer`, `freshAccessToken` returns `expiresAt`.
- Modify `worker/api.js`: `GET /api/spotify/token`, `POST /api/spotify/transfer`, `deviceId` on play and controls.
- Modify `test/spotify-stub.js`: honours `device_id` (`roundsdev` is the only known device) and `PUT /v1/me/player`.
- Modify `test/spotify.test.js`: new scopes, `deviceId` in shapes, new routes.
- Create `public/js/web-player.js`: SDK loader, device state, `playTarget`, `activate`, `stop`.
- Create `test/web-player.test.js`: `playTarget`.
- Modify `public/js/api.js`, `public/js/spotify.js`, `public/js/views/player.js`, `public/js/views/spotify-view.js`, `public/js/views/drawer-settings.js`, `public/js/main.js`, `public/css/layout.css`, `public/sw.js`, `public/_headers`, `docs/DEPLOYING.md`.

---

### Task 1: Worker — scopes, device id, token and transfer

**Files:** `worker/spotify.js`, `worker/api.js`, `test/spotify-stub.js`, `test/spotify.test.js`

- [ ] **Step 1: Tests.** In `test/spotify.test.js`:
  - the connect test's scope expectation becomes
    `'user-read-playback-state user-modify-playback-state playlist-read-private playlist-read-collaborative user-library-read streaming user-read-email user-read-private'`;
  - the playing shape gains `deviceId: null` and the idle shape gains `deviceId: null`;
  - add:

```js
describe('the Rounds device', () => {
  it('hands the page a token, never cached, and 409 without a connection', async () => {
    const none = await user('t-none');
    expect((await none.api('/api/spotify/token')).status).toBe(409);
    const { api, id } = await user('t-ok');
    await connect(id, 'tok-playing');
    const res = await api('/api/spotify/token');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body.token).toBe('tok-playing');
    expect(body.expiresAt).toBeGreaterThan(Date.now());
  });

  it('refreshes an expiring token before handing it over', async () => {
    const { api, id } = await user('t-stale');
    await connect(id, 'tok-playing', { expiresAt: Date.now() + 1000 });
    const body = await (await api('/api/spotify/token')).json();
    expect(body.token).toBe('tok-refreshed');
    expect(body.expiresAt).toBeGreaterThan(Date.now() + 50 * 60 * 1000);
  });

  it('moves playback to a device', async () => {
    const { api, id } = await user('x-ok');
    await connect(id, 'tok-playing');
    const post = (deviceId, headers = {}) => api('/api/spotify/transfer', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ deviceId }) });
    expect((await post('dev-rounds')).status).toBe(400);           /* dashes are not a device id */
    expect((await post('devrounds')).status).toBe(404);             /* unknown to Spotify */
    expect(await (await post('devrounds')).json()).toEqual({ error: 'no_device' });
    expect((await post('roundsdev')).status).toBe(204);
    expect((await post('roundsdev', { origin: 'https://evil.example' })).status).toBe(403);
    const free = await user('x-free');
    await connect(free.id, 'tok-free');
    const res = await free.api('/api/spotify/transfer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deviceId: 'roundsdev' }) });
    expect(res.status).toBe(403);
  });

  it('plays and controls on a named device when asked', async () => {
    const { api, id } = await user('x-dev');
    await connect(id, 'tok-nodevice');
    const playOn = (deviceId) => api('/api/spotify/play', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ uri: 'spotify:track:t1', deviceId }) });
    expect((await playOn(undefined)).status).toBe(404);
    expect((await playOn('roundsdev')).status).toBe(204);
    expect((await playOn('bad id')).status).toBe(400);
    expect((await api('/api/spotify/player/play', { method: 'POST' })).status).toBe(404);
    expect((await api('/api/spotify/player/play?deviceId=roundsdev', { method: 'POST' })).status).toBe(204);
    expect((await api('/api/spotify/player/restart?deviceId=roundsdev', { method: 'POST' })).status).toBe(204);
    expect((await api('/api/spotify/player/play?deviceId=bad-id', { method: 'POST' })).status).toBe(400);
  });
});
```

- [ ] **Step 2: Stub.** In `test/spotify-stub.js` the only device Spotify knows by id is `roundsdev`:
  - `isControl` also accepts `PUT /v1/me/player`;
  - after the `tok-free` check, a `device_id` that is not `roundsdev` answers 404, and `roundsdev` wins over `tok-nodevice` (move the `tok-nodevice` check below it and skip it when `device_id === 'roundsdev'`);
  - `PUT /v1/me/player` needs a body `{ device_ids: [id], play: true }` with one id; `roundsdev` 204, anything else 404.

- [ ] **Step 3: Run** `npx vitest run test/spotify.test.js` — the new tests fail.

- [ ] **Step 4: Worker.** In `worker/spotify.js`: `SCOPES` gains `streaming user-read-email user-read-private`; `refreshFor` returns the fresh token object; `freshAccessToken` returns `{ token, expiresAt, row }`; `spotifyFetch` retries with `(await refreshFor(...)).accessToken`; `playerState` adds `deviceId: body.device?.id || null` (and `deviceId: null` on 204); add

```js
/** Append Spotify's device_id to a player path when one is given. */
function withDevice(path, deviceId) {
  return deviceId ? `${path}${path.includes('?') ? '&' : '?'}device_id=${encodeURIComponent(deviceId)}` : path;
}

/** Move playback to this device and keep it playing. */
export async function transfer(env, userId, deviceId) {
  const res = await spotifyFetch(env, userId, 'PUT', '/me/player', { device_ids: [deviceId], play: true });
  if (!res.ok) throw controlError(res);
}
```
  and `control(env, userId, action, deviceId)` / `play(env, userId, { uri, contextUri, deviceId })` pass their paths through `withDevice`.

  In `worker/api.js`: `const DEVICE_ID = /^[A-Za-z0-9]{1,64}$/;` and `deviceParam(value)` returning `null` for null/undefined/'' and throwing 400 `{ error: 'invalid', field: 'deviceId' }` otherwise unless it matches; the controls route reads `url.searchParams.get('deviceId')`, the play route reads `body.deviceId`; add

```js
['GET', /^\/api\/spotify\/token$/, async ({ request, env }) => {
  const userId = await requireUser(request, env);
  const { token, expiresAt } = await spotify.freshAccessToken(env, userId);
  return json({ token, expiresAt });
}],
['POST', /^\/api\/spotify\/transfer$/, async ({ request, env }) => {
  const userId = await requireUser(request, env);
  const deviceId = deviceParam((await readJson(request)).deviceId);
  if (!deviceId) throw new HttpError(400, { error: 'invalid', field: 'deviceId' });
  await spotify.transfer(env, userId, deviceId);
  return new Response(null, { status: 204 });
}],
```

- [ ] **Step 5: Run** `npm test` — all pass.
- [ ] **Step 6: Commit** "Spotify: token and transfer routes, and a device id on play".

### Task 2: `web-player.js` and `playTarget`

**Files:** create `public/js/web-player.js`, `test/web-player.test.js`

- [ ] **Step 1: Test** `test/web-player.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { playTarget } from '../public/js/web-player.js';

const ready = { status: 'ready', deviceId: 'roundsdev' };
describe('playTarget', () => {
  it('plays here when Rounds is ready and nothing else is active', () => {
    expect(playTarget({ deviceId: null }, ready)).toBe('here');
  });
  it('offers Play here when music is on another device', () => {
    expect(playTarget({ deviceId: 'phone' }, ready)).toBe('offer');
  });
  it('does nothing when Rounds is already playing, or not ready', () => {
    expect(playTarget({ deviceId: 'roundsdev' }, ready)).toBe(null);
    for (const status of ['off', 'loading', 'unsupported', 'needs_reconnect', 'no_premium']) {
      expect(playTarget({ deviceId: null }, { status, deviceId: null }), status).toBe(null);
    }
  });
});
```

- [ ] **Step 2: Run** `npx vitest run test/web-player.test.js` — fails, no module.
- [ ] **Step 3: Module** — `state`, `onChange`, `playTarget`, `start` (skip on phones: `unsupported`), `activate`, `stop`, as described in the spec, `getOAuthToken` calling `api.spotifyToken()`.
- [ ] **Step 4: Run** — passes. **Commit** "Spotify: the Rounds tab as a Web Playback device".

### Task 3: Wire the front end

**Files:** `public/js/api.js`, `public/js/spotify.js`, `public/js/views/player.js`, `public/js/views/spotify-view.js`, `public/js/views/drawer-settings.js`, `public/js/main.js`, `public/css/layout.css`, `public/sw.js`

- [ ] `api.js`: `spotifyControl(action, deviceId)` adds `?deviceId=`; `spotifyToken()`; `spotifyTransfer(deviceId)`. `spotifyPlay` already sends the object.
- [ ] `spotify.js`: `state.deviceId`; `control` retries a `no_device` once on `web.state.deviceId` when `playTarget(state, web.state) === 'here'`, and a second `no_device` shows `nothing_to_resume`; new `playHere()` calls `web.activate()` then `api.spotifyTransfer`, then polls after 300 ms.
- [ ] `player.js`: idle badge shows a play button when `playTarget` is `'here'`; device line shows a **Play here** button (`data-spotify="here"`) when it is `'offer'`; `shapeKey` includes the target; messages `no_device` → "Open Spotify somewhere, or use a desktop browser", `nothing_to_resume` → "Pick something in the Spotify view".
- [ ] `spotify-view.js`: `play` retries a `no_device` on the Rounds device; `no_device` message as above.
- [ ] `drawer-settings.js`: when `web.state.status === 'needs_reconnect'`, a note "Reconnect Spotify to play in this browser." and a **Reconnect** link to `/api/spotify/connect`.
- [ ] `main.js`: start `web` when the poller reports connected, stop it when not connected and on sign-out; `web.onChange` re-renders the badge and the Settings group; every `[data-spotify]` and `[data-spot-play]` click calls `web.activate()` first, synchronously; `here` calls `spotify.playHere()`.
- [ ] `layout.css`: `.player .device .here` and `.player .quiet .pp`.
- [ ] `sw.js`: add `/js/web-player.js`, bump to `rounds-shell-v7`.
- [ ] Run `npm test`. **Commit** "Spotify: play in the tab, and Play here on the badge".

### Task 4: Security headers, docs, and a real browser

**Files:** `public/_headers`, `docs/DEPLOYING.md`

- [ ] `_headers`: `script-src` and `frame-src` gain `https://sdk.scdn.co`. Load the page in Chrome at `http://127.0.0.1:8787`, connected, and add only the hosts the console reports as blocked.
- [ ] `DEPLOYING.md`: tick **Web Playback SDK** too; reconnect once after upgrading; the tab is a device called Rounds; desktop browsers only.
- [ ] Manual: with every Spotify app closed, pick a playlist and hear it; start on the phone and use **Play here**; no CSP errors.
- [ ] **Commit** "Spotify: let the Web Playback SDK through, and document it".
