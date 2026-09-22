# Running and deploying Rounds

How the app fits together, how to work on it, and how to put changes live.

## How Rounds fits together

Rounds runs entirely on Cloudflare. One command, `npm run deploy`, puts the website
and the API online together at https://rounds.termanitor07.workers.dev.

```mermaid
flowchart LR
  B[Your browser] --> W[Cloudflare Worker<br/>rounds]
  W -->|/api/* requests| API[worker/<br/>API code]
  W -->|everything else| P[public/<br/>HTML, CSS, JS]
  API --> D[(D1 database<br/>rounds)]
```

Pages load from `public/`. Anything under `/api/`, such as signing in or saving an
item, runs the code in `worker/`, which reads and writes the D1 database.

| Piece | Folder or place | What it does |
| --- | --- | --- |
| Front end | `public/` | The pages, styles and scripts your browser runs |
| API | `worker/` | Sign-in, sessions, and saving courses, items and quotes |
| Database | Cloudflare D1, named `rounds` | Stores users and everyone's data |
| Schema changes | `migrations/` | Numbered SQL files that build and change the database |
| Settings | `wrangler.jsonc` | Tells Cloudflare the app name, the database and the nightly cleanup job |
| Secret | `SESSION_SECRET` | Signs login cookies. Locally it's in `.dev.vars`; live it's stored in Cloudflare |

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
2. Edit files in `public/` (what you see) or `worker/` (the API).
3. Run `npm test`. All tests should pass (93 today). A failing test means something
   broke, so fix it before deploying.
4. Save the change in Git:
    ```
    git add -A
    git commit -m "Say what changed"
    git push
    ```

One catch: if you edit the small inline script inside `public/index.html`, run
`node scripts/csp-hash.mjs` and paste the hash it prints into `public/_headers`. If
you skip this, the browser's security policy blocks that script on the live site.

## Deploying

To put your changes live, run `npm run deploy` from the project folder. It first
applies any new database changes to the live database, then uploads the website and
API. It takes under a minute.

```mermaid
flowchart LR
  A[npm test<br/>all pass] --> B[git commit<br/>and push]
  B --> C[npm run deploy]
  C --> D[Live database<br/>migrations]
  D --> E[Upload site<br/>and API]
  E --> F[Sign in on<br/>live site]
```

**Before you deploy**

- [ ] `npm test` passes
- [ ] You tried the change locally with `npm run dev`
- [ ] The change is committed and pushed, so GitHub matches what goes live

**While it runs**

If there are new migrations, it lists them and asks `continue? (Y/n)`. Type Y and
press Enter. If there are none, it says "No migrations to apply!" and carries on. If
the migration step fails, the deploy stops, so new code never goes live on an old
database.

**After it finishes**

1. Open https://rounds.termanitor07.workers.dev and sign in.
2. Check the thing you changed.
3. If something is wrong, see [Troubleshooting](#troubleshooting) below. To undo
   quickly, run `npx wrangler rollback` to put the previous version back. Rollback
   restores the code only; database changes stay.

## Changing the database

The database's shape (its tables and columns) changes only through numbered files in
`migrations/`. Each database remembers which files it has already run, so each file
runs once per database.

| File | What it adds |
| --- | --- |
| `0001_init.sql` | Users, courses, items and quotes |
| `0002_login_throttle.sql` | The table that counts wrong passwords, for lockouts |
| `0003_password_generation.sql` | A counter that powers "sign out everywhere" |

To change the database:

1. Add a new file with the next number, such as `0004_something.sql`. Never edit a
   file that has already run.
2. Apply it locally with `npm run db:local`, then test.
3. Deploy. `npm run deploy` applies it to the live database first.

To see what the live database is missing, run
`npx wrangler d1 migrations list rounds --remote`. "No migrations to apply!" means
it's up to date. To apply migrations to live without deploying code, use
`npm run db:remote`.

## Managing accounts

There's no sign-up page, so you create every account yourself from the command line.
Add `--remote` to act on the live site; leave it off to act on your local database.

| To do this | Run |
| --- | --- |
| Create an account | `npm run user:add -- username --remote --name "Their Name"` |
| Change a password | `npm run user:add -- username --reset --remote` |
| Delete an account and all its data | `npm run user:add -- username --delete --remote` |

Each command asks for the password twice and hides what you type. Delete asks you to
type the username again to confirm, and it can't be undone.

- **Usernames** are 3 to 32 letters, digits, dots, dashes or underscores. Capital
  letters don't matter.
- **Lockouts:** after 5 wrong passwords, that username is locked for 1 minute. Each
  further wrong guess doubles the wait, up to 1 hour. The sign-in screen shows how
  long to wait.
- **Staying signed in:** a sign-in lasts 30 days and renews itself automatically while
  the app is used.
- **Sign out everywhere:** changing a password signs that person out on every device.

## Troubleshooting

Most problems show up as a message on the sign-in screen. Find it here, then do what
the right-hand column says.

| What you see | What it means | What to do |
| --- | --- | --- |
| Sign-in failed (internal) | The server hit an error, usually because the live database is missing a migration | Run `npx wrangler d1 migrations list rounds --remote`, then `npm run db:remote` if anything is listed |
| Wrong username or password | No such account on this site, or the password is wrong | Local and live accounts are separate. Create or reset the account with `npm run user:add` (add `--remote` for live) |
| Too many attempts. Try again in N min. | 5 or more wrong passwords | Wait it out, or reset the password |
| You seem to be offline. | The browser couldn't reach the server | Check your internet. Locally, make sure `npm run dev` is still running |
| Sign in from the app itself, not from another site. | The request came from a different web address | Open the site directly at its own address |
| Page loads but a script is blocked | The inline script changed without its security hash | Run `node scripts/csp-hash.mjs` and update `public/_headers` |

To see the live server's errors as they happen, run `npx wrangler tail`, then
reproduce the problem in the browser. Press Ctrl+C to stop.

**What happened on 2026-09-21:** every live sign-in failed with "internal". The code
had been deployed, but the live database was still missing migrations 0002 and 0003.
Running `npm run db:remote` fixed it, and `npm run deploy` now applies migrations
automatically so this can't recur.

## Command cheat sheet

Run every command in PowerShell from the project folder.

| Command | What it does | Affects |
| --- | --- | --- |
| `npm run dev` | Runs the app at http://localhost:8787 | Local |
| `npm test` | Runs all tests | Local |
| `npm run db:local` | Applies new migrations to the local database | Local |
| `npm run deploy` | Applies new migrations to live, then publishes the site and API | Live |
| `npm run db:remote` | Applies new migrations to live without deploying code | Live |
| `npx wrangler d1 migrations list rounds --remote` | Shows migrations the live database is missing | Live, read-only |
| `npx wrangler deployments list` | Shows when each version went live | Live, read-only |
| `npx wrangler rollback` | Puts the previous code version back | Live |
| `npx wrangler tail` | Streams live server errors | Live, read-only |
| `npm run user:add -- name --remote` | Creates a live account (`--reset` or `--delete` to change or remove one) | Live |
| `npx wrangler login` | Connects this computer to your Cloudflare account | Neither |
