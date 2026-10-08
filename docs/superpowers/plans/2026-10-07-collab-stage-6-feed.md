# Collaboration Stage 6: Feed, import, and classes for everyone — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

This is **Stage 6** of the master plan `docs/superpowers/plans/2026-10-02-collaboration.md` (its Stage 6 outline and the hand-offs Stages 4 and 5 recorded). It is written on 2026-10-07, **before Stage 5 is built**, against the code as it will be once Stage 5 (`docs/superpowers/plans/2026-10-07-collab-stage-5-leave.md`) is merged: `worker/leaving.js`, `assertKeeper`/`keeperGuard` in `worker/access.js`, `src/data/leave.ts`, `src/components/sheet/class-actions.tsx`, `data.removed_items`. **Start Stage 6 only after Stage 5 is merged to `main`**; if Stage 5 changed a name this plan uses, follow Stage 5's code.

**Goal:** The calendar feed carries your classes (their meetings by your semester, their items with your status, nothing you hid); an outline can be imported into a class you edit, with a preview of what is new, changed or already there; a new shared class can start from an outline; someone joining a class with no school calendar is offered the owner's; and then **shared classes open to everyone**, not just admins.

**Architecture:** `worker/calendar.js` gains a pure `feedRows()` that turns your rows and your classes' rows (read with your membership, marks and prefs in the same batch) into what `buildCalendar()` already writes; class ids become `<space>-<id>` so their UIDs never meet your own. The outline import keeps its planner (`src/core/importers/plan.ts`) and adds a target: **My courses** (today's behaviour), a class you edit (`src/data/class-import.ts` matches the plan against the class's rows and writes ordinary shared rows), or a new class. A class keeps a snapshot of its owner's school calendar in `spaces.school_calendar` (the column exists since Stage 2). Opening classes to everyone removes `ADMINS_ONLY` in the Worker and `CLASSES_ADMIN_ONLY` and the `isAdmin` checks in the client; the maintenance switch for classes stays.

**Tech Stack:** Cloudflare Workers + D1 (plain JS ES modules), React 19 + TypeScript + Vite, Vitest (Workers pool + jsdom), wrangler.

**Spec:** `docs/superpowers/specs/2026-10-02-shared-classes-design.md`: §8 (Semesters, Imports, ICS feed), §9 (ICS feed contents, stable ids, visibility), §11 (joining: the school-calendar offer), §14, §15 (Import), §20 (create a class from an outline), §22 (the admin gate).

---

## How to work in this repo (read before any task)

1. **Checks:** `npm run typecheck`, `npm test` (Vitest: Workers + jsdom projects, then node tests), `npm run build`. `npm run check` runs all three. One file: `npx vitest run test/class-feed.test.js`. The jsdom tests alone: `npm run test:ui`. The Worker tests alone: `npm run test:api`.
2. **Dev server:** `npm run dev` → http://127.0.0.1:8787. On this Windows machine a stopped dev server can leave `vite.js` holding 8787/8790 and serving old code: check `Get-NetTCPConnection -LocalPort 8787 -State Listen` in PowerShell first and stop the owning process. Don't run `npm run build` while the dev server runs.
3. **Line endings:** keep every file LF.
4. **Non-ASCII** (·, —, …, ✓): write it with the Edit/Write tools, never through a shell; after a commit that adds any, `npm run build`. Check a sub-agent's files with `iconv -f utf-8 -t utf-8 <file> >/dev/null` in Git Bash.
5. **Deploying:** **no migration** (`spaces.school_calendar` exists since `0002_spaces.sql`).
6. **Commits:** end each message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Commit only on `collab-6-feed`; never push or merge to `main` without George's yes (Task 9).
7. **Workers AI:** the outline tests use the existing fakes; never call real AI from a test (10k neurons a day, shared with the live site). The browser check reads at most two outlines.
8. **The suite stays green after every task**; a task that changes a behaviour an older test spells out updates that test in the same task.

Branch, made once Stage 5 is merged:

```bash
git checkout main && git pull --ff-only && git checkout -b collab-6-feed
```

---

## Decisions this plan takes

1. **What the feed holds** (spec §9): your courses and items as today; each **class** you are a live member of: its course's meetings by **your** semester (`space_prefs.term`), and its live items with your mark's status (✓ when complete, cancelled when missed) and weight, your notes then the class's in the description, left out when you hid the item. A class you archived in your sidebar (`space_prefs.archived`) is left out whole. **Removed class items are left out** (they are not happening, whatever you hold on them; the app still shows them until you choose). Your items filed under a class show with the class's code. Projects are Stage 10.
2. **Hidden sources** (`users.hidden_sources`) apply to the feed as to the Week: `course:<id>` leaves out a course of yours and its items, `space:<sid>` a class and your items filed under it, `personal` your items with neither a course nor a class.
3. **UIDs** (spec §9): a class's rows get ids `<space id>-<id>` before `buildCalendar()` runs, so its UIDs read `item-<sid>-<id>` and `class-<sid>-<course>-<meeting>[-<term start>]`. A course converted before Stage 6 left the feed (Stage 4 hand-off); it comes back under these UIDs (calendar apps see a delete and an add once, as the spec says).
4. **Import into a class** (spec §8): only an **outline** import has a target. The targets are **My courses** and each class you own or edit that is not archived. Against a class, every planned item is matched to the class's live items by type and normalised title: no match is **New** (ticked when dated); a match whose date, times, room or weight differ is **Changed** (unticked, the row says what it was); otherwise **Already there** (unticked). Meetings the class already has (same weekday and start) start unticked. Import writes ordinary shared rows (`saveShared`), so the Worker's editor guard and field merge apply. The semester picker shows only for **My courses**.
5. **A class from an outline** (spec §20): *New shared class → From a course outline* reads the outline with AI as today, then opens the import preview with the target **New class**. Nothing is made until **Import**: then the class is created blank with the outline's code, name, teacher, semester and the ticked meetings (`POST /api/spaces {kind:'class', course}`), it downloads, and the ticked items are written as its rows. The spec's `POST /api/spaces {outline}` is not built: a blank create plus ordinary shared writes does the same with no new Worker code.
6. **The school-calendar snapshot** (spec §8, §11): making a class copies its owner's school calendar into `spaces.school_calendar` (only one with at least one semester). The owner can refresh it from the class sheet (`POST /api/spaces/:sid/school`, the owner, archived or not). `GET /api/spaces/:sid` returns it as `schoolCalendar` to every member. On the join screen, someone with **no** school calendar is offered it ("Use the class's school calendar"); taking it saves it as their own and the semester picker appears.
7. **Opening classes to everyone** (spec §22) comes **last** (Task 7), after the feed and imports work for admins: the Worker's `ADMINS_ONLY` (create, accept, join, and the invite's `409 not_admin`) goes; the client's `CLASSES_ADMIN_ONLY` and every `isAdmin` check that gates classes (sidebar eye toggles, *Personal items*, Invites, the **+** menu, *Share this course*, `refreshInvites`, `/#join=`) go. The Admin page stays admin-only. The **maintenance switch** for classes stays: when an admin turns it on, everyone else gets the maintenance page in the class sheets as today.
8. **No new limits.** The limits already in place (20 spaces a person, 30 members a space, invites 20 an hour, join attempts 10 an hour, outline reads per the AI limit) are what keep an open feature in bounds.

## File map

| File | Change |
|---|---|
| `worker/calendar.js` | `feedRows()`; `serveFeed` reads classes, marks, prefs and hidden sources |
| `worker/spaces.js` | `OWNER_CALENDAR`; `createClass` takes the snapshot; `refreshSchool`; `spaceDetails` returns `schoolCalendar`; `ADMINS_ONLY` removed (Task 7) |
| `worker/classes.js` | `POST /api/spaces/:sid/school`; `joiner` removed (Task 7) |
| `worker/invites.js` | `not_admin` removed (Task 7) |
| `src/core/importers/plan.ts` | `PlanItem.match`, `PlanItem.was`; `Plan.outline` |
| `src/core/types.ts` | `SpaceDetails.schoolCalendar` |
| `src/core/api.ts` | `spaces.school` |
| `src/data/class-import.ts` | new: `Target`, `importTargets`, `planForClass`, `planMine`, `commitToClass`, `commitNewClass` |
| `src/data/import-edit.ts` | `readOutlineFile` keeps the outline on the plan; `forNewClass` |
| `src/data/overlay.ts`, `src/components/sheet/sheet.tsx` | the import sheet's `target` |
| `src/components/sheet/import-sheet.tsx` | target picker; Changed rows; commit by target |
| `src/components/sheet/new-class-sheet.tsx` | *From a course outline* |
| `src/components/sheet/join-sheet.tsx` | the school-calendar offer |
| `src/components/sheet/class-actions.tsx` | the owner's *Share my school calendar with the class* |
| `src/data/effective.ts`, `src/data/classes.ts`, `src/data/session.ts`, `src/components/sidebar.tsx`, `src/components/sheet/course-sheet.tsx`, `src/components/sheet/share-course.tsx` | the admin gate removed (Task 7) |
| `docs/OVERVIEW.md`, `docs/DATA-MODEL.md`, `README.md`, master plan | classes for everyone; the feed; imports |
| Tests | new `test/class-feed.test.js`, `test/school-snapshot.test.js`, `src/data/class-import.test.ts`, `src/components/sheet/class-import.test.tsx`; changed `test/classes.test.js`, `test/invites.test.js`, `test/join-code.test.js`, `src/data/effective.test.ts`, `src/data/classes.test.ts`, `src/components/sheet/sheet.test.tsx`, `src/components/sidebar.test.tsx`, `src/components/sheet/classes.test.tsx` |

---

### Task 1: The class's school-calendar snapshot

**Files:**
- Modify: `worker/spaces.js`, `worker/classes.js`, `src/core/types.ts`, `src/core/api.ts`
- Test: `test/school-snapshot.test.js`

- [ ] **Step 1: Write the failing test**

`test/school-snapshot.test.js`:

```js
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { post, signInAdmin } from './spaces.js';

const CAL = { name: 'Northfield', terms: [{ name: 'Fall 2026', start: '2026-09-08', end: '2026-12-18' }], days: [] };
const course = { code: 'WEB', name: 'Web Services', color: '#17B3AE', instructor: '', term: 'Fall 2026', meetings: [] };
let n = 0;
const setCal = (id, cal) => env.DB.prepare('UPDATE users SET school_calendar = ? WHERE id = ?').bind(JSON.stringify(cal), id).run();

describe("a class's school calendar", () => {
  it("copies the owner's calendar when the class is made, shows it to members, and the owner refreshes it", async () => {
    const owner = await signInAdmin('sco' + ++n), member = await signInAdmin('scm' + n);
    await setCal(owner.id, CAL);
    const { space } = await (await post(owner, '/api/spaces', { kind: 'class', course })).json();
    await env.DB.prepare("INSERT INTO members (space_id, user_id, role, joined_at, updated_at) VALUES (?, ?, 'member', 2, 2)").bind(space.id, member.id).run();
    expect((await (await member(`/api/spaces/${space.id}`)).json()).schoolCalendar).toEqual(CAL);
    const next = { ...CAL, terms: [...CAL.terms, { name: 'Winter 2027', start: '2027-01-05', end: '2027-04-16' }] };
    await setCal(owner.id, next);
    expect((await post(member, `/api/spaces/${space.id}/school`)).status).toBe(403);
    const res = await post(owner, `/api/spaces/${space.id}/school`);
    expect(res.status).toBe(200);
    expect((await res.json()).schoolCalendar).toEqual(next);
    expect((await (await member(`/api/spaces/${space.id}`)).json()).schoolCalendar).toEqual(next);
  });

  it('is null when the owner has no calendar, or an empty one', async () => {
    const owner = await signInAdmin('sco' + ++n);
    await setCal(owner.id, {});
    const { space } = await (await post(owner, '/api/spaces', { kind: 'class', course })).json();
    expect((await (await owner(`/api/spaces/${space.id}`)).json()).schoolCalendar).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run test/school-snapshot.test.js`
Expected: FAIL (`schoolCalendar` undefined; `/school` 405).

- [ ] **Step 3: `worker/spaces.js`**

Below `NEXT_ROW_REVISION`:

```js
/* A person's school calendar, as a class keeps a copy of it (spec §8): only one with a semester; bind the user id. */
const OWNER_CALENDAR = `(SELECT CASE WHEN json_valid(u.school_calendar) AND json_type(u.school_calendar) = 'object'
    AND COALESCE(json_array_length(u.school_calendar, '$.terms'), 0) > 0 THEN u.school_calendar END FROM users AS u WHERE u.id = ?)`;
```

In `createClass`, the space INSERT becomes (the new column and its bind are the only changes):

```js
    db.prepare(`INSERT INTO spaces (id, kind, school_calendar, created_at, updated_at, revision) SELECT ?, 'class', ${OWNER_CALENDAR}, ?, ?, ${NEXT_SPACE_REVISION}
      WHERE ${MY_SPACES} < ?${copy ? ` AND EXISTS (SELECT 1 FROM courses WHERE scope = ? AND id = ? AND deleted_at IS NULL) AND NOT EXISTS (${MADE_FROM})` : ''}`)
      .bind(id, userId, now, now, userId, SPACE_LIMIT, ...(copy ? [mine, courseId, userId, courseId] : [])),
```

In `spaceDetails`, add a fourth statement to the batch and the field to the answer:

```js
  const [members, invites, code, cal] = await db.batch([
    /* …the three statements as they are… */
    db.prepare(`SELECT school_calendar FROM spaces WHERE id = ? AND ${g.sql}`).bind(spaceId, ...g.binds),
  ]);
```

```js
    schoolCalendar: cal.results[0]?.school_calendar ? JSON.parse(cal.results[0].school_calendar) : null,
```

and add to the doc comment: "…and the class's copy of its owner's school calendar for everyone in it (offered to joiners with none)."

Add:

```js
/** The owner copies their school calendar into the class again (spec §8), archived or not. Answers {schoolCalendar}. */
export async function refreshSchool(db, userId, spaceId, now = Date.now()) {
  const me = await assertKeeper(db, userId, spaceId);
  if (me.kind !== 'class') throw new HttpError(404, { error: 'not_found' });
  const g = keeperGuard(spaceId, userId);
  await db.prepare(`UPDATE spaces SET school_calendar = ${OWNER_CALENDAR}, updated_at = ?, revision = ${NEXT_SPACE_REVISION} WHERE id = ? AND ${g.sql}`)
    .bind(userId, now, spaceId, ...g.binds).run();
  const row = await db.prepare('SELECT school_calendar FROM spaces WHERE id = ?').bind(spaceId).first();
  return { schoolCalendar: row?.school_calendar ? JSON.parse(row.school_calendar) : null };
}
```

(`assertKeeper`, `keeperGuard` come from `./access.js`; Stage 5 already imports them here.)

- [ ] **Step 4: The route (`worker/classes.js`)**

Import `refreshSchool`; add:

```js
  ['POST', route(`spaces/${SID}/school`), async ({ request, env, params: [sid] }) => json(await refreshSchool(env.DB, await requireUser(request, env), sid))],
```

- [ ] **Step 5: Client types and call**

`src/core/types.ts`, `SpaceDetails` gains `schoolCalendar: unknown | null` (after `code`). `src/core/api.ts`, in `spaces`:

```ts
    /* the owner shares their school calendar with the class again (spec §8) */
    school: (sid: string): Promise<{ schoolCalendar: unknown | null }> => request('POST', `/api/spaces/${sid}/school`),
```

If a test builds a whole `SpaceDetails` and `typecheck` complains, add `schoolCalendar: null` there.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run test/school-snapshot.test.js test/classes.test.js test/members.test.js && npm run typecheck`
Expected: PASS. A `members.test.js` case comparing the whole details object with `toEqual` gains `schoolCalendar: null`.

- [ ] **Step 7: Commit**

```bash
git add worker/spaces.js worker/classes.js src/core/types.ts src/core/api.ts test/school-snapshot.test.js test/members.test.js
git commit -m "Stage 6: a class keeps a copy of its owner's school calendar

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Classes in the calendar feed

**Files:**
- Modify: `worker/calendar.js`
- Test: `test/class-feed.test.js`

- [ ] **Step 1: Write the failing test**

`test/class-feed.test.js`:

```js
import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { buildCalendar, feedRows } from '../worker/calendar.js';
import { unfold } from './helpers.js';
import { makeSpace, mark, ownItem, pref, sharedItem, signInAdmin } from './spaces.js';

const SID = 'sp0000000042';
const meetings = JSON.stringify([{ id: 'm1', kind: 'Lecture', weekday: 1, start: '09:00', end: '10:30', room: 'Hall B' }]);
const classCourse = (over = {}) => ({ sid: SID, id: 'web', code: 'WEB', name: 'Web Services', term: 'Fall 2026', archived: 0, meetings, created_at: 1, my_term: 'Winter 2027', my_archived: 0, ...over });
const classItem = (over = {}) => ({ sid: SID, id: 'a1', type: 'assignment', title: 'REST API', course_id: 'web', date: '2026-10-15', start: '', end: '', location: '',
  status: 'todo', weight: 20, notes: 'Use the starter repo', recur: null, weekday: null, recur_until: null, m_status: null, m_weight: null, m_notes: null, m_hidden: null, ...over });
const own = (over = {}) => ({ id: 'p1', type: 'task', title: 'Read ch. 4', course_id: null, class_id: null, date: '2026-10-14', start: '', end: '', location: '',
  status: 'todo', weight: null, notes: '', recur: null, weekday: null, recur_until: null, ...over });
const events = (ics) => ics.split('BEGIN:VEVENT').slice(1).map((e) => e.split('END:VEVENT')[0]);

describe('feedRows', () => {
  it("gives a class's rows scoped ids, your semester, your mark, and your notes before the class's", () => {
    const rows = feedRows({ courses: [], items: [], classCourses: [classCourse()], classItems: [classItem({ m_status: 'graded', m_weight: 25, m_notes: 'Mine' })] });
    expect(rows.courses.map((c) => [c.id, c.term, c.archived])).toEqual([[SID + '-web', 'Winter 2027', 0]]);
    expect(rows.items.map((i) => [i.id, i.course_id, i.status, i.weight, i.notes])).toEqual([[SID + '-a1', SID + '-web', 'graded', 25, 'Mine\n\nUse the starter repo']]);
    const ics = unfold(buildCalendar(rows));
    expect(ics).toContain('UID:item-' + SID + '-a1@rounds');
    expect(ics).toContain('UID:class-' + SID + '-web-m1@rounds');
    expect(ics).toContain('SUMMARY:✓ WEB · REST API');
  });

  it('leaves out what you hid, classes you archived, and hidden sources', () => {
    const hiddenItem = feedRows({ courses: [], items: [], classCourses: [classCourse()], classItems: [classItem({ m_hidden: 1 })] });
    expect(hiddenItem.items).toEqual([]);
    const shelved = feedRows({ courses: [], items: [], classCourses: [classCourse({ my_archived: 1 })], classItems: [classItem()] });
    expect([shelved.courses, shelved.items]).toEqual([[], []]);
    const filed = own({ id: 'f1', class_id: SID });
    const off = feedRows({ courses: [{ id: 'bio', code: 'BIO', meetings: '[]' }], items: [own(), own({ id: 'b1', course_id: 'bio' }), filed],
      classCourses: [classCourse()], classItems: [classItem()], hidden: ['space:' + SID, 'course:bio'] });
    expect(off.courses).toEqual([]);
    expect(off.items.map((i) => i.id)).toEqual(['p1']);
    expect(feedRows({ courses: [], items: [own()], hidden: ['personal'] }).items).toEqual([]);
  });

  it("shows your items filed under a class with the class's code", () => {
    const rows = feedRows({ courses: [], items: [own({ id: 'f1', class_id: SID })], classCourses: [classCourse()], classItems: [] });
    expect(rows.items[0].course_id).toBe(SID + '-web');
    expect(unfold(buildCalendar(rows))).toContain('SUMMARY:WEB · Read ch. 4');
  });
});

describe('the feed, served', () => {
  it("carries the classes you are in with your layer, and nobody else's", async () => {
    const me = await signInAdmin('feedme'), other = await signInAdmin('feedother');
    const s = await makeSpace({ members: { [me.id]: 'member', [other.id]: 'owner' } });
    await env.DB.prepare('UPDATE courses SET meetings = ? WHERE scope = ?').bind(meetings, s.scope).run();
    await sharedItem(s.scope, 'a1', { course_id: 'web', title: 'REST API', weight: 20 });
    await sharedItem(s.scope, 'gone', { course_id: 'web', title: 'Removed quiz', deleted_at: 5 });
    await mark(me.id, s.id, 'a1', { status: 'done' });
    await mark(other.id, s.id, 'a1', { notes: 'Their secret' });
    await pref(me.id, s.id, { term: '' });
    await ownItem(me.id, 'f1', { class_id: s.id, title: 'Extra reading' });
    const { url } = await (await me('/api/calendar', { method: 'POST' })).json();
    const ics = unfold(await (await SELF.fetch(url)).text());
    expect(ics).toContain(`UID:item-${s.id}-a1@rounds`);
    expect(ics).toContain('SUMMARY:✓ WEB · REST API');
    expect(ics).toContain('SUMMARY:WEB · Extra reading');
    expect(ics).toContain('SUMMARY:WEB Lecture');
    expect(ics).not.toContain('Removed quiz');
    expect(ics).not.toContain('Their secret');
    /* hiding the class takes it out on the next fetch */
    await env.DB.prepare('UPDATE users SET hidden_sources = ? WHERE id = ?').bind(JSON.stringify(['space:' + s.id]), me.id).run();
    const after = unfold(await (await SELF.fetch(url)).text());
    expect(after).not.toContain('REST API');
    expect(after).not.toContain('Extra reading');
  });

  it('drops a class you left', async () => {
    const me = await signInAdmin('feedleft');
    const s = await makeSpace({ members: { [me.id]: 'member' } });
    await sharedItem(s.scope, 'a1', { course_id: 'web', title: 'Left behind' });
    await env.DB.prepare('UPDATE members SET deleted_at = 3 WHERE space_id = ? AND user_id = ?').bind(s.id, me.id).run();
    const { url } = await (await me('/api/calendar', { method: 'POST' })).json();
    expect(await (await SELF.fetch(url)).text()).not.toContain('Left behind');
  });
});
```

`pref` and `mark` default rows in `test/spaces.js` (Stage 5) set `term: 'Fall 2026'` and `color`; the test passes `term: ''` so no school calendar is needed for the meetings.

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run test/class-feed.test.js`
Expected: FAIL (`feedRows` is not exported).

- [ ] **Step 3: `feedRows` (`worker/calendar.js`, above `buildCalendar`)**

```js
/**
 * The feed's rows (spec §9): your courses and items, and each class you are in with your layer
 * on top, in buildCalendar's shape. A class's ids become '<space>-<id>', so its UIDs read
 * item-<space>-<id> and class-<space>-<course>-<meeting> and never meet yours. Its course takes
 * your semester; a class you archived in your sidebar is left out whole. Its items take your
 * status and weight, your notes before the class's, and are left out when you hid them. Your
 * items filed under a class show under its course. Hidden sources (course:<id>, space:<sid>,
 * personal) are left out, as in the Week. Pure, for tests.
 */
export function feedRows({ courses, items, classCourses = [], classItems = [], hidden = [] }) {
  const off = new Set(hidden);
  const shown = classCourses.filter((c) => c.my_archived !== 1 && !off.has('space:' + c.sid));
  const inFeed = new Set(shown.map((c) => c.sid));
  const courseOf = new Map(shown.map((c) => [c.sid, c.sid + '-' + c.id]));
  const source = (it) => (it.class_id ? 'space:' + it.class_id : it.course_id ? 'course:' + it.course_id : 'personal');
  return {
    courses: [
      ...courses.filter((c) => !off.has('course:' + c.id)),
      ...shown.map((c) => ({ ...c, id: c.sid + '-' + c.id, term: c.my_term ?? c.term, archived: 0 })),
    ],
    items: [
      ...items.filter((it) => !off.has(source(it)) && (!it.class_id || inFeed.has(it.class_id) || !classCourses.some((c) => c.sid === it.class_id)))
        .map((it) => (it.class_id ? { ...it, course_id: courseOf.get(it.class_id) ?? null } : it)),
      ...classItems.filter((it) => inFeed.has(it.sid) && it.m_hidden !== 1).map((it) => ({
        ...it, id: it.sid + '-' + it.id, course_id: it.course_id ? it.sid + '-' + it.course_id : null,
        status: it.m_status ?? 'todo', weight: it.m_weight ?? it.weight,
        notes: [it.m_notes, it.notes].filter(Boolean).join('\n\n'),
      })),
    ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
  };
}
```

A filed item whose class is in your sidebar archive goes with it; one whose class you left (no class course in the list) stays, without a course.

- [ ] **Step 4: Read your classes in `serveFeed`**

Change the user read to `SELECT feed_gen, term_start, types, school_calendar, hidden_sources FROM users WHERE id = ?`. Replace the batch and the `buildCalendar` call:

```js
  const me = personal(userId);
  /* your live classes, read with your membership in the statement (spec §5) */
  const IN = `JOIN members AS m ON m.space_id = s.id AND m.user_id = ?1 AND m.deleted_at IS NULL`;
  const [courses, items, classCourses, classItems] = await env.DB.batch([
    env.DB.prepare('SELECT id, code, name, term, archived, meetings, created_at FROM courses WHERE scope = ? AND deleted_at IS NULL').bind(me),
    env.DB.prepare('SELECT id, type, title, course_id, class_id, date, start, end, location, status, weight, notes, recur, weekday, recur_until FROM items WHERE scope = ? AND deleted_at IS NULL').bind(me),
    env.DB.prepare(`SELECT s.id AS sid, c.id, c.code, c.name, c.term, c.archived, c.meetings, c.created_at, p.term AS my_term, p.archived AS my_archived
      FROM spaces AS s ${IN} JOIN courses AS c ON c.scope = 'c:' || s.id AND c.deleted_at IS NULL
        LEFT JOIN space_prefs AS p ON p.user_id = ?1 AND p.id = s.id AND p.deleted_at IS NULL
      WHERE s.kind = 'class' AND s.deleted_at IS NULL`).bind(userId),
    env.DB.prepare(`SELECT s.id AS sid, i.id, i.type, i.title, i.course_id, i.date, i.start, i.end, i.location, i.status, i.weight, i.notes, i.recur, i.weekday, i.recur_until,
        k.status AS m_status, k.weight AS m_weight, k.notes AS m_notes, k.hidden AS m_hidden
      FROM spaces AS s ${IN} JOIN items AS i ON i.scope = 'c:' || s.id AND i.deleted_at IS NULL
        LEFT JOIN marks AS k ON k.user_id = ?1 AND k.space_id = s.id AND k.item_id = i.id AND k.deleted_at IS NULL
      WHERE s.kind = 'class' AND s.deleted_at IS NULL`).bind(userId),
  ]);
  const tz = url.searchParams.get('tz');
  const rows = feedRows({ courses: courses.results, items: items.results, classCourses: classCourses.results, classItems: classItems.results, hidden: parseList(user.hidden_sources) });
  const body = buildCalendar({
    ...rows, termStart: user.term_start, school: parseSchool(user.school_calendar),
    types: parseList(user.types), tz: tz && TZ.test(tz) && tz.length <= 64 ? tz : null, now: Date.now(),
  });
```

`hidden_sources` may be stored as `NULL`; `parseList` answers `[]` for anything that is not a JSON array. Update the file's header comment: add "Your classes come too, with your own layer on top (spec §9): see feedRows."

- [ ] **Step 5: Run the tests**

Run: `npx vitest run test/class-feed.test.js test/calendar.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add worker/calendar.js test/class-feed.test.js
git commit -m "Stage 6: your classes in the calendar feed, with your layer and your hidden sources

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Planning an outline against a class

**Files:**
- Modify: `src/core/importers/plan.ts` (types only)
- Create: `src/data/class-import.ts`
- Test: `src/data/class-import.test.ts`

- [ ] **Step 1: The plan's new fields (`src/core/importers/plan.ts`)**

```ts
/** An item to create; against a class (src/data/class-import.ts), `match` is the class's item it would change and `was` what that item says now. */
export interface PlanItem { include: boolean; duplicate?: boolean; week?: number; row: PlanRow; match?: string; was?: string }
export interface Plan { courses: PlanCourse[]; items: PlanItem[]; notes: string[]; week1?: string; termStart?: string; kind?: 'outline' | 'schedule'; outline?: Outline }
```

(`Outline` is declared below `Plan` in the same file; TypeScript accepts the forward reference.)

- [ ] **Step 2: Write the failing test**

`src/data/class-import.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest"

const fake = vi.hoisted(() => ({
    data: { profile: { id: "u-me" }, courses: [] as unknown[], items: [] as unknown[], spaces: [] as unknown[], shared_courses: [] as unknown[], shared_items: [] as unknown[], space_prefs: [] as unknown[], marks: [] },
    saveShared: vi.fn(async () => ({})),
    create: vi.fn(),
    download: vi.fn(async () => true),
    openClass: vi.fn(),
}))
vi.mock("@/core/store", () => ({ data: fake.data, subscribe: () => () => {}, saveShared: fake.saveShared }))
vi.mock("@/core/api", () => ({ api: { spaces: { create: fake.create } } }))
vi.mock("@/data/query", () => ({ schoolCal: () => null, termStart: () => "" }))
vi.mock("./classes", async (real) => ({ ...(await real<typeof import("./classes")>()), download: fake.download, openClass: fake.openClass }))

import { commitNewClass, commitToClass, importTargets, planForClass } from "./class-import"
import type { Outline } from "@/core/importers/plan"

const SID = "sp0000000007", SCOPE = "c:" + SID
const course = { scope: SCOPE, id: "web", code: "WEB", name: "Web Services", color: "#17B3AE", instructor: "", term: "", archived: false, target: null, updatedBy: null,
    meetings: [{ id: "m1", kind: "Lecture", weekday: 1, start: "09:00", end: "10:30", room: "Hall B" }] }
const shared = (over: Record<string, unknown>) => ({ scope: SCOPE, type: "quiz", title: "Quiz 1", courseId: "web", date: "2026-10-01", start: "", end: "", where: "", weight: 10, status: "todo", notes: "", checklist: [], links: [], updatedBy: null, assignees: [], completedBy: null, ...over })
const outline: Outline = {
    code: "CS 446", name: "Web Services",
    classes: [{ kind: "Lecture", weekday: 1, start: "09:00", end: "10:30", room: "Hall B" }, { kind: "Lab", weekday: 3, start: "13:00", end: "15:00", room: "Lab 2" }],
    assessments: [
        { type: "quiz", title: "Quiz 1", date: "2026-10-01", start: "", end: "", weight: 10 },
        { type: "quiz", title: "Quiz  2!", date: "2026-10-22", start: "", end: "", weight: 10 },
        { type: "exam", title: "Midterm", date: "2026-10-30", start: "", end: "", weight: 30 },
    ],
}
afterEach(() => vi.clearAllMocks())

describe("an outline planned against a class", () => {
    it("marks each row New, Changed (unticked, with what it was) or Already there, under the class's course", () => {
        const plan = planForClass(outline, course as never, [shared({ id: "q1" }), shared({ id: "q2", title: "Quiz 2", date: "2026-10-20" })] as never)
        expect(plan.courses.map((c) => [c.id, c.isNew, c.meetings.map((m) => [m.kind, m.include])])).toEqual([["web", false, [["Lecture", false], ["Lab", true]]]])
        expect(plan.items.map((i) => [i.row.title, i.row.courseId, i.include, i.duplicate ?? false, i.match ?? null, i.was ?? null])).toEqual([
            ["Quiz 1", "web", false, true, "q1", null],
            ["Quiz  2!", "web", false, false, "q2", "20 Oct"],
            ["Midterm", "web", true, false, null, null],
        ])
    })

    it("lists the classes you can import into", () => {
        const s = (role: string, archived = false) => ({ id: role, kind: "class", role, archived })
        expect(importTargets([s("owner"), s("editor"), s("member"), s("owner", true)] as never).map((x) => x.id)).toEqual(["owner", "editor"])
    })
})

describe("importing into a class", () => {
    it("adds ticked meetings to its course, new rows as its items, and changes matched ones", async () => {
        fake.data.shared_courses = [course]
        fake.data.shared_items = [shared({ id: "q2", title: "Quiz 2", date: "2026-10-20" })]
        const plan = planForClass(outline, course as never, fake.data.shared_items as never)
        plan.items[1].include = true   /* Changed: ticked by hand */
        expect(await commitToClass(plan, SID)).toBe("Added 2 items, updated 1, and added 1 class to Web Services.")
        const calls = fake.saveShared.mock.calls as unknown as [string, Record<string, unknown>][]
        expect(calls[0][0]).toBe("shared_courses")
        expect((calls[0][1].meetings as unknown[]).length).toBe(2)
        const items = calls.filter(([s]) => s === "shared_items").map(([, r]) => [r.id === "q2" ? "q2" : "new", r.title, r.date, r.scope, r.courseId])
        expect(items).toEqual([
            ["new", "Quiz 1", "2026-10-01", SCOPE, "web"],
            ["q2", "Quiz 2", "2026-10-22", SCOPE, "web"],
            ["new", "Midterm", "2026-10-30", SCOPE, "web"],
        ])
    })

    it("makes a new class from the outline on Import, then writes its items", async () => {
        fake.create.mockResolvedValue({ id: SID, scope: SCOPE, kind: "class", name: "Web Services", role: "owner", members: 1 })
        fake.download.mockImplementation(async () => { fake.data.shared_courses = [{ ...course, meetings: [] }]; return true })
        const plan = planForClass(outline, null, [])
        expect(await commitNewClass(plan)).toBe("Made Web Services with 3 items. Invite people from Members.")
        expect(fake.create).toHaveBeenCalledWith({ kind: "class", course: expect.objectContaining({ code: "CS 446", name: "Web Services", meetings: [expect.objectContaining({ kind: "Lecture" }), expect.objectContaining({ kind: "Lab" })] }) })
        expect(fake.openClass).toHaveBeenCalledWith(SID, "members")
    })
})
```

The first test's "Quiz 1" row: the class's `q1` has the same type, title, date and weight → **Already there**. "Quiz  2!" normalises to "quiz 2" → matches `q2`, date differs → **Changed**, `was` = `shortDate("2026-10-20")` (check what `shortDate` prints in `src/core/dates.ts` and match the test to it). The Lecture meeting already exists → unticked.

- [ ] **Step 3: Run it to see it fail**

Run: `npx vitest run src/data/class-import.test.ts`
Expected: FAIL (`./class-import` missing).

- [ ] **Step 4: Create `src/data/class-import.ts`**

```ts
// An outline imported into a class (spec §8 Imports, §15, §20). The plan's rows are matched
// against the class's own: New (ticked when dated), Changed (unticked, saying what it was) or
// Already there. Import writes the ticked rows as the class's: ordinary shared writes, which
// the Worker lets an owner or editor make. Or a new class made from the outline: nothing is
// made until Import, then the class, then its items.

import * as store from "@/core/store"
import { data } from "@/core/store"
import { api } from "@/core/api"
import { normalizeItem } from "@/core/model"
import { shortDate, today } from "@/core/dates"
import { planOutline, type Outline } from "@/core/importers/plan"
import type { Row } from "@/core/db"
import { schoolCal, termStart } from "./query"
import { defaultTerm, type ImportPlan } from "./import-edit"
import { download, freeColour, openClass } from "./classes"
import type { SharedCourse, SharedItem, Space } from "./types"

/** Where an outline goes: your courses (as before), a class you edit, or a class made from it. */
export type Target = { kind: "mine" } | { kind: "class"; spaceId: string } | { kind: "new-class" }

/** The classes an outline can go into: yours to edit, not archived. */
export const importTargets = (spaces: Space[] = data.spaces ?? []): Space[] =>
    spaces.filter((s) => s.kind === "class" && s.role !== "member" && !s.archived)

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
/* what makes a matched row Changed */
const FACTS = ["date", "start", "end", "where", "weight"] as const

/** The outline planned for your own courses, as the import has always done. */
export function planMine(outline: Outline): ImportPlan {
    const plan = planOutline(outline, data, termStart() || "") as ImportPlan
    const cal = schoolCal()
    for (const c of plan.courses) if (c.isNew) c.term = defaultTerm(cal, c.term || "", today())
    return { ...plan, outline }
}

/**
 * The outline planned against a class's course and items (null: a new class). Every row goes
 * under the class's one course; meetings it already has start unticked; each item is New,
 * Changed or Already there by type and normalised title.
 */
export function planForClass(outline: Outline, course: SharedCourse | null, items: SharedItem[]): ImportPlan {
    const plan = planOutline(outline, { courses: [], items: [] }, termStart() || "") as ImportPlan
    const pc = plan.courses[0]
    const id = course?.id ?? pc.id
    const meetings = plan.courses.flatMap((c) => c.meetings).map((m) => ({
        ...m, include: !course?.meetings.some((x) => x.weekday === m.weekday && x.start === m.start),
    }))
    plan.courses = [{
        ...pc, id, isNew: !course, meetings, keep: !course,
        ...(course ? { code: course.code, name: course.name, color: course.color } : {}),
    }]
    for (const it of plan.items) {
        it.row.courseId = id
        const twin = items.find((x) => x.type === it.row.type && norm(x.title) === norm(it.row.title))
        if (!twin) continue
        it.match = twin.id
        const differs = FACTS.some((f) => (f === "where" ? !!it.row.where && it.row.where !== twin.where : (twin[f] ?? null) !== (it.row[f] ?? null)))
        it.include = false
        if (differs) { it.duplicate = false; it.was = twin.date ? shortDate(twin.date) : "no date" }
        else it.duplicate = true
    }
    return { ...plan, outline }
}

/** Import the ticked rows into a class: meetings onto its course, New as its items, Changed onto the items they match. */
export async function commitToClass(plan: ImportPlan, spaceId: string): Promise<string> {
    const scope = "c:" + spaceId
    const course = (data.shared_courses ?? []).find((c) => c.scope === scope)
    if (!course) throw new Error("the class isn't on this device yet")
    const add = plan.courses.flatMap((c) => c.meetings.filter((m) => m.include).map(({ include: _, ...m }) => m))
    if (add.length) await store.saveShared("shared_courses", { ...course, meetings: [...course.meetings, ...add].slice(0, 12) } as unknown as Row & { scope: string })
    let added = 0, changed = 0
    for (const it of plan.items) {
        if (!it.include || !it.row.date) continue
        const row = normalizeItem({ ...it.row, courseId: course.id })
        const twin = it.match ? (data.shared_items ?? []).find((x) => x.scope === scope && x.id === it.match) : null
        if (twin) {
            await store.saveShared("shared_items", { ...twin, date: row.date, start: row.start, end: row.end, where: row.where || twin.where, weight: row.weight, recur: row.recur, weekday: row.weekday } as unknown as Row & { scope: string })
            changed++
        } else {
            await store.saveShared("shared_items", { ...row, scope, classId: null, status: "todo", grade: null, checklist: [], completedAt: null, notes: "" } as unknown as Row & { scope: string })
            added++
        }
    }
    const n = (k: number, one: string, many: string) => k + " " + (k === 1 ? one : many)
    return `Added ${n(added, "item", "items")}, updated ${changed}, and added ${n(add.length, "class", "classes")} to ${course.name}.`
}

/** A new class from the outline (spec §20): made on Import with the ticked meetings, then its ticked items written. Needs a connection. */
export async function commitNewClass(plan: ImportPlan): Promise<string> {
    const pc = plan.courses[0]
    const meetings = pc.meetings.filter((m) => m.include).map(({ include: _, ...m }) => m)
    const space = await api.spaces.create({ kind: "class", course: {
        code: pc.code, name: pc.name, color: freeColour([...data.courses, ...(data.space_prefs ?? [])]),
        instructor: pc.instructor || "", term: pc.term || "", meetings,
    } })
    if (!(await download(space.id))) return `${space.name} is made, but hasn't downloaded yet. Import the outline into it once it has.`
    const scope = space.scope, course = (data.shared_courses ?? []).find((c) => c.scope === scope)
    let n = 0
    for (const it of plan.items) {
        if (!it.include || !it.row.date || !course) continue
        await store.saveShared("shared_items", { ...normalizeItem({ ...it.row, courseId: course.id }), scope, classId: null, status: "todo", grade: null, checklist: [], completedAt: null, notes: "" } as unknown as Row & { scope: string })
        n++
    }
    openClass(space.id, "members")
    return `Made ${space.name} with ${n} item${n === 1 ? "" : "s"}. Invite people from Members.`
}
```

`api.spaces.create`'s body type (`src/core/api.ts`) already takes `course?: Record<string, unknown>`. `defaultTerm` is exported by `src/data/import-edit.ts`; if importing it here makes a cycle with Task 4's change to `import-edit.ts`, move `planMine` into `import-edit.ts` instead and import it from there.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/data/class-import.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/importers/plan.ts src/data/class-import.ts src/data/class-import.test.ts
git commit -m "Stage 6: plan an outline against a class (New, Changed, Already there) and import it, or make a class from it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The import preview's target picker

**Files:**
- Modify: `src/data/import-edit.ts`, `src/data/overlay.ts`, `src/components/sheet/sheet.tsx`, `src/components/sheet/import-sheet.tsx`
- Test: `src/components/sheet/class-import.test.tsx`

- [ ] **Step 1: Keep the outline on the plan (`src/data/import-edit.ts`)**

`readOutlineFile` gains a third parameter and opens the preview through the planners of Task 3:

```ts
/** A course outline, read by the Worker with AI, then previewed: for your courses, or (`forNewClass`) for a class made from it. */
export function readOutlineFile(file: File, note: NoteKey = "aiNote", { forNewClass = false } = {}) {
```

and its `done`:

```ts
        done: (outline: Outline) => {
            if (forNewClass) openSheet({ kind: "import", plan: planForClass(outline, null, []), name: file.name, target: { kind: "new-class" } })
            else openSheet({ kind: "import", plan: planMine(outline), name: file.name })
        },
```

Import `planForClass`, `planMine` from `./class-import` (or define `planMine` here, per Task 3's note). Drop the now-unused `planOutline` import if nothing else here uses it.

- [ ] **Step 2: The sheet kind (`src/data/overlay.ts`, `src/components/sheet/sheet.tsx`)**

`overlay.ts:24` becomes `| { kind: "import"; plan: ImportPlan; name: string; target?: Target }` (import `type Target` from `./class-import`). `sheet.tsx:110` passes it: `<ImportSheet key={shown.name} plan={shown.plan} name={shown.name} target={shown.target} />`.

- [ ] **Step 3: Write the failing test**

`src/components/sheet/class-import.test.tsx`, with the fakes of `classes.test.tsx` (copy its `vi.hoisted` block and mocks) plus `vi.mock("@/data/class-import", …)` keeping the real `planForClass`/`importTargets` and faking `commitToClass`, `commitNewClass`, `commitImport` (`vi.mock("@/data/import-edit", …)` the same way):

```tsx
describe("importing an outline", () => {
    const outline = { code: "WEB", name: "Web Services", classes: [], assessments: [{ type: "quiz", title: "Quiz 1", date: "2026-10-01", start: "", end: "", weight: 10 }, { type: "exam", title: "Midterm", date: "2026-10-30", start: "", end: "", weight: 30 }] }

    it("offers your classes as targets, and shows Already there and Changed against the one picked", async () => {
        fake.data.spaces = [space("owner")]
        fake.data.shared_courses = [course]
        fake.data.shared_items = [{ scope: SCOPE, id: "q1", type: "quiz", title: "Quiz 1", courseId: "web", date: "2026-09-30", start: "", end: "", where: "", weight: 10 }]
        render(<ImportSheet plan={planMine(outline as never)} name="web.pdf" />)
        fireEvent.change(screen.getByRole("combobox", { name: "Import into" }), { target: { value: "class:" + SID } })
        expect(screen.getByText(/was 30 Sept|was 30 Sep/)).toBeTruthy()
        expect(screen.getByRole("checkbox", { name: "Import Quiz 1" })).not.toBeChecked()
        fireEvent.click(screen.getByRole("button", { name: /Import/ }))
        await waitFor(() => expect(fakeImport.commitToClass).toHaveBeenCalledWith(expect.anything(), SID))
    })

    it("a member sees no target picker", () => {
        fake.data.spaces = [space("member")]
        render(<ImportSheet plan={planMine(outline as never)} name="web.pdf" />)
        expect(screen.queryByRole("combobox", { name: "Import into" })).toBeNull()
    })

    it("a new class from an outline imports through commitNewClass", async () => {
        render(<ImportSheet plan={planForClass(outline as never, null, [])} name="web.pdf" target={{ kind: "new-class" }} />)
        expect(screen.getByText(/A new shared class/)).toBeTruthy()
        fireEvent.click(screen.getByRole("button", { name: /Import/ }))
        await waitFor(() => expect(fakeImport.commitNewClass).toHaveBeenCalled())
    })
})
```

Match the "was …" text to what `shortDate("2026-09-30")` prints.

- [ ] **Step 4: Run it to see it fail**

Run: `npx vitest run src/components/sheet/class-import.test.tsx`
Expected: FAIL (no "Import into" picker).

- [ ] **Step 5: The sheet (`src/components/sheet/import-sheet.tsx`)**

Props: `{ plan: initial, name, target: given = { kind: "mine" } }: { plan: ImportPlan; name: string; target?: Target }`. State:

```tsx
    const [target, setTarget] = useState<Target>(given)
    const [plan, setPlan] = useState(initial)
    const targets = initial.outline && given.kind === "mine" ? importTargets() : []
    const retarget = (value: string) => {
        const outline = initial.outline!
        if (value === "mine") { setTarget({ kind: "mine" }); setPlan(planMine(outline)); return }
        const spaceId = value.slice("class:".length), scope = "c:" + spaceId
        const course = (data.shared_courses ?? []).find((c) => c.scope === scope) ?? null
        setTarget({ kind: "class", spaceId })
        setPlan(planForClass(outline, course, (data.shared_items ?? []).filter((it) => it.scope === scope)))
    }
```

`const cal = plan.kind === "outline" && target.kind !== "class" ? schoolCal() : null` (the semester picker is for your own courses and a new class).

At the top of the body, before the summary:

```tsx
                {targets.length > 0 && (
                    <label className="flex items-center gap-2.5 text-[12px] text-muted-foreground">
                        Import into
                        <select aria-label="Import into" value={target.kind === "class" ? "class:" + target.spaceId : "mine"} onChange={(e) => retarget(e.target.value)} className={cn(CONTROL, "w-auto")}>
                            <option value="mine">My courses</option>
                            {targets.map((s) => <option key={s.id} value={"class:" + s.id}>{s.name} · shared class</option>)}
                        </select>
                    </label>
                )}
                {target.kind === "class" && <span className="text-[11.5px] text-muted-foreground">Everyone in the class gets what you import. Changed rows start unticked: tick the ones the outline gets right.</span>}
                {target.kind === "new-class" && <span className="text-[11.5px] text-muted-foreground">A new shared class, with you as its owner. Nothing is made until you import.</span>}
```

`commit` picks by target:

```tsx
        try {
            const text = target.kind === "class" ? await commitToClass(plan, target.spaceId)
                : target.kind === "new-class" ? await commitNewClass(plan) : await commitImport(plan)
            note = { text, error: false }
        } catch (error) {
            note = { text: target.kind === "mine" ? "The import stopped part-way: " + (error as Error).message : messageFor(error), error: true }
        }
```

(`messageFor` from `@/data/classes`; it says "You seem to be offline…" for a network failure.) After a `new-class` commit, `commitNewClass` already opened the class sheet: call `closeSheet()` only for the other two targets.

`ItemRow` shows a Changed row:

```tsx
                {r.title}{it.duplicate && <em className="ml-1 text-[10.5px] text-[var(--amber-ink)] not-italic">already there</em>}
                {it.was && <em className="ml-1 text-[10.5px] text-[var(--amber-ink)] not-italic">changed · was {it.was}</em>}
```

Update the file's header comment: "…grouped by course; an outline can go into a class you edit, or a new class (src/data/class-import.ts)."

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/components/sheet/class-import.test.tsx src/components/sheet/ai-import.test.tsx && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/data/import-edit.ts src/data/overlay.ts src/components/sheet/sheet.tsx src/components/sheet/import-sheet.tsx src/components/sheet/class-import.test.tsx
git commit -m "Stage 6: the outline preview can import into a class you edit

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: New shared class from a course outline

**Files:**
- Modify: `src/components/sheet/new-class-sheet.tsx`
- Test: `src/components/sheet/class-import.test.tsx`

- [ ] **Step 1: Write the failing test** (append; mock `readOutlineFile` in the `@/data/import-edit` mock as `fakeImport.readOutlineFile`)

```tsx
describe("a new class from an outline", () => {
    it("reads the file picked with AI, for a new class", () => {
        render(<NewClassSheet />)
        fireEvent.click(screen.getByRole("radio", { name: /From a course outline/ }))
        const file = new File(["%PDF"], "web.pdf", { type: "application/pdf" })
        fireEvent.change(screen.getByLabelText("Course outline file"), { target: { files: [file] } })
        expect(fakeImport.readOutlineFile).toHaveBeenCalledWith(file, "aiNote", { forNewClass: true })
    })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/components/sheet/class-import.test.tsx`
Expected: FAIL (no such radio).

- [ ] **Step 3: `new-class-sheet.tsx`**

`type Start = "blank" | "convert" | "outline"`; add to `OPTIONS`:

```tsx
    ["outline", "From a course outline", "Term reads the outline with AI; you tick what goes in before anything is made."],
```

Import `readOutlineFile` from `@/data/import-edit` and `useRef`. In `NewClass`, a hidden file input:

```tsx
    const file = useRef<HTMLInputElement>(null)
```

```tsx
                <input ref={file} type="file" accept=".pdf,.txt,.docx,application/pdf,text/plain" aria-label="Course outline file" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) void readOutlineFile(f, "aiNote", { forNewClass: true }); e.target.value = "" }} />
```

In `go`: `if (start === "outline") { file.current?.click(); return }`. The button's label for this choice reads **Choose the outline…** (`{start === "outline" ? "Choose the outline…" : …}` where the foot button's text is set). Use the `accept` list the AI sheet's outline input uses (`grep -n "accept=" src/components/sheet/ai-sheet.tsx`) so both pickers take the same files. Update the header comment: "…blank, from a course of yours, or from a course outline (read with AI, then the import preview)."

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/components/sheet && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/sheet/new-class-sheet.tsx src/components/sheet/class-import.test.tsx
git commit -m "Stage 6: New shared class from a course outline

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The school-calendar offer on joining; the owner shares theirs

**Files:**
- Modify: `src/components/sheet/join-sheet.tsx`, `src/components/sheet/class-actions.tsx`
- Test: `src/components/sheet/classes.test.tsx`

- [ ] **Step 1: Write the failing tests** (in `classes.test.tsx`, its join-sheet `describe`; add `saveProfile: vi.fn(async () => undefined)` to the `@/core/store` mock and `school: vi.fn()` to `fake.api.spaces`)

```tsx
    it("offers the class's school calendar to someone with none, and saves it as theirs", async () => {
        const CAL = { name: "Northfield", terms: [{ name: "Fall 2026", start: "2026-09-08", end: "2026-12-18" }], days: [] }
        fake.api.spaces.get.mockResolvedValue({ ...details("member"), schoolCalendar: CAL })
        fake.data.spaces = [space("member")]; fake.data.shared_courses = [course]; fake.data.space_prefs = [pref]
        render(<JoinSheet code="" space={summary} />)
        fireEvent.click(await screen.findByRole("button", { name: "Use the class's school calendar" }))
        await waitFor(() => expect(fake.store.saveProfile).toHaveBeenCalledWith({ schoolCalendar: CAL }))
    })

    it("offers nothing to someone who has a school calendar", async () => {
        /* with schoolCal() answering a calendar (mock @/data/query for this case) */
    })
```

Write the second case for real by mocking `@/data/query`'s `schoolCal` (as `effective.test.ts` does) to return a calendar, rendering the joined step, and asserting `fake.api.spaces.get` was not called and no such button exists.

And in `leaving.test.tsx` (Stage 5's file), the owner's button:

```tsx
    it("the owner shares their school calendar with the class", async () => {
        fake.data.spaces = [space("owner")]
        fake.api.spaces.school.mockResolvedValue({ schoolCalendar: {} })
        render(<ClassSheet spaceId={SID} tab="details" />)
        fireEvent.click(screen.getByRole("button", { name: "Share my school calendar" }))
        await waitFor(() => expect(fake.api.spaces.school).toHaveBeenCalledWith(SID))
    })
```

(with `schoolCal()` mocked to answer a calendar in that file, since the button shows only when you have one).

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/components/sheet/classes.test.tsx src/components/sheet/leaving.test.tsx`
Expected: the new cases FAIL.

- [ ] **Step 3: The offer (`join-sheet.tsx`, in `Joined`)**

Import `useEffect` (already), `api` from `@/core/api`, `* as store` from `@/core/store`. Make the calendar state-driven, so taking one redraws:

```tsx
    const [cal, setCal] = useState(() => schoolCal())
    const [offer, setOffer] = useState<unknown | null>(null)
    useEffect(() => {
        if (cal) return
        let live = true
        api.spaces.get(s.id).then((d) => { if (live) setOffer(d.schoolCalendar ?? null) }, () => {})
        return () => { live = false }
    }, [s.id, cal])
    const take = async () => {
        try {
            await store.saveProfile({ schoolCalendar: offer as never })
            const now = schoolCal()
            setCal(now); setOffer(null)
            setTerm(defaultTerm(pref?.term ?? classTerm, now))
        } catch (e) { setErr(messageFor(e)) }
    }
```

(replacing `const f = useId(), cal = schoolCal()` with `const f = useId()` and the state above; keep `term`'s initial value from the first `cal`). Render, above the fields:

```tsx
                {!cal && offer != null && (
                    <div role="note" className="flex flex-wrap items-center gap-2 rounded-lg bg-muted px-2.5 py-2 text-[12px]">
                        <span className="min-w-0 flex-1">{s.name} has a school calendar: semesters, breaks and days off. Use it as yours?</span>
                        <Button variant="ghost" onClick={() => void take()}>Use the class's school calendar</Button>
                    </div>
                )}
```

`ProfilePatch.schoolCalendar`'s type: if `as never` reads badly to the reviewer, type `offer` as `Profile["schoolCalendar"]` instead. Update the header comment: the school-calendar offer is here now (drop "comes with Stage 6").

- [ ] **Step 4: The owner's button (`class-actions.tsx`, the owner block)**

Import `api` from `@/core/api`, `schoolCal` from `@/data/query`, `toast` from `@/data/toast`. Next to Archive:

```tsx
                    {schoolCal() && !space.archived && (
                        <Button variant="ghost" disabled={busy} onClick={() => void run(async () => {
                            await api.spaces.school(space.id)
                            toast("Your school calendar is shared with " + name + ". People joining without one are offered it.")
                        })}>Share my school calendar</Button>
                    )}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/components/sheet && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/sheet/join-sheet.tsx src/components/sheet/class-actions.tsx src/components/sheet/classes.test.tsx src/components/sheet/leaving.test.tsx
git commit -m "Stage 6: joiners without a school calendar are offered the class's; owners share theirs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Open shared classes to everyone

**Files:**
- Modify: `worker/spaces.js`, `worker/classes.js`, `worker/invites.js`, `src/data/effective.ts`, `src/data/classes.ts`, `src/data/session.ts`, `src/components/sidebar.tsx`, `src/components/sheet/course-sheet.tsx`, `src/components/sheet/share-course.tsx`, and the comments that say "until Stage 6"
- Test: `test/classes.test.js`, `test/invites.test.js`, `test/join-code.test.js`, `src/data/effective.test.ts`, `src/data/classes.test.ts`, `src/components/sheet/sheet.test.tsx`, `src/components/sidebar.test.tsx`, `src/components/sheet/classes.test.tsx`

- [ ] **Step 1: Flip the tests that pin the gate (they fail first)**

- `test/classes.test.js:16`: the case becomes

```js
  it('lets anyone signed in make a class', async () => {
    const res = await make(plain, { kind: 'class', course });
    expect(res.status).toBe(201);
    expect((await res.json()).space).toMatchObject({ kind: 'class', role: 'owner' });
  });
```

- `test/invites.test.js:41`: `expect(await (await invite(owner, 'iv-plain')).json()).toMatchObject({ role: 'member' });` (a plain account is invited like anyone); the case "refuse to be accepted by a non-admin…" (line 73) drops its non-admin step and keeps the others (withdrawn, missing, expired, class gone).
- `test/join-code.test.js:71`: "refuse: not an admin 403, …" drops the non-admin step and its title says "refuse: malformed 400, unknown 404, expired or used up 410"; add one line that a plain account joins with a fresh code (`200`).
- `src/data/effective.test.ts:88` and `:109`: shared rows now show for every profile: assert they are shown for `{ id: "u1", isAdmin: false }` and for `{ id: "u1" }`.
- `src/data/classes.test.ts:88` "are fetched for admins only…": fetched for anyone signed in.
- `src/components/sheet/sheet.test.tsx:362` "offers sharing the course to admins only": offered to anyone.
- `src/components/sidebar.test.tsx`: every case that checks the eye toggles, *Personal items*, Invites or the **+** menu are admin-only now expects them for a plain profile (`grep -n "isAdmin" src/components/sidebar.test.tsx`).
- `src/components/sheet/classes.test.tsx:271`: a plain profile without the maintenance switch sees the class sheet (no change if it already does).

Run: `npm run test:api; npm run test:ui`
Expected: those cases FAIL.

- [ ] **Step 2: The Worker**

- `worker/spaces.js`: delete `ADMINS_ONLY` and its comment.
- `worker/classes.js`: delete the `ADMINS_ONLY` import, `requireAdmin` import and `joiner`; its three uses become `await requireUser(request, env)`. The header comment's second sentence becomes: "Anyone signed in may make or join a class (spec §22, opened in Stage 6)."
- `worker/invites.js`: delete `ADMINS_ONLY` from the import and the line `if (ADMINS_ONLY && who.is_admin !== 1) throw new HttpError(409, { error: 'not_admin' });`; drop "409 not_admin … (ADMINS_ONLY)" from the doc comment. If `who`'s query selects `is_admin` only for that check, drop it from the SELECT.

- [ ] **Step 3: The client**

- `src/data/effective.ts`: delete `CLASSES_ADMIN_ONLY`; `export const sharedShown = (): boolean => SHARED_IN_VIEWS`. Header comment: "What every view reads: your own courses and items and your classes' and projects', with your layer on top (spec §7)." Remove the now-unused `data.profile` read if nothing else in the file uses it.
- `src/data/classes.ts`: `refreshInvites` drops `if (!data.profile?.isAdmin) return` (keep a signed-out guard: `if (!data.profile) return`); `messageFor` drops the `not_admin` line; header comment drops "Shown to admins only until classes open to everyone (Stage 6); the Worker refuses anyone else too."
- `src/data/session.ts`: the block becomes

```ts
    /* your invites, and a join link's code */
    watchInvites()
    const join = joinReturn()
    if (join) openJoin(join)
```

- `src/components/sidebar.tsx`: delete `const admin = …` and the comment above it; `off = hidden.includes(source)`; `<Eye …/>` always; *Personal items* always; `<InvitesRow />` always; `<NewMenu />` always (delete the plain "+ New course" branch: `NewMenu` holds *New course*). Remove the `useProfile` import if `profile` is no longer read (it is: `hiddenSources`).
- `src/components/sheet/course-sheet.tsx:151`: `{!isNew && !shared && <ShareCourse courseId={draft.id} dirty={changed} />}`; delete `admin` at line 52 if unused.
- `src/components/sheet/share-course.tsx`: delete `admin` and its `!admin ||` check; header comment: "…for everyone (spec §13, §15)…; it shows nothing while the admins have shared classes switched off."
- Every other comment: `grep -rn "Stage 6\|admins only\|for admins until\|admin-only" src worker --include=*.ts --include=*.tsx --include=*.js | grep -v "\.test\."` and reword each that is now untrue (the class sheet, the class item card, the join sheet, the new-class sheet, `src/data/marks.ts`, `src/data/leave.ts`, `src/components/sidebar-classes.tsx`, `src/data/maintenance.ts` where it speaks of classes). Leave the Admin page's own checks (`side-nav.tsx`, `src/components/admin/`, `maintenance.ts`'s `isAdmin` for the bar) as they are.

- [ ] **Step 4: Run everything**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker src test
git commit -m "Stage 6: shared classes open to everyone

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Docs

- [ ] **Step 1:** `docs/OVERVIEW.md` and `README.md`: shared classes are for everyone (what a class is, joining by invite or code, your own layer, leaving keeps a copy); the calendar feed carries your classes; outlines import into a class you edit, or make one.
- [ ] **Step 2:** `docs/DATA-MODEL.md`: `spaces.school_calendar` (filled when a class is made, refreshed by `POST /api/spaces/:sid/school`, returned by `GET /api/spaces/:sid`); the feed's UIDs for class rows; the import's targets.
- [ ] **Step 3:** The master plan: the Stage 6 row's plan cell becomes `` `docs/superpowers/plans/2026-10-07-collab-stage-6-feed.md` ``; under the Stage 7 outline, a **Hand-offs from Stage 6** note: "Classes are open to everyone. The inbox replaces the Invites row (now shown to everyone). The feed leaves out removed class items; projects join it in Stage 10. The spec's `POST /api/spaces {outline}` was not built (Stage 6 plan, Decision 5)."
- [ ] **Step 4: Commit**

```bash
git add docs README.md
git commit -m "Stage 6: docs for open classes, the feed and outline imports

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Full check, browser check, merge (George's yes)

- [ ] **Step 1:** `npm run check`; `iconv` over every file this stage touched (`git diff --name-only main` in Git Bash).
- [ ] **Step 2:** Code review of `main..collab-6-feed` (superpowers:requesting-code-review) against this plan's Decisions; fix what it confirms.
- [ ] **Step 3: Browser check** (`npm run dev`; local accounts: one admin `qaa`, one **plain** account `qac`)

1. As `qac` (not an admin): the **+** menu has *New shared class* and *Join with code*; make a blank class; invite `qaa`; `qaa` accepts.
2. As `qaa` with a school calendar: *Share my school calendar* in the class sheet. As a third plain account with no calendar, join with a code: the join screen offers the class's calendar; take it; the semester picker appears.
3. As `qac`: Import with AI → an outline (one AI read) → **Import into** the class: rows show New / Changed / Already there; import; `qaa` sees the items after a sync.
4. *New shared class → From a course outline* (the second AI read): the preview says it is a new class; Import makes the class, opens its Members tab, items are there.
5. Settings → calendar feed on; open the `.ics` URL: the class's items and meetings are there with ✓ on completed ones; hide the class with its eye; fetch again: gone.
6. Admin page → maintenance → switch classes off: `qac` gets the maintenance page in the class sheet; switch it back on.

- [ ] **Step 4: Merge and push, only with George's yes.** No migration. On yes:

```bash
git checkout main && git merge --no-ff collab-6-feed -m "Merge collab-6-feed: feed, outline imports, classes for everyone (Stage 6)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" && npm run check && git push
```

Then ask George to check the live site signed in as a non-admin account.

---

## Self-review against the outline

- Master plan Stage 6: `worker/calendar.js` class rows with marks, `hidden_sources`, scoped UIDs (Task 2); outline import target picker and diff preview (Tasks 3–4); class from an outline (Tasks 3, 5); school-calendar snapshot offer on join (Tasks 1, 6); the admin gate removed in the Worker (`ADMINS_ONLY` create/accept/join, `not_admin`) and the client (`sidebar.tsx`, `course-sheet.tsx`, `session.ts`, `classes.ts` `refreshInvites`, `effective.ts` `CLASSES_ADMIN_ONLY`) (Task 7).
- Stage 4 hand-offs: the feed applies `space_prefs` (term, archived) and marks, honours `hidden_sources`, and brings back converted courses' events (Task 2, Decision 3). Colours are not in the ICS format the feed writes, so `space_prefs.color` has nothing to apply to.
- Stage 5 hand-off: removed class items are left out of the feed (Decision 1 settles it); a left class's rows are gone because the feed joins live membership (Task 2's second served test).
