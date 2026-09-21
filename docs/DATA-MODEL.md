# Rounds — data model

Firestore, single user, everything nested under the signed-in uid so ownership is one
comparison and no query ever needs a `userId` filter.

```
users/{uid}                      profile: coat, theme
users/{uid}/courses/{courseId}   a course + its weekly class meetings
users/{uid}/items/{itemId}       exams, assignments, labs, tutoring, office hours, tasks
users/{uid}/quotes/{quoteId}     the quote tile's list
```

Conventions used throughout:

- **Dates** are `YYYY-MM-DD` strings in *your* local calendar. Never a `Timestamp`.
  A deadline of "Friday 23:59" must not shift because you opened the app in another
  timezone, and ISO strings sort chronologically, so `where('date','>=',from)` works.
- **Times** are `HH:MM` 24-hour strings, or `''` for none. Displayed as `0800`.
- **Weekdays** are `0`–`6`, Sunday = 0, matching `Date.prototype.getDay()`.
- `createdAt` / `updatedAt` are server timestamps, written on every save.
- Small, always-read-together lists (class meetings, checklists, links) are **embedded
  arrays**, not subcollections. They are read with their parent every time and never
  queried on their own, so a subcollection would only add reads.

---

## `users/{uid}` — profile

| Field | Type | Rules | Notes |
| --- | --- | --- | --- |
| `schemaVersion` | number | `== 1` | Lets a future migration recognise old docs. |
| `displayName` | string | ≤ 60 | From the Google account, editable. |
| `coat.name` | string | ≤ 28 | Embroidered on the pocket. |
| `coat.role` | string | ≤ 34 | The line under it, e.g. `MS II · Cardio block`. |
| `coat.color` | string | one of the five | Tints the sidebar fabric, pocket and embroidery. |
| `theme` | string | `light` \| `dark` \| `system` | |
| `termStart` | string | `YYYY-MM-DD` | The items listener starts here. |
| `importedAt` | timestamp \| null | | Set once the prototype's browser data is imported, so it can't run twice. |
| `createdAt`, `updatedAt` | timestamp | | |

The five course colours, which are also the coat colours:

| Name | Hex |
| --- | --- |
| Pink | `#E4749B` |
| Purple | `#8B5CC7` |
| Turquoise | `#17B3AE` |
| Baby blue | `#79B6EA` |
| Little lilac | `#BCA6E6` |

---

## `users/{uid}/courses/{courseId}`

| Field | Type | Rules | Notes |
| --- | --- | --- | --- |
| `code` | string | 1–8 | `CVS`, `ANAT`. Shown in the table and month chips. |
| `name` | string | 1–80 | `Cardiovascular Block`. |
| `color` | string | one of the five | Drives every chip, pip and card for this course. |
| `instructor` | string | ≤ 60 | `Dr. Alvarez`. |
| `term` | string | ≤ 40 | `2026 Autumn`. Used later for archiving. |
| `archived` | bool | | Hidden from the sidebar, kept for the record. |
| `meetings` | array\<map\> | ≤ 12 | The class timetable. |
| `createdAt`, `updatedAt` | timestamp | | |

### `meetings[]` — one weekly class

| Field | Type | Rules | Notes |
| --- | --- | --- | --- |
| `id` | string | 7 chars | Client-generated, stable across edits. |
| `kind` | string | `Lecture` \| `Lab` \| `Seminar` \| `Tutorial` \| `PBL` \| `Clinical` | |
| `weekday` | number | 0–6 | |
| `start`, `end` | string | `HH:MM` | `end` after `start`. |
| `room` | string | ≤ 40 | `Hall A`, `Lab 3B · table 7`. |

These are what the **month view** shows, and only these. They are not `items` — a class
that meets every Monday all term is one array entry, expanded onto the calendar in the
client.

---

## `users/{uid}/items/{itemId}`

One collection for all six types. They share every field, differ only in which
`status` values apply, and the week board and table need them interleaved by date —
separate collections would mean six queries and a client-side merge for every view.

| Field | Type | Rules | Notes |
| --- | --- | --- | --- |
| `type` | string | see below | Fixed at creation, editable in the drawer. |
| `title` | string | 1–140 | |
| `courseId` | string \| null | ≤ 40 | The course doc id. Firestore has no foreign keys: resolved in the client, and cleared on every matching item when a course is deleted. |
| `date` | string | `YYYY-MM-DD` | For a deadline, the day it's due. For a recurring slot, the first occurrence. |
| `start`, `end` | string | `HH:MM` or `''` | A deadline usually has `end` only (`23:59`). |
| `where` | string | ≤ 80 | Room, lab, platform. |
| `status` | string | see below | |
| `grade` | number \| null | 0–100 | Only meaningful when `status == 'graded'`. |
| `weight` | number \| null | 0–100 | Reserved for grade projection (backlog item 3). |
| `notes` | string | ≤ 5000 | The item's page. |
| `checklist` | array\<map\> | ≤ 50 | `{id, text ≤140, done}`. Drives the pink progress bars. |
| `links` | array\<map\> | ≤ 20 | `{label ≤60, url ≤500}`. |
| `recur` | string \| null | `weekly` \| null | Office hours and standing tutorials. |
| `weekday` | number \| null | 0–6 | Required when `recur == 'weekly'`. |
| `recurUntil` | string \| null | `YYYY-MM-DD` | End of term; blank means open-ended. |
| `dept` | string | ≤ 40 | Office hours only: the faculty's department, shown greyed. |
| `completedAt` | timestamp \| null | | Stamped when status leaves `todo`. |
| `createdAt`, `updatedAt` | timestamp | | |

### `type` and its `status` set

| `type` | Statuses | Counts as complete (pink row) |
| --- | --- | --- |
| `exam` | `todo` Upcoming · `done` Sat · `graded` Graded | `done`, `graded` |
| `assignment` | `todo` Open · `submitted` Submitted · `graded` Graded | `submitted`, `graded` |
| `lab` | `todo` Scheduled · `done` Attended · `missed` Missed | `done` |
| `tutoring` | `todo` Scheduled · `done` Attended · `missed` Cancelled | `done` |
| `office` | `todo` Planned · `done` Went · `missed` Skipped | `done` |
| `task` | `todo` To do · `done` Done | `done` |

Rules validate `status` against the whole set (`todo`, `submitted`, `graded`, `done`,
`missed`); the per-type restriction is the client's job, since it's a UI affordance
rather than a data guarantee.

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

## `users/{uid}/quotes/{quoteId}`

| Field | Type | Rules |
| --- | --- | --- |
| `text` | string | 1–300 |
| `source` | string | ≤ 80, may be empty |
| `createdAt` | timestamp | |

---

## Query patterns

The app is a read-everything-once app. A term is a few hundred documents, so it loads
what it needs and filters in memory — the same thing the prototype does, which is why
filters, search and view switches are instant.

```js
// courses: all of them, live
onSnapshot(query(coursesRef, orderBy('name')))

// quotes: all of them, live
onSnapshot(query(quotesRef, orderBy('createdAt')))

// items: this term onward, live
onSnapshot(query(itemsRef, where('date', '>=', profile.termStart), orderBy('date')))
```

Everything else is a client-side filter over that array: the week's seven days, the
month grid, the table's sort, the type and course filters, the search box, overdue,
countdowns.

If it ever grows past a few thousand items, these are the queries that would replace
the single listener, and the indexes in `firestore.indexes.json` already cover them:

| Query | Index |
| --- | --- |
| One type, by date | `type ASC, date ASC` |
| One course, by date | `courseId ASC, date ASC` |
| Open or overdue work | `status ASC, date ASC` |
| A course's exams | `courseId ASC, type ASC, date ASC` |

Writes are single-document `setDoc(..., {merge: true})` with `updatedAt:
serverTimestamp()`, so two devices editing different fields of the same item don't
clobber each other. The import is the only batched write.

---

## Security model

`firestore.rules` enforces two things:

1. **Ownership** — `request.auth.uid == uid`, on every path. There is no recursive
   wildcard, so a subcollection added later is denied until it's given a rule.
2. **Shape** — every write is checked for known keys, correct types, enum membership,
   string lengths, array sizes and a date that matches `^\d{4}-\d{2}-\d{2}$`. A bug in
   the client can't corrupt the collection or run up a bill with a huge document.

The web API key in `firebase-config.js` is an identifier, not a secret — the rules are
the security boundary. Since this is a single-user app, `firestore.rules` also carries a
commented-out email allowlist you can switch on to pin access to exactly one account.

## Migration from the prototype

`localStorage['rounds.proto.v2']` holds `{data: {courses, items, quotes, owner}, ui}`.
The import maps it straight across:

| Prototype | Firestore |
| --- | --- |
| `data.owner.name / role / coat` | `users/{uid}.coat.name / role / color` |
| `ui.theme` | `users/{uid}.theme` |
| `data.courses[]` (incl. `meetings[]`) | `users/{uid}/courses/{id}` |
| `data.items[]` | `users/{uid}/items/{id}` |
| `data.quotes[]` | `users/{uid}/quotes/{id}` |

Field names already line up; the import only adds `createdAt`/`updatedAt`, fills
`term`, `archived: false`, `weight: null`, `completedAt`, and keeps the existing ids.
