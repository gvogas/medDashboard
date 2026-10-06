# Reliability upgrade

This update changes local storage, the sync protocol, release assets, and Spotify
key storage. No production migration or deployment was performed while implementing it.

## Before deploying

1. Run `npm ci`, `npm run spotify:key`, and `npm run check` locally. The key command
   adds a separate random key to the ignored `.dev.vars` file if one is absent;
   it never prints or replaces an existing key.
2. Provision the Worker secret `SPOTIFY_TOKEN_KEYS` using
   `npx wrangler secret put SPOTIFY_TOKEN_KEYS`. Its value is JSON of this shape:
   `{"current":"v1","keys":{"v1":"<independent random secret, at least 32 characters>"}}`.
   Use a securely generated value, not the placeholder. Do not commit the secret.
   The existing SESSION_SECRET and SPOTIFY_CLIENT_SECRET remain required.
3. Deploy with `npm run deploy`. It runs tests and the release build, checks that the
   required secret names exist, applies migrations (including 0006 and 0007), then deploys
   the Vite build in `dist/client`. The build verifies the inline theme script's CSP hash and refuses
   inline style attributes. Update the theme hash with `npm run csp:update` when needed.
4. Ask users to close older tabs and reopen Rounds. IndexedDB upgrades wait for old
   connections; a blocked upgrade displays a useful message. Old clients get 428
   on tracker writes and retain their queued edits until they reload.
5. Check sign-in, two-tab saves, Settings saved copies, sign-out, and Spotify on the
   deployed site. The local HTTP smoke check cannot establish production behavior.

The app retains Cloudflare Workers, D1, and plain JavaScript. It does not require
React, a separate service, or a new production dependency.

## Data behavior

Local rows and individual pending operations commit in one IndexedDB transaction.
Each operation has a persisted token; acknowledging an older upload cannot erase a
newer edit. Web Locks coordinate network sync across tabs; IndexedDB transactions
protect the shared queue. Another tab editing the same unsent row preserves the
previous copy for review. Cross-tab account changes stop old requests, and an
account header is checked against the authenticated user on the server.

Every tracker write uses a row revision. Stale writes return a conflict and the
browser preserves the local edit in Settings. Restoring it uses a revision check
again. Export includes tracker data, pending operations, and saved copies; the file
contains personal data and should be stored appropriately. It is a recovery export,
not an automated import format.

Sync pages use an increasing SQLite change sequence, with at most 100 changes per
page. Live records retain their latest change. Deletion history expires after 30
days; the same purge transaction advances a cursor floor. Returning devices with
older cursors rebuild clean rows while retaining pending work. Legacy queued edits
to existing records are retained for review rather than silently overwriting newer
server data. The detailed protocol is in DATA-MODEL.md.

Sign-out warns about pending edits or saved copies. After server sign-out, it closes
connections across tabs and confirms database deletion. If deletion fails or stays
blocked, it reports incomplete cleanup and leaves a marker so later openings retry.
Offline tracker data still relies on the browser/OS profile's privacy protections.

## Spotify keys and modules

`worker/spotify.js` contains playback/library operations. `worker/spotify/` separates
transport and deadlines, token management, authenticated requests, and response mapping.

New refresh tokens are stored as `keyId.ciphertext`. Rotating SESSION_SECRET no longer
invalidates these tokens. To rotate token keys, add a new random key under a new ID,
set `current` to that ID, and retain previous keys while existing tokens migrate on
refresh. Missing key IDs fail without deleting credentials.

Unversioned legacy tokens are decrypted using SPOTIFY_LEGACY_TOKEN_SECRET, falling
back to SESSION_SECRET during migration. Before rotating SESSION_SECRET while legacy
tokens remain, preserve the old value in SPOTIFY_LEGACY_TOKEN_SECRET. A refresh reseals
the token under the current independent key, even if Spotify does not rotate its token.
Do not remove old keys until their stored-token counts are zero, or reconnect those users.

## Releases and rollback

`npm run build` runs `vite build`, which writes `dist/`. Scripts and styles live beneath
`/assets/` with a content hash in each name, so a page keeps loading its own release;
the service-worker asset list and cache name are generated from the build.
The worker waits for existing pages to close before activating a new cache, avoiding
an immediate takeover of pages running an older release. Static responses revalidate;
API responses remain `no-store`. CI runs the same tests and build as deployment.

Keep migration 0006 when rolling back. Do not roll the server back to code that
accepts unconditional writes while revision-aware clients are active. Use a forward
fix or a revision-compatible rollback. A Cloudflare code rollback does not undo D1
migrations or browser IndexedDB upgrades.

## Validation

`npm run check` passed: 218 Worker tests, 9 local-storage tests, and a build of
35 versioned assets. JavaScript syntax and `git diff --check` also passed.

Automated checks cover atomic rollback, concurrent local connections, migration of
queued edits, acknowledgement during edits, durable conflict recovery, deletion after
versionchange, concurrent server writers, stale course deletion, paginated changes,
expired cursors, account isolation, and Spotify encryption-key rotation. Existing
Worker security and Spotify tests remain part of the release check.

An isolated local Worker was used to verify all versioned assets, CSP script hash,
style policy, login, conditional writes, API cache policy, sync, and deletion.
Interactive browser verification could not run because neither browser connection
was available. Real Spotify playback and the production rollout remain to be checked.

The development dependency override for sharp selects the patched 0.35.4-or-newer
line for GHSA-rgj7-g3m4-5g8c. Remove the override when upstream tooling requires a
patched version itself. The dependency audit reported zero known vulnerabilities
after installation; it does not establish that the entire application is secure.

## Follow-up: request and sync reliability

The browser now rejects malformed successful API replies instead of treating them
as saved edits. Tracker writes must return the requested record with a newer,
positive integer revision. Deletes must return an empty success response. Profiles
must match the bound account, and change pages must have valid record identities,
revisions, collection names, and cursors before reconciliation starts. Invalid
responses leave operations queued for retry. A write that reached the server but
lost its acknowledgement can still become a saved conflict copy on retry; it is
never retried as an unconditional overwrite.

Every browser request has a 30-second deadline covering both fetch and response
body reading. Changing the bound account cancels outstanding requests. Stopping
sync cancels a waiting Web Lock and prevents delayed uploads, pages, conflict
lookups, or profiles from changing local storage after the cycle is stopped,
including when sync has already resumed. Lock acquisition errors enter the normal
retry path. Large pulls yield after 20 requests and stay pending until the remaining
pages finish; the last successful pull time advances only after completion.

Acknowledging an upload while a newer edit is queued now updates both the queued
revision and the local row's revision without replacing the newer content.
Restoring a saved conflict copy uses the latest locally known server revision.
Editing a migrated operation retains its review requirement until it is reviewed.

Regression coverage includes malformed replies, stalled response bodies, account
switches, stopped sync cycles, queued lock cancellation, incomplete pagination,
and local revision handling. A browser-client integration test checks profile
updates, quote writes, change pages, and deletions against the real Worker and D1.
Run `npm test` and `npm run build` to verify these changes and the release CSP.
These changes require no additional database migration or dependency.

## Database structure migration (0007)

The separate database cleanup adds migration `0007_database_structure.sql`. It
corrects the composite course relationship, enforces positive integer item
revisions, adds indexes for course references and expired operational records, and
provides read-only `active_items` and `account_summary` views. It copies existing
items without changing their fields or generating new sync events. Failed copies
roll back; account records, other tracker tables, and credentials are not rebuilt.

Run `npm run db:local` and `npm run db:check` to apply and inspect the local database.
The check can also inspect production explicitly with `-- --remote`; it performs no
repairs or deletions. Migration tests verify preservation of legacy rows, JSON
fields, tombstones, revisions, and change cursors, as well as atomic rollback.
See [the current data model](DATA-MODEL.md) for the schema diagram, table purposes,
index coverage, inspection views, and maintenance commands.
