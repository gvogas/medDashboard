# Admin dashboard — design

Approved 2026-10-01. Built on branch `admin`.

## Access

- `users.is_admin` (0/1). The first admin is set from the terminal:
  `npm run user:add -- george --admin --remote` (`--admin --off` removes it).
- The sidebar lists **Admin** only when the profile says `isAdmin`. Every
  `/api/admin/*` route checks the flag on the server (`requireAdmin`, 403 otherwise).

## The page (src/components/admin/)

| Tab | What it does |
|---|---|
| Overview | Free-plan meters for today (Worker requests /100k, Workers AI neurons /10k, D1 rows read /5M and written /100k, D1 storage /5 GB), requests and errors per hour (24 h / 7 d), and a health panel (schema up to date, nightly cron's last run, Workers AI bound, secrets set — yes/no only, errors in 24 h). |
| Accounts | New account (username, display name, password, admin). Table: last seen, courses, items, study time, Spotify / calendar feed / leaderboard. Per row: new password (signs out everywhere, lifts locks), sign out everywhere, make/remove admin, delete (type the username). Locked sign-ins with Unlock. |
| Errors | 500s and failed AI reads from the last 7 days, grouped by route and message with counts; the latest 50 one by one. |
| Audit log | Who created, reset, signed out, deleted, promoted, demoted, unlocked or announced what; 90 days. |
| Announcement | A message (≤ 280 chars) shown to everyone for 1 h – 30 days, or taken down. |

Guards (server-side): an admin cannot delete or demote themselves; the last admin
cannot be removed (also enforced inside the UPDATE, so two admins cannot race).

## Data

In `migrations/0001_schema.sql` (squashed; live data moved to `rounds-v6`):

- `users.is_admin`, `users.last_seen_day` — the latter written by `GET /api/me`
  at most once per person per UTC day.
- `error_log` — written by `handleApi`'s 500 path and `aiRead`'s failure path;
  at most 500 rows per UTC day (`worker/errors.js`); 30 days.
- `admin_log` — written in the same D1 batch as each admin action; 90 days.
- `app_meta` — `announcement` (`{id, text, until}`) and `cron` (last nightly run).

The nightly cron purges both logs and records its run.

## Traffic source

`worker/analytics.js` asks Cloudflare's GraphQL Analytics API
(`workersInvocationsAdaptive`, `aiInferenceAdaptiveGroups`,
`d1AnalyticsAdaptiveGroups`, `d1StorageAdaptiveGroups`), one query per dataset so
one failure leaves the rest; cached 60 s. Needs `CF_ACCOUNT_ID` (var) and
`CF_ANALYTICS_TOKEN` (secret, "Account Analytics: Read" only). Without them the
Overview explains how to set it up; nothing else depends on it. No D1 writes.

## Announcement delivery

`GET /api/me` adds `announcement` to the profile it returns; the app shows it as a
banner above the page. Closing it is remembered per browser by the announcement's
id, so a replaced message shows again.

## Tests

- `test/admin.test.js` — 403 for non-admins, create/reset/revoke/promote/delete,
  self guards, unlock, error logging and its daily cap, announcement via `/api/me`,
  health, analytics aggregation with a fake GraphQL answer.
- `src/components/admin/admin.test.tsx` — sidebar entry for admins only, page
  refuses non-admins, overview, accounts list, create errors, typed delete, banner.
