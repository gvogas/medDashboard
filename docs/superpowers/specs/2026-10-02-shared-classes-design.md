# Collaboration: shared classes and team projects — design

Agreed in brainstorming 2026-10-02; this document is the source of truth for the
architecture. Not built yet. It answers `TERM-COLLABORATION-PLANNING-PROMPT.md`.
v1 builds **shared classes**; **team projects** are v2 on the same foundation and are
fully designed here so the foundation does not need to change for them.

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
| Invite | the space | the space's owner/editors; the invitee | owner/editor | — | inviter/owner (revoke); invitee (decline) | `invites` | inbox cache | no | answered rows purged after 90 d | no | deleted with the space |
| Personal course/item | `u:` | self | self | self | self | `courses`/`items` | `courses`/`items` | yes | yes | `u:` | — |
| Class course | `c:` | class members | created with the class | owner/editor | never (archive the class) | `courses` | `shared_courses` | yes | yes | `c:` | purged locally; detach copy |
| Class item | `c:` | class members | owner/editor | owner/editor | owner/editor | `items` | `shared_items` | yes | yes | `c:` | purged locally; detach copy |
| Project item | `p:` | project members | created with the project | owner/editor | never (archive/delete the project) | `items` | `shared_items` | yes | yes | `p:` | purged locally |
| Task | `p:` | project members | owner/editor | owner/editor; member: status and claiming of own tasks | owner/editor | `items` | `shared_items` | yes | yes | `p:` | purged locally |
| Mark (my layer on a shared item) | user | self only | self | self | self | `marks` | `marks` | yes | yes | `u:` | class: folded into detach copy; project: deleted |
| Space prefs (my colour, target, semester, archived) | user | self only | self (on join) | self | self | `space_prefs` | `space_prefs` | yes | yes | `u:` | deleted |
| Study session | user | self only (leaderboard: opt-in totals) | self | self | self | `study_sessions` | `study_sessions` | yes | yes | `u:` | kept; link repointed by detach, or labelled "a project you left" |
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
| `spaces` | `id`: 12 chars `[a-z0-9]`, **made by the Worker** | `kind` `class`\|`project`; `name` (project only, 1–80; a class shows its course); `archived` 0/1; `school_calendar` JSON snapshot (class only); `parent_space`, `parent_item` (project only: the class assignment it belongs to; nullable, no FK); `code_hash`, `code_expires`, `code_uses_left`; `created_at`, `updated_at`, `deleted_at`, `revision` |
| `members` | `(space_id, user_id)` | `role` `owner`\|`editor`\|`member`; `joined_at`, `updated_at`, `deleted_at` (left/removed), `revision`. Partial unique index `(space_id) WHERE role = 'owner' AND deleted_at IS NULL`: exactly one live owner, stored nowhere else |
| `invites` | `(space_id, user_id)` | `invited_by`, `role` (given on accept), `status` `pending`\|`accepted`\|`declined`, `created_at`, `expires_at` (30 days) |
| `marks` | `(user_id, id)`, `id = space_id \|\| ':' \|\| item_id`; unique `(user_id, space_id, item_id)` | `space_id`, `item_id`, `status`, `grade`, `weight` (override), `notes`, `checklist`, `completed_at`, `hidden` 0/1, timestamps, `deleted_at`, `revision`. Same `CHECK`s as the matching `items` columns. On a project row only `notes` and `hidden` are used (the Worker refuses the rest) |
| `space_prefs` | `(user_id, id)`, `id = space_id` | `space_id`, `color` (one of the twelve), `target`, `term` (your semester name; class only), `archived` 0/1, timestamps, `deleted_at`, `revision` |
| `activity` | `seq` autoincrement | `space_id`, `actor_id`, `verb`, `subject` (item or user id; `''` for creations, never NULL, so the unique key can match), `subject_user` (who it is about, for member and assignment verbs), `detail` JSON (titles and from → to, so it reads after the item is gone), `bucket` (10-minute bucket), `at`. Unique `(space_id, actor_id, verb, subject, bucket)` for coalescing |
| `inbox_seen` | `user_id` | `seq`: the last activity row read. Kept off `users`, so reading never bumps the profile revision |

`marks` and `space_prefs` carry one text `id` like every other personal table, so the
existing `changes` key, `applyPage`'s `row.id` lookups and pending keys
(`marks:<space>:<item>`) keep their shape. Space ids are `[a-z0-9]`, so the id splits
unambiguously; user ids are UUIDs.

### Changed tables

| Table | Change |
|---|---|
| `courses` | `user_id` → `scope` (`u:` or `c:` only); PK `(scope, id)`; `updated_by` |
| `items` | `user_id` → `scope`; PK `(scope, id)`; FK `(scope, course_id) → courses(scope, id)`; `updated_by`; `class_id` (personal item under a class; no FK, the Worker checks membership); `assignees` JSON array (user ids, or `["*"]` for everyone; ≤ 30); `completed_by` |
| `items` CHECKs | `u:` rows: `assignees = '[]'`, `completed_by IS NULL`; `class_id` only with `course_id IS NULL`. `c:` rows: `grade IS NULL`, `checklist = '[]'`, `status = 'todo'`, `completed_at IS NULL`, `completed_by IS NULL`, `assignees = '[]'`, `class_id IS NULL`, built-in `type`. `p:` rows: `grade IS NULL`, `weight IS NULL`, `course_id IS NULL`, `class_id IS NULL`, `type IN ('project','task')`; status, `completed_at`, `completed_by` and the checklist (subtasks) belong to the team |
| `study_sessions`, `achievements` | `space_id` (nullable): set when `course_id`/`item_id` point at a shared row |
| `users` | `hidden_sources` JSON array ≤ 40 (personal course ids, space ids, `personal`) |
| `changes` | `user_id` → `scope`; `UNIQUE (scope, kind, row_id)`; index `(scope, seq)`. Triggers on personal tables write `'u:' \|\| user_id`; only `courses` and `items` write `c:`/`p:` |

Shared `notes` and `links` on class and project rows belong to the space (class notes,
project description) and are edited by owner/editor.

### Query patterns and indexes

| Query | Served by |
|---|---|
| My spaces, with members and names (each sync) | `members (user_id) WHERE deleted_at IS NULL` → `members` PK `(space_id, user_id)` → `users` PK |
| Members of a space | `members` PK prefix `space_id` |
| Check membership / role (every guard) | `members` PK `(space_id, user_id)` |
| Changes since a cursor, per scope | `changes (scope, seq)` |
| Shared rows of a space (ICS, detach, absorb) | `courses`/`items` PK prefix `scope` |
| Tasks assigned to me (ICS) | `items` PK prefix `p:<sid>` for my project scopes, filtered with `json_each(assignees)`; ≤ 200 rows per project |
| My marks / prefs in a space (detach, revoke) | `marks (user_id, space_id)`; `space_prefs` PK |
| Personal items under a class | `items (class_id) WHERE class_id IS NOT NULL` |
| Sessions linked to a space | `study_sessions (user_id, space_id)` |
| Inbox: activity in my spaces since seen | `activity (space_id, seq)` per space |
| Inbox: activity about me | `activity (subject_user, seq)` |
| Invites to me | `invites (user_id) WHERE status = 'pending'` |
| Activity tab | `activity (space_id, seq)` |
| Purges | existing `*_deleted` indexes; `activity (at)`; `invites (created_at)` |
| Join by code | `spaces (code_hash) WHERE code_hash IS NOT NULL` |

### Limits

30 live members per space; 20 spaces per user; 200 live tasks per project (Worker).

## 4. Shared vs personal

| Thing | Shared (one row; who edits) | Personal (only you; in `marks`, `space_prefs` or your own rows) |
|---|---|---|
| Class course | code, name, instructor, meetings, default `term` (owner/editor) | colour, grade target, your semester, archived in your sidebar |
| Class item (assignment, exam, quiz, lab, …) | type (built-in), title, date, start/end, location, weight, recurrence, class notes, links (owner/editor) | status, completion time, grade, weight override, checklist, your notes, hidden |
| Project item | title, due date, description, links, status (owner/editor) | your notes, hidden |
| Task | title, date, times, notes, links, subtasks, assignees, status, completed by/at (owner/editor; members: status and claiming of their own tasks) | your notes, hidden |
| Everything else | — | study sessions, achievements, what-if scores, lecture reviews, exam-prep checklists, calendar visibility |

Term has no reminder feature today; if one is added, its settings go in `marks`.

How private data stays private: marks, prefs, sessions and achievements are only ever
read with `user_id = <session user>`; no route returns another user's rows or an
aggregate of them; `u:<me>` is only ever paged for that user; the ICS feed is built per
user; activity records only shared fields. A member sees other members' display names,
roles and authorship of shared changes, and nothing else.

## 5. Permissions

| Operation | Owner | Editor | Member | Server check |
|---|:-:|:-:|:-:|---|
| Read the space; keep your own layer | ✓ | ✓ | ✓ | membership guard in the statement |
| Create / edit / delete / restore class items; edit class course facts | ✓ | ✓ | | role guard in the statement; space not archived |
| Create / edit / delete tasks; assign; edit the project item | ✓ | ✓ | | same |
| Complete or reopen a task assigned to you or to everyone | ✓ | ✓ | ✓ | members: the Worker diffs against the current row; only `status`/`completed_*` may change |
| Claim an unassigned task (`[]` → `[you]`) or unclaim yourself | ✓ | ✓ | ✓ | members: only that change to `assignees` |
| Import an outline into a class | ✓ | ✓ | | ordinary shared writes |
| Invite by username with the space's default role | ✓ | ✓ | | owner/editor guard |
| Invite with another role; invite code; change roles; remove | ✓ | | | owner guard |
| Archive / unarchive; refresh school calendar; link a project; transfer | ✓ | | | owner guard; linking also needs class membership |
| Delete a class | when the only member | | | owner guard + member count in the statement |
| Delete a project | ✓ (typed confirm) | | | owner guard |
| Leave | after transferring | ✓ | ✓ | self |
| Suggest / approve a change (moderator) | later | later | later | — |

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

### Pull: `GET /api/sync?v=3&cursors=u:<me>:812,c:ab12cd34ef56:640`

Each entry is `scope:seq`, split at its last `:`.

1. **Memberships.** One query reads my live memberships with their spaces and members'
   names. The scopes to page are `u:<me>` plus those spaces; one the client did not send
   starts at 0, so a new space loads in full.
2. **Page.** One statement, each branch capped:
   `SELECT * FROM (SELECT … FROM changes WHERE scope = ? AND seq > ? AND <guard> ORDER BY seq LIMIT 101) UNION ALL … ORDER BY seq LIMIT 101`.
   `<guard>` re-checks live membership of a live space inside the statement, so a
   removal between the two queries cannot leak a page.
3. **Cursors.** If the page ends at sequence X, every scope's rows up to X have been
   delivered, so each cursor becomes `max(cursor, X)`, or the head on the last page.
4. **Response.**
   `{scopes:[{id, kind, role, archived, name, parent, members:[{userId, name, role}]}], cursors, changes, more, reset:[scope], revoked:[scope], inbox}`.
   `reset` is per scope: that scope's cursor fell below the purge floor, so only its
   clean rows are rebuilt. `revoked` lists scopes the client sent that it may no longer
   read. `inbox` is the unread count.
5. `cursors` holds ≤ 25 entries; malformed input is `400`. `/api/sync?v=2` and the
   personal routes remain, scoped to `u:<me>`, for clients that have not updated.

Freshness: sync after each edit, on focus, and every 5 minutes while visible, as today.
No WebSockets and no extra polling.

### Push

Personal courses, items, quotes, sessions and achievements keep whole-row `If-Match`.
Shared courses and items, marks, space prefs and the profile use a **field-level
merge**: the pending op keeps `base` (the row when first queued) and sends the full row
plus `changed: {field: oldValue}`.

1. Revision matches → write as today.
2. Otherwise each changed field is safe if its current value equals the old or the new
   value; if all are safe, only those fields are written onto the current row, guarded by
   the current revision, with one retry on a lost race.
3. Otherwise `409 {current, fields, by}` → the Conflicts review ("Gabriel changed Date
   to Oct 18").

JSON fields (`meetings`, `links`, `checklist`, `assignees`) count as one field each,
compared after stable re-serialisation. For a member's task write the Worker compares the
body with the **current row** (it never trusts `changed`) to enforce §5.

### End to end: one member edits, another sees it

1. The editor saves in the item card → one IndexedDB transaction writes `shared_items`
   and a pending op `items:c:<sid>:<id>` with `base`; `notify()` redraws; BroadcastChannel
   tells other tabs.
2. Sync, holding the Web Lock, pushes `PUT /api/spaces/<sid>/items/<id>` with `If-Match`.
3. The Worker resolves the user from the cookie and runs the upsert carrying the role
   guard. D1 sets `revision` from the global sequence, `updated_by` and `updated_at`; the
   items trigger writes `changes` (scope `c:<sid>`) and, for meaningful fields, `activity`.
4. The saved row comes back → `settleOperation` replaces the local row and drops the op.
5. Another member's next sync pages `c:<sid>` past their cursor → `applyPage` writes
   `shared_items` (skipping rows they have a pending op on, or hold at a newer revision)
   → `notify()` → `effectiveItems()` recomputes → Week and Month redraw.

### Offline and concurrency

| Case | Outcome |
|---|---|
| Gabriel (rev 4) changes the deadline; Alex (rev 4, offline) the description; Gabriel syncs first | Alex's push: revision is 5, not 4; `description` still equals Alex's base, so it is safe and is written onto rev 5 → rev 6. Both changes stand; nobody sees a conflict |
| Both change the date | The second push conflicts on `date` → `409`; their version goes to Conflicts with "Gabriel changed Date to Oct 18", to restore (another guarded write) or discard |
| Gabriel edits offline; Alex deletes the item | Gabriel's push: `409` with the tombstone → Conflicts: "Deleted by Alex"; Gabriel, as editor, may restore it, which revives the row |
| Alex deletes an item Gabriel has since edited | Alex's delete: `409` → "Gabriel edited this. Delete anyway?" |
| Gabriel edits shared data offline, is removed, reconnects | Push: `404` → Conflicts ("You no longer have access to Web Services"). Pull: the scope is in `revoked` → one IndexedDB transaction deletes its rows, marks and prefs and moves its pending ops to Conflicts. For a class, the detach copy written by the removal batch arrives in the same response, so his grades and notes reappear as a personal course |
| Made view-only while offline | Push: `403 forbidden` → Conflicts at once (the sync loop adds 403 to the statuses it rejects; today it would retry three times) |
| Space archived while offline | Shared pushes: `403 archived` → Conflicts; marks still save |
| Pending edit to your personal item under a class when detach ran | Detach bumped its revision → `409` → Conflicts, beside your copy |
| A mark on an item created offline | Upload order: course puts → item puts → mark and pref puts → course deletes. A mark whose item was refused goes to Conflicts |

### Revocation

- **Server access stops at once:** every read and write statement re-checks membership.
- **The client learns** from `revoked` on its next sync, or from `404` when it pushes.
  Until then it shows only what it already had, which its user had seen.
- **Cached data is removed** in one transaction on `revoked`; nothing in IndexedDB keeps
  showing the space.
- **Pending writes** are rejected (`404`) and kept in Conflicts.
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
| `pending`, `conflicts` | | unchanged; ops gain `base`; shared keys are `items:c:<sid>:<id>` |

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
| Grades | `courseGrade()` unchanged, fed merged items: weight `mark.weight ?? item.weight`, grade and status from the mark, plus personal items under the class. Target from `space_prefs`; what-if scores on the device. Project rows carry no weight (CHECK), so they never enter grades: a team project's grade is your mark on the class assignment |
| Study | Sessions personal; `space_id` set when logged against a shared course or item. History, goal, streak, heatmap and leaderboard count your minutes only. Per-course totals group by `(space_id, course_id)`. Pickers list merged items |
| Achievements | Built-in ones read merged items; "tasks done" counts tasks with `completed_by = you`; once shown as earned they are not withdrawn because an item was hidden. Custom achievements gain `space_id` |
| Exam prep | Works on class exams; its lecture checklist goes into your mark |
| Lecture reviews | Personal tasks from a class's meetings, with `class_id`. A converted course keeps its id, so the review chain carries on; after a merge existing reviews move under the class and the `through` watermark prevents duplicates |
| Semesters | Everyone keeps their own school calendar. `space_prefs.term` picks your semester for a class (on join: the same name, else the one covering today, confirmed by you). A class offers its owner's calendar snapshot to joiners who have none |
| Custom types | Shared items use built-in types; your labels, colours and hidden types apply to them |
| ICS feed | §9 |
| Imports | The outline import can target a class you edit, with a diff preview (New / Changed / Already there; Changed starts unticked). `.ics`, CSV, school calendar and schedule imports stay personal in v1 |
| AI import | AI reads return JSON and never save, as today; shared data changes only through ordinary guarded writes after the person ticks and confirms in the preview |
| Offline | Everything already synced can be read and edited offline; shared edits merge on reconnect. Joining, inviting, removing, leaving, converting and creating spaces need a connection (they are server batches) and say so |
| Admin | The accounts table counts personal rows (`scope = 'u:' ‖ id`); deleting an account transfers or archives its spaces (§13) |

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
- **Colours.** A class uses your `space_prefs.color` (on join: the owner's colour unless
  you already use it, else the first free of the twelve). A project uses its linked
  class's colour, else its own pref.
- **Labels.** Shared chips carry a two-person glyph (class) or a team glyph (project), and
  tasks an "assigned to me" pip, each with an aria-label ("Shared · Web Services", "Team
  task · assigned to you"). A "you" pip marks a personal item under a class.
- **Visibility.** An eye toggle on each sidebar row (personal courses, classes, projects,
  and *Personal items*) writes `users.hidden_sources`. Hidden rows stay listed, dimmed.
  Hiding a class hides your personal items under it. It syncs across devices and the ICS
  feed honours it.
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
your mark; the project item holds the team's own deadline and description.

- Assignment deleted, or class archived: the project is unaffected; its header says
  "Linked assignment removed" and the owner may relink.
- Project moves to another course: the owner relinks (`PATCH /api/spaces/:sid`).
- Leaving or being removed from the class does not touch project membership, and the
  other way round.

**Assignment rules.** `assignees` is `[]` (nobody), `[id, …]` (one or several) or
`["*"]` (everyone). Owners and editors assign; any member may claim an unassigned task
or unclaim themselves; assignees (everyone, for `*`) and editors may complete. A
removed member is stripped from every `assignees` list in the removal batch; a task left
with nobody becomes unassigned, and the activity says so.

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
row first; the first stage that writes activity checks this.

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
  rows, so they reach the person concerned.
- **Activity tab** per space: `GET /api/spaces/:sid/activity?before=`; offline it says
  "Connect to see activity".
- Activity and answered invites older than 90 days are deleted nightly.

## 13. Deletion and archiving

| Action | Behaviour | Personal history |
|---|---|---|
| Delete a class item | Soft delete. A member with a meaningful mark keeps it as "Removed from … by Alex" with **Keep as mine** (one-item detach) / **Dismiss**; it counts in their grades until they choose. An editor's restore reconnects everything. Before the nightly purge hard-deletes it, meaningful marks are detached automatically | grades, notes, sessions kept |
| Delete a task | Soft delete; your note on it goes with it at purge | sessions keep their minutes |
| Delete a personal course | As today (its items lose their course, sessions their link) | as today |
| Class course / project item | Cannot be deleted; archive or delete the space | — |
| Archive a class or project | Read-only for everyone until unarchived; marks and prefs still save; still visible; a linked project is unaffected | untouched |
| Delete a class | Only when the owner is the only member; **Keep a copy** (on by default) detaches first | kept |
| Delete a project | Owner, typed confirm; members told; scopes revoked | sessions keep their minutes |
| A member leaves a class | Detach (opt out with a checkbox); membership soft-deleted | kept |
| A member is removed from a class | Detach, always | kept |
| A member leaves or is removed from a project | §10: marks deleted, stripped from assignees | sessions keep their minutes |
| Transfer ownership | Old owner → editor, then new owner → owner, in one batch | — |
| An owner's account is deleted (admin) | Each owned space transfers to the longest-standing editor, else member; with nobody left, a class is archived and a project deleted; memberships removed; the account's own rows deleted as today | — |

**Absorb** (personal → class) and **detach** (class → personal) are set-based D1 batches
(`INSERT … SELECT`, pairs via `json_each()`): a handful of statements whatever the size,
and safe to retry.

- **Convert** (`POST /api/spaces {kind:'class', convertCourseId}`): create the class
  with you as owner; copy the course and items in under the same ids; move your personal
  fields into marks and prefs; set `space_id` on your sessions and achievements;
  soft-delete the personal course and items directly (not through the course-delete path,
  which would null `course_id`).
- **Merge on join** (`POST /api/spaces/:sid/absorb {courseId, pairs}`): for each pair,
  write a mark from your item, repoint sessions and achievements to the shared id and
  soft-delete your item; set `class_id` on unmatched items; soft-delete the empty personal
  course. A member's absorb writes no shared row. The Worker checks every `mine` id is
  yours and in `courseId`, and every `shared` id is a live item of that class.
- **Share one item** (editor; `POST /api/spaces/:sid/absorb {items:[id]}`): a personal
  item under the class becomes a class item under the same id, your fields moving to a
  mark.
- **Detach:** copy the class course and items into your scope under the same ids (an
  upsert, so unpurged tombstones from a convert revive rather than duplicate), fold your
  marks in, repoint `class_id` items to the copy, clear `space_id` on sessions and
  achievements, delete your marks and prefs. A rare clash with a live personal id gets a
  new id.

## 14. API (endpoints only)

```
GET    /api/sync?v=3&cursors=…
POST   /api/spaces                          {kind:'class', course | convertCourseId | outline} · {kind:'project', name, parent?}
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
- The IndexedDB v5 upgrade moves the cursor and adds stores, keeping pending ops and
  conflicts.
- Converting is reversible: detach rebuilds a personal copy under the same ids with your
  marks folded back in.

## 17. Security

| Threat | Defence |
|---|---|
| IDOR / guessed ids | Every shared statement re-checks membership and role; ids are not secrets; non-members get 404 |
| Missing membership checks | One builder (`access.js`); a test per route for non-member, member, editor, owner, archived |
| Client-controlled ownership | Scope comes from the route and session, never the body; space ids are made by the Worker; absorb ids are verified |
| Role escalation | Role changes are owner-only; editors invite only with the default role; members' task writes are diffed against the current row; one-owner index |
| Unauthorised sync data / a removed member still syncing | Guard inside the paging statement; `revoked` purges the device |
| Invitation abuse | Rate limits; invites only to existing accounts; upsert prevents duplicate rows |
| Guessable codes | ~40 bits, hashed, 7-day expiry, use limit, 10 attempts an hour |
| ICS exposure | The feed URL is per user (HMAC token, as today); its query joins live membership |
| Private grades, notes, study history | Read only with `user_id = me`; no aggregates; activity records only shared fields |
| Cross-space access | Composite keys `(scope, id)`; FKs inside one scope; `class_id` and project links verified at write time |
| Cached unauthorised data | Purged on `revoked`; until then it is data the user already saw |
| Username enumeration | Accepted for an invited group; rate-limited; login lockouts protect each name |

## 18. Cloudflare free tier

- **Requests:** nothing new in the background; the unread count rides on sync; inbox and
  activity load on open.
- **D1 reads:** sync reads ≤ 101 rows per scope per page via `(scope, seq)` plus a few
  dozen membership rows; the ICS feed is a few queries per hourly fetch.
- **D1 writes:** no fan-out (a mark exists only once you touch an item; joining writes
  your membership and prefs); activity coalesces; absorb, detach and convert are a
  handful of set-based statements; the nightly cron adds two deletes.
- **Workers AI:** one editor's outline import serves the class; the shared school
  calendar saves each joiner a read.
- **Storage:** activity 90 days; tombstones 30 days.
- No Durable Objects, WebSockets, Queues, R2 or paid services.

## 19. Edge cases

| Case | Behaviour |
|---|---|
| Two users edit at once | Field-level merge; the same field → Conflicts, naming who and what |
| Edit offline; lose permission offline | §6 |
| Owner leaves | Must transfer first; the last member may archive or delete |
| Last owner tries to leave | Refused: "Transfer ownership or archive the class first" |
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
| Clients that have not updated | v2 sync and personal routes; no shared data |

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

**Create a project** (v2). *New team project* → `POST /api/spaces {kind:'project', name,
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
10. Gabriel: *New team project* "Fire Response API", linked to the assignment → `p:<fire>`, parent `c:<web>` / item; Gabriel is owner.
11. Gabriel invites Alex to the project → accept → editor; Alex's next sync adds `p:<fire>`.
12. Gabriel creates "Create incidents endpoint" with `assignees: [alex]` → the trigger writes `task.assigned` (`subject_user` Alex).
13. Alex, offline, marks it done → `shared_items` status `done`, `completed_by` Alex, pending op with `base`.
14. Gabriel moves the assignment to Oct 18 → the `c:<web>` item's revision moves on; activity "Oct 15 → Oct 18".
15. Alex reconnects → push: the task write succeeds (he is an editor in the project, and its revision has not moved); his mark uploads.
16. Pull: the assignment's new date arrives. The project item (Oct 30) has a different date from the assignment, so both show.
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
are invisible; from stage 3 the class features are shown only to admins (George tests
with a second account made admin for the purpose) until stage 5 is live, so nobody can
join a class before they can keep grades in it (stage 4) or leave it (stage 5).

1. rounds-v7 and the scope refactor: `scope` columns, `access.js`, `changes` by scope, `move-db.mjs`.
2. Sync v3: cursors per scope, `revoked`, split shared stores, `effectiveItems()`, field-level merge, 403 handling.
3. Classes: create, convert, invites, codes, join, members, roles.
4. The personal layer: marks, prefs, the split item card, markers, eye filter, merge sheet.
5. Leaving and removal: detach, leave, remove, archive, transfer, Keep/Dismiss, account deletion.
6. ICS feed and outline import into a class; a class from an outline; the school-calendar offer.
7. Inbox and activity.

**v2 — team projects** on v1's foundation: project spaces and the project item; tasks
with assignees, claiming and completion rules; the link to an assignment and chip
folding; progress and workload; the project sheet; task events in the inbox and ICS.

**Later:** moderator role and suggested changes (whole classes); comments; milestones
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
  lost race); member task-write rules; absorb, convert and detach run twice with
  identical results; activity triggers and coalescing; `move-db.mjs` against the fixture;
  every new `CHECK`.
- **Client** (vitest + jsdom): `effectiveItems()` and grades on merged items (override,
  hidden, removed-but-kept, project status); the IndexedDB v5 upgrade; 403 in the sync
  loop; the `revoked` purge; the merge sheet's matching.
- **By hand, two accounts:** the §21 trace (steps 10–26 once v2 lands), offline on both
  sides, the ICS feed after each step.

## 24. Open decisions

None block implementation planning. Choices this document makes that George may still
change: default join roles (class: member, project: editor); removal from a project keeps
no copy; a project may be deleted while others are members (typed confirm).
