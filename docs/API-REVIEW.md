# API, rate limiting, and caching review

Reviewed 2026-09-22. This covers the Worker routes, shared HTTP helpers, D1 queries,
sessions, login throttling, Spotify OAuth and proxy, browser request queue, and
service worker. Changes are local; production has not been deployed or probed.

## Findings addressed

| Area | Finding | Change |
| --- | --- | --- |
| Login abuse | Per-username throttling could be bypassed by spraying many usernames. | Added a shared 30-request/minute limit per Cloudflare-provided IP before parsing or password hashing. IPs are stored as SHA-256 digests. Existing username lockouts remain. |
| Authenticated API abuse | Direct callers bypassed the browser's Spotify pacing, and other authenticated routes had no request budget. | Added atomic D1 limits: 600 requests/minute per account, plus 60/minute for Spotify routes. |
| Upstream throttling | Spotify cooldowns only existed in an individual tab; its accounts-service 429 was mapped to a generic rejection. | Persist API and accounts-service cooldowns separately by client ID. All users observe them. Return JSON and Retry-After consistently. |
| Request bodies | Content-Length was optional, the whole body was buffered before rejection, and the fallback measured characters instead of bytes. | Stream and count bytes; cancel after 1 MiB, including chunked and multibyte bodies. |
| OAuth | State matched a cookie but was not tied to the initiating account or consumed server-side. | Store a ten-minute, single-use state per account and reject account switches, expiry, and replay. |
| Token refresh | Simultaneous refreshes could rotate the same token; a delayed refresh could recreate a disconnected connection or overwrite a reconnect. | Use a short D1 lease, reread credentials after acquiring it, and compare stored credentials before replacement/deletion. |
| Upstream hangs | Fetches and response bodies had no deadline. | Abort Spotify requests after ten seconds and retain credentials on transient failure. |
| Upstream errors | A player 403 or malformed success body could be presented as a connected, idle player. | Preserve authorization errors and reject malformed JSON/token responses. |
| Input validation | Arrays were coerced into valid Spotify URI strings; huge sync cursors reached D1; row path IDs were not decoded. | Require URI strings, bound safe-integer cursors, validate offsets consistently, decode path parameters once, and reject malformed encoding/control characters. |
| HTTP routing | Unsupported methods lacked Allow; the bare /api path could enter the SPA fallback. | Return Allow on 405 and route both /api and /api/* through the Worker. |
| Pagination | Browser offsets counted only visible tracks, skipping or repeating results when upstream entries were filtered out. | Return explicit upstream offsets for lists and each search category; prevent duplicate More requests. |
| Session boundaries | In-memory Spotify caches and queued commands could survive an account change; failed sign-out/disconnect appeared successful. | Abort old requests, invalidate queued commands, reload after successful account changes, and display failures without pretending to sign out. |
| Service worker | Cached arbitrary same-origin GETs, deleted unrelated caches, and did not use cached assets during HTTP 5xx outages. | Cache only known shell paths without queries, respect no-store/private, clean only Rounds caches, use current-cache fallback on network/5xx failures, and tolerate cache-write failures. |
| Static assets | Unversioned asset URLs had no explicit revalidation policy. | Add Cache-Control: no-cache to static responses. Offline shell caching remains explicit in the service worker. |
| Account removal | The maintenance script omitted Spotify tokens, so their foreign key could prevent deleting a connected user. | Delete that user's Spotify credentials before the account. New OAuth and lease rows cascade on account deletion. |

The preceding cleanup also preserved local edits on transient sync errors, avoided
duplicate sync listeners, corrected browser Retry-After handling, and tightened
calendar and clock validation.

## Endpoint inventory

All API responses, including errors, redirects, and token responses, use
`Cache-Control: no-store` and `X-Content-Type-Options: nosniff`. Every write rejects
foreign Origin/Fetch Metadata headers. Requests without browser origin headers are
allowed for non-browser clients, but still require authentication where specified.

| Method and path | Authentication and checks | Rate policy |
| --- | --- | --- |
| POST /api/login | Username/password; generic bad-login result, password verification for unknown valid usernames | IP budget and atomic username lockout |
| DELETE /api/session | Clears the local cookie; deliberately idempotent without a session | No account budget |
| POST /api/session/revoke-all | Valid session; increments password generation | Account |
| GET /api/me | Valid session; renews expiring cookie, never returns password hash | Account |
| PUT /api/me | Valid session; profile shape and field validation | Account |
| GET /api/sync | Valid session; safe nonnegative integer cursor; user-scoped rows | Account |
| GET/PUT/DELETE /api/courses/:id | Valid session; user-scoped ID, course validation; delete clears item references | Account |
| GET/PUT/DELETE /api/items/:id | Valid session; user-scoped ID, item validation, course ownership | Account |
| GET/PUT/DELETE /api/quotes/:id | Valid session; user-scoped ID and quote validation | Account |
| GET /api/spotify/connect | Valid session; configured client; creates account-bound OAuth state | Account + Spotify |
| GET /api/spotify/callback | Valid session plus state cookie and server-side state; failures redirect to the app | Account; accounts-service cooldown |
| GET /api/spotify/token | Valid session; returns only access token and expiry | Account; accounts-service cooldown if refresh needed |
| DELETE /api/spotify | Valid session; deletes only this user's connection | Account |
| GET /api/spotify/player | Valid session; compact playback state or disconnected result | Account + Spotify + upstream |
| POST /api/spotify/player/{play,pause,next,previous,restart} | Valid session; fixed action allowlist and optional device ID | Account + Spotify + upstream |
| POST /api/spotify/transfer | Valid session; device ID and boolean play flag | Account + Spotify + upstream |
| GET /api/spotify/devices | Valid session; compact device list | Account + Spotify + upstream |
| PUT /api/spotify/shuffle | Valid session; boolean state | Account + Spotify + upstream |
| PUT /api/spotify/repeat | Valid session; off/context/track enum | Account + Spotify + upstream |
| GET /api/spotify/me | Valid session; compact connected-account identity | Account + Spotify + upstream |
| GET /api/spotify/recent | Valid session; deduplicated recent tracks | Account + Spotify + upstream |
| GET /api/spotify/search | Valid session; bounded query, search type, integer offset | Account + Spotify + upstream |
| GET /api/spotify/albums/:id/tracks | Valid session; alphanumeric ID and offset | Account + Spotify + upstream |
| GET /api/spotify/artists/:id/albums | Valid session; alphanumeric ID and offset | Account + Spotify + upstream |
| GET /api/spotify/playlists | Valid session; integer offset | Account + Spotify + upstream |
| GET /api/spotify/playlists/:id/tracks | Valid session; alphanumeric ID or liked, integer offset | Account + Spotify + upstream |
| GET /api/spotify/queue | Valid session; compact queue | Account + Spotify + upstream |
| POST /api/spotify/queue | Valid session; track/episode URI string | Account + Spotify + upstream |
| POST /api/spotify/play | Valid session; URI/context/list validation, optional device | Account + Spotify + upstream |
| PUT /api/spotify/volume | Valid session; integer 0–100 | Account + Spotify + upstream |

The route contract suite expands these into 37 protected method/path cases. Login,
cookie clearing, and OAuth callback behavior have separate coverage. Unknown paths
return JSON 404; unsupported methods, including OPTIONS/HEAD, return 405 and Allow.
There is no cross-origin API/CORS contract.

## Operational details

- Apply `migrations/0005_request_limits.sql` before running the updated Worker.
  `npm run db:local` does this locally; the existing `npm run deploy` applies remote
  migrations before deployment.
- Limits use shared D1 state, not isolate memory. They are fixed one-minute windows
  starting with the first admitted request. Rejections do not extend a window.
- An authenticated request adds a D1 write for the account budget, plus one for the
  Spotify budget where applicable. This trades database usage for enforcement across
  tabs and isolates. Check D1 usage before substantially increasing traffic.
- Upstream cooldowns are reactive: calls already underway when the first 429 arrives
  may still reach Spotify. Retry delays are sanitized to positive seconds, defaulting
  to 30 seconds, with a seven-day upper bound. API and accounts cooldowns are independent.
- SDK token retrieval and disconnect bypass the Spotify request budget/API cooldown,
  but retain the general account budget. Expired SDK tokens still require the accounts service.
- Refresh leases expire after 15 seconds; contenders wait at most 12 seconds before a
  retryable 503. A successful refresh is reused by waiting requests. No automatic
  retries are added to playback writes, where repeating a command could skip a track twice.
- The nightly task removes expired request windows, OAuth states, and refresh leases.
- Only public app-shell assets enter Cache Storage. Private tracker data is stored in
  per-account IndexedDB for the existing offline feature; private API bodies are not
  cached by the service worker. Spotify list caches live in memory until a refresh or
  page reload. Successful login, sign-out, and disconnect reload the page to clear them.

## Reliability follow-up

The reliability update replaces timestamp-based browser sync with revision checks
and a bounded sequence feed. It adds atomic local saves, individual pending records,
coordination across tabs, full reconciliation after history expiration, persistent
conflict recovery, and verified local cleanup. See [RELIABILITY-UPGRADE.md](RELIABILITY-UPGRADE.md)
and [DATA-MODEL.md](DATA-MODEL.md) for the current contract.

Remaining operational checks: real Spotify playback and visual browser verification
require a connected browser and Spotify account; production edge behavior should
be checked after deployment. Database request budgets still do not replace edge
protection against volumetric attacks. The legacy timestamp endpoint is retained
for reads, while writes without revisions are rejected.

The following validation paragraph records the earlier review, before the upgrade.

Validation: 205 tests passed in the full Vitest run. After adding two final malformed-input
regressions, all 127 affected tests passed in a targeted run (207 tests now defined).
Whitespace/diff checks passed, and `npm audit --json` completed successfully.
The dependency audit reported zero known vulnerabilities; that is not a guarantee
that dependencies or application logic contain no vulnerabilities.
