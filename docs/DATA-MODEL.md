# Rounds — data model

Cloudflare D1 (SQLite), several users, every row stamped with the owner's `user_id`.
The browser never talks to the database. A Worker reads the session cookie, resolves
the user, and every query it runs has `user_id = ?` in it.

```
users            one row per Google account: profile, coat, theme
courses          a course + its weekly class meetings, as a JSON column
items            exams, assignments, labs, tutoring, office hours, tasks
quotes           the quote tile's list
```

The schema is [`migrations/0001_init.sql`](../migrations/0001_init.sql). This document
explains it.

Conventions used throughout:

- **Ids** are client-generated strings, up to 24 chars (the prototype's are 7). The
  primary key of every user-owned table is `(user_id, id)`, so two people can hold the
  same id without colliding and ownership is part of the key, not a filter you might
  forget.
- **Dates** are `YYYY-MM-DD` strings in *your* local calendar, never a timestamp.
  A deadline of "Friday 23:59" must not shift because you opened the app in another
  timezone, and ISO strings sort chronologically, so `date >= ?` works.
- **Times** are `HH:MM` 24-hour strings, or `''` for none. Displayed as `0800`.
- **Weekdays** are `0`–`6`, Sunday = 0, matching `Date.prototype.getDay()`.
- **Timestamps** (`created_at`, `updated_at`, `deleted_at`, `completed_at`,
  `imported_at`) are integers, milliseconds since the epoch, the same unit as
  `Date.now()`. The server sets `updated_at` on every write.
- **Deletes are soft.** `deleted_at` is set, the row stays, and the next `sync` pull
  tells other devices to drop it. A daily cron hard-deletes tombstones after 30 days.
- Small, always-read-together lists (class meetings, checklists, links) are **JSON
  columns**, not tables. They are read with their parent every time and never queried
  on their own. The schema checks they are valid JSON arrays and caps their length;
  the Worker validates each entry.

---

## `users`

| Column | Type | Rules | Notes |
| --- | --- | --- | --- |
| `id` | text, PK | random | Never the email, so an address change is one `UPDATE`. |
| `email` | text, unique | lower-cased | From the verified Google token. |
| `display_name` | text | ≤ 60 | From the Google account, editable. |
| `coat_name` | text | ≤ 28 | Embroidered on the pocket. |
| `coat_role` | text | ≤ 34 | The line under it, e.g. `MS II · Cardio block`. |
| `coat_color` | text | one of the five | Tints the sidebar fabric, pocket and embroidery. |
| `theme` | text | `light` \| `dark` \| `system` | |
| `term_start` | text \| null | `YYYY-MM-DD` | The week board's default start. Null means today. |
| `imported_at` | int \| null | | Set once the prototype's browser data is imported, so it can't run twice. |
| `created_at`, `updated_at` | int | | |

A row is created on first sign-in with the Google name and the defaults. The API
exposes it as the **profile**, with the coat fields nested: `{coat: {name, role,
color}, theme, termStart, ...}`.

The five course colours, which are also the coat colours:

| Name | Hex |
| --- | --- |
| Pink | `#E4749B` |
| Purple | `#8B5CC7` |
| Turquoise | `#17B3AE` |
| Baby blue | `#79B6EA` |
| Little lilac | `#BCA6E6` |

---

## `courses`

| Column | Type | Rules | Notes |
| --- | --- | --- | --- |
| `user_id`, `id` | text, PK | | |
| `code` | text | 1–8 | `CVS`, `ANAT`. Shown in the table and month chips. |
| `name` | text | 1–80 | `Cardiovascular Block`. |
| `color` | text | one of the five | Drives every chip, pip and card for this course. |
| `instructor` | text | ≤ 60 | `Dr. Alvarez`. |
| `term` | text | ≤ 40 | `2026 Autumn`. Used later for archiving. |
| `archived` | int 0/1 | | Hidden from the sidebar, kept for the record. |
| `meetings` | JSON array | ≤ 12 | The class timetable. |
| `created_at`, `updated_at`, `deleted_at` | int | | |

### `meetings[]` — one weekly class

| Field | Type | Rules | Notes |
| --- | --- | --- | --- |
| `id` | string | ≤ 24 | Client-generated, stable across edits. |
| `kind` | string | `Lecture` \| `Lab` \| `Seminar` \| `Tutorial` \| `PBL` \| `Clinical` | |
| `weekday` | number | 0–6 | |
| `start`, `end` | string | `HH:MM` | `end` after `start`. |
| `room` | string | ≤ 40 | `Hall A`, `Lab 3B · table 7`. |

These are what the **month view** shows, and only these. They are not `items` — a class
that meets every Monday all term is one array entry, expanded onto the calendar in the
client.

---

## `items`

One table for all six types. They share every column, differ only in which `status`
values apply, and the week board and table need them interleaved by date.

| Column | API field | Type | Rules | Notes |
| --- | --- | --- | --- | --- |
| `user_id`, `id` | `id` | text, PK | | |
| `type` | | text | see below | Fixed at creation, editable in the drawer. |
| `title` | | text | 1–140 | |
| `course_id` | `courseId` | text \| null | FK to `courses` | Cleared on every matching item when a course is deleted. The FK is composite, so it cannot point at another user's course. |
| `date` | | text | `YYYY-MM-DD` | For a deadline, the day it's due. For a recurring slot, the first occurrence. |
| `start`, `end` | | text | `HH:MM` or `''` | A deadline usually has `end` only (`23:59`). |
| `location` | `where` | text | ≤ 80 | Room, lab, platform. `where` is a SQL keyword, hence the rename. |
| `status` | | text | see below | |
| `grade` | | real \| null | 0–100 | Only meaningful when `status == 'graded'`. |
| `weight` | | real \| null | 0–100 | Reserved for grade projection (backlog item 3). |
| `notes` | | text | ≤ 5000 | The item's page. |
| `checklist` | | JSON array | ≤ 50 | `{id, text ≤140, done}`. Drives the pink progress bars. |
| `links` | | JSON array | ≤ 20 | `{label ≤60, url ≤500}`. |
| `recur` | | text \| null | `weekly` \| null | Office hours and standing tutorials. |
| `weekday` | | int \| null | 0–6 | Required when `recur == 'weekly'`, enforced by a table-level `CHECK`. |
| `recur_until` | `recurUntil` | text \| null | `YYYY-MM-DD` | End of term; null means open-ended. |
| `dept` | | text | ≤ 40 | Office hours only: the faculty's department, shown greyed. |
| `completed_at` | `completedAt` | int \| null | | Stamped when status leaves `todo`. |
| `created_at`, `updated_at`, `deleted_at` | camelCase | int | | |

The Worker converts between `snake_case` columns and the camelCase the prototype
already uses, so the front end's field names do not change.

### `type` and its `status` set

| `type` | Statuses | Counts as complete (pink row) |
| --- | --- | --- |
| `exam` | `todo` Upcoming · `done` Sat · `graded` Graded | `done`, `graded` |
| `assignment` | `todo` Open · `submitted` Submitted · `graded` Graded | `submitted`, `graded` |
| `lab` | `todo` Scheduled · `done` Attended · `missed` Missed | `done` |
| `tutoring` | `todo` Scheduled · `done` Attended · `missed` Cancelled | `done` |
| `office` | `todo` Planned · `done` Went · `missed` Skipped | `done` |
| `task` | `todo` To do · `done` Done | `done` |

The schema validates `status` against the whole set (`todo`, `submitted`, `graded`,
`done`, `missed`); the per-type restriction is the client's job, since it's a UI
affordance rather than a data guarantee.

### Derived, never stored

| Value | How |
| --- | --- |
| Overdue | `status` is open, not recurring, and `date < today` |
| Due soon | open and `0 ≤ date − today ≤ 2` |
| Next exam countdown | earliest open `exam` with `date ≥ today` |
| Class hours / week | sum of `meetings[]` durations across courses |
| Lab hours | `lab` durations, closed vs all |
| Checklist progress | `checklist` done / total |

Storing any of these would mean a write every midnight. They cost nothing to compute.

---

## `quotes`

| Column | Type | Rules |
| --- | --- | --- |
| `user_id`, `id` | text, PK | |
| `text` | text | 1–300 |
| `source` | text | ≤ 80, may be empty |
| `created_at`, `updated_at`, `deleted_at` | int | |

---

## Indexes

| Index | Serves |
| --- | --- |
| `courses (user_id, updated_at)` | the `sync` pull |
| `items (user_id, updated_at)` | the `sync` pull |
| `quotes (user_id, updated_at)` | the `sync` pull |
| `items (user_id, date)` | any future "this term only" query |
| `*_deleted (deleted_at)` | the nightly tombstone purge |

The app is a read-everything-once app: one pull returns every live row you own, and
filters, search and view switches are in-memory. A semester is a few hundred rows.

---

## API

All routes are under `/api`, speak JSON, and require the session cookie except
`POST /api/session`. Rows are camelCase on the wire.

| Route | Body → Response |
| --- | --- |
| `GET /api/config` | → `{googleClientId, devLogin}` — what the sign-in screen may offer. |
| `POST /api/session` | `{credential}` (Google ID token) → `{profile}` and `Set-Cookie`. `403` if `ALLOWED_EMAILS` is set and excludes the address. |
| `POST /api/dev-session` | `{email}` → as above. Only when `DEV_LOGIN=1` **and** the host is localhost; `404` otherwise. |
| `DELETE /api/session` | → clears the cookie. |
| `GET /api/me` | → `{profile}` |
| `PUT /api/me` | `{coat, theme, termStart, displayName}` → `{profile}` |
| `GET /api/sync?since=<ms>` | → `{now, courses: [...], items: [...], quotes: [...]}` — every row with `updatedAt > since`, tombstones included as `{id, deletedAt}`. `since=0` is a full load. |
| `PUT /api/courses/:id` | a course → the stored course, with server `updatedAt`. Upsert. |
| `DELETE /api/courses/:id` | → `204`. Soft-deletes and nulls `courseId` on the user's items. |
| `PUT /api/items/:id` · `DELETE /api/items/:id` | as above |
| `PUT /api/quotes/:id` · `DELETE /api/quotes/:id` | as above |
| `POST /api/import` | `{profile, courses, items, quotes}` → `{imported: {courses, items, quotes}}`. One transaction. `409` if already imported. |

Errors are `{error, field?}`: `400` bad shape (with the field), `401` no session,
`404` a row that isn't yours, `409` import twice, `413` body over 1 MB.

### Session

`POST /api/session` verifies the Google ID token: signature against Google's published
keys, `iss` is Google, `aud` is our client id, not expired, `email_verified` is true.
If `ALLOWED_EMAILS` is set, the email must be in it (`403`). Google's keys are fetched
from its JWKS endpoint and cached for six hours; an unknown key id forces one refresh. Then find-or-create the `users`
row and set `rounds_session`, an `HttpOnly; Secure; SameSite=Lax` cookie holding
`userId.expiry.signature`, signed with `SESSION_SECRET`, valid 30 days. There is no
sessions table; rotating the secret signs everyone out.

---

## Sync

The browser keeps the rows in IndexedDB and renders from there. `sync.js` keeps it
and D1 converged:

1. **Write locally first.** Every save writes IndexedDB, adds the row to the dirty
   set, notifies the views, then schedules a push.
2. **Push.** For each dirty row, `PUT` or `DELETE` it. On `2xx`, store the returned
   `updatedAt` and clear the flag. On a network error, keep it dirty and try again on
   `online`, on tab focus, or after the next save.
3. **Pull.** `GET /api/sync?since=lastSyncAt`. Apply every row the server returns
   unless it is dirty locally (an unpushed local edit wins until it is pushed and the
   next pull reconciles). Rows with `deletedAt` are removed. Store the server's `now`
   as `lastSyncAt`. Runs on load, on `visibilitychange`, and after every push.
4. **Conflicts.** Per row, the last write to reach the server wins. Two devices editing
   the same item while both are offline is the only way to lose an edit, and the loser
   is one field-set on one row, not the collection.

---

## Security model

1. **Ownership** — `requireUser()` runs first in every handler and every SQL statement
   filters on that `user_id`. No route accepts a `user_id` from the client. A row that
   belongs to someone else is a `404`, indistinguishable from a row that doesn't exist.
2. **Shape** — `CHECK` constraints in the schema enforce enums, lengths, date and
   time formats, JSON validity and array caps. `validate.js` runs the same rules first
   so the client gets a `400` naming the field instead of a raw SQLite error. A bug
   in the client cannot corrupt the tables or write a document large enough to matter.
3. **Cookies** — `HttpOnly` keeps the session away from scripts, `SameSite=Lax` keeps
   other sites from posting with it, and the body limit keeps a runaway request from
   eating the daily write quota.

## Migration from the prototype

`localStorage['rounds.proto.v2']` holds `{data: {courses, items, quotes, owner}, ui}`.
The import maps it straight across:

| Prototype | D1 |
| --- | --- |
| `data.owner.name / role / coat` | `users.coat_name / coat_role / coat_color` |
| `ui.theme` | `users.theme` |
| `data.courses[]` (incl. `meetings[]`) | `courses` rows, `meetings` as JSON |
| `data.items[]` | `items` rows; `course` → `courseId` (`''` becomes null), `where` → `location` |
| `data.quotes[]` | `quotes` rows |

Field names already line up; the import only adds timestamps, fills `term`,
`archived: 0`, `weight: null`, `completed_at`, and keeps the existing ids.
