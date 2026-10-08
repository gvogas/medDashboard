# Running and deploying Rounds

How the app fits together, how to work on it, and how to put changes live. The app is
called Term; its internal name, used for the Worker, the database and the cookies, is
`rounds`.

## How Rounds fits together

Rounds runs entirely on Cloudflare. The website and the API go online together at
https://rounds.termanitor07.workers.dev, usually by pushing `main` (see
[Deploying](#deploying)).

```mermaid
flowchart LR
  B[Your browser] --> W[Cloudflare Worker<br/>rounds]
  W -->|/api/* requests| API[worker/<br/>API code]
  W -->|everything else| P[dist/client/<br/>HTML, CSS, JS built by Vite]
  API --> D[(D1 database<br/>rounds-v7)]
```

Pages load from the Vite build in `dist/client/`. Anything under `/api/`, such as signing in or saving an
item, runs the code in `worker/`, which reads and writes the D1 database.

| Piece | Folder or place | What it does |
| --- | --- | --- |
| Front end | `index.html`, `src/`, `public/` | The pages, styles and scripts your browser runs; `npm run build` turns them into `dist/client/` |
| API | `worker/` | Sign-in, sync, shared classes, Spotify, AI import and the Admin page. The endpoints are listed in [DATA-MODEL.md](DATA-MODEL.md) |
| Database | Cloudflare D1, named `rounds-v7` (binding `DB`) | Stores users and everyone's data. `rounds-v6` is kept as a backup |
| Schema changes | `migrations/` | Numbered SQL files that build and change the database |
| Settings | `wrangler.jsonc` | The app name, the static assets in `dist/client/`, the database, the Workers AI binding, public vars (`SPOTIFY_CLIENT_ID`, `CF_ACCOUNT_ID`) and the nightly cleanup job |
| Secret | `SESSION_SECRET` | Signs login cookies. Locally it's in `.dev.vars`; live it's stored in Cloudflare |
| Secret | `SPOTIFY_CLIENT_SECRET` | Lets the Worker talk to Spotify for the player. Same two places. The matching client id is in `wrangler.jsonc` |
| Secret | `SPOTIFY_TOKEN_KEYS` | Encrypts stored Spotify refresh tokens (see [Spotify keys](#spotify-keys)). Required whenever the client id is set |
| Secret | `CF_ANALYTICS_TOKEN` | Optional. A Cloudflare API token with only "Account Analytics: Read", for the Admin page's traffic chart |

There are two copies of everything. **Local** is what `npm run dev` runs on your
computer, with its own test database. **Live** (also called remote or production) is
what people actually use. Changes reach live only when you deploy.

## Setting up a new computer

You do this once per computer. After that, the everyday commands just work.

1. Install [Node.js](https://nodejs.org) (the LTS version) and [Git](https://git-scm.com).
2. Get the code and install its tools. Run these in PowerShell:
    ```
    git clone https://github.com/gvogas/medDashboard.git tracker
    cd tracker
    npm install
    ```
3. Sign in to Cloudflare with `npx wrangler login`. A browser window opens; approve it
   with the Cloudflare account that owns Rounds.
4. Make the local secret file. Copy `.dev.vars.example` to `.dev.vars`, then replace
   `change-me-locally` with any long random string. This file is never committed to Git.
   The two Spotify lines can stay empty unless you want the player locally (see
   [Spotify](#spotify) below).
5. Build the local database with `npm run db:local`.
6. Make yourself a local account with `npm run user:add -- yourname --name "Your Name"`.
   It asks for a password twice and doesn't show what you type.

The live site already has its secret and database, so this setup doesn't touch it.
Your local account is separate from your live account, and the two can have
different passwords.

## Working on it day to day

Make and try every change locally first. Nothing you do locally affects the live site.

1. Start the local server with `npm run dev`, then open http://127.0.0.1:8787 and sign
   in with your local account. Leave the command running. It picks up most edits when
   you save; press Ctrl+C to stop it.
2. Edit files in `src/` (what you see) or `worker/` (the API).
3. Run `npm test`. Both the Worker tests and local-storage regression tests should pass. A failing test means something
   broke, so fix it before deploying.
4. Save the change in Git:
    ```
    git add -A
    git commit -m "Say what changed"
    git push
    ```
   Pushing `main` puts the change live (see [Deploying](#deploying)). Work on a branch
   until it is ready.

One catch: if you edit the small inline script inside `index.html`, run
`npm run csp:update` to update `public/_headers`. The release build stops if the hash is stale.

## Deploying

Cloudflare's Git integration deploys the site. Every push to `main` on GitHub makes
Cloudflare run `npm run build` and upload the result. That build does **not** run the
tests and does **not** apply database migrations to the live database.

```mermaid
flowchart LR
  A[npm run check<br/>passes] --> M{New<br/>migration?}
  M -->|yes| D[npm run db:remote<br/>then db:check --remote]
  M -->|no| P
  D --> P[git push<br/>to main]
  P --> E[Cloudflare builds<br/>and uploads]
  E --> F[Sign in on<br/>live site]
```

**Before you push to `main`**

- [ ] `npm run check` passes (types, all tests and the release build)
- [ ] You tried the change locally with `npm run dev`, or `npm run dev:built` to try
      the built, versioned site that goes live
- [ ] If the change adds a migration, you applied it to live **first** with
      `npm run db:remote`, then ran `npm run db:check -- --remote`. New code on an old
      database fails with 500s until the migration is applied

`npm run deploy` is the manual route. It runs `npm run check`, checks the secret names,
applies migrations to live, runs the live database checks, then runs `wrangler deploy`.
Use it when Git deploys are unavailable; the next push to `main` deploys again anyway.
Never run a bare `wrangler deploy` with code that needs a migration not yet applied.

When `db:remote` finds new migrations, it lists them and asks `continue? (Y/n)`. Type
Y and press Enter. If there are none, it says "No migrations to apply!".

If a live request hits a missing table or column, `npx wrangler tail` shows "D1 schema
is behind the code" next to the error.

**After it goes live**

1. Open https://rounds.termanitor07.workers.dev and sign in.
2. Check the thing you changed.
3. If something is wrong, see [Troubleshooting](#troubleshooting) below. To undo
   quickly, run `npx wrangler rollback` to put the previous version back. Rollback
   restores the code only; database changes stay. Don't roll back past a release that
   raised the IndexedDB version: browsers that already upgraded can't open their
   local data with the older code. Fix forward instead.

## Changing the database

The database's shape (its tables and columns) changes only through numbered files in
`migrations/`. Each database remembers which files it has already run, so each file
runs once per database.

| File | What it adds |
| --- | --- |
| `0001_schema.sql` | The whole schema up to the last squash: users, courses, items, quotes, study, Spotify tokens, the change feed (see [DATA-MODEL.md](DATA-MODEL.md)) |
| `0002_spaces.sql` | Shared spaces (classes and projects) and their `members` |
| `0003_invites.sql` | `invites`: invitations to a space by username |
| `0004_marks.sql` | `marks` (your status, grade and notes on a shared item) and `space_prefs` (your colour, target and term for a space) |
| `0005_plans.sql` | `plans` (Term Pro: App Store, web or given) and `billing_events` (webhook ids already applied); `admin_log` learns `comp`/`uncomp` |
| `0006_apple.sql` | `apple_accounts`: Apple IDs linked to Term accounts (Sign in with Apple) |

To change the database:

1. Add a new file with the next number, `0007_something.sql`. Never edit a file that
   has already run.
2. Apply it locally with `npm run db:local`, then test.
3. Apply it to live with `npm run db:remote` **before** pushing the code that needs
   it, then check with `npm run db:check -- --remote`.

To see what the live database is missing, run
`npx wrangler d1 migrations list DB --remote`. "No migrations to apply!" means
it's up to date.

`npm run db:check` runs read-only integrity checks and prints row counts for the
local database; add `-- --remote` for live. It never changes records.

## Moving to a fresh database

Now and then the migrations are folded into one `0001_schema.sql` and the live data
is moved into a new, empty database. This keeps every row and the change-feed position,
so devices sync on without a reset. The last move was `rounds-v6` to `rounds-v7` on
2026-10-05.

1. Fold the migrations into `migrations/0001_schema.sql`. Move the files the live
   database was built from into `test/fixtures/legacy-migrations/`.
2. If the old database has tables or columns the copy doesn't know, add them to
   `TABLES` in `scripts/lib/move-db.js`. The script refuses to run while anything
   would be dropped.
3. Create the new database with `npx wrangler d1 create rounds-vN`, point the `DB`
   binding in `wrangler.jsonc` at it, and apply the schema with `npm run db:remote`.
4. Rehearse locally first, then copy live:
    ```
    npm run build
    node scripts/move-db.mjs --from rounds-v7 --to rounds-vN --remote
    ```
   It only reads the old database, refuses a target that already holds data, and
   compares both afterwards. Don't pipe its output, or you lose its exit code.
5. Deploy straight away (`npx wrangler deploy`) so no live edits land in the old
   database, then run `npm run db:check -- --remote` and push `main`.
6. Keep the old database as a backup until you're sure the move went well.

## Maintenance switches

The Admin page's **Maintenance** tab turns features off while you fix them: the whole
app, week, month, all items, study, music, import with AI, and shared classes and
projects, with an optional message. No deploy is needed. People who aren't admins get
a maintenance page for that feature; admins get a bar and can still use it. Sync of
personal data keeps working. Shared-class edits made meanwhile wait in the browser and
upload once the switch is off.

## Spotify

The player on the coat is off until Rounds has a Spotify app of its own. Setting one up
is done once, by whoever owns the Cloudflare account, and takes about ten minutes.
Spotify's rules, as of 2026: the app's owner needs Spotify Premium; up to five people
can use the app, each added by email; and playback controls only work for listeners
with Premium (free listeners still see what is playing).

1. Go to [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard),
   sign in with your Spotify account and create an app. Any name and description.
2. Under **Redirect URIs** add both of these, exactly:
    ```
    https://rounds.termanitor07.workers.dev/api/spotify/callback
    http://127.0.0.1:8787/api/spotify/callback
    ```
   Tick *Web API* and *Web Playback SDK* under the APIs used. Save.
3. In the app's **User Management** tab add the name and Spotify email of each person
   who wants the player, yourself included. Spotify allows five.
4. Copy the **Client ID** from the app's settings into `wrangler.jsonc`:
    ```jsonc
    "vars": { "SPOTIFY_CLIENT_ID": "paste it here" },
    ```
   and into `.dev.vars` as `SPOTIFY_CLIENT_ID=...` for local runs.
5. Show the **Client secret** and store it. Live, in Cloudflare:
    ```
    npx wrangler secret put SPOTIFY_CLIENT_SECRET
    ```
   It asks for the value and hides what you paste. Locally, put it in `.dev.vars` as
   `SPOTIFY_CLIENT_SECRET=...`.

   Then the key that encrypts stored refresh tokens. Locally, `npm run spotify:key`
   adds one to `.dev.vars`. Live, `npx wrangler secret put SPOTIFY_TOKEN_KEYS` with the
   JSON keyring described under [Spotify keys](#spotify-keys).
   `npm run deploy` refuses to run while it is missing.
6. Commit the new client id and push `main` (or run `npm run deploy`). The
   `spotify_tokens` table is already in the schema.
7. In Rounds, open Settings, find **Spotify** and click **Connect**. Spotify asks you
   to allow Rounds to see and control playback, then sends you back. The badge at the
   bottom of the sidebar shows what is playing; start something in the Spotify app
   on any device if it says *Nothing playing*. The **Spotify** view in the top bar
   has search, your playlists, the queue and volume.
8. The Rounds tab is itself a Spotify device, called **Rounds**, in desktop Chrome,
   Edge or Firefox. With no Spotify app open anywhere, press play (or pick something
   in the Spotify view) and it plays in the tab. If music is on another device, the
   badge shows **Play here** to move it into the tab. It never takes over on its own,
   and the music stops when the tab closes. Phone browsers are not supported by
   Spotify, so there Rounds only controls another device.

If you connected before the in-tab player existed, Settings says *Reconnect Spotify to
play in this browser*: click **Reconnect** once to grant the new permission.

Locally, open the dev server at `http://127.0.0.1:8787`, not `localhost`: Spotify no
longer accepts `localhost` as a redirect.

Each person connects their own account from their own Settings; nobody sees anyone
else's. **Disconnect** in Settings forgets the connection on the Rounds side; to
revoke it on Spotify's side too, remove Rounds under *Manage apps* in the Spotify
account settings. The stored refresh tokens are encrypted under `SPOTIFY_TOKEN_KEYS`,
not `SESSION_SECRET`, so rotating the session secret leaves Spotify connected.

If the badge says *Open Spotify on a device first*, Spotify has no active device:
press play in the Spotify app once and the controls work from then on. *Controls need
Spotify Premium* means the listener's account is free. *Spotify is not answering* is
Spotify's side; the badge dims and tries again on its own. The volume slider is greyed
out when the playing device does not take volume from the API, which is the case for
phones; it works for the desktop app and web player.

### Spotify keys

`SPOTIFY_TOKEN_KEYS` is one JSON secret of this shape:

```json
{"current":"v1","keys":{"v1":"<random secret, at least 32 characters>"}}
```

Use a securely generated value, never the placeholder, and never commit it. Refresh
tokens are stored as `keyId.ciphertext`, sealed under the `current` key.

- **Rotating:** add a new random key under a new id, set `current` to that id, and
  keep the old keys. Each token is resealed under the current key the next time it
  refreshes. Remove an old key only once no stored token uses it, or have those people
  reconnect. A token whose key id is missing fails without being deleted.
- **Old tokens:** tokens stored without a key id predate the keyring. They are read
  with `SPOTIFY_LEGACY_TOKEN_SECRET`, or `SESSION_SECRET` when that is unset. Before
  rotating `SESSION_SECRET` while any remain, put the old value in
  `SPOTIFY_LEGACY_TOKEN_SECRET`.

## Managing accounts

There's no sign-up page, so you create every account yourself from the command line.
Add `--remote` to act on the live site; leave it off to act on your local database.

| To do this | Run |
| --- | --- |
| Create an account | `npm run user:add -- username --remote --name "Their Name"` |
| Change a password | `npm run user:add -- username --reset --remote` |
| Delete an account and all its data | `npm run user:add -- username --delete --remote` |
| Give someone the Admin page | `npm run user:add -- username --admin --remote` (`--admin --off` takes it away) |

Create and reset ask for the password twice and hide what you type. Delete asks you to
type the username again to confirm, and it can't be undone.

Once you are an admin, the **Admin** page does the same jobs in the browser: create
accounts, reset passwords, give or take admin, and delete accounts. It also shows usage
against the daily limits, the error and audit logs, an announcement banner, the
[maintenance switches](#maintenance-switches), which secrets are set, and live traffic
(needs `CF_ANALYTICS_TOKEN`).

- **Usernames** are 3 to 32 letters, digits, dots, dashes or underscores. Capital
  letters don't matter.
- **Lockouts:** after 5 wrong passwords, that username is locked for 1 minute. Each
  further wrong guess doubles the wait, up to 1 hour. The sign-in screen shows how
  long to wait. A browser that has signed in as that name before has its own count,
  so someone else's wrong guesses don't lock you out there.
- **Staying signed in:** a sign-in lasts 30 days and renews itself automatically while
  the app is used.
- **Sign out everywhere:** changing a password signs that person out on every device.

## Troubleshooting

Most problems show up as a message on the sign-in screen. Find it here, then do what
the right-hand column says.

| What you see | What it means | What to do |
| --- | --- | --- |
| Sign-in failed (internal) | The server hit an error, usually because the live database is missing a migration | Run `npx wrangler d1 migrations list DB --remote`, then `npm run db:remote` if anything is listed |
| Wrong username or password | No such account on this site, or the password is wrong | Local and live accounts are separate. Create or reset the account with `npm run user:add` (add `--remote` for live) |
| Too many attempts. Try again in N min. | 5 or more wrong passwords | Wait it out, or reset the password |
| You seem to be offline. | The browser couldn't reach the server | Check your internet. Locally, make sure `npm run dev` is still running |
| Sign in from the app itself, not from another site. | The request came from a different web address | Open the site directly at its own address |
| `npm run dev` stops with `Port 8787 is already in use` | Another server already holds port 8787. It is pinned there because it's the address registered with Spotify | Close the other `npm run dev` window, or run `Get-NetTCPConnection -LocalPort 8787` in PowerShell to find the process |
| Spotify's own page says "Too many requests" | Spotify rate-limits its sign-in page after several tries | Wait 15–30 minutes, then click Connect once |
| Page loads but a script is blocked | The inline script changed without its security hash | Run `npm run csp:update`, which rewrites the hash in `public/_headers` |

To see the live server's errors as they happen, run `npx wrangler tail`, then
reproduce the problem in the browser. Press Ctrl+C to stop.

**Live 500s or "internal" errors: check migrations first.** Pushing `main` deploys
code without applying migrations, so new code can reach a database that lacks its
tables. This happened on 2026-09-21, when every live sign-in failed. Run
`npx wrangler d1 migrations list DB --remote`; if anything is listed, run
`npm run db:remote`, then `npm run db:check -- --remote`.

## Term Pro, Sign in with Apple and the apps

Paid plans, Sign in with Apple and the iPhone/Mac app are described in [MONETIZATION.md](MONETIZATION.md) and
[IOS.md](IOS.md). On the Worker side they use these settings:

| Setting | Where | What it does |
| --- | --- | --- |
| `PAYWALL` | `vars` in `wrangler.jsonc` | `"on"` limits the free plan (3 AI reads a day, two themes). `"off"` (the default) gives everyone everything. |
| `BILLING_SANDBOX` | `vars` | `"on"` lets TestFlight's sandbox purchases count. Turn it off for the public launch. |
| `MIN_APP_VERSION` | `vars` | App builds older than this get `426 update_required`. Empty asks none. |
| `APPLE_CLIENT_IDS`, `APPLE_TEAM_ID`, `APPLE_KEY_ID` | `vars` | Sign in with Apple: the app's bundle id and the website's Services ID, comma-separated (empty turns it off), and the team and key ids. See IOS.md. |
| `APPLE_PRIVATE_KEY` | `npx wrangler secret put APPLE_PRIVATE_KEY` | The `.p8` key, used to revoke Apple's grant when an account is deleted. Without it, sign-in still works but nothing is revoked. |
| `SIGNUPS` | `vars` | `"open"` lets a new Apple ID make an account; `"closed"` (the default) keeps Term invite-only. |
| `REVENUECAT_WEBHOOK_SECRET` | `npx wrangler secret put REVENUECAT_WEBHOOK_SECRET` | The value RevenueCat sends as `Authorization: Bearer …` on its webhook to `/api/billing/revenuecat`. Without it the webhook answers `503`. |

Give someone Pro for free from the Admin page (Accounts → Give Pro). Before turning
`PAYWALL` on, give it to everyone who was using Term before, so nobody loses anything.

## Command cheat sheet

Run every command in PowerShell from the project folder.

| Command | What it does | Affects |
| --- | --- | --- |
| `npm run dev` | Runs the app at http://127.0.0.1:8787 | Local |
| `npm run dev:built` | Builds, then runs the site the deploy uploads | Local |
| `npm test` | Runs all tests | Local |
| `npm run check` | Type check, all tests and the release build | Local |
| `npm run csp:update` | Rewrites the inline script's hash in `public/_headers` | Local |
| `npm run db:local` | Applies new migrations to the local database | Local |
| `npm run db:check` | Read-only database checks and row counts (`-- --remote` for live) | Local or live, read-only |
| `git push` to `main` | Cloudflare builds and publishes the site and API (no migrations) | Live |
| `npm run deploy` | Manual deploy: checks, applies migrations to live, checks the live database, then publishes | Live |
| `npm run db:remote` | Applies new migrations to live without deploying code | Live |
| `npx wrangler d1 migrations list DB --remote` | Shows migrations the live database is missing | Live, read-only |
| `npx wrangler deployments list` | Shows when each version went live | Live, read-only |
| `npx wrangler rollback` | Puts the previous code version back | Live |
| `npx wrangler tail` | Streams live server errors | Live, read-only |
| `npm run user:add -- name --remote` | Creates a live account (`--reset`, `--delete` or `--admin` to change one) | Live |
| `npx wrangler login` | Connects this computer to your Cloudflare account | Neither |
