# Collaboration: shared classes and team projects — design

Agreed in brainstorming 2026-10-02; this document is the source of truth for the
architecture. Not built yet. It answers `TERM-COLLABORATION-PLANNING-PROMPT.md`.
v1 builds **shared classes**; **team projects** are v2 on the same foundation and are
fully designed here so the foundation does not need to change for them.

## Review result: READY FOR IMPLEMENTATION PLANNING

Reviewed 2026-10-02 against `docs/PROJECT-OVERVIEW.md`, the code (`worker/`,
`migrations/0001_schema.sql`, `src/core/`, `src/data/`) and
`TERM-COLLABORATION-PLAN-REVIEW-PROMPT.md`. Every section was traced against the code
and against the others. The §21 trace passes. No contradiction is known to remain, and
nothing needs a product decision before planning (§24). Corrections this review made:

| # | Problem found | Correction |
|---|---|---|
| 1 | Opening classes at Stage 5 would drop a converted course's events from the person's ICS feed until Stage 6. The feed reads only `u:` rows | Classes open to everyone at the end of **Stage 6** (§22) |
| 2 | A member's task write was diffed body-against-current-row. An offline member whose task title an editor changed meanwhile would be refused | Members' writes apply only the fields named in `changed`, which must be allowed fields. The Worker sets `completed_by` itself (§5, §6) |
| 3 | The profile was moved to field-level merge. That changes an existing system with no collaboration need | The profile keeps today's whole-row `If-Match`. Field merge is only for shared rows and `marks`, the rows several people or devices can create under one id (§6) |
| 4 | Convert copied custom-typed items (`c-…`) into a class. The `c:` CHECK refuses them, so the batch would fail | Custom-typed items stay personal under the class (`class_id`) (§13) |
| 5 | Old clients send whole rows that do not include `class_id`/`space_id`/`hidden_sources`, and would wipe them. `sync?v=2` would send kinds old clients do not know (`marks`, `space_prefs`) | A field missing from the body keeps its stored value. v2 pages only the five kinds it knows (§16) |
| 6 | Personal and class courses can share an id: a rejoin with a detached copy left unmerged, or a random clash. The views look courses up by id alone | Views key courses and items by `(scope, id)`. Sessions and achievements resolve through `space_id` (§7) |
| 7 | A class course row carried `target` and `archived`, both personal, and the colour's meaning was undefined | `c:` courses: `target IS NULL AND archived = 0` (CHECK). The row's `color` is the class default offered on join (§3, §9) |
| 8 | Each sync re-sent every member of every space: up to 600 rows read per sync | Member lists are sent only when a space's `revision` moved (`sv=`), and in full on the first sync after the app opens (§6) |
| 9 | An owner's account deleted with nobody left archived a class that nobody could ever see | That space is deleted (§13) |
| 10 | Undefined cases: pending mark edits at revocation; leaving without a copy; marks of purged items; shared tombstones on the device; who is told when a project is deleted; the order of a space purge; the inbox count's cost; assignees who are not members; parsing pending keys for shared rows | Each is now defined (§6, §7, §12, §13, §17, §18) |
| 11 | "The Worker checks membership" on `class_id` gave nothing. It is a label on a person's own row, not an access path | `class_id` and `space_id` are labels whose shape is checked. Access is decided only by the scope (§5, §17) |
| 12 | Trace: a project item due Oct 30 was linked to an assignment due Oct 15 | A linked project's date defaults to the assignment's, and the project sheet offers **Use this date** when they drift apart (§10, §21) |

Facts checked in the code that this design relies on: revisions are a global-sequence
value on insert and `+1` on update (`worker/db.js`). The sync loop rejects
400/404/409/413/422 at once and retries other statuses three times (so 403 is retried,
`src/core/sync.ts`). `applyPage` skips rows that have a pending op or a newer local
revision. IndexedDB is at version 4. The profile is not in `changes` and is read with
`/api/me` on every cycle. Exam prep is the item's `checklist`. The lecture-review
`through` watermark is in `localStorage`, so it is per device. What-if scores live only
in the open course sheet. The ICS feed skips archived courses, marks done/graded/submitted
with ✓ and missed as `CANCELLED`. The cursor floor is global, and cursor 0 never resets.

## Major decisions

| Decision | Why |
|---|---|
| One ownership column, `scope` (`u:`/`c:`/`p:`), on the existing `courses`/`items` | Keeps one validator, trigger set, selector set, grade function and ICS builder. "Every query keyed by its owner" survives as it is |
| A personal layer (`marks`, `space_prefs`) instead of per-member copies | One authoritative shared row. Private fields can never reach another member because they live in rows keyed by that person |
| The change feed keyed by scope, one cursor per scope, a membership guard inside the paging statement | A new space loads from 0. A removal takes effect in the same statement that would read |
| Field-level merge only for rows that several people or devices write under one id | Disjoint offline edits both stand. Personal rows keep today's protocol untouched |
| No separate Moderator role; a class's editors are its moderators; suggested changes later | Owner + chosen editors already stops 30 students editing an exam date. Suggestions need a review queue that v1 does not need |
| Notifications derived from activity, with no per-user rows | No fan-out writes. Works offline from a cached copy |
| Sync-based freshness (after edits, on focus, every 5 min) | No WebSockets or extra polling; within the free tier |
| Server batches (create, join, absorb, detach) need a connection; edits work offline | These change memberships and scopes, which only the server can authorise |

Decisions taken with George:

| Question | Decision |
|---|---|
| Scale | Small groups, 2–10 people; accounts are still created by the admin |
| First feature | Shared classes (v1); team projects (v2) |
| Who edits a class's shared facts | Owner + editors they choose; members read and keep their own layer |
| Joining with a personal copy of the course | Offer to merge it into the class |
| Model | A **scope** on courses and items + a **personal layer** |
| Editors may invite | Yes; only the owner makes codes, removes people, changes roles |
| A member removed from a class | Always keeps a personal copy |
| Unknown username on invite | Clear error ("No Term account named …") |
| Activity history | Kept 90 days |

---

## 1. The model, and why

Data is owned by a **scope**:

| Scope | Owner | Holds |
|---|---|---|
| `u:<userId>` | one user | everything Term has today |
| `c:<spaceId>` | a **class** space | exactly one course and its shared items |
| `p:<spaceId>` | a **project** space | exactly one project item and its tasks |

A **space** is a group of members with roles. Its kind is fixed at creation and is part of
its scope prefix, so the schema can enforce different rules for class rows and project
rows. Things a person holds about a shared row (status, grade, notes, checklist,
colour, target) live in **personal-layer** tables keyed by that person.

Why:

- Term already makes ownership part of every primary key, `(user_id, id)`. A scope
  generalises "which user" to "which owner". The rule "every query is keyed by its
  owner" survives, and there is still one `items` and one `courses` table, so the
  validators, triggers, views, grade maths and ICS builder keep one item shape.
- Rejected: **separate shared tables** (`space_items`), which duplicate every validator,
  trigger, selector and the ICS builder, with a third copy for projects; and **a copy per
  member with server fan-out**, which has no authoritative record, turns each edit into N
  writes, and drifts after offline edits.
- What changes in existing systems, and why: `courses`/`items` swap `user_id` for
  `scope` (shared rows have no single user); `changes` is keyed by scope (a member must
  read a class's feed); sync takes one cursor per scope (a newly joined class must load
  from 0); shared rows merge field by field (several people edit them). Everything else
  — auth, cookies, `If-Match`/409 for personal rows, soft deletion, the nightly purge,
  Web Locks, BroadcastChannel, AI routes that never save — stays as it is.

## 2. Entities: ownership, access, storage

| Entity | Owned by | Read | Create | Edit | Delete | D1 | IndexedDB | Revision | Soft delete | In `changes` | On revocation |
|---|---|---|---|---|---|---|---|---|---|---|---|
| User | — | self; members see display name | admin | self (profile) | admin | `users` | `meta.profile` | yes | no (hard, admin) | no (`/api/me`) | — |
| Space | its members | members | any user (becomes owner) | owner | owner (rules §13) | `spaces` | `spaces` | yes | yes | no: sent whole in each sync response | row removed locally |
| Membership | the space | members of that space | owner/editor invite + accept; code join | owner (role) | owner (remove), self (leave) | `members` | inside `spaces` | yes | yes | no: sent with the space | — |
| Invite | the space | the space's owner/editors; the invitee | owner/editor | — | inviter/owner (revoke); invitee (decline) | `invites` | inbox cache | no | no: hard-deleted 90 d after creation | no | deleted with the space |
| Personal course/item | `u:` | self | self | self | self | `courses`/`items` | `courses`/`items` | yes | yes | `u:` | — |
| Class course | `c:` | class members | created with the class | owner/editor | never (archive the class) | `courses` | `shared_courses` | yes | yes | `c:` | purged locally; detach copy |
| Class item | `c:` | class members | owner/editor | owner/editor | owner/editor | `items` | `shared_items` | yes | yes | `c:` | purged locally; detach copy |
| Project item | `p:` | project members | created with the project | owner/editor | never (archive/delete the project) | `items` | `shared_items` | yes | yes | `p:` | purged locally |
| Task | `p:` | project members | owner/editor | owner/editor; member: status and claiming of own tasks | owner/editor | `items` | `shared_items` | yes | yes | `p:` | purged locally |
| Mark (my layer on a shared item) | user | self only | self | self | self | `marks` | `marks` | yes | yes | `u:` | class: folded into detach copy; project: deleted |
| Space prefs (my colour, target, semester, archived) | user | self only | the Worker, in the create / convert / accept / join batch | self | self (leave, detach) | `space_prefs` | `space_prefs` | yes | yes | `u:` | deleted |
| Study session | user | self only (leaderboard: opt-in totals) | self | self | self | `study_sessions` | `study_sessions` | yes | yes | `u:` | kept; link repointed by detach, or labelled "a class/project you left" |
| Achievement | user | self only | self | self | self | `achievements` | `achievements` | yes | yes | `u:` | kept; class links repointed by detach |
| Activity | the space | members (inbox: rows about you, even after leaving) | Worker (triggers, routes) | — | cron, 90 d | `activity` | inbox cache | no | no (hard, 90 d) | no | not readable for that space |
| Inbox read marker | user | self | Worker | self | — | `inbox_seen` | — | no | no | no | — |
| Calendar visibility | user | self | self | self | — | `users.hidden_sources` | profile | profile revision | — | via `/api/me` | stale ids ignored |

Notifications are not an entity: the inbox is derived from activity and invites (§12).

## 3. Database

A new database, **rounds-v7**, from a re-squashed `migrations/0001_schema.sql`, filled
by `scripts/move-db.mjs` (the procedure used for v2–v6), which rewrites `user_id` to
`'u:' || user_id` in `courses`, `items` and `changes`. No data becomes shared.

### New tables

| Table | Key | Columns and rules |
|---|---|---|
| `spaces` | `id`: 12 chars `[a-z0-9]`, **made by the Worker** | `kind` `class`\|`project`; `archived` 0/1; `school_calendar` JSON snapshot (class only); `parent_space`, `parent_item` (project only: the class assignment it belongs to; nullable, no FK); `code_hash`, `code_expires`, `code_uses_left`; `created_at`, `updated_at`, `deleted_at`, `revision`. Every change to the space row **or to its members** (join, leave, remove, role, transfer) sets `revision` to the next global sequence value in the same batch, so sync can tell which member lists moved (§6) |
| `members` | `(space_id, user_id)` | `role` `owner`\|`editor`\|`member`; `joined_at`, `updated_at`, `deleted_at` (left/removed), `revision`. Partial unique index `(space_id) WHERE role = 'owner' AND deleted_at IS NULL`: exactly one live owner, stored nowhere else |
| `invites` | `(space_id, user_id)` | `invited_by`, `role` (given on accept), `status` `pending`\|`accepted`\|`declined`, `created_at`, `expires_at` (30 days) |
| `marks` | `(user_id, id)`, `id = space_id \|\| ':' \|\| item_id`; unique `(user_id, space_id, item_id)` | `space_id`, `item_id`, `status`, `grade`, `weight` (override), `notes`, `checklist`, `completed_at`, `hidden` 0/1, timestamps, `deleted_at`, `revision`. Same `CHECK`s as the matching `items` columns. On a project row only `notes` and `hidden` are used (the Worker refuses the rest) |
| `space_prefs` | `(user_id, id)`, `id = space_id` | `space_id`, `color` (one of the twelve), `target`, `term` (your semester name; class only), `archived` 0/1, timestamps, `deleted_at`, `revision` |
| `activity` | `seq` autoincrement | `space_id`, `actor_id`, `verb`, `subject` (item or user id; `''` for creations, never NULL, so the unique key can match), `subject_user` (who it is about, for member and assignment verbs), `detail` JSON (titles, from → to, and the actor's display name at the time, so it reads after the item or the account is gone), `bucket` (10-minute bucket), `at`. Unique `(space_id, actor_id, verb, subject, bucket)` for coalescing |
| `inbox_seen` | `user_id` | `seq`: the last activity row read. Kept off `users`, so reading never bumps the profile revision |

A space has no name of its own: a class is named by its course, a project by its
project item's title, so renaming happens in one place. The Worker refuses a second
course in a class and a second `project` item in a project.

`marks` and `space_prefs` carry one text `id` (≤ 40 characters) like every other personal table, so the
existing `changes` key, `applyPage`'s `row.id` lookups and pending keys
(`marks:<space>:<item>`) keep their shape. Space ids are `[a-z0-9]`, so the id splits
unambiguously at its **first** `:` (item ids are only checked for length and control
characters, so they may contain `:`); user ids are UUIDs.

### Changed tables

| Table | Change |
|---|---|
| `courses` | `user_id` → `scope` (`u:` or `c:` only); PK `(scope, id)`; `updated_by`. CHECK: a `c:` row has `target IS NULL AND archived = 0` (both personal, in `space_prefs`); its `color` is the class's default, offered to joiners, and its `term` the default semester |
| `items` | `user_id` → `scope`; PK `(scope, id)`; FK `(scope, course_id) → courses(scope, id)`; `updated_by` (set by the Worker, never the client); `class_id` (a personal item filed under a class: a label on your own row, shape-checked only, never an access path); `assignees` JSON array (user ids of live project members, or `["*"]` for everyone; ≤ 30); `completed_by` (set by the Worker to the person completing) |
| `items` CHECKs | `u:` rows: `assignees = '[]'`, `completed_by IS NULL`; `class_id` only with `course_id IS NULL`. `c:` rows: `course_id IS NOT NULL` (the class's course), `grade IS NULL`, `checklist = '[]'`, `status = 'todo'`, `completed_at IS NULL`, `completed_by IS NULL`, `assignees = '[]'`, `class_id IS NULL`, built-in `type`. `p:` rows: `grade IS NULL`, `weight IS NULL`, `course_id IS NULL`, `class_id IS NULL`, `type IN ('project','task')`; status, `completed_at`, `completed_by` and the checklist (subtasks) belong to the team |
| `study_sessions`, `achievements` | `space_id` (nullable): set when `course_id`/`item_id` point at a shared row; a label, like `class_id` |
| `users` | `hidden_sources` JSON array ≤ 40 of `course:<id>` (a personal course), `space:<sid>` and `personal` (personal items with no course); prefixed so a course id and a space id can never be confused |
| `changes` | `user_id` → `scope`; `UNIQUE (scope, kind, row_id)`; index `(scope, seq)`. Triggers on personal tables write `'u:' \|\| user_id`; only `courses` and `items` write `c:`/`p:` |

Shared `notes` and `links` on class and project rows belong to the space (class notes,
project description) and are edited by owner/editor.

### Query patterns and indexes

| Query | Served by |
|---|---|
| My spaces (each sync) | `members (user_id) WHERE deleted_at IS NULL` → `spaces` PK; name via `courses`/`items` PK |
| Members of a space | `members` PK prefix `space_id` |
| Check membership / role (every guard) | `members` PK `(space_id, user_id)` |
| Changes since a cursor, per scope | `changes (scope, seq)` |
| Shared rows of a space (ICS, detach, absorb) | `courses`/`items` PK prefix `scope` |
| Tasks assigned to me (ICS) | `items` PK prefix `p:<sid>` for my project scopes, filtered with `json_each(assignees)`; ≤ 200 rows per project |
| My marks / prefs in a space (detach, revoke) | `marks (user_id, space_id)`; `space_prefs` PK |
| Personal items under a class (detach, leave) | `items (scope, class_id) WHERE class_id IS NOT NULL` |
| Member lists that moved (each sync) | `members` PK prefix `space_id` for the spaces above `sv` → `users` PK for names |
| Sessions linked to a space | `study_sessions (user_id, space_id)` |
| Inbox: activity in my spaces since seen | `activity (space_id, seq)` per space |
| Inbox: activity about me | `activity (subject_user, seq)` |
| Invites to me | `invites (user_id) WHERE status = 'pending'` |
| Activity tab | `activity (space_id, seq)` |
| Purges | existing `*_deleted` indexes; `activity (at)`; `invites (created_at)` |
| Join by code | `spaces (code_hash) WHERE code_hash IS NOT NULL` |

### Limits

30 live members per space; 20 spaces per user (a join, accept or create past it is
`409 {error:'limit'}`); 200 live tasks per project (Worker).

## 4. Shared vs personal

| Thing | Shared (one row; who edits) | Personal (only you; in `marks`, `space_prefs` or your own rows) |
|---|---|---|
| Class course | code, name, instructor, meetings, default `term`, default colour (owner/editor) | colour, grade target, your semester, archived in your sidebar |
| Class item (assignment, exam, quiz, lab, …) | type (built-in), title, date, start/end, location, weight, recurrence, class notes, links (owner/editor) | status, completion time, grade, weight override, checklist, your notes, hidden |
| Project item | title, due date, description, links, status (owner/editor) | your notes, hidden |
| Task | title, date, times, notes, links, subtasks, assignees, status, completed by/at (owner/editor; members: status and claiming of their own tasks) | your notes, hidden |
| Everything else | — | study sessions, achievements, what-if scores (held only in the open course sheet, never saved, as today), lecture reviews, exam-prep checklists, calendar visibility |

Term has no reminder feature today; if one is added, its settings go in `marks`.

How private data stays private: marks, prefs, sessions and achievements are only ever
read with `user_id = <session user>`; no route returns another user's rows or an
aggregate of them; `u:<me>` is only ever paged for that user; the ICS feed is built per
user; activity records only shared fields. A member sees other members' names (display
name, else username), roles and authorship of shared changes, and nothing else. A
deleted account's past edits read "a former member".

## 5. Permissions

| Operation | Owner | Editor | Member | Server check |
|---|:-:|:-:|:-:|---|
| Read the space; keep your own layer | ✓ | ✓ | ✓ | membership guard in the statement; a mark is written only on a live row of that space (on a removed one it can only be deleted, until **Keep as mine**); on a project row only `notes`/`hidden` |
| Create / edit / delete / restore class items; edit class course facts | ✓ | ✓ | | role guard in the statement; space not archived |
| Create / edit / delete tasks; assign; edit the project item | ✓ | ✓ | | same |
| Complete or reopen a task assigned to you or to everyone | ✓ | ✓ | ✓ | members: `changed` may name only `status`/`completed_at`; the Worker writes only those fields from the body, checks you are an assignee (or `*`) on the **current** row, and sets `completed_by` itself |
| Claim an unassigned task (`[]` → `[you]`) or unclaim yourself | ✓ | ✓ | ✓ | members: `changed` names only `assignees`; the Worker computes the new list from the **current** one (adds or removes you only) |
| Assign anyone | ✓ | ✓ | | every id must be a live member of the project, or `["*"]` |
| Import an outline into a class | ✓ | ✓ | | ordinary shared writes |
| Invite by username with the space's default role | ✓ | ✓ | | owner/editor guard |
| Invite with another role; invite code; change roles; remove | ✓ | | | owner guard |
| Archive / unarchive; refresh school calendar; link a project; transfer | ✓ | | | owner guard; linking also needs class membership |
| Delete a class | when the only member | | | owner guard + member count in the statement |
| Delete a project | ✓ (typed confirm) | | | owner guard |
| Leave | after transferring | ✓ | ✓ | self |
| Suggest / approve a change | later | later | later | — |
| File your own item under a class (`class_id`); log study against a shared row (`space_id`) | ✓ | ✓ | ✓ | shape only: these are labels on your own rows and grant nothing |

**Roles asked about but not built as separate roles.** A *Moderator* is a class's editor:
the owner chooses who may change dates, and everyone else reads. A *suggested change*
("Exam Oct 14 → Oct 16", approved by an editor) is in **Later** (§22). Until then a
member tells an editor through the class's own channels, and the editor's change reaches
everyone on their next sync.

Default role on joining: **member** for a class, **editor** for a project (small teams
edit directly; the original prompt's §10). One live owner per space. Transfer demotes the
old owner to editor **before** promoting the new one, since the one-owner index is
checked statement by statement. An owner cannot demote or remove themselves.

All guards are built by one module, `worker/access.js`, and run inside the SQL statement
(the pattern of `courseGuard`/`capGuard` in `worker/db.js`), so there is no gap between
check and act. `db.js` functions take a scope; personal routes pass `u:${user.id}`; no
route trusts a scope or user id from the client. Non-members get `404` for everything in
a space, so ids reveal nothing; members on a forbidden action get
`403 {error:'forbidden'}`; writes to an archived space get `403 {error:'archived'}`. The
UI hides what you cannot do, but the server is the boundary.

## 6. Sync

### Pull: `GET /api/sync?v=3&cursors=u:<me>:812,c:ab12cd34ef56:640&sv=905`

Each entry is `scope:seq`, split at its last `:`. `sv` is the highest space `revision`
the client holds, or `0` on the first sync after the app opens.

1. **Memberships.** One query reads my live memberships of live spaces (≤ 20 rows), with
   each space's kind, archived flag, parent, `revision` and name (the class's course name
   or the project item's title, read by primary key). For the spaces whose `revision` is
   above `sv`, a second query reads their members' names and roles. Revisions are global
   sequence values, so a space I just joined is always above my `sv`. The scopes to page
   are `u:<me>` plus my spaces. A space the client did not send starts at 0, so it loads in
   full. Cursor 0 is a full load and never a `reset`, as today.
2. **Page.** One statement, each branch capped:
   `SELECT * FROM (SELECT … FROM changes WHERE scope = ? AND seq > ? AND <guard> ORDER BY seq LIMIT 101) UNION ALL … ORDER BY seq LIMIT 101`.
   `<guard>` re-checks live membership of a live space inside the statement, so a
   removal between the two queries cannot leak a page.
3. **Cursors.** If the page ends at sequence X, every scope's rows up to X have been
   delivered, so each cursor becomes `max(cursor, X)`, or the head on the last page.
4. **Response.**
   `{scopes:[{id, kind, role, archived, name, parent, revision, members?:[{userId, name, role}]}], cursors, changes, more, reset:[scope], revoked:[scope], inbox}`.
   `members` is present only for spaces above `sv`. The client keeps the lists it has
   for the others. A member's renamed display name therefore shows after the next app
   open, which is acceptable for a label. `reset` is per scope: that scope's cursor fell
   below the global purge floor, so only its clean rows are rebuilt. `revoked` lists
   scopes the client sent that it may no longer read. The client applies it after the
   **last** page of the cycle (`more: false`), so a detach copy paged in later is
   already on the device (see Revocation). `inbox` is the unread count, capped at 99
   (`LIMIT 100`), so counting costs at most 100 index rows.
5. `cursors` holds ≤ 25 entries; malformed input is `400`. The Worker builds the list of
   scopes it pages itself (step 1); a scope in `cursors` that is not yours (another
   person's `u:`, a space you are not in) is never paged and comes back in `revoked`. `/api/sync?v=2` and the
   personal routes remain, scoped to `u:<me>`, for clients that have not updated (§16).

Freshness: sync after each edit (600 ms debounce), on focus, on `online`, and every 5
minutes while visible, as today. No WebSockets and no extra polling.

### Push

Personal courses, items, quotes, sessions, achievements, **space prefs** and the
**profile** keep today's whole-row `If-Match`. Only one person writes them, and each
gets a random id or is created by a server batch. Shared courses and items, and
**marks**, use a **field-level merge**. Shared rows are written by several people. A
mark's id is fixed (`<space>:<item>`), so two of your devices can both create it
offline. The pending op keeps `base` (the row when first queued) and sends the full row
plus `changed: {field: oldValue}`.

1. Revision matches → write as today.
2. Otherwise each changed field is safe if its current value equals the old or the new
   value; if all are safe, only those fields are written onto the current row, guarded by
   the current revision, with one retry on a lost race. A create (`If-Match: "0"`) that
   finds a live row merges against it, with the table's defaults as the old values.
   This is how two devices' first marks on one item combine. A current row that is
   deleted never merges: that is always step 3.
3. Otherwise `409 {current, fields, by}` → the Conflicts review ("Gabriel changed Date
   to Oct 18").

JSON fields (`meetings`, `links`, `checklist`, `assignees`) count as one field each,
compared after stable re-serialisation. A write without `changed` (an old client) is a
whole-row write, exactly as today. A **member's** task write never takes the body as a
whole, even when the revision matches. `changed` must name only the fields §5 allows.
The Worker writes only those fields from the body and checks the assignee rules against
the current row. `completed_by` and `updated_by` always come from the session.

**Statuses in the sync loop.** Today 400/404/409/413/422 go to Conflicts at once, and any
other error is retried for three cycles. **403** joins the first group, because a lost
permission does not come back by retrying. A `404` on a shared `PUT` fetches the row,
gets `404` and removes the local copy, as for a personal row today.

### End to end: one member edits, another sees it

1. The editor saves in the item card → one IndexedDB transaction writes `shared_items`
   and a pending op `shared_items:c:<sid>:<id>` with `base`; `notify()` redraws;
   BroadcastChannel tells other tabs.
2. Sync, holding the Web Lock, pushes `PUT /api/spaces/<sid>/items/<id>` with `If-Match`.
3. The Worker resolves the user from the cookie and runs the upsert carrying the role
   guard. D1 sets `revision` from the global sequence, `updated_by` and `updated_at`; the
   items trigger writes `changes` (scope `c:<sid>`) and, for meaningful fields, `activity`.
4. The saved row comes back → `settleOperation` replaces the local row and drops the op.
5. Another member's next sync pages `c:<sid>` past their cursor → `applyPage` writes
   `shared_items` (skipping rows they have a pending op on, or hold at a newer revision,
   as `applyPage` does today). A deleted shared row is removed from the device unless
   your mark on it is meaningful, in which case it is kept as `removed` (§7)
   → `notify()` → `effectiveItems()` recomputes → Week and Month redraw.

### Offline and concurrency

| Case | Outcome |
|---|---|
| Gabriel (rev 4) changes the deadline; Alex (rev 4, offline) the description; Gabriel syncs first | Alex's push: revision is 5, not 4; `description` still equals Alex's base, so it is safe and is written onto rev 5 → rev 6. Both changes stand; nobody sees a conflict |
| Both change the date | The second push conflicts on `date` → `409`; their version goes to Conflicts with "Gabriel changed Date to Oct 18", to restore (another guarded write) or discard |
| Gabriel edits offline; Alex deletes the item | Gabriel's push: `409` with the tombstone → Conflicts: "Deleted by Alex"; Gabriel, as editor, may restore it, which revives the row |
| Alex deletes an item Gabriel has since edited | Alex's delete: `409` → "Gabriel edited this. Delete anyway?" |
| Gabriel edits shared data offline, is removed, reconnects | A cycle pushes first, so each of his shared and mark ops gets `404` → Conflicts ("You no longer have access to Web Services"). Pull: the removal batch already wrote the class's detach copy into `u:<gabriel>` (§13), and it pages in with his own scope. After the last page, `revoked` runs one IndexedDB transaction. It deletes the space's shared rows, marks and prefs. Each saved mark edit for that space whose item now exists as his personal copy (same id) is taken out of Conflicts and re-queued as an ordinary edit of that copy at the copy's revision, so an offline grade or note is not lost. His edits to shared fields stay in Conflicts |
| Gabriel edits his mark on an item from his phone and his laptop, both offline (both may create it) | Field merge: different fields both stand; the same field → Conflicts |
| Made view-only while offline | Push: `403 forbidden` → Conflicts at once (the sync loop adds 403 to the statuses it rejects; today it would retry three times) |
| A member completes a task offline while an editor retitles it | Member push: `changed` = status, completed_at; only those are written; the new title stands. No conflict |
| Space archived while offline | Shared pushes: `403 archived` → Conflicts; marks still save |
| Pending edit to your personal item under a class when detach ran | Detach bumped its revision → `409` → Conflicts, beside your copy |
| A mark on an item created offline | Upload order: course puts → item puts → mark and pref puts → course deletes. A mark whose item was refused goes to Conflicts |

### Revocation

- **Server access stops at once:** every read and write statement re-checks membership.
- **The client learns** from `revoked` on its next sync, or from `404` when it pushes.
  Until then it shows only what it already had, which its user had seen.
- **Cached data is removed** in one transaction on `revoked`, after the cycle's last page.
  Nothing in IndexedDB keeps showing the space. The `spaces` row goes, its cursor goes,
  and so do its shared rows, your marks and prefs there, and its cached inbox rows
  except those about you.
- **Pending writes** are rejected (`404`) and kept in Conflicts, except mark edits that
  carry over to a detached copy (above). If no copy exists (a project, or a class left
  without one), they stay in Conflicts to be read, exported or discarded; nothing is
  silently thrown away.
- **ICS:** the feed joins live membership, so the next fetch leaves the space out.
- **Inbox:** activity in a space you left stops appearing; rows about you (removed, role
  changed, ownership transferred) stay visible through `subject_user`.

## 7. IndexedDB (version 5)

| Store | Key | Holds |
|---|---|---|
| `courses`, `items`, `quotes`, `study_sessions`, `achievements` | `id` | personal rows, unchanged |
| `shared_courses`, `shared_items` | `[scope, id]` | class and project rows. Separate stores mean a shared id can never shadow a personal row or its pending op |
| `marks`, `space_prefs` | `id` | your layer |
| `spaces` | `id` | from each sync's `scopes`: kind, role, archived, name, parent, members with names |
| `meta.cursors` | | `{scope: seq}`; the upgrade moves `syncCursor` to `u:<me>` |
| `meta.inbox` | | the last inbox fetched, for offline |
| `pending`, `conflicts` | | unchanged; ops gain `base` and `changed`; shared keys name the store, then the scope, then the id: `shared_items:c:<sid>:<id>`, `shared_items:p:<sid>:project`, `shared_courses:c:<sid>:<id>`. Personal keys stay `<kind>:<id>`. The prefix is never a personal kind, so a personal id containing `:` is never misread |

The upgrade from version 4 adds the stores and moves `meta.syncCursor` to
`meta.cursors['u:<me>']` inside the `onupgradeneeded` transaction, keeping pending ops
and conflicts. The lecture-review setting and its `through` watermark stay in
`localStorage` per device, as today.

**Keys in the views.** A personal course and a class course can carry the same id: a
detached copy you have not merged back, or a random clash. So `effectiveCourses()` and
`effectiveItems()` give every row a `key` of `scope/id`, and items name their course by
key. Study sessions and achievements find their course or item through `space_id`
(set → that space's row; null → your own). No view looks a course up by bare id.

`effectiveItems()` (memoised, in `src/data/`) is what every view reads:

- personal items as today, `source: personal` (with `classId` when under a class);
- class items merged with your mark (status, grade, weight override, checklist, notes,
  completion), skipped when hidden, `source: class`;
- the project item and tasks with the team's status and your notes, skipped when hidden,
  `source: project` with `assignedToMe`;
- a class item that arrives deleted but holds a meaningful mark of yours (grade, notes,
  checklist, status other than todo) stays, flagged `removed`.

`effectiveCourses()` returns personal courses plus each class course with your
`space_prefs` applied. The item editor splits a save: shared fields go to `shared_items`
(editors; members see them read-only), personal fields to `marks`.

## 8. Existing features

| Feature | With collaboration |
|---|---|
| Week | Personal items, class items, project items, tasks assigned to you or everyone; class meetings by your semester. Unassigned and others' tasks are not shown here |
| Month | The same set, with class meetings as today |
| All items | Everything visible, plus a **Source** filter (Personal / a class / a project); choosing a project lists all its tasks with assignees |
| Stats | Open and overdue count class items by your mark (not hidden, not complete) and open tasks assigned to you; next exam includes class exams |
| Grades | `courseGrade()` unchanged, fed merged items: weight `mark.weight ?? item.weight`, grade and status from the mark, plus personal items under the class; hidden items are left out (hiding a graded one asks first). Target from `space_prefs`; what-if scores only in the open sheet, as today. Project rows carry no weight (CHECK), so they never enter grades: a team project's grade is your mark on the class assignment |
| Study | Sessions personal; `space_id` set when logged against a shared course or item. History, goal, streak, heatmap and leaderboard count your minutes only. Per-course totals group by `(space_id, course_id)`. Pickers list merged items |
| Achievements | Built-in ones read merged items, so class items count by your mark's status. "Tasks done" counts what it counts today plus project tasks with `completed_by = you`; tasks someone else completed never count for you. Once shown as earned they are not withdrawn because an item was hidden. Custom achievements gain `space_id` |
| Exam prep | Works on class exams; its lecture checklist goes into your mark |
| Lecture reviews | Personal tasks from a class's meetings, with `class_id` and no `course_id` (a personal row cannot point at a class course); the next step in a chain inherits `class_id`. Review ids hash the course id, which a converted course keeps, so the chain carries on; after a merge existing reviews move under the class, and the per-device `through` watermark keeps past dates from being generated again |
| Semesters | Everyone keeps their own school calendar. `space_prefs.term` picks your semester for a class (on join: the same name, else the one covering today, confirmed by you). A class offers its owner's calendar snapshot to joiners who have none |
| Custom types | Shared items use built-in types; your labels, colours and hidden types apply to them |
| ICS feed | §9 |
| Imports | The outline import can target a class you edit, with a diff preview (New / Changed / Already there; Changed starts unticked). `.ics`, CSV, school calendar and schedule imports stay personal in v1 |
| AI import | AI reads return JSON and never save, as today; shared data changes only through ordinary guarded writes after the person ticks and confirms in the preview |
| Offline | Everything already synced can be read and edited offline; shared edits merge on reconnect. Joining, inviting, removing, leaving, converting and creating spaces need a connection (they are server batches) and say so |
| Admin | The accounts table counts personal rows (`scope = 'u:' ‖ id`); deleting an account transfers its spaces, or deletes those with nobody else in them (§13) |

## 9. Calendar behaviour

- **No duplicates.** A class item is one row for everyone. When a project is linked to
  a class assignment you can see and the project item has the same date, the project item
  folds into the assignment's chip ("Team · Fire Response API"); different dates show
  both, since a team's internal deadline is a separate fact. A merged personal copy is
  soft-deleted by absorb.
- **Stable ids.** Shared rows keep their ids for life, and absorb, convert and detach keep
  ids across scopes. ICS UIDs carry the scope for shared events (`item-<sid>-<id>`,
  `class-<sid>-<courseId>-<meeting>-<term>`), because ids are only unique within a scope;
  converting a course therefore shows in calendar apps once as a delete plus an add.
- **Colours.** A class uses your `space_prefs.color` (on join: the class course's default
  colour unless you already use it, else the first free of the twelve). A project uses its linked
  class's colour, else its own pref.
- **Labels.** Shared chips carry a two-person glyph (class) or a team glyph (project), and
  tasks an "assigned to me" pip, each with an aria-label ("Shared · Web Services", "Team
  task · assigned to you"). A "you" pip marks a personal item under a class.
- **Visibility.** An eye toggle on each sidebar row (personal courses, classes, projects,
  and *Personal items*) writes `users.hidden_sources` (`course:<id>`, `space:<sid>`,
  `personal`) through the profile, as `types` is written today. Hidden rows stay listed,
  dimmed. Hiding a class hides your personal items under it. It syncs across devices
  and the ICS feed honours it. Hidden sources still count in Stats and grades, because
  hiding is about the calendar. Hiding one item (`marks.hidden`) is different: it means
  "not mine" and leaves everything out.
- **ICS feed contents.** Your personal items and courses (as today); each class's course
  meetings (by your semester) and items with your mark applied (✓ when complete,
  cancelled when missed, left out when hidden); personal items under a class; each
  project's item; tasks assigned to you or to everyone. Spaces in `hidden_sources` and
  classes you archived in your sidebar are left out.
- **Propagation.** Shared edits reach others on their next sync, and the ICS feed on the
  calendar app's next (hourly) fetch.
- **Removal and archiving.** A revoked space leaves Week and Month at once and the ICS
  feed on its next fetch. An archived space stays visible and read-only; you can hide it
  with the eye or archive it in your own sidebar (`space_prefs.archived`).

## 10. Team projects (v2)

**Structure.** A project space holds one item of type `project` with the id `project`
(`(p:<sid>, 'project')`, created with the space, never deleted): title, due date,
description, links, status. Tasks are `task` items in the same scope: title, date,
times, notes, subtasks (the checklist), `assignees`, status, `completed_by/at`.

**Course → Assignment → Project → Tasks.** `spaces.parent_space` + `parent_item` link a
project to a class assignment; the owner sets it and must be a class member when
linking. The link stores ids only: project members who are not in the class see no class
information, because the client shows the link only when it holds that class. Nothing is
duplicated: the assignment's date and weight and your grade live on the class item and
your mark; the project item holds the team's own deadline and description. A project
created or linked from an assignment takes the assignment's date as its starting
deadline. If the two drift apart later (the class moved the due date), the project
header, for members who hold the class, shows "Assignment due Oct 18" with **Use this
date**. That is an ordinary editor write. Nothing changes the project by itself.

- Assignment deleted, or class archived: the project is unaffected; its header says
  "Linked assignment removed" and the owner may relink.
- Project moves to another course: the owner relinks (`PATCH /api/spaces/:sid`).
- Leaving or being removed from the class does not touch project membership, and the
  other way round.

**Assignment rules.** `assignees` is `[]` (nobody), `[id, …]` (one or several) or
`["*"]` (everyone). Owners and editors assign; any member may claim an unassigned task
or unclaim themselves; assignees (everyone, for `*`) and editors may complete. Every
id written to `assignees` must be a live member of the project (checked in the
statement). A removed member is stripped from every `assignees` list in the removal
batch; a task left with nobody becomes unassigned, and the activity says so. A task has
one team status: when anyone completes a `*` task it is done for everyone, and
`completed_by` names who.

**Progress and workload** are worked out on the device from synced tasks: "12 / 18 ·
67%", and each member's open tasks in the next 14 days beside the assignee picker.

**Removal from a project.** The scope is revoked; your marks there (notes, hidden) are
deleted in the removal batch; your study sessions keep their minutes, labelled "a project
you left"; nothing is copied, because project rows are the team's. Grades are untouched:
a team project's grade is on the class assignment.

## 11. Invitations

Accounts are created only by the admin; invites never create accounts and never use
email.

| Path | Behaviour |
|---|---|
| Invite by username | Owner/editor: `POST /api/spaces/:sid/invites {username}`. Unknown name → `404 {error:'no_user'}` ("No Term account named 'gabriel'"); 20 an hour per user. Upserts on `(space_id, user_id)`, so a repeat refreshes the one invite |
| The invitee sees it | In the inbox (pending invites count towards the unread number in each sync response), with **Accept** / **Decline** |
| Accept | `POST /api/invites/:sid/accept` → one batch: check pending and unexpired, insert or revive the membership with the invite's role, mark accepted, write activity → the next sync loads the scope from cursor 0 |
| Decline | Status `declined`; the inviter sees it under Members |
| Expired (30 days) | Accept returns `410 {error:'expired'}`; shown as expired |
| Revoked | Inviter or owner: `DELETE …/invites/:uid`; accept then returns `404` |
| Already a member | Invite returns `409 {error:'member'}` |
| Removed, then invited again | Allowed; accepting revives the membership row. For a class, the merge sheet pairs the detached personal copy back **by id** |
| Space deleted before accepting | Its invites are deleted in the same batch; accept returns `404` ("This class no longer exists") |
| Invitee at the 20-space limit | Accept returns `409 {error:'limit'}`; the invite stays pending |
| Initial data | Accept writes the membership and the invitee's `space_prefs` (the class's default colour and term, adjusted on the join screen); the first v3 sync pages the new scope from 0 |
| Code or link | The owner makes an 8-character Crockford base32 code (~40 bits), stored as SHA-256, valid 7 days, ≤ 10 uses; a new code retires the old one. The link is `/#join=<code>`, read like `#spotify=` in `src/data/session.ts`, so the code never reaches server logs or `Referer`, and is cleared after reading. 10 join attempts an hour per user; a full space is `409 {error:'full'}`; joining by code accepts any pending invite to you |

**Joining a class** continues on the device: "Downloading Web Services…" until the first
page lands; choose a semester and colour; take the class's school calendar if you have
none; then the **merge sheet** if a personal course matches (identical ids first, then
type + normalised title + closest date; unsure pairs are left unpaired; "Not the same
item" undoes a pair; **Skip** leaves a banner for later).

## 12. Activity and inbox

**Activity** is user-facing and separate from `changes`, which stays an internal sync
log: it keeps only the latest change per row, with no actor and no previous value, so it
cannot serve as history. Item and course events come from `AFTER INSERT/UPDATE`
triggers on shared rows (`WHEN NEW.scope NOT GLOB 'u:*'`), which see `OLD` and `NEW`, so
"from → to" is the real previous value and the actor is `NEW.updated_by`. Member and
space events are written by their routes. If D1's SQLite refuses the coalescing upsert
inside a trigger, the statement moves into the Worker's write batch, which reads the old
row first. SQLite has allowed UPSERT in trigger bodies since 3.24. An
`INSERT … SELECT … ON CONFLICT` needs a `WHERE true`, as in `worker/db.js` today. Stage 7
confirms this on D1 before relying on it.

Recorded events: item or task created, deleted, restored; date, times, weight or title
changed; course meetings, room or instructor changed; task assigned (one row per newly
added assignee, `subject_user` = them), completed, reopened; member joined, left,
removed, role changed; space archived, unarchived, linked; ownership transferred.

- **Coalescing:** changes coalesce per (space, actor, verb, subject, 10-minute bucket),
  keeping the first `from`; a change that returns to where it started is deleted.
  Creations use `subject = ''`, so an import is one row with up to 10 titles.
- **Inbox** (derived; no per-user notification rows): pending invites to you; others'
  activity in your live spaces, filtered to what concerns you (new or deleted items, date
  changes, tasks assigned to you, completion of tasks assigned to you, archiving); and
  rows with `subject_user = you`, even after you left. Titles come from `detail`, so a
  row still reads after its item is deleted. `GET /api/inbox` when the sheet opens
  (cached for offline); the unread count in each sync response; `PUT /api/inbox/seen
  {seq}`.
- **Offline users** see the count on their next sync; nothing is pushed.
- **No duplicates:** one activity row per coalesced event, read by everyone it concerns.
- **Permission changes** ("Gabriel made you an editor") and removals are `subject_user`
  rows, so they reach the person concerned. Deleting a space writes one `space.deleted`
  row per other live member (at most 29) with `subject_user` set, because nobody can read
  a deleted space's own activity.
- **Cost:** the unread count rides on the sync response and is capped at 99. The inbox
  list loads only when its sheet opens.
- **Activity tab** per space: `GET /api/spaces/:sid/activity?before=`; offline it says
  "Connect to see activity".
- Activity rows and invites created more than 90 days ago are deleted nightly (pending
  invites expire after 30 days, so none is pending by then).

## 13. Deletion and archiving

| Action | Behaviour | Personal history |
|---|---|---|
| Delete a class item | Soft delete. A member with a meaningful mark keeps it as "Removed from … by Alex" with **Keep as mine** (one-item detach) / **Dismiss**; it counts in their grades until they choose. An editor's restore reconnects everything. Before the nightly purge hard-deletes it, meaningful marks are detached automatically | grades, notes, sessions kept |
| Delete a task | Soft delete; your note on it goes with it at purge | sessions keep their minutes |
| Delete a personal course | As today (its items lose their course, sessions their link) | as today |
| Class course / project item | Cannot be deleted; archive or delete the space | — |
| Archive a class or project | Read-only for everyone until unarchived; marks and prefs still save; still visible; a linked project is unaffected | untouched |
| Delete a class | Only when the owner is the only member; **Keep a copy** (on by default) detaches first | kept |
| Delete a project | Owner, typed confirm; the space is soft-deleted, and in the same batch every member's marks and prefs there are soft-deleted, its invites are deleted, and members are told (`space.deleted`, §12); scopes revoked | sessions keep their minutes |
| A member leaves a class | Detach (opt out with a checkbox); membership soft-deleted. Opting out deletes your marks and prefs there, clears `class_id` on your personal items under it (they stay, without a course), and leaves your sessions' minutes and ids alone, labelled "a class you left" | kept (minutes); grades and notes only with the copy |
| A member is removed from a class | Detach, always | kept |
| A member leaves or is removed from a project | §10: marks deleted, stripped from assignees | sessions keep their minutes |
| Transfer ownership | Old owner → editor, then new owner → owner, in one batch | — |
| An account is deleted (admin) | Each space it owns transfers to the longest-standing editor, else the longest-standing member. A space with nobody else in it is deleted. Its other memberships are removed, and it is stripped from `assignees`. Its own rows are deleted as today, now including its marks, prefs, memberships, invites, `inbox_seen` and its `u:` change feed. Its past edits keep `updated_by` and read "a former member" | — |

**The nightly purge** (`purgeTombstones`, extended) runs in this order, in one batch:

1. Auto-detach meaningful marks on shared items whose tombstone is about to expire.
2. Delete marks whose item is about to be purged.
3. For each space deleted more than 30 days ago: its items, then its course, then its
   `changes`, members, invites and activity (except `subject_user` rows, which age out
   at 90 days), then the space.
4. Today's steps: raise the floor, then delete old changes and old tombstones, now
   including `marks`, `space_prefs`, `members` and `spaces`.

**Absorb** (personal → class) and **detach** (class → personal) are set-based D1 batches
(`INSERT … SELECT`, pairs via `json_each()`): a handful of statements whatever the size,
and safe to retry.

- **Convert** (`POST /api/spaces {kind:'class', convertCourseId, items:[id]}`): the sheet
  lists the course's items, all ticked except tasks, which start unticked. Generated
  lecture reviews and custom-typed items cannot be ticked: reviews are yours, a custom
  type is yours alone, and the `c:` CHECK refuses it. The sheet also warns "Links become
  visible to the class". The batch creates the class with you as owner. It copies the
  course and the ticked items in under the same ids, moving your personal fields
  (status, grade, checklist, notes, completion) into marks and the course's colour,
  target, term and archived flag into prefs. It soft-deletes those personal rows
  directly, not through the course-delete path, which would null `course_id`. Unticked
  items stay yours, with `class_id` set and `course_id` cleared. It sets `space_id` on
  your sessions and achievements that point at the course or a moved item.
- **Merge on join** (`POST /api/spaces/:sid/absorb {courseId, pairs}`): for each pair,
  write a mark from your item, repoint sessions and achievements to the shared id and
  soft-delete your item; set `class_id` on unmatched items; soft-delete the empty personal
  course. A member's absorb writes no shared row. The Worker checks every `mine` id is
  yours and in `courseId`, and every `shared` id is a live item of that class. Your
  course's colour and target move into your prefs if you have not set them on the join
  screen. A custom-typed item is never paired: it stays yours, under the class.
- **Share one item** (editor; `POST /api/spaces/:sid/absorb {items:[id]}`): a personal
  item under the class becomes a class item under the same id, your fields moving to a
  mark. A custom-typed item must be given a built-in type first (`400 {field:'type'}`).
- **Detach:** copy the class course and live items into your scope under the same ids (an
  upsert, so unpurged tombstones from a convert revive rather than duplicate). The copy
  takes your prefs' colour, target, term and archived flag, and your marks are folded in (your notes
  win; the class notes are appended under "Class notes"). Items you hid are left out
  unless your mark on them is meaningful (a grade, notes, a checklist or a status). Your `class_id` items
  are repointed to the copy (`course_id` set, `class_id` cleared), `space_id` is cleared
  on sessions and achievements, and your marks and prefs are deleted. A rare clash with a
  live personal id gets a new id, and sessions follow it.

## 14. API (endpoints only)

```
GET    /api/sync?v=3&cursors=…&sv=…
POST   /api/spaces                          {kind:'class', course | {convertCourseId, items} | outline} · {kind:'project', title, parent?} (title → the project item)
GET    /api/spaces/:sid                     details (school-calendar snapshot, code status)
PATCH  /api/spaces/:sid                     archive/unarchive, refresh school calendar, link a project
DELETE /api/spaces/:sid                     {keepCopy} (class: only member; project: owner)
GET|PUT|DELETE /api/spaces/:sid/courses/:id
GET|PUT|DELETE /api/spaces/:sid/items/:id   class items, the project item, tasks
POST   /api/spaces/:sid/items/:id/keep      one-item detach
POST   /api/spaces/:sid/absorb              {courseId, pairs} · {items}
PUT    /api/spaces/:sid/members/:uid        {role}
DELETE /api/spaces/:sid/members/:uid        remove
POST   /api/spaces/:sid/leave               {keepCopy}
POST   /api/spaces/:sid/transfer            {userId}
POST   /api/spaces/:sid/invites             {username, role?}
DELETE /api/spaces/:sid/invites/:uid
POST   /api/invites/:sid/accept · /decline
POST|DELETE /api/spaces/:sid/code
POST   /api/join                            {code}
GET|PUT|DELETE /api/marks/:sid/:itemId
GET|PUT|DELETE /api/space_prefs/:sid
GET    /api/spaces/:sid/activity?before=
GET    /api/inbox
PUT    /api/inbox/seen                      {seq}
```

Errors keep the existing shape `{error, field?}`; rate limits use `worker/limits.js`.

## 15. UX

- **Sidebar:** classes in the course list (two-person glyph; hover "Shared · 5
  members"); a **Projects** group below (team glyph, progress ring); eye toggles on every
  row. **+ New course** becomes a menu: *New course*, *New shared class*, *New team
  project* (v2), *Join with code*. No separate Groups page.
- **Course sheet** for a class: the existing content plus **Members** (names, roles,
  invite, code, remove, transfer, archive, merge my personal course) and **Activity**.
  *Convert to shared class* on a personal course.
- **Project sheet** (v2): **Tasks** (by date, assignee chips, claim, progress, workload
  beside the picker), **Members**, **Activity**, and the linked assignment.
- **Item card:** a **Class** or **Team** section (shared fields, "Edited by Alex · 2h
  ago", locked for members) and **Yours** (status, grade, checklist and weight override
  on class items; notes and Hide on all). Hiding a graded item asks first. Hidden items
  stay listed under their space with **Show again**. An override that differs from a
  changed class weight says so, with **Use class weight**.
- **Removed items:** "Removed from Web Services by Alex" with **Keep as mine** /
  **Dismiss**.
- **Top bar:** a bell with the unread count opens the inbox sheet (full-screen on phones).
- **Import:** target picker and diff preview for outlines; *New shared class → From
  course outline*.
- **Conflicts** in Settings name who made the competing change.

## 16. Migration and compatibility

- rounds-v7 by the clean-db procedure; `move-db.mjs` maps `user_id → 'u:' || user_id`
  for `courses`, `items`, `changes`, tested against the legacy fixture. Remote migrations
  are applied by hand (Git builds skip them).
- Existing courses, items, grades, sessions, semesters and calendar feeds stay personal
  and keep working; nothing is converted automatically. Sharing happens only by convert,
  merge on join, share one item, or creating a space.
- `sync?v=2` and the personal routes remain for stale tabs; they never see shared data.
  v2 pages only the five kinds an old client knows (`courses`, `items`, `quotes`,
  `study_sessions`, `achievements`), so `marks` and `space_prefs` never reach code that
  cannot read them. Its cursor still moves to the head, as today. An old client sees a
  personal item under a class as an item with no course.
- **Fields an old client does not send keep their stored values.** A `PUT` on a personal
  item without `classId`, a session or achievement without `spaceId`, or `PUT /api/me`
  without `hiddenSources` leaves those columns as they are. This is how `PUT /api/me`
  already treats `types`, `studyFlow`, `studyPrefs` and `schoolCalendar`. A new client
  always sends them, with `null`/`[]` to clear. A row write without `changed` is a
  whole-row write, exactly as today.
- The IndexedDB v5 upgrade moves the cursor and adds stores, keeping pending ops and
  conflicts. An open tab still on version 4 gets `versionchange`, closes its connection
  and reloads into the new code, so two client versions never share one database.
- Converting is reversible: detach rebuilds a personal copy under the same ids with your
  marks folded back in.

## 17. Security

| Threat | Defence |
|---|---|
| IDOR / guessed ids | Every shared statement re-checks membership and role; ids are not secrets; non-members get 404 |
| Missing membership checks | One builder (`access.js`); a test per route for non-member, member, editor, owner, archived |
| Client-controlled ownership | Scope comes from the route and session, never the body; space ids are made by the Worker; absorb ids are verified; `updated_by` and `completed_by` come from the session; `class_id`/`space_id` are labels on your own rows and open nothing |
| Role escalation | Role changes are owner-only; editors invite only with the default role; a member's write applies only allowed fields named in `changed`, checked against the current row; assignees must be live members; one-owner index |
| Unauthorised sync data / a removed member still syncing | Guard inside the paging statement; `revoked` purges the device |
| Invitation abuse | Rate limits; invites only to existing accounts; upsert prevents duplicate rows |
| Guessable codes | ~40 bits, hashed, 7-day expiry, use limit, 10 attempts an hour |
| ICS exposure | The feed URL is per user (HMAC token, as today); its query joins live membership |
| Private grades, notes, study history | Read only with `user_id = me`; no aggregates; activity records only shared fields |
| Cross-space access | Composite keys `(scope, id)`; FKs inside one scope; a project's link to a class needs the owner's class membership at write time, and the link shows class data only to people who hold that class |
| Old clients | They page only their own kinds and cannot clear the new columns (§16) |
| Cached unauthorised data | Purged on `revoked`; until then it is data the user already saw |
| Username enumeration | Accepted for an invited group; rate-limited; login lockouts protect each name |

## 18. Cloudflare free tier

- **Requests:** nothing new in the background; the unread count rides on sync; inbox and
  activity load on open.
- **D1 reads:** sync reads ≤ 101 rows per scope per page via `(scope, seq)`, ≤ 20
  membership rows, member lists only for spaces that changed, and an inbox count capped
  at 100 rows; the ICS feed is a few queries per hourly fetch.
- **D1 writes:** no fan-out (a mark exists only once you touch an item; joining writes
  your membership and prefs); activity coalesces; absorb, detach and convert are a
  handful of set-based statements; the nightly cron adds a few set-based statements
  (§13's purge order).
- **Workers AI:** one editor's outline import serves the class; the shared school
  calendar saves each joiner a read.
- **Storage:** activity 90 days; tombstones 30 days. The nightly purge also hard-deletes
  tombstones of `marks`, `space_prefs`, `members` and `spaces` older than 30 days (a
  later rejoin inserts a fresh membership).
- No Durable Objects, WebSockets, Queues, R2 or paid services.

## 19. Edge cases

| Case | Behaviour |
|---|---|
| Two users edit at once | Field-level merge; the same field → Conflicts, naming who and what |
| Edit offline; lose permission offline | §6 |
| Owner leaves | Must transfer first; the last member may archive or delete |
| Last owner tries to leave | Refused: "Transfer ownership first", or, when they are the only member, "Delete the class instead" (with **Keep a copy**) |
| Project with no members | Impossible: the owner is a member; account deletion transfers or deletes |
| Assignment in an archived class | Visible, read-only; marks still save; a linked project is unaffected |
| Task assigned to a removed member | Stripped in the removal batch; unassigned if nobody is left |
| Shared assignment deleted after someone recorded a grade | Kept as "Removed…" until Keep/Dismiss; detached automatically before purge |
| User hides a shared calendar | Eye toggle; membership untouched; ICS honours it |
| User rejoins a space they left | Membership revived; full reload from cursor 0; a class merge pairs by id with the detached copy |
| Duplicate invitations | Upsert on `(space_id, user_id)` |
| Duplicate imports | The diff preview marks "Already there" |
| Course changes semester | Editors change the default `term`; members who picked their own keep it |
| Project moves to another course | The owner relinks; nothing is copied |
| Shared item becomes personal | **Keep as mine** (removed items), or leaving with detach |
| Personal item becomes shared | **Share with class** on a personal item under the class (editors) |
| Two devices press Keep | Same ids, upserts; the second does nothing |
| Recurring shared items | One status per series, on your mark, as today |
| Expired cursor | That scope alone resets |
| Space full | `409 full` |
| One person on two devices | Web Locks and pending ops as today; their marks merge field by field |
| Clients that have not updated | v2 sync and personal routes; no shared data; only known kinds; missing fields keep their values |
| A personal and a class course with the same id | Views key by `scope/id`; sessions resolve through `space_id` |
| Converting a course with custom-typed items or lecture reviews | They stay yours under the class (`class_id`) |
| Pending mark edits when a class is revoked | Re-queued onto the detached copy; otherwise Conflicts |
| Owner's account deleted and nobody else is in the space | The space is deleted |
| Joining past 20 spaces | `409 limit`; the invite stays pending |
| An editor moves the assignment a project is linked to | The project keeps its date; its header offers **Use this date** |
| A member completes a task while an editor edits other fields | Both stand: the member's write carries only its allowed fields |
| A class item is purged | Meaningful marks were detached first; the rest of its marks are deleted with it |
| A member renames their display name | Others see it after their next app open (`sv=0`) |

## 20. Flows

**Create a class.** *New shared class* (blank, from an outline, or *Convert* on a
personal course) → `POST /api/spaces` → one batch: space (Worker id), owner membership,
course (and items) in `c:<sid>`, prefs, activity → the next sync pages the new scope.

**Join a class.** Invite → inbox → **Accept** (or a `/#join=` code) → membership batch →
sync loads `c:<sid>` from 0 → join screen (semester, colour, school calendar) → merge
sheet → absorb batch.

**Create a shared assignment.** An editor adds an item with the class as its course →
`shared_items` + pending op → `PUT /api/spaces/:sid/items/:id` → guard, write; the
trigger writes `changes` and coalesced activity → members see it on their next sync and
in their inbox.

**Create a project** (v2). *New team project* → `POST /api/spaces {kind:'project', title,
parent?}` → one batch: space, owner membership, the `project` item, prefs → invite
teammates, who join as editors.

**Assign a task** (v2). An editor sets `assignees` → field-merge write → the trigger
writes `task.assigned` per new assignee → their inbox; the task appears in their Week.

**Offline edit, conflict, leave, remove, revocation:** §6 and §13.

## 21. Trace test

1. The admin creates Gabriel's and Alex's accounts (Admin page or `user:add`).
2. Gabriel: *New shared class* → `POST /api/spaces` → `c:<web>` with its course; he is owner.
3. Gabriel invites `alex` → invite row (role member) + activity.
4. Alex's next sync counts the invite in his inbox → **Accept** → membership.
5. Alex's next sync: `c:<web>` is new → cursor 0 → the course and items land in `shared_courses` / `shared_items`; join screen; he has no personal copy, so no merge.
6. Gabriel adds "REST API Project, Oct 15, 20%" → guarded write → `changes` + activity.
7. Alex syncs, then goes offline: the item is in `shared_items` and drawn from IndexedDB.
8. Alex writes notes → `marks` row `<web>:<item>` locally, with a pending op.
9. Gabriel cannot see them: marks live in `u:<alex>`, are read only with Alex's user id, and activity never records marks.
10. Gabriel: *New team project* "Fire Response API", linked to the assignment → `p:<fire>`, parent `c:<web>` / item; Gabriel is owner; the project item starts with the assignment's date, Oct 15.
11. Gabriel invites Alex to the project → accept → editor; Alex's next sync adds `p:<fire>`.
12. Gabriel creates "Create incidents endpoint" with `assignees: [alex]` → the trigger writes `task.assigned` (`subject_user` Alex).
13. Alex, offline, marks it done → `shared_items` status `done` (shown as completed by him), pending op with `base` and `changed` = status, completed_at; the Worker stamps `completed_by` from his session on upload.
14. Gabriel moves the assignment to Oct 18 → the `c:<web>` item's revision moves on; activity "Oct 15 → Oct 18".
15. Alex reconnects → push: the task write succeeds (he is an editor in the project, and its revision has not moved); his mark uploads.
16. Pull: the assignment's new date arrives. The project item (still Oct 15) now differs from the assignment, so both show, and the project header offers **Use this date**; Alex's completed task is the team's (`completed_by` Alex) and Gabriel sees it on his next sync.
17. Alex's inbox count includes "REST API Project: Oct 15 → Oct 18".
18. Alex records 87% → his mark.
19. Private, as in step 9.
20. Alex studies it for 1h 25m → a `study_sessions` row in `u:<alex>` with `space_id = web` and the `item_id`.
21. Private: sessions are read only by their owner; the leaderboard shows opt-in totals only.
22. Gabriel removes Alex from the project → one batch: membership soft-deleted, Alex stripped from assignees, his project marks deleted, activity (`subject_user` Alex).
23. Alex's next sync: `p:<fire>` is in `revoked` → its rows are purged locally; a push to it would get 404.
24. Alex is still in `c:<web>`: membership is per space.
25. The assignment stays in his Week, with his grade and notes.
26. The project item and tasks are gone from his device; his inbox keeps "You were removed from Fire Response API".
27. His study sessions keep their minutes; the one on the class assignment is untouched; his grade lives on the class item.
28. His ICS feed: the next fetch joins live memberships, so it has the class and nothing from the project.

## 22. MVP boundary

**v1 — shared classes**, seven stages, each merged and deployed on its own. Stages 1–2
are invisible. From stage 3 the class features are shown only to admins (George tests
with a second account made admin for the purpose) until **stage 6** is live. Nobody can
join a class before they can keep grades in it (stage 4) and leave it (stage 5). Nobody
can convert a course before the calendar feed carries class events (stage 6), because
otherwise its events would disappear from their Google or Apple calendar. The admin-only
gate is a client check plus a Worker check on the routes that create or join a space
(`403` for non-admins), so the UI is not the only barrier.

1. rounds-v7 and the scope refactor: `scope` on courses, items and `changes`, the new columns on existing tables (so no table is rebuilt later), `move-db.mjs`. Nothing visible changes.
2. Spaces and sync v3: `spaces` and `members` tables, `access.js`, cursors per scope, `revoked`, split shared stores, `effectiveItems()`, field-level merge, 403 handling.
3. Classes: create, convert, invites, codes, join, members, roles, and a plain list of pending invites (the inbox comes in stage 7). Removing and leaving wait for detach in stage 5, so they are not offered yet.
4. The personal layer: marks, prefs, the split item card, markers, eye filter, merge sheet.
5. Leaving and removal: detach, leave, remove, archive, transfer, Keep/Dismiss, account deletion, the extended nightly purge.
6. ICS feed and outline import into a class; a class from an outline; the school-calendar offer. **Lifts the admin-only gate.**
7. Inbox and activity.

**v2 — team projects** on v1's foundation: project spaces and the project item; tasks
with assignees, claiming and completion rules; the link to an assignment and chip
folding; progress and workload; the project sheet; task events in the inbox and ICS.

**Later:** suggested changes approved by an editor (whole classes); comments; milestones
and task dependencies; personal date overrides; reminders; class leaderboards;
meeting-level merge; `.ics`/CSV/schedule import into classes; templates; meeting
conflict detection.

**Avoid for now:** live collaboration, WebSockets or push, attachments (links only),
email, public class discovery.

## 23. Testing

- **Worker** (vitest in the Workers runtime, local D1): an access matrix for every route
  (non-member 404, member 403, archived 403, owner-only); sync v3 paging, cursors, a new
  scope from 0, per-scope reset, `revoked`, a removal between the two queries;
  field-level merge cases (disjoint, same field, JSON by value, edit vs delete both ways,
  lost race, two first marks on one item); member task-write rules (only allowed fields
  in `changed`, other body fields ignored, `completed_by` from the session, assignees
  must be members); member lists only above `sv`; v2 paging only its five kinds; a
  field missing from an old client's body kept; the admin-only gate refusing non-admins;
  the purge order with a deleted space; absorb, convert (with custom-typed items and
  reviews left personal) and detach run twice with
  identical results; activity triggers and coalescing; `move-db.mjs` against the fixture;
  every new `CHECK`.
- **Client** (vitest + jsdom): `effectiveItems()` and grades on merged items (override,
  hidden, removed-but-kept, project status); `scope/id` keys with a personal and a
  class course sharing an id; the IndexedDB v5 upgrade; 403 in the sync loop; `revoked`
  applied after the last page, with a pending mark edit carried onto the detached copy;
  the merge sheet's matching.
- **By hand, two accounts:** the §21 trace (steps 10–26 once v2 lands), offline on both
  sides, the ICS feed after each step.

## 24. Open decisions

None block implementation planning. The review found no question that needs a product
answer before building. Each correction above follows from the existing architecture or
from a decision already taken.

These choices are product preferences that George may still change. Each has a working
default, and changing one alters a single rule, not the architecture:

| Choice | Default | Alternative and its consequence |
|---|---|---|
| Default join roles | class: member, project: editor | Project members join as members: editors must assign and complete more of the work |
| Removal from a project | keeps no copy | Copy the project into the person's scope: a team's tasks would then live on in personal data after they left |
| Deleting a project with members | owner may, with a typed confirm | Allow it only when the owner is alone, as for classes: abandoned projects then need archiving |
| Suggested changes | Later | In v1: a `suggestions` table, a queue for editors and inbox rows, about one extra stage |
| Hidden calendar sources in Stats | still counted | Leave them out: Stats would then disagree with grades |
