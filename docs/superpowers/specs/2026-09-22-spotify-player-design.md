# Spotify player — design

Date: 22 September 2026. Status: approved. Look chosen 22 September 2026: the badge,
option B of [`design/mockup-spotify-options.html`](../../../design/mockup-spotify-options.html);
the earlier strip is kept in [`design/mockup-spotify.html`](../../../design/mockup-spotify.html)
for the states, phone overlay and Settings group, which are unchanged.

A badge clipped to the bottom of the sidebar, under the pocket, that shows what is
playing on the signed-in user's Spotify, with previous, play/pause and next. Each
Rounds user connects their own Spotify account from Settings. The browser never talks to Spotify itself: the
Worker holds the tokens and proxies every call.

## Constraints that shaped it

Spotify's Web API rules as of February 2026:

- A development-mode app needs its owner to hold Spotify Premium; the app stops if
  that lapses. The owner here is George, who has Premium.
- Playback control (pause, skip, seek) only works for listeners with Premium.
  Free listeners still see what is playing.
- A new app is capped at five users, each added by email in the Spotify developer
  dashboard, and one client id per developer.
- The currently-playing and player-control endpoints were not removed.
- `localhost` is no longer accepted as a redirect URI; `http://127.0.0.1:<port>` is.

Project rules: free tiers only, no custom domain, no third-party scripts, tokens and
secrets stay in the Worker, everything scoped by user id.

## Spotify side, done once

1. Create an app at developer.spotify.com. Redirect URIs:
   `https://rounds.termanitor07.workers.dev/api/spotify/callback` and
   `http://127.0.0.1:8787/api/spotify/callback`. Local testing opens the dev server
   at 127.0.0.1, not localhost.
2. Under the app's user management add the Spotify email of each Rounds user who
   wants the player, up to five.
3. Put the client id in `wrangler.jsonc` under `vars.SPOTIFY_CLIENT_ID` and in
   `.dev.vars`. Set the secret with `wrangler secret put SPOTIFY_CLIENT_SECRET` and
   locally in `.dev.vars` (`.dev.vars.example` documents both).

Scopes requested: `user-read-playback-state user-modify-playback-state`.

## Storage

Migration `0004_spotify.sql`:

```sql
CREATE TABLE spotify_tokens (
  user_id        TEXT PRIMARY KEY REFERENCES users(id),
  refresh_token  TEXT NOT NULL,     -- AES-GCM ciphertext, base64, see worker/spotify.js
  access_token   TEXT NOT NULL,
  expires_at     INTEGER NOT NULL,  -- ms since epoch
  updated_at     INTEGER NOT NULL
);
```

The refresh token is encrypted at rest with AES-GCM under a key derived from
`SESSION_SECRET` (HKDF, info `spotify-refresh`). Rotating the secret therefore
disconnects Spotify for everyone, the same way it signs everyone out; users reconnect
from Settings. The access token is short-lived (one hour) and stored in clear.

Queries in `worker/db.js`, each taking a `userId`: `getSpotifyTokens`,
`saveSpotifyTokens`, `deleteSpotifyTokens`.

## Worker

New file `worker/spotify.js`:

- `authorizeUrl(env, redirectUri, state)` builds the consent URL.
- `exchangeCode(env, code, redirectUri)` and `refreshAccessToken(env, refreshToken)`
  call `https://accounts.spotify.com/api/token` with HTTP Basic client id and secret.
- `encryptToken` / `decryptToken` as above.
- `freshAccessToken(env, userId)` returns a usable access token, refreshing when
  `expires_at` is within 60 s, and refreshing once more if Spotify still answers 401
  (then retrying the call once). A refresh answered with `invalid_grant` deletes the row
  and throws a `not_connected` error.
- `playerState(env, userId)` calls `GET https://api.spotify.com/v1/me/player` and maps
  it to the compact shape below.
- `control(env, userId, action)` maps an action to Spotify's endpoint.

Routes, added to the table in `worker/api.js`. Every one starts with
`requireUser` (or `requireSession`).

| Route | Does |
| --- | --- |
| `GET /api/spotify/connect` | Makes a random 32-hex `state`, sets it in cookie `rounds_spotify_state` (HttpOnly, SameSite=Lax, Max-Age 600, Secure on https), and 302s to Spotify's consent page. `redirect_uri` is `<request origin>/api/spotify/callback`. |
| `GET /api/spotify/callback` | A browser navigation, so every failure is a 302 to `/#spotify=error` rather than JSON: no session, or `?state` not equal to the cookie. Exchanges `?code`, stores the tokens, clears the state cookie, 302s to `/#spotify=connected`. If Spotify sent `?error`, 302 to `/#spotify=error`. |
| `GET /api/spotify/player` | `{ connected: false }` when there is no row. Otherwise `{ connected: true, playing, track, device }` where `track` is null when nothing is playing (Spotify 204) or `{ title, artists, album, art, url, durationMs, progressMs }`. `art` is the 300px image. `device` is the active device name or null. |
| `POST /api/spotify/player/:action` | `action` is one of `play`, `pause`, `next`, `previous`, `restart`. Returns 204. `restart` is seek to 0. |
| `DELETE /api/spotify` | Deletes the row, 204. |

Spotify errors are mapped so the UI can explain them:

| Spotify says | Rounds answers |
| --- | --- |
| 404 on a control (no active device) | 404 `{ error: 'no_device' }` |
| 403 on a control (Premium required) | 403 `{ error: 'premium_required' }` |
| 429 | 429 with `retry-after` passed through |
| any 5xx, or a network failure | 502 `{ error: 'spotify_unavailable' }` |
| refresh token revoked | row deleted; `{ connected: false }` on the player route, 409 `{ error: 'not_connected' }` on a control |
| no row at all on a control | 409 `{ error: 'not_connected' }` |

The callback is a top-level GET from Spotify, so `assertSameOrigin` does not apply
and the SameSite=Lax session cookie is sent. The state cookie is the CSRF guard for
the OAuth round trip. Client id and secret are read from `env`; if either is missing
the connect route answers 503 `{ error: 'spotify_not_configured' }`.

## Front end

### `public/js/spotify.js` — the poller

Exposes `start()`, `stop()`, `control(action)`, `onState(fn)`. Owns one timer and the
last state.

- `nextDelayMs(state)` is a pure function: 5000 while `playing`, 20000 when connected
  but paused or idle, `null` when not connected (stop polling until a page reload).
- Polls only while `document.visibilityState === 'visible'` and `navigator.onLine`;
  a `visibilitychange` to visible or an `online` event polls at once.
- After `control(action)` resolves, polls again after 300 ms because Spotify's state
  lags a command.
- Between polls the listener gets a tick each second with `progressMs` advanced
  locally while playing, so the progress line moves.
- On a 401 from Rounds it calls the same unauthenticated handler sync uses. On 429 or
  502 it keeps the last state, marks it `stale: true`, and waits the retry-after or
  30 s before trying again.

### `public/js/views/player.js` — the badge

`renderPlayer(state)` writes into `<div class="player" id="player">`, placed in
`index.html` after the pocket in the sidebar, so it sits at the bottom of the coat.

The look: a card in the panel colour with a 1px border tinted by the coat colour,
rounded 9px, with a small clip over its top edge (a 34×8px bar in the coat colour,
like the pen on the pocket) so it reads as an ID badge clipped to the coat next to
the pocket. Inside, top to bottom: the now-playing row, a 3px progress line, three
round controls centred, and a device line. It is about 120px tall when playing.

States:

- Not connected: the card holds a single quiet line, "Connect Spotify", with the
  Spotify mark in grey, which opens Settings at the Spotify group. The mark turns
  green on hover.
- Idle: the Spotify mark and "Nothing playing". No line, controls or device line.
- Playing or paused: 42px album art (rounded 7px, a soft shadow), the title as a link
  to `track.url` (opens in a new tab), the artist line, and under it four equaliser
  bars in Spotify green that animate while `playing` and stand still when paused
  (no animation under `prefers-reduced-motion`). The Spotify mark sits at the right
  of the row. The progress line fills from the accent to Spotify green. The controls
  are previous and next as 28px outlined circles and play/pause as a 34px filled
  circle in the ink colour, which reflects `playing`. The device line reads
  "on <device>" in small type, or is hidden when `device` is null.
- After a failed command: a short note under the controls for 4 s, "Open Spotify on a
  device first" for `no_device`, "Controls need Spotify Premium" for
  `premium_required`, "Spotify is not answering" for `spotify_unavailable`.
- Stale: the badge is dimmed (`data-stale`) until a poll succeeds, and the bars stop.

Previous behaves like the Spotify app: `restart` when `progressMs > 3000`, else
`previous`.

The Spotify mark is inline SVG. Spotify's brand rules require it beside their
metadata and that album art is shown unaltered and links back to Spotify; the title
link satisfies the latter.

On phones the sidebar is an overlay opened by the menu button, and the badge is at
its bottom there too. The sidebar already scrolls, so a long course list does not
hide it.

### Settings

A "Spotify" group in `drawer-settings.js`, between Quotes and Data. Shows
"Connected" or "Not connected" with a Connect link (`<a class="btn"
href="/api/spotify/connect">`, a plain navigation) or a Disconnect button
(`data-act="spotify-disconnect"`, calls the DELETE route, then re-renders). A note
explains that controls need Premium and that George has to add the user's Spotify
email first.

### Small edits

- `api.js`: `spotifyPlayer()`, `spotifyControl(action)`, `spotifyDisconnect()`.
- `main.js`: start the poller in `start()`, stop it in `signOut()`; wire the badge's
  buttons and the disconnect action into the delegated click handler; on boot read
  `location.hash` for `#spotify=connected` (open Settings at the Spotify group) or
  `#spotify=error` (open Settings with an error line), then clear the hash.
- `index.html`: the badge's container.
- `layout.css` / `components.css`: `.player` styles in the Ward Board palette, taken
  from the `.badge` block in `design/mockup-spotify-options.html`.
- `sw.js`: add the two scripts to the shell list, bump the cache name.
- `_headers`: `img-src 'self' data: https://i.scdn.co`. Nothing else in the CSP
  changes; the connect link is a navigation and the consent page is Spotify's.
- `wrangler.jsonc`: `vars.SPOTIFY_CLIENT_ID`. `.dev.vars.example`: both Spotify
  values.
- `README.md`: a Spotify section in Going live; `PLAN.md`: the feature under phases.

## Failure handling

- Spotify down or rate-limiting: see the mapping table and the poller's back-off.
- Session expired: the existing unauthenticated path shows the sign-in screen.
- Offline: the poller pauses on `offline`, resumes on `online`, same as sync.
- Cost: polling every 5 s for ten hours of playing a day is about 7,200 Worker
  requests per user per day, against a free allowance of 100,000, with at most five
  Spotify users.

## Testing

Vitest blocks outbound fetches with a 502 today. `vitest.config.js` points
`outboundService` at `test/spotify-stub.js`, a fake Spotify:

- `POST accounts.spotify.com/api/token`: `grant_type=authorization_code` with
  `code=good` returns fixed tokens; any other code returns 400. `refresh_token`
  with `refresh_token=revoked` returns 400 `invalid_grant`; any other returns a new
  access token `tok-refreshed`.
- `api.spotify.com/v1/me/player`: behaviour chosen by the bearer token: `tok-playing`
  returns a playing fixture, `tok-paused` a paused one, `tok-idle` a 204,
  `tok-expired` a 401, `tok-nodevice` 404 on controls, `tok-free` 403 on controls,
  `tok-down` 503. A control with the wrong method or path gets 405, so a mismapping
  fails.
- Any other host: 502, as now.

Tests in `test/spotify.test.js`, seeding `spotify_tokens` rows directly the way
`createUser` seeds users:

- connect: 401 without a session; 302 to Spotify with the right scopes, client id,
  redirect URI and a state that matches the cookie set; 503 when not configured.
- callback: bad or missing state redirects to `#spotify=error` and stores nothing;
  Spotify `?error` likewise; a good code stores a row whose refresh token is not the
  plaintext and decrypts back to it; the state cookie is cleared.
- player: `connected: false` with no row; playing, paused and idle fixtures map to
  the compact shape; an expired access token is refreshed and the row updated; a
  revoked refresh token deletes the row and returns `connected: false`; Spotify down
  gives 502.
- controls: each of the five actions returns 204 against the stub; `no_device` gives
  404, `premium_required` 403, no row 409, unknown action 404.
- isolation: user A's row is never used for user B.
- disconnect: 204 and the row is gone; a second call is still 204.
- `nextDelayMs` in `public/js/spotify.js` has its own small test.

## Out of scope

Volume, shuffle, repeat, queue, search, choosing a device, the Web Playback SDK
(playing audio in the page), and lyrics. Each is possible later on the same routes.
