# Collaboration (shared classes, then team projects) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let small groups share a class (one authoritative course and its items, with each person's own status, grade and notes on top), then team projects, without giving up Term's local-first sync.

**Architecture:** Courses and items are owned by a **scope** (`u:<user>`, `c:<class space>`, `p:<project space>`) instead of a user; a person's layer on a shared row lives in `marks` and `space_prefs`; the change feed is keyed by scope and sync pages one cursor per scope; shared rows merge field by field. Every guard is built in `worker/access.js` and runs inside the SQL statement.

**Tech Stack:** Cloudflare Workers + D1 (plain JS ES modules), React 19 + TypeScript + Vite, IndexedDB, Vitest (Workers pool + jsdom), wrangler.

**Spec:** `docs/superpowers/specs/2026-10-02-shared-classes-design.md` (read it first; section numbers below are its sections).

---

## How to work in this repo (read before any task)

1. **Checks:** `npm run typecheck`, `npm test` (Vitest: Workers + jsdom projects, then node tests), `npm run build`. `npm run check` runs all three. One file: `npx vitest run test/scope.test.js`.
2. **Dev server:** `npm run dev` → http://127.0.0.1:8787. On this Windows machine a stopped dev server can leave `vite.js` holding 8787/8790 and serving old code: check `Get-NetTCPConnection -LocalPort 8787 -State Listen` in PowerShell first and stop the owning process. Don't run `npm run build` while the dev server runs.
3. **Line endings:** keep every file LF. A CRLF in `index.html` breaks the CSP hash.
4. **Non-ASCII** (·, —, α): write it with the Edit/Write tools, never through a shell; after a commit that adds any, `npm run build` (Vite refuses Latin-1 bytes that tests miss).
5. **Deploying:** the Cloudflare Git build runs `npm run build` and does **not** apply remote D1 migrations. A stage with a migration needs `npm run db:remote` and `npm run db:check -- --remote` before its merge to `main`. After changing `wrangler.jsonc`, run `npm run build` before `npx wrangler deploy` (deploy uses the config the build generated).
6. **Commits:** end each message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Commit only on the stage branch; never push, merge to `main` or touch remote D1 without George's yes.
7. **Workers AI:** the automated tests use fakes; never call real AI from a test (10k neurons a day, shared with the live site).

---

## The stages

| # | Stage | Branch | Database | Detailed plan |
|---|---|---|---|---|
| 1 | Scope: `scope` on courses, items and the change feed; new columns on existing tables; move to rounds-v7. Invisible | `collab-1-scope` | clean db → `rounds-v7` | **below** |
| 2 | Spaces and sync v3: `spaces`, `members`, `access.js`, `/api/sync?v=3` with cursors per scope and `revoked`, IndexedDB v5 (shared stores, cursors), `effectiveItems()`, field-level merge, 403 in the sync loop. Invisible (no way to create a space yet) | `collab-2-sync` | migration `0002_spaces.sql` | `docs/superpowers/plans/2026-10-05-collab-stage-2-sync.md` |
| 3 | Classes: create (blank, convert), invites, codes, join, members, roles; admin-only | `collab-3-classes` | `0003_invites.sql` | `docs/superpowers/plans/2026-10-05-collab-stage-3-classes.md` |
| 4 | Personal layer: `marks`, `space_prefs`, the split item card, source markers, eye filter, merge sheet; admin-only. **Ships with Stage 3**: one branch, one merge, 0003 and 0004 applied together | `collab-3-classes` | `0004_marks.sql` | `docs/superpowers/plans/2026-10-06-collab-stage-4-layer.md` |
| 5 | Leaving and removal: detach, leave, remove, archive, transfer, Keep/Dismiss, account deletion, the extended nightly purge | `collab-5-leave` | none expected | `docs/superpowers/plans/2026-10-07-collab-stage-5-leave.md` |
| 6 | ICS feed and outline import into a class; class from an outline; school-calendar offer; **opens classes to everyone** (a converted course must not drop out of people's calendar feeds) | `collab-6-feed` | none | `docs/superpowers/plans/2026-10-07-collab-stage-6-feed.md` (**built** 2026-10-09) |
| 7 | Inbox and activity (triggers, coalescing, inbox, activity tab) | `collab-7-inbox` (main `bafcd0c`) | `0005_activity.sql` | `docs/superpowers/plans/2026-10-07-collab-stage-7-inbox.md` (**built** 2026-10-15, live 2026-10-18) |
| 8 | Projects core: project spaces, project item, tasks, assignees, member task rules, link to an assignment; a working project sheet; admin-only, out of the views | `collab-8-projects` (main `54ef5fa`) | none (columns exist from Stage 1) | `docs/superpowers/plans/2026-10-07-collab-stage-8-projects.md` (**built** 2026-10-18) |
| 9 | Projects in the views: assigned-to-me, chip folding, the task card, progress, workload, Use this date | `collab-9-project-views` | none | `docs/superpowers/plans/2026-10-07-collab-stage-9-project-views.md` (**built** 2026-10-19) |
| 10 | Project events in the inbox and the ICS feed; **opens projects to everyone** | `collab-10-project-feed` | none | `docs/superpowers/plans/2026-10-07-collab-stage-10-project-feed.md` |

Plans for Stages 5–10 were all written on 2026-10-07, each against the planned code of the stages before it: build them in order, and where an earlier stage's code came out different from its plan, follow the code.

Each stage branches off `main` after the previous stage is merged and deployed. A detailed plan is written per stage, because each stage changes the files the next edits (Stage 2 rewrites `src/core/sync.ts`, which Stage 3 extends; Stage 4 rebuilds the item card Stage 9 adds to).

### What each later stage must cover (its plan starts from this)

**Stage 2 — Spaces and sync v3** (spec §3, §6, §7).
- `migrations/0002_spaces.sql`: `spaces` (Worker-made 12-char ids, `kind`, `archived`, `school_calendar`, `parent_space`, `parent_item`, code columns, timestamps, `revision`) and `members` (`role`, the partial unique owner index, `members (user_id) WHERE deleted_at IS NULL`). Extend `scripts/lib/move-db.js` TABLES with both.
- `worker/access.js`: `memberGuard(scope)` and `editorGuard(scope)` returning `{sql, binds}` fragments; `roleOf(db, userId, scope)`; `parseScope('c:abc')`. Tests: a matrix of non-member / member / editor / owner / archived.
- `worker/db.js`: shared variants of `getRow/upsertRow/deleteRow` taking a scope and a guard; the field-level merge (`changed`), compared with stable JSON; `updated_by`.
- `syncPageV3(db, userId, cursors, sv)`: memberships query (≤ 20 rows), member lists only for spaces whose `revision` > `sv`, the `UNION ALL` page with per-branch guards, cursor rule, `scopes`, `revoked`, per-scope `reset` (cursor 0 never resets). Route `GET /api/sync?v=3`. Keep v2. Member and space writes bump `spaces.revision` to the next global sequence value in the same batch.
- `/api/spaces/:sid/{courses,items}/:id` routes (guarded), unused by the UI yet; tests create spaces directly in D1.
- Field-level merge applies to shared rows (and, from Stage 4, `marks`) only; personal rows, `space_prefs` and the profile keep whole-row `If-Match`. A member's task write applies only allowed fields named in `changed`; `updated_by`/`completed_by` come from the session.
- Client: `src/core/db.ts` version 5 (stores `shared_courses`, `shared_items` keyed `[scope, id]`, `spaces`, `meta.cursors` migrated from `syncCursor`); pending keys `shared_items:<scope>:<id>` / `shared_courses:<scope>:<id>`; `src/core/sync.ts` pulls v3 (sending `sv`, 0 on the first sync after opening), applies `revoked` after the last page, adds 403 to the statuses rejected at once (today `[400, 404, 409, 413, 422]`), pushes shared ops with `base`/`changed`; `src/data` `effectiveItems()`/`effectiveCourses()` used by every view, keyed by `scope/id` (returns today's items while there are no spaces).
- Spike for Stage 7, first thing in this stage: a throwaway Workers test that creates a trigger whose body runs `INSERT … SELECT … WHERE true ON CONFLICT … DO UPDATE` on local D1 and checks the row. Record the answer in the Stage 7 outline below, so the activity design is settled before the shared write routes are built. Delete the test after. **Done and verified 2026-10-05 while planning Stage 2: D1 accepts it** (see Stage 7). The same session found that D1 refuses a compound SELECT of more than 5 terms, so the v3 page is one statement per scope in one `db.batch`, not one `UNION ALL` (Stage 2 plan, Decision 1).
- Tests: v3 paging across scopes in global order, a new scope from 0, a removal between the two queries, member lists only above `sv`, `revoked` purge after the last page, field-merge cases (incl. a deleted current row always conflicting), IndexedDB upgrade keeps pending ops.

**Stage 3 — Classes** (spec §5, §11, §13 convert, §14, §15).
- `0003_invites.sql`: `invites`. Routes: create class (blank / convert), invites (username, accept, decline, revoke), code + `/api/join`, members (role, remove without detach yet is **not** allowed — remove arrives in Stage 5, so the button is hidden), transfer. Limits via `worker/limits.js`; 20 spaces per user (`409 limit`).
- Convert as a set-based batch (§13), safe to retry, with the item picker: tasks start unticked; lecture reviews and custom-typed items stay personal under the class (`class_id`).
- Accept/join/create write the joiner's `space_prefs` in the same batch (the table arrives in Stage 4, so Stage 3's batches add that statement then).
- UI behind `profile.isAdmin`, **and** the create/accept/join routes refuse non-admins (`403`) until Stage 6: the + menu, course sheet Members tab, inbox stub listing pending invites, `/#join=` handling in `src/data/session.ts`.
- As planned (Stage 3 plan, Decisions 1 and 3): a Stage 3 convert **copies** the course and the ticked items into the class and leaves every personal row as it is (no `marks` or `space_prefs` yet, and shared rows are not in the views); the join screen is only "Downloading …" then "You're in …".

**Stage 4 — The personal layer** (spec §4, §7, §8, §9, §15).
- `0004_marks.sql`: `marks`, `space_prefs` (single text `id`), their triggers writing `'u:' || user_id`; a backfill inserting a `space_prefs` row (the class course's colour, else the first of the twelve the person does not use; the class's `term`) for every live membership made during Stage 3, which had no table to write to; profile `hiddenSources` (`course:<id>`, `space:<sid>`, `personal`) in `worker/validate.js` and `PUT /api/me`, whole-row as today, kept when absent like `types`.
- Old-client safety: `sync?v=2` pages only `courses`, `items`, `quotes`, `study_sessions`, `achievements`; personal `PUT`s without `classId`/`spaceId` keep the stored values.
- `effectiveItems()` merges marks; grades, stats, achievements, exam prep, reviews (chain steps inherit `class_id`) and pickers read it; the item card's Class/Yours sections; eye toggles; markers; the merge sheet + absorb route (custom-typed items never paired).
- Convert moves (Stage 3 only copied, its plan's Decision 1): the convert batch adds marks from the ticked items' personal fields, prefs from the course's colour/target/term/archived, soft-deletes the personal course and the ticked items, sets `class_id` on the unticked ones and `space_id` on sessions and achievements. A class an owner made by a Stage 3 convert sits beside their personal course with the same ids: offer the merge sheet for it (pairs by identical ids first), from the class's Members tab and the personal course's **Share this course** section.
- The join screen gains the semester and colour choices (writing `space_prefs`); Stage 3 shows only "Downloading …" then "You're in …". The class sheet's Details tab (read-only in Stage 3) gains the Yours section and shared edits for owner/editors.
- **Planned** (`docs/superpowers/plans/2026-10-06-collab-stage-4-layer.md`, written 2026-10-06 against Stage 3's planned code): Stages 3 and 4 ship together on `collab-3-classes`; Stage 4's Tasks 16–30 run after Stage 3's Tasks 1–14, and its Task 30 (0003 + 0004 remotely, then merge and push) replaces Stage 3's Task 15. IndexedDB goes 5 → 6 (`marks`, `space_prefs`), roll-forward only. `marks`/`space_prefs` cascade from `users`, join the nightly purge's table list and the DB health checks. Shared rows show only while `CLASSES_ADMIN_ONLY` lets them (`src/data/effective.ts`). A convert moves (marks only for touched items; a session on the course and an item that stays yours loses its course link). Absorb takes `{courseId, pairs, fromCourse}`. Eye toggles filter the Week and the Month only. Study sessions and achievements are handled in key space (`src/data/refs.ts`).
- **Hand-offs recorded by the Stage 4 plan.** To Stage 5: a deleted class item holding a meaningful mark is still removed by `applyPage` (the mark stays in IndexedDB and D1) until **Keep as mine / Dismiss**; **Share with class** for one personal item (`absorb {items}`, spec §13) is not built; the purge already hard-deletes `marks`/`space_prefs` tombstones, so add §13's detach-first steps before it; `ACCOUNT_TABLES` needs no `marks`/`space_prefs` entries (they cascade); a Stage 4 convert soft-deletes your course and items, so detach must revive them by upsert (same ids). To Stage 6: remove `CLASSES_ADMIN_ONLY` in `src/data/effective.ts` and the `admin &&` checks for the eye toggles and *Personal items* in `src/components/sidebar.tsx`; the ICS feed must apply `space_prefs` (colour, term, archived) and marks, honour `hidden_sources`, and put back the events of courses admins converted (they leave the feed until then).

**Stage 5 — Leaving and removal** (spec §13). Detach (set-based, idempotent), leave (with or without a copy), remove, archive, transfer, delete class, Keep/Dismiss, the extended nightly purge in §13's order, admin account deletion transferring spaces or deleting those with nobody else (and `ACCOUNT_TABLES` gaining `marks`, `space_prefs`, `members`, `invites`). Client: `revoked` carries saved mark edits onto a detached copy. From Stage 3: the nightly purge also deletes invites 90 days after `created_at` (index `invites_created`); account deletion replaces Stage 3's `409 owns_space` refusal; transfer exists since Stage 3 (owner only, refused in an archived space: decide whether archiving should allow it); the Members tab gains Remove, and the class sheet Leave/Archive.

**Stage 6 — Feed and import** (spec §8, §9). `worker/calendar.js` adds class rows with marks, `hidden_sources`, scoped UIDs; outline import target picker and diff preview; class from an outline; school-calendar snapshot offer on join. **Remove the admin-only gate** (client and routes): `ADMINS_ONLY` in `worker/spaces.js` (create, accept, join, and the `409 not_admin` on invites), and the client's `isAdmin` checks in `src/components/sidebar.tsx`, `src/components/sheet/course-sheet.tsx`, `src/data/session.ts` (`/#join=`, invites) and `src/data/classes.ts` (`refreshInvites`), and `CLASSES_ADMIN_ONLY` in `src/data/effective.ts` (Stage 4: the views, eye toggles and *Personal items* row). New shared class gains *From a course outline*.

- **Hand-offs from Stage 5.** The ICS feed must leave out a removed class item unless it is in `effectiveItems()` (a meaningful mark, not hidden), and treat a left class's sessions as nothing. `POST /api/spaces/:sid/archive` replaced the spec's `PATCH`. Leaving a project, deleting a project and stripping assignees are Stage 8; until then the purge leaves a project item with a meaningful mark waiting. The study timer, session and achievement pickers still offer removed class items (harmless: keep and copy repoint sessions on them). A hidden removed item holding something is out of the views but is listed in the class sheet's Removed list and is copied by leave/keep, as the Worker's `MEANINGFUL` ignores `hidden`.
- **Built** (2026-10-09, main `9dc8ea8`, no migration). What differs from the outline above: the feed leaves out every removed class item (the Worker reads live class items only), items you hid, and classes you archived in your sidebar; owner-archived classes stay. `hidden_sources` now apply to the Week and Month for everyone as well as to the feed. The class's school-calendar snapshot is refreshed only by its owner (`POST /api/spaces/:sid/school`, which keeps the old snapshot when the owner has none with a semester; the Share button syncs first); taking it never overwrites a calendar you have. The outline match is one to one on type plus a normalised title (letters and digits in any script); a blank outline field is no change; recurring rows compare by weekday and start; `was` names the day, time, room or weight; week 1 re-matches; switching target re-plans the original outline; only downloaded classes are targets. A new class from an outline gets the semester picker and is made in the term picked; NotDownloaded keeps the sheet open on the class made, other failures keep the preview for a retry; the outline option is off while Import with AI is in maintenance or no reads are left. Classes open to everyone except the Admin page and the classes maintenance switch (admins only get through); projects stay closed (`classBody` refuses `kind: 'project'`). The sidebar's plain *+ New course* button is gone; New course is in the + New menu. Details in `docs/DATA-MODEL.md` (The calendar feed, Outline imports into a class, `spaces`).

**Stage 7 — Inbox and activity** (spec §12). `0005_activity.sql`: `activity`, `inbox_seen`, the shared-row triggers; routes; the bell and inbox sheet; activity tab; nightly purge. D1 accepts the coalescing upsert inside a trigger body: verified 2026-10-05 by a throwaway Workers test on local D1 (Stage 2 Task 1). A trigger `AFTER UPDATE … WHEN OLD.title != NEW.title` running `INSERT … SELECT NEW.id, 7, OLD.title, NEW.title WHERE true ON CONFLICT (subject, bucket) DO UPDATE SET last_to = excluded.last_to, n = n + 1` and then `DELETE … WHERE first_from = last_to` coalesced two updates into one row (keeping the first `from`), deleted it when the value went back to where it started, and behaved the same inside one `db.batch`. So the activity rows come from triggers; the Worker-batch fallback is not needed. The inbox replaces Stage 3's Invites sheet and sidebar row (`GET /api/invites`); pending invites count towards the unread number in each sync response.

- **Hand-offs from Stage 6.** Classes are open to everyone. The inbox replaces the Invites row (now shown to everyone). The feed leaves out removed class items; projects join it in Stage 10. The spec's `POST /api/spaces {outline}` was not built (Stage 6 plan, Decision 5): a class from an outline is made from the preview's rows. Known small leftovers: on a class target the import preview reads any `TypeError` as "offline" (`import-sheet.tsx`); a local write failure after a new class is made could make a second class on retry (rare); making classes has no hourly limit (only the 20 live spaces); anyone in a class can check whether a username exists by inviting it (20 an hour).
- **Built** (2026-10-15, live 2026-10-18 as main `bafcd0c`, migration `0005_activity.sql`). What differs from the outline and the stage plan: route rows' bucket is `CAST(now AS INTEGER) / 600000` (`BUCKET` in `worker/accounts.js`), as D1 binds a JS number as a REAL and the division would otherwise never coalesce; a role changed back or a class unarchived within the bucket leaves no row (`undoneStmt`), as does an assignee added and taken off again. Account deletion's `space.transferred` is one set-based statement appended to `HAND_ON` (not a per-space `noteStmt`); `ACCOUNT_TABLES` deletes the activity about the account. The purge drops activity over 90 days (`KEEP_MS`) and a purged space's rows except those about a person; every read also holds to the 90 days. `move-db` rebuilds `activity` like `changes` (`REBUILT`) and carries its counter (at least every `inbox_seen.seq`); its check lets the activity counter end higher. The unread count is capped by `UNREAD_CAP` (99, `src/core/shared.ts`; the bell shows `99+`), and a bad `unread` is dropped rather than failing the page. `/api/inbox` sits under the classes maintenance switch; a non-admin's bell shows no count then and opens the maintenance page. Marking read does nothing offline and rolls back on failure. Inbox and Activity rows that can open nothing are plain text; the Activity tab tells a network failure ("Connect…") from an error answer (`messageFor`) and drops late answers. **Deploy order:** `0005` goes to live with `npm run db:remote` before the merge, as every v3 sync and every account deletion now reads or writes `activity`. Details in `docs/DATA-MODEL.md` (`activity`, `inbox_seen`, The inbox and activity).

**Stages 8–10 — Team projects** (spec §10). Uses the `p:` CHECKs, `assignees` and `completed_by` columns added in Stage 1.

- **Hand-offs from Stage 7.** The triggers already record task events (`task.assigned` per assignee, `task.unassigned`, `task.status` with `detail.assignees`), and the inbox already tells assignees. Stage 8 writes `space.linked` (`detail.assignment` = the assignment's title) and `space.deleted` (one row per other live member, `subject_user` set) with `noteStmt` (`worker/activity.js`; its `subject` is always `''`); a removal from a project writes `member.removed` as for a class (`detach` takes `after`, the statements that run at the end of its batch). `openRow` opens only classes' sheets; Stage 9 opens a project's. `ActivityList` takes any space id.
- **Built** (Stage 8, 2026-10-18, main `54ef5fa`, no migration). What differs from the stage plan: `POST /api/spaces {kind:'project'}` checks `isAdmin` after `requireUser` and answers `403 forbidden` (as admin routes do); a project invite to a non-admin is `409 not_admin`, accepting one or joining by a project's code `403 not_admin`. A project's title can't hold a NUL. The parent is any live item in a class you are a live member of (the client offers assignments, labs and projects). The 200-task limit also counts a revived tombstone as new. `POST /api/spaces/:sid/link {parent | null}`, and a body with no `parent` unlinks; linking sets the project's date, so it writes an `item.date` row too; `space.linked` keeps `old_value` the prior item (`''` for none) and `new_value` the item or NULL, and a link undone within the ten minutes leaves no row (`undoneStmt` now matches `old_value = COALESCE(new_value, '')`). Leaving and removal (`leaveProject`) strip assignees (a task left with nobody writes `task.unassigned`), soft-delete marks and prefs, copy nothing; `keepCopy` is validated but ignored. `DELETE /api/spaces/:sid {confirm}` (the title, trimmed) deletes a project, archived or not; `space.deleted` per other live member; `INBOX`'s per-space branch skips deleted spaces, while the about-you branch still delivers `space.deleted`. Projects archive, unarchive and hand on as classes do (`setArchived` no longer checks the kind). Account deletion: `HAND_ON` first strips the account from the assignees of its live projects. The purge soft-deletes every mark on an expiring project task (the feed carries it) and never holds a project row back; the items exemption is `c:` only. `memberTaskWrite` lets a member's write combine a self-claim or unclaim with `status`/`completedAt` (the status needs you on the task before or after); a claim lost to someone who got there first is `409 conflict` with `fields: ['assignees']`, a claim of a task already taken when queued `403`. Client: `src/data/projects.ts`; `PROJECTS_IN_VIEWS = false` drops `p:` rows (removed ones too) from `mergeItems`; `reasonFor(e, op)` says "project" or "class" and reads `409 limit`; `messageFor(e, name, kind)` and `joinMessageFor(e, kind)` word errors by kind; leaving and deleting use `uploadFirst`, `once` and `spaceGone` from `leave.ts`; the inbox's `describe` has the unlink wording and `openRow` opens a project's sheet already. UI: **New team project** in + New (admins), the sidebar's **Projects** group, `NewProjectSheet`, the project sheet (Tasks, Members, Activity; a still-downloading state; a note for someone no longer an admin; archived read-only with Unarchive for the owner; delete by typing the title; a leave confirm), and `JoinedProject` in the join sheet. Details in `docs/DATA-MODEL.md` (Team projects).
- **Hand-offs from Stage 8.** Projects are admin-only (`PROJECTS_ADMINS_ONLY` in `worker/projects.js`, `PROJECTS_ADMIN_ONLY` in `src/data/projects.ts`) and out of the views (`PROJECTS_IN_VIEWS` in `src/data/effective.ts`). Stage 9 sets `PROJECTS_IN_VIEWS` true and puts back the `src/data/effective.test.ts` assertion that a `p:` row's `source` is `"project"` (taken out while projects are kept out); filters the Week to tasks assigned to you or everyone; routes `toggleTask` for `p:` keys to `setDone`; opens a task in the item card with a Team section; adds progress, workload, the linked assignment's header and **Use this date** to the project sheet; adds the progress ring and the eye to the Projects group (`sidebar-projects.tsx`); folds a linked project's chip. Stage 10 adds projects to the ICS feed and clears both admin flags. The link route is `POST /api/spaces/:sid/link` (not `PATCH`).
- **Built** (Stage 9, 2026-10-19, `collab-9-project-views`, no migration, no Worker change). What differs from the stage plan: a project's deleted task is never kept for your note on it (`mergeItems` skips every `p:` tombstone, so no **Keep as mine** for projects). `forCalendar` folds a project only into a live, dated assignment on the same date as a dated project. The **Source** filter (`ui.source`, not remembered across reloads) groups classes and projects in optgroups, also lists your items filed under a class with the class, ends a stat tile's list, and reads as all for a space you are no longer in (`pickedSource`); the type chips and the empty table's "Hidden by …" follow it. `assignmentOf` reads an undated assignment as the same date (nothing to take) and an archived class's as "Linked assignment removed"; `linkable` leaves archived classes out. The eye is `Eye` in `sidebar-parts.tsx` (not exported from `sidebar.tsx`); the project row says its name first and the count in words, the ring is decoration. The task card (`task-sheet.tsx`) asks before **Delete for everyone**; the project sheet lists **Hidden from you** with **Show again**. The Study pickers, the focus screen, Log study and History get one "Team · <name>" course per project you are in (`withProjects`, keyed `p:<sid>/project`) whose items are your open tasks there; a session on one is saved with `courseId: "project"` and the project's `spaceId` (`refOf`). Ticking a team task celebrates; `setDone` sets `completedBy` on the device at once (achievements count it before the sync), a task done again keeps who finished it first, and ticking or claiming writes over the stored row so a title just typed is kept. `openItem` opens a project's own item as the project sheet. Details in `docs/DATA-MODEL.md` (Team projects, In the views).
- **Hand-offs from Stage 9.** Projects are in the views for their members. Stage 10 adds them to the ICS feed (the project's own item unless folded is not a feed concern: the feed lists both, since calendar apps have no chips; your tasks and everyone's) and clears `PROJECTS_ADMINS_ONLY` (`worker/projects.js`) / `PROJECTS_ADMIN_ONLY` (`src/data/projects.ts`). `worker/calendar.js` reads only `kind = 'class'` spaces today.

---

## Stage 1 — Scope (detailed)

**Outcome:** courses, items and the change feed are owned by a scope (`u:<user id>` for every existing row); the existing tables carry the columns later stages need (`updated_by`, `class_id`, `assignees`, `completed_by`, `space_id`, `hidden_sources`) with their `CHECK`s; live data moves into `rounds-v7`. The API, the client and every screen behave exactly as before.

**Files:**
- Copy: `migrations/0001_schema.sql` → `test/fixtures/legacy-migrations/0001_schema.sql` (rounds-v6's schema becomes the legacy fixture); delete `test/fixtures/legacy-migrations/0002_admin.sql`
- Modify: `migrations/0001_schema.sql` (courses, items, study_sessions, achievements, users, changes, triggers, indexes, views)
- Modify: `worker/db.js` (owner helpers; every courses/items/changes query)
- Modify: `worker/accounts.js`, `worker/admin.js`, `scripts/add-user.mjs`, `worker/calendar.js`
- Modify: `scripts/lib/database-health.js`
- Modify: `scripts/lib/move-db.js`, `scripts/move-db.mjs`
- Create: `test/scope.test.js`
- Modify tests: `test/move-db.test.js` (rewritten), `test/admin.test.js`, `test/database-health.test.js`, `test/database-structure.test.js`, `test/quiz-target.test.js`, `test/rows.test.js`, `test/types.test.js`
- Modify: `docs/DATA-MODEL.md`, `wrangler.jsonc` (Task 9)

Branch first: `git switch -c collab-1-scope`.

The suite is expected to be red from Task 2 until Task 5 ends; each task names the test files that must pass when it is done.

### Task 1: rounds-v6's schema becomes the legacy fixture

The move test copies out of a database built from the fixture; rounds-v6 was built from today's `migrations/0001_schema.sql` alone.

**Files:**
- Copy: `migrations/0001_schema.sql` → `test/fixtures/legacy-migrations/0001_schema.sql`
- Delete: `test/fixtures/legacy-migrations/0002_admin.sql`

- [ ] **Step 1: Replace the fixture**

```bash
cp migrations/0001_schema.sql test/fixtures/legacy-migrations/0001_schema.sql
git rm -q test/fixtures/legacy-migrations/0002_admin.sql
```

- [ ] **Step 2: Run the move test against it**

Run: `npx vitest run test/move-db.test.js`
Expected: PASS (today's code still writes the v6 shape, so copying v6 into v6 works).

- [ ] **Step 3: Commit**

```bash
git add test/fixtures/legacy-migrations
git commit -m "Legacy fixture: rounds-v6's schema, for the move to rounds-v7

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: The scoped schema

**Files:**
- Create: `test/scope.test.js`
- Modify: `migrations/0001_schema.sql`

- [ ] **Step 1: Write the failing test**

`test/scope.test.js`:

```js
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createUser } from './helpers.js';

/* A raw row, so these tests see the schema's own rules and not the Worker's. */
function insertItem(scope, id, cols = {}) {
  const row = { type: 'task', title: 'T', date: '2026-10-01', status: 'todo', created_at: 1, updated_at: 1, ...cols };
  const names = Object.keys(row);
  return env.DB.prepare(`INSERT INTO items (scope, id, ${names.join(', ')}) VALUES (?, ?, ${names.map(() => '?').join(', ')})`)
    .bind(scope, id, ...Object.values(row)).run();
}
const insertCourse = (scope, id) => env.DB.prepare(
  "INSERT INTO courses (scope, id, code, name, color, created_at, updated_at) VALUES (?, ?, 'BIO', 'Biology', '#17B3AE', 1, 1)",
).bind(scope, id).run();
const FAILS = /CHECK constraint failed/;

describe('scopes in the schema', () => {
  it('accepts the three scope kinds and nothing else', async () => {
    await insertItem('u:someone', 'a');
    await insertCourse('c:class1', 'c');
    await insertItem('c:class1', 'a', { course_id: 'c' });
    await insertItem('p:proj1', 'project', { type: 'project' });
    await expect(insertItem('x:other', 'a')).rejects.toThrow(FAILS);
    await expect(insertItem('u:', 'b')).rejects.toThrow(FAILS);
    await expect(insertCourse('p:proj1', 'c')).rejects.toThrow(FAILS);
  });

  it('keeps each member\'s target and sidebar archive off a class course', async () => {
    await expect(env.DB.prepare("INSERT INTO courses (scope, id, code, name, color, target, created_at, updated_at) VALUES ('c:class4', 'c', 'BIO', 'Biology', '#17B3AE', 80, 1, 1)").run()).rejects.toThrow(FAILS);
    await expect(env.DB.prepare("INSERT INTO courses (scope, id, code, name, color, archived, created_at, updated_at) VALUES ('c:class4', 'c', 'BIO', 'Biology', '#17B3AE', 1, 1, 1)").run()).rejects.toThrow(FAILS);
    const id = await createUser('scope-target');
    await env.DB.prepare("INSERT INTO courses (scope, id, code, name, color, target, archived, created_at, updated_at) VALUES (?, 'c', 'BIO', 'Biology', '#17B3AE', 80, 1, 1, 1)").bind('u:' + id).run();
  });

  it('keeps personal fields off a class row, which always hangs off the class course', async () => {
    await insertCourse('c:class2', 'c');
    const row = (extra) => ({ course_id: 'c', ...extra });
    await expect(insertItem('c:class2', 'g', row({ type: 'exam', grade: 80 }))).rejects.toThrow(FAILS);
    await expect(insertItem('c:class2', 's', row({ status: 'done' }))).rejects.toThrow(FAILS);
    await expect(insertItem('c:class2', 'k', row({ checklist: '[{"id":"a","text":"x","done":false}]' }))).rejects.toThrow(FAILS);
    await expect(insertItem('c:class2', 't', row({ type: 'c-quiz1' }))).rejects.toThrow(FAILS);
    await expect(insertItem('c:class2', 'n', row({ assignees: '["u1"]' }))).rejects.toThrow(FAILS);
    await expect(insertItem('c:class2', 'none', { type: 'exam' })).rejects.toThrow(FAILS);
    await insertItem('c:class2', 'ok', row({ type: 'assignment', weight: 20, notes: 'Teams of 3', links: '[{"label":"Brief","url":"https://example.edu"}]' }));
  });

  it('lets a project row carry the team status but no grade, weight or course', async () => {
    await insertItem('p:proj2', 'done', { status: 'done', completed_at: 5, completed_by: 'u1', assignees: '["u1","u2"]', checklist: '[{"id":"a","text":"Routes","done":true}]' });
    await insertItem('p:proj2', 'all', { assignees: '["*"]' });
    await expect(insertItem('p:proj2', 'w', { weight: 10 })).rejects.toThrow(FAILS);
    await expect(insertItem('p:proj2', 'e', { type: 'exam' })).rejects.toThrow(FAILS);
    await expect(insertItem('p:proj2', 'g', { grade: 90 })).rejects.toThrow(FAILS);
  });

  it('keeps team fields off a personal row and puts class_id only on a row with no course', async () => {
    const id = await createUser('scope-personal');
    await insertCourse('u:' + id, 'bio');
    await expect(insertItem('u:' + id, 'a', { assignees: '["u1"]' })).rejects.toThrow(FAILS);
    await expect(insertItem('u:' + id, 'b', { completed_by: id })).rejects.toThrow(FAILS);
    await expect(insertItem('u:' + id, 'c', { course_id: 'bio', class_id: 'class1' })).rejects.toThrow(FAILS);
    await insertItem('u:' + id, 'd', { class_id: 'class1' });
    await insertItem('u:' + id, 'e', { course_id: 'bio' });
  });

  it('writes each change into its scope, with the scope in the payload of courses and items', async () => {
    const id = await createUser('scope-feed');
    await insertItem('u:' + id, 'i1');
    await insertCourse('c:class3', 'c');
    await insertItem('c:class3', 'i2', { type: 'exam', course_id: 'c' });
    await env.DB.prepare("INSERT INTO quotes (user_id, id, text, created_at, updated_at) VALUES (?, 'q1', 'Go', 1, 1)").bind(id).run();
    const rows = (await env.DB.prepare("SELECT scope, kind, row_id, payload FROM changes WHERE kind != 'courses' AND row_id IN (?, ?, ?) ORDER BY seq").bind('i1', 'i2', 'q1').all()).results;
    expect(rows.map((r) => [r.scope, r.kind, r.row_id])).toEqual([['u:' + id, 'items', 'i1'], ['c:class3', 'items', 'i2'], ['u:' + id, 'quotes', 'q1']]);
    expect(JSON.parse(rows[0].payload)).toMatchObject({ scope: 'u:' + id, id: 'i1', assignees: '[]' });
    expect(JSON.parse(rows[0].payload)).not.toHaveProperty('user_id');
    expect(JSON.parse(rows[2].payload)).toMatchObject({ user_id: id, id: 'q1' });
  });

  it('gives study sessions, achievements and users the columns later stages fill', async () => {
    const id = await createUser('scope-columns');
    expect(await env.DB.prepare('SELECT hidden_sources FROM users WHERE id = ?').bind(id).first()).toEqual({ hidden_sources: '[]' });
    await env.DB.prepare("INSERT INTO study_sessions (user_id, id, course_id, space_id, started_at, study_minutes, created_at, updated_at) VALUES (?, 's', 'c', 'class1', 1, 30, 1, 1)").bind(id).run();
    expect(await env.DB.prepare("SELECT space_id FROM study_sessions WHERE id = 's'").first()).toEqual({ space_id: 'class1' });
    await expect(env.DB.prepare("UPDATE users SET hidden_sources = '{}' WHERE id = ?").bind(id).run()).rejects.toThrow(FAILS);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run test/scope.test.js`
Expected: FAIL with `table items has no column named scope`.

- [ ] **Step 3: Change the schema**

In `migrations/0001_schema.sql`:

(a) Update the header comment's ownership paragraph. Replace

```sql
-- Every user-owned table is keyed by (user_id, id): ownership is part of the key,
-- not a filter a handler might forget.
```

with

```sql
-- Every table is keyed by its owner and an id: ownership is part of the key, not a
-- filter a handler might forget. Courses and items belong to a scope: 'u:<user id>' for a
-- person's own rows, 'c:<space id>' for a shared class's, 'p:<space id>' for a team
-- project's. The other tables belong to a user.
```

(b) In `users`, after the `last_seen_day` column and before `created_at`, add:

```sql
  -- What the person has hidden from their calendar: 'course:<id>', 'space:<id>' and
  -- 'personal'. The calendar feed honours it too.
  hidden_sources TEXT NOT NULL DEFAULT '[]'
                 CHECK (json_valid(hidden_sources) AND json_type(hidden_sources) = 'array'
                        AND json_array_length(hidden_sources) <= 40),
```

(c) Replace the whole `CREATE TABLE courses (…);` with:

```sql
CREATE TABLE courses (
  -- 'u:<user id>' for a person's own course, 'c:<space id>' for a shared class's one course.
  scope       TEXT NOT NULL CHECK ((scope GLOB 'u:?*' OR scope GLOB 'c:?*') AND length(scope) <= 40),
  id          TEXT NOT NULL CHECK (length(id) BETWEEN 1 AND 24),
  code        TEXT NOT NULL CHECK (length(code) BETWEEN 1 AND 8),
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  -- The twelve course colours; the first five are also the coat colours.
  color       TEXT NOT NULL CHECK (color IN ('#E4749B', '#8B5CC7', '#17B3AE', '#79B6EA', '#BCA6E6',
                                              '#F08A6C', '#E8B33A', '#4FBF8B', '#8FAE86', '#4F74D9', '#B8457E', '#7D8A99')),
  instructor  TEXT NOT NULL DEFAULT '' CHECK (length(instructor) <= 60),
  term        TEXT NOT NULL DEFAULT '' CHECK (length(term) <= 40),
  archived    INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  -- The weekly class timetable: [{id, kind, weekday, start, end, room}], at most 12.
  -- Each entry is validated in the Worker; SQLite checks it is a bounded JSON array.
  meetings    TEXT NOT NULL DEFAULT '[]'
              CHECK (json_valid(meetings) AND json_type(meetings) = 'array'
                     AND json_array_length(meetings) <= 12),
  -- The final grade the person is aiming for, or none.
  target      INTEGER CHECK (target IS NULL OR (typeof(target) = 'integer' AND target BETWEEN 1 AND 100)),
  -- The member who last wrote a shared class's course; NULL on a person's own.
  updated_by  TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER,
  revision    INTEGER NOT NULL DEFAULT 1 CHECK (typeof(revision) = 'integer' AND revision > 0),
  PRIMARY KEY (scope, id),
  -- A class's course holds the class's facts only: each member's target and "archived in
  -- my sidebar" live in their space_prefs. Its colour and term are the class's defaults.
  CHECK (scope GLOB 'u:*' OR (target IS NULL AND archived = 0))
);
```

(d) Replace the whole `CREATE TABLE items (…);` with:

```sql
CREATE TABLE items (
  -- 'u:<user id>', 'c:<space id>' (a class's item) or 'p:<space id>' (a project item or task).
  scope         TEXT NOT NULL CHECK ((scope GLOB 'u:?*' OR scope GLOB 'c:?*' OR scope GLOB 'p:?*') AND length(scope) <= 40),
  id            TEXT NOT NULL CHECK (length(id) BETWEEN 1 AND 24),
  -- A built-in type, or one of the person's own ('c-' ids, see users.types).
  type          TEXT NOT NULL CHECK (type IN ('exam', 'quiz', 'assignment', 'lab', 'tutoring', 'office', 'task', 'project')
                                 OR (type GLOB 'c-?*' AND length(type) <= 14 AND substr(type, 3) NOT GLOB '*[^a-z0-9]*')),
  title         TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 140),
  course_id     TEXT,
  date          TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  start         TEXT NOT NULL DEFAULT '' CHECK (start = '' OR start GLOB '[0-2][0-9]:[0-5][0-9]'),
  end           TEXT NOT NULL DEFAULT '' CHECK (end = '' OR end GLOB '[0-2][0-9]:[0-5][0-9]'),
  location      TEXT NOT NULL DEFAULT '' CHECK (length(location) <= 80),   -- "where" in the API
  status        TEXT NOT NULL CHECK (status IN ('todo', 'submitted', 'graded', 'done', 'missed')),
  grade         REAL CHECK (grade IS NULL OR grade BETWEEN 0 AND 100),
  weight        REAL CHECK (weight IS NULL OR weight BETWEEN 0 AND 100),
  notes         TEXT NOT NULL DEFAULT '' CHECK (length(notes) <= 5000),
  -- [{id, text, done}], at most 50
  checklist     TEXT NOT NULL DEFAULT '[]'
                CHECK (json_valid(checklist) AND json_type(checklist) = 'array'
                       AND json_array_length(checklist) <= 50),
  -- [{label, url}], at most 20
  links         TEXT NOT NULL DEFAULT '[]'
                CHECK (json_valid(links) AND json_type(links) = 'array'
                       AND json_array_length(links) <= 20),
  recur         TEXT CHECK (recur IS NULL OR recur = 'weekly'),
  weekday       INTEGER CHECK (weekday IS NULL OR weekday BETWEEN 0 AND 6),
  recur_until   TEXT CHECK (recur_until IS NULL
                            OR recur_until GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  dept          TEXT NOT NULL DEFAULT '' CHECK (length(dept) <= 40),
  completed_at  INTEGER,
  -- The member who last wrote a shared row; NULL on a person's own.
  updated_by    TEXT,
  -- A personal item kept under a shared class (the class's space id): an extra quiz, a
  -- lecture review. No foreign key, since it crosses scopes. A label on the person's own
  -- row: it is shape-checked only and never grants access.
  class_id      TEXT CHECK (class_id IS NULL OR length(class_id) BETWEEN 1 AND 24),
  -- A task's assignees: user ids, or ["*"] for everyone. Project rows only.
  assignees     TEXT NOT NULL DEFAULT '[]'
                CHECK (json_valid(assignees) AND json_type(assignees) = 'array'
                       AND json_array_length(assignees) <= 30),
  -- Who finished a project task. Project rows only.
  completed_by  TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  deleted_at    INTEGER,
  revision      INTEGER NOT NULL DEFAULT 1 CHECK (typeof(revision) = 'integer' AND revision > 0),
  PRIMARY KEY (scope, id),
  -- A course reference can only point at a course in the same scope. SET NULL would
  -- also null the scope, so a hard delete is refused while references remain: the API
  -- soft-deletes a course and detaches its items together, and the nightly purge comes after.
  FOREIGN KEY (scope, course_id) REFERENCES courses(scope, id) ON DELETE RESTRICT,
  -- A weekly slot needs a weekday.
  CHECK (recur IS NULL OR weekday IS NOT NULL),
  -- What each kind of scope may hold. A class row hangs off the class's one course and is
  -- the class's facts only: everyone's
  -- status, grade and checklist live in their own marks. A project row's status,
  -- completion and checklist (subtasks) are the team's; it never carries a grade or weight.
  CHECK (CASE substr(scope, 1, 2)
    WHEN 'u:' THEN assignees = '[]' AND completed_by IS NULL AND (class_id IS NULL OR course_id IS NULL)
    WHEN 'c:' THEN course_id IS NOT NULL AND grade IS NULL AND checklist = '[]' AND status = 'todo' AND completed_at IS NULL
                   AND completed_by IS NULL AND assignees = '[]' AND class_id IS NULL AND type NOT GLOB 'c-*'
    ELSE grade IS NULL AND weight IS NULL AND course_id IS NULL AND class_id IS NULL AND type IN ('project', 'task')
  END)
);
```

(e) In `study_sessions` and in `achievements`, after the `item_id` column, add:

```sql
  -- The shared space course_id or item_id belongs to, when it is a class's or a project's.
  space_id       TEXT CHECK (space_id IS NULL OR length(space_id) BETWEEN 1 AND 24),
```

(f) Replace the two item indexes

```sql
CREATE INDEX items_user_date   ON items (user_id, date);
CREATE INDEX items_user_course ON items (user_id, course_id);
```

with

```sql
CREATE INDEX items_scope_date   ON items (scope, date);
CREATE INDEX items_scope_course ON items (scope, course_id);
```

(g) Replace `CREATE TABLE changes (…);` and its first index with:

```sql
CREATE TABLE changes (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Whose feed: 'u:<user id>', 'c:<space id>' or 'p:<space id>'. No foreign key, so
  -- deleting an account deletes its 'u:' rows explicitly (worker/accounts.js).
  scope       TEXT NOT NULL,
  kind        TEXT NOT NULL,
  row_id      TEXT NOT NULL,
  payload     TEXT NOT NULL,
  deleted_at  INTEGER,
  UNIQUE (scope, kind, row_id)
);
CREATE INDEX changes_scope_seq ON changes (scope, seq);
```

(keep `CREATE INDEX changes_deleted …` as it is).

(h) Replace all ten `CREATE TRIGGER …_change_insert/_change_update` blocks with:

```sql
CREATE TRIGGER courses_change_insert AFTER INSERT ON courses BEGIN
 DELETE FROM changes WHERE scope = NEW.scope AND kind = 'courses' AND row_id = NEW.id;
 INSERT INTO changes(scope, kind, row_id, payload, deleted_at)
 VALUES(NEW.scope, 'courses', NEW.id, json_object('scope', NEW.scope, 'id', NEW.id, 'code', NEW.code, 'name', NEW.name, 'color', NEW.color, 'instructor', NEW.instructor, 'term', NEW.term, 'archived', NEW.archived, 'meetings', NEW.meetings, 'target', NEW.target, 'updated_by', NEW.updated_by, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at, 'deleted_at', NEW.deleted_at, 'revision', NEW.revision), NEW.deleted_at);
END;
CREATE TRIGGER courses_change_update AFTER UPDATE ON courses BEGIN
 DELETE FROM changes WHERE scope = NEW.scope AND kind = 'courses' AND row_id = NEW.id;
 INSERT INTO changes(scope, kind, row_id, payload, deleted_at)
 VALUES(NEW.scope, 'courses', NEW.id, json_object('scope', NEW.scope, 'id', NEW.id, 'code', NEW.code, 'name', NEW.name, 'color', NEW.color, 'instructor', NEW.instructor, 'term', NEW.term, 'archived', NEW.archived, 'meetings', NEW.meetings, 'target', NEW.target, 'updated_by', NEW.updated_by, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at, 'deleted_at', NEW.deleted_at, 'revision', NEW.revision), NEW.deleted_at);
END;

CREATE TRIGGER items_change_insert AFTER INSERT ON items BEGIN
 DELETE FROM changes WHERE scope = NEW.scope AND kind = 'items' AND row_id = NEW.id;
 INSERT INTO changes(scope, kind, row_id, payload, deleted_at)
 VALUES(NEW.scope, 'items', NEW.id, json_object('scope', NEW.scope, 'id', NEW.id, 'type', NEW.type, 'title', NEW.title, 'course_id', NEW.course_id, 'date', NEW.date, 'start', NEW.start, 'end', NEW.end, 'location', NEW.location, 'status', NEW.status, 'grade', NEW.grade, 'weight', NEW.weight, 'notes', NEW.notes, 'checklist', NEW.checklist, 'links', NEW.links, 'recur', NEW.recur, 'weekday', NEW.weekday, 'recur_until', NEW.recur_until, 'dept', NEW.dept, 'completed_at', NEW.completed_at, 'updated_by', NEW.updated_by, 'class_id', NEW.class_id, 'assignees', NEW.assignees, 'completed_by', NEW.completed_by, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at, 'deleted_at', NEW.deleted_at, 'revision', NEW.revision), NEW.deleted_at);
END;
CREATE TRIGGER items_change_update AFTER UPDATE ON items BEGIN
 DELETE FROM changes WHERE scope = NEW.scope AND kind = 'items' AND row_id = NEW.id;
 INSERT INTO changes(scope, kind, row_id, payload, deleted_at)
 VALUES(NEW.scope, 'items', NEW.id, json_object('scope', NEW.scope, 'id', NEW.id, 'type', NEW.type, 'title', NEW.title, 'course_id', NEW.course_id, 'date', NEW.date, 'start', NEW.start, 'end', NEW.end, 'location', NEW.location, 'status', NEW.status, 'grade', NEW.grade, 'weight', NEW.weight, 'notes', NEW.notes, 'checklist', NEW.checklist, 'links', NEW.links, 'recur', NEW.recur, 'weekday', NEW.weekday, 'recur_until', NEW.recur_until, 'dept', NEW.dept, 'completed_at', NEW.completed_at, 'updated_by', NEW.updated_by, 'class_id', NEW.class_id, 'assignees', NEW.assignees, 'completed_by', NEW.completed_by, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at, 'deleted_at', NEW.deleted_at, 'revision', NEW.revision), NEW.deleted_at);
END;

CREATE TRIGGER quotes_change_insert AFTER INSERT ON quotes BEGIN
 DELETE FROM changes WHERE scope = 'u:' || NEW.user_id AND kind = 'quotes' AND row_id = NEW.id;
 INSERT INTO changes(scope, kind, row_id, payload, deleted_at)
 VALUES('u:' || NEW.user_id, 'quotes', NEW.id, json_object('user_id', NEW.user_id, 'id', NEW.id, 'text', NEW.text, 'source', NEW.source, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at, 'deleted_at', NEW.deleted_at, 'revision', NEW.revision), NEW.deleted_at);
END;
CREATE TRIGGER quotes_change_update AFTER UPDATE ON quotes BEGIN
 DELETE FROM changes WHERE scope = 'u:' || NEW.user_id AND kind = 'quotes' AND row_id = NEW.id;
 INSERT INTO changes(scope, kind, row_id, payload, deleted_at)
 VALUES('u:' || NEW.user_id, 'quotes', NEW.id, json_object('user_id', NEW.user_id, 'id', NEW.id, 'text', NEW.text, 'source', NEW.source, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at, 'deleted_at', NEW.deleted_at, 'revision', NEW.revision), NEW.deleted_at);
END;

CREATE TRIGGER study_sessions_change_insert AFTER INSERT ON study_sessions BEGIN
 DELETE FROM changes WHERE scope = 'u:' || NEW.user_id AND kind = 'study_sessions' AND row_id = NEW.id;
 INSERT INTO changes(scope, kind, row_id, payload, deleted_at)
 VALUES('u:' || NEW.user_id, 'study_sessions', NEW.id, json_object('user_id', NEW.user_id, 'id', NEW.id, 'course_id', NEW.course_id, 'item_id', NEW.item_id, 'space_id', NEW.space_id, 'started_at', NEW.started_at, 'study_minutes', NEW.study_minutes, 'rounds_done', NEW.rounds_done, 'note', NEW.note, 'manual', NEW.manual, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at, 'deleted_at', NEW.deleted_at, 'revision', NEW.revision), NEW.deleted_at);
END;
CREATE TRIGGER study_sessions_change_update AFTER UPDATE ON study_sessions BEGIN
 DELETE FROM changes WHERE scope = 'u:' || NEW.user_id AND kind = 'study_sessions' AND row_id = NEW.id;
 INSERT INTO changes(scope, kind, row_id, payload, deleted_at)
 VALUES('u:' || NEW.user_id, 'study_sessions', NEW.id, json_object('user_id', NEW.user_id, 'id', NEW.id, 'course_id', NEW.course_id, 'item_id', NEW.item_id, 'space_id', NEW.space_id, 'started_at', NEW.started_at, 'study_minutes', NEW.study_minutes, 'rounds_done', NEW.rounds_done, 'note', NEW.note, 'manual', NEW.manual, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at, 'deleted_at', NEW.deleted_at, 'revision', NEW.revision), NEW.deleted_at);
END;

CREATE TRIGGER achievements_change_insert AFTER INSERT ON achievements BEGIN
 DELETE FROM changes WHERE scope = 'u:' || NEW.user_id AND kind = 'achievements' AND row_id = NEW.id;
 INSERT INTO changes(scope, kind, row_id, payload, deleted_at)
 VALUES('u:' || NEW.user_id, 'achievements', NEW.id, json_object('user_id', NEW.user_id, 'id', NEW.id, 'name', NEW.name, 'sticker', NEW.sticker, 'rule', NEW.rule, 'course_id', NEW.course_id, 'item_id', NEW.item_id, 'space_id', NEW.space_id, 'target', NEW.target, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at, 'deleted_at', NEW.deleted_at, 'revision', NEW.revision), NEW.deleted_at);
END;
CREATE TRIGGER achievements_change_update AFTER UPDATE ON achievements BEGIN
 DELETE FROM changes WHERE scope = 'u:' || NEW.user_id AND kind = 'achievements' AND row_id = NEW.id;
 INSERT INTO changes(scope, kind, row_id, payload, deleted_at)
 VALUES('u:' || NEW.user_id, 'achievements', NEW.id, json_object('user_id', NEW.user_id, 'id', NEW.id, 'name', NEW.name, 'sticker', NEW.sticker, 'rule', NEW.rule, 'course_id', NEW.course_id, 'item_id', NEW.item_id, 'space_id', NEW.space_id, 'target', NEW.target, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at, 'deleted_at', NEW.deleted_at, 'revision', NEW.revision), NEW.deleted_at);
END;
```

(i) Replace the two views with:

```sql
CREATE VIEW active_items AS
SELECT substr(i.scope, 3) AS user_id, i.id, i.type, i.title, i.date, i.start, i.end, i.status,
       i.course_id, c.code AS course_code, c.name AS course_name, i.revision
FROM items AS i
LEFT JOIN courses AS c
  ON c.scope = i.scope AND c.id = i.course_id AND c.deleted_at IS NULL
WHERE i.deleted_at IS NULL AND i.scope GLOB 'u:*';

CREATE VIEW account_summary AS
SELECT u.id AS user_id, u.username, u.created_at,
       (SELECT count(*) FROM courses AS c WHERE c.scope = 'u:' || u.id AND c.deleted_at IS NULL) AS courses,
       (SELECT count(*) FROM items AS i WHERE i.scope = 'u:' || u.id AND i.deleted_at IS NULL) AS items,
       (SELECT count(*) FROM quotes AS q WHERE q.user_id = u.id AND q.deleted_at IS NULL) AS quotes,
       (SELECT count(*) FROM study_sessions AS s WHERE s.user_id = u.id AND s.deleted_at IS NULL) AS study_sessions
FROM users AS u;
```

- [ ] **Step 4: Run the schema test**

Run: `npx vitest run test/scope.test.js`
Expected: PASS (7 tests). Most other Worker test files now fail until Task 5; that is expected.

- [ ] **Step 5: Commit**

```bash
git add migrations/0001_schema.sql test/scope.test.js
git commit -m "Schema: courses, items and the change feed belong to a scope

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: `worker/db.js` writes and reads by scope

**Files:**
- Modify: `worker/db.js`
- Test: `test/scope.test.js`

- [ ] **Step 1: Add the failing test**

Append to `test/scope.test.js` (add `import { upsertRow, deleteRow, getRow, syncPage, personal } from '../worker/db.js';` and `import { normalizeItem } from '../src/core/model.ts';` to its imports):

```js
describe('the Worker reads and writes a person\'s own scope', () => {
  const course = { code: 'BIO', name: 'Biology', color: '#17B3AE', instructor: '', term: '', archived: false, meetings: [] };

  it('stores personal courses and items under u:<id>, and pages them back', async () => {
    const id = await createUser('scope-worker');
    expect(personal(id)).toBe('u:' + id);
    const c = await upsertRow(env.DB, 'courses', id, 'bio', course);
    const i = await upsertRow(env.DB, 'items', id, 'mid', normalizeItem({ id: 'mid', title: 'Midterm', type: 'exam', courseId: 'bio' }));
    expect(await env.DB.prepare('SELECT scope FROM items WHERE id = ? AND scope = ?').bind('mid', 'u:' + id).first()).toEqual({ scope: 'u:' + id });
    expect((await getRow(env.DB, 'items', id, 'mid')).courseId).toBe('bio');
    const page = await syncPage(env.DB, id, 0);
    expect(page.changes.map((ch) => `${ch.kind}:${ch.row.id}`)).toEqual(['courses:bio', 'items:mid']);
    await deleteRow(env.DB, 'courses', id, 'bio', Date.now(), c.revision);
    expect((await getRow(env.DB, 'items', id, 'mid')).courseId).toBeNull();
    expect(i.revision).toBeGreaterThan(c.revision);
  });

  it('never reads a class row through a personal route', async () => {
    const id = await createUser('scope-isolated');
    await env.DB.prepare("INSERT INTO courses (scope, id, code, name, color, created_at, updated_at) VALUES ('c:' || ?, 'cc', 'SH', 'Shared', '#17B3AE', 1, 1)").bind(id).run();
    await env.DB.prepare("INSERT INTO items (scope, id, type, title, course_id, date, status, created_at, updated_at) VALUES ('c:' || ?, 'x', 'exam', 'Shared', 'cc', '2026-10-01', 'todo', 1, 1)").bind(id).run();
    expect(await getRow(env.DB, 'items', id, 'x')).toBeNull();
    expect((await syncPage(env.DB, id, 0)).changes).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run test/scope.test.js`
Expected: FAIL — `personal` is not exported (and the upserts fail on `user_id`).

- [ ] **Step 3: Implement**

In `worker/db.js`:

Replace the first line comment

```js
// Every query here takes a userId and scopes to it. No exceptions.
```

with

```js
// Every query here takes a userId and keeps to that person's rows. No exceptions.
// Courses and items belong to a scope, a person's own being 'u:<user id>'; the other
// tables belong to the user directly.
```

After the `const ACHIEVEMENT_LIMIT = 30;` line add:

```js
/** The scope of a person's own courses and items. */
export const personal = (userId) => 'u:' + userId;
/* The column that names a row's owner, and its value for this person. */
const SCOPED = new Set(['courses', 'items']);
const ownerCol = (table) => (SCOPED.has(table) ? 'scope' : 'user_id');
const ownerOf = (table, userId) => (SCOPED.has(table) ? personal(userId) : userId);
```

Replace `getRow` with:

```js
export async function getRow(db, table, userId, id) {
  const r = await db.prepare(`SELECT ${selectCols(table)} FROM ${table} WHERE ${ownerCol(table)} = ? AND id = ?`).bind(ownerOf(table, userId), id).first();
  return r ? rowToApi(table, r) : null;
}
```

Replace `upsertStmt` with:

```js
/** Insert or update. createdAt is kept on update; a deleted row is revived. */
function upsertStmt(db, table, userId, id, fields, now, revision) {
  const t = TABLES[table];
  const row = t.toRow(fields);
  const cols = Object.entries(t.cols);
  const owner = ownerCol(table), who = ownerOf(table, userId);
  const names = [owner, 'id', ...cols.map(([, col]) => col), 'created_at', 'updated_at', 'deleted_at'];
  const values = [who, id, ...cols.map(([field]) => row[field] ?? null), now, now, null];
  const updates = [...cols.map(([, col]) => `${col} = excluded.${col}`), 'updated_at = excluded.updated_at', 'deleted_at = NULL', 'revision = revision + 1'];
  const courseGuard = table === 'items' ? ' AND (? IS NULL OR EXISTS (SELECT 1 FROM courses WHERE scope = ? AND id = ? AND deleted_at IS NULL))' : '';
  const courseBindings = table === 'items' ? [fields.courseId ?? null, who, fields.courseId ?? null] : [];
  /* a new or revived achievement must fit under the limit; an edit to a live one always does */
  const capGuard = table === 'achievements' ? ' AND (SELECT count(*) FROM achievements WHERE user_id = ? AND id != ? AND deleted_at IS NULL) < ?' : '';
  const capBindings = table === 'achievements' ? [userId, id, ACHIEVEMENT_LIMIT] : [];
  return db
    .prepare(
      `INSERT INTO ${table} (${names.join(', ')}, revision) SELECT ${names.map(() => '?').join(', ')}, COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'changes'), 0) + 1 WHERE (? = 0 OR EXISTS (SELECT 1 FROM ${table} WHERE ${owner} = ? AND id = ?))${courseGuard}${capGuard}
       ON CONFLICT (${owner}, id) DO UPDATE SET ${updates.join(', ')} WHERE revision = ?
       RETURNING ${selectCols(table)}`,
    )
    .bind(...values, revision, who, id, ...courseBindings, ...capBindings, revision);
}
```

In `upsertRow`, replace the batch's first statement

```js
    db.prepare(`SELECT ${selectCols(table)} FROM ${table} WHERE user_id = ? AND id = ?`).bind(userId, id),
```

with

```js
    db.prepare(`SELECT ${selectCols(table)} FROM ${table} WHERE ${ownerCol(table)} = ? AND id = ?`).bind(ownerOf(table, userId), id),
```

Replace `deleteRow` with:

```js
/** Soft delete. Returns false if the row does not exist for this user. */
export async function deleteRow(db, table, userId, id, now = Date.now(), revision = 0) {
  const owner = ownerCol(table), who = ownerOf(table, userId);
  const stmts = [
    db.prepare(`UPDATE ${table} SET deleted_at = ?, updated_at = ?, revision = revision + 1 WHERE ${owner} = ? AND id = ? AND deleted_at IS NULL AND revision = ? RETURNING id`).bind(now, now, who, id, revision),
  ];
  if (table === 'courses') {
    stmts.push(
      db.prepare('UPDATE items SET course_id = NULL, updated_at = ?, revision = revision + 1 WHERE scope = ? AND course_id = ? AND changes() > 0').bind(now, who, id),
    );
  }
  // Study sessions outlive their course and item; only the link goes. The guard is the
  // delete above having happened now (changes() would only see the statement before).
  const unlink = { courses: 'course_id', items: 'item_id' }[table];
  if (unlink) {
    stmts.push(
      db.prepare(`UPDATE study_sessions SET ${unlink} = NULL, updated_at = ?, revision = revision + 1 WHERE user_id = ? AND ${unlink} = ? AND deleted_at IS NULL
        AND EXISTS (SELECT 1 FROM ${table} WHERE ${owner} = ? AND id = ? AND deleted_at = ?)`).bind(now, userId, id, who, id, now),
    );
  }
  const results = await db.batch(stmts);
  if (results[0].results.length) return true;
  // A miss: no such row (404), already deleted (done), or a stale revision (409).
  const current = await getRow(db, table, userId, id);
  if (!current) return false;
  if (current.deletedAt) return true;
  throw new HttpError(409, { error: 'conflict', current });
}
```

Replace `courseStmt` with:

```js
const courseStmt = (db, userId, id) =>
  db.prepare('SELECT 1 AS x FROM courses WHERE scope = ? AND id = ? AND deleted_at IS NULL').bind(personal(userId), id);
```

In `syncPage`, replace

```js
    db.prepare('SELECT seq, kind, payload FROM changes WHERE user_id = ? AND seq > ? ORDER BY seq LIMIT ?').bind(userId, cursor, limit + 1),
```

with

```js
    db.prepare('SELECT seq, kind, payload FROM changes WHERE scope = ? AND seq > ? ORDER BY seq LIMIT ?').bind(personal(userId), cursor, limit + 1),
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/scope.test.js test/rows.test.js test/sync-protocol.test.js test/sync.test.js test/round-trips.test.js test/study-sessions.test.js test/custom-achievements.test.js test/purge.test.js`
Expected: `scope.test.js`, `sync-protocol`, `sync`, `round-trips`, `study-sessions`, `custom-achievements`, `purge` PASS. `rows.test.js` still fails only in "a corrupt JSON column…" (raw SQL, fixed in Task 5).

- [ ] **Step 5: Commit**

```bash
git add worker/db.js test/scope.test.js
git commit -m "Worker rows: a person's courses and items under their scope

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: Accounts, Admin and the calendar feed by scope

Deleting an account used to rely on `changes` cascading from `users`; the scope has no foreign key, so the feed is deleted explicitly.

**Files:**
- Modify: `worker/accounts.js`, `worker/admin.js:60-61,210`, `scripts/add-user.mjs:77-78`, `worker/calendar.js:75-76`
- Test: `test/admin.test.js:106-107`, `test/calendar.test.js`

- [ ] **Step 1: Make the admin test name the feed by scope**

In `test/admin.test.js` replace lines 106–107

```js
    expect(await env.DB.prepare('SELECT count(*) AS n FROM courses WHERE user_id = ?').bind(id).first()).toEqual({ n: 0 });
    expect(await env.DB.prepare('SELECT count(*) AS n FROM changes WHERE user_id = ?').bind(id).first()).toEqual({ n: 0 });
```

with

```js
    expect(await env.DB.prepare("SELECT count(*) AS n FROM courses WHERE scope = 'u:' || ?").bind(id).first()).toEqual({ n: 0 });
    expect(await env.DB.prepare("SELECT count(*) AS n FROM changes WHERE scope = 'u:' || ?").bind(id).first()).toEqual({ n: 0 });
```

- [ ] **Step 2: Run to make sure it fails**

Run: `npx vitest run test/admin.test.js`
Expected: FAIL — the accounts list errors on `c.user_id`, and the delete leaves the change feed behind.

- [ ] **Step 3: Implement**

`worker/accounts.js`, whole file:

```js
// What deleting an account removes: each table, with how its rows name their owner (?1 is
// the user id), in an order the foreign keys accept; then the user row, whose deletion
// cascades to its Spotify attempts. Courses, items and the change feed belong to the
// scope 'u:<id>', which no foreign key follows, so they are listed here. Shared by the
// Admin page (worker/admin.js) and scripts/add-user.mjs, so no imports: the script runs
// it under Node.

export const ACCOUNT_TABLES = [
  ['achievements', 'user_id = ?1'],
  ['study_sessions', 'user_id = ?1'],
  ['items', "scope = 'u:' || ?1"],
  ['quotes', 'user_id = ?1'],
  ['courses', "scope = 'u:' || ?1"],
  ['spotify_tokens', 'user_id = ?1'],
  ['changes', "scope = 'u:' || ?1"],
];
```

`worker/admin.js`: replace lines 60–61 with

```js
            (SELECT count(*) FROM courses AS c WHERE c.scope = 'u:' || u.id AND c.deleted_at IS NULL) AS courses,
            (SELECT count(*) FROM items AS i WHERE i.scope = 'u:' || u.id AND i.deleted_at IS NULL) AS items,
```

and line 210 with

```js
      ...ACCOUNT_TABLES.map(([table, owner]) => db.prepare(`DELETE FROM ${table} WHERE ${owner}`).bind(id)),
```

`scripts/add-user.mjs`: replace lines 77–78

```js
  const owned = `user_id IN (SELECT id FROM users WHERE username = '${username}')`;
  sql = `${ACCOUNT_TABLES.map((t) => `DELETE FROM ${t} WHERE ${owned};`).join(' ')}
```

with

```js
  const who = `(SELECT id FROM users WHERE username = '${username}')`;
  sql = `${ACCOUNT_TABLES.map(([table, owner]) => `DELETE FROM ${table} WHERE ${owner.replaceAll('?1', who)};`).join(' ')}
```

`worker/calendar.js`: add `import { personal } from './db.js';` with the other imports, and replace the two queries at lines 75–76 with

```js
    env.DB.prepare('SELECT id, code, name, term, archived, meetings, created_at FROM courses WHERE scope = ? AND deleted_at IS NULL').bind(personal(userId)),
    env.DB.prepare('SELECT id, type, title, course_id, date, start, end, location, status, weight, notes, recur, weekday, recur_until FROM items WHERE scope = ? AND deleted_at IS NULL ORDER BY date').bind(personal(userId)),
```

(keep the rest of each line — anything after `.bind(...)` — unchanged).

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/admin.test.js test/calendar.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/accounts.js worker/admin.js scripts/add-user.mjs worker/calendar.js test/admin.test.js
git commit -m "Accounts, Admin and the calendar feed read a person's scope; account deletion clears its feed

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5: Health checks and the remaining raw-SQL tests

**Files:**
- Modify: `scripts/lib/database-health.js`
- Modify: `test/database-health.test.js:24,29`, `test/database-structure.test.js:14-20,32,39,60`, `test/quiz-target.test.js:73-74`, `test/rows.test.js:227-228`, `test/types.test.js:50`

- [ ] **Step 1: Point the tests at the scope**

`test/database-health.test.js` lines 24 and 29: replace `'DELETE FROM changes WHERE user_id = ?'` with `"DELETE FROM changes WHERE scope = 'u:' || ?"` and `'SELECT count(*) AS n FROM changes WHERE user_id = ?'` with `"SELECT count(*) AS n FROM changes WHERE scope = 'u:' || ?"`.

Add to the end of the `describe` in `test/database-health.test.js`:

```js
  it('finds personal rows whose account is gone', async () => {
    await env.DB.prepare("INSERT INTO courses (scope, id, code, name, color, created_at, updated_at) VALUES ('u:nobody', 'c', 'X', 'Orphan', '#17B3AE', 1, 1)").run();
    const report = await check();
    expect(report.checks).toContainEqual({ name: 'Personal rows with an account', issues: 2 });   // the course and its change entry
    await env.DB.prepare("DELETE FROM courses WHERE scope = 'u:nobody'").run();
    await env.DB.prepare("DELETE FROM changes WHERE scope = 'u:nobody'").run();
  });
```

`test/database-structure.test.js`:
- lines 14 and 19: `'DELETE FROM courses WHERE user_id = ? AND id = ?'` → `"DELETE FROM courses WHERE scope = 'u:' || ? AND id = ?"`
- lines 16 and 20: `'SELECT user_id, course_id FROM items WHERE user_id = ?'` → `"SELECT scope, course_id FROM items WHERE scope = 'u:' || ?"`, and the expected objects `{ user_id: id, course_id: 'c' }` / `{ user_id: id, course_id: null }` → `{ scope: 'u:' + id, course_id: 'c' }` / `{ scope: 'u:' + id, course_id: null }`
- lines 32 and 39: `WHERE user_id = ?` → `WHERE scope = 'u:' || ?` (switch those strings to double quotes)
- line 60: `["SELECT id FROM items WHERE user_id = 'u' AND course_id = 'c'", 'items_user_course'],` → `["SELECT id FROM items WHERE scope = 'u:u' AND course_id = 'c'", 'items_scope_course'],`
- also rename the first test to `'rejects direct course deletion without attempting to null the item scope'`

`test/quiz-target.test.js` lines 73–74 and `test/types.test.js` line 50: `WHERE user_id = ?` → `WHERE scope = 'u:' || ?` (double-quote the SQL strings).

`test/rows.test.js` lines 227–228: replace

```js
    await env.DB.prepare(`INSERT INTO changes (user_id, kind, row_id, payload, deleted_at) VALUES (?1, 'courses', 'bad', json_object(
      'user_id', ?1, 'id', 'bad', 'code', 'BAD', 'name', 'Bad', 'color', '#E4749B', 'instructor', '', 'term', '', 'archived', 0,
```

with

```js
    await env.DB.prepare(`INSERT INTO changes (scope, kind, row_id, payload, deleted_at) VALUES ('u:' || ?1, 'courses', 'bad', json_object(
      'scope', 'u:' || ?1, 'id', 'bad', 'code', 'BAD', 'name', 'Bad', 'color', '#E4749B', 'instructor', '', 'term', '', 'archived', 0,
```

- [ ] **Step 2: Run to see the health checks fail**

Run: `npx vitest run test/database-health.test.js`
Expected: FAIL — the checks still join on `user_id`, and the new check does not exist.

- [ ] **Step 3: Implement**

In `scripts/lib/database-health.js` replace everything from `const trackerTables` through the closing `];` of `databaseChecks` with:

```js
const trackerTables = ['courses', 'items', 'quotes', 'study_sessions', 'achievements'];
/* Courses and items carry their scope; the other tables a user, whose feed is 'u:' || user_id. */
const scoped = (table) => table === 'courses' || table === 'items';
const feedOf = (table, r) => (scoped(table) ? `${r}.scope` : `'u:' || ${r}.user_id`);
const ownerMatches = (table) => (scoped(table)
  ? "json_extract(c.payload, '$.scope') IS NOT r.scope"
  : "json_extract(c.payload, '$.user_id') IS NOT r.user_id");
export const databaseChecks = [
  { name: 'SQLite integrity', sql: 'PRAGMA quick_check', kind: 'integrity' },
  { name: 'Foreign keys', sql: 'PRAGMA foreign_key_check', kind: 'rows' },
  {
    name: 'Positive integer revisions', kind: 'count',
    sql: `SELECT ${['users', ...trackerTables].map((table) =>
      `(SELECT count(*) FROM ${table} WHERE typeof(revision) != 'integer' OR revision < 1)`).join(' + ')} AS issues`,
  },
  {
    name: 'Active item course references', kind: 'count',
    sql: `SELECT count(*) AS issues FROM items AS i LEFT JOIN courses AS c ON c.scope = i.scope AND c.id = i.course_id
      WHERE i.deleted_at IS NULL AND i.course_id IS NOT NULL AND (c.id IS NULL OR c.deleted_at IS NOT NULL)`,
  },
  {
    name: 'Change-feed record coverage', kind: 'count',
    sql: `SELECT ${trackerTables.map((table) => `
      (SELECT count(*) FROM ${table} AS r LEFT JOIN changes AS c
        ON c.scope = ${feedOf(table, 'r')} AND c.row_id = r.id AND c.kind = '${table}'
      WHERE c.seq IS NULL OR CASE WHEN json_valid(c.payload) THEN
        ${ownerMatches(table)} OR json_extract(c.payload, '$.id') IS NOT r.id OR
        json_extract(c.payload, '$.revision') IS NOT r.revision OR json_extract(c.payload, '$.deleted_at') IS NOT r.deleted_at
        ELSE 1 END)
      `).join(' + ')} AS issues`,
  },
  {
    name: 'Change-feed orphans', kind: 'count',
    sql: `SELECT count(*) AS issues FROM changes AS c WHERE c.kind NOT IN (${trackerTables.map((t) => `'${t}'`).join(', ')}) OR ${trackerTables.map((table) =>
      `(c.kind = '${table}' AND NOT EXISTS (SELECT 1 FROM ${table} AS r WHERE ${feedOf(table, 'r')} = c.scope AND r.id = c.row_id))`).join(' OR ')}`,
  },
  {
    // A person's own scope has no foreign key to users; this stands in for one.
    name: 'Personal rows with an account', kind: 'count',
    sql: `SELECT ${['courses', 'items', 'changes'].map((table) =>
      `(SELECT count(*) FROM ${table} WHERE scope GLOB 'u:*' AND substr(scope, 3) NOT IN (SELECT id FROM users))`).join(' + ')} AS issues`,
  },
];
```

- [ ] **Step 4: Run the whole Worker suite**

Run: `npx vitest run --project workers`
Expected: PASS except `test/move-db.test.js` (Task 6). If another file fails on `user_id`, it is a raw query on `courses`, `items` or `changes` this list missed: change it to `scope = 'u:' || ?` the same way.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/database-health.js test/database-health.test.js test/database-structure.test.js test/quiz-target.test.js test/rows.test.js test/types.test.js
git commit -m "Health checks and tests read the scope; a check stands in for the lost user foreign key

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 6: The move from rounds-v6 into the scoped schema

`TABLES` describes the **new** schema (the next move will copy out of it). Reading a rounds-v6 database adapts it on the way: `'u:' || user_id AS scope`, the payload of a course's or item's change rewritten to name the scope, and columns v6 lacks read as the new schema's defaults.

**Files:**
- Modify: `scripts/lib/move-db.js`, `scripts/move-db.mjs`
- Test: `test/move-db.test.js` (rewritten)

- [ ] **Step 1: Write the failing test**

Replace `test/move-db.test.js` with:

```js
import { applyD1Migrations, env } from 'cloudflare:test';
import { expect, it } from 'vitest';
import { upsertRow, syncPage } from '../worker/db.js';
import { normalizeCourse } from '../src/core/model.ts';
import { readQueries, copyStatements, COLUMNS_QUERY, uncopied } from '../scripts/lib/move-db.js';

const columns = async (db) => (await db.prepare(COLUMNS_QUERY).all()).results;
async function dump(db) {
  const out = {};
  for (const [name, sql] of readQueries(await columns(db))) {
    const rows = (await db.prepare(sql).all()).results;
    out[name] = name === 'state' ? rows[0] : rows;
  }
  return out;
}

/* rounds-v6 rows, written with plain SQL (today's Worker writes the new shape); that
   schema's own triggers fill its change feed. */
async function fillLegacy(db) {
  for (const id of ['ana', 'ben']) {
    await db.prepare(`INSERT INTO users (id, username, password_hash, types, study_flow, feed_gen, study_prefs, school_calendar, leaderboard, bg, is_admin, last_seen_day, created_at, updated_at)
      VALUES (?1, ?1, 'hash', '[{"id":"c-quiz1","label":"Quiz","color":"#B03A7A","kind":"graded"}]', '{"steps":[["study",50],["break",10]],"rounds":3}', ?2, '{"goal":105}', '{"terms":[]}', ?3, ?4, ?3, '2026-10-01', 100, 100)`)
      .bind(id, id === 'ana' ? 2 : null, id === 'ana' ? 1 : 0, id === 'ana' ? 'cs' : 'med').run();
    await db.prepare(`INSERT INTO courses (user_id, id, code, name, color, meetings, target, created_at, updated_at, revision)
      VALUES (?, 'bio', 'BIO', 'Biology ''n'' more', '#17B3AE', '[{"id":"m","kind":"Lecture","weekday":1,"start":"09:00","end":"10:00","room":"Hall B"}]', 85, 200, 200, 10)`).bind(id).run();
    await db.prepare(`INSERT INTO items (user_id, id, type, title, course_id, date, start, end, location, status, grade, weight, notes, checklist, links, completed_at, created_at, updated_at, revision)
      VALUES (?, 'mid', 'exam', 'Midterm: α & β', 'bio', '2026-10-05', '09:00', '10:00', 'Hall B', 'graded', 87.5, 20, 'Line one
line ''two''', '[{"id":"s","text":"Review","done":true}]', '[{"label":"Notes","url":"https://example.edu"}]', 205, 210, 210, 11)`).bind(id).run();
    await db.prepare("INSERT INTO items (user_id, id, type, title, date, status, created_at, updated_at, revision) VALUES (?, 'q', 'c-quiz1', 'Quiz', '2026-10-06', 'todo', 220, 220, 12)").bind(id).run();
    await db.prepare("INSERT INTO quotes (user_id, id, text, source, created_at, updated_at, revision) VALUES (?, 'k', 'Keep going', '', 230, 230, 13)").bind(id).run();
    await db.prepare(`INSERT INTO study_sessions (user_id, id, course_id, item_id, started_at, study_minutes, rounds_done, note, manual, created_at, updated_at, revision)
      VALUES (?, 's1', 'bio', 'mid', 1000, 50, 1, 'Krebs cycle, ''again''', 1, 235, 235, 14)`).bind(id).run();
    await db.prepare(`INSERT INTO achievements (user_id, id, name, sticker, rule, course_id, target, created_at, updated_at, revision)
      VALUES (?, 'a1', 'Bio buff', 'data:image/png;base64,iVBORw0KGgo=', 'hours', 'bio', 10, 236, 236, 15)`).bind(id).run();
  }
  await db.prepare("INSERT INTO items (user_id, id, type, title, date, status, created_at, updated_at, deleted_at, revision) VALUES ('ana', 'old', 'task', 'Old', '2026-10-01', 'todo', 240, 250, 250, 16)").run();
  /* a later write replaces an earlier change, so the head sits above the last kept seq */
  await db.prepare("INSERT INTO courses (user_id, id, code, name, color, created_at, updated_at, revision) VALUES ('ben', 'extra', 'X', 'Extra', '#8B5CC7', 260, 260, 17)").run();
  await db.prepare("UPDATE courses SET name = 'Extra 2', updated_at = 270, revision = 18 WHERE user_id = 'ben' AND id = 'extra'").run();
  await db.prepare("INSERT INTO spotify_tokens (user_id, refresh_token, access_token, expires_at, updated_at) VALUES ('ana', 'enc', 'acc', 999, 280)").run();
  await db.prepare('UPDATE sync_state SET floor = 2 WHERE id = 1').run();
  await db.prepare("INSERT INTO login_throttle (username, fails, updated_at) VALUES ('ana', 3, 1)").run();
  await db.prepare("INSERT INTO admin_log (at, admin, action, target, detail) VALUES (5, 'ana', 'create', 'ben', '')").run();
  const head = (await db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'changes'").first()).seq;
  await db.prepare("INSERT INTO changes (seq, user_id, kind, row_id, payload) VALUES (?, 'ana', 'x', 'x', '{}')").bind(head + 5).run();
  await db.prepare("DELETE FROM changes WHERE kind = 'x'").run();
}

it('copies a rounds-v6 database into the scoped schema, row for row, with the change feed and its head', async () => {
  const from = env.MIGRATION_DB, to = env.MOVE_DB;
  await applyD1Migrations(from, env.LEGACY_MIGRATIONS);
  await applyD1Migrations(to, env.TEST_MIGRATIONS);
  await fillLegacy(from);

  const source = await dump(from);
  /* read through the adapter: owners are scopes, a course's or item's change names its scope */
  expect(source.courses.map((c) => c.scope)).toEqual(['u:ana', 'u:ben', 'u:ben']);
  expect(source.items.every((i) => i.assignees === '[]' && i.class_id === null)).toBe(true);
  expect(source.users.every((u) => u.hidden_sources === '[]')).toBe(true);
  for (const change of source.changes) {
    const payload = JSON.parse(change.payload);
    if (change.kind === 'courses' || change.kind === 'items') {
      expect(payload.scope).toBe(change.scope);
      expect(payload).not.toHaveProperty('user_id');
    } else expect(change.scope).toBe('u:' + payload.user_id);
  }
  expect(source.state.head).toBeGreaterThan(Math.max(...source.changes.map((c) => c.seq)));

  await to.batch(copyStatements(source).map((sql) => to.prepare(sql)));
  expect(await dump(to)).toEqual(source);
  expect((await to.prepare('SELECT count(*) AS n FROM login_throttle').first()).n).toBe(0);
  expect(await to.prepare('PRAGMA foreign_key_check').all()).toMatchObject({ results: [] });

  /* devices sync on from the same cursor: ben's feed in the copy holds his rows */
  const page = await syncPage(to, 'ben', 0, 50);
  expect(page.changes.map((c) => `${c.kind}:${c.row.id}`).sort())
    .toEqual(['achievements:a1', 'courses:bio', 'courses:extra', 'items:mid', 'items:q', 'quotes:k', 'study_sessions:s1']);
  expect(page.changes.find((c) => c.row.id === 'extra').row.name).toBe('Extra 2');
  expect(page.changes.find((c) => c.kind === 'items' && c.row.id === 'mid').row).toMatchObject({ grade: 87.5, weight: 20, courseId: 'bio' });
  expect(page.cursor).toBe(source.state.head);
  /* the next write numbers on from the old head, in the person's own scope */
  const next = await upsertRow(to, 'courses', 'ana', 'n', normalizeCourse({ id: 'n', code: 'N', name: 'New', color: '#7D8A99' }), 300);
  expect(next.revision).toBe(source.state.head + 1);
  expect(await to.prepare("SELECT scope FROM courses WHERE id = 'n'").first()).toEqual({ scope: 'u:ana' });
});

it('names every source column the copy would leave behind, so a move stops before losing data', async () => {
  /* the rounds-v6 source above and today's schema: TABLES (with the scope adapter) covers both */
  expect(uncopied(await columns(env.MIGRATION_DB))).toEqual([]);
  expect(uncopied(await columns(env.DB))).toEqual([]);
  /* and a column added later is caught, not dropped */
  expect(uncopied([...await columns(env.DB), { tbl: 'users', col: 'shoe_size' }])).toEqual(['users.shoe_size']);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run test/move-db.test.js`
Expected: FAIL — `readQueries` ignores its argument and selects `user_id` from the new schema.

- [ ] **Step 3: Implement**

In `scripts/lib/move-db.js`, replace `TABLES` and `ORDER_BY` with:

```js
/* What moves, in an order the foreign keys accept, in the shape of today's schema.
   Throttles, request windows, OAuth attempts and refresh leases are short-lived, so they
   start empty. */
export const TABLES = {
  users: ['id', 'username', 'password_hash', 'pw_gen', 'display_name', 'coat_name', 'coat_role', 'coat_color', 'theme', 'bg', 'term_start', 'types', 'study_flow', 'feed_gen', 'study_prefs', 'school_calendar', 'leaderboard', 'is_admin', 'last_seen_day', 'hidden_sources', 'created_at', 'updated_at', 'revision'],
  courses: ['scope', 'id', 'code', 'name', 'color', 'instructor', 'term', 'archived', 'meetings', 'target', 'updated_by', 'created_at', 'updated_at', 'deleted_at', 'revision'],
  items: ['scope', 'id', 'type', 'title', 'course_id', 'date', 'start', 'end', 'location', 'status', 'grade', 'weight', 'notes', 'checklist', 'links', 'recur', 'weekday', 'recur_until', 'dept', 'completed_at', 'updated_by', 'class_id', 'assignees', 'completed_by', 'created_at', 'updated_at', 'deleted_at', 'revision'],
  quotes: ['user_id', 'id', 'text', 'source', 'created_at', 'updated_at', 'deleted_at', 'revision'],
  study_sessions: ['user_id', 'id', 'course_id', 'item_id', 'space_id', 'started_at', 'study_minutes', 'rounds_done', 'note', 'manual', 'created_at', 'updated_at', 'deleted_at', 'revision'],
  achievements: ['user_id', 'id', 'name', 'sticker', 'rule', 'course_id', 'item_id', 'space_id', 'target', 'created_at', 'updated_at', 'deleted_at', 'revision'],
  spotify_tokens: ['user_id', 'refresh_token', 'access_token', 'expires_at', 'updated_at'],
  changes: ['seq', 'scope', 'kind', 'row_id', 'payload', 'deleted_at'],
  admin_log: ['id', 'at', 'admin', 'action', 'target', 'detail'],
};

const ORDER_BY = { users: 'id', courses: 'scope, id', items: 'scope, id', changes: 'seq', spotify_tokens: 'user_id', admin_log: 'id' };

/* Reading rounds-v6 or older, whose courses, items and change feed name a user: the owner
   becomes the scope of that person's own rows, a course's or item's change names the
   scope in its payload too, and columns the old schema lacks read as today's defaults. */
const SCOPE_FROM_USER = `'u:' || "user_id" AS "scope"`;
const PAYLOAD_FROM_USER = `CASE WHEN kind IN ('courses', 'items') AND json_valid(payload) AND json_type(payload, '$.user_id') = 'text'
  THEN json_set(json_remove(payload, '$.user_id'), '$.scope', 'u:' || json_extract(payload, '$.user_id')) ELSE payload END AS "payload"`;
const DEFAULTS = { assignees: "'[]'", hidden_sources: "'[]'" };
```

Replace `uncopied` with:

```js
export function uncopied(columns) {
  return columns.filter(({ tbl, col }) => !LEFT_BEHIND.includes(tbl) && !TABLES[tbl]?.includes(col)
    && !(col === 'user_id' && TABLES[tbl]?.includes('scope')))
    .map(({ tbl, col }) => `${tbl}.${col}`);
}
```

Replace `readQueries` with:

```js
/**
 * The reads that make a dump, in today's shape: one per table, plus the feed's floor and
 * head. `columns` are the source's own (COLUMNS_QUERY), so an older database is adapted.
 */
export function readQueries(columns) {
  const has = new Set(columns.map(({ tbl, col }) => `${tbl}.${col}`));
  const pick = (table, col) => {
    if (has.has(`${table}.${col}`)) return `"${col}"`;
    if (col === 'scope' && has.has(`${table}.user_id`)) return SCOPE_FROM_USER;
    return `${DEFAULTS[col] ?? 'NULL'} AS "${col}"`;
  };
  const out = Object.entries(TABLES).map(([table, cols]) => {
    const list = cols.map((col) => (table === 'changes' && col === 'payload' && has.has('changes.user_id') ? PAYLOAD_FROM_USER : pick(table, col)));
    return [table, `SELECT ${list.join(', ')} FROM ${table} ORDER BY ${ORDER_BY[table] || 'user_id, id'}`];
  });
  out.push(['state', "SELECT (SELECT floor FROM sync_state WHERE id = 1) AS floor, COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'changes'), 0) AS head"]);
  return out;
}
```

In `copyStatements`, replace

```js
    out.push(`INSERT INTO changes (seq, user_id, kind, row_id, payload) VALUES (${literal(head)}, ${literal(someone.id)}, 'move', 'move', '{}')`);
```

with

```js
    out.push(`INSERT INTO changes (seq, scope, kind, row_id, payload) VALUES (${literal(head)}, ${literal('u:' + someone.id)}, 'move', 'move', '{}')`);
```

In `scripts/move-db.mjs`, replace `dump` with:

```js
function dump(db) {
  const out = {};
  const columns = d1(db, '--command', COLUMNS_QUERY)[0].results;
  for (const [name, sql] of readQueries(columns)) {
    const rows = d1(db, '--command', sql)[0].results;
    out[name] = name === 'state' ? rows[0] : rows;
  }
  return out;
}
```

and update its header comment's usage line to `node scripts/move-db.mjs --from rounds-v6 --to rounds-v7 [--remote]`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/move-db.test.js`
Expected: PASS (2 tests). If `toEqual(source)` differs only inside a change payload's number formatting (e.g. `87.5`), compare `JSON.parse` of both payloads instead and note it in the commit.

- [ ] **Step 5: Run everything**

Run: `npm run check`
Expected: typecheck, every test (Workers, jsdom, node) and the build pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/move-db.js scripts/move-db.mjs test/move-db.test.js
git commit -m "Move: copy rounds-v6 into the scoped schema, adapting owners, payloads and new columns

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 7: Documents

**Files:**
- Modify: `docs/DATA-MODEL.md`

- [ ] **Step 1: Update the data model**

In `docs/DATA-MODEL.md`:
- Opening paragraph: "every row stamped with the owner's `user_id`" → "every row stamped with its owner: a `scope` on courses and items (`u:<user id>` for a person's own; `c:`/`p:` for shared spaces, coming with collaboration), a `user_id` on the rest".
- The move history paragraph: add "then `rounds-v6` into `rounds-v7`, giving courses, items and the change feed a scope" and change "`rounds-v6` is the only database left" to "`rounds-v7` is the live database".
- The mermaid diagram and "An item's optional course relationship is `(user_id, course_id)`" → `(scope, course_id)` to `courses(scope, id)`.
- Conventions, **Ids**: "The primary key of every user-owned table is `(user_id, id)`" → "`(scope, id)` for courses and items, `(user_id, id)` for the others".
- `courses` and `items` column tables: first row `scope, id` with "`u:<user id>` (personal), `c:<space id>` (class), `p:<space id>` (project; items only)"; add rows for `updated_by`, and for items `class_id`, `assignees`, `completed_by`, each "for collaboration; see `docs/superpowers/specs/2026-10-02-shared-classes-design.md`".
- `study_sessions`, `achievements`: add `space_id`. `users`: add `hidden_sources`.
- Indexes table: `items (user_id, date)` → `items (scope, date)`, `items (user_id, course_id)` → `items (scope, course_id)`, `changes (user_id, seq)` → `changes (scope, seq)`.
- Sync section, item 4: "SQLite triggers capture each write transaction in an increasing sequence" — add "keyed by scope (`'u:' || user_id` for a person's own rows)".
- Security model item 1: "every SQL statement filters on that `user_id`" → "every SQL statement filters on that user (`user_id`, or the scope `u:<user id>` for courses and items)".

- [ ] **Step 2: Commit**

```bash
git add docs/DATA-MODEL.md
git commit -m "Data model: courses, items and the change feed belong to a scope

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 8: Rehearse the move locally

Follows the clean-db procedure (memory: `clean-db-procedure`), locally first.

**Files:**
- Modify (temporarily, not committed): `wrangler.jsonc`

- [ ] **Step 1: Make sure local rounds-v6 is current**

```bash
git stash -u   # only if anything is uncommitted
git switch main && npx wrangler d1 migrations apply DB --local && git switch collab-1-scope
git stash pop  # only if you stashed above
```

Expected: "No migrations to apply" or the one schema applied.

- [ ] **Step 2: Add a temporary binding for the target**

In `wrangler.jsonc` `d1_databases`, add after the `DB` entry:

```jsonc
    { "binding": "NEW_DB", "database_name": "rounds-v7", "database_id": "local-rounds-v7", "migrations_dir": "migrations" }
```

- [ ] **Step 3: Build the target and copy**

```bash
npx wrangler d1 migrations apply rounds-v7 --local
node scripts/move-db.mjs --from rounds-v6 --to rounds-v7
```

Expected: a table of row counts equal on both sides, "Change feed {floor, head} → {same}", and "Done: rounds-v7 matches rounds-v6. rounds-v6 was not changed."

- [ ] **Step 4: Check the copy and run the app on it**

Swap the two entries' `binding` names (`rounds-v7` becomes `DB`), then:

```bash
node scripts/check-db.mjs
npm run dev
```

Expected: every health check 0 issues. In the browser (http://127.0.0.1:8787), sign in, and see the same courses, items, grades, study history and achievements as before; edit an item and reload; the sync dot goes idle.

- [ ] **Step 5: Restore the config**

Stop the dev server (and free 8787/8790 if `vite.js` stays). `git checkout wrangler.jsonc`. Nothing to commit.

### Task 9: The live move (only with George's yes)

**Files:**
- Modify: `wrangler.jsonc`

- [ ] **Step 1: Ask George** whether to move live now. Wait for a yes. From here until Step 6, push nothing to `main`: a Git build of `main` would deploy the old code bound to rounds-v6 and send live writes back there. Do Step 6 right after Step 5.

Pre-flight: every user id fits a scope (`length(scope) <= 40`):

```bash
npx wrangler d1 execute rounds-v6 --remote --command "SELECT id FROM users WHERE length(id) > 38"
```

Expected: no rows. Any row: stop and tell George; the move would fail on that account.

- [ ] **Step 2: Create the database**

```bash
npx wrangler d1 create rounds-v7
```

Expected: a `database_id`. Put it into `wrangler.jsonc`: the `DB` entry becomes

```jsonc
  // rounds-v7 was built fresh from migrations/0001_schema.sql and filled by
  // scripts/move-db.mjs from rounds-v6 on <date> (courses, items and the change feed by scope).
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "rounds-v7",
      "database_id": "<the id>",
      "migrations_dir": "migrations"
    }
  ],
```

- [ ] **Step 3: Build, then apply the schema remotely**

```bash
npm run build
npx wrangler d1 migrations apply DB --remote
```

- [ ] **Step 4: Copy, then deploy at once** (so no live edit falls between them)

```bash
node scripts/move-db.mjs --from rounds-v6 --to rounds-v7 --remote && npx wrangler deploy
```

Expected: "Done: rounds-v7 matches rounds-v6"; deploy succeeds. The `&&` matters: if the copy fails, the site must stay on rounds-v6, because devices syncing against a partial rounds-v7 would reset to it.

If the copy fails: do not deploy. The live site is still on rounds-v6 and nothing was lost. `npx wrangler d1 delete rounds-v7`, then repeat Steps 2–4 once the cause is fixed (a rerun into the partly filled database is refused anyway).

- [ ] **Step 5: Check**

```bash
node scripts/check-db.mjs --remote
npx wrangler d1 execute rounds-v6 --remote --command "SELECT seq FROM sqlite_sequence WHERE name = 'changes'"
```

Expected: every check 0 issues; rounds-v6's head equals the head the move printed (no write reached v6 after the copy). Open the live site, confirm data and one edit.

If rounds-v6's head is higher, a live write reached v6 between the copy and the deploy. List what it was:

```bash
npx wrangler d1 execute rounds-v6 --remote --command "SELECT seq, user_id, kind, row_id FROM changes WHERE seq > <printed head> ORDER BY seq"
```

Tell George which rows they are (normally one or two, from one person). Then either have that person redo the edit on the live site (it now writes to v7), or, for more than a few rows, deploy rounds-v6 back (`git stash` the `wrangler.jsonc` change, `npm run build`, `npx wrangler deploy`), delete and recreate rounds-v7, and repeat Steps 3–5 at a quiet time. Never write to rounds-v6 by hand. Running Steps 4–5 when nobody is using the site avoids this.

- [ ] **Step 6: Commit and merge**

```bash
git add wrangler.jsonc
git commit -m "rounds-v7: courses, items and the change feed by scope

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

With George's yes: merge `collab-1-scope` into `main` and push. Keep rounds-v6 until George says to delete it. Update memory (`clean-db-procedure`: done v2–v7).
