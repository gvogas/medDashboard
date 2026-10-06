# Collaboration Stage 4: The personal layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

This is **Stage 4** of the master plan `docs/superpowers/plans/2026-10-02-collaboration.md` (its "The stages" table and the Stage 4 outline, with the hand-offs Stage 3 recorded). **It ships together with Stage 3**: one branch (`collab-3-classes`), one merge, migrations `0003_invites.sql` and `0004_marks.sql` applied together. Its tasks are numbered **16–30** and run **after** Stage 3's Tasks 1–14 (`docs/superpowers/plans/2026-10-05-collab-stage-3-classes.md`) on the same branch. This plan's **Task 30 replaces Stage 3's Task 15** (migrations, merge, push). Stage 2's plan (`docs/superpowers/plans/2026-10-05-collab-stage-2-sync.md`) and Stage 3's plan bind this one: field merge for shared rows and marks, the resync cursor, effective lists keyed by `scope/id`, member task rules, roll-forward only.

Everything below is written against the code **as it will be after Stage 3's Tasks 1–14**: `worker/spaces.js` (`createClass`, `checkConvert`, `MADE_FROM`, `NEXT_ROW_REVISION`, `spaceSummary`, `touchSpace`), `worker/invites.js` (`acceptInvite`, `joinByCode`), `worker/classes.js` (`classRoutes`, `idOf`, `bad`, `joiner`), `src/data/classes.ts`, `src/components/sheet/{class-sheet,members-tab,new-class-sheet,convert-sheet,share-course,join-sheet,invites-sheet}.tsx`, `src/components/sidebar-classes.tsx`, `src/components/shared-glyph.tsx`, the `useSpaces`/`useSharedCourses`/`useSharedItems` hooks and the Stage 3 tests. Where Stage 3 chose something "until Stage 4" (convert copies, a short join screen, no `space_prefs`, `SHARED_IN_VIEWS = false`, class rows opening the class sheet), this plan completes it.

**Goal:** An admin's classes join their Week, Month, All items, grades, stats, achievements, exam prep, lecture reviews and study pickers, with their own status, grade, weight, checklist and notes on top of each class item (`marks`) and their own colour, target, semester and archive flag for each class (`space_prefs`); a convert moves a course into a class; a member merges their own copy of a course into a class they joined. Nobody who is not an admin sees any change.

**Architecture:** `migrations/0004_marks.sql` adds `marks` and `space_prefs` (one text `id`, owned by a user, change feed `'u:' || user_id`) and backfills prefs for Stage 3's memberships. The Worker gains `/api/marks/:sid/:itemId` (field merge, as shared rows) and `/api/space_prefs/:sid` (whole-row `If-Match`), prefs in the create/accept/join batches, a moving convert and `POST /api/spaces/:sid/absorb`; old clients page only their five kinds and cannot clear the new labels. On the client, IndexedDB 6 adds the two stores; `src/data/effective.ts` merges marks and prefs into the lists every view reads; `src/data/refs.ts` puts study sessions and achievements in the same key space; the item card splits a class item into **Class** and **Yours**; the sidebar lists classes with eye toggles; the join screen asks for semester and colour; the merge sheet pairs a personal course with a class.

**Tech Stack:** Cloudflare Workers + D1 (plain JS ES modules), React 19 + TypeScript + Vite, IndexedDB (fake-indexeddb in node tests), Vitest (Workers pool + jsdom), wrangler.

**Spec:** `docs/superpowers/specs/2026-10-02-shared-classes-design.md`: §3 (`marks`, `space_prefs`, `users.hidden_sources`), §4, §5, §6 (marks push), §7, §8, §9, §11 (join screen, merge), §13 (convert, absorb), §14, §15, §16, §17, §18, §21, §23.

**UI reference:** the prototype George approved (`term-shared.html` in the planning session's scratchpad): the item card split into **Class** (locked for members, "Edited by Alex · 2h ago") and **Yours** (status, grade, weight override with **Use class weight**, exam-prep checklist, your notes, **Not mine · hide it** asking first when graded); the join flow's semester and colour step; the merge sheet (pairs, **Not the same item**, unsure pairs left apart, **Skip** leaving a banner); the sidebar's eye toggles and shared glyph; **Hidden from you** with **Show again** in the class sheet; **Your grade so far**. This plan builds them in the app's own sheets, fields and sidebar rows.

---

## How to work in this repo (read before any task)

1. **Checks:** `npm run typecheck`, `npm test` (Vitest: Workers + jsdom projects, then node tests), `npm run build`. `npm run check` runs all three. One file: `npx vitest run test/marks.test.js`. The jsdom tests alone: `npm run test:ui`. The Worker tests alone: `npm run test:api`. The node tests: `npm run test:local`.
2. **Dev server:** `npm run dev` → http://127.0.0.1:8787. On this Windows machine a stopped dev server can leave `vite.js` holding 8787/8790 and serving old code: check `Get-NetTCPConnection -LocalPort 8787 -State Listen` in PowerShell first and stop the owning process. Don't run `npm run build` while the dev server runs.
3. **Line endings:** keep every file LF. A CRLF in `index.html` breaks the CSP hash.
4. **Non-ASCII** (·, —, …, ✎): write it with the Edit/Write tools, never through a shell; after a commit that adds any, `npm run build` (Vite refuses Latin-1 bytes that tests miss). A sub-agent may write `·` as Latin-1: check a touched file with `iconv -f utf-8 -t utf-8 <file> >/dev/null` in Git Bash.
5. **Deploying:** the Cloudflare Git build runs `npm run build` and does **not** apply remote D1 migrations. Task 30 applies 0003 and 0004 **before** the push.
6. **Commits:** end each message with the two lines below. Commit only on `collab-3-classes`; never push, merge to `main` or touch remote D1 except in Task 30 (George has allowed exactly the commands listed there).
   ```
   Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
   Claude-Session: https://claude.ai/code/session_01JpUR1JXMY3ehtkiJwuij95
   ```
7. **Workers AI:** the automated tests use fakes; nothing in this stage calls AI.
8. **The suite stays green after every task.** A task that changes a shape an older test spells out in full (a whole item or session compared with `toEqual`) updates that test in the same task; the step says which.

Branch: `collab-3-classes` (Stage 3's Tasks 1–14 are done on it first).

---

## Decisions this plan takes (where the spec left a choice, or shipping with Stage 3 forced one)

1. **Stages 3 and 4 ship as one.** Nothing live has a Stage 3 membership before `0004` lands, so the `space_prefs` backfill finds nothing remotely; it stays (it is harmless, re-runnable, and covers local test data made while building Stage 3). IndexedDB goes from 5 straight to **6** (stores `marks`, `space_prefs`); the deploy is **roll-forward only**, as Stage 2's was.
2. **Everything class-related stays admin-only until Stage 6.** `src/data/effective.ts` shows shared rows only while `SHARED_IN_VIEWS && (!CLASSES_ADMIN_ONLY || profile.isAdmin)`; the eye toggles and the *Personal items* row show for admins only. For anyone else `effectiveItems()`/`effectiveCourses()` return the store's own arrays and every keyed helper in `src/data/refs.ts` returns the list it was given, so their grades, stats and views are the same values from the same arrays. Stage 6 removes `CLASSES_ADMIN_ONLY` and the sidebar's `admin &&` checks (recorded in the master plan's Stage 6 list).
3. **`marks` and `space_prefs` cascade from `users`** (`ON DELETE CASCADE`, as `members` does), since Stage 3 already lets an admin delete an account that owns no class. Their tombstones join the nightly purge's table list now; Stage 5 adds §13's detach-first order. The database health checks learn both tables (their change rows would otherwise count as orphans and `npm run db:check -- --remote` would fail).
4. **Marks** (`PUT /api/marks/:sid/:itemId`) need a live membership (any role; an archived space still takes your layer) and a live item of that space, checked inside the statement; anything else is `404`. They merge field by field (`changed`, as shared rows; a first write merges against the defaults), so two devices' first marks on one item combine. On a project's item only `notes` and `hidden` may differ from the defaults (`400 {field}`). **Prefs** (`PUT /api/space_prefs/:sid`) are whole-row `If-Match` like every other personal row and need a live membership; `DELETE` of either is always yours.
5. **Old clients** (spec §16): `sync?v=2` pages only `courses`, `items`, `quotes`, `study_sessions`, `achievements`, and its cursor still reaches the head. A personal `PUT` without `classId` (items) or `spaceId` (sessions, achievements) keeps the stored value; `PUT /api/me` without `hiddenSources` keeps it. The new client always sends all three (`null`/`[]` to clear).
6. **Convert moves** (spec §13; Stage 3 copied, its Decision 1), in the same safe-to-retry batch: the class course and the ticked items go in as before; a mark is written for each ticked item that holds anything of yours (status other than todo, a grade, notes, a checklist, a completion time); your prefs take the course's colour, target, term and archived flag; your course and the ticked items are soft-deleted (directly, not through the course-delete path); every other live item of the course is filed under the class (`class_id`, `course_id` cleared); your sessions on the course or a moved item, and your hours achievements on the course and grade achievements on a moved item, get `space_id`. A session on the course **and** an item that stays yours keeps its item and loses its course link, as deleting a course does today. A repeated convert is answered from the class it made **before** the item checks run (the course it moved no longer exists).
7. **Prefs on making and joining** (spec §9, §11): a blank class gives its owner the course's colour and term; accept and join write a prefs row in the membership batch with the class course's colour unless you already use it (your live courses, your other prefs), else the first of the twelve you do not use; the term is the class's default. A rejoin revives a deleted prefs row with fresh defaults; a live one is left alone (an accept retried). The join screen then confirms the semester (the class's term if your school calendar has a semester of that name, else the one covering today) and the colour, and saves them with an ordinary prefs write.
8. **Absorb** (`POST /api/spaces/:sid/absorb {courseId, pairs: [[mine, shared]], fromCourse}`), any live member of a class, writes no shared row. Pairs must name live items of your course and live items of the class, each once; a custom-typed item of yours is refused. A mark is written from each paired item that holds anything (its weight becomes an override only when it differs from the class's); a mark you already had wins field by field. Sessions and achievements follow the pairs and the course to the class's ids with `space_id`; your other items of the course are filed under the class; the course is soft-deleted. Your target always moves into your prefs when they have none; `fromCourse` (the merge sheet opened from the class or the course, not right after joining) also moves the colour, term and archived flag. A course already deleted answers `200 {paired: 0, filed: 0}` (a retry).
9. **The merge sheet** pairs identical ids first, then the same type and the same normalised title, taking the nearest date only when it is the nearest both ways and has no tie (anything else is left apart). Lecture reviews and custom-typed items are never paired. A personal course "matches" a class when it has the class course's id (a Stage 3 copy, or a rejoin's detached copy), else the same code, else the same name. **Skip** stores nothing: while a matching personal course exists, the class sheet and the course sheet show a banner with **Merge**.
10. **Not in Stage 4:** a deleted class item holding your mark stays out of the views until Stage 5's **Keep as mine / Dismiss** (applyPage still removes it; your mark stays in the store); **Share with class** for one personal item (`absorb {items}`) is left to a later stage (recorded in the master plan's Stage 5 outline); the ICS feed's class rows and `hidden_sources` are Stage 6. Because the feed reads only your own rows until Stage 6, **a course an admin converts leaves their calendar feed until Stage 6**: the browser check uses a throwaway course.
11. **Hiding a source is about the calendar** (spec §9): the eye filters the Week and the Month (their boards, office hours and tasks). All items, the stat tiles and grades still count hidden sources. Hidden sidebar rows stay listed, dimmed. At 40 hidden sources a 41st is refused with a toast.
12. **Keys everywhere a class row can appear.** The views open items, tick tasks and open courses by `keyOf()`; a shared course key opens the class sheet. The study pickers, History, Today, badges, the session and achievement sheets and the focus screen work in **key space** (`src/data/refs.ts`): a session or achievement's course/item key is `<scope>/<id>` when it has a `space_id`, else its id, and is split back into `{courseId, itemId, spaceId}` when saved. Stage 3's class rows in the sidebar now filter the views like a course row; their ✎ opens the class sheet, which is where Stage 3's class rows used to go.
13. **The item card.** A personal item keeps today's card (a course picker that also lists your classes files the item under one). A class item opens a new card: **Class** (editable for the owner and editors, read-only for members, "Edited by … · 2h ago") and **Yours** (status, grade, weight override with **Use class weight**, topics/checklist with *Fill topics from lectures*, your notes, *Studied*, **Not mine · hide it**). A new item with a class picked becomes a class item for an owner or editor when **Add it to the class for everyone** is ticked (on by default), else a personal item filed under the class.
14. **Shared course facts** (name, code, teacher, default semester, default colour, class times) are edited in the existing course sheet in a shared mode, opened from the class sheet's **Edit class details** (owner and editors); it saves through `saveShared('shared_courses', …)`.
15. **Maintenance** (`inMaintenance('classes')`): the class sheet, the class item card, the join sheet and the merge sheet show the maintenance page to a non-admin when classes are switched off (unreachable until Stage 6) and the admins' bar to an admin; shared and layer writes that the Worker holds back stay pending, as sync already does.
16. **Weight override:** your weight field is empty while you use the class's; a weight of yours that differs from the class's shows "The class weight is 20%." with **Use class weight** (it clears yours). Hiding asks first when the mark holds a grade or the status is graded; hidden items are listed under **Hidden from you** in the class sheet with **Show again**.

## File map

| File | Change |
|---|---|
| `migrations/0004_marks.sql` | new: `marks`, `space_prefs`, their triggers and indexes, the prefs backfill |
| `scripts/lib/move-db.js` | `TABLES` gains `marks`, `space_prefs` (made-before reads as empty) |
| `scripts/lib/database-health.js` | `trackerTables` gains `marks`, `space_prefs` |
| `worker/admin.js` | `LATEST_MIGRATION = '0004_marks.sql'` |
| `worker/http.js` | `revisionOf` (moved from `api.js`, shared with `layer.js`) |
| `worker/validate.js` | `COURSE_COLOURS` exported; `classId`/`spaceId` labels; `hiddenSources`; `validateMark`, `validatePref` |
| `worker/db.js` | `classId`/`spaceId` kept when absent; v2 pages five kinds; profile `hiddenSources`; `marks`/`space_prefs` rows; `upsertMark`, `upsertPref`; purge list |
| `worker/layer.js` | new: `layerRoutes` (`/api/marks/:sid/:itemId`, `/api/space_prefs/:sid`) |
| `worker/api.js` | `...layerRoutes`; `revisionOf` from `http.js` |
| `worker/spaces.js` | `joinPrefs`, `priorConvert`; `createClass` writes prefs and moves; `absorb` |
| `worker/invites.js` | accept and join write prefs |
| `worker/classes.js` | convert answers a prior class first; `POST /api/spaces/:sid/absorb` |
| `src/core/shared.ts` | `SHARED_FIELDS.marks`, `MARK_DEFAULTS`, `fieldSetOf` for marks |
| `src/core/types.ts` | `Mark`, `SpacePref`; `classId`, `spaceId`, `hiddenSources` |
| `src/core/model.ts` | `normalizeMark`, `normalizeSpacePref`; labels kept by the normalizers |
| `src/core/db.ts` | IndexedDB version 6 |
| `src/core/store.ts` | `marks`, `space_prefs` kinds; `saveMark` (with base), `saveSpacePref`; `hiddenSources` |
| `src/core/api.ts` | marks' URL and `changed`; v3 kinds; `spaces.absorb` |
| `src/core/sync.ts` | marks push with `changed`; upload order |
| `src/core/reviews.ts` | a class course's reviews are filed under the class; the chain inherits `classId` |
| `src/data/effective.ts` | marks and prefs merged; filed items keyed; admin gate; sources and `onCalendar`; `courseByKey`/`itemByKey` |
| `src/data/refs.ts` | new: keys for sessions and achievements, `placeCourse`, keyed lists |
| `src/data/sources.ts` | new: `hiddenSources`, `toggleSource` |
| `src/data/marks.ts` | new: your mark and the class's row edited from the card; hide; `addToClass`; `editedBy` |
| `src/data/merge.ts` | new: `pairItems`, `matchFor`, `openMerge`, `mergeCourse` |
| `src/data/store.ts` | `useMarks`, `useSpacePrefs` |
| `src/data/classes.ts` | `landed` waits for prefs; `savePref`; `freeColour` counts prefs; convert's words |
| `src/data/overlay.ts` | sheet kind `merge` |
| `src/data/actions.ts`, `src/data/views.ts` | by key; class course opens the class; the calendar filter |
| `src/data/study.ts`, `study-controller.ts`, `study-timer.ts`, `run.ts`, `session-edit.ts`, `achievement-edit.ts`, `item-edit.ts`, `sync-status.ts`, `school-edit.ts` | effective lists, key space |
| `src/components/sheet/class-item-sheet.tsx` | new: the class item card |
| `src/components/sheet/typed.ts` | new: `useTyped` for text that saves when typing pauses |
| `src/components/sheet/merge-sheet.tsx` | new: the merge sheet |
| `src/components/sheet/item-sheet.tsx` | classes in the course picker; `Checklist`, `Links` exported |
| `src/components/sheet/course-sheet.tsx` | shared mode; keyed items; `Grades` exported with a title |
| `src/components/sheet/class-sheet.tsx` | replaced: Details with Yours, grade so far, hidden items, merge banner, maintenance |
| `src/components/sheet/join-sheet.tsx` | replaced: semester and colour, merge next |
| `src/components/sheet/share-course.tsx` | replaced: merge into a class |
| `src/components/sheet/convert-sheet.tsx` | the moving convert's words |
| `src/components/sheet/sheet.tsx` | class items and the merge sheet |
| `src/components/sidebar.tsx`, `sidebar-classes.tsx` | classes in the course list, eye toggles, *Personal items* |
| `src/components/views/source-mark.tsx` | new: the shared glyph and "you" pip on chips |
| `src/components/views/week.tsx`, `month.tsx`, `table.tsx`, `stats.tsx` | by key, markers |
| `src/components/study/history.tsx`, `src/components/focus/focus-screen.tsx`, `src/components/sheet/session-sheet.tsx`, `achievement-sheet.tsx`, `import-sheet.tsx` | key space, effective lists |
| `docs/DATA-MODEL.md` | `marks`, `space_prefs`, `hidden_sources`, the new routes |
| Tests | new `test/marks-schema.test.js`, `test/old-clients.test.js`, `test/marks.test.js`, `test/class-layer.test.js`, `test/absorb.test.js`, `src/data/refs.test.ts`, `src/data/marks.test.ts`, `src/data/merge.test.ts`, `src/data/layer-actions.test.ts`, `src/components/sheet/class-item-sheet.test.tsx`, `src/components/sheet/layer.test.tsx`; changed `test/move-db.test.js`, `test/classes.test.js`, `test/sync.test.js`, `test/api-client.test.js`, `test/local-store.node.mjs`, `src/data/effective.test.ts`, `src/data/classes.test.ts`, `src/components/sheet/classes.test.tsx`, `src/components/sidebar.test.tsx` |

---

### Task 16: `marks` and `space_prefs` (migration 0004)

**Files:**
- Create: `migrations/0004_marks.sql`
- Create: `test/marks-schema.test.js`
- Modify: `scripts/lib/move-db.js`, `test/move-db.test.js`
- Modify: `scripts/lib/database-health.js`
- Modify: `worker/admin.js` (`LATEST_MIGRATION`), `worker/db.js` (`purgeTombstones`)
- Modify: `docs/DATA-MODEL.md`

- [ ] **Step 1: Write the failing schema test**

`test/marks-schema.test.js`:

```js
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createUser } from './helpers.js';
import { makeSpace, setMember } from './spaces.js';
import { purgeTombstones } from '../worker/db.js';
import { databaseChecks, databaseCountsSql, summarizeDatabase } from '../scripts/lib/database-health.js';

const FAILS = /CHECK constraint failed/;
/* Raw rows, so these tests see the schema's own rules and not the Worker's. */
function mark(userId, spaceId, itemId, cols = {}) {
  const row = { id: spaceId + ':' + itemId, space_id: spaceId, item_id: itemId, created_at: 1, updated_at: 1, ...cols };
  const names = Object.keys(row);
  return env.DB.prepare(`INSERT INTO marks (user_id, ${names.join(', ')}) VALUES (?, ${names.map(() => '?').join(', ')})`)
    .bind(userId, ...Object.values(row)).run();
}
function pref(userId, spaceId, cols = {}) {
  const row = { id: spaceId, space_id: spaceId, color: '#17B3AE', created_at: 1, updated_at: 1, ...cols };
  const names = Object.keys(row);
  return env.DB.prepare(`INSERT INTO space_prefs (user_id, ${names.join(', ')}) VALUES (?, ${names.map(() => '?').join(', ')})`)
    .bind(userId, ...Object.values(row)).run();
}
/* The migration's backfill statement, run again on rows made here. */
const backfill = () => env.TEST_MIGRATIONS.find((m) => m.name === '0004_marks.sql').queries.find((q) => q.includes('INSERT INTO space_prefs'));
const count = async (sql, ...binds) => (await env.DB.prepare(sql).bind(...binds).first()).n;

describe('marks and space prefs in the schema', () => {
  it("key a mark by '<space>:<item>' and hold it to the rules of the item's own columns", async () => {
    const a = await createUser('ms-a');
    const s = await makeSpace({ members: { [a]: 'member' } });
    await mark(a, s.id, 'a1', { status: 'graded', grade: 91, weight: 25, notes: 'mine', checklist: '[{"id":"x","text":"L1","done":true}]', hidden: 1 });
    await expect(mark(a, s.id, 'a2', { id: s.id + ':other' })).rejects.toThrow(FAILS);
    await expect(mark(a, 'short', 'a3')).rejects.toThrow(FAILS);
    await expect(mark(a, s.id, 'a4', { status: 'started' })).rejects.toThrow(FAILS);
    await expect(mark(a, s.id, 'a5', { grade: 101 })).rejects.toThrow(FAILS);
    await expect(mark(a, s.id, 'a6', { hidden: 2 })).rejects.toThrow(FAILS);
    await expect(mark(a, s.id, 'a7', { checklist: '{}' })).rejects.toThrow(FAILS);
    await expect(mark(a, s.id, 'a1')).rejects.toThrow(/UNIQUE constraint failed/);
  });

  it('keep one prefs row per person and space, in the twelve course colours', async () => {
    const b = await createUser('ms-b');
    const s = await makeSpace({ members: { [b]: 'member' } });
    await expect(pref(b, s.id, { id: 'otherspace01' })).rejects.toThrow(FAILS);
    await expect(pref(b, s.id, { color: '#000000' })).rejects.toThrow(FAILS);
    await expect(pref(b, s.id, { target: 0 })).rejects.toThrow(FAILS);
    await expect(pref(b, s.id, { term: 'x'.repeat(41) })).rejects.toThrow(FAILS);
    await pref(b, s.id, { target: 80, term: 'Fall 2026', archived: 1 });
    await expect(pref(b, s.id)).rejects.toThrow(/UNIQUE constraint failed/);
  });

  it("write every change into the person's own feed, never the space's", async () => {
    const c = await createUser('ms-c');
    const s = await makeSpace({ members: { [c]: 'member' } });
    await mark(c, s.id, 'q1', { hidden: 1 });
    await pref(c, s.id);
    const feed = () => env.DB.prepare("SELECT scope, kind, row_id, json_extract(payload, '$.hidden') AS hidden FROM changes WHERE kind IN ('marks', 'space_prefs') AND scope = ? ORDER BY kind").bind('u:' + c).all();
    expect((await feed()).results).toEqual([
      { scope: 'u:' + c, kind: 'marks', row_id: s.id + ':q1', hidden: 1 },
      { scope: 'u:' + c, kind: 'space_prefs', row_id: s.id, hidden: null },
    ]);
    await env.DB.prepare('UPDATE marks SET hidden = 0, revision = revision + 1 WHERE user_id = ?').bind(c).run();
    expect((await feed()).results[0].hidden).toBe(0);
    expect(await count("SELECT count(*) AS n FROM changes WHERE scope = ?", s.scope)).toBe(1);   /* only the class course */
  });

  it('count as tracked rows in the health checks, so their change rows are not orphans', async () => {
    const report = summarizeDatabase(await env.DB.batch([...databaseChecks.map((c) => env.DB.prepare(c.sql)), env.DB.prepare(databaseCountsSql)]));
    expect(report.checks.find((c) => c.name === 'Change-feed orphans').issues).toBe(0);
    expect(report.checks.find((c) => c.name === 'Change-feed record coverage').issues).toBe(0);
    expect(report.tables.map((t) => t.name)).toEqual(expect.arrayContaining(['marks', 'space_prefs']));
  });

  it('go with the account, and their tombstones with the nightly purge', async () => {
    const d = await createUser('ms-d'), e = await createUser('ms-e');
    const s = await makeSpace({ members: { [d]: 'member', [e]: 'member' } });
    await mark(d, s.id, 'a1');
    await pref(d, s.id);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM changes WHERE scope = 'u:' || ?").bind(d),
      env.DB.prepare('DELETE FROM users WHERE id = ?').bind(d),
    ]);
    expect(await count('SELECT count(*) AS n FROM marks WHERE user_id = ?', d) + await count('SELECT count(*) AS n FROM space_prefs WHERE user_id = ?', d)).toBe(0);
    await mark(e, s.id, 'a1', { deleted_at: 5 });
    await pref(e, s.id, { deleted_at: 5 });
    await purgeTombstones(env.DB, 10);
    expect(await count('SELECT count(*) AS n FROM marks WHERE user_id = ?', e) + await count('SELECT count(*) AS n FROM space_prefs WHERE user_id = ?', e)).toBe(0);
  });

  it("find a person's marks in a space by an index", async () => {
    const plan = await env.DB.prepare("EXPLAIN QUERY PLAN SELECT id FROM marks WHERE user_id = 'u' AND space_id = 's'").all();
    expect(plan.results.some((row) => /USING .*INDEX.*space_id=\?/.test(row.detail))).toBe(true);
  });

  it("backfill prefs for memberships made before the table: the class's colour unless used, else the first free; again changes nothing", async () => {
    const f = await createUser('ms-f'), g = await createUser('ms-g'), h = await createUser('ms-h');
    /* f already uses the class's colour on a course of their own */
    await env.DB.prepare("INSERT INTO courses (scope, id, code, name, color, created_at, updated_at) VALUES (?, 'mine', 'MY', 'Mine', '#17B3AE', 1, 1)").bind('u:' + f).run();
    const s = await makeSpace({ members: { [f]: 'owner', [g]: 'member', [h]: 'member' } });
    await env.DB.prepare("UPDATE courses SET term = 'Fall 2026' WHERE scope = ?").bind(s.scope).run();
    await setMember(s.id, h, null);
    await env.DB.prepare(backfill()).run();
    const rows = async () => (await env.DB.prepare('SELECT user_id, color, target, term, archived FROM space_prefs WHERE space_id = ? ORDER BY user_id').bind(s.id).all()).results;
    expect(await rows()).toEqual([
      { user_id: f, color: '#E4749B', target: null, term: 'Fall 2026', archived: 0 },
      { user_id: g, color: '#17B3AE', target: null, term: 'Fall 2026', archived: 0 },
    ]);
    await env.DB.prepare('UPDATE space_prefs SET color = ? WHERE user_id = ? AND id = ?').bind('#4F74D9', g, s.id).run();
    await env.DB.prepare(backfill()).run();
    expect((await rows()).map((r) => r.color)).toEqual(['#E4749B', '#4F74D9']);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run test/marks-schema.test.js`
Expected: FAIL with `no such table: marks`.

- [ ] **Step 3: Write the migration**

`migrations/0004_marks.sql`:

```sql
-- Your layer on a shared class or project (spec §3, §4). Your status, grade, weight
-- override, checklist, notes and "not mine" on a shared item live in `marks`; your colour,
-- grade target, semester and "archived in my sidebar" for a space in `space_prefs`. Each
-- belongs to one person, is read only with their user id, and writes its changes into that
-- person's own feed ('u:' || user_id), so no other member's sync ever pages it. One text id
-- each, like every other personal row: a mark's is '<space id>:<item id>', a prefs row's the
-- space id. Deleting an account deletes both.

CREATE TABLE marks (
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id            TEXT NOT NULL CHECK (length(id) <= 40 AND id = space_id || ':' || item_id),
  space_id      TEXT NOT NULL CHECK (length(space_id) = 12 AND space_id NOT GLOB '*[^a-z0-9]*'),
  item_id       TEXT NOT NULL CHECK (length(item_id) BETWEEN 1 AND 24),
  status        TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'submitted', 'graded', 'done', 'missed')),
  grade         REAL CHECK (grade IS NULL OR grade BETWEEN 0 AND 100),
  -- Your weight for the item, when it differs from the class's; NULL uses the class's.
  weight        REAL CHECK (weight IS NULL OR weight BETWEEN 0 AND 100),
  notes         TEXT NOT NULL DEFAULT '' CHECK (length(notes) <= 5000),
  -- [{id, text, done}], at most 50: exam prep's topics on a class exam.
  checklist     TEXT NOT NULL DEFAULT '[]'
                CHECK (json_valid(checklist) AND json_type(checklist) = 'array' AND json_array_length(checklist) <= 50),
  completed_at  INTEGER,
  -- "Not mine": left out of your views, grades and stats until shown again.
  hidden        INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  deleted_at    INTEGER,
  revision      INTEGER NOT NULL DEFAULT 1 CHECK (typeof(revision) = 'integer' AND revision > 0),
  PRIMARY KEY (user_id, id),
  -- One mark per person and item; also "my marks in a space" (detach, revocation).
  UNIQUE (user_id, space_id, item_id)
);
CREATE INDEX marks_deleted ON marks (deleted_at) WHERE deleted_at IS NOT NULL;

CREATE TABLE space_prefs (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id          TEXT NOT NULL CHECK (id = space_id),
  space_id    TEXT NOT NULL CHECK (length(space_id) = 12 AND space_id NOT GLOB '*[^a-z0-9]*'),
  -- Your colour for the space: one of the twelve course colours.
  color       TEXT NOT NULL CHECK (color IN ('#E4749B', '#8B5CC7', '#17B3AE', '#79B6EA', '#BCA6E6',
                                              '#F08A6C', '#E8B33A', '#4FBF8B', '#8FAE86', '#4F74D9', '#B8457E', '#7D8A99')),
  target      INTEGER CHECK (target IS NULL OR (typeof(target) = 'integer' AND target BETWEEN 1 AND 100)),
  -- Your semester for a class ('' is every semester), as a course's own term is.
  term        TEXT NOT NULL DEFAULT '' CHECK (length(term) <= 40),
  archived    INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER,
  revision    INTEGER NOT NULL DEFAULT 1 CHECK (typeof(revision) = 'integer' AND revision > 0),
  PRIMARY KEY (user_id, id)
);
CREATE INDEX space_prefs_deleted ON space_prefs (deleted_at) WHERE deleted_at IS NOT NULL;

CREATE TRIGGER marks_change_insert AFTER INSERT ON marks BEGIN
 DELETE FROM changes WHERE scope = 'u:' || NEW.user_id AND kind = 'marks' AND row_id = NEW.id;
 INSERT INTO changes(scope, kind, row_id, payload, deleted_at)
 VALUES('u:' || NEW.user_id, 'marks', NEW.id, json_object('user_id', NEW.user_id, 'id', NEW.id, 'space_id', NEW.space_id, 'item_id', NEW.item_id, 'status', NEW.status, 'grade', NEW.grade, 'weight', NEW.weight, 'notes', NEW.notes, 'checklist', NEW.checklist, 'completed_at', NEW.completed_at, 'hidden', NEW.hidden, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at, 'deleted_at', NEW.deleted_at, 'revision', NEW.revision), NEW.deleted_at);
END;
CREATE TRIGGER marks_change_update AFTER UPDATE ON marks BEGIN
 DELETE FROM changes WHERE scope = 'u:' || NEW.user_id AND kind = 'marks' AND row_id = NEW.id;
 INSERT INTO changes(scope, kind, row_id, payload, deleted_at)
 VALUES('u:' || NEW.user_id, 'marks', NEW.id, json_object('user_id', NEW.user_id, 'id', NEW.id, 'space_id', NEW.space_id, 'item_id', NEW.item_id, 'status', NEW.status, 'grade', NEW.grade, 'weight', NEW.weight, 'notes', NEW.notes, 'checklist', NEW.checklist, 'completed_at', NEW.completed_at, 'hidden', NEW.hidden, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at, 'deleted_at', NEW.deleted_at, 'revision', NEW.revision), NEW.deleted_at);
END;

CREATE TRIGGER space_prefs_change_insert AFTER INSERT ON space_prefs BEGIN
 DELETE FROM changes WHERE scope = 'u:' || NEW.user_id AND kind = 'space_prefs' AND row_id = NEW.id;
 INSERT INTO changes(scope, kind, row_id, payload, deleted_at)
 VALUES('u:' || NEW.user_id, 'space_prefs', NEW.id, json_object('user_id', NEW.user_id, 'id', NEW.id, 'space_id', NEW.space_id, 'color', NEW.color, 'target', NEW.target, 'term', NEW.term, 'archived', NEW.archived, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at, 'deleted_at', NEW.deleted_at, 'revision', NEW.revision), NEW.deleted_at);
END;
CREATE TRIGGER space_prefs_change_update AFTER UPDATE ON space_prefs BEGIN
 DELETE FROM changes WHERE scope = 'u:' || NEW.user_id AND kind = 'space_prefs' AND row_id = NEW.id;
 INSERT INTO changes(scope, kind, row_id, payload, deleted_at)
 VALUES('u:' || NEW.user_id, 'space_prefs', NEW.id, json_object('user_id', NEW.user_id, 'id', NEW.id, 'space_id', NEW.space_id, 'color', NEW.color, 'target', NEW.target, 'term', NEW.term, 'archived', NEW.archived, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at, 'deleted_at', NEW.deleted_at, 'revision', NEW.revision), NEW.deleted_at);
END;

-- Stage 3 made memberships before this table existed (its plan, Decision 3). Each live
-- membership of a live class gets the prefs a join writes from now on (worker/spaces.js
-- joinPrefs): the class course's colour unless the person already uses it on a course of
-- their own, else the first of the twelve they do not use; the class's term. Run again, it
-- leaves a prefs row already there as it is.
INSERT INTO space_prefs (user_id, id, space_id, color, target, term, archived, created_at, updated_at, revision)
SELECT m.user_id, m.space_id, m.space_id,
  COALESCE(
    (SELECT c.color FROM courses AS c WHERE c.scope = 'c:' || m.space_id AND c.deleted_at IS NULL
      AND c.color NOT IN (SELECT u.color FROM courses AS u WHERE u.scope = 'u:' || m.user_id AND u.deleted_at IS NULL AND u.archived = 0)),
    (SELECT p.value FROM json_each('["#E4749B","#8B5CC7","#17B3AE","#79B6EA","#BCA6E6","#F08A6C","#E8B33A","#4FBF8B","#8FAE86","#4F74D9","#B8457E","#7D8A99"]') AS p
      WHERE p.value NOT IN (SELECT u.color FROM courses AS u WHERE u.scope = 'u:' || m.user_id AND u.deleted_at IS NULL AND u.archived = 0)
      ORDER BY p.key LIMIT 1),
    (SELECT c.color FROM courses AS c WHERE c.scope = 'c:' || m.space_id LIMIT 1),
    '#17B3AE'),
  NULL,
  COALESCE((SELECT c.term FROM courses AS c WHERE c.scope = 'c:' || m.space_id AND c.deleted_at IS NULL LIMIT 1), ''),
  0,
  CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER),
  CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER),
  COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'changes'), 0) + 1
FROM members AS m JOIN spaces AS s ON s.id = m.space_id
WHERE m.deleted_at IS NULL AND s.deleted_at IS NULL AND s.kind = 'class'
  AND NOT EXISTS (SELECT 1 FROM space_prefs AS q WHERE q.user_id = m.user_id AND q.id = m.space_id);
```

- [ ] **Step 4: The purge and the health checks know both tables**

In `worker/db.js`, in `purgeTombstones`, replace

```js
    ...['achievements', 'study_sessions', 'items', 'quotes', 'courses'].map((table) =>
```

with

```js
    /* marks and prefs here are only tombstones; Stage 5 detaches meaningful marks first (spec §13) */
    ...['marks', 'space_prefs', 'achievements', 'study_sessions', 'items', 'quotes', 'courses'].map((table) =>
```

In `scripts/lib/database-health.js`, replace

```js
const trackerTables = ['courses', 'items', 'quotes', 'study_sessions', 'achievements'];
```

with

```js
const trackerTables = ['courses', 'items', 'quotes', 'study_sessions', 'achievements', 'marks', 'space_prefs'];
```

- [ ] **Step 5: Run the schema test**

Run: `npx vitest run test/marks-schema.test.js`
Expected: PASS (7 tests).

- [ ] **Step 6: See the move and admin tests fail**

Run: `npx vitest run test/move-db.test.js test/admin.test.js`
Expected: FAIL. In `move-db`, "names every source column the copy would leave behind" lists `marks.user_id`, …, `space_prefs.user_id`, …; in `admin`, the migrations check expects `0003_invites.sql` and finds `0004_marks.sql`.

- [ ] **Step 7: Add a move test for a source made before the tables**

Append to `test/move-db.test.js`:

```js
it('reads marks and space prefs as empty from a database made before them, and copies them after users', async () => {
  const queries = new Map(readQueries(await columns(env.MIGRATION_DB)));
  expect((await env.MIGRATION_DB.prepare(queries.get('marks')).all()).results).toEqual([]);
  expect((await env.MIGRATION_DB.prepare(queries.get('space_prefs')).all()).results).toEqual([]);
  const sql = copyStatements({
    users: [{ id: 'ana', username: 'ana' }],
    marks: [{ user_id: 'ana', id: 'abcdefghij12:a1', space_id: 'abcdefghij12', item_id: 'a1', status: 'done', grade: null, weight: null, notes: '', checklist: '[]', completed_at: 5, hidden: 0, created_at: 1, updated_at: 1, deleted_at: null, revision: 3 }],
    space_prefs: [{ user_id: 'ana', id: 'abcdefghij12', space_id: 'abcdefghij12', color: '#17B3AE', target: null, term: '', archived: 0, created_at: 1, updated_at: 1, deleted_at: null, revision: 4 }],
  });
  expect(sql.filter((s) => s.startsWith('INSERT INTO ')).map((s) => s.split(' ')[2]).slice(0, 3)).toEqual(['users', 'marks', 'space_prefs']);
});
```

- [ ] **Step 8: Extend the copy and the latest migration**

In `scripts/lib/move-db.js`, in `TABLES`, after the `achievements: […],` line add:

```js
  marks: ['user_id', 'id', 'space_id', 'item_id', 'status', 'grade', 'weight', 'notes', 'checklist', 'completed_at', 'hidden', 'created_at', 'updated_at', 'deleted_at', 'revision'],
  space_prefs: ['user_id', 'id', 'space_id', 'color', 'target', 'term', 'archived', 'created_at', 'updated_at', 'deleted_at', 'revision'],
```

and replace

```js
/* Tables added after rounds-v7's first schema (0002_spaces.sql, 0003_invites.sql): a database
   made before them has none of their rows. */
const ADDED_TABLES = new Set(['spaces', 'members', 'invites']);
```

with

```js
/* Tables added after rounds-v7's first schema (0002_spaces.sql, 0003_invites.sql,
   0004_marks.sql): a database made before them has none of their rows. */
const ADDED_TABLES = new Set(['spaces', 'members', 'invites', 'marks', 'space_prefs']);
```

(`ORDER_BY` has no entry for either, so both read in `user_id, id` order.)

In `worker/admin.js`, replace `export const LATEST_MIGRATION = '0003_invites.sql';` with `export const LATEST_MIGRATION = '0004_marks.sql';`.

- [ ] **Step 9: Run the four files and the health tests**

Run: `npx vitest run test/marks-schema.test.js test/move-db.test.js test/admin.test.js test/database-health.test.js test/purge.test.js`
Expected: PASS.

- [ ] **Step 10: Document the tables**

In `docs/DATA-MODEL.md`, insert before the line `## Indexes`:

```markdown
## `marks`

`(user_id, id)`, `id = '<space id>:<item id>'`, unique `(user_id, space_id, item_id)`: your layer on one shared item (spec §4). `status`, `grade`, `weight` (an override; NULL uses the class's), `notes`, `checklist` (exam prep's topics), `completed_at`, `hidden` ("not mine": out of your views, grades and stats), timestamps, `deleted_at`, `revision`. Same `CHECK`s as the matching `items` columns. On a project's item only `notes` and `hidden` are used. Its changes go into your own feed (`'u:' || user_id`). Written through `/api/marks/:sid/:itemId` with a field-level merge, and by the convert and absorb batches. Deleted with the account.

## `space_prefs`

`(user_id, id)`, `id = space_id`: your settings for one space: `color` (one of the twelve), `target`, `term` (your semester for a class; `''` is every semester), `archived` (in your sidebar), timestamps, `deleted_at`, `revision`. Written by the Worker when you make, convert, accept or join (the class's colour unless you use it, else the first free; its term), then through `/api/space_prefs/:sid` with whole-row `If-Match`. Its changes go into your own feed. Deleted with the account.

```

In the `users` table's section of the same file, after the paragraph that describes `hidden_sources` (or, if none does, at the end of the `users` section), make sure this sentence is there:

```markdown
`hidden_sources`: what you have hidden from your Week and Month (and, from Stage 6, your calendar feed): `course:<id>`, `space:<sid>`, `personal`; at most 40. Sent and received as the profile's `hiddenSources`; a `PUT /api/me` without it keeps it.
```

- [ ] **Step 11: Commit**

```bash
git add migrations/0004_marks.sql test/marks-schema.test.js scripts/lib/move-db.js test/move-db.test.js scripts/lib/database-health.js worker/admin.js worker/db.js docs/DATA-MODEL.md
git commit -m "Marks and space prefs: migration 0004 with the prefs backfill, copied by the move, purged, health-checked

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JpUR1JXMY3ehtkiJwuij95"
npm run build
```

---

### Task 17: Old clients, the labels on your own rows, and hidden sources

**Files:**
- Modify: `worker/validate.js`, `worker/db.js`
- Create: `test/old-clients.test.js`

- [ ] **Step 1: Write the failing test**

`test/old-clients.test.js`:

```js
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { signIn } from './helpers.js';

const SID = 'abcdefghij12';
const item = (over = {}) => ({ type: 'quiz', title: 'Quiz 1', courseId: null, date: '2026-10-01', status: 'todo', ...over });
const session = (over = {}) => ({ courseId: 'web', itemId: null, startedAt: 1_790_000_000_000, studyMinutes: 30, ...over });
const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const profile = { coat: { name: '', role: '', color: '#E4749B' }, theme: 'dark', termStart: null, displayName: '' };

describe('a client from before Stage 4', () => {
  it('pages only the five kinds it knows on v2, and still reaches the head', async () => {
    const api = await signIn('old-v2');
    expect((await api('/api/items/q1', { method: 'PUT', body: item() })).status).toBe(200);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO marks (user_id, id, space_id, item_id, created_at, updated_at) VALUES ('u-old-v2', ?, ?, 'x', 1, 1)").bind(SID + ':x', SID),
      env.DB.prepare("INSERT INTO space_prefs (user_id, id, space_id, color, created_at, updated_at) VALUES ('u-old-v2', ?, ?, '#17B3AE', 1, 1)").bind(SID, SID),
    ]);
    const page = await (await api('/api/sync?v=2&cursor=0')).json();
    expect(page.changes.map((c) => c.kind)).toEqual(['items']);
    const { head } = await env.DB.prepare("SELECT seq AS head FROM sqlite_sequence WHERE name = 'changes'").first();
    expect(page.cursor).toBe(head);
  });

  it("keeps an item's class label when the body leaves it out; the new client sets and clears it", async () => {
    const api = await signIn('old-label');
    expect((await api('/api/items/r1', { method: 'PUT', body: item() })).status).toBe(200);
    /* as a convert files it (Task 19); the revision is left alone, so the next PUT matches */
    await env.DB.prepare("UPDATE items SET class_id = ? WHERE scope = 'u:u-old-label' AND id = 'r1'").bind(SID).run();
    const kept = await (await api('/api/items/r1', { method: 'PUT', body: item({ title: 'Renamed' }) })).json();
    expect(kept).toMatchObject({ title: 'Renamed', classId: SID });
    const cleared = await (await api('/api/items/r1', { method: 'PUT', body: item({ classId: null }) })).json();
    expect(cleared.classId).toBeNull();
    const set = await (await api('/api/items/r1', { method: 'PUT', body: item({ classId: SID }) })).json();
    expect(set.classId).toBe(SID);
    expect(await (await api('/api/items/r2', { method: 'PUT', body: item({ classId: 'Not-A-Space' }) })).json()).toEqual({ error: 'invalid', field: 'classId' });
    await api('/api/courses/bio', { method: 'PUT', body: { code: 'BIO', name: 'Biology', color: '#17B3AE', meetings: [] } });
    expect(await (await api('/api/items/r3', { method: 'PUT', body: item({ classId: SID, courseId: 'bio' }) })).json()).toEqual({ error: 'invalid', field: 'classId' });
  });

  it("keeps a session's and an achievement's space when the body leaves it out", async () => {
    const api = await signIn('old-space');
    const s1 = await (await api('/api/study_sessions/s1', { method: 'PUT', body: session({ spaceId: SID }) })).json();
    expect(s1.spaceId).toBe(SID);
    const s2 = await (await api('/api/study_sessions/s1', { method: 'PUT', body: session({ studyMinutes: 45 }) })).json();
    expect(s2).toMatchObject({ studyMinutes: 45, spaceId: SID });
    expect((await (await api('/api/achievements/a1', { method: 'PUT', body: { name: 'Web', sticker: PNG, rule: 'hours', courseId: 'web', target: 10, spaceId: SID } })).json()).spaceId).toBe(SID);
    const a2 = await (await api('/api/achievements/a1', { method: 'PUT', body: { name: 'Web 2', sticker: PNG, rule: 'hours', courseId: 'web', target: 10 } })).json();
    expect(a2).toMatchObject({ name: 'Web 2', spaceId: SID });
    expect(await (await api('/api/study_sessions/s2', { method: 'PUT', body: session({ spaceId: 7 }) })).json()).toEqual({ error: 'invalid', field: 'spaceId' });
  });

  it('keeps the hidden sources when PUT /api/me leaves them out', async () => {
    const api = await signIn('old-hidden');
    expect((await (await api('/api/me')).json()).hiddenSources).toEqual([]);
    const set = await (await api('/api/me', { method: 'PUT', body: { ...profile, hiddenSources: ['personal', 'course:bio', 'space:' + SID] } })).json();
    expect(set.hiddenSources).toEqual(['personal', 'course:bio', 'space:' + SID]);
    const kept = await (await api('/api/me', { method: 'PUT', body: { ...profile, displayName: 'Old tab' } })).json();
    expect(kept).toMatchObject({ displayName: 'Old tab', hiddenSources: ['personal', 'course:bio', 'space:' + SID] });
    for (const bad of [['space:short'], ['personal', 'personal'], ['calendar'], Array.from({ length: 41 }, (_, i) => 'course:c' + i)]) {
      const res = await api('/api/me', { method: 'PUT', body: { ...profile, hiddenSources: bad } });
      expect(res.status).toBe(400);
    }
  });
});
```

(`signIn`'s fetch adds `If-Match` for `/api/items/…`, `/api/study_sessions/…`, `/api/achievements/…` and `/api/me` itself, from the last revision it saw at that path.)

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run test/old-clients.test.js`
Expected: FAIL: v2 returns `['items', 'marks', 'space_prefs']`; the item answers no `classId`; `/api/me` has no `hiddenSources`.

- [ ] **Step 3: Validate the labels and the hidden sources (`worker/validate.js`)**

Replace

```js
const COURSE_COLOURS = [...COLOURS, '#F08A6C', '#E8B33A', '#4FBF8B', '#8FAE86', '#4F74D9', '#B8457E', '#7D8A99'];
```

with

```js
export const COURSE_COLOURS = [...COLOURS, '#F08A6C', '#E8B33A', '#4FBF8B', '#8FAE86', '#4F74D9', '#B8457E', '#7D8A99'];
```

After the `list` function add:

```js
const SPACE_ID = /^[a-z0-9]{12}$/;
/* A label on your own row naming a space (spec §5): its shape only, since it opens nothing.
   Absent (an old client) is undefined, and the stored value stays (spec §16); null clears. */
function spaceLabel(v, field) {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== 'string' || !SPACE_ID.test(v)) fail(field);
  return v;
}

/* What you hid from your Week and Month (spec §9): 'course:<id>', 'space:<sid>', 'personal'. */
const SOURCE = /^(?:course:[^\u0000-\u001f\u007f]{1,24}|space:[a-z0-9]{12}|personal)$/;
function sourceList(v) {
  if (!Array.isArray(v) || v.length > 40) fail('hiddenSources');
  v.forEach((s, i) => { if (typeof s !== 'string' || !SOURCE.test(s)) fail(`hiddenSources[${i}]`); });
  if (new Set(v).size !== v.length) fail('hiddenSources');
  return v;
}
```

In `validateProfile`, after the line `    schoolCalendar: body.schoolCalendar === undefined ? null : schoolCalendar(body.schoolCalendar),` add:

```js
    // Nor hidden sources; the stored ones are kept (null here).
    hiddenSources: body.hiddenSources === undefined ? null : sourceList(body.hiddenSources),
```

In `validateItem`, after the line `    completedAt: optInt(body.completedAt, 'completedAt'),` add:

```js
    classId: spaceLabel(body.classId, 'classId'),
```

and after the line `  if (out.recur === 'weekly' && out.weekday === null) fail('weekday');` add:

```js
  // A personal item is under a course of yours or filed under a class, never both (the u: CHECK).
  if (out.classId && out.courseId) fail('classId');
```

In `validateStudySession`, after the line `    manual: bool(body.manual ?? false, 'manual'),` add `    spaceId: spaceLabel(body.spaceId, 'spaceId'),`. In `validateAchievement`, after the line `    target: int(body.target, 'target', 1, rule === 'grade' ? 100 : 1000),` add `    spaceId: spaceLabel(body.spaceId, 'spaceId'),`.

In `validateSharedItem`, a shared row never carries the label. Replace

```js
    return { ...out, status: 'todo', grade: null, checklist: [], completedAt: null, assignees: [] };
```

with

```js
    return { ...out, status: 'todo', grade: null, checklist: [], completedAt: null, assignees: [], classId: null };
```

and replace

```js
  return { ...out, assignees: assigneeList(body.assignees ?? []) };
```

with

```js
  return { ...out, assignees: assigneeList(body.assignees ?? []), classId: null };
```

- [ ] **Step 4: Keep what an old client leaves out, and page it only its kinds (`worker/db.js`)**

Replace the `PROFILE_COLS` constant with:

```js
const PROFILE_COLS =
  'id, username, display_name, coat_name, coat_role, coat_color, theme, bg, types, study_flow, study_prefs, school_calendar, hidden_sources, term_start, is_admin, created_at, updated_at, revision';
```

In `profileFromRow`, after the line `    schoolCalendar: prefsOut(r.school_calendar),` add:

```js
    hiddenSources: jsonOut(r.hidden_sources),
```

Replace the body of `updateProfile`'s statement and bind with:

```js
  const saved = await db
    .prepare(
      `UPDATE users SET display_name = ?, coat_name = ?, coat_role = ?, coat_color = ?, theme = ?, bg = ?, types = COALESCE(?, types), study_flow = COALESCE(?, study_flow), study_prefs = COALESCE(?, study_prefs), school_calendar = COALESCE(?, school_calendar), hidden_sources = COALESCE(?, hidden_sources), term_start = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND revision = ? RETURNING ${PROFILE_COLS}`,
    )
    .bind(p.displayName, p.coatName, p.coatRole, p.coatColor, p.theme, p.bg, p.types === null ? null : JSON.stringify(p.types), p.studyFlow ? JSON.stringify(p.studyFlow) : null, p.studyPrefs ? JSON.stringify(p.studyPrefs) : null, p.schoolCalendar ? JSON.stringify(p.schoolCalendar) : null, p.hiddenSources ? JSON.stringify(p.hiddenSources) : null, p.termStart, now, userId, revision ?? -1)
    .first();
```

In `TABLES`, replace the three `cols` lines of `items`, `study_sessions` and `achievements`:

```js
    cols: {
      type: 'type', title: 'title', courseId: 'course_id', date: 'date', start: 'start', end: 'end', where: 'location',
      status: 'status', grade: 'grade', weight: 'weight', notes: 'notes', checklist: 'checklist', links: 'links',
      recur: 'recur', weekday: 'weekday', recurUntil: 'recur_until', dept: 'dept', completedAt: 'completed_at',
      classId: 'class_id',
    },
```

```js
    cols: { courseId: 'course_id', itemId: 'item_id', startedAt: 'started_at', studyMinutes: 'study_minutes', roundsDone: 'rounds_done', note: 'note', manual: 'manual', spaceId: 'space_id' },
```

```js
    cols: { name: 'name', sticker: 'sticker', rule: 'rule', courseId: 'course_id', itemId: 'item_id', spaceId: 'space_id', target: 'target' },
```

After `const ACHIEVEMENT_LIMIT = 30;` add:

```js
/* Labels an old client never sends (spec §16): left out of a body, the stored value stays. */
const KEPT_WHEN_ABSENT = new Set(['classId', 'spaceId']);
```

In `upsertStmt`, replace the line

```js
  const cols = Object.entries(t.cols);
```

with

```js
  const cols = Object.entries(t.cols).filter(([field]) => !(KEPT_WHEN_ABSENT.has(field) && fields[field] === undefined));
```

In `syncPage` (v2), replace

```js
    db.prepare('SELECT seq, kind, payload FROM changes WHERE scope = ? AND seq > ? ORDER BY seq LIMIT ?').bind(personal(userId), cursor, limit + 1),
```

with

```js
    /* only the kinds a client from before Stage 4 knows (spec §16): marks and prefs never reach it */
    db.prepare(`SELECT seq, kind, payload FROM changes WHERE scope = ? AND seq > ? AND kind IN ('courses', 'items', 'quotes', 'study_sessions', 'achievements')
      ORDER BY seq LIMIT ?`).bind(personal(userId), cursor, limit + 1),
```

(A shared write's `sharedUpsertStmt` and `sharedFieldsStmt` build from the same `cols`: a shared row's `classId` is always `null` from `validateSharedItem`, which the `c:` and `p:` CHECKs require.)

- [ ] **Step 5: Run the test**

Run: `npx vitest run test/old-clients.test.js`
Expected: PASS (4 tests). (A v3 page of a scope holding marks would fail until Task 18 gives `rowToApi` their shape; nothing writes marks through the routes before then.)

- [ ] **Step 6: Run the Worker suite and fix whole-row expectations**

Run: `npm run test:api`
Expected: PASS. Rows now answer `classId` (items) and `spaceId` (sessions, achievements). If a test compares a whole personal row with `toEqual`, add `classId: null` to an item or `spaceId: null` to a session or achievement in its expected value (the files to look at: `test/rows.test.js`, `test/round-trips.test.js`, `test/study-sessions.test.js`, `test/custom-achievements.test.js`, `test/shared-rows.test.js`, `test/shared-routes.test.js`, `test/sync-v3.test.js`); nothing else changes.

- [ ] **Step 7: Commit**

```bash
git add worker/validate.js worker/db.js test/old-clients.test.js test/*.test.js
git commit -m "Old clients: v2 pages its five kinds; class and space labels and hidden sources kept when left out

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JpUR1JXMY3ehtkiJwuij95"
```

---

### Task 18: Your mark on a shared item, and your prefs for a space

**Files:**
- Modify: `src/core/shared.ts` (`SHARED_FIELDS.marks`, `MARK_DEFAULTS`)
- Modify: `worker/http.js` (`revisionOf`), `worker/api.js`
- Modify: `worker/validate.js` (`validateMark`, `validatePref`)
- Modify: `worker/db.js` (`marks`, `space_prefs` rows; a guard on personal upserts; `upsertMark`, `upsertPref`)
- Create: `worker/layer.js`
- Create: `test/marks.test.js`

- [ ] **Step 1: Write the failing test**

`test/marks.test.js`:

```js
import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { signIn } from './helpers.js';
import { makeSpace, sharedItem } from './spaces.js';

let me, other, outsider, s, p, a;
beforeAll(async () => {
  me = await signIn('mk-me'); other = await signIn('mk-other'); outsider = await signIn('mk-out');
  s = await makeSpace({ members: { 'u-mk-me': 'member', 'u-mk-other': 'owner' } });
  a = await makeSpace({ members: { 'u-mk-me': 'member' }, archived: 1 });
  p = await makeSpace({ kind: 'project', members: { 'u-mk-me': 'editor' } });
  await sharedItem(s.scope, 'a1', { course_id: 'web', weight: 20 });
  await sharedItem(s.scope, 'gone', { course_id: 'web', deleted_at: 5 });
  await sharedItem(a.scope, 'a1', { course_id: 'web' });
  await sharedItem(p.scope, 't1');
}, 60_000);

const at = (rev) => ({ 'if-match': `"${rev}"` });
const put = (api, sid, item, body, rev = 0) => api(`/api/marks/${sid}/${item}`, { method: 'PUT', body, headers: at(rev) });
const blank = { status: 'todo', grade: null, weight: null, notes: '', checklist: [], completedAt: null, hidden: false };

describe('your mark on a shared item', () => {
  it('is written by a member on a live item, kept as yours, and read back', async () => {
    const res = await put(me, s.id, 'a1', { ...blank, status: 'graded', grade: 87, notes: 'Teams of 3' });
    expect(res.status).toBe(200);
    const saved = await res.json();
    expect(saved).toMatchObject({ id: s.id + ':a1', spaceId: s.id, itemId: 'a1', status: 'graded', grade: 87, notes: 'Teams of 3', hidden: false });
    expect(await (await me(`/api/marks/${s.id}/a1`)).json()).toMatchObject({ grade: 87 });
    expect((await other(`/api/marks/${s.id}/a1`)).status).toBe(404);
  });

  it('is refused outside the space, on a deleted or missing item, and malformed', async () => {
    expect((await put(outsider, s.id, 'a1', blank)).status).toBe(404);
    expect((await put(me, s.id, 'gone', blank)).status).toBe(404);
    expect((await put(me, s.id, 'nope', blank)).status).toBe(404);
    expect(await (await put(me, s.id, 'a1', { ...blank, grade: 120 })).json()).toEqual({ error: 'invalid', field: 'grade' });
    expect(await (await put(me, s.id, 'a1', { ...blank, status: 'started' })).json()).toEqual({ error: 'invalid', field: 'status' });
  });

  it('still saves in an archived class; on a project item only your notes and hidden', async () => {
    expect((await put(me, a.id, 'a1', { ...blank, status: 'done' })).status).toBe(200);
    expect(await (await put(me, p.id, 't1', { ...blank, status: 'done' })).json()).toEqual({ error: 'invalid', field: 'status' });
    expect((await put(me, p.id, 't1', { ...blank, notes: 'Ask Sam', hidden: true })).status).toBe(200);
  });

  it("merges two devices' first marks on one item field by field; the same field differing conflicts", async () => {
    await sharedItem(s.scope, 'b1', { course_id: 'web' });
    const first = await (await put(me, s.id, 'b1', { ...blank, notes: 'from the phone' })).json();
    const second = await put(me, s.id, 'b1', { ...blank, status: 'done', completedAt: 5, changed: { status: null, completedAt: null } });
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ notes: 'from the phone', status: 'done', completedAt: 5, revision: first.revision + 1 });
    const clash = await put(me, s.id, 'b1', { ...blank, notes: 'from the laptop', changed: { notes: null } });
    expect(clash.status).toBe(409);
    expect(await clash.json()).toMatchObject({ error: 'conflict', fields: ['notes'], current: { notes: 'from the phone' } });
  });

  it('writes the whole mark at its revision, and merges a stale edit onto the newer one', async () => {
    await sharedItem(s.scope, 'c1', { course_id: 'web' });
    const v1 = await (await put(me, s.id, 'c1', { ...blank, grade: 70, status: 'graded' })).json();
    const v2 = await (await put(me, s.id, 'c1', { ...v1, weight: 30 }, v1.revision)).json();
    const merged = await put(me, s.id, 'c1', { ...v1, notes: 'retake', changed: { notes: '' } }, v1.revision);
    expect(await merged.json()).toMatchObject({ weight: 30, notes: 'retake', grade: 70, revision: v2.revision + 1 });
    expect((await put(me, s.id, 'c1', { ...v1, grade: 10 }, v1.revision)).status).toBe(409);
    expect((await me(`/api/marks/${s.id}/c1`, { method: 'DELETE', headers: at(v2.revision + 1) })).status).toBe(204);
    expect((await me(`/api/marks/${s.id}/c1`)).status).toBe(404);
  });
});

describe('your prefs for a space', () => {
  const pref = { color: '#4F74D9', target: 85, term: 'Fall 2026', archived: false };
  it('are written whole by a member at a revision, and refused to anyone else', async () => {
    expect((await outsider(`/api/space_prefs/${s.id}`, { method: 'PUT', body: pref, headers: at(0) })).status).toBe(404);
    const v1 = await (await me(`/api/space_prefs/${s.id}`, { method: 'PUT', body: pref, headers: at(0) })).json();
    expect(v1).toMatchObject({ id: s.id, spaceId: s.id, color: '#4F74D9', target: 85, term: 'Fall 2026', archived: false });
    expect((await me(`/api/space_prefs/${s.id}`, { method: 'PUT', body: { ...pref, archived: true }, headers: at(0) })).status).toBe(409);
    const v2 = await (await me(`/api/space_prefs/${s.id}`, { method: 'PUT', body: { ...pref, archived: true }, headers: at(v1.revision) })).json();
    expect(v2.archived).toBe(true);
    expect(await (await me(`/api/space_prefs/${s.id}`, { method: 'PUT', body: { ...pref, color: '#000000' }, headers: at(v2.revision) })).json()).toEqual({ error: 'invalid', field: 'color' });
    expect(await (await me(`/api/space_prefs/${s.id}`)).json()).toMatchObject({ archived: true });
  });
});

describe('sync', () => {
  it("pages your marks and prefs in your own scope, and never another member's", async () => {
    const mine = await (await me('/api/sync?v=3&cursors=')).json();
    expect(mine.changes.filter((c) => c.scope === 'u:u-mk-me' && c.kind === 'marks').map((c) => c.row.id)).toContain(s.id + ':a1');
    expect(mine.changes.find((c) => c.kind === 'marks' && c.row.id === s.id + ':a1').row).toMatchObject({ grade: 87, hidden: false, checklist: [] });
    expect(mine.changes.some((c) => c.kind === 'space_prefs' && c.row.id === s.id)).toBe(true);
    const theirs = await (await other('/api/sync?v=3&cursors=')).json();
    expect(theirs.changes.some((c) => c.kind === 'marks' || c.kind === 'space_prefs')).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run test/marks.test.js`
Expected: FAIL: `PUT /api/marks/…` answers `404 not_found` (no route).

- [ ] **Step 3: What both sides agree on (`src/core/shared.ts`)**

In `SHARED_FIELDS`, after the `project: [...]` line add:

```ts
  /* your mark: written with a field-level merge too, since two of your devices can both make it (spec §6) */
  marks: ['status', 'grade', 'weight', 'notes', 'checklist', 'completedAt', 'hidden'],
```

After the `stable` function add:

```ts
/** What each field of a mark holds before you touch the item: what a first write merges against. */
export const MARK_DEFAULTS: Record<string, unknown> = { status: 'todo', grade: null, weight: null, notes: '', checklist: [], completedAt: null, hidden: false }
```

Replace `fieldSetOf` with:

```ts
/** The field set of a shared row (its course's, a class item's or a project item's), or of a mark. */
export const fieldSetOf = (store: string, scope: string): FieldSet =>
  store === 'marks' ? 'marks' : store === 'shared_courses' || store === 'courses' ? 'courses' : scope.startsWith('p:') ? 'project' : 'class'
```

- [ ] **Step 4: `revisionOf` moves to `worker/http.js`**

Append to `worker/http.js`:

```js

/** A write's `If-Match: "<revision>"`: 428 without one (a client from before revisions), 400 when malformed. */
export function revisionOf(request) {
  const raw = request.headers.get('if-match');
  if (raw === null) throw new HttpError(428, { error: 'reload_required' });
  if (!/^"\d{1,16}"$/.test(raw) || !Number.isSafeInteger(Number(raw.slice(1, -1)))) throw new HttpError(400, { error: 'invalid', field: 'revision' });
  return Number(raw.slice(1, -1));
}
```

In `worker/api.js`, delete the whole `function revisionOf(request) { … }` (the six lines at the top) and replace `import { json, readJson, readBytes, HttpError } from './http.js';` with `import { json, readJson, readBytes, revisionOf, HttpError } from './http.js';`.

- [ ] **Step 5: The validators (`worker/validate.js`)**

Replace `import { SHARED_FIELDS } from '../src/core/shared.ts';` with `import { MARK_DEFAULTS, SHARED_FIELDS, stable } from '../src/core/shared.ts';` and append:

```js

/**
 * Your mark on a shared item (spec §3, §4). On a project's item the status and checklist are
 * the team's, and it carries no grade or weight: only your notes and hidden may be set.
 */
export function validateMark(body, kind) {
  obj(body, 'body');
  const out = {
    status: oneOf(body.status ?? 'todo', 'status', STATUSES),
    grade: optNum(body.grade, 'grade', 0, 100),
    weight: optNum(body.weight, 'weight', 0, 100),
    notes: str(body.notes ?? '', 'notes', 5000),
    checklist: list(body.checklist ?? [], 'checklist', 50, checklistEntry),
    completedAt: optInt(body.completedAt, 'completedAt'),
    hidden: bool(body.hidden ?? false, 'hidden'),
  };
  if (kind === 'project') {
    for (const f of ['status', 'grade', 'weight', 'checklist', 'completedAt']) if (stable(out[f]) !== stable(MARK_DEFAULTS[f])) fail(f);
  }
  return out;
}

/** Your prefs for a space: a colour of the twelve, a target, your semester, archived in your sidebar. */
export function validatePref(body) {
  obj(body, 'body');
  return {
    color: oneOf(body.color, 'color', COURSE_COLOURS),
    target: body.target === null || body.target === undefined ? null : int(body.target, 'target', 1, 100),
    term: str(body.term ?? '', 'term', 40),
    archived: bool(body.archived ?? false, 'archived'),
  };
}
```

- [ ] **Step 6: The rows (`worker/db.js`)**

Replace `import { stable } from '../src/core/shared.ts';` with `import { MARK_DEFAULTS, stable } from '../src/core/shared.ts';`.

In `TABLES`, after the `achievements: { … },` entry add:

```js
  marks: {
    cols: { spaceId: 'space_id', itemId: 'item_id', status: 'status', grade: 'grade', weight: 'weight', notes: 'notes', checklist: 'checklist', completedAt: 'completed_at', hidden: 'hidden' },
    toRow: (m) => ({ ...m, checklist: jsonIn(m.checklist), hidden: m.hidden ? 1 : 0 }),
    fromRow: (r) => ({ checklist: jsonOut(r.checklist), hidden: r.hidden === 1 }),
  },
  space_prefs: {
    cols: { spaceId: 'space_id', color: 'color', target: 'target', term: 'term', archived: 'archived' },
    toRow: (p) => ({ ...p, archived: p.archived ? 1 : 0 }),
    fromRow: (r) => ({ archived: r.archived === 1, target: r.target ?? null }),
  },
```

Give `upsertStmt` an optional guard. Replace its signature line `function upsertStmt(db, table, userId, id, fields, now, revision) {` with `function upsertStmt(db, table, userId, id, fields, now, revision, guard = null) {`, and replace its `return db` … `.bind(...values, revision, who, id, ...courseBindings, ...capBindings, revision);` with:

```js
  /* a row of your layer goes only where you may keep one (layer.js): the guard runs inside the write */
  const extra = guard ? ` AND ${guard.sql}` : '';
  return db
    .prepare(
      `INSERT INTO ${table} (${names.join(', ')}, revision) SELECT ${names.map(() => '?').join(', ')}, COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'changes'), 0) + 1 WHERE (? = 0 OR EXISTS (SELECT 1 FROM ${table} WHERE ${owner} = ? AND id = ?))${courseGuard}${capGuard}${extra}
       ON CONFLICT (${owner}, id) DO UPDATE SET ${updates.join(', ')} WHERE revision = ?
       RETURNING ${selectCols(table)}`,
    )
    .bind(...values, revision, who, id, ...courseBindings, ...capBindings, ...(guard ? guard.binds : []), revision);
```

Give `upsertRow` the same guard. Replace its first two lines

```js
export async function upsertRow(db, table, userId, id, fields, now = Date.now(), revision = 0) {
  const saved = await upsertStmt(db, table, userId, id, fields, now, revision).first();
  if (saved) return rowToApi(table, saved);
```

with

```js
export async function upsertRow(db, table, userId, id, fields, now = Date.now(), revision = 0, guard = null) {
  const saved = await upsertStmt(db, table, userId, id, fields, now, revision, guard).first();
  if (saved) return rowToApi(table, saved);
  if (guard && !(await passes(db, guard))) throw new HttpError(404, { error: 'not_found' });
```

and after `const courseStmt = …;` add:

```js
/* Whether a guard holds now: a write it refused was refused for access, not a revision. */
const passes = async (db, guard) => (await db.prepare(`SELECT ${guard.sql} AS ok`).bind(...guard.binds).first()).ok === 1;
```

Then append this section before `// ── Spotify`:

```js
// ── your layer: marks and space prefs (spec §4) ────────────────────────────
// Your own rows, read and written with your user id. A mark goes only on a live item of a
// space you are a live member of (archived or not: your layer still saves), and merges field
// by field like a shared row, since two of your devices may both make it. Prefs need a live
// membership and are whole-row If-Match, like your other rows.

/* A live member of the space, on a live item of it; the binds are the space, you, the space twice, the item. */
function markGuard(spaceId, itemId, userId) {
  const g = memberGuard(spaceId, userId);
  return {
    sql: `${g.sql} AND EXISTS (SELECT 1 FROM items WHERE scope IN ('c:' || ?, 'p:' || ?) AND id = ? AND deleted_at IS NULL)`,
    binds: [...g.binds, spaceId, spaceId, itemId],
  };
}

/**
 * Your mark on `itemId` of `spaceId` (spec §6 Push): the whole mark at its revision; else the
 * fields named in `changed` merged onto the current one when each still holds its old or its
 * new value (a first write merges against MARK_DEFAULTS), with one retry on a lost race; else
 * 409 {current, fields}. 404 when you may not keep a mark there.
 */
export async function upsertMark(db, userId, spaceId, itemId, fields, { revision = 0, changed, now = Date.now() } = {}) {
  const id = spaceId + ':' + itemId, row = { ...fields, spaceId, itemId }, guard = markGuard(spaceId, itemId, userId);
  const saved = await upsertStmt(db, 'marks', userId, id, row, now, revision, guard).first();
  if (saved) return rowToApi('marks', saved);
  const t = TABLES.marks;
  for (let attempt = 0; ; attempt++) {
    if (!(await passes(db, guard))) throw new HttpError(404, { error: 'not_found' });
    const current = await getRow(db, 'marks', userId, id);
    if (!current || current.deletedAt || !changed) throw conflict(current, changed && Object.keys(changed));
    const keys = Object.keys(changed);
    const old = (f) => (revision === 0 ? MARK_DEFAULTS[f] : changed[f]);
    const unsafe = keys.filter((f) => stable(current[f]) !== stable(old(f)) && stable(current[f]) !== stable(row[f]));
    if (unsafe.length) throw conflict(current, unsafe);
    const write = keys.filter((f) => stable(current[f]) !== stable(row[f]));
    if (!write.length) return current;
    const values = t.toRow(row);
    const merged = await db.prepare(`UPDATE marks SET ${write.map((f) => `${t.cols[f]} = ?`).join(', ')}, updated_at = ?, revision = revision + 1
      WHERE user_id = ? AND id = ? AND revision = ? AND deleted_at IS NULL AND ${guard.sql} RETURNING ${selectCols('marks')}`)
      .bind(...write.map((f) => values[f] ?? null), now, userId, id, current.revision, ...guard.binds).first();
    if (merged) return rowToApi('marks', merged);
    if (attempt) throw conflict(await getRow(db, 'marks', userId, id), keys);
  }
}

/** Your prefs for a space you are in, written whole at `revision`; 404 outside it. */
export function upsertPref(db, userId, spaceId, fields, now = Date.now(), revision = 0) {
  return upsertRow(db, 'space_prefs', userId, spaceId, { ...fields, spaceId }, now, revision, memberGuard(spaceId, userId));
}
```

- [ ] **Step 7: The routes (`worker/layer.js`)**

```js
// Your layer on a space (spec §4, §14): your mark on one of its items, and your prefs for
// it. Both are yours alone: read and written with your user id, and synced in your own
// scope. Deleting either is always yours to do.
import { json, readJson, revisionOf, HttpError } from './http.js';
import { requireUser } from './auth.js';
import { roleOf } from './access.js';
import { validateChanged, validateId, validateMark, validatePref } from './validate.js';
import { deleteRow, getRow, upsertMark, upsertPref } from './db.js';

const MARK = /^\/api\/marks\/([a-z0-9]{12})\/([^/]+)$/;
const PREF = /^\/api\/space_prefs\/([a-z0-9]{12})$/;
const done = () => new Response(null, { status: 204 });

/* A row of yours, or 404 for none (or a deleted one). */
const own = (row) => {
  if (!row || row.deletedAt) throw new HttpError(404, { error: 'not_found' });
  return json(row);
};
async function remove(db, table, userId, id, revision) {
  if (!(await deleteRow(db, table, userId, id, Date.now(), revision))) throw new HttpError(404, { error: 'not_found' });
  return done();
}

export const layerRoutes = [
  ['GET', MARK, async ({ request, env, params: [sid, itemId] }) => own(await getRow(env.DB, 'marks', await requireUser(request, env), sid + ':' + validateId(itemId)))],
  ['PUT', MARK, async ({ request, env, params: [sid, itemId] }) => {
    const userId = await requireUser(request, env);
    validateId(itemId);
    const space = await roleOf(env.DB, userId, sid);
    if (!space) throw new HttpError(404, { error: 'not_found' });
    const body = await readJson(request);
    const fields = validateMark(body, space.kind);
    return json(await upsertMark(env.DB, userId, sid, itemId, fields, { revision: revisionOf(request), changed: validateChanged(body, 'marks') }));
  }],
  ['DELETE', MARK, async ({ request, env, params: [sid, itemId] }) =>
    remove(env.DB, 'marks', await requireUser(request, env), sid + ':' + validateId(itemId), revisionOf(request))],
  ['GET', PREF, async ({ request, env, params: [sid] }) => own(await getRow(env.DB, 'space_prefs', await requireUser(request, env), sid))],
  ['PUT', PREF, async ({ request, env, params: [sid] }) => {
    const userId = await requireUser(request, env);
    const fields = validatePref(await readJson(request));
    return json(await upsertPref(env.DB, userId, sid, fields, Date.now(), revisionOf(request)));
  }],
  ['DELETE', PREF, async ({ request, env, params: [sid] }) => remove(env.DB, 'space_prefs', await requireUser(request, env), sid, revisionOf(request))],
];
```

In `worker/api.js`, after the line `import { classRoutes } from './classes.js';` add `import { layerRoutes } from './layer.js';`, and replace the line `  ...classRoutes,` with:

```js
  ...classRoutes,
  ...layerRoutes,
```

- [ ] **Step 8: Run the test, then the Worker suite**

Run: `npx vitest run test/marks.test.js test/old-clients.test.js`, then `npm run test:api`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/core/shared.ts worker/http.js worker/api.js worker/validate.js worker/db.js worker/layer.js test/marks.test.js
git commit -m "Marks (field merge, members on live items) and space prefs (whole row), synced in your own scope

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JpUR1JXMY3ehtkiJwuij95"
```

---

### Task 19: Prefs with every membership, and a convert that moves

**Files:**
- Modify: `worker/spaces.js` (`joinPrefs`, `priorConvert`, `createClass`)
- Modify: `worker/invites.js` (`acceptInvite`, `joinByCode`)
- Modify: `worker/classes.js` (the `POST /api/spaces` route)
- Modify: `test/classes.test.js` (Stage 3's convert test becomes the moving one)
- Create: `test/class-layer.test.js`

- [ ] **Step 1: Write the failing tests**

`test/class-layer.test.js`:

```js
import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { makeSpace, post, setMember, signInAdmin } from './spaces.js';

let owner, ana, ben;
beforeAll(async () => { owner = await signInAdmin('cl-owner'); ana = await signInAdmin('cl-ana'); ben = await signInAdmin('cl-ben'); }, 60_000);
const prefs = (userId, sid) => env.DB.prepare('SELECT color, target, term, archived, deleted_at AS gone FROM space_prefs WHERE user_id = ? AND id = ?').bind(userId, sid).first();

describe('prefs written with a membership (spec §9, §11)', () => {
  it('give the owner of a blank class its colour and term', async () => {
    const res = await post(owner, '/api/spaces', { kind: 'class', course: { code: 'OS', name: 'Operating Systems', color: '#4FBF8B', term: 'Fall 2026', meetings: [] } });
    const { space } = await res.json();
    expect(await prefs(owner.id, space.id)).toEqual({ color: '#4FBF8B', target: null, term: 'Fall 2026', archived: 0, gone: null });
  });

  it("give someone accepting an invite the class's colour unless they use it, else the first free; a retried accept leaves them", async () => {
    const s = await makeSpace({ members: { [owner.id]: 'owner' } });
    await env.DB.prepare("UPDATE courses SET term = 'Fall 2026' WHERE scope = ?").bind(s.scope).run();
    expect((await ana('/api/courses/mine', { method: 'PUT', body: { code: 'MY', name: 'Mine', color: '#17B3AE', meetings: [] } })).status).toBe(200);
    expect((await post(owner, `/api/spaces/${s.id}/invites`, { username: 'cl-ana' })).status).toBe(201);
    expect((await post(ana, `/api/invites/${s.id}/accept`)).status).toBe(200);
    expect(await prefs(ana.id, s.id)).toEqual({ color: '#E4749B', target: null, term: 'Fall 2026', archived: 0, gone: null });
    await env.DB.prepare("UPDATE space_prefs SET color = '#4F74D9' WHERE user_id = ? AND id = ?").bind(ana.id, s.id).run();
    expect((await post(ana, `/api/invites/${s.id}/accept`)).status).toBe(200);
    expect((await prefs(ana.id, s.id)).color).toBe('#4F74D9');
  });

  it("give someone joining by code the class's colour, and a left member fresh defaults on rejoining", async () => {
    const s = await makeSpace({ members: { [owner.id]: 'owner' } });
    const { code } = await (await post(owner, `/api/spaces/${s.id}/code`)).json();
    expect((await post(ben, '/api/join', { code })).status).toBe(200);
    expect(await prefs(ben.id, s.id)).toMatchObject({ color: '#17B3AE', gone: null });
    /* left: Stage 5 deletes the prefs with the membership */
    await setMember(s.id, ben.id, null);
    await env.DB.prepare("UPDATE space_prefs SET color = '#B8457E', deleted_at = 7 WHERE user_id = ? AND id = ?").bind(ben.id, s.id).run();
    expect((await post(ben, '/api/join', { code })).status).toBe(200);
    expect(await prefs(ben.id, s.id)).toMatchObject({ color: '#17B3AE', gone: null });
  });
});
```

In `test/classes.test.js`, replace the whole test that starts `  it('converts a course: copies it and the items ticked, in class shape, and leaves your own as they were', async () => {` (down to its closing `  });`) with:

```js
  it('converts a course: moves it and the items ticked into the class, your layer into marks and prefs; again answers the class', async () => {
    const put = (path, body) => owner(path, { method: 'PUT', body });
    expect((await put('/api/courses/db', { code: 'DB', name: 'Databases', color: '#4F74D9', instructor: 'Dr. Ito', term: 'Fall 2026', archived: false, meetings: [], target: 85 })).status).toBe(200);
    const item = (id, over = {}) => put('/api/items/' + id, {
      type: 'assignment', title: id, courseId: 'db', date: '2026-10-15', status: 'graded', grade: 91, weight: 20, notes: 'mine',
      links: [{ label: 'Spec', url: 'https://example.com' }], ...over,
    });
    for (const res of await Promise.all([
      item('a1'),
      item('q1', { type: 'quiz', status: 'todo', grade: null, weight: 10, notes: '', links: [] }),
      item('t1', { type: 'task', status: 'done', grade: null, weight: null, links: [] }),
      item('c1', { type: 'c-viva', links: [] }),
      item('rvab12cd31', { type: 'task', title: 'Review 1/4 DB Lecture', status: 'todo', grade: null, weight: null, notes: '', links: [] }),
    ])) expect(res.status).toBe(200);
    const PNG = 'data:image/png;base64,iVBORw0KGgo=';
    const session = (id, over = {}) => put('/api/study_sessions/' + id, { courseId: 'db', itemId: null, startedAt: 1_790_000_000_000, studyMinutes: 30, ...over });
    for (const res of await Promise.all([
      session('s-course'), session('s-a1', { itemId: 'a1' }), session('s-t1', { itemId: 't1' }),
      put('/api/achievements/h1', { name: 'DB hours', sticker: PNG, rule: 'hours', courseId: 'db', target: 10 }),
      put('/api/achievements/g1', { name: 'A1 grade', sticker: PNG, rule: 'grade', itemId: 'a1', target: 90 }),
    ])) expect(res.status).toBe(200);
    const refused = async (items) => (await make(owner, { kind: 'class', convertCourseId: 'db', items })).json();
    expect(await refused(['a1', 'c1'])).toEqual({ error: 'invalid', field: 'items' });
    expect(await refused(['a1', 'rvab12cd31'])).toEqual({ error: 'invalid', field: 'items' });
    expect(await refused(['a1', 'elsewhere'])).toEqual({ error: 'invalid', field: 'items' });

    const res = await make(owner, { kind: 'class', convertCourseId: 'db', items: ['a1', 'q1', 'a1'] });
    expect(res.status).toBe(201);
    const { space } = await res.json();
    expect(space).toMatchObject({ name: 'Databases', role: 'owner' });
    expect(await env.DB.prepare('SELECT id, code, color, target, archived FROM courses WHERE scope = ?').bind(space.scope).first())
      .toEqual({ id: 'db', code: 'DB', color: '#4F74D9', target: null, archived: 0 });
    expect(await classRows(space.scope)).toEqual([
      { id: 'a1', type: 'assignment', status: 'todo', grade: null, notes: '', checklist: '[]', courseId: 'db', updatedBy: owner.id },
      { id: 'q1', type: 'quiz', status: 'todo', grade: null, notes: '', checklist: '[]', courseId: 'db', updatedBy: owner.id },
    ]);

    /* your layer moved with it (spec §13): a mark for the item you had touched; your colour, target and term */
    expect((await env.DB.prepare('SELECT id, status, grade, weight, notes FROM marks WHERE user_id = ?').bind(owner.id).all()).results)
      .toEqual([{ id: space.id + ':a1', status: 'graded', grade: 91, weight: null, notes: 'mine' }]);
    expect(await env.DB.prepare('SELECT color, target, term, archived FROM space_prefs WHERE user_id = ? AND id = ?').bind(owner.id, space.id).first())
      .toEqual({ color: '#4F74D9', target: 85, term: 'Fall 2026', archived: 0 });
    /* your course and the ticked items are gone from your own rows; the rest are filed under the class */
    expect((await env.DB.prepare('SELECT id, course_id AS courseId, class_id AS classId, deleted_at IS NOT NULL AS gone FROM items WHERE scope = ? ORDER BY id').bind('u:' + owner.id).all()).results).toEqual([
      { id: 'a1', courseId: 'db', classId: null, gone: 1 },
      { id: 'c1', courseId: null, classId: space.id, gone: 0 },
      { id: 'q1', courseId: 'db', classId: null, gone: 1 },
      { id: 'rvab12cd31', courseId: null, classId: space.id, gone: 0 },
      { id: 't1', courseId: null, classId: space.id, gone: 0 },
    ]);
    expect(await env.DB.prepare("SELECT deleted_at IS NOT NULL AS gone FROM courses WHERE scope = ? AND id = 'db'").bind('u:' + owner.id).first()).toEqual({ gone: 1 });
    /* sessions and achievements on the class's rows carry its space; one on an item that stays yours loses its course */
    expect((await env.DB.prepare('SELECT id, course_id AS courseId, item_id AS itemId, space_id AS spaceId FROM study_sessions WHERE user_id = ? ORDER BY id').bind(owner.id).all()).results).toEqual([
      { id: 's-a1', courseId: 'db', itemId: 'a1', spaceId: space.id },
      { id: 's-course', courseId: 'db', itemId: null, spaceId: space.id },
      { id: 's-t1', courseId: null, itemId: 't1', spaceId: null },
    ]);
    expect((await env.DB.prepare('SELECT id, space_id AS spaceId FROM achievements WHERE user_id = ? ORDER BY id').bind(owner.id).all()).results)
      .toEqual([{ id: 'g1', spaceId: space.id }, { id: 'h1', spaceId: space.id }]);

    /* the same convert again answers the class it made and writes nothing */
    const again = await make(owner, { kind: 'class', convertCourseId: 'db', items: ['a1', 'q1'] });
    expect(again.status).toBe(200);
    expect((await again.json()).space.id).toBe(space.id);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM courses WHERE scope GLOB 'c:*' AND id = 'db'").first()).n).toBe(1);
    expect(await classRows(space.scope)).toHaveLength(2);
    expect((await env.DB.prepare('SELECT count(*) AS n FROM marks WHERE user_id = ?').bind(owner.id).first()).n).toBe(1);
  });
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run test/class-layer.test.js test/classes.test.js`
Expected: FAIL: no `space_prefs` row is written by a create, an accept or a join (`prefs(…)` is `null`); the convert leaves your course and items live and writes no marks.

- [ ] **Step 3: Prefs, and the move (`worker/spaces.js`)**

Replace the line `import { REVIEW_ID } from '../src/core/shared.ts';` with:

```js
import { REVIEW_ID } from '../src/core/shared.ts';
import { COURSE_COLOURS } from './validate.js';
```

After the `MADE_FROM` constant add:

```js
const PALETTE = JSON.stringify(COURSE_COLOURS);
/* The colours a person already uses (?1 the user, ?2 the space): their live courses' and their other spaces'. */
const USED = `(SELECT u.color FROM courses AS u WHERE u.scope = 'u:' || ?1 AND u.deleted_at IS NULL AND u.archived = 0
  UNION SELECT q.color FROM space_prefs AS q WHERE q.user_id = ?1 AND q.deleted_at IS NULL AND q.id != ?2)`;

/**
 * The joiner's prefs (spec §9, §11), in the batch that makes the membership: the class
 * course's colour unless they use it, else the first of the twelve they do not use; the
 * class's term. Only for a live member of a class; a live prefs row is left as it is (an
 * accept retried), a deleted one revived with these defaults (a rejoin).
 */
export const joinPrefs = (db, userId, spaceId, now = Date.now()) => db.prepare(`INSERT INTO space_prefs (user_id, id, space_id, color, target, term, archived, created_at, updated_at, revision)
  SELECT ?1, ?2, ?2, COALESCE(
      (SELECT c.color FROM courses AS c WHERE c.scope = 'c:' || ?2 AND c.deleted_at IS NULL AND c.color NOT IN ${USED}),
      (SELECT p.value FROM json_each(?3) AS p WHERE p.value NOT IN ${USED} ORDER BY p.key LIMIT 1),
      (SELECT c.color FROM courses AS c WHERE c.scope = 'c:' || ?2 LIMIT 1),
      '#17B3AE'),
    NULL, COALESCE((SELECT c.term FROM courses AS c WHERE c.scope = 'c:' || ?2 AND c.deleted_at IS NULL LIMIT 1), ''), 0, ?4, ?4, ${NEXT_ROW_REVISION}
  WHERE EXISTS (SELECT 1 FROM members WHERE space_id = ?2 AND user_id = ?1 AND deleted_at IS NULL)
    AND EXISTS (SELECT 1 FROM spaces WHERE id = ?2 AND kind = 'class' AND deleted_at IS NULL)
  ON CONFLICT (user_id, id) DO UPDATE SET color = excluded.color, target = NULL, term = excluded.term, archived = 0,
    updated_at = excluded.updated_at, deleted_at = NULL, revision = space_prefs.revision + 1
    WHERE space_prefs.deleted_at IS NOT NULL`).bind(userId, spaceId, PALETTE, now);

/** The class you made from your course `courseId` before, as the routes answer it; null if none. */
export async function priorConvert(db, userId, courseId) {
  const prior = await db.prepare(MADE_FROM).bind(userId, courseId).first();
  return prior ? spaceSummary(db, userId, prior.id) : null;
}

/**
 * What a convert moves besides the course and the ticked items (spec §13), each statement
 * running only if the space `spaceId` was made in this batch: a mark from each ticked item
 * that holds anything of yours; your prefs from the course; the space on your sessions and
 * achievements that point at the course or a moved item (a session on the course and an
 * item that stays yours loses its course link instead, as deleting a course does); the
 * ticked items and the course soft-deleted directly (the course-delete path would clear
 * their course); every other live item of the course filed under the class.
 */
function moveIntoClass(db, userId, spaceId, courseId, ticked, now) {
  const mine = 'u:' + userId, made = 'EXISTS (SELECT 1 FROM spaces WHERE id = ?)';
  const TICKED = '(SELECT value FROM json_each(?))';
  return [
    db.prepare(`INSERT INTO marks (user_id, id, space_id, item_id, status, grade, weight, notes, checklist, completed_at, hidden, created_at, updated_at, revision)
      SELECT ?, ? || ':' || id, ?, id, status, grade, NULL, notes, checklist, completed_at, 0, ?, ?, ${NEXT_ROW_REVISION} FROM items
      WHERE scope = ? AND course_id = ? AND deleted_at IS NULL AND type NOT GLOB 'c-*' AND id IN ${TICKED}
        AND (status != 'todo' OR grade IS NOT NULL OR notes != '' OR checklist != '[]' OR completed_at IS NOT NULL) AND ${made}`)
      .bind(userId, spaceId, spaceId, now, now, mine, courseId, ticked, spaceId),
    db.prepare(`INSERT INTO space_prefs (user_id, id, space_id, color, target, term, archived, created_at, updated_at, revision)
      SELECT ?, ?, ?, color, target, term, archived, ?, ?, ${NEXT_ROW_REVISION} FROM courses WHERE scope = ? AND id = ? AND deleted_at IS NULL AND ${made}`)
      .bind(userId, spaceId, spaceId, now, now, mine, courseId, spaceId),
    db.prepare(`UPDATE study_sessions SET space_id = ?, updated_at = ?, revision = revision + 1
      WHERE user_id = ? AND deleted_at IS NULL AND space_id IS NULL
        AND ((course_id = ? AND (item_id IS NULL OR item_id IN ${TICKED})) OR (course_id IS NULL AND item_id IN ${TICKED})) AND ${made}`)
      .bind(spaceId, now, userId, courseId, ticked, ticked, spaceId),
    db.prepare(`UPDATE study_sessions SET course_id = NULL, updated_at = ?, revision = revision + 1
      WHERE user_id = ? AND deleted_at IS NULL AND space_id IS NULL AND course_id = ? AND ${made}`).bind(now, userId, courseId, spaceId),
    db.prepare(`UPDATE achievements SET space_id = ?, updated_at = ?, revision = revision + 1
      WHERE user_id = ? AND deleted_at IS NULL AND space_id IS NULL
        AND ((rule = 'hours' AND course_id = ?) OR (rule = 'grade' AND item_id IN ${TICKED})) AND ${made}`)
      .bind(spaceId, now, userId, courseId, ticked, spaceId),
    db.prepare(`UPDATE items SET deleted_at = ?, updated_at = ?, revision = revision + 1
      WHERE scope = ? AND course_id = ? AND deleted_at IS NULL AND id IN ${TICKED} AND ${made}`).bind(now, now, mine, courseId, ticked, spaceId),
    db.prepare(`UPDATE items SET class_id = ?, course_id = NULL, updated_at = ?, revision = revision + 1
      WHERE scope = ? AND course_id = ? AND deleted_at IS NULL AND ${made}`).bind(spaceId, now, mine, courseId, spaceId),
    db.prepare(`UPDATE courses SET deleted_at = ?, updated_at = ?, revision = revision + 1
      WHERE scope = ? AND id = ? AND deleted_at IS NULL AND ${made}`).bind(now, now, mine, courseId, spaceId),
  ];
}
```

In `createClass`, replace its doc comment's sentence `Stage 3 copies and leaves your own rows as they are (plan Decision 1).` with `A convert then moves your layer and your course (moveIntoClass; Stage 4 plan, Decision 6); a blank class gives you its colour and term as your prefs.`, and replace the block

```js
  if (copy && items.length) {
```

down to the end of that `if` block (its closing `  }` after the items `INSERT … .bind(…)`) with the same block followed by:

```js
  if (copy) stmts.push(...moveIntoClass(db, userId, id, courseId, JSON.stringify(items), now));
  else {
    stmts.push(db.prepare(`INSERT INTO space_prefs (user_id, id, space_id, color, target, term, archived, created_at, updated_at, revision)
      SELECT ?, ?, ?, ?, NULL, ?, 0, ?, ?, ${NEXT_ROW_REVISION} WHERE ${made}`).bind(userId, id, id, course.color, course.term, now, now, id));
  }
```

(The items copy statement itself is unchanged: it reads your items before the move's soft-delete runs, since a batch runs its statements in order.)

- [ ] **Step 4: Prefs on accept and join (`worker/invites.js`)**

Replace the import line `import { ADMINS_ONLY, LIVE_MEMBERS, MEMBER_LIMIT, MY_SPACES, NEXT_SPACE_REVISION, SPACE_LIMIT, spaceSummary, touchSpace } from './spaces.js';` with:

```js
import { ADMINS_ONLY, LIVE_MEMBERS, MEMBER_LIMIT, MY_SPACES, NEXT_SPACE_REVISION, SPACE_LIMIT, joinPrefs, spaceSummary, touchSpace } from './spaces.js';
```

In `acceptInvite`, replace the batch's last element

```js
    acceptedStmt(db, spaceId, userId),
  ]);
```

with

```js
    acceptedStmt(db, spaceId, userId),
    /* last: touchSpace above reads changes() from the membership statement just before it */
    joinPrefs(db, userId, spaceId, now),
  ]);
```

In `joinByCode`, replace

```js
    acceptedStmt(db, space.id, userId),
  ]);
```

with

```js
    acceptedStmt(db, space.id, userId),
    joinPrefs(db, userId, space.id, now),
  ]);
```

- [ ] **Step 5: A repeated convert is answered first (`worker/classes.js`)**

Replace `import { ADMINS_ONLY, checkConvert, createClass, setRole, spaceDetails, transfer } from './spaces.js';` with:

```js
import { ADMINS_ONLY, checkConvert, createClass, priorConvert, setRole, spaceDetails, transfer } from './spaces.js';
```

and in the `POST spaces` route replace

```js
    if (body.convertCourseId) await checkConvert(env.DB, userId, body.convertCourseId, body.items);
```

with

```js
    if (body.convertCourseId) {
      /* a convert repeated after it moved your course: the course is gone, so answer the class first */
      const prior = await priorConvert(env.DB, userId, body.convertCourseId);
      if (prior) return json({ space: prior }, 200);
      await checkConvert(env.DB, userId, body.convertCourseId, body.items);
    }
```

- [ ] **Step 6: Run the tests, then the Worker suite**

Run: `npx vitest run test/class-layer.test.js test/classes.test.js test/invites.test.js test/join-code.test.js`, then `npm run test:api`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add worker/spaces.js worker/invites.js worker/classes.js test/classes.test.js test/class-layer.test.js
git commit -m "Classes: prefs with every membership; a convert moves your course and your layer into the class

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JpUR1JXMY3ehtkiJwuij95"
```

---

### Task 20: Merging a course of yours into a class (absorb)

**Files:**
- Modify: `worker/spaces.js` (`absorb`)
- Modify: `worker/classes.js` (`absorbBody`, the route)
- Create: `test/absorb.test.js`

- [ ] **Step 1: Write the failing test**

`test/absorb.test.js`:

```js
import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { signIn } from './helpers.js';
import { makeSpace, post, sharedItem, signInAdmin } from './spaces.js';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
let owner, ana, outsider, s;
const put = (api, path, body) => api(path, { method: 'PUT', body });
beforeAll(async () => {
  owner = await signInAdmin('ab-owner'); ana = await signInAdmin('ab-ana'); outsider = await signIn('ab-out');
  s = await makeSpace({ members: { [owner.id]: 'owner', [ana.id]: 'member' } });
  await sharedItem(s.scope, 'q1', { course_id: 'web', type: 'quiz', title: 'Quiz 1', weight: 10 });
  await sharedItem(s.scope, 'e1', { course_id: 'web', type: 'exam', title: 'Midterm', weight: 30 });
  await env.DB.prepare("INSERT INTO space_prefs (user_id, id, space_id, color, created_at, updated_at) VALUES (?, ?, ?, '#17B3AE', 1, 1)").bind(ana.id, s.id, s.id).run();
  await put(ana, '/api/courses/mydb', { code: 'WEB', name: 'Web (mine)', color: '#B8457E', meetings: [], target: 80 });
  const item = (id, over) => put(ana, '/api/items/' + id, { courseId: 'mydb', date: '2026-10-15', status: 'todo', ...over });
  await item('x1', { type: 'quiz', title: 'Quiz 1', status: 'graded', grade: 88, weight: 10, notes: 'easy' });
  await item('x2', { type: 'exam', title: 'Midterm', weight: 35 });
  await item('x3', { type: 'c-viva', title: 'Viva' });
  await item('x4', { type: 'task', title: 'Read chapter 3' });
  const session = (id, over) => put(ana, '/api/study_sessions/' + id, { courseId: 'mydb', itemId: null, startedAt: 1_790_000_000_000, studyMinutes: 20, ...over });
  await session('sa', { itemId: 'x1' }); await session('sb', {}); await session('sc', { itemId: 'x4' });
  await put(ana, '/api/achievements/hg', { name: 'Quiz ace', sticker: PNG, rule: 'grade', itemId: 'x1', target: 85 });
  await put(ana, '/api/achievements/hh', { name: 'Web hours', sticker: PNG, rule: 'hours', courseId: 'mydb', target: 5 });
}, 60_000);

const absorb = (api, body) => post(api, `/api/spaces/${s.id}/absorb`, body);
const rows = async (sql, ...binds) => (await env.DB.prepare(sql).bind(...binds).all()).results;

describe('absorb', () => {
  it('refuses someone outside the class, a course not yours, a custom-typed item, an item not in the class, a pair named twice', async () => {
    expect((await absorb(outsider, { courseId: 'mydb', pairs: [] })).status).toBe(404);
    expect(await (await absorb(ana, { courseId: 'nope', pairs: [] })).json()).toEqual({ error: 'invalid', field: 'courseId' });
    expect(await (await absorb(ana, { courseId: 'mydb', pairs: [['x3', 'q1']] })).json()).toEqual({ error: 'invalid', field: 'pairs' });
    expect(await (await absorb(ana, { courseId: 'mydb', pairs: [['x1', 'zz']] })).json()).toEqual({ error: 'invalid', field: 'pairs' });
    expect(await (await absorb(ana, { courseId: 'mydb', pairs: [['x1', 'q1'], ['x2', 'q1']] })).json()).toEqual({ error: 'invalid', field: 'pairs' });
    expect(await (await absorb(ana, { courseId: 'mydb', pairs: 'x1' })).json()).toEqual({ error: 'invalid', field: 'pairs' });
    expect(await (await absorb(ana, { courseId: 'mydb', pairs: [], fromCourse: 'yes' })).json()).toEqual({ error: 'invalid', field: 'fromCourse' });
  });

  it("moves your layer onto the class's items, files the rest under it, and writes no shared row; again does nothing", async () => {
    const before = await rows('SELECT id, revision FROM items WHERE scope = ? ORDER BY id', s.scope);
    const res = await absorb(ana, { courseId: 'mydb', pairs: [['x1', 'q1'], ['x2', 'e1']], fromCourse: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ paired: 2, filed: 2 });
    expect(await rows('SELECT id, status, grade, weight, notes FROM marks WHERE user_id = ? ORDER BY id', ana.id)).toEqual([
      { id: s.id + ':e1', status: 'todo', grade: null, weight: 35, notes: '' },
      { id: s.id + ':q1', status: 'graded', grade: 88, weight: null, notes: 'easy' },
    ]);
    expect(await env.DB.prepare('SELECT color, target, archived FROM space_prefs WHERE user_id = ? AND id = ?').bind(ana.id, s.id).first())
      .toEqual({ color: '#B8457E', target: 80, archived: 0 });
    expect(await rows('SELECT id, course_id AS courseId, class_id AS classId, deleted_at IS NOT NULL AS gone FROM items WHERE scope = ? ORDER BY id', 'u:' + ana.id)).toEqual([
      { id: 'x1', courseId: 'mydb', classId: null, gone: 1 },
      { id: 'x2', courseId: 'mydb', classId: null, gone: 1 },
      { id: 'x3', courseId: null, classId: s.id, gone: 0 },
      { id: 'x4', courseId: null, classId: s.id, gone: 0 },
    ]);
    expect(await env.DB.prepare("SELECT deleted_at IS NOT NULL AS gone FROM courses WHERE scope = ? AND id = 'mydb'").bind('u:' + ana.id).first()).toEqual({ gone: 1 });
    expect(await rows('SELECT id, course_id AS courseId, item_id AS itemId, space_id AS spaceId FROM study_sessions WHERE user_id = ? ORDER BY id', ana.id)).toEqual([
      { id: 'sa', courseId: 'web', itemId: 'q1', spaceId: s.id },
      { id: 'sb', courseId: 'web', itemId: null, spaceId: s.id },
      { id: 'sc', courseId: null, itemId: 'x4', spaceId: null },
    ]);
    expect(await rows('SELECT id, course_id AS courseId, item_id AS itemId, space_id AS spaceId FROM achievements WHERE user_id = ? ORDER BY id', ana.id)).toEqual([
      { id: 'hg', courseId: null, itemId: 'q1', spaceId: s.id },
      { id: 'hh', courseId: 'web', itemId: null, spaceId: s.id },
    ]);
    expect(await rows('SELECT id, revision FROM items WHERE scope = ? ORDER BY id', s.scope)).toEqual(before);
    const again = await absorb(ana, { courseId: 'mydb', pairs: [['x1', 'q1']], fromCourse: true });
    expect(await again.json()).toEqual({ paired: 0, filed: 0 });
    expect((await rows('SELECT id FROM marks WHERE user_id = ?', ana.id))).toHaveLength(2);
  });

  it('keeps a mark you already had field by field, and your colour unless taken from the course', async () => {
    await put(ana, '/api/courses/bio2', { code: 'B2', name: 'Second copy', color: '#E8B33A', meetings: [], target: 60 });
    await put(ana, '/api/items/y1', { type: 'quiz', title: 'Quiz 1', courseId: 'bio2', date: '2026-10-15', status: 'graded', grade: 70, notes: 'old', checklist: [{ id: 'k', text: 'Ch 1', done: true }] });
    expect(await (await absorb(ana, { courseId: 'bio2', pairs: [['y1', 'q1']] })).json()).toEqual({ paired: 1, filed: 0 });
    expect(await env.DB.prepare('SELECT grade, notes, checklist FROM marks WHERE user_id = ? AND id = ?').bind(ana.id, s.id + ':q1').first())
      .toEqual({ grade: 88, notes: 'easy', checklist: '[{"id":"k","text":"Ch 1","done":true}]' });
    expect(await env.DB.prepare('SELECT color, target FROM space_prefs WHERE user_id = ? AND id = ?').bind(ana.id, s.id).first())
      .toEqual({ color: '#B8457E', target: 80 });
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run test/absorb.test.js`
Expected: FAIL: `POST /api/spaces/<id>/absorb` answers `404 not_found` for everyone (no route).

- [ ] **Step 3: The batch (`worker/spaces.js`)**

Append:

```js

/**
 * Merge a course of yours into a class you are in (spec §13, merge on join): for each pair
 * [your item, the class's item], a mark from your item when it holds anything of yours (its
 * weight an override only when it differs from the class's; a mark you already had wins
 * field by field), your sessions and achievements on it and on the course moved to the
 * class's ids with the space, your item soft-deleted; your other items of the course filed
 * under the class; your target (always, while your prefs have none) and, with `fromCourse`,
 * your colour, term and archive flag into your prefs; the course soft-deleted. Writes no
 * shared row. Pairs name live items of your course (never a custom-typed one) and live items
 * of the class. A course already gone answers {paired: 0, filed: 0}: a retry.
 */
export async function absorb(db, userId, spaceId, { courseId, pairs, fromCourse = false }, now = Date.now()) {
  const me = await assertAllowed(db, userId, spaceId, 'read');
  if (me.kind !== 'class') throw new HttpError(404, { error: 'not_found' });
  const mine = 'u:' + userId, scope = scopeOf('class', spaceId), J = JSON.stringify(pairs);
  const [course, own, theirs] = await db.batch([
    db.prepare('SELECT deleted_at FROM courses WHERE scope = ? AND id = ?').bind(mine, courseId),
    db.prepare(`SELECT id, type FROM items WHERE scope = ? AND course_id = ? AND deleted_at IS NULL
      AND id IN (SELECT json_extract(value, '$[0]') FROM json_each(?))`).bind(mine, courseId, J),
    db.prepare(`SELECT id FROM items WHERE scope = ? AND deleted_at IS NULL
      AND id IN (SELECT json_extract(value, '$[1]') FROM json_each(?))`).bind(scope, J),
  ]);
  const c = course.results[0];
  if (!c) throw new HttpError(400, { error: 'invalid', field: 'courseId' });
  if (c.deleted_at !== null) return { paired: 0, filed: 0 };
  if (own.results.length !== pairs.length || theirs.results.length !== pairs.length || own.results.some((r) => r.type.startsWith('c-'))) {
    throw new HttpError(400, { error: 'invalid', field: 'pairs' });
  }
  const g = memberGuard(spaceId, userId), f = fromCourse ? 1 : 0;
  const P = `(SELECT json_extract(value, '$[0]') AS mine, json_extract(value, '$[1]') AS shared FROM json_each(?))`;
  const CLASS_COURSE = '(SELECT id FROM courses WHERE scope = ? AND deleted_at IS NULL LIMIT 1)';
  /* the course not merged yet: a second merge racing this one writes nothing */
  const LIVE = 'EXISTS (SELECT 1 FROM courses WHERE scope = ? AND id = ? AND deleted_at IS NULL)';
  const results = await db.batch([
    db.prepare(`INSERT INTO marks (user_id, id, space_id, item_id, status, grade, weight, notes, checklist, completed_at, hidden, created_at, updated_at, revision)
      SELECT ?, ? || ':' || p.shared, ?, p.shared, i.status, i.grade, CASE WHEN i.weight IS NOT s.weight THEN i.weight END, i.notes, i.checklist, i.completed_at, 0, ?, ?, ${NEXT_ROW_REVISION}
      FROM ${P} AS p JOIN items AS i ON i.scope = ? AND i.id = p.mine AND i.course_id = ? AND i.deleted_at IS NULL
        JOIN items AS s ON s.scope = ? AND s.id = p.shared AND s.deleted_at IS NULL
      WHERE (i.status != 'todo' OR i.grade IS NOT NULL OR i.notes != '' OR i.checklist != '[]' OR i.completed_at IS NOT NULL OR (i.weight IS NOT NULL AND i.weight IS NOT s.weight))
        AND ${g.sql} AND ${LIVE}
      ON CONFLICT (user_id, id) DO UPDATE SET
        status = CASE WHEN marks.status = 'todo' THEN excluded.status ELSE marks.status END,
        grade = COALESCE(marks.grade, excluded.grade), weight = COALESCE(marks.weight, excluded.weight),
        notes = CASE WHEN marks.notes = '' THEN excluded.notes ELSE marks.notes END,
        checklist = CASE WHEN marks.checklist = '[]' THEN excluded.checklist ELSE marks.checklist END,
        completed_at = COALESCE(marks.completed_at, excluded.completed_at),
        hidden = 0, deleted_at = NULL, updated_at = excluded.updated_at, revision = marks.revision + 1`)
      .bind(userId, spaceId, spaceId, now, now, J, mine, courseId, scope, ...g.binds, mine, courseId),
    db.prepare(`UPDATE study_sessions SET space_id = ?, course_id = ${CLASS_COURSE},
        item_id = (SELECT p.shared FROM ${P} AS p WHERE p.mine = study_sessions.item_id), updated_at = ?, revision = revision + 1
      WHERE user_id = ? AND deleted_at IS NULL AND space_id IS NULL AND (course_id IS NULL OR course_id = ?)
        AND item_id IN (SELECT p.mine FROM ${P} AS p) AND ${g.sql} AND ${LIVE}`)
      .bind(spaceId, scope, J, now, userId, courseId, J, ...g.binds, mine, courseId),
    db.prepare(`UPDATE study_sessions SET space_id = ?, course_id = ${CLASS_COURSE}, updated_at = ?, revision = revision + 1
      WHERE user_id = ? AND deleted_at IS NULL AND space_id IS NULL AND course_id = ? AND item_id IS NULL AND ${g.sql} AND ${LIVE}`)
      .bind(spaceId, scope, now, userId, courseId, ...g.binds, mine, courseId),
    db.prepare(`UPDATE study_sessions SET course_id = NULL, updated_at = ?, revision = revision + 1
      WHERE user_id = ? AND deleted_at IS NULL AND space_id IS NULL AND course_id = ? AND ${g.sql} AND ${LIVE}`)
      .bind(now, userId, courseId, ...g.binds, mine, courseId),
    db.prepare(`UPDATE achievements SET space_id = ?,
        course_id = CASE WHEN rule = 'hours' THEN ${CLASS_COURSE} ELSE course_id END,
        item_id = CASE WHEN rule = 'grade' THEN (SELECT p.shared FROM ${P} AS p WHERE p.mine = achievements.item_id) ELSE item_id END,
        updated_at = ?, revision = revision + 1
      WHERE user_id = ? AND deleted_at IS NULL AND space_id IS NULL
        AND ((rule = 'hours' AND course_id = ?) OR (rule = 'grade' AND item_id IN (SELECT p.mine FROM ${P} AS p))) AND ${g.sql} AND ${LIVE}`)
      .bind(spaceId, scope, J, now, userId, courseId, J, ...g.binds, mine, courseId),
    db.prepare(`INSERT INTO space_prefs (user_id, id, space_id, color, target, term, archived, created_at, updated_at, revision)
      SELECT ?, ?, ?, color, target, term, archived, ?, ?, ${NEXT_ROW_REVISION} FROM courses WHERE scope = ? AND id = ? AND deleted_at IS NULL AND ${g.sql}
      ON CONFLICT (user_id, id) DO UPDATE SET target = COALESCE(space_prefs.target, excluded.target),
        color = CASE WHEN ? THEN excluded.color ELSE space_prefs.color END,
        term = CASE WHEN ? THEN excluded.term ELSE space_prefs.term END,
        archived = CASE WHEN ? THEN excluded.archived ELSE space_prefs.archived END,
        deleted_at = NULL, updated_at = excluded.updated_at, revision = space_prefs.revision + 1`)
      .bind(userId, spaceId, spaceId, now, now, mine, courseId, ...g.binds, f, f, f),
    db.prepare(`UPDATE items SET deleted_at = ?, updated_at = ?, revision = revision + 1
      WHERE scope = ? AND course_id = ? AND deleted_at IS NULL AND id IN (SELECT p.mine FROM ${P} AS p) AND ${g.sql} AND ${LIVE}`)
      .bind(now, now, mine, courseId, J, ...g.binds, mine, courseId),
    db.prepare(`UPDATE items SET class_id = ?, course_id = NULL, updated_at = ?, revision = revision + 1
      WHERE scope = ? AND course_id = ? AND deleted_at IS NULL AND ${g.sql} AND ${LIVE}`)
      .bind(spaceId, now, mine, courseId, ...g.binds, mine, courseId),
    db.prepare(`UPDATE courses SET deleted_at = ?, updated_at = ?, revision = revision + 1 WHERE scope = ? AND id = ? AND deleted_at IS NULL AND ${g.sql}`)
      .bind(now, now, mine, courseId, ...g.binds),
  ]);
  return { paired: results[6].meta.changes, filed: results[7].meta.changes };
}
```

- [ ] **Step 4: The route (`worker/classes.js`)**

Replace `import { ADMINS_ONLY, checkConvert, createClass, priorConvert, setRole, spaceDetails, transfer } from './spaces.js';` with:

```js
import { ADMINS_ONLY, absorb, checkConvert, createClass, priorConvert, setRole, spaceDetails, transfer } from './spaces.js';
```

After the `classBody` function add:

```js
/** POST /api/spaces/:sid/absorb: {courseId, pairs: [[your item id, the class's item id]], fromCourse?}; each id once. */
export function absorbBody(body) {
  const courseId = idOf(body.courseId, 'courseId');
  const pairs = body.pairs ?? [];
  if (!Array.isArray(pairs) || pairs.length > 500) throw bad('pairs');
  const out = pairs.map((p) => {
    if (!Array.isArray(p) || p.length !== 2) throw bad('pairs');
    return [idOf(p[0], 'pairs'), idOf(p[1], 'pairs')];
  });
  if (new Set(out.map((p) => p[0])).size !== out.length || new Set(out.map((p) => p[1])).size !== out.length) throw bad('pairs');
  if (body.fromCourse != null && typeof body.fromCourse !== 'boolean') throw bad('fromCourse');
  return { courseId, pairs: out, fromCourse: body.fromCourse === true };
}
```

and replace the last line of the file, `];`, with:

```js
  ['POST', route(`spaces/${SID}/absorb`), async ({ request, env, params: [sid] }) =>
    json(await absorb(env.DB, await requireUser(request, env), sid, absorbBody(await readJson(request))))],
];
```

- [ ] **Step 5: Run the test, then the Worker suite**

Run: `npx vitest run test/absorb.test.js`, then `npm run test:api`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add worker/spaces.js worker/classes.js test/absorb.test.js
git commit -m "Absorb: merge a course of yours into a class, your layer onto its items, safe to retry

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JpUR1JXMY3ehtkiJwuij95"
```

---

### Task 21: The client keeps your marks and prefs (IndexedDB 6, store, API, sync)

**Files:**
- Modify: `src/core/types.ts`, `src/core/model.ts`, `src/core/db.ts`, `src/core/store.ts`, `src/core/api.ts`, `src/core/sync.ts`
- Modify: `test/local-store.node.mjs`, `test/sync.test.js`, `test/api-client.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `test/local-store.node.mjs`:

```js
test('version 5 upgrade adds your marks and space prefs, and keeps pending edits', async () => {
 const user = p(), name = `rounds:${user.id}`;
 await new Promise((resolve, reject) => {
  const request = indexedDB.open(name, 5);
  request.onupgradeneeded = () => {
   for (const s of ['courses', 'items', 'quotes', 'study_sessions', 'achievements', 'shared_courses', 'shared_items', 'spaces', 'meta', 'pending', 'conflicts']) {
    request.result.createObjectStore(s, { keyPath: ['meta', 'pending'].includes(s) ? 'key' : s.startsWith('shared_') ? ['scope', 'id'] : 'id' });
   }
  };
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
   const db = request.result, tx = db.transaction(['items', 'pending'], 'readwrite');
   tx.objectStore('items').put({ id: 'a', title: 'Unsent', revision: 3 });
   tx.objectStore('pending').put({ key: 'items:a', op: 'put', body: { id: 'a', title: 'Unsent', revision: 3 }, revision: 3, reviewRequired: false, token: 't', owner: 'old-tab' });
   tx.oncomplete = () => { db.close(); resolve(); };
  };
 });
 await first.open(user);
 assert.deepEqual((await first.pending()).map((op) => op.key), ['items:a']);
 assert.deepEqual([first.data.marks, first.data.space_prefs], [[], []]);
});

test('pages bring your marks and prefs; a mark queues with the mark it started from, prefs whole', async () => {
 const user = p(); await first.open(user);
 const own = `u:${user.id}`, id = 'abcdefghij12:a1';
 await first.applyPage({ cursors: { [own]: 4 }, changes: [
  { scope: own, kind: 'marks', row: { id, spaceId: 'abcdefghij12', itemId: 'a1', status: 'todo', notes: 'old', revision: 3 } },
  { scope: own, kind: 'space_prefs', row: { id: 'abcdefghij12', spaceId: 'abcdefghij12', color: '#4F74D9', term: 'Fall', revision: 4 } },
 ] });
 assert.deepEqual(first.data.marks.map((m) => [m.id, m.notes, m.hidden, m.checklist]), [[id, 'old', false, []]]);
 assert.deepEqual(first.data.space_prefs.map((x) => [x.id, x.color, x.archived]), [['abcdefghij12', '#4F74D9', false]]);
 await first.saveMark({ ...first.data.marks[0], notes: 'new' });
 await first.saveMark({ ...first.data.marks[0], status: 'done' });
 const [op] = await first.pending();
 assert.equal(op.key, `marks:${id}`);
 assert.equal(op.base.notes, 'old'); assert.equal(op.body.notes, 'new'); assert.equal(op.body.status, 'done'); assert.equal(op.revision, 3);
 await first.saveSpacePref({ ...first.data.space_prefs[0], archived: true });
 const pref = (await first.pending()).find((o) => o.key === 'space_prefs:abcdefghij12');
 assert.equal(pref.body.archived, true); assert.equal(pref.base, undefined);
 /* items keep their class label; the profile its hidden sources */
 await first.saveItem({ id: 'f1', title: 'Extra quiz', classId: 'abcdefghij12' });
 assert.equal(first.item('f1').classId, 'abcdefghij12');
 await first.saveProfile({ hiddenSources: ['personal'] });
 assert.deepEqual(first.data.profile.hiddenSources, ['personal']);
});
```

Append to `test/sync.test.js`, inside `describe('persisted operation synchronization', …)`, before its closing `});`:

```js
 it('pushes a mark to its own route with the fields it changed', async () => {
   const mark = { key: 'marks:abcdefghij12:a1', op: 'put', revision: 3, token: 'm', owner: 'x',
     body: { id: 'abcdefghij12:a1', notes: 'new', status: 'todo', revision: 3 }, base: { id: 'abcdefghij12:a1', notes: 'old', status: 'todo', revision: 3 } };
   store.pending.mockResolvedValue([mark]);
   api.put.mockResolvedValue({ ...mark.body, revision: 4 });
   await sync.syncNow();
   expect(api.put).toHaveBeenCalledWith('marks', 'abcdefghij12:a1', { ...mark.body, revision: 3 }, { notes: 'old' });
 });
 it('uploads course puts, then items, then marks and prefs, then course deletes', async () => {
   const at = (key, op = 'put') => ({ key, op, revision: 1, token: key, owner: 'x', body: { id: key.split(/:(.*)/s)[1], revision: 1 } });
   store.pending.mockResolvedValue([at('marks:abcdefghij12:a1'), at('courses:c1', 'delete'), at('space_prefs:abcdefghij12'), at('items:i1'), at('courses:c2')]);
   const order = [];
   api.put.mockImplementation(async (kind, id) => { order.push(kind + ':' + id); return { id, revision: 2 }; });
   vi.spyOn(api, 'del').mockImplementation(async (kind, id) => { order.push('del ' + kind + ':' + id); return null; });
   await sync.syncNow();
   expect(order).toEqual(['courses:c2', 'items:i1', 'marks:abcdefghij12:a1', 'space_prefs:abcdefghij12', 'del courses:c1']);
 });
```

Append to `test/api-client.test.js`:

```js
describe('your layer, as the client sends it', () => {
  it('puts a mark at /api/marks/<space>/<item> with the fields it changed, and prefs at their space', async () => {
    const mark = { id: 'abcdefghij12:a/1', notes: 'x', revision: 2 };
    respond(mark);
    expect(await client.api.put('marks', 'abcdefghij12:a/1', { ...mark, revision: 1 }, { notes: '' })).toEqual(mark);
    const [path, init] = fetch.mock.calls[0];
    expect(path).toBe('/api/marks/abcdefghij12/a%2F1');
    expect(JSON.parse(init.body)).toMatchObject({ notes: 'x', changed: { notes: '' } });
    expect(init.headers['if-match']).toBe('"1"');
    respond({ id: 'abcdefghij12', color: '#17B3AE', revision: 3 });
    await client.api.put('space_prefs', 'abcdefghij12', { revision: 2, color: '#17B3AE' });
    expect(fetch.mock.calls[0][0]).toBe('/api/space_prefs/abcdefghij12');
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npm run test:local`, then `npx vitest run test/sync.test.js test/api-client.test.js`
Expected: FAIL: `first.data.marks` is undefined; `api.put` is called without `changed` for the mark, and the order puts the mark before the items; the mark's path is `/api/marks/abcdefghij12%3Aa%2F1`.

- [ ] **Step 3: The shapes (`src/core/types.ts`)**

In `Item`, after the line `    completedAt: number | null` add:

```ts
    /** A personal item filed under a class: the class's space id (spec §5). A label, opening nothing. */
    classId?: string | null
```

In `StudySession`, after `    manual: boolean` add, and in `Achievement`, after `    target: number` add:

```ts
    /** The space `courseId`/`itemId` belong to, when they are a class's or a project's (spec §7). */
    spaceId?: string | null
```

In `Profile`, after the `maintenance?: Maintenance | null` line add:

```ts
    /** What you hid from your Week and Month: 'course:<id>', 'space:<sid>', 'personal' (spec §9). */
    hiddenSources?: string[]
```

Append:

```ts

/** Your layer on a shared item (spec §4): yours alone. Its id is '<space id>:<item id>'. */
export interface Mark extends Synced {
    id: string
    spaceId: string
    itemId: string
    status: ItemStatus
    grade: number | null
    /** your weight for it, when it differs from the class's; null uses the class's */
    weight: number | null
    notes: string
    checklist: ChecklistEntry[]
    completedAt: number | null
    /** "not mine": left out of your views, grades and stats */
    hidden: boolean
}

/** Your settings for a space: your colour, grade target, semester and sidebar archive for it. Its id is the space id. */
export interface SpacePref extends Synced { id: string; spaceId: string; color: string; target: number | null; term: string; archived: boolean }
```

- [ ] **Step 4: The normalizers (`src/core/model.ts`)**

Replace the type import line with:

```ts
import type { Achievement, ChecklistEntry, Course, Flow, Item, ItemType, Mark, Meeting, Quote, SpacePref, StepKind, StudyPrefs, StudySession, TypePref } from './types.ts';
```

In `normalizeItem`, after the line `    completedAt: typeof raw.completedAt === 'number' ? raw.completedAt : null,` add:

```ts
    classId: typeof raw.classId === 'string' && raw.classId ? raw.classId : null,
```

In `normalizeStudySession`, after `    manual: !!raw.manual,` add `    spaceId: raw.spaceId || null,`. In `normalizeAchievement`, after the `target: clampInt(…),` line add `    spaceId: raw.spaceId || null,`.

Append:

```ts

const checklistOf = (raw: unknown): ChecklistEntry[] => Array.isArray(raw)
  ? raw.slice(0, 50).map((c: { id?: unknown; text?: unknown; done?: unknown }) => ({ id: typeof c?.id === 'string' && c.id ? c.id : uid(), text: cut(c?.text, 140), done: !!c?.done }))
  : [];

/** Your mark as stored or received: its id is '<space id>:<item id>', split at the first ':'. */
export function normalizeMark(raw: Raw<Mark>): Mark {
  const id = typeof raw.id === 'string' && raw.id ? raw.id : (raw.spaceId || '') + ':' + (raw.itemId || '');
  const at = id.indexOf(':');
  return {
    id,
    spaceId: raw.spaceId || id.slice(0, at),
    itemId: raw.itemId || id.slice(at + 1),
    status: raw.status || 'todo',
    grade: typeof raw.grade === 'number' ? raw.grade : null,
    weight: typeof raw.weight === 'number' ? raw.weight : null,
    notes: cut(raw.notes, 5000),
    checklist: checklistOf(raw.checklist),
    completedAt: typeof raw.completedAt === 'number' ? raw.completedAt : null,
    hidden: !!raw.hidden,
    createdAt: raw.createdAt ?? null,
    revision: raw.revision ?? 0, updatedAt: raw.updatedAt ?? null,
  };
}

/** Your prefs for a space, as stored or received. */
export function normalizeSpacePref(raw: Raw<SpacePref>): SpacePref {
  const id = raw.id || raw.spaceId || '';
  return {
    id,
    spaceId: raw.spaceId || id,
    color: HEXES.includes(raw.color as string) ? raw.color as string : HEXES[0],
    target: isInt(raw.target) && raw.target >= 1 && raw.target <= 100 ? raw.target : null,
    term: cut(raw.term, 40),
    archived: !!raw.archived,
    createdAt: raw.createdAt ?? null,
    revision: raw.revision ?? 0, updatedAt: raw.updatedAt ?? null,
  };
}
```

- [ ] **Step 5: IndexedDB version 6 (`src/core/db.ts`)**

Replace `import type { Achievement, Course, Item, Quote, SharedCourse, SharedItem, Space, StudySession } from './types.ts';` with:

```ts
import type { Achievement, Course, Item, Mark, Quote, SharedCourse, SharedItem, Space, SpacePref, StudySession } from './types.ts';
```

In `Rows`, after `  spaces: Space;` add:

```ts
  marks: Mark;
  space_prefs: SpacePref;
```

Replace the `STORES` line with:

```ts
export const STORES: StoreName[] = ['courses', 'items', 'quotes', 'study_sessions', 'achievements', 'shared_courses', 'shared_items', 'spaces', 'marks', 'space_prefs', 'meta', 'pending', 'conflicts'];
```

Replace

```ts
/** Version 5 (spec §7): shared rows, spaces, and a sync cursor per scope. `account` names whose cursor version 4 kept. */
export function openDb(name: string, onVersionChange: () => void = () => {}, account: string | null = null): Promise<Db> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 5);
```

with

```ts
/** Version 6: version 5's shared rows, spaces and cursor per scope (spec §7), and your marks
    and space prefs (Stage 4). Roll-forward only: a version 5 client cannot open it.
    `account` names whose cursor version 4 kept. */
export function openDb(name: string, onVersionChange: () => void = () => {}, account: string | null = null): Promise<Db> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 6);
```

(The upgrade already creates every store in `STORES` that is missing, so 5 → 6 adds the two and touches nothing else; 4 → 6 runs the cursor move as before.)

- [ ] **Step 6: The store (`src/core/store.ts`)**

Replace the two import lines

```ts
import { normalizeItem, normalizeCourse, normalizeQuote, normalizeStudySession, normalizeAchievement, normalizeFlow, normalizePrefs, DEFAULT_COAT } from './model.ts';
```

```ts
import type { Achievement, Coat, Course, Item, Profile, Quote, SharedCourse, SharedItem, Space, StudySession } from './types.ts';
```

with

```ts
import { normalizeItem, normalizeCourse, normalizeQuote, normalizeStudySession, normalizeAchievement, normalizeMark, normalizeSpacePref, normalizeFlow, normalizePrefs, DEFAULT_COAT } from './model.ts';
```

```ts
import type { Achievement, Coat, Course, Item, Mark, Profile, Quote, SharedCourse, SharedItem, Space, SpacePref, StudySession } from './types.ts';
```

Replace

```ts
export type Kind = 'items' | 'courses' | 'quotes' | 'study_sessions' | 'achievements';
/** What each kind's normalizer takes. */
interface RawOf { items: RawItem; courses: RawCourse; quotes: Raw<Quote>; study_sessions: Raw<StudySession>; achievements: Raw<Achievement> }
```

with

```ts
export type Kind = 'items' | 'courses' | 'quotes' | 'study_sessions' | 'achievements' | 'marks' | 'space_prefs';
/** What each kind's normalizer takes. */
interface RawOf { items: RawItem; courses: RawCourse; quotes: Raw<Quote>; study_sessions: Raw<StudySession>; achievements: Raw<Achievement>; marks: Raw<Mark>; space_prefs: Raw<SpacePref> }
```

In `data`'s type, after `  achievements: Achievement[];` add:

```ts
  /* your layer on your spaces: marks on their items, prefs for each (spec §4) */
  marks: Mark[];
  space_prefs: SpacePref[];
```

and replace its initial value `} = { profile: null, courses: [], items: [], quotes: [], study_sessions: [], achievements: [], shared_courses: [], shared_items: [], spaces: [] };` with:

```ts
} = { profile: null, courses: [], items: [], quotes: [], study_sessions: [], achievements: [], marks: [], space_prefs: [], shared_courses: [], shared_items: [], spaces: [] };
```

Replace the `normal` line with:

```ts
const normal: { [K in Kind]: (raw: RawOf[K]) => Rows[K] } = { items: normalizeItem, courses: normalizeCourse, quotes: normalizeQuote, study_sessions: normalizeStudySession, achievements: normalizeAchievement, marks: normalizeMark, space_prefs: normalizeSpacePref };
```

In `reload`, replace the snapshot's first line

```ts
    courses: await a('courses').all(), items: await a('items').all(), quotes: await a('quotes').all(), study_sessions: await a('study_sessions').all(), achievements: await a('achievements').all(),
```

with

```ts
    courses: await a('courses').all(), items: await a('items').all(), quotes: await a('quotes').all(), study_sessions: await a('study_sessions').all(), achievements: await a('achievements').all(),
    marks: await a('marks').all(), space_prefs: await a('space_prefs').all(),
```

Replace the `profile` function with:

```ts
const profile = (p: ServerProfile): Profile => ({
  ...p, maintenance: parseMaintenance(p.maintenance), types: Array.isArray(p.types) ? p.types : [],
  hiddenSources: Array.isArray(p.hiddenSources) ? p.hiddenSources.filter((s): s is string => typeof s === 'string') : [],
  studyFlow: normalizeFlow(p.studyFlow), studyPrefs: normalizePrefs(p.studyPrefs), coat: { name: '', role: '', color: DEFAULT_COAT, ...p.coat }, revision: p.revision || 0,
});
```

After the line `export const saveAchievement = (row: Raw<Achievement>) => saveRow('achievements', row);` add:

```ts
/** Your prefs for a space: whole-row, like your other rows. */
export const saveSpacePref = (row: Raw<SpacePref>) => saveRow('space_prefs', row);
/** Your mark on a shared item: it uploads with the mark it started from, since marks merge field by field (spec §6). */
export function saveMark(row: Raw<Mark>): Promise<Mark> {
  const clean = normalizeMark(structuredClone(row));
  return mutate(async (a) => {
    const before = await a('marks').get(clean.id);
    await a('marks').put(clean);
    await queue(a, `marks:${clean.id}`, 'put', clean as unknown as Row, (before as unknown as Row | undefined) ?? null);
    return clean;
  });
}
```

In `saveProfile`, replace `for (const key of ['displayName', 'theme', 'bg', 'termStart', 'types', 'studyFlow', 'studyPrefs', 'schoolCalendar'] as const)` with:

```ts
    for (const key of ['displayName', 'theme', 'bg', 'termStart', 'types', 'studyFlow', 'studyPrefs', 'schoolCalendar', 'hiddenSources'] as const)
```

In `resolveConflict`, replace

```ts
      await queue(a, conflict.key, conflict.op, body, parseKey(conflict.key).scope ? (current as Row | undefined) ?? null : undefined);
```

with

```ts
      const merges = !!parseKey(conflict.key).scope || conflict.key.startsWith('marks:');
      await queue(a, conflict.key, conflict.op, body, merges ? (current as Row | undefined) ?? null : undefined);
```

- [ ] **Step 7: The API (`src/core/api.ts`)**

After the `sharedPath` constant add:

```ts
/* A personal row's URL. A mark's id is '<space id>:<item id>', and its route /api/marks/<space>/<item> (spec §14). */
function rowPath(kind: string, id: string): string {
  if (kind !== 'marks') return `/api/${kind}/${encodeURIComponent(id)}`;
  const at = id.indexOf(':');
  return `/api/marks/${id.slice(0, at)}/${encodeURIComponent(id.slice(at + 1))}`;
}
```

Replace the three lines of `get`, `put` and `del` in `api` with:

```ts
  get: (kind: string, id: string) => record(request('GET', rowPath(kind, id)), id),
  /* `changed` for a mark only: {field: value before}, merged field by field (spec §6 Push) */
  put: (kind: string, id: string, row: { revision?: number; [field: string]: unknown }, changed?: Record<string, unknown>) =>
    record(request('PUT', rowPath(kind, id), changed ? { ...row, changed } : row, match(row.revision)), id, row.revision),
```

```ts
  del: (kind: string, id: string, revision = 0) => empty(request('DELETE', rowPath(kind, id), undefined, match(revision))),
```

(keep `revokeAll` between them where it is), and replace `const KINDS = ['courses', 'items', 'quotes', 'study_sessions', 'achievements'];` with:

```ts
/* a v3 page's kinds; marks and space prefs only ever in your own scope (checked below) */
const KINDS = ['courses', 'items', 'quotes', 'study_sessions', 'achievements', 'marks', 'space_prefs'];
```

- [ ] **Step 8: Sync (`src/core/sync.ts`)**

In `pushAll`, replace

```ts
        } else saved = await api.put(k.store, k.id, { ...op.body, revision: op.revision });
```

with

```ts
        } else if (k.store === 'marks') {
          /* your mark merges field by field: two of your devices may both have made it (spec §6) */
          saved = await api.put(k.store, k.id, { ...op.body, revision: op.revision }, changedFields('marks', '', op.body || {}, op.base));
        } else saved = await api.put(k.store, k.id, { ...op.body, revision: op.revision });
```

Replace the `rank` function with:

```ts
/* Upload order (spec §6): course puts, then items, then your marks and prefs (a mark on an item
   made offline needs the item first), then course deletes. */
function rank(op: PendingOp): number {
  if (/^(shared_)?courses:/.test(op.key)) return op.op === 'put' ? 0 : 3;
  return /^(marks|space_prefs):/.test(op.key) ? 2 : 1;
}
```

- [ ] **Step 9: Run the tests and the type check**

Run: `npm run test:local`, `npx vitest run test/sync.test.js test/api-client.test.js`, then `npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 10: Run the jsdom suite and fix whole-row expectations**

Run: `npm run test:ui`
Expected: PASS. Normalized items now carry `classId: null`, sessions and achievements `spaceId: null`. If a test compares a whole saved item, session or achievement with `toEqual` (or `toHaveBeenCalledWith` an exact object), add `classId: null` or `spaceId: null` to its expected value; nothing else changes.

- [ ] **Step 11: Commit**

```bash
git add src/core/types.ts src/core/model.ts src/core/db.ts src/core/store.ts src/core/api.ts src/core/sync.ts test/local-store.node.mjs test/sync.test.js test/api-client.test.js src
git commit -m "Client: IndexedDB 6 keeps your marks and prefs; marks upload with the fields they changed

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JpUR1JXMY3ehtkiJwuij95"
```

(`git add src` picks up only the test files Step 10 touched; check `git diff --cached --name-only` before committing.)

---

### Task 22: The effective lists merge your layer; keys for sessions and achievements; hidden sources

**Files:**
- Modify: `src/data/effective.ts` (whole file below), `src/data/effective.test.ts`
- Create: `src/data/refs.ts`, `src/data/refs.test.ts`
- Create: `src/data/sources.ts`
- Modify: `src/data/store.ts` (`useMarks`, `useSpacePrefs`)

- [ ] **Step 1: Write the failing tests**

In `src/data/effective.test.ts`, replace

```ts
vi.mock("@/core/store", () => ({ data: { items: [], courses: [], shared_items: [], shared_courses: [] }, subscribe: () => () => {} }))
```

with

```ts
vi.mock("@/core/store", () => ({ data: { profile: null, items: [], courses: [], shared_items: [], shared_courses: [], marks: [], space_prefs: [], spaces: [] }, subscribe: () => () => {} }))
```

replace `import { courseKeyOf, effectiveCourses, effectiveItems, keyOf, mergeCourses, mergeItems } from "./effective"` with

```ts
import { courseByKey, courseKeyOf, effectiveCourses, effectiveItems, itemByKey, keyOf, mergeCourses, mergeItems, onCalendar } from "./effective"
```

replace `import type { Course, Item } from "./types"` with `import type { Course, Item, Mark, SpacePref } from "./types"`, and append:

```ts
describe("your layer over a class", () => {
    const SID = "abcdefghij12"
    const mark = (id: string, over: Partial<Mark> = {}): Mark => ({ id: SID + ":" + id, spaceId: SID, itemId: id, status: "todo", grade: null, weight: null, notes: "", checklist: [], completedAt: null, hidden: false, ...over })
    const store = data as unknown as Record<string, unknown>

    it("puts your status, grade, weight, checklist and notes on a class item, and leaves out what you hid", () => {
        const shared = [{ ...item({ id: "a1", weight: 20, notes: "Teams of 3", courseId: "web" }), scope: WEB }, { ...item({ id: "h1", courseId: "web" }), scope: WEB }]
        const marks = new Map([[SID + ":a1", mark("a1", { status: "graded", grade: 87, notes: "mine", weight: 25 })], [SID + ":h1", mark("h1", { hidden: true })]])
        const out = mergeItems([], shared, true, { marks })
        expect(out.map(keyOf)).toEqual([WEB + "/a1"])
        expect(out[0]).toMatchObject({ status: "graded", grade: 87, weight: 25, notes: "mine", classWeight: 20, classNotes: "Teams of 3", spaceId: SID, courseKey: WEB + "/web" })
        expect(mergeItems([], [shared[0]], true)[0]).toMatchObject({ status: "todo", grade: null, weight: 20, notes: "", checklist: [] })
    })

    it("shows your items filed under a class at the class course's key, and keeps today's arrays when nothing is", () => {
        const own = [item({ id: "x" }), item({ id: "y", classId: SID })]
        const out = mergeItems(own, [], true, { classCourse: new Map([[SID, WEB + "/web"]]) })
        expect(out.map(courseKeyOf)).toEqual([null, WEB + "/web"])
        expect(out[0]).toBe(own[0])
        const plain = [item({ id: "x" })]
        expect(mergeItems(plain, [], true)).toBe(plain)
    })

    it("gives a class course your colour, target, semester and archive flag", () => {
        const pref: SpacePref = { id: SID, spaceId: SID, color: "#B8457E", target: 75, term: "Spring 2027", archived: true }
        const [c] = mergeCourses([], [{ ...course({ id: "web", color: "#17B3AE", term: "Fall 2026" }), scope: WEB }], true, { prefs: new Map([[SID, pref]]) })
        expect(c).toMatchObject({ key: WEB + "/web", spaceId: SID, color: "#B8457E", target: 75, term: "Spring 2027", archived: true })
    })

    it("shows shared rows only to an admin until classes open to everyone; anyone else gets the store's own arrays", () => {
        store.items = [item({ id: "a" })]
        store.courses = [course({ id: "bio" })]
        store.shared_items = [{ ...item({ id: "a1", courseId: "web" }), scope: WEB }]
        store.shared_courses = [{ ...course({ id: "web" }), scope: WEB }]
        store.profile = { id: "u1", isAdmin: false }
        expect(effectiveItems()).toBe(data.items)
        expect(effectiveCourses()).toBe(data.courses)
        store.profile = { id: "u1", isAdmin: true }
        expect(effectiveItems().map(keyOf)).toEqual(["a", WEB + "/a1"])
        expect(courseByKey(WEB + "/web")?.name).toBe("web")
        expect(itemByKey(WEB + "/a1")?.id).toBe("a1")
        expect(itemByKey("a")).toBe(data.items[0])
        store.profile = null
    })

    it("leaves hidden sources off the calendar, and returns the lists themselves with none hidden", () => {
        const items = mergeItems([item({ id: "p" }), item({ id: "b", courseId: "bio" }), item({ id: "f", classId: SID })], [{ ...item({ id: "a1", courseId: "web" }), scope: WEB }], true)
        const courses = mergeCourses([course({ id: "bio" })], [{ ...course({ id: "web" }), scope: WEB }], true)
        expect(onCalendar(items, courses, [])).toEqual({ items, courses })
        expect(onCalendar(items, courses, []).items).toBe(items)
        const shown = onCalendar(items, courses, ["space:" + SID, "personal"])
        expect(shown.items.map((it) => it.id)).toEqual(["b"])
        expect(shown.courses.map(keyOf)).toEqual(["bio"])
        expect(onCalendar(items, courses, ["course:bio"]).items.map((it) => it.id)).toEqual(["p", "f", "a1"])
    })
})
```

`src/data/refs.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"

vi.mock("@/core/store", () => ({
    data: { spaces: [{ id: "abcdefghij12", scope: "c:abcdefghij12" }], shared_courses: [{ scope: "c:abcdefghij12", id: "web" }] },
    subscribe: () => () => {},
}))

import { classCourseKey, courseRefKey, isSharedKey, itemCourseKey, itemRefKey, keyedAchievements, keyedCourses, keyedItems, keyedSessions, placeCourse, refOf, splitKey } from "./refs"
import type { Achievement, Course, Item, StudySession } from "./types"

const WEB = "c:abcdefghij12"
const session = (over: Partial<StudySession>): StudySession => ({ id: "s", courseId: "bio", itemId: null, startedAt: 1, studyMinutes: 30, roundsDone: 0, note: "", manual: false, ...over })

describe("keys", () => {
    it("tell a shared row's key from a personal id, and split it", () => {
        expect(isSharedKey(WEB + "/a1")).toBe(true)
        expect(isSharedKey("a1")).toBe(false)
        expect(isSharedKey("c:short/a1")).toBe(false)
        expect(splitKey(WEB + "/a/1")).toEqual({ scope: WEB, spaceId: "abcdefghij12", id: "a/1" })
        expect(splitKey("bio")).toEqual({ scope: null, spaceId: null, id: "bio" })
    })

    it("give a session on a class its course and item keys, and split them back for saving", () => {
        const s = session({ courseId: "web", itemId: "a1", spaceId: "abcdefghij12" })
        expect([courseRefKey(s), itemRefKey(s)]).toEqual([WEB + "/web", WEB + "/a1"])
        expect([courseRefKey(session({})), itemRefKey(session({ itemId: "x" }))]).toEqual(["bio", "x"])
        expect(refOf(WEB + "/web", WEB + "/a1")).toEqual({ courseId: "web", itemId: "a1", spaceId: "abcdefghij12" })
        expect(refOf("bio", null)).toEqual({ courseId: "bio", itemId: null, spaceId: null })
    })

    it("file an item of yours under a class when a class course is picked", () => {
        expect(placeCourse(WEB + "/web")).toEqual({ courseId: null, classId: "abcdefghij12" })
        expect(placeCourse("bio")).toEqual({ courseId: "bio", classId: null })
        expect(placeCourse("")).toEqual({ courseId: null, classId: null })
        expect(classCourseKey("abcdefghij12")).toBe(WEB + "/web")
        expect(itemCourseKey({ courseId: null, classId: "abcdefghij12" })).toBe(WEB + "/web")
        expect(itemCourseKey({ courseId: "bio", classId: null })).toBe("bio")
    })
})

describe("keyed lists", () => {
    it("are the lists themselves when nothing in them is shared", () => {
        const sessions = [session({})], courses = [{ id: "bio" }] as Course[], items = [{ id: "a", courseId: "bio" }] as Item[], own = [{ id: "x", courseId: "bio" }] as Achievement[]
        expect(keyedSessions(sessions)).toBe(sessions)
        expect(keyedCourses(courses)).toBe(courses)
        expect(keyedItems(items)).toBe(items)
        expect(keyedAchievements(own)).toBe(own)
    })

    it("put shared rows in key space, the same list for the same input", () => {
        const sessions = [session({}), session({ id: "t", courseId: "web", spaceId: "abcdefghij12" })]
        expect(keyedSessions(sessions).map((s) => s.courseId)).toEqual(["bio", WEB + "/web"])
        expect(keyedSessions(sessions)).toBe(keyedSessions(sessions))
        const items = [{ id: "a", courseId: "bio" }, { id: "f", courseId: null, classId: "abcdefghij12", courseKey: WEB + "/web" }, { id: "a1", courseId: "web", key: WEB + "/a1", courseKey: WEB + "/web" }] as Item[]
        expect(keyedItems(items).map((it) => [it.id, it.courseId])).toEqual([["a", "bio"], ["f", WEB + "/web"], [WEB + "/a1", WEB + "/web"]])
        expect(keyedCourses([{ id: "bio" }, { id: "web", key: WEB + "/web" }] as Course[]).map((c) => c.id)).toEqual(["bio", WEB + "/web"])
    })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run src/data/effective.test.ts src/data/refs.test.ts`
Expected: FAIL: `./refs` does not exist; `onCalendar`, `courseByKey`, `itemByKey` are not exported.

- [ ] **Step 3: `src/data/effective.ts`**

Replace the whole file with:

```ts
// What every view reads: your own courses and items and, for an admin until Stage 6, your
// classes' and projects', with your layer on top (spec §7). A class course and a personal
// course may share an id, so a shared row carries `key` '<scope>/<id>' and items name their
// course by `courseKey`. A class course takes your prefs (colour, target, semester,
// archived); a class item your mark (status, grade, weight, checklist, notes, completion),
// and is left out when you hid it; an item of yours filed under a class shows under the
// class's course. Otherwise a personal row is left as it is and its key is its id: with no
// shared row and nothing filed under a class these are the store's arrays themselves, so
// anyone without a class sees exactly what they saw before.

import { data } from "@/core/store"
import type { Course, Item, Mark, SharedCourse, SpacePref } from "./types"

/** Where a row comes from; a personal row has none. */
export type Source = "class" | "project"
export type EffectiveCourse = Course & { key?: string; scope?: string; source?: Source; spaceId?: string }
export type EffectiveItem = Item & {
    key?: string; scope?: string; source?: Source; courseKey?: string | null; spaceId?: string
    /** a shared item's: your mark on it, and the class's own weight and notes under yours */
    mark?: Mark | null; classWeight?: number | null; classNotes?: string
}

/** Shared rows are in the views, with marks and the split item card. */
export const SHARED_IN_VIEWS = true
/** Classes are for admins until Stage 6 opens them to everyone (spec §22); Stage 6 removes this. */
export const CLASSES_ADMIN_ONLY = true
/** Whether this person's views show their classes and projects. */
export const sharedShown = (): boolean => SHARED_IN_VIEWS && (!CLASSES_ADMIN_ONLY || !!data.profile?.isAdmin)

/** A row's key in the views: '<scope>/<id>' for a shared row, the id for your own. */
export const keyOf = (r: { id: string; key?: string }): string => r.key ?? r.id
/** The key of an item's course: a shared item's course is in its own scope; yours filed under a class, the class's. */
export const courseKeyOf = (it: EffectiveItem): string | null => (it.courseKey !== undefined ? it.courseKey : it.courseId)

const sourceOf = (scope: string): Source => (scope.startsWith("p:") ? "project" : "class")

/** What a merge reads besides the rows: your marks by id, your prefs by space id, each class's course key by space id. */
export interface Layer { marks?: ReadonlyMap<string, Mark>; prefs?: ReadonlyMap<string, SpacePref>; classCourse?: ReadonlyMap<string, string> }

export function mergeCourses(own: Course[], shared: (Course & { scope: string })[], show: boolean, layer: Layer = {}): EffectiveCourse[] {
    if (!show || !shared.length) return own
    return [...own, ...shared.map((c) => {
        const spaceId = c.scope.slice(2), p = layer.prefs?.get(spaceId)
        return {
            ...c, key: c.scope + "/" + c.id, source: sourceOf(c.scope), spaceId,
            ...(p ? { color: p.color, target: p.target, term: p.term, archived: p.archived } : {}),
        }
    })]
}

/* Your mark over a shared item: on a class's, your status, grade, weight, checklist, notes and
   completion; on a project's, only your notes (its status and checklist are the team's). */
function withMark(it: Item & { scope: string }, mark: Mark | null): EffectiveItem {
    const spaceId = it.scope.slice(2)
    const base: EffectiveItem = {
        ...it, key: it.scope + "/" + it.id, source: sourceOf(it.scope), spaceId,
        courseKey: it.courseId ? it.scope + "/" + it.courseId : null,
        mark, classWeight: it.weight, classNotes: it.notes, notes: mark?.notes ?? "",
    }
    if (it.scope.startsWith("p:")) return base
    return {
        ...base, status: mark?.status ?? "todo", grade: mark?.grade ?? null, weight: mark?.weight ?? it.weight,
        checklist: mark?.checklist ?? [], completedAt: mark?.completedAt ?? null,
    }
}

export function mergeItems(own: Item[], shared: (Item & { scope: string })[], show: boolean, layer: Layer = {}): EffectiveItem[] {
    const filed = show && own.some((it) => it.classId)
    if (!show || (!shared.length && !filed)) return own
    const mine: EffectiveItem[] = filed ? own.map((it) => (it.classId ? { ...it, courseKey: layer.classCourse?.get(it.classId) ?? null } : it)) : own
    const theirs: EffectiveItem[] = []
    for (const it of shared) {
        const mark = layer.marks?.get(it.scope.slice(2) + ":" + it.id) ?? null
        if (!mark?.hidden) theirs.push(withMark(it, mark))
    }
    return [...mine, ...theirs]
}

/* ── the live lists, memoised on the store's arrays (new after every reload), so each is a
   stable snapshot for useSyncExternalStore ── */

const NONE: never[] = []
const classCourses = (shared: SharedCourse[]) =>
    new Map(shared.filter((c) => c.scope.startsWith("c:")).map((c) => [c.scope.slice(2), c.scope + "/" + c.id]))

let courses = { own: null as unknown, shared: null as unknown, prefs: null as unknown, show: false, out: [] as EffectiveCourse[] }
let items = { own: null as unknown, shared: null as unknown, marks: null as unknown, classes: null as unknown, show: false, out: [] as EffectiveItem[] }

export function effectiveCourses(): EffectiveCourse[] {
    const show = sharedShown(), prefs: SpacePref[] = data.space_prefs ?? NONE, shared = data.shared_courses ?? NONE
    if (courses.own !== data.courses || courses.shared !== shared || courses.prefs !== prefs || courses.show !== show) {
        courses = { own: data.courses, shared, prefs, show, out: mergeCourses(data.courses, shared, show, { prefs: new Map(prefs.map((p) => [p.spaceId, p])) }) }
    }
    return courses.out
}

export function effectiveItems(): EffectiveItem[] {
    const show = sharedShown(), marks: Mark[] = data.marks ?? NONE, shared = data.shared_items ?? NONE, classes = data.shared_courses ?? NONE
    if (items.own !== data.items || items.shared !== shared || items.marks !== marks || items.classes !== classes || items.show !== show) {
        items = {
            own: data.items, shared, marks, classes, show,
            out: mergeItems(data.items, shared, show, { marks: new Map(marks.map((m) => [m.id, m])), classCourse: classCourses(classes) }),
        }
    }
    return items.out
}

/* ── a row by its key ── */

let lookup = { courses: null as EffectiveCourse[] | null, items: null as EffectiveItem[] | null, c: new Map<string, EffectiveCourse>(), i: new Map<string, EffectiveItem>() }
function lookups() {
    const cs = effectiveCourses(), is = effectiveItems()
    if (lookup.courses !== cs) lookup = { ...lookup, courses: cs, c: new Map(cs.map((c) => [keyOf(c), c])) }
    if (lookup.items !== is) lookup = { ...lookup, items: is, i: new Map(is.map((it) => [keyOf(it), it])) }
    return lookup
}
/** A course in the views by its key: your own by its id, a class's by '<scope>/<id>'. */
export const courseByKey = (key: string | null | undefined): EffectiveCourse | null => (key ? lookups().c.get(key) ?? null : null)
/** An item in the views by its key. */
export const itemByKey = (key: string | null | undefined): EffectiveItem | null => (key ? lookups().i.get(key) ?? null : null)

/* ── the calendar's sources (spec §9): what an eye toggle hides ── */

export const courseSource = (c: EffectiveCourse): string => (c.spaceId ? "space:" + c.spaceId : "course:" + c.id)
export const itemSource = (it: EffectiveItem): string =>
    it.spaceId ? "space:" + it.spaceId : it.classId ? "space:" + it.classId : it.courseId ? "course:" + it.courseId : "personal"

/** What the Week and the Month show: the rows whose source you did not hide. With nothing hidden, the lists themselves. */
export function onCalendar<I extends EffectiveItem, C extends EffectiveCourse>(items: I[], courses: C[], hidden: readonly string[]): { items: I[]; courses: C[] } {
    if (!hidden.length) return { items, courses }
    const off = new Set(hidden)
    return { items: items.filter((it) => !off.has(itemSource(it))), courses: courses.filter((c) => !off.has(courseSource(c))) }
}
```

- [ ] **Step 4: `src/data/refs.ts`**

```ts
// Keys for what a study session, an achievement or a picker points at (spec §7): a course or
// item of yours by its id; a class's or a project's by '<scope>/<id>'. A session or an
// achievement names a shared row with its `spaceId`, so its keys are built from that. The
// study pickers, History, Today, the badges, and the session and achievement sheets work on
// keyed lists, in which every row's `id` (and an item's `courseId`) is its key: a class
// course and a personal course with the same id stay apart. A row with nothing shared about
// it is left as it is, and a list with none is returned itself.

import { data } from "@/core/store"
import { courseKeyOf, keyOf, type EffectiveCourse, type EffectiveItem } from "./effective"
import type { Achievement, Course, Item, StudySession } from "./types"

const SHARED_KEY = /^([cp]:[a-z0-9]{12})\/(.+)$/s
/** A shared row's key, '<scope>/<id>'. A personal id never looks like one (ids come from uid()). */
export const isSharedKey = (key: string | null | undefined): key is string => !!key && SHARED_KEY.test(key)
/** A key's scope, space and id; a personal key has neither scope nor space. */
export function splitKey(key: string): { scope: string | null; spaceId: string | null; id: string } {
    const m = SHARED_KEY.exec(key)
    return m ? { scope: m[1], spaceId: m[1].slice(2), id: m[2] } : { scope: null, spaceId: null, id: key }
}
/** A space's scope as this device knows it; a class's while the space is not here yet. */
export const scopeOfSpace = (spaceId: string): string => (data.spaces ?? []).find((s) => s.id === spaceId)?.scope ?? "c:" + spaceId
const refKey = (spaceId: string | null | undefined, id: string | null): string | null => (id && spaceId ? scopeOfSpace(spaceId) + "/" + id : id)
/** The key of the course a session or an achievement is on. */
export const courseRefKey = (r: { courseId: string | null; spaceId?: string | null }): string | null => refKey(r.spaceId, r.courseId)
/** The key of the item a session or an achievement is on. */
export const itemRefKey = (r: { itemId: string | null; spaceId?: string | null }): string | null => refKey(r.spaceId, r.itemId)
/** What a session or an achievement stores for the keys picked: the ids, and the space they are in. */
export function refOf(courseKey: string | null, itemKey: string | null): { courseId: string | null; itemId: string | null; spaceId: string | null } {
    const c = courseKey ? splitKey(courseKey) : null, i = itemKey ? splitKey(itemKey) : null
    return { courseId: c?.id ?? null, itemId: i?.id ?? null, spaceId: c?.spaceId ?? i?.spaceId ?? null }
}

/** The key of a class's course, from its space id. */
export function classCourseKey(spaceId: string): string | null {
    const c = (data.shared_courses ?? []).find((x) => x.scope === "c:" + spaceId)
    return c ? c.scope + "/" + c.id : null
}
/** The course key an item of yours is shown under: its course, or its class's course. */
export const itemCourseKey = (it: { courseId: string | null; classId?: string | null }): string | null =>
    (it.classId ? classCourseKey(it.classId) : it.courseId)
/** Where an item of yours goes for a course key picked: under a course of yours, or filed under a class (spec §5). */
export const placeCourse = (key: string | null): { courseId: string | null; classId: string | null } =>
    (isSharedKey(key) ? { courseId: null, classId: splitKey(key).spaceId } : { courseId: key || null, classId: null })

/* ── keyed lists, kept per list given, so a list stays the same list for useMemo ── */

function keyed<T>(cache: WeakMap<T[], T[]>, list: T[], shared: (r: T) => boolean, map: (r: T) => T): T[] {
    if (!list.some(shared)) return list
    let out = cache.get(list)
    if (!out) { out = list.map((r) => (shared(r) ? map(r) : r)); cache.set(list, out) }
    return out
}
const sessionsKeyed = new WeakMap<StudySession[], StudySession[]>()
const achievementsKeyed = new WeakMap<Achievement[], Achievement[]>()
const itemsKeyed = new WeakMap<Item[], Item[]>()
const coursesKeyed = new WeakMap<Course[], Course[]>()

export const keyedSessions = (list: StudySession[]): StudySession[] =>
    keyed(sessionsKeyed, list, (s) => !!s.spaceId, (s) => ({ ...s, courseId: courseRefKey(s), itemId: itemRefKey(s) }))
export const keyedAchievements = (list: Achievement[]): Achievement[] =>
    keyed(achievementsKeyed, list, (a) => !!a.spaceId, (a) => ({ ...a, courseId: courseRefKey(a), itemId: itemRefKey(a) }))
export const keyedItems = (list: EffectiveItem[]): Item[] =>
    keyed(itemsKeyed, list as Item[], (it) => (it as EffectiveItem).courseKey !== undefined, (it) => ({ ...it, id: keyOf(it), courseId: courseKeyOf(it) }))
export const keyedCourses = (list: EffectiveCourse[]): Course[] =>
    keyed(coursesKeyed, list as Course[], (c) => !!(c as EffectiveCourse).key, (c) => ({ ...c, id: keyOf(c) }))
```

- [ ] **Step 5: `src/data/sources.ts`**

```ts
// Your eye toggles (spec §9): the sources you hid from your Week and Month, kept in the
// profile's hiddenSources ('course:<id>', 'space:<sid>', 'personal') and synced with it.
// All items, the stat tiles and grades still count them; the calendar feed honours them from
// Stage 6.

import * as store from "@/core/store"
import { data } from "@/core/store"
import { notify } from "@/bridge"
import { toast } from "./toast"

/** The most sources you can hide at once (the profile's CHECK). */
export const HIDDEN_MAX = 40
export const hiddenSources = (): string[] => data.profile?.hiddenSources ?? []

/** Hide a source, or show it again. */
export async function toggleSource(source: string): Promise<void> {
    const now = hiddenSources()
    if (!now.includes(source) && now.length >= HIDDEN_MAX) { toast("You can hide " + HIDDEN_MAX + " at most. Show one again first."); return }
    await store.saveProfile({ hiddenSources: now.includes(source) ? now.filter((s) => s !== source) : [...now, source] })
    notify()
}
```

- [ ] **Step 6: The hooks (`src/data/store.ts`)**

After the line `export const useSharedItems = () => useSyncExternalStore(subscribe, sharedItems)` (Stage 3) add:

```ts
const marks = () => data.marks ?? NONE
const spacePrefs = () => data.space_prefs ?? NONE
/** Your marks on shared items, and your prefs for your spaces: the class item card and the class sheet read them. */
export const useMarks = () => useSyncExternalStore(subscribe, marks)
export const useSpacePrefs = () => useSyncExternalStore(subscribe, spacePrefs)
```

- [ ] **Step 7: Run the tests and the type check**

Run: `npx vitest run src/data/effective.test.ts src/data/refs.test.ts src/data/views.test.ts`, then `npm run typecheck`
Expected: PASS, no type errors. (Stage 2's three tests still pass: the first has no profile, so nothing is shown.)

- [ ] **Step 8: Commit**

```bash
git add src/data/effective.ts src/data/effective.test.ts src/data/refs.ts src/data/refs.test.ts src/data/sources.ts src/data/store.ts
git commit -m "Views: classes join an admin's lists with your marks and prefs; keys for sessions; hidden sources

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JpUR1JXMY3ehtkiJwuij95"
```

---

### Task 23: The class item card (Class and Yours), and new items into a class

**Files:**
- Create: `src/data/marks.ts`, `src/data/marks.test.ts`
- Create: `src/components/sheet/item-parts.tsx` (the checklist and links, moved out of `item-sheet.tsx`)
- Create: `src/components/sheet/class-item-sheet.tsx`, `src/components/sheet/class-item-sheet.test.tsx`
- Modify: `src/components/sheet/item-sheet.tsx`, `src/components/sheet/sheet.tsx`

- [ ] **Step 1: Write the failing tests**

`src/data/marks.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const fake = vi.hoisted(() => ({
    data: {
        profile: { id: "u-me", isAdmin: true }, items: [] as unknown[], courses: [] as unknown[],
        shared_items: [] as unknown[], shared_courses: [] as unknown[], marks: [] as unknown[], space_prefs: [] as unknown[], spaces: [] as unknown[],
    },
    store: { saveMark: vi.fn(async () => {}), saveShared: vi.fn(async () => {}), saveItem: vi.fn(async () => {}) },
}))
vi.mock("@/core/store", () => ({ data: fake.data, ...fake.store, subscribe: () => () => {} }))

import { addToClass, ago, canAddToClass, editedBy, editMark, flushTyping, hiddenIn, hideAsks, markStatus, typeMark } from "./marks"
import type { Item } from "./types"

const SID = "abcdefghij12", WEB = "c:" + SID
beforeEach(() => {
    fake.data.spaces = [{ id: SID, scope: WEB, kind: "class", role: "editor", archived: false, members: [{ userId: "u-gab", name: "Gabriel", role: "owner" }] }]
    fake.data.shared_courses = [{ scope: WEB, id: "web" }]
    fake.data.shared_items = [{ scope: WEB, id: "a1", title: "REST API", courseId: "web" }, { scope: WEB, id: "h1", title: "Hidden", courseId: "web" }]
    fake.data.marks = [{ id: SID + ":h1", spaceId: SID, itemId: "h1", hidden: true, notes: "" }]
})
afterEach(() => { vi.clearAllMocks(); vi.useRealTimers() })

describe("your mark", () => {
    it("is made on first touch, with text still waiting saved along", async () => {
        vi.useFakeTimers()
        typeMark(WEB + "/a1", { notes: "Teams of 3" })
        await editMark(WEB + "/a1", { status: "done" })
        expect(fake.store.saveMark).toHaveBeenCalledWith({ id: SID + ":a1", spaceId: SID, itemId: "a1", notes: "Teams of 3", status: "done" })
        await vi.runAllTimersAsync()
        expect(fake.store.saveMark).toHaveBeenCalledTimes(1)
    })

    it("saves typing once it pauses, or when the card closes", async () => {
        vi.useFakeTimers()
        typeMark(WEB + "/h1", { notes: "a" })
        typeMark(WEB + "/h1", { notes: "ab" })
        expect(fake.store.saveMark).not.toHaveBeenCalled()
        await vi.advanceTimersByTimeAsync(500)
        expect(fake.store.saveMark).toHaveBeenCalledWith(expect.objectContaining({ id: SID + ":h1", notes: "ab", hidden: true }))
        typeMark(WEB + "/h1", { notes: "abc" })
        await flushTyping()
        expect(fake.store.saveMark).toHaveBeenCalledTimes(2)
    })

    it("keeps when it was finished, and asks before hiding a grade", () => {
        expect(markStatus({ completedAt: 5 }, "done")).toEqual({ status: "done", completedAt: 5 })
        expect(markStatus({ completedAt: 5 }, "todo")).toEqual({ status: "todo", completedAt: null })
        expect(hideAsks({ grade: 87, status: "graded" })).toBe(true)
        expect(hideAsks({ grade: null, status: "graded" })).toBe(true)
        expect(hideAsks({ grade: null, status: "done" })).toBe(false)
        expect(hideAsks(null)).toBe(false)
    })

    it("lists what you hid in a class", () => {
        expect(hiddenIn(WEB).map((it) => it.id)).toEqual(["h1"])
    })
})

describe("who changed it", () => {
    it("is named, with how long ago", () => {
        const now = Date.UTC(2026, 9, 6, 12), space = { members: [{ userId: "u-gab", name: "Gabriel", role: "owner" }] }
        expect([ago(now - 30_000, now), ago(now - 5 * 60_000, now), ago(now - 2 * 3_600_000, now), ago(now - 26 * 3_600_000, now), ago(now - 3 * 86_400_000, now)])
            .toEqual(["just now", "5 min ago", "2h ago", "yesterday", "3 days ago"])
        expect(editedBy({ updatedBy: "u-gab", updatedAt: now - 2 * 3_600_000 }, space, "u-me", now)).toBe("Edited by Gabriel · 2h ago")
        expect(editedBy({ updatedBy: "u-me", updatedAt: now }, space, "u-me", now)).toBe("Edited by you · just now")
        expect(editedBy({ updatedBy: "u-gone", updatedAt: null }, space, "u-me", now)).toBe("Edited by a former member")
        expect(editedBy({ updatedBy: null, updatedAt: now }, space, "u-me", now)).toBe("")
    })
})

describe("a new item with a class picked", () => {
    it("can go into the class for its owner or an editor, built-in types only", () => {
        expect(canAddToClass({ type: "quiz", classId: SID })).toBe(true)
        expect(canAddToClass({ type: "c-viva", classId: SID })).toBe(false)
        expect(canAddToClass({ type: "quiz", classId: null })).toBe(false)
        ;(fake.data.spaces[0] as { role: string }).role = "member"
        expect(canAddToClass({ type: "quiz", classId: SID })).toBe(false)
    })

    it("becomes the class's row under its one course, with nothing of yours on it", async () => {
        await addToClass({ id: "n1", type: "quiz", title: "Quiz 2", courseId: null, classId: SID, status: "done", grade: 90, checklist: [{ id: "k", text: "x", done: true }], completedAt: 5 } as Item)
        expect(fake.store.saveShared).toHaveBeenCalledWith("shared_items", expect.objectContaining({
            scope: WEB, id: "n1", courseId: "web", classId: null, status: "todo", grade: null, checklist: [], completedAt: null,
        }))
    })
})
```

`src/components/sheet/class-item-sheet.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

// The class item card with the store, the overlay and the toast as fakes; the effective
// lists, the marks rules and the item rules are the real ones.
const fake = vi.hoisted(() => ({
    data: {
        profile: { id: "u-me", isAdmin: true } as Record<string, unknown>,
        courses: [] as unknown[], items: [] as unknown[], quotes: [] as unknown[], study_sessions: [] as unknown[], achievements: [] as unknown[],
        spaces: [] as unknown[], shared_courses: [] as unknown[], shared_items: [] as unknown[], marks: [] as unknown[], space_prefs: [] as unknown[],
    },
    store: { saveMark: vi.fn(async () => {}), saveShared: vi.fn(async () => {}), removeShared: vi.fn(async () => {}) },
    overlay: { closeSheet: vi.fn(), openSheet: vi.fn(), replaceSheet: vi.fn(), beforeSheetClose: new Set<() => void>() },
    toast: vi.fn(),
}))
vi.mock("@/core/store", () => ({ data: fake.data, ...fake.store, subscribe: () => () => {} }))
vi.mock("@/data/overlay", () => fake.overlay)
vi.mock("@/data/toast", () => ({ toast: fake.toast }))

import { ClassItemSheet } from "./class-item-sheet"

const SID = "sp0000000001", WEB = "c:" + SID, KEY = WEB + "/a1", HOUR = 3_600_000
const space = (role: string) => ({
    id: SID, scope: WEB, kind: "class", role, archived: false, name: "Web Services", parent: null, revision: 3,
    members: [{ userId: "u-me", name: "George", role }, { userId: "u-gab", name: "Gabriel", role: "owner" }],
})
const course = { scope: WEB, id: "web", code: "CS 446", name: "Web Services", color: "#17B3AE", instructor: "", term: "", archived: false, target: null, meetings: [] }
const row = () => ({
    scope: WEB, id: "a1", type: "assignment", title: "REST API Project", courseId: "web", date: "2026-10-15", start: "", end: "", where: "Lab 2",
    status: "todo", grade: null, weight: 20, notes: "Teams of 3", checklist: [], links: [], recur: null, weekday: null, recurUntil: null, dept: "",
    completedAt: null, updatedBy: "u-gab", updatedAt: Date.now() - 2 * HOUR, assignees: [], completedBy: null, revision: 4,
})
const graded = { id: SID + ":a1", spaceId: SID, itemId: "a1", status: "graded", grade: 87, weight: 25, notes: "", checklist: [], completedAt: 1, hidden: false }

beforeEach(() => {
    Object.assign(fake.data, { spaces: [space("member")], shared_courses: [course], shared_items: [row()], marks: [], space_prefs: [], study_sessions: [] })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe("a class item, for a member", () => {
    it("shows the class's facts locked, with who changed them, and keeps your status in your mark", async () => {
        render(<ClassItemSheet itemKey={KEY} />)
        expect(screen.getByRole("heading", { name: "REST API Project" })).toBeTruthy()
        expect(screen.queryByRole("textbox", { name: "Title" })).toBeNull()
        expect(screen.getByText("Edited by Gabriel · 2h ago")).toBeTruthy()
        expect(screen.getByText("Teams of 3")).toBeTruthy()
        fireEvent.click(screen.getByRole("button", { name: "Graded" }))
        await waitFor(() => expect(fake.store.saveMark).toHaveBeenCalledWith(expect.objectContaining({ id: SID + ":a1", status: "graded" })))
    })

    it("takes your own weight, and offers the class's back", async () => {
        fake.data.marks = [graded]
        render(<ClassItemSheet itemKey={KEY} />)
        expect(screen.getByText("The class weight is 20%.")).toBeTruthy()
        fireEvent.click(screen.getByRole("button", { name: "Use class weight" }))
        await waitFor(() => expect(fake.store.saveMark).toHaveBeenCalledWith(expect.objectContaining({ weight: null })))
    })

    it("asks before hiding a graded item, then hides it", async () => {
        fake.data.marks = [graded]
        render(<ClassItemSheet itemKey={KEY} />)
        fireEvent.click(screen.getByRole("button", { name: "Not mine · hide it" }))
        expect(screen.getByText(/Your grade of 87% stops counting in Web Services/)).toBeTruthy()
        expect(fake.store.saveMark).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole("button", { name: "Hide it" }))
        await waitFor(() => expect(fake.store.saveMark).toHaveBeenCalledWith(expect.objectContaining({ hidden: true })))
        expect(fake.overlay.closeSheet).toHaveBeenCalled()
    })
})

describe("a class item, for an editor", () => {
    beforeEach(() => { fake.data.spaces = [space("editor")] })

    it("changes the class's facts for everyone", async () => {
        render(<ClassItemSheet itemKey={KEY} />)
        expect(screen.getByRole("textbox", { name: "Title" })).toBeTruthy()
        fireEvent.change(screen.getByRole("spinbutton", { name: "Weight" }), { target: { value: "25" } })
        await waitFor(() => expect(fake.store.saveShared).toHaveBeenCalledWith("shared_items", expect.objectContaining({ scope: WEB, id: "a1", weight: 25 })))
    })

    it("deletes it for everyone, after asking", async () => {
        render(<ClassItemSheet itemKey={KEY} />)
        fireEvent.click(screen.getByRole("button", { name: "Delete for everyone" }))
        fireEvent.click(screen.getByRole("button", { name: "Delete it" }))
        await waitFor(() => expect(fake.store.removeShared).toHaveBeenCalledWith("shared_items", WEB, "a1"))
    })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run src/data/marks.test.ts src/components/sheet/class-item-sheet.test.tsx`
Expected: FAIL: `./marks` and `./class-item-sheet` do not exist.

- [ ] **Step 3: `src/data/marks.ts`**

```ts
// Your layer on a class's item, and the class's own row, edited from the item card (spec §4,
// §15). Your status, grade, weight, checklist, notes and "not mine" go into your mark,
// '<space id>:<item id>', made on first touch; the class's facts into its shared row (its
// owner and editors). Text saves once typing pauses, as for your own items (item-edit.ts).

import { useSyncExternalStore } from "react"
import * as store from "@/core/store"
import { data } from "@/core/store"
import { isOpen } from "@/core/model"
import type { Row } from "@/core/db"
import { celebrate, TYPING_MS } from "./item-edit"
import { itemByKey } from "./effective"
import { splitKey } from "./refs"
import type { Item, Mark, SharedCourse, SharedItem, Space } from "./types"

/** Your mark's id for a shared item's key ('c:<space>/<item>' → '<space>:<item>'). */
export const markIdOf = (key: string): string => { const k = splitKey(key); return k.spaceId + ":" + k.id }
/** Your mark on the item with this key, if you have touched it. */
export const markFor = (key: string): Mark | null => (data.marks ?? []).find((m) => m.id === markIdOf(key)) ?? null

/* ── typing: one row's text waits for the pause ── */

let version = 0
const listeners = new Set<() => void>()
const bump = () => { version++; for (const fn of listeners) fn() }
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }
/** Redraws while text is waiting to save, and when it has. */
export const useTyping = () => useSyncExternalStore(subscribe, () => version)

function typist<T>(save: (key: string, patch: Partial<T>) => Promise<unknown>) {
    let held: { key: string; patch: Partial<T>; timer: ReturnType<typeof setTimeout> } | null = null
    const flush = async () => {
        const h = held
        held = null
        if (!h) return
        clearTimeout(h.timer)
        try { await save(h.key, h.patch) } finally { bump() }
    }
    return {
        type(key: string, patch: Partial<T>) {
            if (held && held.key !== key) void flush()
            clearTimeout(held?.timer)
            held = { key, patch: { ...(held?.key === key ? held.patch : {}), ...patch }, timer: setTimeout(() => void flush(), TYPING_MS) }
            bump()
        },
        /** What waits for `key`, taken off: the save about to happen carries it. */
        take(key: string): Partial<T> {
            if (held?.key !== key) return {}
            const p = held.patch
            clearTimeout(held.timer)
            held = null
            return p
        },
        peek: (key: string): Partial<T> => (held?.key === key ? held.patch : {}),
        flush,
    }
}

async function saveMark(key: string, patch: Partial<Mark>) {
    const k = splitKey(key), held = markFor(key)
    await store.saveMark({ ...(held ?? { id: k.spaceId + ":" + k.id, spaceId: k.spaceId!, itemId: k.id }), ...patch })
}
async function saveRow(key: string, patch: Partial<SharedItem>) {
    const k = splitKey(key), row = (data.shared_items ?? []).find((it) => it.scope === k.scope && it.id === k.id)
    if (!row) return
    await store.saveShared("shared_items", { ...row, ...patch } as unknown as Row & { scope: string })
}
const markTyping = typist<Mark>(saveMark)
const rowTyping = typist<SharedItem>(saveRow)

/** Your mark, saved now, with any of its text still waiting. */
export const editMark = (key: string, patch: Partial<Mark>) => saveMark(key, { ...markTyping.take(key), ...patch })
/** Text in your mark (notes, a step): saved once typing pauses. */
export const typeMark = (key: string, patch: Partial<Mark>) => markTyping.type(key, patch)
/** The class's row, saved now (owner and editors), with any of its text still waiting. */
export const editRow = (key: string, patch: Partial<SharedItem>) => saveRow(key, { ...rowTyping.take(key), ...patch })
/** Text in the class's row (title, room, class notes): saved once typing pauses. */
export const typeRow = (key: string, patch: Partial<SharedItem>) => rowTyping.type(key, patch)
/** What is typed but not saved yet, to show over the stored row. */
export const pendingMark = (key: string): Partial<Mark> => markTyping.peek(key)
export const pendingRow = (key: string): Partial<SharedItem> => rowTyping.peek(key)
/** Save whatever is waiting: the card is closing. */
export const flushTyping = async () => { await Promise.all([markTyping.flush(), rowTyping.flush()]) }

/** A status on your mark, with when it was finished (kept if it already was). */
export const markStatus = (mark: Pick<Mark, "completedAt"> | null, status: string): Pick<Mark, "status" | "completedAt"> =>
    ({ status, completedAt: status === "todo" ? null : mark?.completedAt || Date.now() })

/** Tick a class's task off or back on from the board, in your mark. */
export async function toggleClassTask(key: string, from?: Element) {
    const it = itemByKey(key)
    if (!it) return
    const finishing = isOpen(it)
    if (finishing && from) celebrate(from)
    await editMark(key, markStatus(markFor(key), finishing ? "done" : "todo"))
}

/** Hiding means "not mine" (spec §15): asked first when the mark holds a grade. */
export const hideAsks = (mark: Pick<Mark, "grade" | "status"> | null): boolean => mark?.grade != null || mark?.status === "graded"
export const setHidden = (key: string, hidden: boolean) => editMark(key, { hidden })

/** Your hidden items in a class, for its sheet's Show again. */
export function hiddenIn(scope: string, items: SharedItem[] = data.shared_items ?? [], marks: Mark[] = data.marks ?? []): SharedItem[] {
    const off = new Set(marks.filter((m) => m.hidden).map((m) => m.id))
    return items.filter((it) => it.scope === scope && off.has(scope.slice(2) + ":" + it.id))
}

/* ── a new item with a class picked ── */

/** Whether a new item can go into the class itself: you are its owner or an editor, it is not archived, and the type is built in (the c: CHECK). */
export function canAddToClass(row: { type: string; classId?: string | null }): boolean {
    const space = row.classId ? (data.spaces ?? []).find((s) => s.id === row.classId) : null
    return !!space && space.kind === "class" && space.role !== "member" && !space.archived && !row.type.startsWith("c-")
}

/** A new item an owner or editor adds to a class (spec §20): the class's row under its one course, with nothing of yours on it. */
export async function addToClass(row: Item) {
    const scope = "c:" + row.classId, course = (data.shared_courses ?? []).find((c) => c.scope === scope)
    if (!course) { await store.saveItem(row); return }
    await store.saveShared("shared_items", {
        ...row, scope, courseId: course.id, classId: null, status: "todo", grade: null, checklist: [], completedAt: null,
    } as unknown as Row & { scope: string })
}

/* ── who changed it ── */

/** "2h ago": roughly how long since a write. */
export function ago(ms: number | null | undefined, now = Date.now()): string {
    if (!ms) return ""
    const s = Math.max(0, Math.round((now - ms) / 1000))
    if (s < 60) return "just now"
    const m = Math.round(s / 60)
    if (m < 60) return m + " min ago"
    const h = Math.round(m / 60)
    if (h < 24) return h + "h ago"
    const d = Math.round(h / 24)
    return d === 1 ? "yesterday" : d + " days ago"
}

/** "Edited by Alex · 2h ago" for a shared row: "you" for your own write, "a former member" for an account gone (spec §4). */
export function editedBy(row: Pick<SharedItem | SharedCourse, "updatedBy" | "updatedAt">, space: Pick<Space, "members"> | null, me: string | undefined, now = Date.now()): string {
    if (!row.updatedBy) return ""
    const who = row.updatedBy === me ? "you" : space?.members.find((m) => m.userId === row.updatedBy)?.name ?? "a former member"
    const when = ago(row.updatedAt, now)
    return "Edited by " + who + (when ? " · " + when : "")
}
```

- [ ] **Step 4: The checklist and links move to `src/components/sheet/item-parts.tsx`**

In `src/components/sheet/item-sheet.tsx`, cut the two functions `function Checklist(…) { … }` and `function Links(…) { … }` (from the line `function Checklist({ item, onChange, fill, fillNote, autoFocus = false }: {` to the end of the file), and the line `const MAX_STEPS = 50, MAX_LINKS = 20`. Create `src/components/sheet/item-parts.tsx` with:

```tsx
// The item card's checklist (topics for an exam, with Fill topics from lectures) and links,
// shared by your own item's card and a class item's (whose checklist is yours, in your mark,
// and whose links are the class's).

import { useState } from "react"
import { cn } from "@/lib/utils"
import { httpUrl, isTest, uid } from "@/core/model"
import { flush, linkUrl } from "@/data/item-edit"
import type { ChecklistEntry, Item } from "@/data/types"
import { Button, Meter, Note, RemoveButton, Section, CONTROL } from "./fields"

const MAX_STEPS = 50, MAX_LINKS = 20
```

followed by the two functions exactly as they were, each with `export` in front (`export function Checklist(…`, `export function Links(…`). In `item-sheet.tsx`, after the line `import { ICONS } from "./prop-icons"` add:

```tsx
import { Checklist, Links } from "./item-parts"
```

- [ ] **Step 5: The class item card (`src/components/sheet/class-item-sheet.tsx`)**

```tsx
// A class's item in the card (spec §15). **Class**: the class's facts as everyone in it sees
// them, changed by its owner and editors for everyone; members read them, with who changed
// them last. **Yours**: what only you see: status, grade, your weight, exam prep's topics,
// your notes, and "not mine". Opened by the item's key, '<scope>/<id>'; for admins until
// Stage 6. Text saves once typing pauses; leaving the card saves what is waiting.

import { useEffect, useId, useState } from "react"
import { cn } from "@/lib/utils"
import { baseOf, httpUrl, isOpen, isTest, statusesFor, tmeta, typeList } from "@/core/model"
import { shortDate, today, DOW } from "@/core/dates"
import { GRADABLE } from "@/core/grades"
import { fillTopics, prepLabel, prepPace } from "@/core/prep"
import { repeatEnds } from "@/core/school"
import * as store from "@/core/store"
import { schoolCal, termStart } from "@/data/query"
import { duration } from "@/lib/time"
import { useItems, useMarks, useProfile, useSharedItems, useSpaces, useStudySessions } from "@/data/store"
import { useUi } from "@/data/ui"
import { beforeSheetClose, closeSheet } from "@/data/overlay"
import { busyDays, countdown, deriveEdit, REPEAT_CHOICES, REPEATS, untilLabel, type ItemField } from "@/data/item-edit"
import { courseByKey } from "@/data/effective"
import { keyedItems, keyedSessions, splitKey } from "@/data/refs"
import { studiedFor } from "@/data/study"
import { editedBy, editMark, editRow, flushTyping, hideAsks, markIdOf, markStatus, pendingMark, pendingRow, setHidden, typeMark, typeRow, useTyping } from "@/data/marks"
import { toast } from "@/data/toast"
import { useMaintenance } from "@/data/maintenance"
import { StatusChip } from "@/components/views/bits"
import { SharedGlyph } from "@/components/shared-glyph"
import { MaintenanceBar, MaintenancePage } from "@/components/maintenance"
import type { Course, Item, Mark } from "@/data/types"
import { Button, Chips, DateInput, Note, NumberInput, Prop, Props, QUIET, Section, Segmented, Select, SheetBody, SheetFoot, SheetHead, TextArea, TextInput, TitleArea } from "./fields"
import { TimeField } from "./time-field"
import { DatePicker } from "./date-picker"
import { ICONS } from "./prop-icons"
import { Checklist, Links } from "./item-parts"

const TITLE = "font-serif text-[30px] leading-[1.15] font-[500] tracking-[-.015em]"
const KEY = "text-muted-foreground"

export function ClassItemSheet({ itemKey }: { itemKey: string }) {
    const { scope, id } = splitKey(itemKey)
    useTyping()
    const row = useSharedItems().find((it) => it.scope === scope && it.id === id) ?? null
    const space = useSpaces().find((s) => s.scope === scope) ?? null
    const stored = useMarks().find((m) => m.id === markIdOf(itemKey)) ?? null
    const items = useItems()
    const sessions = useStudySessions()
    const me = useProfile()?.id
    const bg = useUi((u) => u.bg)
    const maintenance = useMaintenance("classes")
    const [asking, setAsking] = useState<"hide" | "delete" | null>(null)
    const [fillNote, setFillNote] = useState("")
    const f = useId()

    /* closing, or switching to another item, saves what is being typed */
    useEffect(() => {
        const save = () => { void flushTyping() }
        beforeSheetClose.add(save)
        return () => { beforeSheetClose.delete(save) }
    }, [])
    /* deleted, or the class gone from this device, while open */
    useEffect(() => { if (!row || !space) closeSheet() }, [row, space])

    if (maintenance === "blocked") return (
        <>
            <SheetHead kind="Class item" onClose={closeSheet} />
            <SheetBody><MaintenancePage feature="classes" inSheet /></SheetBody>
        </>
    )
    if (!row || !space || !scope) return null

    const it: Item = { ...row, ...pendingRow(itemKey) }
    const mark: Partial<Mark> = { ...(stored ?? {}), ...pendingMark(itemKey) }
    const view: Item = {
        ...it, status: mark.status ?? "todo", grade: mark.grade ?? null, weight: mark.weight ?? it.weight,
        checklist: mark.checklist ?? [], notes: mark.notes ?? "", completedAt: mark.completedAt ?? null,
    }
    const editor = space.role !== "member" && !space.archived
    const courseKey = scope + "/" + row.courseId
    const course = courseByKey(courseKey)
    const m = tmeta(it.type)
    const test = isTest(it.type)
    const lectures = !!course && (course.meetings || []).some((x) => x.kind === "Lecture")
    const prep = test && isOpen(view) ? prepPace(view, today()) : null
    const studied = studiedFor(keyedSessions(sessions), itemKey)
    const by = editedBy(row, space, me)

    const hide = async () => {
        await setHidden(itemKey, true)
        toast("Hidden from your views and grades. Show it again from the class.")
        closeSheet()
    }
    const remove = async () => {
        closeSheet()
        await store.removeShared("shared_items", scope, id)
    }
    const fill = () => {
        if (!course) return
        const r = fillTopics({ ...view, id: itemKey, courseId: courseKey }, course, keyedItems(items), termStart(), schoolCal())
        if (r.added) void editMark(itemKey, { checklist: r.checklist })
        setFillNote(r.added
            ? "Added " + r.added + " lecture" + (r.added === 1 ? "" : "s") + "." + (r.left ? " " + r.left + " more did not fit under the 50-step limit." : "")
            : r.left ? "The list is full: 50 steps is the most an item can hold." : "Every lecture before this " + m.label.toLowerCase() + " is already listed.")
    }

    return (
        <>
            <SheetHead color={m.color} kind={m.label} onClose={closeSheet}>
                <StatusChip item={view} />
                <span className="font-mono text-[11px] text-muted-foreground">{countdown(view)}</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-px text-[10.5px] font-semibold text-ink-2">
                    <SharedGlyph className="size-3" /> {course?.name || "Class"}
                </span>
                {prep && (
                    <span className={cn("rounded-full bg-[var(--chip-bg)] px-2 py-px font-mono text-[10.5px] font-semibold tabular-nums", prep.hot ? "text-destructive" : "text-[var(--chip-ink)]")}>
                        {prepLabel(prep)}
                    </span>
                )}
            </SheetHead>

            <SheetBody className="gap-[22px] px-6 pt-2 pb-7 max-[700px]:px-4">
                {maintenance === "admin" && <MaintenanceBar />}
                {editor
                    ? <TitleArea value={it.title} maxLength={140} aria-label="Title" placeholder="Untitled item" className={TITLE}
                        onChange={(e) => typeRow(itemKey, { title: e.target.value })} onBlur={() => void flushTyping()} />
                    : <h2 className={cn("m-0", TITLE)}>{it.title}</h2>}

                <Section title={<><SharedGlyph /> Class</>} note={by || (editor ? "Everyone in the class sees these" : undefined)}>
                    {editor ? <ClassFields itemKey={itemKey} it={it} f={f} bg={bg} items={items} course={course} /> : <ClassFacts it={it} />}
                </Section>

                <Section title="Yours" note="Only you see these">
                    <Props>
                        <Prop icon={ICONS.status} label="Status">
                            <span className="flex">
                                <Segmented label="Status" value={view.status} options={statusesFor(it.type) as [string, string][]} onChange={(v) => void editMark(itemKey, markStatus(stored, v))} />
                            </span>
                        </Prop>
                        {view.status === "graded" && (
                            <Prop icon={ICONS.grade} label="Grade" htmlFor={f + "grade"}>
                                <span className="flex items-center gap-1">
                                    <NumberInput id={f + "grade"} className={cn(QUIET, "w-16")} min={0} max={100} placeholder="—" value={view.grade ?? ""}
                                        onChange={(e) => void editMark(itemKey, { grade: e.target.value === "" ? null : Math.max(0, Math.min(100, Number(e.target.value))) })} />
                                    <span className="text-muted-foreground">%</span>
                                </span>
                            </Prop>
                        )}
                        {GRADABLE.includes(baseOf(it.type)) && (
                            <Prop icon={ICONS.weight} label="Your weight" htmlFor={f + "mine"}>
                                <span className="flex items-center gap-1">
                                    <NumberInput id={f + "mine"} className={cn(QUIET, "w-16")} min={0} max={100} step="any" placeholder={it.weight == null ? "—" : String(it.weight)} value={mark.weight ?? ""}
                                        onChange={(e) => { const n = Number(e.target.value); void editMark(itemKey, { weight: e.target.value === "" || !(n >= 0) ? null : Math.min(100, n) }) }} />
                                    <span className="text-muted-foreground">% · empty uses the class's</span>
                                </span>
                            </Prop>
                        )}
                        {studied > 0 && (
                            <Prop icon={ICONS.studied} label="Studied"><span className="font-mono text-[12.5px] text-ink-2">{duration(studied)}</span></Prop>
                        )}
                    </Props>
                    {mark.weight != null && mark.weight !== it.weight && (
                        <div className="flex flex-wrap items-center gap-2">
                            <Note>The class weight is {it.weight == null ? "not set" : it.weight + "%"}.</Note>
                            <Button variant="ghost" onClick={() => void editMark(itemKey, { weight: null })}>Use class weight</Button>
                        </div>
                    )}
                    <Checklist item={view} fill={test && lectures ? fill : null} fillNote={fillNote}
                        onChange={(list, typing) => { if (typing) typeMark(itemKey, { checklist: list }); else void editMark(itemKey, { checklist: list }) }} />
                    <TextArea aria-label="My notes" value={view.notes} maxLength={5000} placeholder="Only you see these."
                        onChange={(e) => typeMark(itemKey, { notes: e.target.value })} onBlur={() => void flushTyping()} />
                    {asking === "hide" ? (
                        <div role="alert" className="flex flex-wrap items-center gap-2">
                            <Note>Hide it? {view.grade != null ? "Your grade of " + view.grade + "%" : "Your grade"} stops counting in {course?.name || "the class"}.</Note>
                            <Button variant="ghost" onClick={() => setAsking(null)}>Keep it</Button>
                            <Button variant="danger" onClick={() => void hide()}>Hide it</Button>
                        </div>
                    ) : (
                        <Button variant="ghost" className="self-start" onClick={() => { if (hideAsks(stored)) setAsking("hide"); else void hide() }}>Not mine · hide it</Button>
                    )}
                </Section>
            </SheetBody>

            {asking === "delete" ? (
                <SheetFoot hint={"Delete it for everyone in " + (course?.name || "the class") + "?"}>
                    <Button variant="ghost" onClick={() => setAsking(null)}>Keep it</Button>
                    <Button variant="danger" onClick={() => void remove()}>Delete it</Button>
                </SheetFoot>
            ) : (
                <SheetFoot hint="Edits save as you type">
                    {editor && <Button variant="ghost" onClick={() => setAsking("delete")}>Delete for everyone</Button>}
                    <Button onClick={closeSheet}>Done</Button>
                </SheetFoot>
            )}
        </>
    )
}

/* The class's facts, for its owner and editors: each change saves for everyone. */
function ClassFields({ itemKey, it, f, bg, items, course }: { itemKey: string; it: Item; f: string; bg: string; items: Item[]; course: Course | null }) {
    const cal = schoolCal()
    const ends = repeatEnds(cal, it.date)
    const types = typeList(bg, items).filter((t) => !t.custom && (t.id === it.type || !t.hidden))
    const set = (field: ItemField, value: unknown) => void editRow(itemKey, deriveEdit(it, field, value, () => course, cal))
    return (
        <>
            <Chips label="Type" value={it.type} options={types} onChange={(v) => set("type", v)} />
            <Props>
                <Prop icon={ICONS.date} label="Date" top>
                    <DatePicker value={it.date} busy={busyDays(items, it.id)} onChange={(d) => set("date", d)} />
                </Prop>
                <Prop icon={ICONS.time} label="Time" htmlFor={f + "start"}>
                    <span className="flex items-center gap-1.5">
                        <TimeField id={f + "start"} label="Start time" className={QUIET} value={it.start} onChange={(v) => set("start", v)} />
                        <span className="text-[12px] text-muted-foreground">to</span>
                        <TimeField label="End time" className={QUIET} value={it.end} onChange={(v) => set("end", v)} />
                    </span>
                </Prop>
                <Prop icon={ICONS.room} label="Room" htmlFor={f + "where"}>
                    <TextInput id={f + "where"} className={QUIET} value={it.where} maxLength={80} placeholder="Add a room or place"
                        onChange={(e) => typeRow(itemKey, { where: e.target.value })} onBlur={() => void flushTyping()} />
                </Prop>
                {GRADABLE.includes(baseOf(it.type)) && (
                    <Prop icon={ICONS.weight} label="Weight" htmlFor={f + "weight"}>
                        <span className="flex items-center gap-1">
                            <NumberInput id={f + "weight"} className={cn(QUIET, "w-16")} min={0} max={100} step="any" placeholder="—" value={it.weight ?? ""} onChange={(e) => set("weight", e.target.value)} />
                            <span className="text-muted-foreground">% of the course grade</span>
                        </span>
                    </Prop>
                )}
                {REPEATS.includes(it.type) && (
                    <Prop icon={ICONS.repeat} label="Repeat" top>
                        <div className="flex flex-col items-start gap-2">
                            <Segmented label="Repeat" value={it.recur === "weekly" ? "weekly" : "once"} options={REPEAT_CHOICES} onChange={(v) => set("recur", v === "weekly")} />
                            {it.recur === "weekly" && (
                                <span className="flex items-center gap-1.5 text-[13px] text-ink-2">
                                    <label htmlFor={f + "until"}>Until</label>
                                    {ends.length
                                        ? <Select id={f + "until"} className={cn(QUIET, "w-auto")} value={it.recurUntil ?? ""} onChange={(e) => set("recurUntil", e.target.value)}>
                                            {ends.map((x) => <option key={x.end} value={x.end}>{untilLabel(x)}</option>)}
                                            {it.recurUntil && !ends.some((x) => x.end === it.recurUntil) && <option value={it.recurUntil}>{shortDate(it.recurUntil)}</option>}
                                            <option value="">no end</option>
                                        </Select>
                                        : <DateInput id={f + "until"} className={cn(QUIET, "w-auto")} value={it.recurUntil ?? ""} onChange={(e) => set("recurUntil", e.target.value)} />}
                                </span>
                            )}
                        </div>
                    </Prop>
                )}
            </Props>
            <TextArea aria-label="Class notes" value={it.notes} maxLength={5000} placeholder="What everyone should know: groups, format, what is allowed."
                onChange={(e) => typeRow(itemKey, { notes: e.target.value })} onBlur={() => void flushTyping()} />
            <Links item={it} onChange={(links) => void editRow(itemKey, { links })} />
        </>
    )
}

/* The class's facts, for a member: read-only. */
function ClassFacts({ it }: { it: Item }) {
    const when = it.recur === "weekly" ? "Every " + DOW[it.weekday ?? 0] : shortDate(it.date)
    return (
        <>
            <dl className="m-0 grid grid-cols-[86px_minmax(0,1fr)] gap-x-2.5 gap-y-1.5 text-[12.5px]">
                <dt className={KEY}>Type</dt><dd className="m-0">{tmeta(it.type).label}</dd>
                <dt className={KEY}>When</dt><dd className="m-0">{when}{it.start ? " · " + it.start + (it.end ? "–" + it.end : "") : ""}</dd>
                <dt className={KEY}>Room</dt><dd className="m-0">{it.where || "—"}</dd>
                <dt className={KEY}>Weight</dt><dd className="m-0">{it.weight == null ? "—" : it.weight + "%"}</dd>
            </dl>
            {it.notes && <p className="m-0 text-[12.5px] whitespace-pre-wrap text-ink-2">{it.notes}</p>}
            {it.links.length > 0 && (
                <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[12.5px]">
                    {it.links.map((l, i) => (
                        <li key={i}>
                            {/* only a web link becomes a link, however it got here */}
                            {httpUrl(l.url)
                                ? <a href={l.url} target="_blank" rel="noopener noreferrer" className="[overflow-wrap:anywhere] text-[var(--accent)] no-underline hover:underline">↗ {l.label || l.url}</a>
                                : <span>{l.label || l.url}</span>}
                        </li>
                    ))}
                </ul>
            )}
            <Note>The owner and editors keep these.</Note>
        </>
    )
}
```

- [ ] **Step 6: Your own item's card files it under a class, or adds a new one to it (`src/components/sheet/item-sheet.tsx`)**

After the line `import { deleteItem, openCourse } from "@/data/actions"` add:

```tsx
import { courseByKey, keyOf } from "@/data/effective"
import { itemCourseKey, keyedItems, placeCourse } from "@/data/refs"
import { addToClass, canAddToClass } from "@/data/marks"
```

In the `./fields` import, replace `AddButton, Button, Chips,` with `AddButton, Button, Checkbox, Chips,`.

Replace

```tsx
const courseOf = (id: string | null) => (id ? (store.course(id) as Course | null) : null)
```

with

```tsx
/* A course by its key: one of yours by its id, a class's by '<scope>/<id>'. An item of yours
   filed under a class shows under the class's course (refs.ts itemCourseKey). */
const courseOf = (key: string | null) => courseByKey(key)
```

(It returns an `EffectiveCourse`, a `Course` with `key`, `spaceId` and `source` when it is a class's.)

After the line `    const [fillNote, setFillNote] = useState("")` add:

```tsx
    /* a new item with a class picked goes into the class, for its owner or an editor, unless unticked */
    const [shareNew, setShareNew] = useState(true)
```

Replace `    const c = courseOf(it.courseId)` with `    const c = courseOf(itemCourseKey(it))`.

Replace the first line of `set`

```tsx
        const patch = deriveEdit(it, field, value, courseOf, cal)
```

with

```tsx
        /* the course picker works in keys: a class's course files the item under the class */
        let patch = deriveEdit({ ...it, courseId: itemCourseKey(it) }, field, value, courseOf, cal)
        if (field === "courseId") patch = { ...patch, ...placeCourse(patch.courseId ?? null) }
```

Replace `save`:

```tsx
    const save = async () => {
        if (!it.title.trim()) return
        const row = normalizeItem(it)
        if (shareNew && canAddToClass(row)) await addToClass(row)
        else await store.saveItem(row)
        closeSheet()
    }
```

Replace `    const types = typeList(bg, store.data.items).filter(…)` (its first part, `typeList(bg, store.data.items)`) with `typeList(bg, items)`.

Replace `<IconButton className="px-1.5 py-px text-[11px]" onClick={() => openCourse(c.id)}>Edit course</IconButton>` with:

```tsx
<IconButton className="px-1.5 py-px text-[11px]" onClick={() => openCourse(keyOf(c))}>{c.spaceId ? "Open the class" : "Edit course"}</IconButton>
```

Replace the course `Select`:

```tsx
                            <Select id={f + "course"} className={QUIET} value={it.courseId ?? ""} onChange={(e) => set("courseId", e.target.value)}>
                                <option value="">No course</option>
                                {courses.filter((x) => !x.archived || x.id === it.courseId).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                            </Select>
```

with

```tsx
                            <Select id={f + "course"} className={QUIET} value={itemCourseKey(it) ?? ""} onChange={(e) => set("courseId", e.target.value)}>
                                <option value="">No course</option>
                                {courses.filter((x) => !x.archived || keyOf(x) === itemCourseKey(it)).map((x) => (
                                    <option key={keyOf(x)} value={keyOf(x)}>{x.name}{x.source === "class" ? " · shared class" : ""}</option>
                                ))}
                            </Select>
```

After the closing `</Props>` add:

```tsx
                {isNew && canAddToClass(it) && (
                    <Checkbox id={f + "share"} checked={shareNew} onChange={setShareNew}>Add it to the class for everyone (unticked, it stays yours, filed under the class)</Checkbox>
                )}
```

Replace `const r = fillTopics(it, c, store.data.items, termStart(), schoolCal())` with:

```tsx
const r = fillTopics({ ...it, courseId: itemCourseKey(it) }, c, keyedItems(items), termStart(), schoolCal())
```

(`c` there is a course of yours, or the class's for an item filed under it; `keyedItems` keeps a class's items apart from yours when a class course and yours share an id.)

- [ ] **Step 7: Open a class item in its own card (`src/components/sheet/sheet.tsx`)**

After the line `const AchievementSheet = lazyNamed(() => import("./achievement-sheet"), "AchievementSheet")` (and Stage 3's class sheets after it) add:

```tsx
/* a class's item, opened by its key: admins only until Stage 6, so nobody else downloads it */
const ClassItemSheet = lazyNamed(() => import("./class-item-sheet"), "ClassItemSheet", { idle: false })
```

After `import * as store from "@/core/store"` add:

```tsx
import { itemByKey } from "@/data/effective"
import { isSharedKey } from "@/data/refs"
```

In `sheetLabel`, replace

```tsx
    if (s.kind === "course") return s.id ? "Course" : "New course"
```

with

```tsx
    if (s.kind === "course") return s.id ? (isSharedKey(s.id) ? "Class details" : "Course") : "New course"
```

and replace `    const it = store.item(s.id) as Item | null` with `    const it = (itemByKey(s.id) ?? store.item(s.id)) as Item | null`.

Replace

```tsx
                {shown?.kind === "item" && <ItemSheet key={shown.id} id={shown.id} />}
```

with

```tsx
                {shown?.kind === "item" && (isSharedKey(shown.id)
                    ? <ClassItemSheet key={shown.id} itemKey={shown.id} />
                    : <ItemSheet key={shown.id} id={shown.id} />)}
```

- [ ] **Step 8: Run the tests and the type check**

Run: `npx vitest run src/data/marks.test.ts src/components/sheet/class-item-sheet.test.tsx src/components/sheet/sheet.test.tsx`, then `npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 9: Commit**

```bash
git add src/data/marks.ts src/data/marks.test.ts src/components/sheet/item-parts.tsx src/components/sheet/class-item-sheet.tsx src/components/sheet/class-item-sheet.test.tsx src/components/sheet/item-sheet.tsx src/components/sheet/sheet.tsx
git commit -m "The item card for a class's item: Class (editors) and Yours (your mark); new items into a class

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JpUR1JXMY3ehtkiJwuij95"
npm run build
```

---

### Task 24: The views and actions by key, with source markers and the calendar filter

**Files:**
- Modify: `src/data/actions.ts`, `src/data/views.ts`
- Create: `src/components/views/source-mark.tsx`
- Modify: `src/components/views/week.tsx`, `month.tsx`, `table.tsx`, `stats.tsx`
- Create: `src/data/layer-actions.test.ts`
- Modify: `src/components/views/views.test.tsx`

- [ ] **Step 1: Write the failing tests**

`src/data/layer-actions.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// The actions with the store, sync, the ui, the overlay, the class sheets and your marks as fakes.
const fake = vi.hoisted(() => ({
    data: { profile: { id: "u1", isAdmin: true }, items: [] as unknown[], courses: [] as unknown[], quotes: [] as unknown[], study_sessions: [] as unknown[], achievements: [] as unknown[],
        spaces: [] as unknown[], shared_courses: [] as unknown[], shared_items: [] as unknown[], marks: [] as unknown[], space_prefs: [] as unknown[] },
    ui: { view: "week", search: "", types: {} as Record<string, boolean>, course: "all", anchor: "2026-10-06", bg: "med" },
    saveItem: vi.fn(async () => {}),
    openSheet: vi.fn(),
    openClass: vi.fn(),
    toggleClassTask: vi.fn(async () => {}),
}))
vi.mock("@/core/store", () => ({ data: fake.data, saveItem: fake.saveItem, subscribe: () => () => {}, item: () => null, course: () => null }))
vi.mock("@/core/sync", () => ({ status: { state: "idle", pending: 0, message: "" }, onStatus: () => {}, syncNow: vi.fn() }))
vi.mock("@/data/ui", async () => (await import("@/data/fake-ui")).fakeUi(fake.ui))
vi.mock("@/data/sidebar", () => ({ setSide: vi.fn() }))
vi.mock("@/data/study-controller", () => ({ setView: vi.fn(), deleteLater: vi.fn(), deleteWithUndo: vi.fn() }))
vi.mock("@/data/overlay", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/data/overlay")>()), openSheet: fake.openSheet }))
vi.mock("@/data/classes", () => ({ openClass: fake.openClass, openJoin: vi.fn(), watchInvites: vi.fn() }))
vi.mock("@/data/marks", () => ({ toggleClassTask: fake.toggleClassTask }))

import { newItemOn, openCourse, quickAddTask, toggleTask } from "./actions"

const SID = "abcdefghij12", WEB = "c:" + SID
beforeEach(() => { fake.ui.course = "all" })
afterEach(() => { vi.clearAllMocks() })

describe("the views act on keys", () => {
    it("open a class's course as the class, and yours in the course sheet", () => {
        openCourse(WEB + "/web")
        expect(fake.openClass).toHaveBeenCalledWith(SID)
        openCourse("bio")
        expect(fake.openSheet).toHaveBeenCalledWith({ kind: "course", id: "bio" })
    })

    it("tick a class's task in your mark", async () => {
        await toggleTask(WEB + "/t1")
        expect(fake.toggleClassTask).toHaveBeenCalledWith(WEB + "/t1", undefined)
    })

    it("file a new item under the class shown, or under your course", async () => {
        fake.ui.course = WEB + "/web"
        newItemOn("2026-10-06")
        expect(fake.openSheet).toHaveBeenLastCalledWith({ kind: "new-item", draft: expect.objectContaining({ courseId: null, classId: SID }) })
        await quickAddTask("Read ch. 4")
        expect(fake.saveItem).toHaveBeenCalledWith(expect.objectContaining({ title: "Read ch. 4", courseId: null, classId: SID }))
        fake.ui.course = "bio"
        newItemOn("2026-10-06")
        expect(fake.openSheet).toHaveBeenLastCalledWith({ kind: "new-item", draft: expect.objectContaining({ courseId: "bio", classId: null }) })
    })
})
```

Append to `src/components/views/views.test.tsx`:

```tsx
describe("an admin's classes in the views", () => {
    const WEB = "c:abcdefghij12", store = fake.data as Record<string, unknown>
    beforeEach(() => {
        store.profile = { id: "u1", isAdmin: true, hiddenSources: [] }
        store.spaces = [{ id: "abcdefghij12", scope: WEB, kind: "class", role: "member", archived: false, name: "Web Services", parent: null, revision: 1, members: [] }]
        store.shared_courses = [{ ...normalizeCourse({ id: "web", code: "WEB", name: "Web Services", color: "#17B3AE" }), scope: WEB }]
        store.shared_items = [{ ...item({ id: "a1", title: "REST API Project", courseId: "web" }), scope: WEB }]
        store.marks = []
        store.space_prefs = []
        fake.data.items = [...fake.data.items, item({ id: "f1", type: "quiz", title: "Extra quiz", classId: "abcdefghij12" })]
    })
    afterEach(() => { for (const k of ["spaces", "shared_courses", "shared_items", "marks", "space_prefs"]) store[k] = [] })

    it("mark a class's item and yours filed under it, and open the class's by its key", () => {
        show(<Views />)
        const row = screen.getByRole("button", { name: /REST API Project/ })
        expect(within(row).getByRole("img", { name: "Shared · Web Services" })).toBeTruthy()
        fireEvent.click(row)
        expect(actions.openItem).toHaveBeenCalledWith(WEB + "/a1")
        expect(within(screen.getByRole("button", { name: /Extra quiz/ })).getByRole("img", { name: "Yours, under Web Services" })).toBeTruthy()
    })

    it("leave a hidden source off the week, and keep it on All items", () => {
        store.profile = { id: "u1", isAdmin: true, hiddenSources: ["space:abcdefghij12"] }
        show(<Views />)
        expect(screen.queryByRole("button", { name: /REST API Project/ })).toBeNull()
        expect(screen.queryByRole("button", { name: /Extra quiz/ })).toBeNull()
        set({ view: "table" })
        expect(screen.getByRole("row", { name: /REST API Project/ })).toBeTruthy()
    })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run src/data/layer-actions.test.ts src/components/views/views.test.tsx`
Expected: FAIL: `openCourse` opens the course sheet with the class's key; the new item has `courseId` `c:…/web`; no "Shared · Web Services" mark; `openItem` gets `a1`; the hidden class still shows on the week.

- [ ] **Step 3: The actions (`src/data/actions.ts`)**

Replace `import { effectiveCourses, effectiveItems, keyOf } from "./effective"` with:

```ts
import { effectiveCourses, effectiveItems, keyOf } from "./effective"
import { isSharedKey, keyedCourses, placeCourse, splitKey } from "./refs"
import { openClass } from "./classes"
import { toggleClassTask } from "./marks"
```

Replace `newItemOn`:

```ts
/** A new item in the sheet, on a day (the week shown, by default), in the course shown: filed under a class when a class is shown. */
export function newItemOn(date: string, type = "assignment") {
    openSheet({ kind: "new-item", draft: normalizeItem({ id: uid(), type, title: "", ...placeCourse(ui.course === "all" ? null : ui.course), date, status: "todo" }) as Item })
}
```

Replace `export const openCourse = (id: string | null) => openSheet({ kind: "course", id })` (and its comment) with:

```ts
/** A course in the sheet, by its key; null for a new one. A class's course opens the class. */
export function openCourse(key: string | null) {
    if (isSharedKey(key)) { openClass(splitKey(key).spaceId!); return }
    openSheet({ kind: "course", id: key })
}
```

In `openAchievement`, replace `newAchievement(data.courses)` with `newAchievement(keyedCourses(effectiveCourses()))`.

Replace `toggleTask`:

```ts
/** Tick a task off or back on, by its key: a class's task in your mark. Finishing one celebrates from `from` and books its next review. */
export async function toggleTask(key: string, from?: Element) {
    if (isSharedKey(key)) { await toggleClassTask(key, from); notify(); return }
    const it = store.item(key) as Item | null
    if (!it) return
    const finishing = isOpen(it)
    if (finishing && from) celebrate(from)
    setStatus(it, finishing ? "done" : "todo")
    await touch(it)
    await chainReview(it)
    notify()
}
```

In `quickAddTask`, replace `courseId: ui.course === "all" ? null : ui.course,` with `...placeCourse(ui.course === "all" ? null : ui.course),`.

- [ ] **Step 4: The Week and the Month leave hidden sources out (`src/data/views.ts`)**

Replace `import { courseKeyOf, keyOf } from "./effective"` with `import { courseKeyOf, keyOf, onCalendar } from "./effective"`, and replace `useViewInput` and the three hooks that use it:

```ts
/**
 * The live input for the views. The `ui` object is changed in place, so the version the
 * bridge bumps on every redraw is part of the key; the collections are new arrays when
 * the store reloads. The Week and the Month (`calendar`) leave out what you hid with an eye
 * toggle (spec §9); All items does not.
 */
function useViewInput(calendar = false): ViewInput {
    const items = useItems(), courses = useCourses(), profile = useProfile()
    const version = useSyncExternalStore(subscribe, getVersion)
    return useMemo(
        () => {
            const shown = calendar ? onCalendar(items, courses, profile?.hiddenSources ?? []) : { items, courses }
            return { items: shown.items, courses: shown.courses, filters: filtersOf(), schedule: ui.schedule, anchor: ui.anchor, today: todayIso(), cal: schoolCal() }
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` stands for the ui
        [items, courses, profile, version, calendar],
    )
}

export const useWeek = () => {
    const input = useViewInput(true)
    return useMemo(() => ({
        week: weekDays(input),
        officeHours: officeHours(input.items, input.courses, input.filters),
        tasks: tasks(input.items, input.courses, input.filters),
        empty: input.items.length === 0,
        schedule: input.schedule,
    }), [input])
}

export const useMonth = () => {
    const input = useViewInput(true)
    return useMemo(() => ({ month: monthCells(input), timetable: timetable(input.courses, input.filters, input.cal, input.anchor), schedule: input.schedule }), [input])
}
```

(`useTable` keeps `useViewInput()`.)

- [ ] **Step 5: The markers (`src/components/views/source-mark.tsx`)**

```tsx
// Where a chip comes from (spec §9): the two-person glyph on a class's item ("Shared · Web
// Services"), and a "you" pip on an item of yours filed under a class. Your other items have
// neither.

import { SharedGlyph } from "@/components/shared-glyph"
import type { EffectiveItem } from "@/data/effective"

export function SourceMark({ item, course }: { item: EffectiveItem; course: { name: string } | null }) {
    const name = course?.name || "a class"
    if (item.source === "class") return (
        <span role="img" aria-label={"Shared · " + name} title={"Shared · " + name} className="inline-flex flex-none text-muted-foreground">
            <SharedGlyph className="size-3" />
        </span>
    )
    if (item.classId) return (
        <span role="img" aria-label={"Yours, under " + name} title={"Yours, under " + name}
            className="flex-none rounded-full bg-[var(--chip-bg)] px-1 text-[9.5px] leading-[14px] font-semibold text-[var(--chip-ink)]">you</span>
    )
    return null
}
```

- [ ] **Step 6: The views by key**

`src/components/views/week.tsx`: replace `import { course as courseOf } from "@/core/store"` with:

```tsx
import { courseByKey, courseKeyOf, keyOf } from "@/data/effective"
import { SourceMark } from "./source-mark"
```

Then, in the file:
- replace every `openItem(it.id)` with `openItem(keyOf(it))` (three places: the day's row, office hours, tasks);
- replace `toggleTask(it.id, e.currentTarget)` with `toggleTask(keyOf(it), e.currentTarget)`;
- replace every `key={it.id}` with `key={keyOf(it)}` (office hours and tasks);
- replace `const it = entry.inst.item, c = courseOf(it.courseId) as Course | null` with `const it = entry.inst.item, c = courseByKey(courseKeyOf(it))`;
- in `OfficeHours`, replace `const c = courseOf(it.courseId) as Course | null` with `const c = courseByKey(courseKeyOf(it))`;
- in the day's item row, replace

```tsx
                <span className="truncate">{it.title}</span>
                {!done && <Steps item={it} />}
```

with

```tsx
                <span className="truncate">{it.title}</span>
                <SourceMark item={it} course={c} />
                {!done && <Steps item={it} />}
```

If `Course` is then unused in `week.tsx`'s type import, leave the import as it is (the type check does not flag unused imports here).

`src/components/views/table.tsx`: replace `import { course as courseOf } from "@/core/store"` with:

```tsx
import { courseByKey, courseKeyOf, keyOf } from "@/data/effective"
import { SourceMark } from "./source-mark"
```

replace `const c = courseOf(it.courseId) as Course | null` with `const c = courseByKey(courseKeyOf(it))`, `key={it.id}` with `key={keyOf(it)}`, both `openItem(it.id)` with `openItem(keyOf(it))`, and

```tsx
                                        <b className={cn("font-semibold", isComplete(it) ? "text-[var(--done-ink)]" : "text-foreground")}>{it.title}</b>
```

with

```tsx
                                        <b className={cn("font-semibold", isComplete(it) ? "text-[var(--done-ink)]" : "text-foreground")}>{it.title}</b>{" "}
                                        <SourceMark item={it} course={c} />
```

`src/components/views/month.tsx`: after `import { goToDay, openCourse } from "@/data/actions"` add:

```tsx
import { courseByKey, courseKeyOf, keyOf } from "@/data/effective"
import { SourceMark } from "./source-mark"
```

in `MonthChip`, replace

```tsx
            <span className="truncate">{it.start && <b className="font-mono font-medium">{hhmm(it.start)} </b>}{it.title}</span>
```

with

```tsx
            <span className="truncate">{it.start && <b className="font-mono font-medium">{hhmm(it.start)} </b>}{it.title}</span>
            <SourceMark item={it} course={courseByKey(courseKeyOf(it))} />
```

and in `Timetable` replace `key={x.course.id + x.mtg.id}` with `key={keyOf(x.course) + x.mtg.id}` and `onClick={() => openCourse(x.course.id)}` with `onClick={() => openCourse(keyOf(x.course))}`.

`src/components/views/stats.tsx`: add `import { keyOf } from "@/data/effective"` and replace `onClick={exam ? () => openItem(exam.id) : undefined}` with `onClick={exam ? () => openItem(keyOf(exam)) : undefined}`.

- [ ] **Step 7: Run the tests and the type check**

Run: `npx vitest run src/data/layer-actions.test.ts src/components/views/views.test.tsx src/data/views.test.ts`, then `npm run typecheck`
Expected: PASS (the existing views tests too: a personal item's key is its id), no type errors.

- [ ] **Step 8: Commit**

```bash
git add src/data/actions.ts src/data/views.ts src/components/views/source-mark.tsx src/components/views/week.tsx src/components/views/month.tsx src/components/views/table.tsx src/components/views/stats.tsx src/data/layer-actions.test.ts src/components/views/views.test.tsx
git commit -m "Views: open, tick and file by key; shared and 'you' markers; eye-hidden sources off the Week and Month

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JpUR1JXMY3ehtkiJwuij95"
npm run build
```

---

### Task 25: The sidebar: classes in the course list, eye toggles, Personal items

**Files:**
- Modify: `src/components/sidebar.tsx` (`CourseList`, a new `Eye`)
- Modify: `src/components/sidebar-classes.tsx` (Stage 3's `ClassRows` goes)
- Modify: `src/components/sidebar.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `src/components/sidebar.test.tsx`, replace the import line `import { openCourse, openSettings } from "@/data/actions"` with:

```tsx
import { openCourse, openSettings } from "@/data/actions"
import { saveProfile } from "@/core/store"
```

In `describe("shared classes, for admins", …)` (Stage 3), replace the test that starts `    it("list each class under the courses, opening the class, and the invites waiting", () => {` (to its closing `    })`) with:

```tsx
    it("list each class under the courses: the row filters the views, its ✎ opens the class; the invites waiting", () => {
        render(<Sidebar />)
        fireEvent.click(coursesNav().getByRole("button", { name: /^Web Services, shared, 2 members/ }))
        expect(fake.ui.course).toBe("c:sp0000000001/web")
        fireEvent.click(coursesNav().getByRole("button", { name: "Edit Web Services" }))
        expect(openCourse).toHaveBeenCalledWith("c:sp0000000001/web")
        expect(coursesNav().getByRole("button", { name: /^Invites/ }).textContent).toBe("Invites1")
        fireEvent.click(coursesNav().getByRole("button", { name: /^Invites/ }))
        expect(classes.openInvites).toHaveBeenCalled()
    })
```

and append:

```tsx
describe("eye toggles", () => {
    beforeEach(() => {
        fake.data.courses = [{ id: "anat", code: "ANAT", name: "Anatomy", color: "#E4749B", term: "", archived: false, meetings: [] }]
    })

    it("hide a course or Personal items from an admin's calendar, and show a hidden one again", () => {
        fake.data.profile = { ...(fake.data.profile as object), isAdmin: true, hiddenSources: ["course:anat"] }
        render(<Sidebar />)
        const show = coursesNav().getByRole("button", { name: "Show Anatomy on your calendar" })
        expect(show.getAttribute("aria-pressed")).toBe("true")
        fireEvent.click(show)
        expect(saveProfile).toHaveBeenCalledWith({ hiddenSources: [] })
        fireEvent.click(coursesNav().getByRole("button", { name: "Hide Personal items on your calendar" }))
        expect(saveProfile).toHaveBeenLastCalledWith({ hiddenSources: ["course:anat", "personal"] })
    })

    it("are not there for anyone else", () => {
        render(<Sidebar />)
        expect(coursesNav().queryByRole("button", { name: /on your calendar/ })).toBeNull()
        expect(coursesNav().queryByText("Personal items")).toBeNull()
    })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run src/components/sidebar.test.tsx`
Expected: FAIL: the class row opens the class sheet (Stage 3's `ClassRows`), and lists the class twice (once from the course list, now that an admin's courses include it); there are no eye toggles.

- [ ] **Step 3: `src/components/sidebar-classes.tsx` without the class rows**

Replace the whole file with:

```tsx
// The sidebar's shared-class parts, for admins until Stage 6 (spec §15): a row for the invites
// waiting, and + New as a menu: a course, a shared class, or joining with a code. The menu
// follows the ARIA menu pattern. Classes themselves are rows of the course list (sidebar.tsx).

import { useEffect, useRef, useState, type KeyboardEvent } from "react"
import { openInvites, openJoin, openNewClass, useInvites } from "@/data/classes"
import { openCourse } from "@/data/actions"
import { Count } from "./sidebar-parts"

const ROW = "flex w-full min-w-0 items-center gap-2.5 rounded-[9px] border-0 bg-transparent px-2 py-1.5 text-left text-[13px] font-medium text-ink-2 hover:bg-muted hover:text-foreground"
```

followed by Stage 3's `InvitesRow`, `ITEMS` and `NewMenu`, unchanged (everything in Stage 3's file from `/** The invites waiting for you; with none, no row. */` to its end).

- [ ] **Step 4: The course list (`src/components/sidebar.tsx`)**

Replace the imports

```tsx
import { useCourses, useItems, useProfile } from "@/data/store"
```

```tsx
import { ClassRows, InvitesRow, NewMenu } from "./sidebar-classes"
```

with

```tsx
import { useCourses, useItems, useProfile, useSpaces } from "@/data/store"
import { courseKeyOf, courseSource, keyOf } from "@/data/effective"
import { toggleSource } from "@/data/sources"
import { cn } from "@/lib/utils"
import { SharedGlyph } from "./shared-glyph"
```

```tsx
import { InvitesRow, NewMenu } from "./sidebar-classes"
```

and replace the whole `CourseList` function with:

```tsx
function CourseList() {
    const cal = schoolCal()
    const sem = useUi((ui) => ui.sem)
    const term = pickedTerm(cal, sem, today())
    /* the select shows with two semesters or more; a course goes under its own or every one */
    const picker = !!cal && cal.terms.length > 1
    const selected = useUi((ui) => ui.course)
    /* shared classes, the eye toggles and Personal items are for admins until Stage 6 */
    const profile = useProfile()
    const admin = !!profile?.isAdmin
    const hidden = profile?.hiddenSources ?? []
    const spaces = useSpaces()
    /* the course picked stays listed even when the semester shown leaves it out, so the
       filter in force can be seen; a class is a course here, by its key */
    const courses = useCourses().filter((c) => !c.archived && (keyOf(c) === selected || inTerm(cal, c.term, picker ? term : null)))
    const yearTag = cal && cal.terms.length === 2 ? "Both" : "All year"
    const items = useItems()
    const n: Record<string, number> = {}
    for (const it of items) {
        const key = courseKeyOf(it)
        if (key && counts(it)) n[key] = (n[key] || 0) + 1
    }

    return (
        <section aria-label="Courses">
            <Heading action={picker && term ? <SemesterMenu names={cal!.terms.map((t) => t.name)} value={term.name} onPick={setSem} /> : undefined}>Courses</Heading>
            <div className="flex flex-col gap-px">
                <Row pressed={selected === "all"} onClick={() => setCourse("all")}>
                    <span className="min-w-0 truncate">All courses</span>
                </Row>
                {courses.map((c) => {
                    const key = keyOf(c), source = courseSource(c), off = hidden.includes(source)
                    const space = c.spaceId ? spaces.find((s) => s.id === c.spaceId) ?? null : null
                    const members = space ? space.members.length + (space.members.length === 1 ? " member" : " members") : ""
                    return (
                        <div key={key} title={space ? "Shared · " + members : undefined} className="group flex items-center rounded-[9px] hover:bg-muted">
                            <Row pressed={selected === key} dim={off || undefined} onClick={() => setCourse(key)} className={selected === key ? undefined : "hover:bg-transparent"}>
                                <Pip color={c.color} />
                                <span className="min-w-0 truncate">{c.name}</span>
                                {space && <span className="sr-only">, shared, {members}</span>}
                                {space && <span aria-hidden="true" className="shrink-0 text-muted-foreground"><SharedGlyph /></span>}
                                {picker && !courseTerm(cal, c.term) && <span className="shrink-0 text-[11px] text-muted-foreground">{yearTag}</span>}
                                <Count n={n[key] || 0} />
                            </Row>
                            {admin && <Eye source={source} name={c.name} off={off} />}
                            <button
                                type="button"
                                aria-label={"Edit " + c.name}
                                onClick={() => openCourse(key)}
                                className="shrink-0 rounded-md border-0 bg-transparent px-2 py-1 text-[11px] text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 hover:text-primary focus-visible:opacity-100 [@media(hover:none)]:opacity-100 pointer-coarse:min-h-10 pointer-coarse:min-w-10"
                            >
                                ✎
                            </button>
                        </div>
                    )
                })}
                {admin && (
                    <div className="group flex items-center rounded-[9px] hover:bg-muted">
                        <span className={cn("flex min-w-0 flex-1 items-center gap-2.5 px-2 py-1.5 text-[13px] font-medium", hidden.includes("personal") ? "text-muted-foreground" : "text-ink-2")}>
                            <Pip color="var(--ink-3)" hollow />
                            <span className="min-w-0 truncate">Personal items</span>
                        </span>
                        <Eye source="personal" name="Personal items" off={hidden.includes("personal")} />
                    </div>
                )}
                {admin && <InvitesRow />}
                {admin ? <NewMenu /> : (
                    <button
                        type="button"
                        onClick={() => openCourse(null)}
                        className="mt-1.5 w-full rounded-[9px] border border-dashed border-border bg-transparent px-2 py-1.5 text-left text-[12px] text-ink-2 hover:border-primary hover:text-primary"
                    >
                        + New course
                    </button>
                )}
            </div>
        </section>
    )
}

/** A row's eye (spec §9): hide its items and classes from your Week and Month, or show them again. A hidden row stays listed, dimmed. */
function Eye({ source, name, off }: { source: string; name: string; off: boolean }) {
    return (
        <button
            type="button"
            aria-pressed={off}
            aria-label={(off ? "Show " : "Hide ") + name + " on your calendar"}
            title={off ? "Hidden from your Week and Month" : "Hide from your Week and Month"}
            onClick={() => void toggleSource(source)}
            className={cn(
                "shrink-0 rounded-md border-0 bg-transparent px-1.5 py-1 text-muted-foreground hover:text-primary pointer-coarse:min-h-10 pointer-coarse:min-w-10",
                off ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100",
            )}
        >
            <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" className="size-3.5">
                {off
                    ? <path d="M2 2l12 12M6.6 6.7a2 2 0 0 0 2.7 2.7M4.2 4.6C2.9 5.5 2 7 2 7s2.2 4 6 4c1 0 1.9-.3 2.7-.7M7 3.1c.3 0 .7-.1 1-.1 3.8 0 6 4 6 4s-.5 1-1.5 2" />
                    : <><path d="M2 8s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4z" /><circle cx="8" cy="8" r="1.8" /></>}
            </svg>
        </button>
    )
}
```

- [ ] **Step 5: Run the tests and the type check**

Run: `npx vitest run src/components/sidebar.test.tsx`, then `npm run typecheck`
Expected: PASS (the existing course tests too: a personal course's key is its id), no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/sidebar.tsx src/components/sidebar-classes.tsx src/components/sidebar.test.tsx
git commit -m "Sidebar: classes in the course list, eye toggles and Personal items for admins

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JpUR1JXMY3ehtkiJwuij95"
npm run build
```

---

### Task 26: Study, achievements, reviews and exam prep read the merged lists

Stage 2 left the writers and pickers on `data.items`/`data.courses` (its Decision 7). Each now reads the effective lists, and the study and achievement parts work in key space (`src/data/refs.ts`), so a session on a class's course is told apart from one on your course with the same id. For someone with no class every keyed helper returns the list it was given.

**Files:**
- Modify: `src/core/reviews.ts`, `src/data/sync-status.ts`, `src/data/item-edit.ts`
- Modify: `src/data/study.ts`, `src/data/study-controller.ts`, `src/data/study-timer.ts`, `src/data/run.ts`
- Modify: `src/data/session-edit.ts`, `src/data/achievement-edit.ts`, `src/data/school-edit.ts`
- Modify: `src/components/sheet/session-sheet.tsx`, `src/components/sheet/achievement-sheet.tsx`, `src/components/sheet/import-sheet.tsx`, `src/components/study/history.tsx`, `src/components/focus/focus-screen.tsx`
- Create: `src/data/study-keys.test.ts`

- [ ] **Step 1: Write the failing test**

`src/data/study-keys.test.ts`:

```ts
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"

const fake = vi.hoisted(() => ({
    data: {
        profile: { id: "u1", isAdmin: true }, spaces: [{ id: "abcdefghij12", scope: "c:abcdefghij12" }], shared_courses: [{ scope: "c:abcdefghij12", id: "web" }],
        courses: [] as unknown[], items: [] as unknown[], shared_items: [] as unknown[], marks: [] as unknown[], space_prefs: [] as unknown[],
    },
    saveStudySession: vi.fn(async () => {}), saveAchievement: vi.fn(async () => {}),
}))
vi.mock("@/core/store", () => ({ data: fake.data, saveStudySession: fake.saveStudySession, saveAchievement: fake.saveAchievement, subscribe: () => () => {} }))
vi.mock("@/data/ui", async () => (await import("@/data/fake-ui")).fakeUi({ study: { courseId: null, itemId: null } }))
vi.mock("@/data/overlay", () => ({ closeSheet: vi.fn() }))

import { firstReviews, nextReview } from "@/core/reviews"
import { saveSession, sessionDraft } from "./session-edit"
import { achievementDraft, saveAchievementDraft } from "./achievement-edit"
import { todayOf } from "./study"
import { keyedCourses, keyedItems, keyedSessions } from "./refs"
import type { Course, Item } from "./types"

const SID = "abcdefghij12", WEB = "c:" + SID
beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 9, 6, 12)) })
afterAll(() => { vi.useRealTimers() })
afterEach(() => { vi.clearAllMocks() })

describe("lecture reviews of a class's lectures", () => {
    it("are yours, filed under the class, and the next step stays there", () => {
        const web = { id: "web", code: "WEB", archived: false, term: "", spaceId: SID, meetings: [{ id: "m1", kind: "Lecture", weekday: 1, start: "09:00", end: "10:00", room: "" }] }
        const [first] = firstReviews([web], [], "2026-10-05", "2026-10-05")
        expect(first).toMatchObject({ courseId: null, classId: SID, title: "Review 1/4 · WEB Lecture Mon 5 Oct" })
        expect(nextReview(first, "2026-10-07")).toMatchObject({ courseId: null, classId: SID })
        const [own] = firstReviews([{ ...web, spaceId: undefined, id: "bio", code: "BIO" }], [], "2026-10-05", "2026-10-05")
        expect(own).toMatchObject({ courseId: "bio", classId: null })
    })
})

describe("a study session on a class", () => {
    it("is edited in keys and saved as the class's ids with its space", async () => {
        const d = sessionDraft({ id: "s1", courseId: "web", itemId: "a1", spaceId: SID, startedAt: new Date(2026, 9, 5, 10).getTime(), studyMinutes: 30, roundsDone: 0, note: "", manual: true })
        expect([d.courseId, d.itemId]).toEqual([WEB + "/web", WEB + "/a1"])
        await saveSession({ ...d, minutes: 45 })
        expect(fake.saveStudySession).toHaveBeenCalledWith(expect.objectContaining({ id: "s1", courseId: "web", itemId: "a1", spaceId: SID, studyMinutes: 45 }))
    })

    it("shows on Today with the class's course and item", () => {
        const sessions = keyedSessions([{ id: "s1", courseId: "web", itemId: "a1", spaceId: SID, startedAt: new Date(2026, 9, 6, 10).getTime(), studyMinutes: 30, roundsDone: 0, note: "", manual: false }])
        const items = keyedItems([{ id: "a1", key: WEB + "/a1", courseKey: WEB + "/web", title: "REST API Project", courseId: "web" }] as unknown as Item[])
        const courses = keyedCourses([{ id: "web", key: WEB + "/web", name: "Web Services", color: "#17B3AE" }] as unknown as Course[])
        expect(todayOf(sessions, items, courses, 0, "2026-10-06").rows[0]).toMatchObject({ what: "REST API Project", color: "#17B3AE" })
    })
})

describe("an achievement on a class", () => {
    it("is edited in keys and saved with its space", async () => {
        const d = achievementDraft({ id: "h1", name: "Web hours", sticker: "data:image/png;base64,AA==", rule: "hours", courseId: "web", itemId: null, spaceId: SID, target: 10 })
        expect(d.courseId).toBe(WEB + "/web")
        await saveAchievementDraft(d)
        expect(fake.saveAchievement).toHaveBeenCalledWith(expect.objectContaining({ courseId: "web", itemId: null, spaceId: SID }))
    })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/data/study-keys.test.ts`
Expected: FAIL: the class's review has `courseId: 'web'` and no `classId`; the session draft holds `web`/`a1`; the saved session and achievement carry no `spaceId`.

- [ ] **Step 3: Lecture reviews (`src/core/reviews.ts`, `src/data/sync-status.ts`, `src/data/item-edit.ts`)**

In `src/core/reviews.ts`, replace

```ts
export interface ReviewRow { id: string; type: 'task'; title: string; courseId: string | null; date: string; status: 'todo' }
```

with

```ts
export interface ReviewRow { id: string; type: 'task'; title: string; courseId: string | null; classId: string | null; date: string; status: 'todo' }
```

replace

```ts
type Timetabled = Pick<Course, 'id' | 'code' | 'archived' | 'meetings'> & { term?: string };
```

with

```ts
/* A class's course carries its space id: its reviews are yours, filed under the class (a
   personal row cannot point at a class's course), and the chain keeps them there (spec §8). */
type Timetabled = Pick<Course, 'id' | 'code' | 'archived' | 'meetings'> & { term?: string; spaceId?: string };
```

replace the `row` function with

```ts
function row(id: string, step: number, title: string, courseId: string | null, date: string, classId: string | null = null): ReviewRow {
  return { id, type: 'task', title: 'Review ' + step + '/' + STEPS + ' · ' + title, courseId, classId, date, status: 'todo' };
}
```

in `firstReviews` replace

```ts
    out.push(row(id, 1, course.code + ' Lecture ' + shortDate(date), course.id, iso(addDays(parse(date), 1))));
```

with

```ts
    out.push(row(id, 1, course.code + ' Lecture ' + shortDate(date), course.spaceId ? null : course.id, iso(addDays(parse(date), 1)), course.spaceId ?? null));
```

and in `nextReview` replace its signature and last line:

```ts
export function nextReview(it: Pick<Item, 'id' | 'title' | 'courseId' | 'classId'>, today: string, items: Pick<Item, 'id'>[] = []): ReviewRow | null {
```

```ts
  return row(id, step + 1, what, it.courseId, iso(addDays(parse(today), GAP[step])), it.classId ?? null);
```

(The review id still hashes the course id, which a converted course keeps, so a chain carries on; a Stage 3 class beside your own copy makes the same ids, and `firstReviews` skips an id it already has.)

In `src/data/sync-status.ts`, add `import { effectiveCourses, effectiveItems } from "./effective"` and replace `dueReviews(setting, data.courses, data.items, today(), schoolCal())` with `dueReviews(setting, effectiveCourses(), effectiveItems(), today(), schoolCal())`.

In `src/data/item-edit.ts`, add `import { effectiveItems } from "./effective"` and replace `const next = nextReview(it, today(), data.items)` with `const next = nextReview(it, today(), effectiveItems())`.

- [ ] **Step 4: The Study page and the badges (`src/data/study.ts`, `src/data/study-controller.ts`)**

In `src/data/study.ts`, after the line `import { rememberUi, ui } from "./ui"` add:

```ts
import { keyedAchievements, keyedCourses, keyedItems, keyedSessions } from "./refs"
```

In `useStudyInput`, replace `        sessions: shownSessions(sessions, ui.hist.undo),` with:

```ts
        /* in key space (refs.ts): a session on a class's course is told apart from one on yours */
        sessions: keyedSessions(shownSessions(sessions, ui.hist.undo)),
```

Replace the bodies of `useBadges` and `useTodayStudy`:

```ts
export const useBadges = () => {
    const input = useStudyInput(), items = useItems(), own = useAchievements(), courses = useCourses()
    return useMemo(() => badges(input.sessions, keyedItems(items), input.prefs, input.today, keyedAchievements(own), keyedCourses(courses)), [input, items, own, courses])
}

/** The Timer tab's Today card. */
export const useTodayStudy = () => {
    const input = useStudyInput(), items = useItems(), courses = useCourses()
    return useMemo(() => todayOf(input.sessions, keyedItems(items), keyedCourses(courses), input.prefs.goal, input.today), [input, items, courses])
}
```

In `src/data/study-controller.ts`, add

```ts
import { effectiveCourses, effectiveItems } from "./effective"
import { keyedAchievements, keyedCourses, keyedItems, keyedSessions } from "./refs"
```

and replace

```ts
    const list = [...achievements(data.study_sessions, data.items, studyPrefs(), today()),
        ...ownAchievements(data.achievements, data.study_sessions, data.items, data.courses)]
```

with

```ts
    /* class items count by your mark (spec §8), in key space like the Study page */
    const sessions = keyedSessions(data.study_sessions), items = keyedItems(effectiveItems())
    const list = [...achievements(sessions, items, studyPrefs(), today()),
        ...ownAchievements(keyedAchievements(data.achievements), sessions, items, keyedCourses(effectiveCourses()))]
```

- [ ] **Step 5: The timer's pickers (`src/data/study-timer.ts`, `src/data/run.ts`)**

In `src/data/study-timer.ts`, add

```ts
import { effectiveCourses, effectiveItems } from "./effective"
import { keyedCourses, keyedItems } from "./refs"
```

replace the first line of `useStudyPick`'s body `    const courses = useCourses(), items = useItems()` with:

```ts
    /* the pickers work in keys: a class's course and items sit beside yours (refs.ts) */
    const courses = keyedCourses(useCourses()), items = keyedItems(useItems())
```

and in `startRun` replace both `pickFor(data.courses, data.items, ui.study)` with `pickFor(keyedCourses(effectiveCourses()), keyedItems(effectiveItems()), ui.study)`.

In `src/data/run.ts`, add `import { refOf } from "./refs"` and replace

```ts
                    id: ended.id, courseId: ended.courseId, itemId: ended.itemId,
```

with

```ts
                    /* the run holds keys; the session stores the ids and the space they are in */
                    id: ended.id, ...refOf(ended.courseId, ended.itemId),
```

- [ ] **Step 6: Sessions and achievements by hand (`src/data/session-edit.ts`, `src/data/achievement-edit.ts`)**

In `src/data/session-edit.ts`, add

```ts
import { effectiveCourses } from "./effective"
import { courseRefKey, itemRefKey, keyedCourses, refOf } from "./refs"
```

in `newSession` replace `    const live = data.courses.find((c) => !c.archived)` with `    const live = keyedCourses(effectiveCourses()).find((c) => !c.archived)`; in `sessionDraft` replace `        courseId: s.courseId, itemId: s.itemId, note: s.note || "",` with `        courseId: courseRefKey(s), itemId: itemRefKey(s), note: s.note || "",`; and in `saveSession` replace `        id: d.id, courseId: d.courseId, itemId: d.itemId, note: d.note.trim(),` with `        id: d.id, ...refOf(d.courseId, d.itemId), note: d.note.trim(),`.

In `src/data/achievement-edit.ts`, add `import { courseRefKey, itemRefKey, refOf } from "./refs"`; in `achievementDraft` replace `courseId: a.courseId, itemId: a.itemId,` with `courseId: courseRefKey(a), itemId: itemRefKey(a),`; and replace `saveAchievementDraft`'s save call with:

```ts
    /* the draft holds keys; the row stores the ids and the space they are in */
    const ref = refOf(d.rule === "hours" ? d.courseId : null, d.rule === "grade" ? d.itemId : null)
    await store.saveAchievement({
        ...(d.base || {}), id: d.id, name: d.name.trim(), sticker: d.sticker, rule: d.rule,
        courseId: ref.courseId, itemId: ref.itemId, spaceId: ref.spaceId, target: d.target,
    })
```

- [ ] **Step 7: A renamed semester moves your class prefs too (`src/data/school-edit.ts`)**

In `saveSchool`, replace

```ts
    await store.saveProfile({ schoolCalendar: saved })
    if (moved.length) await store.saveRows(moved)
```

with

```ts
    /* your semester for a class lives in its prefs, and follows a renamed semester the same way */
    const prefs = (store.data.space_prefs ?? []).flatMap((p) => {
        const name = renamed.get(courseTerm(before, p.term)?.name ?? "")
        return name ? [{ kind: "space_prefs" as const, row: { ...p, term: name } }] : []
    })
    await store.saveProfile({ schoolCalendar: saved })
    if (moved.length || prefs.length) await store.saveRows([...moved, ...prefs])
```

- [ ] **Step 8: The sheets and the Study page's parts**

`src/components/sheet/session-sheet.tsx`: add `import { keyedCourses, keyedItems } from "@/data/refs"` and replace

```tsx
    const courses = useCourses()
    const items = useItems()
```

with

```tsx
    /* the draft holds keys (refs.ts): a class's course and items sit beside yours */
    const courses = keyedCourses(useCourses())
    const items = keyedItems(useItems())
```

`src/components/sheet/achievement-sheet.tsx`: add `import { keyedCourses, keyedItems, keyedSessions } from "@/data/refs"` and replace

```tsx
    const courses = useCourses()
    const items = useItems()
    const sessions = useStudySessions()
```

with

```tsx
    /* the draft holds keys (refs.ts) */
    const courses = keyedCourses(useCourses())
    const items = keyedItems(useItems())
    const sessions = keyedSessions(useStudySessions())
```

`src/components/focus/focus-screen.tsx`: add `import { keyedCourses, keyedItems } from "@/data/refs"` and replace `    const courses = useCourses(), items = useItems()` with `    const courses = keyedCourses(useCourses()), items = keyedItems(useItems())` (the run holds keys).

`src/components/study/history.tsx`: replace `import { course as courseOf, item as itemOf } from "@/core/store"` with:

```tsx
/* History's sessions are in key space (study.ts): their course and item are found by key */
import { courseByKey as courseOf, itemByKey as itemOf } from "@/data/effective"
```

`src/components/sheet/import-sheet.tsx`: add `import { effectiveItems } from "@/data/effective"` and replace `typeList(bg, data.items)` with `typeList(bg, effectiveItems())`. (Imports themselves stay personal in v1, spec §8.)

- [ ] **Step 9: Run the tests, the jsdom suite and the type check**

Run: `npx vitest run src/data/study-keys.test.ts test/study.test.js`, then `npm run test:ui`, then `npm run typecheck`
Expected: PASS, no type errors. `test/study.test.js` compares review rows only in part; if a test there compares a whole review row with `toEqual`, add `classId: null` to its expected value.

- [ ] **Step 10: Commit**

```bash
git add src/core/reviews.ts src/data/sync-status.ts src/data/item-edit.ts src/data/study.ts src/data/study-controller.ts src/data/study-timer.ts src/data/run.ts src/data/session-edit.ts src/data/achievement-edit.ts src/data/school-edit.ts src/components/sheet/session-sheet.tsx src/components/sheet/achievement-sheet.tsx src/components/sheet/import-sheet.tsx src/components/study/history.tsx src/components/focus/focus-screen.tsx src/data/study-keys.test.ts
git commit -m "Study, badges, reviews and exam prep read the merged lists; sessions and achievements carry the space

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JpUR1JXMY3ehtkiJwuij95"
```

---

### Task 27: Joining (semester and colour), and the merge sheet

**Files:**
- Modify: `src/data/classes.ts`, `src/data/classes.test.ts` (Stage 3)
- Modify: `src/core/api.ts` (`spaces.absorb`), `src/data/overlay.ts` (kind `merge`), `src/components/sheet/sheet.tsx`
- Create: `src/data/merge.ts`, `src/data/merge.test.ts`
- Create: `src/components/sheet/merge-sheet.tsx`
- Modify: `src/components/sheet/join-sheet.tsx` (whole file below), `src/components/sheet/convert-sheet.tsx`, `src/components/sheet/new-class-sheet.tsx`
- Modify: `src/components/sheet/classes.test.tsx` (Stage 3)
- Create: `src/components/sheet/layer.test.tsx`

- [ ] **Step 1: Write the failing tests**

`src/data/merge.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"

vi.mock("@/core/store", () => ({ data: { courses: [], shared_courses: [], spaces: [] } }))
vi.mock("@/core/api", () => ({ api: { spaces: { absorb: vi.fn() } } }))
vi.mock("@/core/sync", () => ({ syncNow: vi.fn() }))
vi.mock("./overlay", () => ({ openSheet: vi.fn() }))
vi.mock("./classes", () => ({ openClass: vi.fn() }))
vi.mock("./toast", () => ({ toast: vi.fn() }))

import { matchFor, pairItems } from "./merge"
import type { Course, SharedCourse } from "./types"

const row = (id: string, type: string, title: string, date: string) => ({ id, type, title, date })

describe("pairing your items with a class's", () => {
    it("pairs identical ids first, then the same type and title on the nearest date", () => {
        const mine = [row("q1", "quiz", "Quiz 1", "2026-10-01"), row("x2", "exam", "Midterm", "2026-10-14"), row("x3", "assignment", "Lab report #2", "2026-10-20")]
        const theirs = [row("q1", "quiz", "Quiz 1", "2026-10-01"), row("e1", "exam", "midterm", "2026-10-16"), row("e2", "exam", "Midterm", "2026-12-10"), row("a9", "assignment", "Lab Report 2", "2026-10-21")]
        expect(pairItems(mine, theirs)).toEqual({ pairs: [["q1", "q1"], ["x2", "e1"], ["x3", "a9"]], apart: [] })
    })

    it("leaves apart what it is unsure of, a lecture review, and an item of your own type", () => {
        const mine = [row("x1", "quiz", "Quiz", "2026-10-10"), row("rvab12cd31", "task", "Review 1/4 · WEB Lecture Mon 5 Oct", "2026-10-06"), row("c1", "c-viva", "Viva", "2026-10-20"), row("x4", "quiz", "Quiz", "2026-10-10")]
        const theirs = [row("s1", "quiz", "Quiz", "2026-10-08"), row("s2", "quiz", "Quiz", "2026-10-12"), row("rvab12cd31", "task", "Review", "2026-10-06"), row("c1", "exam", "Viva", "2026-10-20")]
        expect(pairItems(mine, theirs)).toEqual({ pairs: [], apart: ["x1", "rvab12cd31", "c1", "x4"] })
    })
})

describe("a course of yours matching a class", () => {
    it("is the one with the class course's id, else its code, else its name", () => {
        const shared = [{ scope: "c:abcdefghij12", id: "web", code: "CS 446", name: "Web Services" }] as unknown as SharedCourse[]
        const courses = (list: object[]) => list as Course[]
        expect(matchFor("abcdefghij12", courses([{ id: "web", code: "X", name: "Y" }]), shared)?.id).toBe("web")
        expect(matchFor("abcdefghij12", courses([{ id: "a", code: "cs446", name: "Other" }]), shared)?.id).toBe("a")
        expect(matchFor("abcdefghij12", courses([{ id: "b", code: "WS", name: "web services" }]), shared)?.id).toBe("b")
        expect(matchFor("abcdefghij12", courses([{ id: "c", code: "BIO", name: "Biology" }]), shared)).toBeNull()
        expect(matchFor("zzzzzzzzzzzz", courses([{ id: "web", code: "X", name: "Y" }]), shared)).toBeNull()
    })
})
```

`src/components/sheet/layer.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"

// Joining, merging, the class sheet's Details and the class's shared details, with the store,
// the API, sync, the overlay and the toast as fakes; the effective lists, the class and merge
// rules and the marks are the real ones.
const fake = vi.hoisted(() => ({
    data: {
        profile: { id: "u-me", isAdmin: true } as Record<string, unknown>,
        courses: [] as unknown[], items: [] as unknown[], quotes: [] as unknown[], study_sessions: [] as unknown[], achievements: [] as unknown[],
        spaces: [] as unknown[], shared_courses: [] as unknown[], shared_items: [] as unknown[], marks: [] as unknown[], space_prefs: [] as unknown[],
    },
    store: { saveSpacePref: vi.fn(async () => {}), saveMark: vi.fn(async () => {}), saveShared: vi.fn(async () => {}), saveCourse: vi.fn(async () => {}) },
    api: { spaces: { absorb: vi.fn(async () => ({ paired: 1, filed: 1 })), get: vi.fn() }, invites: { list: vi.fn(async () => ({ invites: [] })) }, join: vi.fn() },
    syncNow: vi.fn(async () => true),
    overlay: { openSheet: vi.fn(), replaceSheet: vi.fn(), closeSheet: vi.fn(), onRequestClose: vi.fn(), beforeSheetClose: new Set<() => void>() },
    toast: vi.fn(),
}))
vi.mock("@/core/store", () => ({ data: fake.data, ...fake.store, subscribe: () => () => {} }))
vi.mock("@/core/api", () => {
    class ApiError extends Error {
        status: number
        body: Record<string, unknown> | null
        constructor(status: number, body: Record<string, unknown> | null) { super(String(body?.error ?? status)); this.status = status; this.body = body }
    }
    return { api: fake.api, ApiError }
})
vi.mock("@/core/sync", () => ({ syncNow: fake.syncNow, status: { state: "idle", pending: 0, message: "" }, onStatus: () => {} }))
vi.mock("@/data/overlay", () => fake.overlay)
vi.mock("@/data/toast", () => ({ toast: fake.toast }))
vi.mock("@/data/study-controller", () => ({ setView: vi.fn(), deleteLater: vi.fn(), deleteWithUndo: vi.fn() }))
vi.mock("@/data/sidebar", () => ({ setSide: vi.fn() }))

import { JoinSheet } from "./join-sheet"
import { MergeSheet } from "./merge-sheet"

const SID = "sp0000000001", WEB = "c:" + SID
const space = (role = "member") => ({
    id: SID, scope: WEB, kind: "class", role, archived: false, name: "Web Services", parent: null, revision: 3,
    members: [{ userId: "u-me", name: "George", role }, { userId: "u-gab", name: "Gabriel", role: "owner" }],
})
const course = { scope: WEB, id: "web", code: "CS 446", name: "Web Services", color: "#17B3AE", instructor: "Dr. Okafor", term: "", archived: false, target: null, meetings: [], updatedBy: null }
const pref = () => ({ id: SID, spaceId: SID, color: "#17B3AE", target: null, term: "", archived: false, revision: 2 })
const summary = { id: SID, scope: WEB, kind: "class" as const, name: "Web Services", role: "member" as const, members: 2 }

beforeEach(() => {
    Object.assign(fake.data, { courses: [], items: [], spaces: [space()], shared_courses: [course], shared_items: [], marks: [], space_prefs: [pref()] })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe("joining: your colour and semester", () => {
    it("saves your colour, then opens the class", async () => {
        render(<JoinSheet code="" space={summary} />)
        expect(await screen.findByText("You're in Web Services")).toBeTruthy()
        fireEvent.click(screen.getByRole("button", { name: "Coral" }))
        fireEvent.click(screen.getByRole("button", { name: "Open the class" }))
        await waitFor(() => expect(fake.overlay.openSheet).toHaveBeenCalledWith({ kind: "class", spaceId: SID, tab: "details" }))
        expect(fake.store.saveSpacePref).toHaveBeenCalledWith(expect.objectContaining({ id: SID, color: "#F08A6C" }))
    })

    it("goes on to the merge sheet when a course of yours matches the class", async () => {
        fake.data.courses = [{ id: "mine", code: "CS446", name: "My web course", color: "#B8457E", archived: false, meetings: [], term: "" }]
        render(<JoinSheet code="" space={summary} />)
        fireEvent.click(await screen.findByRole("button", { name: "Merge my course" }))
        await waitFor(() => expect(fake.overlay.openSheet).toHaveBeenCalledWith({ kind: "merge", spaceId: SID, courseId: "mine", fromCourse: false }))
        expect(fake.store.saveSpacePref).not.toHaveBeenCalled()
    })
})

describe("the merge sheet", () => {
    beforeEach(() => {
        fake.data.courses = [{ id: "mydb", code: "CS 446", name: "Web (mine)", color: "#B8457E", archived: false, meetings: [], term: "" }]
        fake.data.items = [
            { id: "x1", type: "quiz", title: "Quiz 1", courseId: "mydb", date: "2026-10-01", status: "graded", grade: 88, weight: 10, notes: "", checklist: [], links: [] },
            { id: "x2", type: "exam", title: "Midterm", courseId: "mydb", date: "2026-10-14", status: "todo", grade: null, weight: 30, notes: "", checklist: [], links: [] },
            { id: "x3", type: "c-viva", title: "Viva", courseId: "mydb", date: "2026-10-20", status: "todo", grade: null, weight: null, notes: "", checklist: [], links: [] },
        ]
        fake.data.shared_items = [
            { scope: WEB, id: "q1", type: "quiz", title: "Quiz 1", courseId: "web", date: "2026-10-01", status: "todo", grade: null, weight: 10, notes: "", checklist: [], links: [] },
            { scope: WEB, id: "e1", type: "exam", title: "Midterm", courseId: "web", date: "2026-10-15", status: "todo", grade: null, weight: 30, notes: "", checklist: [], links: [] },
        ]
    })

    it("pairs, lets you undo a pair, and merges what is left paired", async () => {
        render(<MergeSheet spaceId={SID} courseId="mydb" fromCourse={false} />)
        expect(within(screen.getByRole("list", { name: "Pairs" })).getAllByRole("listitem")).toHaveLength(2)
        expect(within(screen.getByRole("list", { name: "Stay yours" })).getByText(/^Viva/)).toBeTruthy()
        fireEvent.click(screen.getByRole("button", { name: "Not the same item: Midterm" }))
        expect(within(screen.getByRole("list", { name: "Stay yours" })).getByText(/^Midterm/)).toBeTruthy()
        fireEvent.click(screen.getByRole("button", { name: "Merge" }))
        await waitFor(() => expect(fake.api.spaces.absorb).toHaveBeenCalledWith(SID, { courseId: "mydb", pairs: [["x1", "q1"]], fromCourse: false }))
        await waitFor(() => expect(fake.overlay.openSheet).toHaveBeenCalledWith({ kind: "class", spaceId: SID, tab: "details" }))
    })

    it("Skip closes it and merges nothing", () => {
        render(<MergeSheet spaceId={SID} courseId="mydb" fromCourse={false} />)
        fireEvent.click(screen.getByRole("button", { name: "Skip" }))
        expect(fake.overlay.closeSheet).toHaveBeenCalled()
        expect(fake.api.spaces.absorb).not.toHaveBeenCalled()
    })
})
```

Stage 3's tests now wait for your prefs as part of a class arriving. In `src/data/classes.test.ts`:
- replace `        shared_courses: [] as { scope: string; id: string }[],` with `        shared_courses: [] as { scope: string; id: string }[],\n        space_prefs: [] as { id: string }[],` (two lines);
- replace `const arrive = () => { fake.data.spaces = [{ id: SID }]; fake.data.shared_courses = [{ scope: "c:" + SID, id: "db" }] }` with `const arrive = () => { fake.data.spaces = [{ id: SID }]; fake.data.shared_courses = [{ scope: "c:" + SID, id: "db" }]; fake.data.space_prefs = [{ id: SID }] }`;
- in the top-level `beforeEach`, after `    fake.data.shared_courses = []` add `    fake.data.space_prefs = []`;
- replace `expect(fake.toast).toHaveBeenCalledWith("Databases is now a shared class too. Your own course stays as it is.")` with `expect(fake.toast).toHaveBeenCalledWith("Databases is now a shared class. Your status, grades and notes moved with it.")`.

In `src/components/sheet/classes.test.tsx`:
- in `fake.data`, replace `spaces: [] as unknown[], shared_courses: [] as unknown[], shared_items: [] as unknown[],` with `spaces: [] as unknown[], shared_courses: [] as unknown[], shared_items: [] as unknown[], marks: [] as unknown[], space_prefs: [] as unknown[],`;
- after the line `const summary = { id: SID, scope: SCOPE, kind: "class", name: "Web Services", role: "member", members: 3 }` add `const pref = { id: SID, spaceId: SID, color: "#17B3AE", target: null, term: "", archived: false, revision: 2 }`;
- in the top-level `beforeEach`, replace `Object.assign(fake.data, { profile: { id: "u-me", isAdmin: true }, courses: [], items: [], spaces: [], shared_courses: [], shared_items: [] })` with `Object.assign(fake.data, { profile: { id: "u-me", isAdmin: true }, courses: [], items: [], spaces: [], shared_courses: [], shared_items: [], marks: [], space_prefs: [] })`;
- in each of the three places a test makes the class arrive (`fake.data.spaces = [space()]; fake.data.shared_courses = [course]` in "makes a blank one…", and `fake.data.spaces = [space("member")]; fake.data.shared_courses = [course]` in "checks the code, joins…" and in "follows a class joined from an invite…"), add `fake.data.space_prefs = [pref];` after `fake.data.shared_courses = [course];`.

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run src/data/merge.test.ts src/components/sheet/layer.test.tsx src/data/classes.test.ts src/components/sheet/classes.test.tsx`
Expected: FAIL: `./merge`, `./merge-sheet` do not exist; the join sheet has no colour; the convert toast is Stage 3's.

- [ ] **Step 3: The class calls (`src/data/classes.ts`)**

Replace the import `import { data } from "@/core/store"` with:

```ts
import * as store from "@/core/store"
import { data } from "@/core/store"
```

and `import type { Course, Invite, Item, Space, SpaceSummary } from "./types"` with `import type { Course, Invite, Item, Space, SpacePref, SpaceSummary } from "./types"`.

Replace `landed`:

```ts
/** The class, its course and your prefs for it are on this device (the prefs come in your own scope, in the same sync). */
export const landed = (id: string): boolean =>
    data.spaces.some((s) => s.id === id) && data.shared_courses.some((c) => c.scope === "c:" + id) && (data.space_prefs ?? []).some((p) => p.id === id)
```

After `freeColour` add:

```ts
/** Save a change to your prefs for a space (your colour, semester, target, archive); false while they have not arrived. */
export async function savePref(spaceId: string, patch: Partial<SpacePref>): Promise<boolean> {
    const held = (data.space_prefs ?? []).find((p) => p.id === spaceId)
    if (!held) return false
    await store.saveSpacePref({ ...held, ...patch })
    return true
}
```

In `makeBlank`, replace `color: freeColour(data.courses)` with `color: freeColour([...data.courses, ...(data.space_prefs ?? [])])`.

Replace `convert`'s doc comment and toast:

```ts
/** A class from your course `courseId` with the items picked: they move into the class with your layer on top (Stage 4 plan, Decision 6). */
export async function convert(courseId: string, items: string[]): Promise<void> {
    const space = await api.spaces.create({ kind: "class", convertCourseId: courseId, items })
    await arrive(space)
    toast(space.name + " is now a shared class. Your status, grades and notes moved with it.")
}
```

In the file's header comment, the last sentence ends "…and its rows stay out of the views until Stage 4 (effective.ts, SHARED_IN_VIEWS)." (across two lines); change that ending to "…and its rows join an admin's views with your marks on top (effective.ts)."

- [ ] **Step 4: The absorb call and the sheet kind**

In `src/core/api.ts`, in `api.spaces`, after the `dropCode` line add:

```ts
    /* merge a course of yours into the class (spec §13): pairs are [your item's id, the class's item's id] */
    absorb: (sid: string, body: { courseId: string; pairs: [string, string][]; fromCourse: boolean }): Promise<{ paired: number; filed: number }> =>
      request('POST', `/api/spaces/${sid}/absorb`, body),
```

In `src/data/overlay.ts`, in `SheetState`, after `    | { kind: "invites" }` add:

```ts
    | { kind: "merge"; spaceId: string; courseId: string; fromCourse: boolean }
```

In `src/components/sheet/sheet.tsx`, in `sheetLabel` after `    if (s.kind === "invites") return "Invites"` add `    if (s.kind === "merge") return "Merge into the class"`; after `const InvitesSheet = lazyNamed(…)` add

```tsx
const MergeSheet = lazyNamed(() => import("./merge-sheet"), "MergeSheet", { idle: false })
```

and after `                {shown?.kind === "invites" && <InvitesSheet />}` add

```tsx
                {shown?.kind === "merge" && <MergeSheet key={shown.spaceId + shown.courseId} spaceId={shown.spaceId} courseId={shown.courseId} fromCourse={shown.fromCourse} />}
```

- [ ] **Step 5: `src/data/merge.ts`**

```ts
// Merging a course of yours into a class (spec §11, §13): the merge sheet pairs your items
// with the class's (identical ids first, then the same type and title on the nearest date;
// unsure pairs are left apart), and the Worker's absorb batch moves your layer onto the
// class's items. Lecture reviews and items of your own types are never paired: they stay
// yours, filed under the class. Skipping stores nothing: while a course of yours matches a
// class, the class sheet and the course sheet offer the merge again.

import { api } from "@/core/api"
import * as sync from "@/core/sync"
import { data } from "@/core/store"
import { REVIEW_ID } from "@/core/shared"
import { diffDays } from "@/core/dates"
import { openSheet } from "./overlay"
import { openClass } from "./classes"
import { toast } from "./toast"
import type { Course, Item, SharedCourse } from "./types"

type Dated = Pick<Item, "id" | "type" | "title" | "date">

/** A title as the pairing compares it: lower case, letters and digits. */
export const normTitle = (t: string): string => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
const pairable = (it: Dated) => !it.type.startsWith("c-") && !(it.type === "task" && REVIEW_ID.test(it.id))
const same = (a: Dated, b: Dated) => a.type === b.type && normTitle(a.title) === normTitle(b.title)
const far = (a: Dated, b: Dated) => Math.abs(diffDays(a.date, b.date))
/* the one nearest by date; null when there is none, or two are as near (unsure) */
function nearest<T extends Dated>(from: Dated, list: T[]): T | null {
    if (!list.length) return null
    const d = Math.min(...list.map((x) => far(from, x)))
    const at = list.filter((x) => far(from, x) === d)
    return at.length === 1 ? at[0] : null
}

/** [your item's id, the class's item's id] pairs, and your items left apart (spec §11). */
export function pairItems(mine: Dated[], shared: Dated[]): { pairs: [string, string][]; apart: string[] } {
    const pairs: [string, string][] = [], usedMine = new Set<string>(), usedShared = new Set<string>()
    const live = mine.filter(pairable), ids = new Set(shared.map((s) => s.id))
    for (const it of live) if (ids.has(it.id)) { pairs.push([it.id, it.id]); usedMine.add(it.id); usedShared.add(it.id) }
    for (const it of live) {
        if (usedMine.has(it.id)) continue
        const s = nearest(it, shared.filter((x) => !usedShared.has(x.id) && same(it, x)))
        if (!s) continue
        /* only when yours is the nearest for theirs too: two of yours for one of theirs is unsure */
        const back = nearest(s, live.filter((m) => !usedMine.has(m.id) && same(m, s)))
        if (back?.id !== it.id) continue
        pairs.push([it.id, s.id]); usedMine.add(it.id); usedShared.add(s.id)
    }
    return { pairs, apart: mine.filter((it) => !usedMine.has(it.id)).map((it) => it.id) }
}

/** The course of yours that matches a class: one with the class course's id (a Stage 3 copy,
    a rejoin's copy), else the same code, else the same name. */
export function matchFor(spaceId: string, courses: Course[] = data.courses, shared: SharedCourse[] = data.shared_courses ?? []): Course | null {
    const cc = shared.find((c) => c.scope === "c:" + spaceId)
    if (!cc) return null
    const code = (s: string) => s.toLowerCase().replace(/\s+/g, "")
    return courses.find((c) => c.id === cc.id)
        ?? (cc.code ? courses.find((c) => code(c.code) === code(cc.code)) : undefined)
        ?? courses.find((c) => normTitle(c.name) === normTitle(cc.name))
        ?? null
}

/** The merge sheet for a course of yours and a class. `fromCourse`: opened from the class or the course rather than straight after joining, so your colour, semester and archive flag move too. */
export const openMerge = (spaceId: string, courseId: string, fromCourse: boolean) => openSheet({ kind: "merge", spaceId, courseId, fromCourse })

/** Merge (needs a connection): the Worker moves your layer and files the rest; the next sync brings it here. */
export async function mergeCourse(spaceId: string, courseId: string, pairs: [string, string][], fromCourse: boolean): Promise<void> {
    const { paired, filed } = await api.spaces.absorb(spaceId, { courseId, pairs, fromCourse })
    await sync.syncNow()
    const name = data.spaces.find((s) => s.id === spaceId)?.name || "the class"
    toast("Merged into " + name + ": " + paired + " paired, " + filed + " kept as yours, under the class.")
    openClass(spaceId)
}
```

- [ ] **Step 6: The merge sheet (`src/components/sheet/merge-sheet.tsx`)**

```tsx
// Merging a course of yours into a class (spec §11, §13), for admins until Stage 6. Your
// items are paired with the class's; "Not the same item" undoes a pair, and an unsure pair
// was never made. Merge moves your status, grades and notes onto the class's items and files
// the rest under the class; Skip changes nothing, and the class sheet offers it again.

import { useState } from "react"
import { tmeta } from "@/core/model"
import { shortDate } from "@/core/dates"
import { useCourses, useItems, useSharedItems, useSpaces } from "@/data/store"
import { closeSheet } from "@/data/overlay"
import { mergeCourse, pairItems } from "@/data/merge"
import { messageFor } from "@/data/classes"
import { useMaintenance } from "@/data/maintenance"
import type { EffectiveCourse, EffectiveItem } from "@/data/effective"
import { MaintenanceBar, MaintenancePage } from "@/components/maintenance"
import { Button, Note, Section, SheetBody, SheetFoot, SheetHead } from "./fields"

const TITLE = "m-0 text-[22px] leading-[1.22] font-[750] tracking-[-.02em] text-foreground"
const ROW = "flex items-center gap-2 rounded-lg bg-muted px-2.5 py-1.5 text-[12.5px]"

export function MergeSheet({ spaceId, courseId, fromCourse }: { spaceId: string; courseId: string; fromCourse: boolean }) {
    const scope = "c:" + spaceId
    const space = useSpaces().find((s) => s.id === spaceId) ?? null
    const course = (useCourses() as EffectiveCourse[]).find((c) => !c.source && c.id === courseId) ?? null
    const mine = (useItems() as EffectiveItem[]).filter((it) => !it.source && it.courseId === courseId).sort((a, b) => a.date.localeCompare(b.date))
    const theirs = useSharedItems().filter((it) => it.scope === scope)
    const [pairs, setPairs] = useState(() => pairItems(mine, theirs).pairs)
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState("")
    const maintenance = useMaintenance("classes")

    if (maintenance === "blocked") return (
        <>
            <SheetHead kind="Merge into the class" onClose={closeSheet} />
            <SheetBody><MaintenancePage feature="classes" inSheet /></SheetBody>
        </>
    )
    if (!space || !course) return (
        <>
            <SheetHead kind="Merge into the class" onClose={closeSheet} />
            <SheetBody><Note>Nothing to merge: the course or the class is no longer on this device.</Note></SheetBody>
            <SheetFoot hint=""><Button onClick={closeSheet}>Done</Button></SheetFoot>
        </>
    )
    const paired = new Set(pairs.map(([m]) => m))
    const apart = mine.filter((it) => !paired.has(it.id))
    const merge = async () => {
        setBusy(true); setErr("")
        try { await mergeCourse(spaceId, courseId, pairs, fromCourse) } catch (e) { setErr(messageFor(e)); setBusy(false) }
    }

    return (
        <>
            <SheetHead color={course.color} kind="Merge into the class" onClose={closeSheet} />
            <SheetBody>
                {maintenance === "admin" && <MaintenanceBar />}
                <h2 className={TITLE}>Merge {course.name} into {space.name}</h2>
                <Note>Paired items become the class's, with your status, grade and notes on top, seen only by you. The rest stay yours, filed under the class. Your course goes once it is empty.</Note>
                <Section title="Pairs" note={String(pairs.length)}>
                    {pairs.length === 0 ? <Note>Nothing pairs up: every item stays yours.</Note> : (
                        <ul aria-label="Pairs" className="m-0 flex list-none flex-col gap-1 p-0">
                            {pairs.map(([m, s]) => {
                                const a = mine.find((x) => x.id === m), b = theirs.find((x) => x.id === s)
                                if (!a || !b) return null
                                return (
                                    <li key={m} className={ROW}>
                                        <span className="flex min-w-0 flex-1 flex-col">
                                            <span className="truncate">{a.title} <span className="text-muted-foreground">· {shortDate(a.date)}</span></span>
                                            <span className="truncate text-[11px] text-muted-foreground">→ {b.title} · {shortDate(b.date)}</span>
                                        </span>
                                        <Button variant="ghost" aria-label={"Not the same item: " + a.title} onClick={() => setPairs(pairs.filter(([x]) => x !== m))}>Not the same item</Button>
                                    </li>
                                )
                            })}
                        </ul>
                    )}
                </Section>
                {apart.length > 0 && (
                    <Section title="Stay yours, under the class" note={String(apart.length)}>
                        <ul aria-label="Stay yours" className="m-0 flex list-none flex-col gap-1 p-0">
                            {apart.map((it) => <li key={it.id} className={ROW}>{it.title} · {tmeta(it.type).label}</li>)}
                        </ul>
                    </Section>
                )}
                {err && <Note tone="bad">{err}</Note>}
            </SheetBody>
            <SheetFoot hint="Needs a connection">
                <Button variant="ghost" onClick={closeSheet}>Skip</Button>
                <Button disabled={busy} onClick={() => void merge()}>{busy ? "Merging…" : "Merge"}</Button>
            </SheetFoot>
        </>
    )
}
```

- [ ] **Step 7: The join sheet (`src/components/sheet/join-sheet.tsx`)**

Replace the whole file with:

```tsx
// Joining a class (spec §11, §20), for admins until Stage 6: with a code (a /#join= link
// fills it in), or straight after accepting an invite. The class downloads onto this device;
// then you confirm your semester for it (with a school calendar) and your colour, and, when a
// course of yours matches the class, go on to merge it. The school-calendar offer comes with
// Stage 6.

import { useEffect, useId, useState } from "react"
import { normalizeCode } from "@/core/shared"
import { PALETTE } from "@/core/model"
import { currentTerm, type SchoolCalendar } from "@/core/school"
import { today } from "@/core/dates"
import { data } from "@/core/store"
import { closeSheet } from "@/data/overlay"
import { download, joinWithCode, messageFor, openClass, savePref } from "@/data/classes"
import { matchFor, openMerge } from "@/data/merge"
import { schoolCal } from "@/data/query"
import { semesterOptions } from "@/data/course-edit"
import { useMaintenance } from "@/data/maintenance"
import type { SpaceSummary } from "@/data/types"
import { MaintenanceBar, MaintenancePage } from "@/components/maintenance"
import { Button, Fields, Label, Note, Select, SheetBody, SheetFoot, SheetHead, Swatches, TextInput } from "./fields"

type Stage = { at: "code" } | { at: "loading"; space: SpaceSummary } | { at: "done"; space: SpaceSummary; here: boolean }
const TITLE = "m-0 text-[22px] leading-[1.22] font-[750] tracking-[-.02em] text-foreground"
const asRole = (role: string) => (role === "editor" ? "an editor" : "a " + role)

/** The semester offered for a class (spec §8): its own when your calendar has a semester of that name, else the one covering today. */
export function defaultTerm(classTerm: string, cal: SchoolCalendar | null, day = today()): string {
    if (!cal) return classTerm
    return cal.terms.some((t) => t.name === classTerm) ? classTerm : currentTerm(cal, day)?.name ?? ""
}

export function JoinSheet({ code: given, space }: { code: string; space: SpaceSummary | null }) {
    const [code, setCode] = useState(given)
    const [stage, setStage] = useState<Stage>(space ? { at: "loading", space } : { at: "code" })
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState("")
    const maintenance = useMaintenance("classes")

    /* the class's rows download, then the sheet says so */
    useEffect(() => {
        if (stage.at !== "loading") return
        let live = true
        void download(stage.space.id).then((here) => { if (live) setStage({ at: "done", space: stage.space, here }) })
        return () => { live = false }
    }, [stage])

    const join = async () => {
        if (!normalizeCode(code)) { setErr("A code is 8 characters."); return }
        setBusy(true); setErr("")
        try { setStage({ at: "loading", space: await joinWithCode(code) }) }
        catch (e) { setErr(messageFor(e)) }
        finally { setBusy(false) }
    }

    if (maintenance === "blocked") return (
        <>
            <SheetHead kind="Join a class" onClose={closeSheet} />
            <SheetBody><MaintenancePage feature="classes" inSheet /></SheetBody>
        </>
    )
    if (stage.at === "loading") return (
        <>
            <SheetHead kind="Joining" onClose={closeSheet} />
            <SheetBody>
                <div role="status"><h2 className={TITLE}>Downloading {stage.space.name}…</h2></div>
                <Note>The class's course and items land on this device, so they work offline.</Note>
            </SheetBody>
        </>
    )
    if (stage.at === "done") return <Joined space={stage.space} here={stage.here} bar={maintenance === "admin"} />
    return (
        <>
            <SheetHead kind="Join a class" onClose={closeSheet} />
            <SheetBody>
                {maintenance === "admin" && <MaintenanceBar />}
                <h2 className={TITLE}>Join with a code</h2>
                <Note>Eight characters from the class's owner. A link with #join= in it fills this in for you.</Note>
                <TextInput aria-label="Join code" value={code} maxLength={9} placeholder="7KQ2 M9XD" autoFocus spellCheck={false} autoComplete="off"
                    className="h-[46px] font-mono text-[18px] tracking-[.12em] uppercase"
                    onChange={(e) => { setCode(e.target.value); setErr("") }}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void join() } }} />
                {err && <Note tone="bad">{err}</Note>}
            </SheetBody>
            <SheetFoot hint="Needs a connection">
                <Button variant="ghost" onClick={closeSheet}>Cancel</Button>
                <Button disabled={busy} onClick={() => void join()}>Join</Button>
            </SheetFoot>
        </>
    )
}

/* In: your semester and colour for the class (your prefs, written by the Worker when you
   joined, adjusted here), then the class, or the merge sheet for a course of yours like it. */
function Joined({ space: s, here, bar }: { space: SpaceSummary; here: boolean; bar: boolean }) {
    const f = useId(), cal = schoolCal()
    const pref = (data.space_prefs ?? []).find((p) => p.id === s.id) ?? null
    const classTerm = (data.shared_courses ?? []).find((c) => c.scope === s.scope)?.term ?? ""
    const [color, setColor] = useState(pref?.color ?? "")
    const [term, setTerm] = useState(() => defaultTerm(pref?.term ?? classTerm, cal))
    const match = matchFor(s.id)
    const go = async (next: () => void) => {
        if (pref && (color !== pref.color || term !== pref.term)) await savePref(s.id, { color, term })
        next()
    }
    const terms = cal ? semesterOptions(cal) : []
    return (
        <>
            <SheetHead kind="Joined" onClose={closeSheet} />
            <SheetBody>
                {bar && <MaintenanceBar />}
                <h2 className={TITLE}>You're in {s.name}</h2>
                <Note>{s.members} {s.members === 1 ? "member" : "members"} · you joined as {asRole(s.role)}.</Note>
                {!here && <Note>It hasn't finished downloading. It arrives with the next sync.</Note>}
                {pref && (
                    <Fields>
                        {cal && <>
                            <Label htmlFor={f + "term"}>Your semester</Label>
                            <Select id={f + "term"} value={term} onChange={(e) => setTerm(e.target.value)}>
                                {terms.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                            </Select>
                        </>}
                        <Label>Your colour</Label>
                        <Swatches value={color} colors={PALETTE} onChange={setColor} />
                    </Fields>
                )}
                {match && <Note>You have a course of your own like it, {match.name}. Merge it next, so your grades and notes sit on the class's items.</Note>}
            </SheetBody>
            <SheetFoot hint="Only you see your colour and semester">
                <Button variant="ghost" onClick={() => void go(closeSheet)}>Done</Button>
                {match
                    ? <Button onClick={() => void go(() => openMerge(s.id, match.id, false))}>Merge my course</Button>
                    : <Button onClick={() => void go(() => openClass(s.id))}>Open the class</Button>}
            </SheetFoot>
        </>
    )
}
```

- [ ] **Step 8: The convert's words (`src/components/sheet/convert-sheet.tsx`, `new-class-sheet.tsx`)**

In `src/components/sheet/convert-sheet.tsx`, replace the header's last two lines

```tsx
// own types cannot go. Stage 3 copies the course and the ticked items into the class and
// leaves your own course as it is (Stage 3 plan, Decision 1).
```

with

```tsx
// own types cannot go. The course and the ticked items move into the class with your status,
// grades and notes on top (your marks); the rest stay yours, filed under the class.
```

replace `<Note>Ticked items are copied into the class. Tasks start unticked.</Note>` with `<Note>Ticked items move into the class: everyone in it sees their dates, weights and class notes. Tasks start unticked.</Note>`, and replace `<Note>Your own course stays as it is, with your status, grades and notes. They are never shared.</Note>` with `<Note>Your status, grades and notes move with you and are never shared. Unticked items stay yours, filed under the class.</Note>`.

In `src/components/sheet/new-class-sheet.tsx`, replace `["convert", "Convert a course you have", "Copies the course and the items you tick."],` with `["convert", "Convert a course you have", "Moves the course and the items you tick into the class."],`.

- [ ] **Step 9: Run the tests and the type check**

Run: `npx vitest run src/data/merge.test.ts src/components/sheet/layer.test.tsx src/data/classes.test.ts src/components/sheet/classes.test.tsx src/components/sheet/sheet.test.tsx`, then `npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 10: Commit**

```bash
git add src/data/classes.ts src/data/classes.test.ts src/core/api.ts src/data/overlay.ts src/components/sheet/sheet.tsx src/data/merge.ts src/data/merge.test.ts src/components/sheet/merge-sheet.tsx src/components/sheet/join-sheet.tsx src/components/sheet/convert-sheet.tsx src/components/sheet/new-class-sheet.tsx src/components/sheet/classes.test.tsx src/components/sheet/layer.test.tsx
git commit -m "Joining asks your semester and colour; the merge sheet pairs a course of yours with a class

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JpUR1JXMY3ehtkiJwuij95"
npm run build
```

---

### Task 28: The class sheet's Yours, the class's details, and Share this course

**Files:**
- Create: `src/components/sheet/grades.tsx` (the course sheet's `Grades`, moved, with a title)
- Modify: `src/components/sheet/course-sheet.tsx` (shared mode; keyed items)
- Modify: `src/components/sheet/class-sheet.tsx` (whole file below)
- Modify: `src/components/sheet/share-course.tsx` (whole file below)
- Modify: `src/components/sheet/layer.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `src/components/sheet/layer.test.tsx`, after the line `vi.mock("@/data/sidebar", () => ({ setSide: vi.fn() }))` add:

```tsx
vi.mock("@/data/actions", () => ({ deleteCourse: vi.fn(), openCourse: vi.fn() }))
```

after the line `import { MergeSheet } from "./merge-sheet"` add:

```tsx
import { ClassSheet } from "./class-sheet"
import { CourseSheet } from "./course-sheet"
import { ShareCourse } from "./share-course"
```

and append:

```tsx
describe("the class sheet's Details", () => {
    beforeEach(() => {
        fake.data.spaces = [space("owner")]
        fake.data.shared_items = [
            { scope: WEB, id: "a1", type: "assignment", title: "REST API Project", courseId: "web", date: "2026-10-15", status: "todo", grade: null, weight: 20, notes: "", checklist: [], links: [] },
            { scope: WEB, id: "h1", type: "quiz", title: "Pop quiz", courseId: "web", date: "2026-10-02", status: "todo", grade: null, weight: 10, notes: "", checklist: [], links: [] },
        ]
        fake.data.marks = [
            { id: SID + ":a1", spaceId: SID, itemId: "a1", status: "graded", grade: 80, weight: null, notes: "", checklist: [], completedAt: 1, hidden: false },
            { id: SID + ":h1", spaceId: SID, itemId: "h1", status: "todo", grade: null, weight: null, notes: "", checklist: [], completedAt: null, hidden: true },
        ]
    })

    it("shows your colour, your grade so far, and what you hid, to show again", async () => {
        render(<ClassSheet spaceId={SID} tab="details" />)
        expect(screen.getByRole("heading", { name: /^Your grade so far/ })).toBeTruthy()
        expect(within(screen.getByRole("list", { name: "Class items" })).queryByText("Pop quiz")).toBeNull()
        fireEvent.click(screen.getByRole("button", { name: "Royal blue" }))
        await waitFor(() => expect(fake.store.saveSpacePref).toHaveBeenCalledWith(expect.objectContaining({ id: SID, color: "#4F74D9" })))
        fireEvent.click(screen.getByRole("button", { name: "Show Pop quiz again" }))
        await waitFor(() => expect(fake.store.saveMark).toHaveBeenCalledWith(expect.objectContaining({ id: SID + ":h1", hidden: false })))
    })

    it("opens an item in its card, and the class's details for its owner", () => {
        render(<ClassSheet spaceId={SID} tab="details" />)
        fireEvent.click(screen.getByRole("button", { name: "REST API Project" }))
        expect(fake.overlay.openSheet).toHaveBeenCalledWith({ kind: "item", id: WEB + "/a1" })
        fireEvent.click(screen.getByRole("button", { name: "Edit class details" }))
        expect(fake.overlay.openSheet).toHaveBeenLastCalledWith({ kind: "course", id: WEB + "/web" })
    })

    it("offers to merge a course of yours like the class", () => {
        fake.data.courses = [{ id: "web", code: "CS 446", name: "Web (my copy)", color: "#B8457E", archived: false, meetings: [], term: "" }]
        render(<ClassSheet spaceId={SID} tab="details" />)
        fireEvent.click(screen.getByRole("button", { name: "Merge…" }))
        expect(fake.overlay.openSheet).toHaveBeenCalledWith({ kind: "merge", spaceId: SID, courseId: "web", fromCourse: true })
    })
})

describe("the class's details in the course sheet", () => {
    it("are its shared facts, saved for everyone; no grades, archive or delete", async () => {
        fake.data.spaces = [space("editor")]
        render(<CourseSheet id={WEB + "/web"} />)
        expect(screen.queryByRole("button", { name: "Delete" })).toBeNull()
        expect(screen.queryByText(/hidden from the sidebar/)).toBeNull()
        fireEvent.change(screen.getByRole("textbox", { name: "Teacher" }), { target: { value: "Dr. Lin" } })
        fireEvent.click(screen.getByRole("button", { name: "Save course" }))
        await waitFor(() => expect(fake.store.saveShared).toHaveBeenCalledWith("shared_courses", expect.objectContaining({ scope: WEB, id: "web", instructor: "Dr. Lin", target: null, archived: false })))
        expect(fake.store.saveCourse).not.toHaveBeenCalled()
    })
})

describe("Share this course, with a class like it", () => {
    it("offers merging the course into the class", () => {
        fake.data.spaces = [space("owner")]
        fake.data.courses = [{ id: "web", code: "CS 446", name: "Web", color: "#B8457E", archived: false, meetings: [], term: "" }]
        render(<ShareCourse courseId="web" dirty={false} />)
        fireEvent.click(screen.getByRole("button", { name: "Merge into the class" }))
        expect(fake.overlay.openSheet).toHaveBeenCalledWith({ kind: "merge", spaceId: SID, courseId: "web", fromCourse: true })
    })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run src/components/sheet/layer.test.tsx`
Expected: FAIL: the class sheet has no Yours, grade or hidden list; the course sheet opens a new personal course for the class's key; Share this course offers no merge.

- [ ] **Step 3: `Grades` moves to `src/components/sheet/grades.tsx`**

Cut the `Grades` function from `src/components/sheet/course-sheet.tsx` (from the comment `/* Weighted grade so far, how much of the course it covers, …` to the end of the file) and create `src/components/sheet/grades.tsx` with:

```tsx
// Weighted grade so far, how much of the course it covers, what the rest needs to reach 50,
// 60, 70 or your own target, and what-if scores for what is still to come (never saved). The
// course sheet shows it for a course of yours; the class sheet, as "Your grade so far", over
// the class's items with your marks on top (spec §8).

import { useId } from "react"
import { cn } from "@/lib/utils"
import { courseGrade, neededLabel, targetsFor, ungraded } from "@/core/grades"
import type { Course, Item } from "@/data/types"
import { Meter, Note, NumberInput, Section, Warning } from "./fields"
```

followed by the function, exported, with a `title` (the default keeps the course sheet as it is): its first lines become

```tsx
export function Grades({ title = "Grades", course, items, whatIf, setWhatIf, onTarget }: {
    title?: string; course: Course; items: Item[]; whatIf: Record<string, number>; setWhatIf: (w: Record<string, number>) => void; onTarget: (t: number | null) => void
}) {
```

and its `<Section title="Grades" note={…}>` becomes `<Section title={title} note={…}>`; the rest is unchanged. In `course-sheet.tsx`, after `import { TimeField } from "./time-field"` add `import { Grades } from "./grades"`, and delete `import { courseGrade, neededLabel, targetsFor, ungraded } from "@/core/grades"`.

- [ ] **Step 4: The course sheet's shared mode (`src/components/sheet/course-sheet.tsx`)**

Replace `import { useCourses, useItems, useProfile } from "@/data/store"` with:

```tsx
import { useCourses, useItems, useProfile, useSharedCourses } from "@/data/store"
import { courseKeyOf, type EffectiveCourse } from "@/data/effective"
import { isSharedKey, splitKey } from "@/data/refs"
import type { Row } from "@/core/db"
```

After the file's header comment (it ends `a draft until Save; leaving with changes asks first.`) add:

```tsx
// Opened with a class's key (from the class sheet's Edit class details), it edits the
// class's shared facts for everyone: no grades, archive or delete, which are each member's.
```

Replace

```tsx
    const courses = useCourses()
    const items = useItems()
    const stored = id ? courses.find((c) => c.id === id) ?? null : null
```

with

```tsx
    const courses = useCourses() as EffectiveCourse[]
    const sharedRows = useSharedCourses()
    const items = useItems()
    /* a class's course by its key: the class's own row, saved for everyone */
    const shared = id && isSharedKey(id) ? splitKey(id) : null
    const stored = shared
        ? sharedRows.find((c) => c.scope === shared.scope && c.id === shared.id) ?? null
        : id ? courses.find((c) => !c.source && c.id === id) ?? null : null
```

Replace `save`:

```tsx
    const save = async () => {
        if (!draft.name.trim()) return
        if (shared) await store.saveShared("shared_courses", { ...forSaving(draft), scope: shared.scope, target: null, archived: false } as unknown as Row & { scope: string })
        else await store.saveCourse(forSaving(draft))
        closeSheet()
    }
```

Replace `    const mine = useMemo(() => items.filter((it) => it.courseId === draft.id), [items, draft.id])` with:

```tsx
    /* by key: a class's items, whose course may have this id too, are not this course's */
    const mine = useMemo(() => items.filter((it) => courseKeyOf(it) === draft.id), [items, draft.id])
```

Before the component's main `return (` add:

```tsx
    if (shared && !stored) return (
        <>
            <SheetHead kind="Class details" onClose={closeSheet} />
            <SheetBody><Note>This class isn't on this device yet. It arrives with the next sync.</Note></SheetBody>
            <SheetFoot hint=""><Button onClick={closeSheet}>Done</Button></SheetFoot>
        </>
    )
```

In the JSX:
- replace `kind={isNew ? "New course" : "Course"}` with `kind={shared ? "Class details" : isNew ? "New course" : "Course"}`;
- replace `                    {!isNew && <>\n                        <Label htmlFor={f + "arch"}>Archived</Label>` (the archived block's opening) with `                    {!isNew && !shared && <>\n                        <Label htmlFor={f + "arch"}>Archived</Label>`;
- after the `</Fields>` that closes that block add `{shared && <Note>Everyone in the class sees these; each member's colour and semester start from them. Yours are in the class's Yours.</Note>}`;
- replace `{!isNew && <Grades` with `{!isNew && !shared && <Grades`;
- replace `{!isNew && admin && <ShareCourse` with `{!isNew && !shared && admin && <ShareCourse`;
- replace `{!isNew && mine.length > 0 && (` with `{!isNew && !shared && mine.length > 0 && (`;
- replace `{!isNew && <Button variant="ghost" onClick={() => void deleteCourse(draft.id)}>Delete</Button>}` with `{!isNew && !shared && <Button variant="ghost" onClick={() => void deleteCourse(draft.id)}>Delete</Button>}`.

- [ ] **Step 5: The class sheet (`src/components/sheet/class-sheet.tsx`)**

Replace the whole file with:

```tsx
// A shared class in the sheet (spec §15), for admins until Stage 6. **Details**: the class's
// facts and its items (each opening in the item card), with Edit class details for the owner
// and editors; **Yours**: your colour, semester and sidebar archive for it, your grade so far
// over its items with your marks on top, and the items you hid, to show again; a banner while
// a course of yours looks like the class and is not merged. **Members**: who is in it,
// invites, the join code, roles.

import { useId, useState } from "react"
import { cn } from "@/lib/utils"
import { PALETTE, tmeta } from "@/core/model"
import { shortDate } from "@/core/dates"
import { useCourses, useItems, useMarks, useSharedCourses, useSharedItems, useSpacePrefs, useSpaces } from "@/data/store"
import { closeSheet, openSheet, replaceSheet, type ClassTab } from "@/data/overlay"
import { courseKeyOf, keyOf, type EffectiveCourse } from "@/data/effective"
import { keyedItems } from "@/data/refs"
import { hiddenIn, setHidden } from "@/data/marks"
import { matchFor, openMerge } from "@/data/merge"
import { savePref } from "@/data/classes"
import { schoolCal } from "@/data/query"
import { semesterOptions } from "@/data/course-edit"
import { useMaintenance } from "@/data/maintenance"
import type { SharedCourse, SharedItem, Space, SpacePref } from "@/data/types"
import { SharedGlyph } from "@/components/shared-glyph"
import { MaintenanceBar, MaintenancePage } from "@/components/maintenance"
import { tabKeys } from "./radio-keys"
import { Button, Checkbox, Fields, Label, Note, Section, Select, SheetBody, SheetFoot, SheetHead, Swatches } from "./fields"
import { Grades } from "./grades"
import { MembersTab } from "./members-tab"

const TABS: readonly [ClassTab, string][] = [["details", "Details"], ["members", "Members"]]
const TITLE = "m-0 text-[22px] leading-[1.22] font-[750] tracking-[-.02em] text-foreground"
const KEY = "text-muted-foreground"
const LIST = "m-0 flex list-none flex-col gap-1 p-0"
const ROW = "flex items-baseline gap-2 rounded-lg bg-muted px-2.5 py-1.5 text-[12.5px]"

export function ClassSheet({ spaceId, tab }: { spaceId: string; tab: ClassTab }) {
    const scope = "c:" + spaceId
    const space = useSpaces().find((s) => s.id === spaceId) ?? null
    const course = useSharedCourses().find((c) => c.scope === scope) ?? null
    const items = useSharedItems().filter((it) => it.scope === scope).sort((a, b) => a.date.localeCompare(b.date))
    const maintenance = useMaintenance("classes")
    const f = useId()

    if (maintenance === "blocked") return (
        <>
            <SheetHead kind="Class" onClose={closeSheet} />
            <SheetBody><MaintenancePage feature="classes" inSheet /></SheetBody>
        </>
    )
    if (!space || !course) return (
        <>
            <SheetHead kind="Class" onClose={closeSheet} />
            <SheetBody><Note>This class isn't on this device yet. It arrives with the next sync.</Note></SheetBody>
            <SheetFoot hint=""><Button onClick={closeSheet}>Done</Button></SheetFoot>
        </>
    )
    const n = space.members.length
    return (
        <>
            <SheetHead color={course.color} kind="Class" onClose={closeSheet}>
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-px text-[10.5px] font-semibold text-ink-2">
                    <SharedGlyph className="size-3" /> Shared · {space.role}
                </span>
            </SheetHead>
            <div className="px-[18px] pt-4"><h2 className={TITLE}>{course.name}</h2></div>
            <div role="tablist" aria-label="Class" onKeyDown={tabKeys} className="flex gap-1 border-b border-border px-3">
                {TABS.map(([id, label]) => (
                    <button
                        key={id}
                        type="button"
                        role="tab"
                        id={f + id}
                        aria-selected={tab === id}
                        aria-controls={tab === id ? f + "panel" : undefined}
                        tabIndex={tab === id ? 0 : -1}
                        onClick={() => replaceSheet({ kind: "class", spaceId, tab: id })}
                        className={cn(
                            "h-10 flex-none cursor-pointer border-0 bg-transparent px-3 font-[inherit] text-[13px] outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--accent)]",
                            tab === id ? "font-semibold text-foreground shadow-[inset_0_-2px_0_var(--primary)]" : "font-medium text-muted-foreground hover:text-foreground",
                        )}
                    >
                        {label}
                    </button>
                ))}
            </div>
            <SheetBody>
                <div role="tabpanel" id={f + "panel"} aria-labelledby={f + tab} className="flex flex-col gap-3.5">
                    {maintenance === "admin" && <MaintenanceBar />}
                    {tab === "details" ? <Details space={space} course={course} items={items} /> : <MembersTab spaceId={spaceId} />}
                </div>
            </SheetBody>
            <SheetFoot hint={n + (n === 1 ? " member" : " members")}>
                <Button onClick={closeSheet}>Done</Button>
            </SheetFoot>
        </>
    )
}

function Details({ space, course, items }: { space: Space; course: SharedCourse; items: SharedItem[] }) {
    const scope = space.scope, classKey = scope + "/" + course.id
    const editor = space.role !== "member" && !space.archived
    const pref = useSpacePrefs().find((p) => p.id === space.id) ?? null
    const marks = useMarks()
    const courses = useCourses() as EffectiveCourse[]
    const all = useItems()
    const [whatIf, setWhatIf] = useState<Record<string, number>>({})
    const hidden = hiddenIn(scope, items, marks)
    const off = new Set(hidden.map((it) => it.id))
    const shown = items.filter((it) => !off.has(it.id))
    /* your grade over the class's items with your marks on top, and your items filed under it */
    const mine = keyedItems(all.filter((it) => courseKeyOf(it) === classKey))
    const yours = courses.find((c) => keyOf(c) === classKey) ?? course
    const match = matchFor(space.id, courses.filter((c) => !c.source), [course])

    return (
        <>
            {match && (
                <div role="note" className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--warn-line)] bg-[var(--warn-bg)] px-2.5 py-2 text-[12px] text-[var(--warn-ink)]">
                    <span className="min-w-0 flex-1">Your own course {match.name} looks like this class. Merge it, so your grades and notes sit on the class's items.</span>
                    <Button variant="ghost" onClick={() => openMerge(space.id, match.id, true)}>Merge…</Button>
                </div>
            )}
            <Section title={<><SharedGlyph /> Class</>} note={editor ? "You change these for everyone" : "The owner and editors keep it"}>
                <dl className="m-0 grid grid-cols-[86px_minmax(0,1fr)] gap-x-2.5 gap-y-1.5 text-[12.5px]">
                    <dt className={KEY}>Code</dt><dd className="m-0">{course.code || "—"}</dd>
                    <dt className={KEY}>Teacher</dt><dd className="m-0">{course.instructor || "—"}</dd>
                    <dt className={KEY}>Semester</dt><dd className="m-0">{course.term || "—"}</dd>
                    <dt className={KEY}>Classes</dt><dd className="m-0">{course.meetings.length ? course.meetings.length + " a week" : "—"}</dd>
                    <dt className={KEY}>Members</dt><dd className="m-0">{space.members.length}</dd>
                </dl>
                {editor && <Button variant="ghost" className="self-start" onClick={() => openSheet({ kind: "course", id: classKey })}>Edit class details</Button>}
            </Section>
            <Section title="Items" note={String(shown.length)}>
                {shown.length === 0 ? <Note>No items in this class yet.</Note> : (
                    <ul aria-label="Class items" className={LIST}>
                        {shown.map((it) => (
                            <li key={it.id} className={ROW}>
                                <button type="button" onClick={() => openSheet({ kind: "item", id: scope + "/" + it.id })}
                                    className="min-w-0 flex-1 cursor-pointer truncate border-0 bg-transparent p-0 text-left font-[inherit] text-foreground hover:underline">{it.title}</button>
                                <span className="shrink-0 text-[11px] text-muted-foreground">
                                    {tmeta(it.type).label} · {shortDate(it.date)}{it.weight != null ? " · " + it.weight + "%" : ""}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </Section>
            <Yours space={space} pref={pref} />
            <Grades title="Your grade so far" course={yours} items={mine} whatIf={whatIf} setWhatIf={setWhatIf} onTarget={(target) => void savePref(space.id, { target })} />
            {hidden.length > 0 && (
                <Section title="Hidden from you" note={String(hidden.length)}>
                    <ul aria-label="Hidden from you" className={LIST}>
                        {hidden.map((it) => (
                            <li key={it.id} className={cn(ROW, "items-center")}>
                                <span className="min-w-0 flex-1 truncate text-muted-foreground">{it.title}</span>
                                <Button variant="ghost" aria-label={"Show " + it.title + " again"} onClick={() => void setHidden(scope + "/" + it.id, false)}>Show again</Button>
                            </li>
                        ))}
                    </ul>
                </Section>
            )}
        </>
    )
}

/* Your settings for the class: only you see them (spec §4). */
function Yours({ space, pref }: { space: Space; pref: SpacePref | null }) {
    const f = useId(), cal = schoolCal()
    if (!pref) return <Section title="Yours"><Note>Your colour and semester for this class arrive with the next sync.</Note></Section>
    const set = (patch: Partial<SpacePref>) => void savePref(space.id, patch)
    const terms = cal ? semesterOptions(cal) : []
    return (
        <Section title="Yours" note="Only you see these">
            <Fields>
                <Label>Colour</Label>
                <Swatches value={pref.color} colors={PALETTE} onChange={(color) => set({ color })} />
                {cal && <>
                    <Label htmlFor={f + "term"}>Semester</Label>
                    <Select id={f + "term"} value={pref.term} onChange={(e) => set({ term: e.target.value })}>
                        {terms.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                        {pref.term && !terms.some(([v]) => v === pref.term) && <option value={pref.term}>{pref.term}</option>}
                    </Select>
                </>}
                <Label htmlFor={f + "arch"}>Archived</Label>
                <Checkbox id={f + "arch"} checked={pref.archived} onChange={(archived) => set({ archived })}>hidden from your sidebar, items kept</Checkbox>
            </Fields>
        </Section>
    )
}
```

- [ ] **Step 6: Share this course (`src/components/sheet/share-course.tsx`)**

Replace the whole file with:

```tsx
// "Share this course" in a course's sheet, for admins until Stage 6 (spec §13, §15): convert
// it into a shared class; or, when a class you are in looks like it (one made from it by a
// Stage 3 convert, or one you joined with the same code or name), merge it into that class.

import { useCourses, useSharedCourses, useSpaces } from "@/data/store"
import { classFrom, openClass, openConvert } from "@/data/classes"
import { matchFor, openMerge } from "@/data/merge"
import type { EffectiveCourse } from "@/data/effective"
import { SharedGlyph } from "@/components/shared-glyph"
import { Button, Note, Section } from "./fields"

export function ShareCourse({ courseId, dirty }: { courseId: string; dirty: boolean }) {
    const spaces = useSpaces(), shared = useSharedCourses()
    const own = (useCourses() as EffectiveCourse[]).filter((c) => !c.source)
    const made = classFrom(courseId, spaces, shared)
    const into = made ?? spaces.find((s) => s.kind === "class" && matchFor(s.id, own, shared)?.id === courseId) ?? null
    return (
        <Section title={<><SharedGlyph /> Share this course</>}>
            {into ? <>
                <Note>{made ? "You made the shared class " + into.name + " from this course." : "It looks like your shared class " + into.name + "."} Merge it, so your grades and notes sit on the class's items and the course goes.</Note>
                <span className="flex flex-wrap gap-2">
                    <Button variant="ghost" disabled={dirty} onClick={() => openMerge(into.id, courseId, true)}>Merge into the class</Button>
                    <Button variant="ghost" onClick={() => openClass(into.id)}>Open the class</Button>
                </span>
                {dirty && <Note>Save your changes first.</Note>}
            </> : <>
                <Note>Turn it into a shared class. Classmates get the dates, weights and class notes; your status, grades and notes stay yours.</Note>
                <Button variant="ghost" className="self-start" disabled={dirty} onClick={() => openConvert(courseId)}>Convert to shared class</Button>
                {dirty && <Note>Save your changes first.</Note>}
            </>}
        </Section>
    )
}
```

- [ ] **Step 7: Run the tests and the type check**

Run: `npx vitest run src/components/sheet/layer.test.tsx src/components/sheet/classes.test.tsx src/components/sheet/sheet.test.tsx`, then `npm run typecheck`
Expected: PASS (Stage 3's class sheet and Share this course tests too), no type errors.

- [ ] **Step 8: Commit**

```bash
git add src/components/sheet/grades.tsx src/components/sheet/course-sheet.tsx src/components/sheet/class-sheet.tsx src/components/sheet/share-course.tsx src/components/sheet/layer.test.tsx
git commit -m "The class sheet: your colour, semester, grade so far and hidden items; the class's details for editors; merge offers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JpUR1JXMY3ehtkiJwuij95"
npm run build
```

---

### Task 29: Documentation, the full check, and a check by hand of Stages 3 and 4

**Files:**
- Modify: `docs/DATA-MODEL.md` (the API table)

- [ ] **Step 1: Describe the routes**

In `docs/DATA-MODEL.md`, in the `## API` table, replace the row that starts ``| `POST /api/spaces` |`` (Stage 3's) with:

```markdown
| `POST /api/spaces` | `{kind:'class', course}` (blank) or `{kind:'class', convertCourseId, items:[id]}` → `201 {space}`; you become the owner, with prefs from the course. Admins only until Stage 6 (`403`). A convert **moves** your course and the items named into the class in class shape: your status, grade, checklist, notes and completion into marks, your colour, target, term and archive into prefs; your course and those items are soft-deleted, the course's other items filed under the class (`classId`), your sessions and achievements on them labelled with the space. Converting the same course again answers the class it made (`200`). `409 limit` past 20 spaces. |
```

and after the row that starts ``| `PUT /api/spaces/:sid/members/:userId` `` add:

```markdown
| `POST /api/spaces/:sid/absorb` | `{courseId, pairs:[[yourItemId, classItemId]], fromCourse?}` → `{paired, filed}`: merge a course of yours into a class you are in. Marks from your paired items, sessions and achievements moved to the class's ids, your other items filed under the class, your course soft-deleted; your target (and, with `fromCourse`, colour, term and archive) into your prefs. Writes no shared row. A custom-typed item is refused (`400 {field:'pairs'}`); a course already gone answers `{paired: 0, filed: 0}`. |
| `GET\|PUT\|DELETE /api/marks/:sid/:itemId` | your mark on an item of a space you are in (`404` otherwise, or when the item is deleted). `PUT` merges field by field with `changed` (as shared rows), else whole at `If-Match`; on a project's item only `notes` and `hidden`. |
| `GET\|PUT\|DELETE /api/space_prefs/:sid` | your prefs for a space you are in: `{color, target, term, archived}`, whole-row `If-Match`. |
```

and in the row for ``GET /api/sync?v=2`` (or, if the sync row describes both versions, in its text) make sure it says: "v=2 pages only `courses`, `items`, `quotes`, `study_sessions`, `achievements`; v=3 also pages your `marks` and `space_prefs` in your own scope." In the rows for ``PUT /api/items/:id``, ``PUT /api/study_sessions/:id``, ``PUT /api/achievements/:id`` and ``PUT /api/me`` (or the one row that covers the personal routes), add: "`classId` (items), `spaceId` (sessions, achievements) and `hiddenSources` (profile) left out of a body keep their stored values."

- [ ] **Step 2: Run everything**

Stop any dev server on 8787 first, and kill a leftover vite on 8787/8790 (rule 2).

Run: `npm run check`
Expected: typecheck clean, every Vitest project and the node tests pass, the build succeeds.

Then check the files this stage touched for Latin-1 bytes (rule 4), in Git Bash:

```bash
for f in $(git diff --name-only main...HEAD -- src worker docs); do iconv -f utf-8 -t utf-8 "$f" >/dev/null 2>&1 || echo "NOT UTF-8: $f"; done
```

Expected: no output.

- [ ] **Step 3: Check the app by hand (Stages 3 and 4 together)**

Local dev server: `npm run db:local` (applies `0003_invites.sql` and `0004_marks.sql` locally), then `npm run dev`. Three accounts: **A** and **B** admins (make B an admin on the Admin page → Accounts), **C** not an admin. Two browsers, or one normal and one private window. **Use throwaway courses**: until Stage 6 a converted course leaves your calendar feed (Decision 10).

1. **C sees nothing new.** Sidebar: **+ New course** (no menu), no class rows, no Invites row, no eye toggles, no *Personal items* row; a course's sheet has no **Share this course**; Week, Month, All items, the stat tiles, a course's grades and the Study page show what they did before this branch (compare with the live site on the same data if in doubt). Network: no request to `/api/invites`, `/api/marks`, `/api/space_prefs`; no `class-sheet`/`class-item-sheet`/`join-sheet`/`merge-sheet` chunk. Open `/#join=7KQ2M9XD`: the hash goes and nothing opens. DevTools → Application → IndexedDB: the database is version 6 with empty `marks` and `space_prefs`.
2. **A makes a blank class.** **+ New → New shared class**, Blank, *Operating Systems*, *OS*: the class sheet opens on Members; the sidebar lists *Operating Systems* with the glyph (hover the row: "Shared · 1 member"); Details shows **Yours** with A's colour (the one the sheet picked) and **Edit class details**. Click the class's sidebar row: the Week filters to it.
3. **A edits the class.** Edit class details → add a Lecture Monday 09:00–10:00 → Save course: the Month and the Week show the class's lectures in A's colour. Class sheet → Items is empty; on the Week with the class filtered, **New item** on a day → an assignment *Problem set 1*, weight 20, with **Add it to the class for everyone** ticked → Save: it appears on the Week with the shared glyph; open it: the card has **Class** (editable) and **Yours**.
4. **A invites B; B accepts.** Members → invite B's username → B's sidebar shows **Invites 1** (reload, or switch tabs away and back) → Accept → "Downloading…" → "You're in Operating Systems" with **Your colour** (and **Your semester** if B has a school calendar) → pick Coral → **Open the class**. B's sidebar shows the class in Coral; A's stays A's colour.
5. **B's layer.** B opens *Problem set 1*: **Class** is read-only with "Edited by A · …"; set Status Graded, Grade 87, Your weight 25 → the card shows "The class weight is 20%." with **Use class weight**. B's class sheet → **Your grade so far** 87%. A's card for the same item shows no grade of B's (A's Status is still Open).
6. **Offline merge of marks.** B: DevTools → Offline; change the item's notes in **Yours**; in a second B tab (also offline) tick a checklist step; both online → both changes stand after the next sync (no saved copy in Settings).
7. **Hide.** B → *Problem set 1* → **Not mine · hide it** → asks first (it holds a grade) → Hide it: gone from B's Week, All items and grade; class sheet → **Hidden from you** → **Show again** brings it back.
8. **Eye toggles.** A: hover the class's sidebar row → eye → the class's lectures and items leave A's Week and Month, the row dims; All items still lists them; the stat tiles still count them. Eye on *Personal items* hides A's items with no course. Toggle both back.
9. **Convert moves.** A: a throwaway personal course *DB* with a graded assignment (with a link), a task, an item of a custom type and a lecture review (Settings → reviews on), and a study session logged on the assignment → **Share this course → Convert to shared class** → links warning → Create class: the toast says your grades moved; *DB* is gone from the sidebar as a personal course and listed as a class (glyph) with the same colour; the assignment shows on the Week with the glyph and A's grade; the task, the custom item and the review show with the "you" pip; Study → History still shows the session's minutes on *DB*.
10. **Merge on join.** B: a personal course *DB copy* with code `DB`, an item titled like the class's assignment (graded) and another unlike anything in the class → A invites B to the *DB* class → B accepts → the join screen says B has a course like it → **Merge my course** → the sheet pairs the two assignments and lists the other under *Stay yours* → **Skip**: the class sheet now shows the banner → **Merge…** → **Merge** → toast; B's *DB copy* is gone; the class item carries B's grade; B's other item shows with the "you" pip. (Try **Not the same item** on a pair once before merging: the item moves to *Stay yours*.)
11. **Codes, roles, hand-on** (Stage 3's checks): A makes a join code on a class B is not in; B joins with the link (the join screen asks colour); A sets B to Editor → B's card for a class item becomes editable after B's next sync; A hands the class on to B → A becomes Editor.
12. **What an old tab gets.** In B's browser console (B has marks and prefs by now): `fetch('/api/sync?v=2&cursor=0', { headers: { 'x-rounds-user': JSON.parse(localStorage.getItem('rounds.session')).id } }).then((r) => r.json()).then((p) => console.log([...new Set(p.changes.map((c) => c.kind))]))` lists no `marks` and no `space_prefs`.
13. **Maintenance.** Admin page → Maintenance → switch *Shared classes & projects* off: A's class sheet and class item card show the admins' bar; C sees no change. Switch it back on.

Stop the dev server and make sure nothing holds 8787/8790.

- [ ] **Step 4: Commit**

```bash
git add docs/DATA-MODEL.md
git commit -m "Docs: marks, space prefs, absorb, the moving convert, and what old clients keep

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JpUR1JXMY3ehtkiJwuij95"
```

---

### Task 30: Apply migrations 0003 and 0004 remotely, then merge and push (replaces Stage 3's Task 15)

George has allowed exactly these commands for Stages 3 and 4 together. **The order matters:** the new Worker's class, mark and prefs routes and the admin page's health check read `invites`, `marks` and `space_prefs`, and the Cloudflare Git build does **not** apply migrations, so the remote database must have both migrations **before** `main` moves. **Roll-forward only:** once a tab opens IndexedDB 6, the old client cannot open it; a fix after deploy ships as a new build. Nothing live has a Stage 3 membership, so the backfill in `0004` inserts no row remotely.

- [ ] **Step 1: Apply both migrations to the live database**

Run: `npm run db:remote`
Expected: wrangler lists `0003_invites.sql` and `0004_marks.sql` as the migrations to apply on `rounds-v7` (answer yes if it asks) and reports both applied.

- [ ] **Step 2: Check the live database**

Run: `npm run db:check -- --remote`
Expected: every check passes (including the change-feed checks that now know `marks` and `space_prefs`), and the table counts print with `marks` and `space_prefs` at 0.

- [ ] **Step 3: Merge and push**

```bash
git switch main
git pull --ff-only
git merge --no-ff collab-3-classes -m "Merge collab-3-classes: shared classes and the personal layer, for admins (Stages 3 and 4)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JpUR1JXMY3ehtkiJwuij95"
npm run check
git push origin main
```

Expected: `npm run check` green on `main`; the push starts the Cloudflare Git build (`npm run build`), which deploys without touching D1.

- [ ] **Step 4: Check the live site**

Once the build is live, hard-reload the site. As a non-admin: nothing has changed (Task 29 Step 3, item 1). As George (admin): **+ New** is a menu; a blank test class shows in the sidebar with Yours in the class sheet; IndexedDB is version 6; the Admin page's health shows `0004_marks.sql` as the latest migration. If a route answers 500, check first that the remote migrations were applied (`npx wrangler d1 migrations list DB --remote`). Delete nothing yet: removing a test class arrives with Stage 5.

---

## Self-review against the spec (done while writing this plan)

| Spec requirement (Stage 4 part) | Where |
|---|---|
| §3 `marks (user_id, id)`, `id = space_id ':' item_id`, unique `(user_id, space_id, item_id)`, the items' CHECKs, `hidden`; `space_prefs (user_id, id = space_id)`, colour of the twelve, target, term, archived; one text id; triggers `'u:' \|\| user_id` | Task 16 |
| §3/master plan: backfill prefs for Stage 3's memberships (class colour unless used, else first free; class term) | Task 16 (harmless when shipped with Stage 3: Decision 1) |
| §3 `users.hidden_sources` via the profile, kept when absent | Task 17 |
| §4 shared vs personal: class facts on the shared row, your status/grade/weight/checklist/notes/hidden on your mark, your colour/target/semester/archive in prefs; private rows read only with your user id | Tasks 18, 21, 22, 23, 28 |
| §5 a mark only on a live row of a space you are in (archived still saves); project rows notes/hidden only | Task 18 (Decision 4) |
| §6 marks merge field by field; two devices' first marks combine; prefs whole-row; upload order course → items → marks/prefs → course deletes | Tasks 18, 21 |
| §7 IndexedDB stores `marks`, `space_prefs` (version 6); `effectiveItems()` merges marks (skipped when hidden), `effectiveCourses()` applies prefs; keys `scope/id`; sessions/achievements resolve through `space_id` | Tasks 21, 22, 26 (removed-but-kept: Stage 5, Decision 10) |
| §8 grades on merged items (`mark.weight ?? item.weight`, your items under the class, hidden left out, target from prefs, what-if only in the sheet); stats; achievements by your mark; exam prep into your mark; lecture reviews of a class filed under it, chain inherits `classId`; study pickers in key space; semesters per person; custom types never in a class | Tasks 22, 23, 26, 28 |
| §9 colours from prefs (join: class default unless used, else first free); shared glyph and "you" pip with aria-labels; eye toggles writing `hidden_sources`, hidden rows dimmed, hiding a class hides your items under it, Stats and grades still count them | Tasks 19, 24, 25 (ICS: Stage 6) |
| §11 join screen: semester (same name, else the one covering today, confirmed) and colour; the merge sheet (ids first, then type + title + nearest date; unsure apart; Not the same item; Skip leaves a banner); accept/join write prefs in the membership batch | Tasks 19, 27, 28 (school-calendar offer: Stage 6) |
| §13 convert moves (marks, prefs, soft-deletes, `class_id` on the rest, `space_id` on sessions and achievements), set-based, safe to retry; absorb (marks, sessions and achievements repointed, `class_id` on the rest, empty course soft-deleted, member writes no shared row, custom types never paired, prefs from the course when not set) | Tasks 19, 20 (Decisions 6, 8) |
| §14 `GET\|PUT\|DELETE /api/marks/:sid/:itemId`, `GET\|PUT\|DELETE /api/space_prefs/:sid`, `POST /api/spaces/:sid/absorb {courseId, pairs}` | Tasks 18, 20 (`{items}` share-one-item: later, Decision 10) |
| §15 item card Class (locked for members, "Edited by … · 2h ago") / Yours (status, grade, checklist, weight override, notes, Hide asking first when graded); hidden items listed with Show again; Use class weight; sidebar classes with glyph and "Shared · n members"; eye toggles on every row and *Personal items* | Tasks 23, 25, 28 |
| §16 v2 pages only its five kinds and still reaches the head; a personal PUT without `classId`/`spaceId`, `PUT /api/me` without `hiddenSources` keep stored values; the new client always sends them; IndexedDB upgrade keeps pending ops | Tasks 17, 21 |
| §17 marks/prefs only ever with your user id; labels shape-checked; absorb ids verified; the guard inside each statement | Tasks 17, 18, 20 |
| §18 a mark exists only once you touch an item (convert and absorb write only meaningful ones); joining writes membership and prefs; set-based batches | Tasks 19, 20 |
| §22 admin-only until Stage 6: views (`CLASSES_ADMIN_ONLY`), eye toggles, sidebar rows, sheets; non-admins see the same arrays | Tasks 22, 25 (Decision 2) |
| §23 Worker: v2 five kinds; missing fields kept; two first marks merge; convert and absorb twice with identical results; every new CHECK; move-db. Client: `effectiveItems()` with overrides and hidden; `scope/id` keys; IndexedDB upgrade; the merge sheet's matching | Tasks 16–22, 27 |
| Maintenance: class UI respects `inMaintenance('classes')` | Tasks 23, 27, 28 (Decision 15) |

Not in Stage 4, by the master plan or the decisions above: removed items with **Keep as mine / Dismiss**, detach, leave, remove, archive, the purge's detach-first order, **Share with class** for one item (Stage 5); the ICS feed's class rows and `hidden_sources`, the school-calendar offer, outline import into a class, and lifting the gate (`ADMINS_ONLY`, `CLASSES_ADMIN_ONLY`, the client's `isAdmin` checks) (Stage 6); activity and the inbox (Stage 7); projects (Stages 8–10).
