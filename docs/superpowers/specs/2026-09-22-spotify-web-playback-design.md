# Spotify playback in the browser — design

Date: 22 September 2026. Status: approved. Builds on
[`2026-09-22-spotify-player-design.md`](2026-09-22-spotify-player-design.md).

The Rounds tab becomes a Spotify device named **Rounds**, using Spotify's Web Playback
SDK, so music can play without the Spotify app open anywhere.

## What changes in the rules

The player spec said no third-party scripts and that tokens stay in the Worker. For
this feature George agreed two exceptions:

- The page loads Spotify's SDK from `https://sdk.scdn.co/spotify-player.js`. Spotify's
  terms do not allow self-hosting it, and it runs a hidden `sdk.scdn.co` iframe.
- The page receives a short-lived (one hour) access token so the SDK can authenticate.
  The refresh token and client secret still never leave the Worker.

## Constraints

- The SDK needs Premium, and works only in desktop browsers that support EME
  (Chrome, Edge, Firefox). Spotify does not support it on mobile browsers.
- Browsers block audio until a user gesture; `player.activateElement()` must run
  inside the click that starts playback in Rounds.
- Music stops when the tab closes.
- Rounds never takes playback on its own: it plays in the tab only after a click
  (option A of the brainstorm).

## Spotify side, done once

Tick **Web Playback SDK** under the app's APIs in the developer dashboard. Everyone
already connected reconnects once from Settings to grant the new scopes.

## Worker

Scopes gain `streaming user-read-email user-read-private` (the SDK requires all three).

New routes, both behind `requireUser`:

| Route | Does |
| --- | --- |
| `GET /api/spotify/token` | `{ token, expiresAt }` from `freshAccessToken`. `cache-control: no-store`. 409 `not_connected` without a row. |
| `POST /api/spotify/transfer` | `{ deviceId }`, matching `^[A-Za-z0-9]{1,64}$` or 400. Calls `PUT /me/player` with `{ device_ids: [deviceId], play: true }`. 204. `assertSameOrigin` applies like every other POST. Errors map as for controls. |

`POST /api/spotify/play` and `POST /api/spotify/player/:action` accept an optional
`deviceId` (body for play, `?deviceId=` for controls), validated the same way and sent
to Spotify as `?device_id=`. Without it, behaviour is unchanged.

## Security headers

`public/_headers` CSP gains `https://sdk.scdn.co` in `script-src` and `frame-src`, and
the Spotify API, streaming and media hosts the SDK uses in `connect-src` and
`media-src`. The exact host list is confirmed in a real browser during implementation
and recorded in `_headers` with a comment; no wildcard wider than `*.spotify.com` and
`*.scdn.co`.

## Front end

### `public/js/web-player.js` — the device

- `start()` is called once the poller sees `connected: true`. It injects the SDK
  script once, defines `window.onSpotifyWebPlaybackSDKReady`, and creates
  `new Spotify.Player({ name: 'Rounds', getOAuthToken, volume: 0.8 })`.
  `getOAuthToken` calls `GET /api/spotify/token`.
- Exposes `state`: `{ status, deviceId }` where `status` is `loading`, `ready`,
  `unsupported` (`initialization_error`, or the script fails to load),
  `needs_reconnect` (`authentication_error`), `no_premium` (`account_error`), or `off`.
- Exposes `activate()`, which calls `player.activateElement()`, and `stop()`, which
  disconnects the player on sign-out or Spotify disconnect.
- Added to the service worker's shell list; the SDK itself is cross-origin and not
  cached.

### Choosing where to play

A pure function `playTarget(poller, web)` in `web-player.js` returns:

- `'here'` when the Rounds device is ready and no other device is active;
- `'offer'` when the Rounds device is ready and music is on another device (the badge
  shows **Play here**);
- `null` otherwise.

The poller's `control(action)` and the Spotify view's play call go as now. When the
Worker answers `no_device` and `playTarget` is `'here'`, they call `activate()` and
retry once with `deviceId`. The retry follows the same click, so the audio is allowed.

### The badge

- Playing on another device and Rounds ready: a small **Play here** button next to the
  device name; it calls `activate()` then the transfer route, then polls.
- Nothing playing and Rounds ready: the idle badge gets a play button. It sends
  `play` with the Rounds `deviceId`. If Spotify has nothing to resume (404), it shows
  "Pick something in the Spotify view".
- When Rounds is the active device, the device line reads "on **Rounds**", as today.

### Settings

When `status` is `needs_reconnect`, the Spotify group shows "Reconnect Spotify to play
in this browser" with a **Reconnect** link to `/api/spotify/connect` (a new link; the
callback overwrites the stored tokens). `unsupported` and `no_premium`
show nothing: Rounds behaves as before.

### Messages

`no_device` reads "Open Spotify somewhere, or use a desktop browser" when the Rounds
device is not ready. The other messages are unchanged.

## Testing

Worker (`test/spotify.test.js`):

- The consent URL carries the new scopes.
- Token route: 409 without a connection; returns the stored token with
  `cache-control: no-store`; refreshes an expiring token.
- Transfer route: 400 on a bad `deviceId`; 403 on a cross-origin POST; sends
  `device_ids` and `play: true`; maps 404/403 like controls.
- Play and control pass `device_id` through when given, and omit it otherwise.

Front end (`test/web-player.test.js`, like `timepicker.test.js`): unit tests for `playTarget` across ready/not ready × no device / Rounds
active / other device active.

Manual, in Chrome at `http://127.0.0.1:8787`: connect; with every Spotify app closed,
pick a playlist and hear it in the tab; start music on the phone and move it with
**Play here**; confirm no CSP errors in the console; confirm a phone browser still
shows the badge as before.

## Out of scope

Choosing among all devices, playing in more than one tab, keeping audio alive after
the tab closes, and mobile browsers.
