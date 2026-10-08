# Collaboration Stage 10: Project events in the inbox and the calendar feed; projects for everyone — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

This is **Stage 10**, the last, of the master plan `docs/superpowers/plans/2026-10-02-collaboration.md` (the "Stages 8–10" outline and the hand-offs Stages 7–9 recorded). It is written on 2026-10-07, **before Stages 5–9 are built**, against the code as it will be once they are merged: Stage 6's `feedRows` and `serveFeed` in `worker/calendar.js`; Stage 7's activity triggers, `CONCERNS` and `inboxRows` in `worker/activity.js`; Stage 8's `worker/projects.js` (`PROJECTS_ADMINS_ONLY`, `assertProjectsOpen`) and `src/data/projects.ts` (`PROJECTS_ADMIN_ONLY`, `projectsShown`); Stage 9's views. **Start Stage 10 only after Stage 9 is merged to `main`.** If an earlier stage changed a name this plan uses, follow that stage's code.

**Goal:** The calendar feed carries your team projects (each project's due date, and the tasks assigned to you or to everyone, ✓ when done, your notes first); the inbox's project events are checked end to end (assigned to you, a task for everyone, completion of your task, removal, a deleted project); and then **team projects open to everyone**, as Stage 6 did for classes. This completes the collaboration plan (v1 shared classes, v2 team projects).

**Architecture:** `feedRows` gains `projectItems` (read in `serveFeed`'s batch with your membership, your mark and your prefs in the statement); their ids become `<space>-<id>` as a class's do, so UIDs read `item-<sid>-<id>`. A task's summary carries its project's name, since a calendar app has no team glyph. The inbox needs no new code: Stage 7's triggers and filter already cover project verbs; this stage adds the route-level tests that prove it. Opening projects removes the two admin flags and every check they gate.

**Tech Stack:** Cloudflare Workers + D1 (plain JS ES modules), React 19 + TypeScript + Vite, Vitest (Workers pool + jsdom).

**Spec:** `docs/superpowers/specs/2026-10-02-shared-classes-design.md`: §9 (ICS feed contents: "each project's item; tasks assigned to you or to everyone"; hidden sources; propagation), §12 (task assigned, completed; permission changes and removals; `space.deleted`), §17 (ICS exposure: the feed's query joins live membership), §20 (assign a task), §21 (the whole trace, steps 10–28), §22 (v2).

---

## How to work in this repo (read before any task)

1. **Checks:** `npm run typecheck`, `npm test`, `npm run build`; `npm run check` runs all three. The Worker tests alone: `npm run test:api`. One file: `npx vitest run test/project-feed.test.js`.
2. **Dev server:** `npm run dev` → http://127.0.0.1:8787; check `Get-NetTCPConnection -LocalPort 8787 -State Listen` first and stop a leftover `vite.js`. Don't run `npm run build` while it runs.
3. **Line endings:** LF. **Non-ASCII** (·, ✓): Edit/Write tools only; `npm run build` after a commit that adds any; `iconv -f utf-8 -t utf-8 <file> >/dev/null` on a sub-agent's files.
4. **Deploying:** no migration.
5. **Commits:** end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; only on `collab-10-project-feed`; never push or merge without George's yes.
6. **The suite stays green after every task**; a task that changes a behaviour an older test spells out updates that test in the same task.

```bash
git checkout main && git pull --ff-only && git checkout -b collab-10-project-feed
```

---

## Decisions this plan takes

1. **What the feed holds for a project** (spec §9): its own item (title, due date; ✓ when the team marked it done) and its live tasks assigned to you or to everyone (✓ when done, whoever completed it). Unassigned and others' tasks are left out, as in the Week. A row you hid (`marks.hidden`) is left out; your notes on it come first in the description, then the team's. A project in `hidden_sources` (`space:<sid>`) is left out whole, and so is one archived in your sidebar (`space_prefs.archived`), as for a class. An archived project stays (it is still happening; it is read-only).
2. **The feed does not fold.** A calendar app has no chips, so a project linked to an assignment on the same day shows as two events ("REST API Project" from the class, "Team · Fire Response API" from the project). The app folds; the feed is a list.
3. **Words in the feed**: a project's own item reads `Team · <project>`; a task reads `<project> · <task>`. Tasks and the project item have no course, so `buildCalendar` adds no course code.
4. **Inbox**: no code. Stage 7's `CONCERNS` already tells everyone in a project about new and deleted tasks and date changes, an assignee about `task.assigned`, everyone about a task given to everyone, and the assignees about its completion; `member.removed`, `member.role` and `space.deleted` reach the person through `subject_user`. Task 1 proves it through the routes.
5. **Opening projects** (Task 3), last, once the feed works: `PROJECTS_ADMINS_ONLY`, `assertProjectsOpen` and `isAdmin` go from the Worker, with the `not_admin` answers on making, inviting, accepting and joining; `PROJECTS_ADMIN_ONLY` and `projectsShown` go from the client, so **New team project** and the Projects group show for everyone in a project. The **classes** maintenance switch keeps covering projects: when an admin turns it on, everyone else gets the maintenance page in the project sheets too.
6. **No new limits**: 20 spaces a person, 30 members a space, 200 tasks a project, invites 20 an hour, join attempts 10 an hour.

## File map

| File | Change |
|---|---|
| `worker/calendar.js` | `feedRows` takes `projectItems`; `serveFeed` reads them |
| `worker/projects.js` | the admin gate goes (Task 3) |
| `worker/classes.js`, `worker/invites.js` | the gate's calls go (Task 3) |
| `src/data/projects.ts` | `PROJECTS_ADMIN_ONLY`, `projectsShown` go (Task 3) |
| `src/components/sidebar-classes.tsx`, `src/components/sidebar-projects.tsx`, `src/data/classes.ts` | the gate's uses go; `messageFor`'s `not_admin` goes |
| `docs/DATA-MODEL.md`, `docs/PROJECT-OVERVIEW.md`, `README.md`, the spec's status line, master plan | projects for everyone; the feed; the plan complete |
| Tests | new `test/project-feed.test.js`, `test/project-inbox.test.js`; changed `test/projects.test.js`, `src/components/sheet/project.test.tsx` |

---

### Task 1: The inbox's project events, end to end

**Files:**
- Test: `test/project-inbox.test.js` (no code change expected; a failure here is a bug in Stage 7 or 8 to fix in this task)

- [ ] **Step 1: Write the test**

`test/project-inbox.test.js`:

```js
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { post, signInAdmin } from './spaces.js';

let n = 0;
const task = (api, sid, id, body, rev = 0) => api(`/api/spaces/${sid}/items/${id}`, { method: 'PUT', headers: { 'if-match': `"${rev}"` },
  body: { type: 'task', title: id, date: '2026-10-20', status: 'todo', assignees: [], ...body } });
const inbox = async (api) => (await (await api('/api/inbox')).json()).items.map((r) => [r.verb, r.about, r.detail.title ?? r.space]);
async function team() {
  const tag = ++n, gabriel = await signInAdmin('pig' + tag), alex = await signInAdmin('pia' + tag), sam = await signInAdmin('pis' + tag);
  const { space } = await (await post(gabriel, '/api/spaces', { kind: 'project', title: 'Fire Response API', date: '2026-10-30' })).json();
  for (const m of [alex, sam]) {
    await post(gabriel, `/api/spaces/${space.id}/invites`, { username: m === alex ? 'pia' + tag : 'pis' + tag });
    await post(m, `/api/invites/${space.id}/accept`);
  }
  return { gabriel, alex, sam, space };
}

describe("a project's events in the inbox (spec §12, §21)", () => {
  it('tells an assignee, tells everyone of a task for everyone, and tells the assignees of its completion', async () => {
    const { gabriel, alex, sam, space } = await team();
    await task(gabriel, space.id, 'endpoint', { title: 'Create incidents endpoint', assignees: [alex.id] });
    const all = await (await task(gabriel, space.id, 'slides', { title: 'Slides', assignees: ['*'] })).json();
    expect(await inbox(alex)).toEqual(expect.arrayContaining([['task.assigned', true, 'Create incidents endpoint'], ['task.assigned', false, 'Slides']]));
    expect(await inbox(sam)).not.toContainEqual(['task.assigned', false, 'Create incidents endpoint']);
    await task(sam, space.id, 'slides', { ...all, status: 'done', completedAt: Date.now(), changed: { status: 'todo', completedAt: null } }, all.revision);
    expect(await inbox(alex)).toContainEqual(['task.status', false, 'Slides']);
  });

  it('tells you that you were removed, even though you left the project (§21 step 26)', async () => {
    const { gabriel, alex, space } = await team();
    await gabriel(`/api/spaces/${space.id}/members/${alex.id}`, { method: 'DELETE' });
    expect(await inbox(alex)).toContainEqual(['member.removed', true, 'Fire Response API']);
  });

  it('tells every other member that the project was deleted', async () => {
    const { gabriel, alex, sam, space } = await team();
    await gabriel(`/api/spaces/${space.id}`, { method: 'DELETE', body: { confirm: 'Fire Response API' } });
    for (const m of [alex, sam]) expect(await inbox(m)).toContainEqual(['space.deleted', true, 'Fire Response API']);
    expect(await inbox(gabriel)).not.toContainEqual(['space.deleted', true, 'Fire Response API']);
  });

  it('counts the assignment in the unread number on the next sync', async () => {
    const { gabriel, alex, space } = await team();
    await task(gabriel, space.id, 'docs', { title: 'Write docs', assignees: [alex.id] });
    const page = await (await alex(`/api/sync?v=3&cursors=${encodeURIComponent('u:' + alex.id + ':0')}&sv=0`)).json();
    expect(page.unread).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run test/project-inbox.test.js`
Expected: PASS. If a case fails, the fault is in Stage 7's `CONCERNS`/triggers or Stage 8's routes: fix it there, in this task, with the failing case as the proof, and run `npx vitest run test/inbox.test.js test/activity-schema.test.js test/projects.test.js test/project-leave.test.js` too.

- [ ] **Step 3: Commit**

```bash
git add test/project-inbox.test.js
git commit -m "Stage 10: project events reach the inbox, checked through the routes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Add any file a fix touched.)

---

### Task 2: Projects in the calendar feed

**Files:**
- Modify: `worker/calendar.js` (`feedRows`, `serveFeed`)
- Test: `test/project-feed.test.js`

- [ ] **Step 1: Write the failing test**

`test/project-feed.test.js`:

```js
import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { buildCalendar, feedRows } from '../worker/calendar.js';
import { unfold } from './helpers.js';
import { makeSpace, mark, pref, sharedItem, signInAdmin } from './spaces.js';

const SID = 'fire00000042';
const pItem = (over = {}) => ({ sid: SID, project: 'Fire Response API', id: 't1', type: 'task', title: 'Create incidents endpoint', course_id: null, date: '2026-10-20',
  start: '', end: '', location: '', status: 'todo', weight: null, notes: 'Team notes', recur: null, weekday: null, recur_until: null, assignees: '["u-me"]',
  my_archived: 0, m_notes: null, m_hidden: null, ...over });

describe('feedRows with projects (Stage 10 plan, Decisions 1-3)', () => {
  it("names a project's own item and its tasks, scopes their ids, and puts your notes first", () => {
    const rows = feedRows({ courses: [], items: [], projectItems: [pItem({ id: 'project', type: 'project', title: 'Fire Response API', assignees: '[]', date: '2026-10-30' }), pItem({ m_notes: 'Mine' })], me: 'u-me' });
    expect(rows.items.map((i) => [i.id, i.title, i.notes])).toEqual([
      [SID + '-t1', 'Fire Response API · Create incidents endpoint', 'Mine\n\nTeam notes'],
      [SID + '-project', 'Team · Fire Response API', 'Team notes'],
    ]);
    const ics = unfold(buildCalendar(rows));
    expect(ics).toContain('UID:item-' + SID + '-t1@rounds');
    expect(ics).toContain('SUMMARY:Fire Response API · Create incidents endpoint');
  });

  it("keeps only your tasks and everyone's, and leaves out what you hid, hidden sources, and projects you archived", () => {
    const rows = (items, hidden = []) => feedRows({ courses: [], items: [], projectItems: items, me: 'u-me', hidden }).items.map((i) => i.id);
    expect(rows([pItem(), pItem({ id: 't2', assignees: '["*"]' }), pItem({ id: 't3', assignees: '["u-sam"]' }), pItem({ id: 't4', assignees: '[]' })]))
      .toEqual([SID + '-t1', SID + '-t2']);
    expect(rows([pItem({ m_hidden: 1 })])).toEqual([]);
    expect(rows([pItem()], ['space:' + SID])).toEqual([]);
    expect(rows([pItem({ my_archived: 1 })])).toEqual([]);
  });

  it('marks a finished task ✓ whoever finished it', () => {
    const ics = unfold(buildCalendar(feedRows({ courses: [], items: [], projectItems: [pItem({ status: 'done' })], me: 'u-me' })));
    expect(ics).toContain('SUMMARY:✓ Fire Response API · Create incidents endpoint');
  });
});

describe('the feed, served, with projects', () => {
  it("carries your projects' rows with your layer, and drops a project you left", async () => {
    const me = await signInAdmin('pfme'), sam = await signInAdmin('pfsam');
    const s = await makeSpace({ kind: 'project', members: { [me.id]: 'editor', [sam.id]: 'owner' } });
    await sharedItem(s.scope, 't1', { title: 'Mine to do', assignees: JSON.stringify([me.id]) });
    await sharedItem(s.scope, 't2', { title: 'Sam alone', assignees: JSON.stringify([sam.id]) });
    await sharedItem(s.scope, 't3', { title: 'Gone task', assignees: JSON.stringify([me.id]), deleted_at: 5 });
    await mark(sam.id, s.id, 't1', { notes: 'Sam secret' });
    await pref(me.id, s.id, { term: '' });
    const { url } = await (await me('/api/calendar', { method: 'POST' })).json();
    const ics = unfold(await (await SELF.fetch(url)).text());
    expect(ics).toContain('SUMMARY:Fire Response API · Mine to do');
    expect(ics).toContain('SUMMARY:Team · Fire Response API');
    expect(ics).not.toContain('Sam alone');
    expect(ics).not.toContain('Gone task');
    expect(ics).not.toContain('Sam secret');
    await env.DB.prepare('UPDATE members SET deleted_at = 3 WHERE space_id = ? AND user_id = ?').bind(s.id, me.id).run();
    expect(unfold(await (await SELF.fetch(url)).text())).not.toContain('Mine to do');
  });
});
```

`makeSpace({kind:'project'})` titles the project item "Fire Response API" (`test/spaces.js`). `mark`, `pref`: Stage 5's raw-row helpers there.

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run test/project-feed.test.js`
Expected: FAIL (no project rows).

- [ ] **Step 3: `feedRows` (`worker/calendar.js`)**

Its parameters gain `projectItems = []` and `me = ''`; its doc comment gains: "Each project you are in: its own item as 'Team · <project>', and its tasks assigned to you or to everyone as '<project> · <task>', ids '<space>-<id>', your notes first; left out when you hid the row, hid the project (`space:<sid>`) or archived it in your sidebar. The feed does not fold a project into its assignment (Stage 10 plan, Decision 2)." In the `items` list, after the class items:

```js
      ...projectItems.filter((it) => it.my_archived !== 1 && !off.has('space:' + it.sid) && it.m_hidden !== 1
          && (it.type === 'project' || mineOrAll(it.assignees, me)))
        .map((it) => ({
          ...it, id: it.sid + '-' + it.id, course_id: null,
          title: it.type === 'project' ? 'Team · ' + it.project : it.project + ' · ' + it.title,
          notes: [it.m_notes, it.notes].filter(Boolean).join('\n\n'),
        })),
```

with, above `feedRows`:

```js
/* A task's assignees (JSON) include you or everyone. */
const mineOrAll = (json, me) => {
  try { const a = JSON.parse(json); return Array.isArray(a) && (a.includes(me) || a.includes('*')); } catch { return false; }
};
```

- [ ] **Step 4: Read them in `serveFeed`**

Add a fifth statement to the batch (after `classItems`), with `IN` as Stage 6 defined it:

```js
    env.DB.prepare(`SELECT s.id AS sid, (SELECT title FROM items WHERE scope = 'p:' || s.id AND id = 'project') AS project,
        i.id, i.type, i.title, i.course_id, i.date, i.start, i.end, i.location, i.status, i.weight, i.notes, i.recur, i.weekday, i.recur_until, i.assignees,
        COALESCE(p.archived, 0) AS my_archived, k.notes AS m_notes, k.hidden AS m_hidden
      FROM spaces AS s ${IN} JOIN items AS i ON i.scope = 'p:' || s.id AND i.deleted_at IS NULL
        LEFT JOIN marks AS k ON k.user_id = ?1 AND k.space_id = s.id AND k.item_id = i.id AND k.deleted_at IS NULL
        LEFT JOIN space_prefs AS p ON p.user_id = ?1 AND p.id = s.id AND p.deleted_at IS NULL
      WHERE s.kind = 'project' AND s.deleted_at IS NULL`).bind(userId),
```

destructure it as `projectItems`, and pass `projectItems: projectItems.results, me: userId` to `feedRows`. The rows a task may have (≤ 200 per project, ≤ 20 spaces) keep the read within §18's "a few queries per hourly fetch". Update the header comment: "…your classes and your team projects come too…".

- [ ] **Step 5: Run the tests**

Run: `npx vitest run test/project-feed.test.js test/class-feed.test.js test/calendar.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add worker/calendar.js test/project-feed.test.js
git commit -m "Stage 10: your team projects in the calendar feed: their due dates and your tasks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Open team projects to everyone

**Files:**
- Modify: `worker/projects.js`, `worker/classes.js`, `worker/invites.js`, `src/data/projects.ts`, `src/components/sidebar-classes.tsx`, `src/components/sidebar-projects.tsx`, `src/data/classes.ts`
- Test: `test/projects.test.js`, `src/components/sheet/project.test.tsx`

- [ ] **Step 1: Turn the tests round**

In `test/projects.test.js`, replace the case "is for admins only until Stage 10: …" with:

```js
  it('is open to everyone: making, inviting, accepting, joining by code', async () => {
    const tag = ++n;
    const plain = await signIn('pjp' + tag), other = await signIn('pjq' + tag);
    plain.id = 'u-pjp' + tag; other.id = 'u-pjq' + tag;
    const made = await make(plain, { title: 'Team', date: '2026-10-30' });
    expect(made.status).toBe(201);
    const { space } = await made.json();
    expect((await post(plain, `/api/spaces/${space.id}/invites`, { username: 'pjq' + tag })).status).toBe(201);
    expect((await post(other, `/api/invites/${space.id}/accept`)).status).toBe(200);
    const third = await signIn('pjr' + tag);
    const { code } = await (await post(plain, `/api/spaces/${space.id}/code`)).json();
    expect((await post(third, '/api/join', { code })).status).toBe(200);
  });
```

In `src/components/sheet/project.test.tsx`, the case "hides it all from someone who is not an admin" becomes "offers New team project to everyone": the same steps, expecting the menu item to be there.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run test/projects.test.js src/components/sheet/project.test.tsx`
Expected: the two changed cases FAIL (`403`; no menu item).

- [ ] **Step 3: The Worker**

`worker/projects.js`: delete `PROJECTS_ADMINS_ONLY`, `isAdmin` and `assertProjectsOpen`, and "Admins only until Stage 10." from the header. `worker/classes.js`: the project branch of `POST /api/spaces` uses `const userId = await requireUser(request, env);`; the accept route loses the kind read and `assertProjectsOpen`; drop the now-unused imports (`requireAdmin` too, if nothing else uses it: `grep -n requireAdmin worker/classes.js`). `worker/invites.js`: delete the project `not_admin` line in `invite`, the `assertProjectsOpen` call in `joinByCode`, and the import; if `u.is_admin` in `invite`'s SELECT has no other use, drop it.

- [ ] **Step 4: The client**

`src/data/projects.ts`: delete `PROJECTS_ADMIN_ONLY` and `projectsShown`, and "for admins until Stage 10" from the header. `src/components/sidebar-classes.tsx`: `items()` always includes **New team project** (back to a constant `ITEMS`, as before Stage 8, with the line in it); drop the `useProfile()` call added for the gate if nothing else needs it. `src/components/sidebar-projects.tsx`: drop `projectsShown()` and its import (the group still shows only when you are in a project). `src/data/classes.ts` `messageFor`: delete the `not_admin` line. Check nothing else uses them: `grep -rn "projectsShown\|PROJECTS_ADMIN\|not_admin\|assertProjectsOpen" src worker` must print nothing.

- [ ] **Step 5: Run everything**

Run: `npm run check`
Expected: PASS. A test elsewhere that still expects `not_admin` for a project (Stage 8's sheet tests) is updated in this step to the open behaviour.

- [ ] **Step 6: Commit**

```bash
git add worker/projects.js worker/classes.js worker/invites.js src/data/projects.ts src/components/sidebar-classes.tsx src/components/sidebar-projects.tsx src/data/classes.ts test/projects.test.js src/components/sheet/project.test.tsx
git commit -m "Stage 10: team projects open to everyone

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Docs: the collaboration plan is complete

- [ ] **Step 1: `README.md`**: one line under what Term does: "Team projects: tasks shared with a small team, each with who has it, in your Week and your calendar feed."
- [ ] **Step 2: `docs/PROJECT-OVERVIEW.md`**: history "Stage 10 (project events, projects in the feed, projects for everyone), <date>: collaboration complete"; the features paragraph describes classes and projects as open to everyone.
- [ ] **Step 3: `docs/DATA-MODEL.md`**: the calendar-feed section lists project rows (Decisions 1–3); the API table drops every "admins only" note.
- [ ] **Step 4: The spec's first lines** (`docs/superpowers/specs/2026-10-02-shared-classes-design.md`): "Not built yet." becomes "Built in ten stages, 2026-10-05 to <date>; see the master plan." (Leave the rest of the spec as the record of the design.)
- [ ] **Step 5: The master plan**: Stage 10's plan cell becomes `` `docs/superpowers/plans/2026-10-07-collab-stage-10-project-feed.md` ``; a closing note under the stages table: "All ten stages shipped. Later (spec §22): suggested changes, comments, milestones and dependencies, personal date overrides, reminders, class leaderboards, meeting-level merge, `.ics`/CSV/schedule import into classes, templates, meeting conflict detection."
- [ ] **Step 6: Commit** (`Stage 10: docs; collaboration complete`), with the attribution line.

---

### Task 5: Full check, the §21 trace by hand, merge (George's yes)

- [ ] **Step 1:** `npm run check` passes.
- [ ] **Step 2: The §21 trace**, steps 10–28, with two **non-admin** local accounts (make two with `npm run user:add` or the Admin page, without the admin flag) named for the trace, "gabriel" and "alex", both in one class with an assignment "REST API Project, Oct 15, 20%", and each with a calendar feed URL open in a browser tab (refresh it to see the feed):
1. Gabriel: + New → New team project "Fire Response API", belonging to the assignment: due Oct 15 (step 10).
2. Gabriel invites alex; alex accepts from the inbox; alex is an editor (step 11).
3. Gabriel adds "Create incidents endpoint" for alex: alex's inbox says so; alex's Week and feed show it (step 12).
4. Alex offline ticks it done; Gabriel moves the assignment to Oct 18 (steps 13–14).
5. Alex online: the task uploads; the project header offers **Use this date**; the Week shows the assignment (Oct 18) and the project (Oct 15) apart; Gabriel sees the task done by alex (steps 15–16).
6. Alex's inbox: "Gabriel moved REST API Project: 15 Oct → 18 Oct" (step 17).
7. Alex records 87% on the assignment; Gabriel cannot see it anywhere (steps 18–19).
8. Alex logs 1h 25m on the assignment from Study (steps 20–21).
9. Gabriel removes alex from the project: alex's tasks become unassigned; after sync the project leaves alex's device; alex's inbox: "Gabriel removed you from Fire Response API"; the class, the assignment with 87% and the session stay; alex's feed on refresh has the class and nothing from the project (steps 22–28).
- [ ] **Step 3: Ask George.** No migration. On his yes, merge `collab-10-project-feed` into `main` with `--no-ff` and push. After the Git build deploys, ask him to make a project from his account and invite his second one.

---

## Self-review against the spec and the outline

- §9 feed contents for projects: "each project's item; tasks assigned to you or to everyone" (Task 2, Decision 1); hidden sources and sidebar archive (Task 2); the feed's query joins live membership (Task 2's served case, §17).
- §12 for projects: task assigned (one per assignee, `subject_user`), completion reaching assignees, a task for everyone, removal and deletion reaching the person (Task 1). Coalescing and the 90-day purge are Stage 7's and apply unchanged.
- §22 v2: project spaces and the project item (8), tasks with assignees, claiming and completion (8), the link and chip folding (8, 9), progress and workload (9), the project sheet (8, 9), task events in the inbox and the ICS (10). Opening to everyone (Task 3) follows the rule Stage 6 used for classes: nobody gets a feature before it reaches their calendar.
- §21 trace, steps 10–28: Task 5.
- Names used from other plans: `feedRows`, `IN`, `parseList` (Stage 6); `CONCERNS` and the triggers (Stage 7); `PROJECTS_ADMINS_ONLY`, `assertProjectsOpen`, `isAdmin`, `projectsShown`, `PROJECTS_ADMIN_ONLY` (Stage 8); `test/spaces.js`'s `mark` and `pref` (Stage 5).
