# Collaboration Stage 8: Team projects, the core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

This is **Stage 8** of the master plan `docs/superpowers/plans/2026-10-02-collaboration.md` (the first of v2, "Stages 8–10 — Team projects", and the hand-offs Stages 5 and 7 recorded). It is written on 2026-10-07, **before Stages 5–7 are built**, against the code as it will be once they are merged: Stage 5's `worker/leaving.js` (`leave`, `removeMember`, `setArchived`, `handOnStmts`, the `/leave`, `/archive`, member `DELETE` and space `DELETE` routes), `assertKeeper`/`keeperGuard`, `purgeTombstones` in §13's order, `src/data/leave.ts`; Stage 6's open classes; Stage 7's `worker/activity.js` (`noteStmt`, `SPACE_NAME`), `src/data/inbox.ts` (`openRow`, `describe`), `src/components/sheet/activity-list.tsx`. **Start Stage 8 only after Stage 7 is merged to `main`.** If an earlier stage changed a name this plan uses, follow that stage's code.

**Goal:** An admin can make a **team project** (on its own, or belonging to a class assignment they can see), invite teammates (who join as editors), and run it from a **project sheet**: add, edit, assign and delete tasks; members claim unassigned tasks and complete the ones assigned to them or to everyone; the owner links or unlinks the assignment, archives, hands on and deletes the project; anyone but the owner leaves. Leaving or being removed strips you from every task's assignees and deletes your notes there. Projects stay **admin-only and out of the Week, Month and other views** until Stage 9 puts them in the views and Stage 10 opens them to everyone.

**Architecture:** The data model has been ready since Stage 1 (`p:` scope CHECKs, `assignees`, `completed_by`) and Stage 2 (field merge, `memberTaskWrite`, the assignee guard). This stage adds `worker/projects.js` (make, link, leave/remove, delete, the 200-task limit) and routes it through the existing space routes by kind. On the client, `src/data/projects.ts` reads tasks straight from `data.shared_items` and writes them with `store.saveShared`, so sync, pending ops, field merge and Saved copies work as they do for class items; `effective.ts` keeps project rows out of the views (`PROJECTS_IN_VIEWS = false`) until Stage 9.

**Tech Stack:** Cloudflare Workers + D1 (plain JS ES modules), React 19 + TypeScript + Vite, IndexedDB, Vitest (Workers pool + jsdom), wrangler.

**Spec:** `docs/superpowers/specs/2026-10-02-shared-classes-design.md`: §1, §3 (limits: 200 live tasks), §4 (project and task rows), §5 (task permissions, delete a project, link), §10 (all of it), §11 (project invites: default role editor), §13 (delete a project, leave or removal from a project, account deletion strips assignees), §14 (`POST /api/spaces {kind:'project', title, parent?}`), §15 (Project sheet), §19 (task assigned to a removed member), §20 (create a project, assign a task), §21 steps 10–13, 22–24.

**UI reference:** the prototype George approved (artifact https://claude.ai/artifact/NsegZJE8Wu4A6MvsvWx6HE): the Projects group, the project sheet (tasks, claim, assignee chips). Progress, workload and **Use this date** are Stage 9.

---

## How to work in this repo (read before any task)

1. **Checks:** `npm run typecheck`, `npm test` (Vitest: Workers + jsdom projects, then node tests), `npm run build`. `npm run check` runs all three. One file: `npx vitest run test/projects.test.js`. The jsdom tests alone: `npm run test:ui`. The Worker tests alone: `npm run test:api`.
2. **Dev server:** `npm run dev` → http://127.0.0.1:8787. On this Windows machine a stopped dev server can leave `vite.js` holding 8787/8790 and serving old code: check `Get-NetTCPConnection -LocalPort 8787 -State Listen` in PowerShell first and stop the owning process. Don't run `npm run build` while the dev server runs.
3. **Line endings:** keep every file LF.
4. **Non-ASCII** (·, —, …, ✓): write it with the Edit/Write tools, never through a shell; after a commit that adds any, `npm run build`. Check a sub-agent's files with `iconv -f utf-8 -t utf-8 <file> >/dev/null` in Git Bash.
5. **Deploying:** **no migration** (every column and verb exists: Stage 1's columns, Stage 7's activity verbs `space.linked` and `space.deleted`).
6. **Commits:** end each message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Commit only on `collab-8-projects`; never push or merge to `main` without George's yes.
7. **Workers AI:** nothing in this stage calls AI.
8. **The suite stays green after every task**; a task that changes a behaviour an older test spells out updates that test in the same task.
9. **Triggers:** shared `items` writes also write `activity` (Stage 7). Count your own rows with `SELECT changes()`, never `meta.changes`.

Branch, made once Stage 7 is merged:

```bash
git checkout main && git pull --ff-only && git checkout -b collab-8-projects
```

---

## Decisions this plan takes

1. **Admin-only until Stage 10.** `PROJECTS_ADMINS_ONLY` in `worker/projects.js`: making a project needs an admin (`403`); an invite to a project for someone who is not an admin is `409 not_admin`; accepting a project invite or joining one by code is `403 not_admin` for anyone else. The client shows **New team project**, the Projects group and the project sheet to admins only (`projectsShown()`). Stage 10 sets both flags false, once the views (Stage 9) and the calendar feed (Stage 10) carry projects.
2. **Out of the views until Stage 9.** `PROJECTS_IN_VIEWS = false` in `src/data/effective.ts`: `mergeItems` skips `p:` rows, so the Week, Month, All items, Stats, grades and achievements are untouched. The project sheet reads tasks straight from the store.
3. **Making a project** (spec §10, §20): `POST /api/spaces {kind:'project', title, date?, parent?: {space, item}}`. One batch: the space (with `parent_space`/`parent_item`), the owner's membership, the `project` item (title; date given, else the assignment's), and the owner's prefs (a colour they do not use yet; `joinPrefs` now serves projects too). A `parent` needs you to be a live member of that class and the item to be live there (`400 {field:'parent'}` otherwise). With no `parent`, `date` is required. The 20-space limit applies (`409 limit`).
4. **Linking** (spec §10): `POST /api/spaces/:sid/link {parent: {space, item} | null}`, the owner of an unarchived project, who must be a live member of the class. Linking also sets the project's due date to the assignment's (spec: "linked from an assignment takes the assignment's date as its starting deadline"); unlinking leaves the date. Writes `space.linked` (`new_value` the item id, or NULL for an unlink; `detail.assignment` the assignment's title). The Stage 7 `describe()` learns the unlink wording. `POST` rather than the spec's `PATCH`, as Stage 5 did for archive.
5. **Tasks**: ordinary shared writes. The Worker already applies §5's rules (Stage 2): owners and editors write whole rows or merged fields; a member's write names only `status`/`completedAt` (a task assigned to them or to everyone) or only `assignees` (claim an unassigned task, or unclaim themselves). This stage adds the **200 live tasks per project** limit to the create (`409 {error:'limit'}`), checked in the statement; a write to a task that already exists is never refused for it.
6. **Leaving and removal** (spec §10, §13): `POST /api/spaces/:sid/leave` and `DELETE /api/spaces/:sid/members/:uid` serve projects too. One batch: you are stripped from every task's `assignees` (a task left with nobody becomes unassigned; the trigger writes `task.unassigned`), your marks and prefs in the project are soft-deleted, your membership ends; `member.left` / `member.removed`. Nothing is copied (`keepCopy` is ignored). The owner hands the project on first (`403 owner`).
7. **Deleting a project** (spec §13): `DELETE /api/spaces/:sid {confirm}`, the owner (archived or not), with `confirm` equal to the project's title (the typed confirm, checked by the Worker too, as account deletion does). One batch: `space.deleted` about each other live member (so it reaches them after the space is gone), every member's marks and prefs there soft-deleted, its invites deleted, the space soft-deleted. Sync revokes it everywhere; the nightly purge removes it after 30 days.
8. **Archiving and handing on** need nothing new: Stage 5's `/archive` and `/transfer` work for any space.
9. **Account deletion** strips the account from the `assignees` of every project it was in (Stage 5's `handOnStmts` gains one statement). A project with nobody else is deleted there already.
10. **The purge**: a deleted task's marks go with it. Stage 5's purge only deletes marks that hold nothing (a class item's meaningful marks are detached first); on a **project** row every mark goes (spec §13: "your note on it goes with it at purge"), and a project row is never held back by a mark.
11. **The project sheet** comes in this stage in a working form (tabs **Tasks**, **Members**, **Activity**), so the stage can be checked by hand; Stage 9 adds progress, workload, the linked assignment's header with **Use this date**, and opening a task in the item card. A task is edited inline in the sheet. Assignee names come from `space.members` (sync). The sidebar gets a plain **Projects** group (name and team glyph); Stage 9 adds the progress ring and the eye.
12. **Joining a project** (invite or code): the join sheet downloads it and offers **Open the project**; there is no semester, colour or merge step.

## File map

| File | Change |
|---|---|
| `worker/projects.js` | new: `PROJECTS_ADMINS_ONLY`, `isAdmin`, `assertProjectsOpen`, `projectBody`, `createProject`, `linkProject`, `leaveProject`, `deleteProject`, `TASK_LIMIT` |
| `worker/spaces.js` | `joinPrefs` serves projects |
| `worker/classes.js` | `POST /api/spaces` by kind; `/link`; space `DELETE` by kind; the gate on accept |
| `worker/invites.js` | `not_admin` for project invites and joins |
| `worker/leaving.js` | `leave`, `removeMember` hand projects to `leaveProject`; `handOnStmts` strips assignees |
| `worker/db.js` | the 200-task limit in `sharedUpsertStmt`/`upsertShared`; the purge's project marks |
| `src/core/types.ts` | `ProjectBody` |
| `src/core/api.ts` | `spaces.create` takes a project; `spaces.link`; `spaces.deleteProject` |
| `src/core/sync.ts` | the reason for `409 limit` |
| `src/data/effective.ts` | `PROJECTS_IN_VIEWS` |
| `src/data/projects.ts` | new: gate, sheets, selectors, permissions, task writes, make/link/delete/leave, `linkable` |
| `src/data/classes.ts` | `landed` knows projects; `messageFor` learns `not_admin` for projects, `parent`, `confirm` |
| `src/data/inbox.ts` | `openRow` opens a project; `describe` the unlink |
| `src/data/overlay.ts` | `{kind:'project'}`, `{kind:'new-project'}` |
| `src/components/shared-glyph.tsx` | `TeamGlyph` |
| `src/components/sidebar-classes.tsx` | **New team project** in the + menu |
| `src/components/sidebar-projects.tsx` | new: the Projects group |
| `src/components/sidebar.tsx` | the Projects group |
| `src/components/sheet/new-project-sheet.tsx` | new |
| `src/components/sheet/project-sheet.tsx` | new: header, tabs, Tasks tab, actions |
| `src/components/sheet/task-row.tsx` | new: a task's row and inline editor |
| `src/components/sheet/join-sheet.tsx` | a joined project |
| `src/components/sheet/members-tab.tsx` | removal wording for a project |
| `src/components/sheet/sheet.tsx` | the two sheets |
| `docs/DATA-MODEL.md`, `docs/PROJECT-OVERVIEW.md`, master plan | routes, Stage 8 row, hand-offs |
| Tests | new `test/projects.test.js`, `test/project-leave.test.js`, `src/data/projects.test.ts`, `src/components/sheet/project.test.tsx`; changed `test/purge.test.js`, `test/admin.test.js`, `test/invites.test.js`, `src/data/effective.test.ts`, `src/data/inbox.test.ts` |

---

### Task 1: Making a project; the admin gate

**Files:**
- Create: `worker/projects.js`
- Modify: `worker/spaces.js` (`joinPrefs`), `worker/classes.js` (`POST /api/spaces`, accept), `worker/invites.js`
- Test: `test/projects.test.js`

- [ ] **Step 1: Write the failing test**

`test/projects.test.js`:

```js
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { signIn } from './helpers.js';
import { makeSpace, post, sharedItem, signInAdmin } from './spaces.js';

let n = 0;
const one = (sql, ...binds) => env.DB.prepare(sql).bind(...binds).first();
const make = (api, body) => post(api, '/api/spaces', { kind: 'project', ...body });

describe('making a team project (spec §10, §20)', () => {
  it('makes the space, your membership as owner, its project item and your prefs', async () => {
    const me = await signInAdmin('pjo' + ++n);
    const res = await make(me, { title: 'Fire Response API', date: '2026-10-30' });
    expect(res.status).toBe(201);
    const { space } = await res.json();
    expect(space).toMatchObject({ kind: 'project', name: 'Fire Response API', role: 'owner', members: 1, scope: 'p:' + space.id });
    expect(await one("SELECT type, title, date, status FROM items WHERE scope = ? AND id = 'project'", space.scope))
      .toEqual({ type: 'project', title: 'Fire Response API', date: '2026-10-30', status: 'todo' });
    expect(await one('SELECT term FROM space_prefs WHERE user_id = ? AND id = ?', me.id, space.id)).toEqual({ term: '' });
    expect(await one('SELECT count(*) AS n FROM activity WHERE space_id = ?', space.id)).toEqual({ n: 0 });
  });

  it("takes the assignment's date when it belongs to one you can see", async () => {
    const me = await signInAdmin('pjl' + ++n);
    const cls = await makeSpace({ members: { [me.id]: 'member' } });
    await sharedItem(cls.scope, 'a1', { course_id: 'web', title: 'REST API Project', date: '2026-10-15' });
    const { space } = await (await make(me, { title: 'Fire Response API', parent: { space: cls.id, item: 'a1' } })).json();
    expect(await one("SELECT date FROM items WHERE scope = ? AND id = 'project'", space.scope)).toEqual({ date: '2026-10-15' });
    expect(await one('SELECT parent_space, parent_item FROM spaces WHERE id = ?', space.id)).toEqual({ parent_space: cls.id, parent_item: 'a1' });
  });

  it('refuses a parent you cannot see, a missing date, a bad title, and past 20 spaces', async () => {
    const me = await signInAdmin('pjx' + ++n);
    const theirs = await makeSpace({ members: {} });
    await sharedItem(theirs.scope, 'a1', { course_id: 'web' });
    expect(await (await make(me, { title: 'X', parent: { space: theirs.id, item: 'a1' } })).json()).toEqual({ error: 'invalid', field: 'parent' });
    expect(await (await make(me, { title: 'X' })).json()).toEqual({ error: 'invalid', field: 'date' });
    expect(await (await make(me, { title: '', date: '2026-10-30' })).json()).toEqual({ error: 'invalid', field: 'title' });
    for (let i = 0; i < 20; i++) await makeSpace({ members: { [me.id]: 'member' } });
    const full = await make(me, { title: 'One more', date: '2026-10-30' });
    expect(full.status).toBe(409);
    expect(await full.json()).toEqual({ error: 'limit' });
  });

  it('is for admins only until Stage 10: making, inviting, accepting, joining', async () => {
    const plain = await signIn('pjp' + ++n);
    expect((await make(plain, { title: 'X', date: '2026-10-30' })).status).toBe(403);
    const admin = await signInAdmin('pja' + n);
    const { space } = await (await make(admin, { title: 'Team', date: '2026-10-30' })).json();
    const invite = await post(admin, `/api/spaces/${space.id}/invites`, { username: 'pjp' + n });
    expect(invite.status).toBe(409);
    expect(await invite.json()).toEqual({ error: 'not_admin' });
    await env.DB.prepare("INSERT INTO invites (space_id, user_id, invited_by, role, created_at, expires_at) VALUES (?, ?, ?, 'editor', ?, ?)")
      .bind(space.id, 'u-pjp' + n, admin.id, Date.now(), Date.now() + 86_400_000).run();
    expect((await post(plain, `/api/invites/${space.id}/accept`)).status).toBe(403);
    const { code } = await (await post(admin, `/api/spaces/${space.id}/code`)).json();
    expect((await post(plain, '/api/join', { code })).status).toBe(403);
  });

  it('an admin invited joins as an editor, with prefs', async () => {
    const owner = await signInAdmin('pji' + ++n), mate = await signInAdmin('pjm' + n);
    const { space } = await (await make(owner, { title: 'Team', date: '2026-10-30' })).json();
    await post(owner, `/api/spaces/${space.id}/invites`, { username: 'pjm' + n });
    expect((await (await post(mate, `/api/invites/${space.id}/accept`)).json()).space).toMatchObject({ role: 'editor' });
    expect(await one('SELECT count(*) AS n FROM space_prefs WHERE user_id = ? AND id = ?', mate.id, space.id)).toEqual({ n: 1 });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run test/projects.test.js`
Expected: FAIL (`400 {field:'kind'}` from `classBody`).

- [ ] **Step 3: `joinPrefs` serves projects (`worker/spaces.js`)**

In `joinPrefs`, change `AND EXISTS (SELECT 1 FROM spaces WHERE id = ?2 AND kind = 'class' AND deleted_at IS NULL)` to `AND EXISTS (SELECT 1 FROM spaces WHERE id = ?2 AND deleted_at IS NULL)`, and its doc comment's "Only for a live member of a class" to "Only for a live member of a live space (a project has no course, so it gets the first colour you do not use and no term)". A project has no course row, so the first `COALESCE` term is NULL and the free colour wins; its `term` is `''`.

- [ ] **Step 4: Write `worker/projects.js`**

```js
// Team projects (spec §10): one 'project' item and its tasks in a 'p:' scope. Making one,
// linking it to a class assignment, leaving it or being removed (no copy: the rows are the
// team's), and deleting it. Tasks themselves are ordinary shared writes (worker/db.js), whose
// member rules have been there since Stage 2. Admins only until Stage 10.
import { HttpError } from './http.js';
import { assertKeeper, assertOwner, keeperGuard, memberGuard, ownerGuard, roleOf } from './access.js';
import { MY_SPACES, NEXT_ROW_REVISION, NEXT_SPACE_REVISION, SPACE_LIMIT, joinPrefs, randomId, spaceSummary, touchSpace } from './spaces.js';
import { BUCKET_MS, SPACE_NAME, noteStmt } from './activity.js';

/** Projects are for admins until Stage 10 opens them (Stage 8 plan, Decision 1). */
export const PROJECTS_ADMINS_ONLY = true;
/** The most live tasks a project holds (spec §3 Limits). */
export const TASK_LIMIT = 200;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SPACE_ID = /^[a-z0-9]{12}$/;
const bad = (field) => new HttpError(400, { error: 'invalid', field });

export const isAdmin = async (db, userId) => (await db.prepare('SELECT is_admin FROM users WHERE id = ?').bind(userId).first())?.is_admin === 1;
/** 403 not_admin for a project while they are admins only; `kind` is the space's. */
export async function assertProjectsOpen(db, userId, kind) {
  if (kind === 'project' && PROJECTS_ADMINS_ONLY && !(await isAdmin(db, userId))) throw new HttpError(403, { error: 'not_admin' });
}

/** {space, item} of a class assignment, or null; anything else is a 400 on `parent`. */
export function parentOf(v) {
  if (v == null) return null;
  if (typeof v !== 'object' || !SPACE_ID.test(v.space) || typeof v.item !== 'string' || v.item.length < 1 || v.item.length > 24
    || /[\u0000-\u001f\u007f]/.test(v.item)) throw bad('parent');
  return { space: v.space, item: v.item };
}

/** POST /api/spaces for a project: {title, date?, parent?}; a date unless it belongs to an assignment. */
export function projectBody(body) {
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (title.length < 1 || title.length > 140) throw bad('title');
  const parent = parentOf(body.parent);
  const date = body.date == null ? null : body.date;
  if (date !== null && (typeof date !== 'string' || !DATE.test(date))) throw bad('date');
  if (date === null && !parent) throw bad('date');
  return { title, date, parent };
}

/* A live item of the class `?` (bound 'c:' || space) with the id `?`; its date. */
const ASSIGNMENT_DATE = '(SELECT date FROM items WHERE scope = ? AND id = ? AND deleted_at IS NULL)';

/**
 * A new project with you as its owner (Decision 3), in one batch: the space, your membership,
 * its 'project' item and your prefs. With a parent, you must be a live member of that class and
 * the item live there, and the date defaults to the item's. 409 limit past 20 spaces; 400 parent.
 */
export async function createProject(db, userId, { title, date = null, parent = null }, now = Date.now()) {
  const id = randomId(), scope = 'p:' + id, made = 'EXISTS (SELECT 1 FROM spaces WHERE id = ?)';
  const g = parent ? memberGuard(parent.space, userId) : null;
  const [space] = await db.batch([
    db.prepare(`INSERT INTO spaces (id, kind, parent_space, parent_item, created_at, updated_at, revision)
      SELECT ?, 'project', ?, ?, ?, ?, ${NEXT_SPACE_REVISION} WHERE ${MY_SPACES} < ?${parent ? ` AND ${g.sql} AND ${ASSIGNMENT_DATE} IS NOT NULL` : ''}`)
      .bind(id, parent?.space ?? null, parent?.item ?? null, now, now, userId, SPACE_LIMIT, ...(parent ? [...g.binds, 'c:' + parent.space, parent.item] : [])),
    db.prepare(`INSERT INTO members (space_id, user_id, role, joined_at, updated_at) SELECT ?, ?, 'owner', ?, ? WHERE ${made}`).bind(id, userId, now, now, id),
    db.prepare(`INSERT INTO items (scope, id, type, title, date, status, updated_by, created_at, updated_at, revision)
      SELECT ?, 'project', 'project', ?, COALESCE(?, ${ASSIGNMENT_DATE}), 'todo', ?, ?, ?, ${NEXT_ROW_REVISION} WHERE ${made}`)
      .bind(scope, title, date, 'c:' + (parent?.space ?? ''), parent?.item ?? '', userId, now, now, id),
    joinPrefs(db, userId, id, now),
  ]);
  if (space.meta.changes) return spaceSummary(db, userId, id);
  const { n } = await db.prepare(`SELECT ${MY_SPACES} AS n`).bind(userId).first();
  if (n >= SPACE_LIMIT) throw new HttpError(409, { error: 'limit' });
  throw bad('parent');
}
```

`space.meta.changes` counts the `spaces` insert only (no trigger on `spaces`), as `createClass` relies on.

- [ ] **Step 5: Route by kind (`worker/classes.js`)**

Import `PROJECTS_ADMINS_ONLY, assertProjectsOpen, createProject, projectBody` from `./projects.js` and `requireAdmin` stays imported. In the `POST /api/spaces` route, before `classBody`:

```js
    const raw = await readJson(request);
    if (raw.kind === 'project') {
      const userId = PROJECTS_ADMINS_ONLY ? (await requireAdmin(request, env)).id : await requireUser(request, env);
      return json({ space: await createProject(env.DB, userId, projectBody(raw)) }, 201);
    }
```

and the class path reads `classBody(raw)` instead of reading the body again. (Stage 6 replaced `joiner` with `requireUser`; keep whatever the class path does now.)

In the accept route, before `acceptInvite`:

```js
    const userId = await requireUser(request, env);
    const kind = (await env.DB.prepare('SELECT kind FROM spaces WHERE id = ?').bind(sid).first())?.kind;
    await assertProjectsOpen(env.DB, userId, kind);
```

- [ ] **Step 6: Invites and codes (`worker/invites.js`)**

Import `PROJECTS_ADMINS_ONLY, assertProjectsOpen` from `./projects.js`. In `invite`, after the `409 member` line (Stage 6 removed the class `not_admin` line):

```js
  if (me.kind === 'project' && PROJECTS_ADMINS_ONLY && who.is_admin !== 1) throw new HttpError(409, { error: 'not_admin' });
```

(`who` already selects `u.is_admin`; if Stage 6 dropped it from the SELECT, add it back.) In `joinByCode`, right after the `space` lookup's 404: `await assertProjectsOpen(db, userId, space.kind);`. Check there is no import cycle: `worker/projects.js` must not import `worker/invites.js`.

- [ ] **Step 7: Run the tests**

Run: `npx vitest run test/projects.test.js test/classes.test.js test/invites.test.js test/join-code.test.js`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add worker/projects.js worker/spaces.js worker/classes.js worker/invites.js test/projects.test.js
git commit -m "Stage 8: make a team project (alone or under a class assignment); admins only

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Tasks: the 200 limit; linking a project

**Files:**
- Modify: `worker/db.js` (`sharedUpsertStmt`, `upsertShared`), `worker/projects.js` (`linkProject`), `worker/classes.js` (`/link`)
- Test: `test/projects.test.js` (two new `describe`s)

- [ ] **Step 1: Write the failing tests** (append)

```js
const task = (api, sid, id, body, rev = 0) => api(`/api/spaces/${sid}/items/${id}`, { method: 'PUT', headers: { 'if-match': `"${rev}"` },
  body: { type: 'task', title: id, date: '2026-10-20', status: 'todo', assignees: [], ...body } });

describe('tasks (spec §5, §10)', () => {
  it('editors add tasks up to 200; a write to one that exists is never refused for it', async () => {
    const owner = await signInAdmin('ptl' + ++n);
    const { space } = await (await make(owner, { title: 'Team', date: '2026-10-30' })).json();
    await env.DB.batch(Array.from({ length: 199 }, (_, i) => env.DB.prepare(`INSERT INTO items (scope, id, type, title, date, status, created_at, updated_at)
      VALUES (?, ?, 'task', 't', '2026-10-20', 'todo', 1, 1)`).bind(space.scope, 'x' + i)));
    const last = await task(owner, space.id, 'last', {});
    expect(last.status).toBe(200);
    const over = await task(owner, space.id, 'over', {});
    expect(over.status).toBe(409);
    expect(await over.json()).toEqual({ error: 'limit' });
    const again = await task(owner, space.id, 'last', { title: 'Last one' }, (await last.json()).revision);
    expect(again.status).toBe(200);
  });

  it("a member completes a task assigned to them, and claims an unassigned one", async () => {
    const owner = await signInAdmin('ptm' + ++n), mate = await signInAdmin('ptn' + n);
    const { space } = await (await make(owner, { title: 'Team', date: '2026-10-30' })).json();
    await env.DB.prepare("INSERT INTO members (space_id, user_id, role, joined_at, updated_at) VALUES (?, ?, 'member', 1, 1)").bind(space.id, mate.id).run();
    const t1 = await (await task(owner, space.id, 't1', { assignees: [mate.id] })).json();
    const done = await mate(`/api/spaces/${space.id}/items/t1`, { method: 'PUT', headers: { 'if-match': `"${t1.revision}"` },
      body: { ...t1, status: 'done', completedAt: Date.now(), changed: { status: 'todo', completedAt: null } } });
    expect((await done.json())).toMatchObject({ status: 'done', completedBy: mate.id });
    const t2 = await (await task(owner, space.id, 't2', {})).json();
    const claimed = await mate(`/api/spaces/${space.id}/items/t2`, { method: 'PUT', headers: { 'if-match': `"${t2.revision}"` },
      body: { ...t2, assignees: [mate.id], changed: { assignees: [] } } });
    expect((await claimed.json()).assignees).toEqual([mate.id]);
  });
});

describe('linking a project to an assignment (spec §10)', () => {
  it('the owner links it (taking the date), relinks, and unlinks; activity says so', async () => {
    const owner = await signInAdmin('pkl' + ++n);
    const cls = await makeSpace({ members: { [owner.id]: 'member' } });
    await sharedItem(cls.scope, 'a1', { course_id: 'web', title: 'REST API Project', date: '2026-10-15' });
    const { space } = await (await make(owner, { title: 'Team', date: '2026-10-30' })).json();
    const link = (parent) => post(owner, `/api/spaces/${space.id}/link`, { parent });
    expect((await link({ space: cls.id, item: 'a1' })).status).toBe(204);
    expect(await one("SELECT date FROM items WHERE scope = ? AND id = 'project'", space.scope)).toEqual({ date: '2026-10-15' });
    expect(await one('SELECT parent_space, parent_item FROM spaces WHERE id = ?', space.id)).toEqual({ parent_space: cls.id, parent_item: 'a1' });
    expect((await link(null)).status).toBe(204);
    expect(await one('SELECT parent_space FROM spaces WHERE id = ?', space.id)).toEqual({ parent_space: null });
    expect(await one("SELECT date FROM items WHERE scope = ? AND id = 'project'", space.scope)).toEqual({ date: '2026-10-15' });
    const notes = (await env.DB.prepare("SELECT new_value, json_extract(detail, '$.assignment') AS a FROM activity WHERE space_id = ? AND verb = 'space.linked' ORDER BY seq").bind(space.id).all()).results;
    expect(notes).toEqual([{ new_value: 'a1', a: 'REST API Project' }, { new_value: null, a: null }]);
  });

  it('refuses an editor, an assignment in a class you are not in, and a class space', async () => {
    const owner = await signInAdmin('pkr' + ++n), ed = await signInAdmin('pke' + n);
    const cls = await makeSpace({ members: {} });
    await sharedItem(cls.scope, 'a1', { course_id: 'web' });
    const { space } = await (await make(owner, { title: 'Team', date: '2026-10-30' })).json();
    await env.DB.prepare("INSERT INTO members (space_id, user_id, role, joined_at, updated_at) VALUES (?, ?, 'editor', 1, 1)").bind(space.id, ed.id).run();
    expect((await post(ed, `/api/spaces/${space.id}/link`, { parent: null })).status).toBe(403);
    expect(await (await post(owner, `/api/spaces/${space.id}/link`, { parent: { space: cls.id, item: 'a1' } })).json()).toEqual({ error: 'invalid', field: 'parent' });
    expect((await post(owner, `/api/spaces/${cls.id}/link`, { parent: null })).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run test/projects.test.js`
Expected: the limit case and the link cases FAIL (`200` instead of `409`; `405` for `/link`). The member case already passes (Stage 2).

- [ ] **Step 3: The limit (`worker/db.js`)**

Import `TASK_LIMIT` from `./projects.js` (check the cycle: `worker/projects.js` must not import `worker/db.js`). In `sharedUpsertStmt`, inside `if (table === 'items') { … }`, after `checks.push(...itemChecks(scope, fields));`:

```js
    /* a new task needs room in its project (spec §3); a row that is there already always may be written */
    if (scope.startsWith('p:') && fields.type === 'task') {
      checks.push({ sql: `(EXISTS (SELECT 1 FROM items WHERE scope = ? AND id = ?)
        OR (SELECT count(*) FROM items WHERE scope = ? AND type = 'task' AND deleted_at IS NULL) < ${TASK_LIMIT})`, binds: [scope, id, scope] });
    }
```

In `upsertShared`, right after `await assertWritable(…)`:

```js
  if (scope.startsWith('p:') && fields.type === 'task' && !(await getShared(db, table, scope, userId, id))) {
    const { n } = await db.prepare("SELECT count(*) AS n FROM items WHERE scope = ? AND type = 'task' AND deleted_at IS NULL").bind(scope).first();
    if (n >= TASK_LIMIT) throw new HttpError(409, { error: 'limit' });
  }
```

- [ ] **Step 4: `linkProject` (`worker/projects.js`)**

```js
/**
 * The owner links an unarchived project to a class assignment they can see, taking its date,
 * or unlinks it (parent null), which keeps the date (Decision 4); writes space.linked.
 * 404 outside the project or on a class; 403 for anyone but the owner; 400 parent.
 */
export async function linkProject(db, userId, spaceId, parent, now = Date.now()) {
  const me = await assertOwner(db, userId, spaceId);
  if (me.kind !== 'project') throw new HttpError(404, { error: 'not_found' });
  let assignment = null;
  if (parent) {
    const g = memberGuard(parent.space, userId);
    assignment = await db.prepare(`SELECT title, date FROM items WHERE scope = ? AND id = ? AND deleted_at IS NULL AND ${g.sql}`)
      .bind('c:' + parent.space, parent.item, ...g.binds).first();
    if (!assignment) throw bad('parent');
  }
  const g = ownerGuard(spaceId, userId);
  await db.batch([
    db.prepare(`UPDATE spaces SET parent_space = ?, parent_item = ?, updated_at = ?, revision = ${NEXT_SPACE_REVISION}
      WHERE id = ? AND (parent_space IS NOT ? OR parent_item IS NOT ?) AND ${g.sql}`)
      .bind(parent?.space ?? null, parent?.item ?? null, now, spaceId, parent?.space ?? null, parent?.item ?? null, ...g.binds),
    ...(parent ? [db.prepare(`UPDATE items SET date = ?, updated_by = ?, updated_at = ?, revision = revision + 1
      WHERE scope = ? AND id = 'project' AND date != ? AND EXISTS (SELECT 1 FROM spaces WHERE id = ? AND parent_item = ? AND updated_at = ?)`)
      .bind(assignment.date, userId, now, 'p:' + spaceId, assignment.date, spaceId, parent.item, now)] : []),
    noteStmt(db, { spaceId, actorId: userId, verb: 'space.linked', newValue: parent?.item ?? null, detail: parent ? { assignment: assignment.title } : {}, now,
      when: 'EXISTS (SELECT 1 FROM spaces WHERE id = ?1 AND updated_at = ?8 AND parent_item IS ?6)' }),
  ]);
}
```

- [ ] **Step 5: The route (`worker/classes.js`)**

Import `linkProject, parentOf`. Add to `classRoutes`:

```js
  ['POST', route(`spaces/${SID}/link`), async ({ request, env, params: [sid] }) => {
    const userId = await requireUser(request, env);
    await linkProject(env.DB, userId, sid, parentOf((await readJson(request)).parent));
    return done();
  }],
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run test/projects.test.js test/shared-routes.test.js test/shared-rows.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add worker/db.js worker/projects.js worker/classes.js test/projects.test.js
git commit -m "Stage 8: 200 tasks per project; link a project to a class assignment

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Leaving, removal, deleting a project; account deletion; the purge

**Files:**
- Modify: `worker/projects.js` (`leaveProject`, `deleteProject`), `worker/leaving.js` (`leave`, `removeMember`, `handOnStmts`), `worker/classes.js` (space `DELETE` by kind), `worker/db.js` (`purgeTombstones`)
- Test: `test/project-leave.test.js`; `test/purge.test.js`, `test/admin.test.js` (one case each)

- [ ] **Step 1: Write the failing tests**

`test/project-leave.test.js`:

```js
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { post, sharedItem, signInAdmin } from './spaces.js';

let n = 0;
const one = (sql, ...binds) => env.DB.prepare(sql).bind(...binds).first();
async function team() {
  const tag = ++n, owner = await signInAdmin('plo' + tag), sam = await signInAdmin('pls' + tag), kim = await signInAdmin('plk' + tag);
  const { space } = await (await post(owner, '/api/spaces', { kind: 'project', title: 'Fire Response API', date: '2026-10-30' })).json();
  await env.DB.batch([sam, kim].map((m) => env.DB.prepare("INSERT INTO members (space_id, user_id, role, joined_at, updated_at) VALUES (?, ?, 'editor', 1, 1)").bind(space.id, m.id)));
  await sharedItem(space.scope, 't1', { title: 'Endpoint', assignees: JSON.stringify([sam.id]), updated_by: owner.id });
  await sharedItem(space.scope, 't2', { title: 'Slides', assignees: JSON.stringify([sam.id, kim.id]), updated_by: owner.id });
  await env.DB.prepare("INSERT INTO marks (user_id, id, space_id, item_id, notes, created_at, updated_at) VALUES (?, ? || ':t1', ?, 't1', 'mine', 1, 1)").bind(sam.id, space.id, space.id).run();
  return { owner, sam, kim, space };
}
const assignees = async (scope, id) => JSON.parse((await one('SELECT assignees FROM items WHERE scope = ? AND id = ?', scope, id)).assignees);

describe('leaving or being removed from a project (spec §10, §13)', () => {
  it('strips you from every task, deletes your notes there, copies nothing', async () => {
    const { sam, kim, space } = await team();
    expect((await post(sam, `/api/spaces/${space.id}/leave`, { keepCopy: true })).status).toBe(204);
    expect(await assignees(space.scope, 't1')).toEqual([]);
    expect(await assignees(space.scope, 't2')).toEqual([kim.id]);
    expect(await one('SELECT deleted_at IS NOT NULL AS gone FROM marks WHERE user_id = ? AND space_id = ?', sam.id, space.id)).toEqual({ gone: 1 });
    expect(await one('SELECT deleted_at IS NOT NULL AS gone FROM space_prefs WHERE user_id = ? AND id = ?', sam.id, space.id)).toBeNull();
    expect(await one("SELECT count(*) AS n FROM items WHERE scope = 'u:' || ?", sam.id)).toEqual({ n: 0 });
    const verbs = (await env.DB.prepare("SELECT verb, subject FROM activity WHERE space_id = ? AND verb IN ('task.unassigned', 'member.left') ORDER BY seq").bind(space.id).all()).results;
    expect(verbs).toEqual([{ verb: 'task.unassigned', subject: 't1' }, { verb: 'member.left', subject: '' }]);
    expect((await post(sam, `/api/spaces/${space.id}/leave`, {})).status).toBe(404);
  });

  it('the owner removes a member the same way; the owner cannot leave', async () => {
    const { owner, kim, space } = await team();
    expect((await owner(`/api/spaces/${space.id}/members/${kim.id}`, { method: 'DELETE' })).status).toBe(204);
    expect(await assignees(space.scope, 't2')).toEqual([expect.stringMatching(/^u-pls/)]);
    expect(await one("SELECT subject_user FROM activity WHERE space_id = ? AND verb = 'member.removed'", space.id)).toEqual({ subject_user: kim.id });
    const res = await post(owner, `/api/spaces/${space.id}/leave`, {});
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'owner' });
  });
});

describe('deleting a project (spec §13)', () => {
  it('needs the owner and the typed title; tells everyone; takes every layer and invite with it', async () => {
    const { owner, sam, kim, space } = await team();
    const del = (api, confirm) => api(`/api/spaces/${space.id}`, { method: 'DELETE', body: { confirm } });
    expect((await del(sam, 'Fire Response API')).status).toBe(403);
    expect(await (await del(owner, 'fire')).json()).toEqual({ error: 'invalid', field: 'confirm' });
    await env.DB.prepare("INSERT INTO invites (space_id, user_id, role, created_at, expires_at) VALUES (?, 'u-plk' || ?, 'editor', 1, 2) ON CONFLICT DO NOTHING").bind(space.id, n).run();
    expect((await del(owner, 'Fire Response API')).status).toBe(204);
    expect(await one('SELECT deleted_at IS NOT NULL AS gone FROM spaces WHERE id = ?', space.id)).toEqual({ gone: 1 });
    expect(await one('SELECT count(*) AS n FROM marks WHERE space_id = ? AND deleted_at IS NULL', space.id)).toEqual({ n: 0 });
    expect(await one('SELECT count(*) AS n FROM space_prefs WHERE space_id = ? AND deleted_at IS NULL', space.id)).toEqual({ n: 0 });
    expect(await one('SELECT count(*) AS n FROM invites WHERE space_id = ?', space.id)).toEqual({ n: 0 });
    const told = (await env.DB.prepare("SELECT subject_user, json_extract(detail, '$.space') AS space FROM activity WHERE space_id = ? AND verb = 'space.deleted' ORDER BY subject_user").bind(space.id).all()).results;
    expect(told).toEqual([{ subject_user: kim.id, space: 'Fire Response API' }, { subject_user: sam.id, space: 'Fire Response API' }]);
    const page = await (await sam(`/api/sync?v=3&cursors=${encodeURIComponent(`u:${sam.id}:0,${space.scope}:0`)}&sv=0`)).json();
    expect(page.revoked).toEqual([space.scope]);
    expect((await del(owner, 'Fire Response API')).status).toBe(404);
  });
});
```

Append to `test/purge.test.js` (in its nightly `describe`):

```js
  it("takes a deleted task's marks with it, notes and all", async () => {
    const owner = await createUser('pgp5');
    const s = await makeSpace({ kind: 'project', members: { [owner]: 'owner' } });
    await sharedItem(s.scope, 't1', { deleted_at: Date.now() - 31 * DAY });
    await mark(owner, s.id, 't1', { notes: 'kept?' });
    await runNightly();
    expect(await one('SELECT count(*) AS n FROM marks WHERE space_id = ?', s.id)).toEqual({ n: 0 });
    expect(await one("SELECT count(*) AS n FROM items WHERE scope = ? AND id = 't1'", s.scope)).toEqual({ n: 0 });
  });
```

In `test/admin.test.js`, add a case beside the hand-on case:

```js
  it("strips a deleted account from its projects' assignees", async () => {
    const admin = await signInAdmin('boss-strip');
    const gone = await createUser('strip1'), stays = await createUser('strip2');
    await env.DB.batch([
      env.DB.prepare("INSERT INTO spaces (id, kind, created_at, updated_at) VALUES ('stripproj001', 'project', 1, 1)"),
      env.DB.prepare("INSERT INTO members (space_id, user_id, role, joined_at, updated_at) VALUES ('stripproj001', ?1, 'owner', 1, 1), ('stripproj001', ?2, 'editor', 2, 2)").bind(stays, gone),
      env.DB.prepare("INSERT INTO items (scope, id, type, title, date, status, assignees, created_at, updated_at) VALUES ('p:stripproj001', 't1', 'task', 'T', '2026-10-20', 'todo', ?, 1, 1)").bind(JSON.stringify([gone, stays])),
    ]);
    expect((await admin(`/api/admin/accounts/${gone}`, { method: 'DELETE', body: { confirm: 'strip1' } })).status).toBe(204);
    expect(JSON.parse((await env.DB.prepare("SELECT assignees FROM items WHERE scope = 'p:stripproj001'").first()).assignees)).toEqual([stays]);
  });
```

(The delete call's body is whatever the file's other account-deletion cases send; copy it from them.)

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run test/project-leave.test.js test/purge.test.js test/admin.test.js`
Expected: FAIL (`404` on leaving a project: Stage 5's `leave` answers classes only; the purge and strip cases).

- [ ] **Step 3: `leaveProject` and `deleteProject` (`worker/projects.js`)**

```js
/* ?1 the person, ?2 the space, ?3 who acts, ?4 now. */
const LIVE_MEMBER = "EXISTS (SELECT 1 FROM members AS lv WHERE lv.space_id = ?2 AND lv.user_id = ?1 AND lv.deleted_at IS NULL AND lv.role != 'owner')";
const ACTOR_OWNS = "EXISTS (SELECT 1 FROM members AS ow WHERE ow.space_id = ?2 AND ow.user_id = ?3 AND ow.role = 'owner' AND ow.deleted_at IS NULL)";

/** A person taken out of every task's assignees in the project `?2` (a task left with nobody is unassigned; the trigger says so). */
const STRIP = (live) => `UPDATE items SET assignees = (SELECT json_group_array(a.value) FROM json_each(items.assignees) AS a WHERE a.value != ?1),
    updated_by = ?3, updated_at = ?4, revision = revision + 1
  WHERE scope = 'p:' || ?2 AND deleted_at IS NULL AND EXISTS (SELECT 1 FROM json_each(items.assignees) AS a WHERE a.value = ?1) AND ${live}`;

/**
 * `userId` leaves the project, or is removed by its owner `actorId` (Decision 6), in one
 * batch: stripped from the assignees, their marks and prefs there soft-deleted, the
 * membership ended, member.left or member.removed. Nothing is copied. True when it ended now.
 */
export async function leaveProject(db, userId, spaceId, actorId = userId, now = Date.now()) {
  const live = actorId === userId ? LIVE_MEMBER : `${LIVE_MEMBER} AND ${ACTOR_OWNS}`;
  const v = [userId, spaceId, actorId, now];
  const results = await db.batch([
    db.prepare(STRIP(live)).bind(...v),
    db.prepare(`UPDATE marks SET deleted_at = ?4, updated_at = ?4, revision = revision + 1 WHERE user_id = ?1 AND space_id = ?2 AND deleted_at IS NULL AND ${live}`).bind(...v),
    db.prepare(`UPDATE space_prefs SET deleted_at = ?4, updated_at = ?4, revision = revision + 1 WHERE user_id = ?1 AND id = ?2 AND deleted_at IS NULL AND ${live}`).bind(...v),
    db.prepare(`UPDATE members SET deleted_at = ?4, updated_at = ?4, revision = revision + 1 WHERE space_id = ?2 AND user_id = ?1 AND ${live}`).bind(...v),
    db.prepare('SELECT changes() AS n'),
    touchSpace(db, spaceId, now, { ifChanged: true }),
    noteStmt(db, { spaceId, actorId, verb: actorId === userId ? 'member.left' : 'member.removed', subjectUser: actorId === userId ? '' : userId, now,
      when: 'EXISTS (SELECT 1 FROM members WHERE space_id = ?1 AND user_id = ?9 AND deleted_at = ?8)', binds: [userId] }),
  ]);
  return results[4].results[0].n > 0;
}

/**
 * The owner deletes the project (Decision 7), archived or not, with its title typed as
 * `confirm`: space.deleted about each other live member, every member's marks and prefs
 * there, its invites, then the space. 400 confirm; 403 for anyone but the owner.
 */
export async function deleteProject(db, userId, spaceId, confirm, now = Date.now()) {
  const me = await assertKeeper(db, userId, spaceId);
  if (me.kind !== 'project') throw new HttpError(404, { error: 'not_found' });
  const row = await db.prepare("SELECT title FROM items WHERE scope = ? AND id = 'project'").bind('p:' + spaceId).first();
  if (typeof confirm !== 'string' || confirm.trim() !== row?.title) throw bad('confirm');
  const g = keeperGuard(spaceId, userId);
  await db.batch([
    /* first, while the space and its name are still live; numbered, so written out rather than keeperGuard's plain ?s */
    db.prepare(`INSERT INTO activity (space_id, actor_id, verb, subject, subject_user, detail, bucket, at)
      SELECT ?1, ?2, 'space.deleted', '', m.user_id, json_object('by', ${PERSON('?2')}, 'whom', ${PERSON('m.user_id')}, 'space', ${SPACE_NAME('?1')}), ?3 / ${BUCKET_MS}, ?3
      FROM members AS m WHERE m.space_id = ?1 AND m.user_id != ?2 AND m.deleted_at IS NULL AND ${OWNER_HERE}
      ON CONFLICT (space_id, actor_id, verb, subject, subject_user, bucket) DO UPDATE SET at = excluded.at`)
      .bind(spaceId, userId, now),
    ...['marks', 'space_prefs'].map((t) => db.prepare(`UPDATE ${t} SET deleted_at = ?, updated_at = ?, revision = revision + 1 WHERE space_id = ? AND deleted_at IS NULL AND ${g.sql}`)
      .bind(now, now, spaceId, ...g.binds)),
    db.prepare(`DELETE FROM invites WHERE space_id = ? AND ${g.sql}`).bind(spaceId, ...g.binds),
    db.prepare(`UPDATE spaces SET deleted_at = ?, updated_at = ?, revision = ${NEXT_SPACE_REVISION} WHERE id = ? AND deleted_at IS NULL AND ${g.sql}`)
      .bind(now, now, spaceId, ...g.binds),
  ]);
}
```

Above `leaveProject`, beside `LIVE_MEMBER`, add the two helpers the first statement uses. `OWNER_HERE` is `keeperGuard`'s SQL (Stage 5 plan, Task 2 Step 3) with the space and the user numbered `?1` and `?2`, because a plain `?` in a statement that also uses `?1`–`?3` would be numbered `?4` by SQLite; check it against `worker/access.js` and keep the two the same:

```js
/* The owner of the live space ?1 is ?2 (keeperGuard, numbered). */
const OWNER_HERE = `EXISTS (SELECT 1 FROM members AS gm JOIN spaces AS gs ON gs.id = gm.space_id
  WHERE gm.space_id = ?1 AND gm.user_id = ?2 AND gm.deleted_at IS NULL AND gs.deleted_at IS NULL AND gm.role = 'owner')`;
/* A person's display name, else username; `id` is SQL. */
const PERSON = (id) => `(SELECT COALESCE(NULLIF(u.display_name, ''), u.username) FROM users AS u WHERE u.id = ${id})`;
```

- [ ] **Step 4: Hand projects to them (`worker/leaving.js`, `worker/classes.js`)**

In `worker/leaving.js`, import `leaveProject` from `./projects.js`. In `leave` (Stage 5 plan, Task 2), replace `if (me.kind !== 'class') throw new HttpError(404, { error: 'not_found' });` with the owner check first and then:

```js
  if (me.role === 'owner') throw new HttpError(403, { error: 'owner' });
  if (me.kind === 'project') {
    if (!(await leaveProject(db, userId, spaceId, userId, now))) throw new HttpError(404, { error: 'not_found' });
    return;
  }
```

In `removeMember`, replace its class-only check with:

```js
  if (targetId === userId) throw new HttpError(403, { error: 'forbidden' });
  if (me.kind === 'project') {
    if (await leaveProject(db, targetId, spaceId, userId, now)) return;
    const them = await roleOf(db, targetId, spaceId);
    throw them ? new HttpError(403, { error: 'forbidden' }) : new HttpError(404, { error: 'not_found' });
  }
```

In `handOnStmts` (Stage 5 plan, Task 6), add as the first statement of `stmts`:

```js
    db.prepare(`UPDATE items SET assignees = (SELECT json_group_array(a.value) FROM json_each(items.assignees) AS a WHERE a.value != ?1),
        updated_by = ?1, updated_at = ?2, revision = revision + 1
      WHERE scope IN (SELECT 'p:' || space_id FROM members WHERE user_id = ?1 AND deleted_at IS NULL) AND deleted_at IS NULL
        AND EXISTS (SELECT 1 FROM json_each(items.assignees) AS a WHERE a.value = ?1)`).bind(userId, now),
```

In `worker/classes.js`, the space `DELETE` route (Stage 5 plan, Task 3) reads the body once and dispatches:

```js
  ['DELETE', route(`spaces/${SID}`), async ({ request, env, params: [sid] }) => {
    const userId = await requireUser(request, env);
    const body = await readJson(request);
    const kind = (await env.DB.prepare('SELECT kind FROM spaces WHERE id = ? AND deleted_at IS NULL').bind(sid).first())?.kind;
    if (kind === 'project') await deleteProject(env.DB, userId, sid, body.confirm);
    else await deleteClass(env.DB, userId, sid, keepOf(body.keepCopy));
    return done();
  }],
```

(import `deleteProject`). Someone outside the space still gets `404` from `assertKeeper`.

- [ ] **Step 5: The purge's project marks (`worker/db.js`)**

In `purgeTombstones` (Stage 5 plan, Task 5 Step 4), the marks statement becomes:

```js
    db.prepare(`DELETE FROM marks WHERE (NOT ${MEANINGFUL('marks')} OR EXISTS (SELECT 1 FROM spaces AS ps WHERE ps.id = marks.space_id AND ps.kind = 'project'))
      AND EXISTS (SELECT 1 FROM items AS i WHERE i.scope IN ('c:' || marks.space_id, 'p:' || marks.space_id) AND i.id = marks.item_id
        AND i.deleted_at IS NOT NULL AND i.deleted_at < ?)`).bind(before),
```

and the items statement's exemption applies to classes only: `(scope NOT GLOB 'c:*' OR NOT EXISTS (SELECT 1 FROM marks AS m …))` in place of `(scope GLOB 'u:*' OR NOT EXISTS (…))`.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run test/project-leave.test.js test/purge.test.js test/admin.test.js test/leaving.test.js test/space-admin.test.js test/activity-routes.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add worker/projects.js worker/leaving.js worker/classes.js worker/db.js test/project-leave.test.js test/purge.test.js test/admin.test.js
git commit -m "Stage 8: leave, remove and delete a project; account deletion and the purge clear projects' assignees and notes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The client's project data (`src/data/projects.ts`)

**Files:**
- Create: `src/data/projects.ts`
- Modify: `src/core/types.ts`, `src/core/api.ts`, `src/core/sync.ts`, `src/data/effective.ts`, `src/data/classes.ts`, `src/data/inbox.ts`, `src/data/overlay.ts`
- Test: `src/data/projects.test.ts`, `src/data/effective.test.ts`, `src/data/inbox.test.ts`

- [ ] **Step 1: Write the failing tests**

`src/data/projects.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { canClaim, canEdit, canFinish, linkable, tasksOf } from "./projects"
import type { SharedItem, Space } from "./types"

const space = (o: Partial<Space> = {}): Space => ({ id: "fire00000001", scope: "p:fire00000001", kind: "project", role: "member", archived: false, name: "Fire", parent: null, revision: 1, members: [], ...o })
const task = (o: Partial<SharedItem>): SharedItem => ({
    id: "t", scope: "p:fire00000001", type: "task", title: "T", courseId: null, date: "2026-10-20", start: "", end: "", where: "", status: "todo", grade: null, weight: null,
    notes: "", checklist: [], links: [], recur: null, weekday: null, recurUntil: null, dept: "", completedAt: null, classId: null,
    updatedBy: null, assignees: [], completedBy: null, revision: 1, ...o,
} as SharedItem)

describe("who may do what with a task (spec §5)", () => {
    it("editors edit and finish anything; members finish their own or everyone's, and claim the unassigned", () => {
        const ed = space({ role: "editor" }), mem = space()
        expect(canEdit(ed)).toBe(true)
        expect(canEdit(mem)).toBe(false)
        expect(canFinish(ed, task({ assignees: ["u-x"] }), "u-me")).toBe(true)
        expect(canFinish(mem, task({ assignees: ["u-x"] }), "u-me")).toBe(false)
        expect(canFinish(mem, task({ assignees: ["u-me"] }), "u-me")).toBe(true)
        expect(canFinish(mem, task({ assignees: ["*"] }), "u-me")).toBe(true)
        expect(canClaim(mem, task({}), "u-me")).toBe("claim")
        expect(canClaim(mem, task({ assignees: ["u-me", "u-x"] }), "u-me")).toBe("unclaim")
        expect(canClaim(mem, task({ assignees: ["u-x"] }), "u-me")).toBe(null)
        expect(canFinish(space({ role: "owner", archived: true }), task({}), "u-me")).toBe(false)
    })
    it("lists live tasks by date, then title", () => {
        const items = [task({ id: "b", date: "2026-10-21", title: "B" }), task({ id: "a", date: "2026-10-21", title: "A" }), task({ id: "z", date: "2026-10-19" }),
            task({ id: "gone", deletedAt: 5 }), task({ id: "project", type: "project" }), task({ id: "other", scope: "p:other0000001" })]
        expect(tasksOf("fire00000001", items).map((t) => t.id)).toEqual(["z", "a", "b"])
    })
    it("offers the live assignments, labs and projects of your classes to link to", () => {
        const items = [
            task({ id: "a1", scope: "c:webs00000001", type: "assignment", title: "REST API", courseId: "web" }),
            task({ id: "q1", scope: "c:webs00000001", type: "quiz", title: "Quiz", courseId: "web" }),
            task({ id: "a2", scope: "c:webs00000001", type: "assignment", title: "Gone", courseId: "web", deletedAt: 3 }),
        ]
        expect(linkable(items, [{ scope: "c:webs00000001", name: "Web Services" }])).toEqual([
            { space: "webs00000001", item: "a1", label: "Web Services · REST API", date: "2026-10-20" },
        ])
    })
})
```

Append to `src/data/effective.test.ts`:

```ts
it("keeps project rows out of the views until Stage 9 (PROJECTS_IN_VIEWS)", () => {
    const own = [] as Item[]
    const shared = [{ ...someClassItem, scope: "p:fire00000001", id: "t1", type: "task", courseId: null }] as (Item & { scope: string })[]
    expect(mergeItems(own, shared, true)).toEqual([])
})
```

(`someClassItem`: the class item fixture the file already uses; `grep -n "scope: \"c:" src/data/effective.test.ts` finds it.)

Append to `src/data/inbox.test.ts`:

```ts
it("reads an unlink", () => {
    expect(say(row({ verb: "space.linked", new: null, space: "Fire", detail: { by: "Gabriel" } }), "u-me")).toBe("Gabriel unlinked Fire from its assignment")
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/data/projects.test.ts src/data/effective.test.ts src/data/inbox.test.ts`
Expected: FAIL (no `./projects`; the project row is in the views; the unlink wording).

- [ ] **Step 3: Types and API**

`src/core/types.ts`, beside `SpaceSummary`:

```ts
/** A class assignment a project belongs to: its space and item ids (spec §10). */
export interface ParentRef { space: string; item: string }
```

`src/core/api.ts` (import `ParentRef`): `spaces.create`'s body type becomes `{ kind: 'class'; course?: Record<string, unknown>; convertCourseId?: string; items?: string[] } | { kind: 'project'; title: string; date?: string; parent?: ParentRef }`, and add to `spaces`:

```ts
    link: (sid: string, parent: ParentRef | null) => empty(request('POST', `/api/spaces/${sid}/link`, { parent })),
    deleteProject: (sid: string, confirm: string) => empty(request('DELETE', `/api/spaces/${sid}`, { confirm })),
```

`src/core/sync.ts` `reasonFor`: before the `archived` line, `if (body.error === 'limit') return 'A project holds 200 tasks at most.';`.

- [ ] **Step 4: `PROJECTS_IN_VIEWS` (`src/data/effective.ts`)**

Below `SHARED_IN_VIEWS`:

```ts
/** Project rows join the views in Stage 9; until then only the project sheet shows them. */
export const PROJECTS_IN_VIEWS = false
```

In `mergeItems`'s loop, first line: `if (!PROJECTS_IN_VIEWS && it.scope.startsWith("p:")) continue`.

- [ ] **Step 5: Write `src/data/projects.ts`**

```ts
// Team projects on this device (spec §10, §15), for admins until Stage 10: making one, its
// tasks (add, edit, assign, claim, complete, delete), linking it to a class assignment,
// leaving and deleting it. Its rows arrive and leave by sync like a class's, and its tasks
// are written with store.saveShared, so pending edits, field merge and Saved copies work as
// for any shared row. The Week and the other views show projects from Stage 9.

import { api } from "@/core/api"
import * as store from "@/core/store"
import { data } from "@/core/store"
import * as sync from "@/core/sync"
import { uid } from "@/core/model"
import { download } from "./classes"
import { closeSheet, openSheet } from "./overlay"
import { toast } from "./toast"
import type { ParentRef, SharedItem, Space } from "./types"

/** Projects are for admins until Stage 10 (Stage 8 plan, Decision 1). */
export const PROJECTS_ADMIN_ONLY = true
export const projectsShown = (): boolean => !PROJECTS_ADMIN_ONLY || !!data.profile?.isAdmin
export const TASK_LIMIT = 200

export type ProjectTab = "tasks" | "members" | "activity"
export const openProject = (spaceId: string, tab: ProjectTab = "tasks") => openSheet({ kind: "project", spaceId, tab })
export const openNewProject = (parent: ParentRef | null = null) => openSheet({ kind: "new-project", parent })

export const scopeOf = (spaceId: string) => "p:" + spaceId
/** The project's own item: its title, due date and description. */
export const projectItem = (spaceId: string, items: SharedItem[] = data.shared_items): SharedItem | null =>
    items.find((i) => i.scope === scopeOf(spaceId) && i.id === "project") ?? null
/** A project's live tasks, by date, then title. */
export const tasksOf = (spaceId: string, items: SharedItem[] = data.shared_items): SharedItem[] =>
    items.filter((i) => i.scope === scopeOf(spaceId) && i.type === "task" && !i.deletedAt)
        .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title))

/* ── who may do what (spec §5); the Worker checks the same ── */

export const canEdit = (s: Space | null | undefined): boolean => !!s && !s.archived && s.role !== "member"
const assignedTo = (t: SharedItem, me: string) => t.assignees.includes(me) || t.assignees.includes("*")
export const canFinish = (s: Space | null | undefined, t: SharedItem, me: string): boolean => !!s && !s.archived && (s.role !== "member" || assignedTo(t, me))
/** "claim" an unassigned task, "unclaim" one you are on, or null. */
export function canClaim(s: Space | null | undefined, t: SharedItem, me: string): "claim" | "unclaim" | null {
    if (!s || s.archived) return null
    if (!t.assignees.length) return "claim"
    return t.assignees.includes(me) ? "unclaim" : null
}

/* ── tasks ── */

const write = (t: SharedItem) => store.saveShared("shared_items", t as unknown as Parameters<typeof store.saveShared>[1])

/** A new task (editors): unassigned, not done. False when the project already holds 200. */
export async function addTask(spaceId: string, title: string, date: string): Promise<boolean> {
    if (tasksOf(spaceId).length >= TASK_LIMIT) { toast("A project holds 200 tasks at most."); return false }
    await write({
        id: uid(), scope: scopeOf(spaceId), type: "task", title: title.trim() || "Untitled", courseId: null, date, start: "", end: "", where: "",
        status: "todo", grade: null, weight: null, notes: "", checklist: [], links: [], recur: null, weekday: null, recurUntil: null, dept: "",
        completedAt: null, classId: null, updatedBy: null, assignees: [], completedBy: null, revision: 0,
    } as unknown as SharedItem)
    return true
}
/** An editor's change to a task: title, date, times, notes, assignees. */
export const saveTask = (t: SharedItem, patch: Partial<SharedItem>) => write({ ...t, ...patch })
/** Done or not done, for the whole team (spec §10); whoever completes it is named by the Worker. */
export const setDone = (t: SharedItem, done: boolean) => write({ ...t, status: done ? "done" : "todo", completedAt: done ? t.completedAt ?? Date.now() : null })
/** Take an unassigned task, or step off one. */
export const claim = (t: SharedItem, me: string, on: boolean) => write({ ...t, assignees: on ? [me] : t.assignees.filter((u) => u !== me) })
export const deleteTask = (t: SharedItem) => store.removeShared("shared_items", t.scope, t.id)

/** Who a task is with, in words: "Everyone", names, or "Nobody yet". */
export function assigneeNames(t: SharedItem, s: Space | null | undefined, me: string): string {
    if (t.assignees.includes("*")) return "Everyone"
    if (!t.assignees.length) return "Nobody yet"
    return t.assignees.map((u) => (u === me ? "You" : s?.members.find((m) => m.userId === u)?.name ?? "A former member")).join(", ")
}

/* ── the project itself ── */

/** Class assignments, labs and projects you can see, to link a project to (spec §10). */
export function linkable(items: SharedItem[] = data.shared_items, spaces: { scope: string; name: string }[] = data.spaces): { space: string; item: string; label: string; date: string }[] {
    const names = new Map(spaces.filter((s) => s.scope.startsWith("c:")).map((s) => [s.scope, s.name]))
    return items.filter((i) => names.has(i.scope) && !i.deletedAt && ["assignment", "lab", "project"].includes(i.type))
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((i) => ({ space: i.scope.slice(2), item: i.id, label: names.get(i.scope) + " · " + i.title, date: i.date }))
}

/** Make a project; it downloads, then its sheet opens. */
export async function makeProject(title: string, date: string | null, parent: ParentRef | null): Promise<void> {
    const space = await api.spaces.create({ kind: "project", title, ...(date ? { date } : {}), ...(parent ? { parent } : {}) })
    await download(space.id)
    openProject(space.id)
}
/** The owner links the project to an assignment (its date follows) or unlinks it. */
export async function link(spaceId: string, parent: ParentRef | null): Promise<void> {
    await api.spaces.link(spaceId, parent)
    await sync.syncNow()
}
/** The owner deletes the project, typing its title; it leaves every member's device with their next sync. */
export async function removeProject(spaceId: string, confirm: string): Promise<void> {
    await api.spaces.deleteProject(spaceId, confirm)
    closeSheet()
    await sync.syncNow()
}
/** Leave the project: your tasks become unassigned and your notes there go. */
export async function leaveProject(spaceId: string): Promise<void> {
    await api.spaces.leave(spaceId, false)
    closeSheet()
    await sync.syncNow()
}
```

`api.spaces.leave(sid, keepCopy)` is the Stage 5 plan's (Task 8); if its signature differs, follow it.

- [ ] **Step 6: `landed`, words, the inbox, the sheets**

`src/data/classes.ts`, `landed` becomes:

```ts
/** The space, its course (a class) or its project item (a project), and your prefs for it are on this device. */
export const landed = (id: string): boolean => {
    const s = data.spaces.find((x) => x.id === id)
    if (!s || !(data.space_prefs ?? []).some((p) => p.id === id)) return false
    return s.kind === "project" ? data.shared_items.some((i) => i.scope === s.scope && i.id === "project") : data.shared_courses.some((c) => c.scope === s.scope)
}
```

`messageFor`: `not_admin` becomes ``return name ? `${name} can't join team projects yet: they're open to admins only for now.` : "Team projects are open to admins only for now."``; add `if (code === "invalid" && e.body?.field === "parent") return "That assignment isn't in a class you're in."` and `if (code === "invalid" && e.body?.field === "confirm") return "Type the project's name exactly to delete it."` before the generic `invalid` line; `owner` (Stage 5) stays.

`src/data/inbox.ts`: in `describe`, `case "space.linked": return r.new === null ? `${by} unlinked ${r.space} from its assignment` : …` (keep the linked wording). In `openRow`, before the class line: `if (r.kind === "project" && data.spaces.some((s) => s.id === r.spaceId)) { openProject(r.spaceId); return }` (import `openProject` from `./projects`).

`src/data/overlay.ts`: import `type { ParentRef }` and `type { ProjectTab } from "./projects"`; add `| { kind: "project"; spaceId: string; tab: ProjectTab }` and `| { kind: "new-project"; parent: ParentRef | null }` to `SheetState`.

- [ ] **Step 7: Run the tests**

Run: `npx vitest run src/data/projects.test.ts src/data/effective.test.ts src/data/inbox.test.ts src/data/classes.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/core/types.ts src/core/api.ts src/core/sync.ts src/data/effective.ts src/data/projects.ts src/data/projects.test.ts src/data/effective.test.ts src/data/classes.ts src/data/inbox.ts src/data/inbox.test.ts src/data/overlay.ts
git commit -m "Stage 8: projects on the client: tasks, permissions, make, link, leave, delete; kept out of the views

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: New team project; the Projects group; joining a project

**Files:**
- Create: `src/components/sheet/new-project-sheet.tsx`, `src/components/sidebar-projects.tsx`
- Modify: `src/components/shared-glyph.tsx`, `src/components/sidebar-classes.tsx`, `src/components/sidebar.tsx`, `src/components/sheet/join-sheet.tsx`, `src/components/sheet/sheet.tsx`
- Test: `src/components/sheet/project.test.tsx`

- [ ] **Step 1: Write the failing test**

`src/components/sheet/project.test.tsx` (reuse the setup of `src/components/sheet/classes.test.tsx`: its signed-in admin profile, fake API and store seeding; read its first 80 lines):

```tsx
describe("team projects (spec §10, §15)", () => {
    it("+ New offers a team project to admins, and the sheet makes one under an assignment", async () => {
        // seed: an admin profile; a class space c:webs00000001 'Web Services' with item a1 'REST API Project' (assignment, 2026-10-15)
        // fake: POST /api/spaces → {space: {id: 'fire00000001', scope: 'p:fire00000001', kind: 'project', name: 'Fire Response API', role: 'owner', members: 1}}
        //       then the next sync page brings the space, its 'project' item and your prefs
        render(<><Sidebar /><Sheet /></>)
        fireEvent.click(screen.getByRole("button", { name: "+ New" }))
        fireEvent.click(screen.getByRole("menuitem", { name: /New team project/ }))
        fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Fire Response API" } })
        fireEvent.change(screen.getByLabelText("Belongs to"), { target: { value: "webs00000001/a1" } })
        expect((screen.getByLabelText("Due") as HTMLInputElement).value).toBe("2026-10-15")
        fireEvent.click(screen.getByRole("button", { name: "Make the project" }))
        // the fake saw POST /api/spaces {kind:'project', title:'Fire Response API', date:'2026-10-15', parent:{space:'webs00000001', item:'a1'}}
        expect(await screen.findByRole("heading", { name: "Fire Response API" })).toBeTruthy()
        expect(within(screen.getByRole("region", { name: "Projects" })).getByRole("button", { name: /Fire Response API/ })).toBeTruthy()
    })

    it("hides it all from someone who is not an admin", () => {
        // seed: a non-admin profile
        render(<Sidebar />)
        fireEvent.click(screen.getByRole("button", { name: "+ New" }))
        expect(screen.queryByRole("menuitem", { name: /New team project/ })).toBeNull()
        expect(screen.queryByRole("region", { name: "Projects" })).toBeNull()
    })
})
```

Fill in seeds and fakes with `classes.test.tsx`'s helpers, then delete the comments. (Stage 6 replaced the sidebar's "+ New course" button with the menu for everyone; if the button's name differs, use it.)

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/components/sheet/project.test.tsx`
Expected: FAIL (no menu item).

- [ ] **Step 3: The team glyph (`src/components/shared-glyph.tsx`)**

```tsx
/** The team glyph of a project (spec §9, §15): three heads. */
export const TeamGlyph = ({ className }: { className?: string }) => (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className={cn("size-3.5 shrink-0", className)}>
        <circle cx="8" cy="4.6" r="2" />
        <circle cx="3.6" cy="7" r="1.6" />
        <circle cx="12.4" cy="7" r="1.6" />
        <path d="M4.5 13.5c.4-2.2 1.8-3.4 3.5-3.4s3.1 1.2 3.5 3.4M1 12.6c.3-1.5 1.2-2.4 2.6-2.4M15 12.6c-.3-1.5-1.2-2.4-2.6-2.4" />
    </svg>
)
```

Update the file's header comment: "The two-person glyph of a shared class and the team glyph of a project (spec §15)".

- [ ] **Step 4: The + menu (`src/components/sidebar-classes.tsx`)**

Turn `ITEMS` into a function so the project line shows for admins only:

```tsx
const items = (projects: boolean): readonly [string, string, () => void][] => [
    ["New course", "Only you", () => openCourse(null)],
    ["New shared class", "Blank, or convert a course", openNewClass],
    ...(projects ? [["New team project", "Tasks shared with a team", () => openNewProject()] as [string, string, () => void]] : []),
    ["Join with code", "8 characters from a classmate", () => openJoin()],
]
```

In `NewMenu`: `const list = items(projectsShown())` (import `openNewProject, projectsShown` from `@/data/projects`; call `useProfile()` so the menu redraws when the profile arrives) and map `list` where it mapped `ITEMS`.

- [ ] **Step 5: The Projects group (`src/components/sidebar-projects.tsx`)**

```tsx
// The sidebar's Projects group (spec §15), for admins until Stage 10: a row per team project
// you are in, opening its sheet. Stage 9 adds each one's progress ring and its eye.

import { useProfile, useSpaces } from "@/data/store"
import { openProject, projectsShown } from "@/data/projects"
import { TeamGlyph } from "./shared-glyph"
import { Heading } from "./sidebar-parts"

export function ProjectsGroup() {
    useProfile()
    const projects = useSpaces().filter((s) => s.kind === "project").sort((a, b) => a.name.localeCompare(b.name))
    if (!projectsShown() || !projects.length) return null
    return (
        <section aria-label="Projects">
            <Heading>Projects</Heading>
            <div className="flex flex-col gap-px">
                {projects.map((p) => (
                    <button key={p.id} type="button" onClick={() => openProject(p.id)}
                        className="flex w-full min-w-0 items-center gap-2.5 rounded-[9px] border-0 bg-transparent px-2 py-1.5 text-left text-[13px] font-medium text-ink-2 hover:bg-muted hover:text-foreground">
                        <span aria-hidden="true" className="text-muted-foreground"><TeamGlyph /></span>
                        <span className="min-w-0 truncate">{p.name}</span>
                        {p.archived && <span className="shrink-0 text-[11px] text-muted-foreground">Archived</span>}
                    </button>
                ))}
            </div>
        </section>
    )
}
```

Check `Heading` is exported from `./sidebar-parts` (`grep -n "export function Heading\|export const Heading" src/components/sidebar-parts.tsx`); if it lives in `sidebar.tsx`, export it from there instead. In `src/components/sidebar.tsx`, render `<ProjectsGroup />` right after the Courses section where the sidebar composes its sections (`grep -n "<Courses" src/components/sidebar.tsx`).

- [ ] **Step 6: `src/components/sheet/new-project-sheet.tsx`**

```tsx
// New team project (spec §10, §15, §20), for admins until Stage 10: a name, a due date, and
// optionally the class assignment it belongs to (its date fills in the due date). You become
// its owner; teammates you invite join as editors.

import { useId, useState } from "react"
import { today } from "@/core/dates"
import { closeSheet } from "@/data/overlay"
import { messageFor } from "@/data/classes"
import { linkable, makeProject } from "@/data/projects"
import { useSharedItems, useSpaces } from "@/data/store"
import { useMaintenance } from "@/data/maintenance"
import { MaintenanceBar, MaintenancePage } from "@/components/maintenance"
import type { ParentRef } from "@/data/types"
import { Button, Fields, Label, Note, Select, SheetBody, SheetFoot, SheetHead, TextInput } from "./fields"

export function NewProjectSheet({ parent }: { parent: ParentRef | null }) {
    const maintenance = useMaintenance("classes")
    if (maintenance !== "blocked") return <NewProject parent={parent} bar={maintenance === "admin"} />
    return (
        <>
            <SheetHead kind="New team project" onClose={closeSheet} />
            <SheetBody><MaintenancePage feature="classes" inSheet /></SheetBody>
        </>
    )
}

function NewProject({ parent, bar }: { parent: ParentRef | null; bar: boolean }) {
    const options = linkable(useSharedItems(), useSpaces())
    const [title, setTitle] = useState("")
    const [of, setOf] = useState(parent ? parent.space + "/" + parent.item : "")
    const picked = options.find((o) => o.space + "/" + o.item === of) ?? null
    const [date, setDate] = useState(picked?.date ?? today())
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState("")
    const f = useId()

    const go = async () => {
        if (!title.trim()) { setErr("Give it a name."); return }
        setBusy(true); setErr("")
        try { await makeProject(title.trim(), date, picked ? { space: picked.space, item: picked.item } : null) }
        catch (e) { setErr(messageFor(e)); setBusy(false) }
    }

    return (
        <>
            <SheetHead kind="New team project" onClose={closeSheet} />
            <SheetBody>
                {bar && <MaintenanceBar className="mb-0" />}
                <h2 className="m-0 text-[22px] leading-[1.22] font-[750] tracking-[-.02em]">New team project</h2>
                <Note>You become its owner. Teammates you invite join as editors; anyone can claim a task nobody has.</Note>
                <Fields>
                    <Label htmlFor={f + "name"}>Name</Label>
                    <TextInput id={f + "name"} value={title} maxLength={140} placeholder="Fire Response API" onChange={(e) => setTitle(e.target.value)} />
                    <Label htmlFor={f + "of"}>Belongs to</Label>
                    <Select id={f + "of"} value={of} onChange={(e) => {
                        setOf(e.target.value)
                        const o = options.find((x) => x.space + "/" + x.item === e.target.value)
                        if (o) setDate(o.date)
                    }}>
                        <option value="">No class assignment</option>
                        {options.map((o) => <option key={o.space + "/" + o.item} value={o.space + "/" + o.item}>{o.label}</option>)}
                    </Select>
                    <Label htmlFor={f + "due"}>Due</Label>
                    <TextInput id={f + "due"} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </Fields>
                {picked && <Note>The team's own deadline. The assignment's date, weight and your grade stay on the class's item.</Note>}
                {err && <Note tone="bad">{err}</Note>}
            </SheetBody>
            <SheetFoot hint="Needs a connection">
                <Button variant="ghost" onClick={closeSheet}>Cancel</Button>
                <Button disabled={busy || !date} onClick={() => void go()}>{busy ? "Making…" : "Make the project"}</Button>
            </SheetFoot>
        </>
    )
}
```

If `TextInput` does not pass `type` through, use the date field the item sheet uses (`grep -n "type=\"date\"\|DatePicker" src/components/sheet/item-sheet.tsx`).

- [ ] **Step 7: Joining a project (`src/components/sheet/join-sheet.tsx`)**

In the `loading` stage, the second line reads `The ${stage.space.kind === "project" ? "project's tasks land" : "class's course and items land"} on this device, so they work offline.` In `Joined`, first line of the component: `if (space.kind === "project") return <JoinedProject space={space} here={here} />`, with:

```tsx
function JoinedProject({ space, here }: { space: SpaceSummary; here: boolean }) {
    return (
        <>
            <SheetHead kind="Joined" onClose={closeSheet} />
            <SheetBody>
                <h2 className={TITLE}>You're in {space.name}</h2>
                {!here && <Note>It finishes downloading with the next sync.</Note>}
            </SheetBody>
            <SheetFoot hint="">
                <Button onClick={() => openProject(space.id)}>Open the project</Button>
            </SheetFoot>
        </>
    )
}
```

(import `openProject`). The code screen's heading becomes "Join with a code" (already) and its note "Eight characters from the owner of a class or project."

- [ ] **Step 8: Route the sheets (`src/components/sheet/sheet.tsx`)**

Labels: `if (s.kind === "project") return "Project"`, `if (s.kind === "new-project") return "New team project"`. Body: `{shown?.kind === "new-project" && <NewProjectSheet parent={shown.parent} />}` and `{shown?.kind === "project" && <ProjectSheet key={shown.spaceId} spaceId={shown.spaceId} tab={shown.tab} />}`, importing them as the file imports the class sheets (`ProjectSheet` arrives in Task 6: add its line then, or add a one-line placeholder export there now and fill it in Task 6).

- [ ] **Step 9: Run the tests**

Run: `npx vitest run src/components/sheet/project.test.tsx src/components/sidebar.test.tsx src/components/sheet/classes.test.tsx && npm run typecheck`
Expected: the first test fails only at the heading line (the project sheet is Task 6); the rest PASS. Mark that line `// Task 6` and move on.

- [ ] **Step 10: Commit**

```bash
git add src/components/shared-glyph.tsx src/components/sidebar-classes.tsx src/components/sidebar-projects.tsx src/components/sidebar.tsx src/components/sheet/new-project-sheet.tsx src/components/sheet/join-sheet.tsx src/components/sheet/sheet.tsx src/components/sheet/project.test.tsx
git commit -m "Stage 8: New team project, the Projects group, and joining a project

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The project sheet

**Files:**
- Create: `src/components/sheet/project-sheet.tsx`, `src/components/sheet/task-row.tsx`
- Modify: `src/components/sheet/members-tab.tsx` (wording), `src/components/sheet/sheet.tsx`
- Test: `src/components/sheet/project.test.tsx` (new cases; Task 5's heading line passes)

- [ ] **Step 1: Write the failing tests** (append to `project.test.tsx`)

```tsx
it("an editor adds a task, assigns it, and completes it", async () => {
    // seed: project p:fire00000001 'Fire Response API' (role editor), members: you (u-me, 'You'), u-sam 'Sam'
    openProject("fire00000001")
    fireEvent.change(await screen.findByLabelText("New task"), { target: { value: "Create incidents endpoint" } })
    fireEvent.click(screen.getByRole("button", { name: "Add" }))
    const row = await screen.findByRole("listitem", { name: /Create incidents endpoint/ })
    expect(within(row).getByText("Nobody yet")).toBeTruthy()
    fireEvent.click(within(row).getByRole("button", { name: "Edit Create incidents endpoint" }))
    fireEvent.click(screen.getByRole("checkbox", { name: "Sam" }))
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    expect(await within(row).findByText("Sam")).toBeTruthy()
    fireEvent.click(within(row).getByRole("checkbox", { name: "Done: Create incidents endpoint" }))
    // the store holds the task with status 'done' and a pending put whose changed names status and completedAt
})

it("a member claims an unassigned task, completes their own, and cannot edit", async () => {
    // seed: role member; tasks t1 (assignees []), t2 (assignees ['u-me']), t3 (assignees ['u-sam'])
    openProject("fire00000001")
    const t1 = await screen.findByRole("listitem", { name: /t1/ })
    fireEvent.click(within(t1).getByRole("button", { name: "Claim" }))
    expect(await within(t1).findByText("You")).toBeTruthy()
    expect(within(screen.getByRole("listitem", { name: /t3/ })).getByRole("checkbox")).toHaveProperty("disabled", true)
    expect(screen.queryByRole("button", { name: /^Edit / })).toBeNull()
    expect(screen.queryByLabelText("New task")).toBeNull()
})

it("the owner deletes it only by typing its name", async () => {
    // seed: role owner; fake: DELETE /api/spaces/fire00000001 → 204
    openProject("fire00000001")
    fireEvent.click(await screen.findByRole("button", { name: "Delete the project…" }))
    const go = screen.getByRole("button", { name: "Delete for everyone" })
    expect(go).toHaveProperty("disabled", true)
    fireEvent.change(screen.getByLabelText("Type Fire Response API to confirm"), { target: { value: "Fire Response API" } })
    fireEvent.click(go)
    // the fake saw DELETE with {confirm: 'Fire Response API'}; the sheet closed
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/components/sheet/project.test.tsx`
Expected: FAIL (no project sheet).

- [ ] **Step 3: `src/components/sheet/task-row.tsx`**

```tsx
// One task in the project sheet (spec §10, §15): done, title, date, who has it, and Claim;
// owners and editors edit it in place (title, date, assignees, Delete).

import { useId, useState } from "react"
import { cn } from "@/lib/utils"
import { dayMonth } from "@/core/dates"
import { assigneeNames, canClaim, canEdit, canFinish, claim, deleteTask, saveTask, setDone } from "@/data/projects"
import type { SharedItem, Space } from "@/data/types"
import { Button, Checkbox, TextInput } from "./fields"

export function TaskRow({ task, space, me }: { task: SharedItem; space: Space; me: string }) {
    const [editing, setEditing] = useState(false)
    const done = task.status === "done"
    const claimAct = canClaim(space, task, me)
    return (
        <li aria-label={task.title} className="flex flex-col gap-1 rounded-lg bg-muted px-2.5 py-1.5 text-[12.5px]">
            <span className="flex items-center gap-2">
                <Checkbox aria-label={"Done: " + task.title} checked={done} disabled={!canFinish(space, task, me)} onChange={(e) => void setDone(task, e.target.checked)} />
                <span className={cn("min-w-0 flex-1 truncate", done && "text-muted-foreground line-through")}>{task.title}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">{dayMonth(task.date)}</span>
            </span>
            <span className="flex items-center gap-2 pl-6 text-[11px] text-muted-foreground">
                <span className="min-w-0 flex-1 truncate">{assigneeNames(task, space, me)}</span>
                {claimAct && <Button variant="ghost" onClick={() => void claim(task, me, claimAct === "claim")}>{claimAct === "claim" ? "Claim" : "Unclaim"}</Button>}
                {canEdit(space) && !editing && <Button variant="ghost" aria-label={"Edit " + task.title} onClick={() => setEditing(true)}>Edit</Button>}
            </span>
            {editing && <TaskEditor task={task} space={space} done={() => setEditing(false)} />}
        </li>
    )
}

function TaskEditor({ task, space, done }: { task: SharedItem; space: Space; done: () => void }) {
    const [title, setTitle] = useState(task.title)
    const [date, setDate] = useState(task.date)
    const [who, setWho] = useState<string[]>(task.assignees)
    const f = useId()
    const everyone = who.includes("*")
    const toggle = (id: string) => setWho((w) => (w.includes(id) ? w.filter((x) => x !== id) : [...w.filter((x) => x !== "*"), id]))
    return (
        <div className="flex flex-col gap-2 border-t border-border pt-2">
            <TextInput aria-label="Task" value={title} maxLength={140} onChange={(e) => setTitle(e.target.value)} />
            <TextInput aria-label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <fieldset className="m-0 flex flex-wrap gap-x-3 gap-y-1 border-0 p-0">
                <legend className="mb-1 text-[11px] text-muted-foreground">Assigned to</legend>
                <label className="flex items-center gap-1.5"><Checkbox checked={everyone} onChange={() => setWho(everyone ? [] : ["*"])} id={f + "all"} />Everyone</label>
                {space.members.map((m) => (
                    <label key={m.userId} className="flex items-center gap-1.5">
                        <Checkbox checked={!everyone && who.includes(m.userId)} disabled={everyone} onChange={() => toggle(m.userId)} />{m.name}
                    </label>
                ))}
            </fieldset>
            <span className="flex gap-2">
                <Button variant="ghost" onClick={() => { void deleteTask(task); done() }}>Delete</Button>
                <span className="flex-1" />
                <Button variant="ghost" onClick={done}>Cancel</Button>
                <Button onClick={() => { void saveTask(task, { title: title.trim() || task.title, date, assignees: who }); done() }}>Save</Button>
            </span>
        </div>
    )
}
```

Check `Checkbox` in `./fields` takes `aria-label`/`checked`/`onChange` like a native checkbox (`grep -n "export function Checkbox" -A8 src/components/sheet/fields.tsx`); if it takes a `label` prop instead, wrap a native `<input type="checkbox">` with the class the item sheet uses.

- [ ] **Step 4: `src/components/sheet/project-sheet.tsx`**

```tsx
// A team project in the sheet (spec §10, §15), for admins until Stage 10. **Tasks**: add (owners
// and editors), done, claim, edit in place; **Members**: who is in it, invites (they join as
// editors), the code, roles, removing; **Activity**: what happened. Below the tasks, the
// owner links it to a class assignment, archives it, or deletes it; anyone else leaves it.
// Progress, workload and the assignment's date come in Stage 9.

import { useId, useState } from "react"
import { today } from "@/core/dates"
import { useProfile, useSharedItems, useSpaces } from "@/data/store"
import { closeSheet, replaceSheet } from "@/data/overlay"
import { addTask, canEdit, leaveProject, link, linkable, projectItem, removeProject, tasksOf, type ProjectTab } from "@/data/projects"
import { messageFor } from "@/data/classes"
import { setArchived } from "@/data/leave"
import { useMaintenance } from "@/data/maintenance"
import type { Space } from "@/data/types"
import { TeamGlyph } from "@/components/shared-glyph"
import { MaintenanceBar, MaintenancePage } from "@/components/maintenance"
import { tabKeys } from "./radio-keys"
import { Button, Note, Section, Select, SheetBody, SheetFoot, SheetHead, TextInput } from "./fields"
import { MembersTab } from "./members-tab"
import { ActivityList } from "./activity-list"
import { TaskRow } from "./task-row"

const TABS: readonly [ProjectTab, string][] = [["tasks", "Tasks"], ["members", "Members"], ["activity", "Activity"]]
const TITLE = "m-0 text-[22px] leading-[1.22] font-[750] tracking-[-.02em] text-foreground"

export function ProjectSheet({ spaceId, tab }: { spaceId: string; tab: ProjectTab }) {
    const maintenance = useMaintenance("classes")
    if (maintenance !== "blocked") return <ProjectCard spaceId={spaceId} tab={tab} bar={maintenance === "admin"} />
    return (
        <>
            <SheetHead kind="Project" onClose={closeSheet} />
            <SheetBody><MaintenancePage feature="classes" inSheet /></SheetBody>
        </>
    )
}

function ProjectCard({ spaceId, tab, bar }: { spaceId: string; tab: ProjectTab; bar: boolean }) {
    const space = useSpaces().find((s) => s.id === spaceId) ?? null
    const items = useSharedItems()
    const project = projectItem(spaceId, items)
    const me = useProfile()?.id ?? ""
    const f = useId()
    if (!space || !project) return (
        <>
            <SheetHead kind="Project" onClose={closeSheet} />
            <SheetBody><Note>This project isn't on this device yet. It arrives with the next sync.</Note></SheetBody>
            <SheetFoot hint=""><Button onClick={closeSheet}>Done</Button></SheetFoot>
        </>
    )
    const tasks = tasksOf(spaceId, items)
    return (
        <>
            <SheetHead kind="Project" onClose={closeSheet}>
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-px text-[10.5px] font-semibold text-ink-2">
                    <TeamGlyph className="size-3" /> Team · {space.role}
                </span>
            </SheetHead>
            <div className="px-[18px] pt-4">
                <h2 className={TITLE}>{project.title}</h2>
                <Note>Due {project.date}{space.archived ? " · Archived: read-only" : ""}</Note>
            </div>
            <div role="tablist" aria-label="Project" onKeyDown={tabKeys} className="flex gap-1 border-b border-border px-3">
                {TABS.map(([id, label]) => (
                    <button key={id} type="button" role="tab" id={f + id} aria-selected={tab === id} aria-controls={tab === id ? f + "panel" : undefined}
                        tabIndex={tab === id ? 0 : -1} onClick={() => replaceSheet({ kind: "project", spaceId, tab: id })}
                        className="border-0 border-b-2 border-transparent bg-transparent px-2.5 py-2 text-[12.5px] font-semibold text-muted-foreground aria-selected:border-primary aria-selected:text-foreground">
                        {label}
                    </button>
                ))}
            </div>
            <SheetBody id={f + "panel"} role="tabpanel" aria-labelledby={f + tab}>
                {bar && <MaintenanceBar className="mb-0" />}
                {tab === "tasks" && (
                    <>
                        {canEdit(space) && <NewTask spaceId={spaceId} />}
                        {tasks.length
                            ? <ul aria-label="Tasks" className="m-0 flex list-none flex-col gap-1 p-0">{tasks.map((t) => <TaskRow key={t.id} task={t} space={space} me={me} />)}</ul>
                            : <Note>No tasks yet.{canEdit(space) ? " Add the first above." : ""}</Note>}
                        <ProjectActions space={space} title={project.title} />
                    </>
                )}
                {tab === "members" && <MembersTab spaceId={spaceId} />}
                {tab === "activity" && <ActivityList spaceId={spaceId} />}
            </SheetBody>
            <SheetFoot hint=""><Button onClick={closeSheet}>Done</Button></SheetFoot>
        </>
    )
}

function NewTask({ spaceId }: { spaceId: string }) {
    const [title, setTitle] = useState("")
    const [date, setDate] = useState(today())
    const add = async () => { if (title.trim() && (await addTask(spaceId, title, date))) setTitle("") }
    return (
        <span className="flex gap-2">
            <TextInput aria-label="New task" placeholder="Add a task" value={title} maxLength={140} onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void add() } }} />
            <TextInput aria-label="New task's date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-[150px]" />
            <Button onClick={() => void add()}>Add</Button>
        </span>
    )
}

/* The owner's link, archive and delete; anyone else's Leave. Each needs a connection. */
function ProjectActions({ space, title }: { space: Space; title: string }) {
    const options = linkable()
    const [confirming, setConfirming] = useState(false)
    const [typed, setTyped] = useState("")
    const [err, setErr] = useState("")
    const run = async (act: () => Promise<void>) => { setErr(""); try { await act() } catch (e) { setErr(messageFor(e)) } }
    const linked = space.parent ? space.parent.space + "/" + space.parent.item : ""
    const f = useId()
    if (space.role !== "owner") return (
        <Section title="Leave">
            <Note>Your tasks become unassigned and your notes here go. Nothing is copied: the project is the team's.</Note>
            <Button variant="ghost" onClick={() => void run(() => leaveProject(space.id))}>Leave the project</Button>
            {err && <Note tone="bad">{err}</Note>}
        </Section>
    )
    return (
        <Section title="The project">
            {!space.archived && (
                <>
                    <label htmlFor={f + "link"} className="text-[12px] text-muted-foreground">Belongs to</label>
                    <Select id={f + "link"} value={linked} onChange={(e) => {
                        const o = options.find((x) => x.space + "/" + x.item === e.target.value)
                        void run(() => link(space.id, o ? { space: o.space, item: o.item } : null))
                    }}>
                        <option value="">No class assignment</option>
                        {options.map((o) => <option key={o.space + "/" + o.item} value={o.space + "/" + o.item}>{o.label}</option>)}
                    </Select>
                    <Note>Linking sets the due date to the assignment's.</Note>
                </>
            )}
            <Button variant="ghost" onClick={() => void run(() => setArchived(space.id, !space.archived))}>{space.archived ? "Unarchive" : "Archive"}</Button>
            {!confirming ? <Button variant="ghost" onClick={() => setConfirming(true)}>Delete the project…</Button> : (
                <>
                    <Note>Deletes it for everyone: its tasks, and everyone's notes on them. Members are told.</Note>
                    <TextInput aria-label={"Type " + title + " to confirm"} value={typed} onChange={(e) => setTyped(e.target.value)} />
                    <Button disabled={typed.trim() !== title} onClick={() => void run(() => removeProject(space.id, typed))}>Delete for everyone</Button>
                </>
            )}
            {err && <Note tone="bad">{err}</Note>}
        </Section>
    )
}
```

Adjust to the real props of `Section`, `SheetBody` and the class sheet's tab button classes (copy them from `class-sheet.tsx`, which this mirrors). `setArchived` is the Stage 5 plan's (`src/data/leave.ts`).

- [ ] **Step 5: Members tab wording (`src/components/sheet/members-tab.tsx`)**

Where Stage 5's **Remove** confirm says the person keeps a copy, use `info.kind === "project" ? "They lose access. Their tasks become unassigned; nothing is copied." : <the class text>`. The header comment: "A class's or a project's Members tab".

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/components/sheet/project.test.tsx src/components/sheet/classes.test.tsx && npm run typecheck`
Expected: PASS (Task 5's heading line too: remove its `// Task 6` mark).

- [ ] **Step 7: Build (non-ASCII: ·, …)**

Run: `npm run build`
Expected: success.

- [ ] **Step 8: Commit**

```bash
git add src/components/sheet/project-sheet.tsx src/components/sheet/task-row.tsx src/components/sheet/members-tab.tsx src/components/sheet/sheet.tsx src/components/sheet/project.test.tsx
git commit -m "Stage 8: the project sheet: tasks, claiming, completing, members, activity, link, archive, delete, leave

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Docs

- [ ] **Step 1: `docs/DATA-MODEL.md`**: the API table gains `POST /api/spaces {kind:'project', title, date?, parent?}`, `POST /api/spaces/:sid/link {parent}`, and `DELETE /api/spaces/:sid {confirm}` for projects; the limits section, 200 live tasks per project; leave/remove for a project (strip, no copy).
- [ ] **Step 2: `docs/PROJECT-OVERVIEW.md`**: history "Stage 8 (team projects, admins only), <date>"; repo map: `worker/projects.js`, `src/data/projects.ts`, the two new sheets, `task-row.tsx`, `sidebar-projects.tsx`.
- [ ] **Step 3: The master plan**: Stage 8's plan cell becomes `` `docs/superpowers/plans/2026-10-07-collab-stage-8-projects.md` ``. Add **Hand-offs from Stage 8**: "Projects are admin-only (`PROJECTS_ADMINS_ONLY` in `worker/projects.js`, `PROJECTS_ADMIN_ONLY` in `src/data/projects.ts`) and out of the views (`PROJECTS_IN_VIEWS` in `src/data/effective.ts`). Stage 9 sets `PROJECTS_IN_VIEWS` true and filters the Week to tasks assigned to you or everyone; routes `toggleTask` for `p:` keys to `setDone`; opens a task in the item card with a Team section; adds progress, workload, the linked assignment's header and **Use this date** to the project sheet; adds the ring and the eye to the Projects group; folds a linked project's chip. Stage 10 adds projects to the ICS feed and clears both admin flags. The link route is `POST /api/spaces/:sid/link` (not `PATCH`)."
- [ ] **Step 4: Commit**

```bash
git add docs/DATA-MODEL.md docs/PROJECT-OVERVIEW.md docs/superpowers/plans/2026-10-02-collaboration.md
git commit -m "Stage 8: docs for team projects

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Full check, browser check, merge (George's yes)

- [ ] **Step 1:** `npm run check` — everything passes.
- [ ] **Step 2: By hand**, `npm run dev` (port check first), local accounts `qaa` and `qab` (admins) and `qac` (not):
1. `qaa`: + New → New team project, belonging to a class assignment: the due date fills in; it opens; the sidebar's Projects lists it.
2. `qaa` invites `qab` (joins as editor) and `qac` (refused: "can't join team projects yet").
3. `qaa` adds three tasks, assigns one to `qab`, one to Everyone. `qab` (after sync): completes their own and the Everyone task, claims the third; `qaa` sees "Done" and the names after sync.
4. Make `qab` a member (Members tab): `qab` can no longer edit or add, can still complete their own and claim.
5. Offline on `qab`: complete a task; online again: it uploads (no Saved copy).
6. `qab`'s inbox: "qaa assigned you …" (Stage 7).
7. `qab` leaves: their tasks show "Nobody yet" for `qaa`; the project leaves `qab`'s sidebar after sync.
8. `qaa` links to another assignment (date follows), archives (read-only: no Add, no checkboxes), unarchives, deletes by typing the name; it leaves the sidebar.
9. The Week, Month and All items show no project rows (Stage 9).
- [ ] **Step 3: Ask George.** No migration. On his yes: merge `collab-8-projects` into `main` with `--no-ff` and push (as in Stage 7's Task 9 Step 3, without the `db:` commands).

---

## Self-review against the spec and the outline

- §10 structure: one `project` item made with the space, never deleted (Stage 2's `madeWithSpace` refuses its delete); tasks in the same scope (Tasks 1, 2). Course → Assignment → Project: `parent_space`/`parent_item`, owner sets it as a class member (Task 2), date from the assignment on create and link (Decision 3, 4); the class information shows only to people who hold that class (`linkable` lists only your classes; Stage 9's header reads the assignment from your own store). Relink on a moved course: the link route. Leaving the class does not touch the project (separate memberships).
- §10 assignment rules: Stage 2's Worker rules, tested again end to end in Task 2; removal strips assignees and unassigns (Task 3); one team status with `completed_by` (Stage 2, Task 2's member case).
- §10 progress and workload: Stage 9 (hand-off).
- §10 removal from a project: marks deleted, nothing copied, sessions untouched (Task 3: sessions are never touched by `leaveProject`).
- §13: delete a project (typed confirm, marks/prefs/invites/space, members told: Task 3); task deletion's note goes at purge (Task 3 Step 5); account deletion strips assignees (Task 3).
- §3 limits: 200 tasks (Task 2), 20 spaces (Task 1), 30 members (unchanged invite/join statements).
- §11: project invites default to editor (Stage 3's `invite`, Task 1's last case).
- §21 steps 10–13 and 22–24 are Task 8's hand check (2, 3, 7).
- Gaps left to later stages on purpose: views, chip folding, the item card's Team section, progress/workload/Use this date (Stage 9); the ICS feed and opening to everyone (Stage 10).
- Placeholders: Tasks 5 and 6's component tests describe their seeds and fakes in comments, because the jsdom helpers live in `classes.test.tsx` and must be read first; their assertions are spelled out.
