# Collaboration Stage 7: Inbox and activity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

This is **Stage 7** of the master plan `docs/superpowers/plans/2026-10-02-collaboration.md` (its Stage 7 outline and the hand-offs Stages 5 and 6 recorded). It is written on 2026-10-07, **before Stages 5 and 6 are built**, against the code as it will be once they are merged: Stage 5's `worker/leaving.js` (`detach`, `leave`, `removeMember`, `setArchived`, `deleteClass`, `handOnStmts`), `keeperGuard`/`assertKeeper` in `worker/access.js`, its `purgeTombstones` in §13's order; Stage 6's removal of `ADMINS_ONLY` and of the admin checks in `src/data/classes.ts` and `src/data/session.ts`. **Start Stage 7 only after Stage 6 is merged to `main`.** If an earlier stage changed a name this plan uses, follow that stage's code; every step that leans on a planned name says which plan defines it.

**Goal:** Members see what happened in their classes: a bell in the top bar with an unread count opens an **inbox** (invites to you, plus what others did that concerns you: new and deleted items, date and class-time changes, tasks assigned to you or completed, archiving, and anything about you, such as a role change or a removal); each class sheet gains an **Activity** tab with the class's whole history (90 days).

**Architecture:** One table, `activity`, filled by **triggers** on shared `items` and `courses` rows (they see `OLD` and `NEW`, so "from → to" is the real previous value and the actor is `NEW.updated_by`), and by one statement the member and space routes add to their own batches (`noteStmt` in a new `worker/activity.js`). Rows coalesce per (space, actor, verb, subject, person, 10-minute bucket), keeping the first "from"; a change that returns to where it started deletes its row. Nothing is fanned out: the inbox is a query over the spaces you are in plus rows about you; the unread count rides on the last page of each sync; `inbox_seen` holds the last row you read. The client keeps the inbox list in IndexedDB's `meta` store for offline reading.

**Tech Stack:** Cloudflare Workers + D1 (plain JS ES modules), React 19 + TypeScript + Vite, IndexedDB, Vitest (Workers pool + jsdom), wrangler.

**Spec:** `docs/superpowers/specs/2026-10-02-shared-classes-design.md`: §2 (Activity, Inbox read marker), §3 (`activity`, `inbox_seen`, query patterns), §11 (the invitee sees it in the inbox), §12 (all of it), §13 (the purge, account deletion), §14 (`/api/inbox`, `/api/inbox/seen`, `/api/spaces/:sid/activity`), §15 (top bar bell, Activity tab), §18 (cost).

**UI reference:** the prototype George approved (artifact https://claude.ai/artifact/NsegZJE8Wu4A6MvsvWx6HE): the bell with its count and the inbox sheet (full-screen on phones). Built in the app's own sheet and fields.

---

## How to work in this repo (read before any task)

1. **Checks:** `npm run typecheck`, `npm test` (Vitest: Workers + jsdom projects, then node tests), `npm run build`. `npm run check` runs all three. One file: `npx vitest run test/activity-schema.test.js`. The jsdom tests alone: `npm run test:ui`. The Worker tests alone: `npm run test:api`.
2. **Dev server:** `npm run dev` → http://127.0.0.1:8787. On this Windows machine a stopped dev server can leave `vite.js` holding 8787/8790 and serving old code: check `Get-NetTCPConnection -LocalPort 8787 -State Listen` in PowerShell first and stop the owning process. Don't run `npm run build` while the dev server runs.
3. **Line endings:** keep every file LF.
4. **Non-ASCII** (·, —, →, …): write it with the Edit/Write tools, never through a shell; after a commit that adds any, `npm run build`. Check a sub-agent's files with `iconv -f utf-8 -t utf-8 <file> >/dev/null` in Git Bash.
5. **Deploying:** this stage **has a migration**, `migrations/0005_activity.sql`. The Git build does not apply it: Task 9 runs `npm run db:remote` and `npm run db:check -- --remote` before the merge, **only with George's explicit yes** (the auto-mode classifier blocks `db:remote` otherwise).
6. **Commits:** end each message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Commit only on `collab-7-inbox`; never push or merge to `main` without George's yes.
7. **Workers AI:** nothing in this stage calls AI.
8. **The suite stays green after every task**; a task that changes a behaviour an older test spells out updates that test in the same task.
9. **D1 and triggers:** `meta.changes` counts the rows triggers write too. From this stage on, every write to a shared `items` or `courses` row also writes `activity` rows, so code must count its own rows with `SELECT changes()` (as `absorb` does), never `meta.changes`, on those tables. Task 1 Step 6 checks for that.

Branch, made once Stage 6 is merged:

```bash
git checkout main && git pull --ff-only && git checkout -b collab-7-inbox
```

---

## Decisions this plan takes

1. **Verbs** (spec §12), each one row per coalesced event:

   | Verb | Written by | `subject` | `subject_user` | `old_value` → `new_value` |
   |---|---|---|---|---|
   | `item.created` | items INSERT trigger | `''` (an import is one row, `detail.titles` up to 10, `n` the count) | `''` | — |
   | `item.deleted` | items UPDATE trigger | item id | `''` | `'0'`/`'1'` (live/deleted), so a restore reads "restored" and delete-then-restore within the bucket cancels out |
   | `item.date` | items UPDATE trigger | item id | `''` | `date|start|end` |
   | `item.weight` | items UPDATE trigger (class rows; project rows carry no weight) | item id | `''` | weight as text, or NULL |
   | `item.title` | items UPDATE trigger | item id | `''` | titles |
   | `course.meetings` | courses UPDATE trigger (class course) | course id | `''` | meetings JSON (times and rooms) |
   | `course.instructor` | courses UPDATE trigger | course id | `''` | names |
   | `task.assigned` | items INSERT and UPDATE triggers, one row per newly added assignee | task id | the assignee (`''` for `*`) | — → assignee id or `*` |
   | `task.unassigned` | items UPDATE trigger, when a task is left with nobody | task id | `''` | old assignees JSON → `[]` |
   | `task.status` | items UPDATE trigger (project tasks) | task id | `''` | `todo`/`done` by `completed_at`; `detail.assignees` |
   | `member.joined`, `member.left` | accept, join by code, leave | `''` | `''` | — |
   | `member.removed` | remove | `''` | the removed person | — |
   | `member.role` | role change | `''` | the person | roles |
   | `space.archived` | archive / unarchive | `''` | `''` | `'0'`/`'1'` |
   | `space.transferred` | transfer; account deletion's hand-on | `''` | the new owner | — |
   | `space.linked`, `space.deleted` | Stage 8 (projects) | | | |

   The schema's CHECK lists all eighteen now, so Stages 8–10 need no migration.
2. **`subject_user` is `''`, never NULL**, and is part of the unique key, so two assignees added in one write are two rows and everything else still coalesces (a NULL would never conflict). `detail` carries the actor's display name at the time (`by`), the item's or course's title (`title`, or `titles` for creations), the person's name for member verbs (`whom`), and the space's name for route-written rows (`space`), so a row still reads after the item, the account or the space is gone.
3. **Coalescing keeps the first row's `seq`.** A later change in the same bucket updates the row in place (its `new_value`, `n`, `at`, `detail`), so a row you already read does not come back as unread when the same person nudges the same thing again within ten minutes. Accepted: the Activity tab and the inbox list show the latest state.
4. **What the inbox holds** (spec §12): your pending invites; rows by others **about you** (`subject_user = you`), even after you left that space; and, in the spaces you are a live member of, rows by others **since you joined** whose verb concerns everyone: `item.created`, `item.deleted`, `item.date`, `course.meetings`, `space.archived`, `space.linked`, a task given to everyone, and a task's completion or reopening when it is assigned to you or to everyone. The newest 50, within the 90 days activity is kept. Your own actions are never in your inbox.
5. **Unread** = pending unexpired invites + inbox rows above your `inbox_seen.seq`, capped at 99. It is computed once per sync, on the **last** page of `GET /api/sync?v=3` (`unread`), so the cost is one query per sync cycle (§18). Opening the inbox marks everything seen up to its newest row (`PUT /api/inbox/seen {seq}`); invites stay counted until answered.
6. **The inbox replaces the Invites sheet and its sidebar row.** `GET /api/invites` stays for tabs still on the old client. The bell sits in the top bar for everyone (classes are open to everyone since Stage 6); with nothing unread it shows no count. A row opens what it is about: the item (if it is still on this device), else the class.
7. **Activity tab**: the class sheet's third tab, `GET /api/spaces/:sid/activity?before=<seq>`, 30 rows a page with **Show older**; offline it says "Connect to see activity". Every live member sees it, archived or not.
8. **Purge** (spec §12, §13): activity rows older than 90 days go nightly; a space purged 30 days after deletion takes its own rows with it except those about a person (`subject_user != ''`), which age out at 90 days like the rest. Deleting an account deletes the rows about it and its `inbox_seen` row (cascade); rows it acted in keep its name in `detail.by`.
9. **Member and space rows are written inside the route's batch** with a condition that the act happened in that batch (a membership whose `joined_at` or `deleted_at` is `now`, a role whose `updated_at` is `now`, …), so a retried request that changed nothing writes nothing.

## File map

| File | Change |
|---|---|
| `migrations/0005_activity.sql` | new: `activity`, `inbox_seen`, five triggers |
| `worker/activity.js` | new: `noteStmt`, `inboxRows`, `unreadCount`, `markSeen`, `spaceActivity`, `toApi` |
| `worker/inbox.js` | new: `inboxRoutes` (`GET /api/inbox`, `PUT /api/inbox/seen`, `GET /api/spaces/:sid/activity`) |
| `worker/api.js` | register `inboxRoutes`; `unread` on the last v3 page |
| `worker/invites.js` | `member.joined` on accept and join |
| `worker/spaces.js` | `member.role` on `setRole`; `space.transferred` on `transfer` |
| `worker/leaving.js` | `detach` takes `after`; `member.left`, `member.removed`, `space.archived`; `space.transferred` in `handOnStmts` |
| `worker/db.js` | `purgeTombstones` deletes old activity |
| `worker/accounts.js` | `ACCOUNT_TABLES` gains `activity` rows about the account |
| `worker/admin.js` | `LATEST_MIGRATION = '0005_activity.sql'` |
| `scripts/lib/move-db.js` | `activity`, `inbox_seen` in `TABLES`, `ADDED_TABLES`, `ORDER_BY` |
| `src/core/dates.ts` | `ago` (moved from `src/components/admin/use-admin.ts`, which re-exports it) |
| `src/core/types.ts` | `ActivityRow`, `Inbox` |
| `src/core/api.ts` | `inbox.get`, `inbox.seen`, `spaces.activity`; `PageV3.unread` |
| `src/core/sync.ts` | `onUnread` |
| `src/data/inbox.ts` | new: unread and list stores, `refreshInbox`, `markSeen`, `describe`, `openRow`, `loadActivity` |
| `src/data/classes.ts` | invites move to `inbox.ts`; `openInvites`, `watchInvites`, `refreshInvites` go |
| `src/data/session.ts` | `watchInvites()` call goes; `onUnread` wired |
| `src/data/overlay.ts` | `{kind:'inbox'}` replaces `{kind:'invites'}`; `ClassTab` gains `'activity'` |
| `src/components/inbox-bell.tsx` | new: the bell |
| `src/components/top-bar.tsx` | the bell |
| `src/components/sheet/inbox-sheet.tsx` | new (replaces `invites-sheet.tsx`, deleted) |
| `src/components/sheet/activity-list.tsx` | new: the Activity tab's list (Stage 9 reuses it for projects) |
| `src/components/sheet/class-sheet.tsx` | the Activity tab |
| `src/components/sheet/sheet.tsx` | the inbox sheet |
| `src/components/sidebar-classes.tsx`, `src/components/sidebar.tsx` | `InvitesRow` goes |
| `docs/DATA-MODEL.md`, `docs/PROJECT-OVERVIEW.md`, `docs/DEPLOYING.md`, master plan | the tables, routes, migration row, Stage 7 row and hand-offs |
| Tests | new `test/activity-schema.test.js`, `test/inbox.test.js`, `test/activity-routes.test.js`, `src/data/inbox.test.ts`, `src/components/inbox.test.tsx`; changed `test/purge.test.js`, `test/admin.test.js`, `test/move-db.test.js`, `src/components/sheet/classes.test.tsx`, `src/components/sidebar.test.tsx`, `src/components/sheet/sheet.test.tsx` |

---

### Task 1: The migration: `activity`, `inbox_seen`, the triggers

**Files:**
- Create: `migrations/0005_activity.sql`
- Modify: `worker/admin.js:18`, `scripts/lib/move-db.js:8-28`
- Test: `test/activity-schema.test.js`

- [ ] **Step 1: Write the failing test**

`test/activity-schema.test.js`:

```js
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createUser } from './helpers.js';
import { makeSpace, sharedItem } from './spaces.js';

/* A time on a 10-minute boundary, so T0 and T0 + 9 minutes share a bucket. */
const T0 = 600_000 * 2_833_334;
const MIN = 60_000;
const rows = async (spaceId) => (await env.DB.prepare(`SELECT actor_id, verb, subject, subject_user, old_value, new_value, detail, n
  FROM activity WHERE space_id = ? ORDER BY seq`).bind(spaceId).all()).results.map((r) => ({ ...r, detail: JSON.parse(r.detail) }));
const edit = (scope, id, sets, by, at, ...binds) => env.DB.prepare(`UPDATE items SET ${sets}, updated_by = ?, updated_at = ?, revision = revision + 1
  WHERE scope = ? AND id = ?`).bind(...binds, by, at, scope, id).run();
let n = 0;
async function space(kind = 'class') {
  const tag = ++n, alex = await createUser('aca' + tag, 'Alex'), sam = await createUser('acs' + tag);
  const s = await makeSpace({ kind, members: { [alex]: 'owner', [sam]: 'member' } });
  return { alex, sam, s };
}

describe('activity from shared rows (spec §12)', () => {
  it('records nothing for personal rows', async () => {
    const me = await createUser('acp' + ++n);
    await env.DB.prepare("INSERT INTO items (scope, id, type, title, date, status, created_at, updated_at) VALUES ('u:' || ?, 'x', 'task', 'Mine', '2026-10-15', 'todo', 1, 1)").bind(me).run();
    expect((await env.DB.prepare('SELECT count(*) AS n FROM activity').first()).n).toBe(0);
  });

  it('coalesces creations by one person in ten minutes into one row with up to ten titles', async () => {
    const { alex, s } = await space();
    for (let i = 1; i <= 12; i++) await sharedItem(s.scope, 'a' + i, { course_id: 'web', title: 'Lab ' + i, updated_by: alex, updated_at: T0 + i * 1000 });
    const [r] = await rows(s.id);
    expect(r).toMatchObject({ actor_id: alex, verb: 'item.created', subject: '', subject_user: '', n: 12 });
    expect(r.detail.titles).toEqual(['Lab 1', 'Lab 2', 'Lab 3', 'Lab 4', 'Lab 5', 'Lab 6', 'Lab 7', 'Lab 8', 'Lab 9', 'Lab 10']);
    expect(r.detail.by).toBe('Alex');
  });

  it('keeps the first "from" of a date change and drops the row when it goes back', async () => {
    const { alex, s } = await space();
    await sharedItem(s.scope, 'a1', { course_id: 'web', title: 'REST API', date: '2026-10-15', updated_by: alex, updated_at: T0 - 20 * MIN });
    await edit(s.scope, 'a1', "date = '2026-10-18'", alex, T0);
    await edit(s.scope, 'a1', "date = '2026-10-20', start = '09:00'", alex, T0 + 5 * MIN);
    const moved = (await rows(s.id)).filter((r) => r.verb === 'item.date');
    expect(moved).toEqual([expect.objectContaining({ subject: 'a1', old_value: '2026-10-15||', new_value: '2026-10-20|09:00|', n: 2 })]);
    await edit(s.scope, 'a1', "date = '2026-10-15', start = ''", alex, T0 + 9 * MIN);
    expect((await rows(s.id)).filter((r) => r.verb === 'item.date')).toEqual([]);
  });

  it('records deletion and restoring as one verb, and title and weight changes', async () => {
    const { alex, s } = await space();
    await sharedItem(s.scope, 'a1', { course_id: 'web', title: 'Quiz', weight: 10, updated_by: alex, updated_at: T0 - 30 * MIN });
    await edit(s.scope, 'a1', 'weight = 15, title = ?', alex, T0, 'Quiz 1');
    await edit(s.scope, 'a1', 'deleted_at = ?', alex, T0 + MIN, T0 + MIN);
    const got = (await rows(s.id)).filter((r) => r.verb !== 'item.created').map((r) => [r.verb, r.old_value, r.new_value]);
    expect(got).toEqual([['item.weight', '10.0', '15.0'], ['item.title', 'Quiz', 'Quiz 1'], ['item.deleted', '0', '1']]);
    await edit(s.scope, 'a1', 'deleted_at = NULL', alex, T0 + 2 * MIN);
    expect((await rows(s.id)).some((r) => r.verb === 'item.deleted')).toBe(false);
  });

  it('records class times and the instructor on the class course', async () => {
    const { alex, s } = await space();
    await env.DB.prepare(`UPDATE courses SET meetings = '[{"id":"m1","kind":"Lecture","weekday":1,"start":"09:00","end":"10:00","room":"B2"}]',
      instructor = 'Dr. Ng', updated_by = ?, updated_at = ? WHERE scope = ?`).bind(alex, T0, s.scope).run();
    expect((await rows(s.id)).map((r) => [r.verb, r.subject, r.detail.title])).toEqual([
      ['course.meetings', 'web', 'Web Services'], ['course.instructor', 'web', 'Web Services'],
    ]);
  });

  it('records each new assignee, a task left with nobody, and completion with its assignees', async () => {
    const { alex, sam, s } = await space('project');
    await sharedItem(s.scope, 't1', { title: 'Endpoint', assignees: JSON.stringify([sam]), updated_by: alex, updated_at: T0 });
    await edit(s.scope, 't1', 'assignees = ?', alex, T0 + MIN, JSON.stringify([sam, alex]));
    await edit(s.scope, 't1', "status = 'done', completed_at = ?, completed_by = ?", sam, T0 + 2 * MIN, T0 + 2 * MIN, sam);
    await edit(s.scope, 't1', "assignees = '[]'", alex, T0 + 3 * MIN);
    const got = (await rows(s.id)).filter((r) => r.verb.startsWith('task.'));
    expect(got.map((r) => [r.actor_id, r.verb, r.subject_user, r.new_value])).toEqual([
      [alex, 'task.assigned', sam, sam], [alex, 'task.assigned', alex, alex], [sam, 'task.status', '', 'done'], [alex, 'task.unassigned', '', '[]'],
    ]);
    expect(got[2].detail.assignees).toEqual([sam, alex]);
    expect(got[0].detail.whom).toBe('acs' + n);
  });

  it('writes "everyone" as an empty subject_user', async () => {
    const { alex, s } = await space('project');
    await sharedItem(s.scope, 't2', { title: 'Slides', assignees: '["*"]', updated_by: alex, updated_at: T0 });
    expect((await rows(s.id)).filter((r) => r.verb === 'task.assigned').map((r) => [r.subject_user, r.new_value])).toEqual([['', '*']]);
  });

  it('refuses an unknown verb and keeps inbox_seen per person', async () => {
    const me = await createUser('acq' + ++n);
    await expect(env.DB.prepare("INSERT INTO activity (space_id, verb, bucket, at) VALUES ('abcdefabcdef', 'item.sneezed', 1, 1)").run()).rejects.toThrow(/CHECK constraint failed/);
    await env.DB.prepare('INSERT INTO inbox_seen (user_id, seq) VALUES (?, 5)').bind(me).run();
    await expect(env.DB.prepare('INSERT INTO inbox_seen (user_id, seq) VALUES (?, 6)').bind(me).run()).rejects.toThrow(/UNIQUE|PRIMARY KEY/);
  });
});
```

`makeSpace` (in `test/spaces.js`) makes the class course `web` named "Web Services", and the project item `project`.

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run test/activity-schema.test.js`
Expected: FAIL (`no such table: activity`).

- [ ] **Step 3: Write `migrations/0005_activity.sql`**

```sql
-- What members did in a shared space, as they read it (spec §12): the inbox and each space's
-- Activity tab. Separate from `changes`, which keeps only the latest state of a row for sync.
-- Rows about shared items and courses come from the triggers below, which see OLD and NEW, so
-- "from → to" is the real previous value and the actor is NEW.updated_by; member and space
-- rows are written by their routes (worker/activity.js noteStmt). Rows coalesce per
-- (space, actor, verb, subject, person, 10-minute bucket), keeping the first "from"; a change
-- that returns to where it started deletes its row. Kept 90 days (the nightly purge).

CREATE TABLE activity (
  seq           INTEGER PRIMARY KEY AUTOINCREMENT,
  -- No foreign key: rows about a person outlive the space (a removal, a deleted space).
  space_id      TEXT NOT NULL CHECK (length(space_id) = 12),
  -- Who acted: the user id, '' when unknown. No foreign key: the row outlives the account.
  actor_id      TEXT NOT NULL DEFAULT '',
  verb          TEXT NOT NULL CHECK (verb IN ('item.created', 'item.deleted', 'item.date', 'item.weight', 'item.title',
                  'course.meetings', 'course.instructor', 'task.assigned', 'task.unassigned', 'task.status',
                  'member.joined', 'member.left', 'member.removed', 'member.role',
                  'space.archived', 'space.linked', 'space.transferred', 'space.deleted')),
  -- The item or course id; '' for creations (an import is one row) and space events.
  subject       TEXT NOT NULL DEFAULT '',
  -- Whom it is about (an assignee, a removed member, a new owner); '' for everyone. Never
  -- NULL, so the unique key below can match.
  subject_user  TEXT NOT NULL DEFAULT '',
  old_value     TEXT,
  new_value     TEXT,
  -- {by, title | titles, whom, space, assignees}: names as they were, so a row still reads
  -- after the item, the account or the space is gone.
  detail        TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail) AND json_type(detail) = 'object'),
  -- How many changes this row stands for (creations coalesced into one).
  n             INTEGER NOT NULL DEFAULT 1 CHECK (n >= 1),
  bucket        INTEGER NOT NULL,
  at            INTEGER NOT NULL,
  UNIQUE (space_id, actor_id, verb, subject, subject_user, bucket)
);
-- A space's activity, newest first (the Activity tab; the inbox per space you are in).
CREATE INDEX activity_space ON activity (space_id, seq);
-- Rows about a person (the inbox, even after they left the space).
CREATE INDEX activity_about ON activity (subject_user, seq) WHERE subject_user != '';
-- The nightly purge.
CREATE INDEX activity_at ON activity (at);

-- The last activity row a person read. Kept off users, so reading never moves the profile's revision.
CREATE TABLE inbox_seen (
  user_id  TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  seq      INTEGER NOT NULL DEFAULT 0 CHECK (seq >= 0)
);

-- A shared item made: one row per actor and bucket, holding up to ten titles; and each assignee
-- a new task starts with. The space's own 'project' item is made with the space and is not news.
CREATE TRIGGER activity_items_insert AFTER INSERT ON items
WHEN NEW.scope NOT GLOB 'u:*' AND NEW.deleted_at IS NULL AND NEW.id != 'project' BEGIN
 INSERT INTO activity (space_id, actor_id, verb, subject, subject_user, detail, bucket, at)
 SELECT substr(NEW.scope, 3), COALESCE(NEW.updated_by, ''), 'item.created', '', '',
   json_object('titles', json_array(NEW.title), 'by', (SELECT COALESCE(NULLIF(u.display_name, ''), u.username) FROM users AS u WHERE u.id = NEW.updated_by)),
   NEW.updated_at / 600000, NEW.updated_at
 WHERE true
 ON CONFLICT (space_id, actor_id, verb, subject, subject_user, bucket) DO UPDATE SET n = activity.n + 1, at = excluded.at,
   detail = CASE WHEN json_array_length(activity.detail, '$.titles') < 10
     THEN json_insert(activity.detail, '$.titles[#]', json_extract(excluded.detail, '$.titles[0]')) ELSE activity.detail END;
 INSERT INTO activity (space_id, actor_id, verb, subject, subject_user, new_value, detail, bucket, at)
 SELECT substr(NEW.scope, 3), COALESCE(NEW.updated_by, ''), 'task.assigned', NEW.id, CASE WHEN a.value = '*' THEN '' ELSE a.value END, a.value,
   json_object('title', NEW.title, 'by', (SELECT COALESCE(NULLIF(u.display_name, ''), u.username) FROM users AS u WHERE u.id = NEW.updated_by),
     'whom', (SELECT COALESCE(NULLIF(w.display_name, ''), w.username) FROM users AS w WHERE w.id = a.value)),
   NEW.updated_at / 600000, NEW.updated_at
 FROM json_each(NEW.assignees) AS a WHERE NEW.type = 'task'
 ON CONFLICT (space_id, actor_id, verb, subject, subject_user, bucket) DO UPDATE SET at = excluded.at, detail = excluded.detail;
END;

-- A shared item changed. Each statement records one kind of change; the last deletes any row
-- this change brought back to where it started.
CREATE TRIGGER activity_items_update AFTER UPDATE ON items WHEN NEW.scope NOT GLOB 'u:*' BEGIN
 INSERT INTO activity (space_id, actor_id, verb, subject, subject_user, old_value, new_value, detail, bucket, at)
 SELECT substr(NEW.scope, 3), COALESCE(NEW.updated_by, ''), 'item.deleted', NEW.id, '',
   CASE WHEN OLD.deleted_at IS NULL THEN '0' ELSE '1' END, CASE WHEN NEW.deleted_at IS NULL THEN '0' ELSE '1' END,
   json_object('title', NEW.title, 'by', (SELECT COALESCE(NULLIF(u.display_name, ''), u.username) FROM users AS u WHERE u.id = NEW.updated_by)),
   NEW.updated_at / 600000, NEW.updated_at
 WHERE (OLD.deleted_at IS NULL) != (NEW.deleted_at IS NULL)
 ON CONFLICT (space_id, actor_id, verb, subject, subject_user, bucket) DO UPDATE SET new_value = excluded.new_value, n = activity.n + 1, at = excluded.at, detail = excluded.detail;
 INSERT INTO activity (space_id, actor_id, verb, subject, subject_user, old_value, new_value, detail, bucket, at)
 SELECT substr(NEW.scope, 3), COALESCE(NEW.updated_by, ''), 'item.date', NEW.id, '',
   OLD.date || '|' || OLD.start || '|' || OLD.end, NEW.date || '|' || NEW.start || '|' || NEW.end,
   json_object('title', NEW.title, 'by', (SELECT COALESCE(NULLIF(u.display_name, ''), u.username) FROM users AS u WHERE u.id = NEW.updated_by)),
   NEW.updated_at / 600000, NEW.updated_at
 WHERE NEW.deleted_at IS NULL AND (OLD.date != NEW.date OR OLD.start != NEW.start OR OLD.end != NEW.end)
 ON CONFLICT (space_id, actor_id, verb, subject, subject_user, bucket) DO UPDATE SET new_value = excluded.new_value, n = activity.n + 1, at = excluded.at, detail = excluded.detail;
 INSERT INTO activity (space_id, actor_id, verb, subject, subject_user, old_value, new_value, detail, bucket, at)
 SELECT substr(NEW.scope, 3), COALESCE(NEW.updated_by, ''), 'item.weight', NEW.id, '', CAST(OLD.weight AS TEXT), CAST(NEW.weight AS TEXT),
   json_object('title', NEW.title, 'by', (SELECT COALESCE(NULLIF(u.display_name, ''), u.username) FROM users AS u WHERE u.id = NEW.updated_by)),
   NEW.updated_at / 600000, NEW.updated_at
 WHERE NEW.deleted_at IS NULL AND OLD.weight IS NOT NEW.weight
 ON CONFLICT (space_id, actor_id, verb, subject, subject_user, bucket) DO UPDATE SET new_value = excluded.new_value, n = activity.n + 1, at = excluded.at, detail = excluded.detail;
 INSERT INTO activity (space_id, actor_id, verb, subject, subject_user, old_value, new_value, detail, bucket, at)
 SELECT substr(NEW.scope, 3), COALESCE(NEW.updated_by, ''), 'item.title', NEW.id, '', OLD.title, NEW.title,
   json_object('title', NEW.title, 'by', (SELECT COALESCE(NULLIF(u.display_name, ''), u.username) FROM users AS u WHERE u.id = NEW.updated_by)),
   NEW.updated_at / 600000, NEW.updated_at
 WHERE NEW.deleted_at IS NULL AND OLD.title != NEW.title
 ON CONFLICT (space_id, actor_id, verb, subject, subject_user, bucket) DO UPDATE SET new_value = excluded.new_value, n = activity.n + 1, at = excluded.at, detail = excluded.detail;
 INSERT INTO activity (space_id, actor_id, verb, subject, subject_user, new_value, detail, bucket, at)
 SELECT substr(NEW.scope, 3), COALESCE(NEW.updated_by, ''), 'task.assigned', NEW.id, CASE WHEN a.value = '*' THEN '' ELSE a.value END, a.value,
   json_object('title', NEW.title, 'by', (SELECT COALESCE(NULLIF(u.display_name, ''), u.username) FROM users AS u WHERE u.id = NEW.updated_by),
     'whom', (SELECT COALESCE(NULLIF(w.display_name, ''), w.username) FROM users AS w WHERE w.id = a.value)),
   NEW.updated_at / 600000, NEW.updated_at
 FROM json_each(NEW.assignees) AS a
 WHERE NEW.type = 'task' AND NEW.deleted_at IS NULL AND a.value NOT IN (SELECT o.value FROM json_each(OLD.assignees) AS o)
 ON CONFLICT (space_id, actor_id, verb, subject, subject_user, bucket) DO UPDATE SET at = excluded.at, detail = excluded.detail;
 INSERT INTO activity (space_id, actor_id, verb, subject, subject_user, old_value, new_value, detail, bucket, at)
 SELECT substr(NEW.scope, 3), COALESCE(NEW.updated_by, ''), 'task.unassigned', NEW.id, '', OLD.assignees, '[]',
   json_object('title', NEW.title, 'by', (SELECT COALESCE(NULLIF(u.display_name, ''), u.username) FROM users AS u WHERE u.id = NEW.updated_by)),
   NEW.updated_at / 600000, NEW.updated_at
 WHERE NEW.type = 'task' AND NEW.deleted_at IS NULL AND NEW.assignees = '[]' AND OLD.assignees != '[]'
 ON CONFLICT (space_id, actor_id, verb, subject, subject_user, bucket) DO UPDATE SET new_value = excluded.new_value, n = activity.n + 1, at = excluded.at, detail = excluded.detail;
 INSERT INTO activity (space_id, actor_id, verb, subject, subject_user, old_value, new_value, detail, bucket, at)
 SELECT substr(NEW.scope, 3), COALESCE(NEW.updated_by, ''), 'task.status', NEW.id, '',
   CASE WHEN OLD.completed_at IS NULL THEN 'todo' ELSE 'done' END, CASE WHEN NEW.completed_at IS NULL THEN 'todo' ELSE 'done' END,
   json_object('title', NEW.title, 'by', (SELECT COALESCE(NULLIF(u.display_name, ''), u.username) FROM users AS u WHERE u.id = NEW.updated_by),
     'assignees', json(NEW.assignees)),
   NEW.updated_at / 600000, NEW.updated_at
 WHERE NEW.scope GLOB 'p:*' AND NEW.type = 'task' AND NEW.deleted_at IS NULL AND (OLD.completed_at IS NULL) != (NEW.completed_at IS NULL)
 ON CONFLICT (space_id, actor_id, verb, subject, subject_user, bucket) DO UPDATE SET new_value = excluded.new_value, n = activity.n + 1, at = excluded.at, detail = excluded.detail;
 DELETE FROM activity WHERE space_id = substr(NEW.scope, 3) AND actor_id = COALESCE(NEW.updated_by, '') AND bucket = NEW.updated_at / 600000
   AND subject = NEW.id AND subject_user = '' AND verb IN ('item.deleted', 'item.date', 'item.weight', 'item.title', 'task.status') AND old_value IS new_value;
END;

-- A class's course changed: its weekly times and rooms, or its instructor.
CREATE TRIGGER activity_courses_update AFTER UPDATE ON courses WHEN NEW.scope GLOB 'c:*' AND NEW.deleted_at IS NULL BEGIN
 INSERT INTO activity (space_id, actor_id, verb, subject, subject_user, old_value, new_value, detail, bucket, at)
 SELECT substr(NEW.scope, 3), COALESCE(NEW.updated_by, ''), 'course.meetings', NEW.id, '', OLD.meetings, NEW.meetings,
   json_object('title', NEW.name, 'by', (SELECT COALESCE(NULLIF(u.display_name, ''), u.username) FROM users AS u WHERE u.id = NEW.updated_by)),
   NEW.updated_at / 600000, NEW.updated_at
 WHERE OLD.meetings != NEW.meetings
 ON CONFLICT (space_id, actor_id, verb, subject, subject_user, bucket) DO UPDATE SET new_value = excluded.new_value, n = activity.n + 1, at = excluded.at, detail = excluded.detail;
 INSERT INTO activity (space_id, actor_id, verb, subject, subject_user, old_value, new_value, detail, bucket, at)
 SELECT substr(NEW.scope, 3), COALESCE(NEW.updated_by, ''), 'course.instructor', NEW.id, '', OLD.instructor, NEW.instructor,
   json_object('title', NEW.name, 'by', (SELECT COALESCE(NULLIF(u.display_name, ''), u.username) FROM users AS u WHERE u.id = NEW.updated_by)),
   NEW.updated_at / 600000, NEW.updated_at
 WHERE OLD.instructor != NEW.instructor
 ON CONFLICT (space_id, actor_id, verb, subject, subject_user, bucket) DO UPDATE SET new_value = excluded.new_value, n = activity.n + 1, at = excluded.at, detail = excluded.detail;
 DELETE FROM activity WHERE space_id = substr(NEW.scope, 3) AND actor_id = COALESCE(NEW.updated_by, '') AND bucket = NEW.updated_at / 600000
   AND subject = NEW.id AND subject_user = '' AND verb IN ('course.meetings', 'course.instructor') AND old_value IS new_value;
END;
```

Notes for the implementer:
- `WHERE true` on the first INSERT is not optional: SQLite parses `INSERT … SELECT … ON CONFLICT` as a join constraint without a WHERE (the master plan's Stage 7 outline, verified on D1 on 2026-10-05).
- `NEW.updated_at / 600000` is integer division (both integers).
- If D1 refuses `json_insert(…, '$.titles[#]', …)`, use `json_insert(activity.detail, '$.titles[' || json_array_length(activity.detail, '$.titles') || ']', …)`; the creations test tells you.

- [ ] **Step 4: Bump the expected migration and the move**

`worker/admin.js:18`: `export const LATEST_MIGRATION = '0005_activity.sql';`

`scripts/lib/move-db.js`: add to `TABLES`, after `space_prefs`:

```js
  activity: ['seq', 'space_id', 'actor_id', 'verb', 'subject', 'subject_user', 'old_value', 'new_value', 'detail', 'n', 'bucket', 'at'],
  inbox_seen: ['user_id', 'seq'],
```

The comment above `ADDED_TABLES` becomes "(0002_spaces.sql … 0005_activity.sql)", the set gains `'activity', 'inbox_seen'`, and `ORDER_BY` gains `activity: 'seq', inbox_seen: 'user_id'`. Moving `activity` writes rows into the target, whose triggers do not fire on `activity` itself, so nothing doubles.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run test/activity-schema.test.js test/admin.test.js test/move-db.test.js test/marks-schema.test.js`
Expected: PASS. If `test/move-db.test.js` lists the tables it expects to see moved, add `activity` and `inbox_seen` there in this step.

- [ ] **Step 6: Check nothing counts shared-row writes with `meta.changes`**

Run: `grep -n "meta.changes" worker/*.js`
Expected: every hit is on a statement against `spaces`, `members`, `invites`, `marks` or `space_prefs` (no activity trigger), or on one whose own row count does not matter. For any hit on an `items`/`courses` statement, switch it to a following `db.prepare('SELECT changes() AS n')`, as `absorb` does, and run that module's tests.

- [ ] **Step 7: Commit**

```bash
git add migrations/0005_activity.sql worker/admin.js scripts/lib/move-db.js test/activity-schema.test.js test/move-db.test.js
git commit -m "Stage 7: activity and inbox_seen tables; triggers record changes to shared rows

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The inbox and the Activity tab on the Worker

**Files:**
- Create: `worker/activity.js`, `worker/inbox.js`
- Modify: `worker/api.js` (register the routes)
- Test: `test/inbox.test.js`

- [ ] **Step 1: Write the failing test**

`test/inbox.test.js`:

```js
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { signIn } from './helpers.js';
import { makeSpace, sharedItem } from './spaces.js';

let n = 0;
const at = (ms) => ({ updated_at: ms, created_at: ms });
async function team() {
  const tag = ++n, alex = await signIn('ina' + tag), sam = await signIn('ins' + tag), out = await signIn('ino' + tag);
  alex.id = 'u-ina' + tag; sam.id = 'u-ins' + tag; out.id = 'u-ino' + tag;
  const s = await makeSpace({ members: { [alex.id]: 'owner', [sam.id]: 'member' } });
  return { alex, sam, out, s };
}
const inbox = async (api) => (await api('/api/inbox')).json();

describe('GET /api/inbox (spec §12)', () => {
  it("holds others' news in your spaces since you joined, never your own", async () => {
    const { alex, sam, s } = await team();
    await sharedItem(s.scope, 'a1', { course_id: 'web', title: 'Lab 1', updated_by: alex.id, ...at(Date.now()) });
    await sharedItem(s.scope, 'a2', { course_id: 'web', title: 'Lab 2', updated_by: sam.id, ...at(Date.now() + 700_000) });
    const box = await inbox(sam);
    expect(box.items.map((r) => [r.verb, r.detail.titles])).toEqual([['item.created', ['Lab 1']]]);
    expect(box.items[0]).toMatchObject({ spaceId: s.id, space: 'Web Services', kind: 'class', actor: alex.id, about: false });
    expect(box.invites).toEqual([]);
    expect(box.seen).toBe(0);
  });

  it('leaves out activity from before you joined and verbs that do not concern you', async () => {
    const { alex, sam, s } = await team();
    await env.DB.prepare('UPDATE members SET joined_at = ? WHERE space_id = ? AND user_id = ?').bind(Date.now(), s.id, sam.id).run();
    /* 20 minutes back: another bucket, so it cannot coalesce with the creation below */
    await sharedItem(s.scope, 'old', { course_id: 'web', updated_by: alex.id, ...at(Date.now() - 1_200_000) });
    await sharedItem(s.scope, 'a1', { course_id: 'web', title: 'Quiz', weight: 5, updated_by: alex.id, ...at(Date.now() + 1000) });
    await env.DB.prepare('UPDATE items SET weight = 7, updated_by = ?, updated_at = ? WHERE scope = ? AND id = ?').bind(alex.id, Date.now() + 2000, s.scope, 'a1').run();
    expect((await inbox(sam)).items.map((r) => r.verb)).toEqual(['item.created']);
  });

  it('keeps rows about you after you left, and nothing else from that space', async () => {
    const { alex, sam, s } = await team();
    await env.DB.prepare(`INSERT INTO activity (space_id, actor_id, verb, subject_user, detail, bucket, at)
      VALUES (?, ?, 'member.removed', ?, '{"space":"Web Services","by":"Alex"}', 1, ?)`).bind(s.id, alex.id, sam.id, Date.now()).run();
    await env.DB.prepare('UPDATE members SET deleted_at = 5 WHERE space_id = ? AND user_id = ?').bind(s.id, sam.id).run();
    await sharedItem(s.scope, 'a3', { course_id: 'web', updated_by: alex.id, ...at(Date.now() + 1000) });
    const box = await inbox(sam);
    expect(box.items.map((r) => [r.verb, r.about, r.space])).toEqual([['member.removed', true, 'Web Services']]);
  });

  it('lists your pending invites', async () => {
    const { alex, out, s } = await team();
    await env.DB.prepare("INSERT INTO invites (space_id, user_id, invited_by, role, created_at, expires_at) VALUES (?, ?, ?, 'member', ?, ?)")
      .bind(s.id, out.id, alex.id, Date.now(), Date.now() + 86_400_000).run();
    expect((await inbox(out)).invites).toEqual([expect.objectContaining({ spaceId: s.id, name: 'Web Services', expired: false })]);
  });
});

describe('PUT /api/inbox/seen', () => {
  it('moves forward only, never past the newest row', async () => {
    const { alex, sam, s } = await team();
    await sharedItem(s.scope, 'a1', { course_id: 'web', updated_by: alex.id, ...at(Date.now()) });
    const top = (await inbox(sam)).items[0].seq;
    const put = (seq) => sam('/api/inbox/seen', { method: 'PUT', body: { seq } });
    expect((await put(top + 1000)).status).toBe(204);
    expect((await inbox(sam)).seen).toBe(top);
    await put(0);
    expect((await inbox(sam)).seen).toBe(top);
    expect((await put(-1)).status).toBe(400);
    expect((await put('x')).status).toBe(400);
  });
});

describe('GET /api/spaces/:sid/activity', () => {
  it("shows a member the space's whole history, newest first, a page at a time; 404 outside it", async () => {
    const { alex, sam, out, s } = await team();
    for (let i = 0; i < 32; i++) await sharedItem(s.scope, 'b' + i, { course_id: 'web', updated_by: alex.id, ...at(Date.now() + i * 700_000) });
    const first = await (await sam(`/api/spaces/${s.id}/activity`)).json();
    expect(first.items).toHaveLength(30);
    expect(first.more).toBe(true);
    const rest = await (await sam(`/api/spaces/${s.id}/activity?before=${first.items[29].seq}`)).json();
    expect(rest.items).toHaveLength(2);
    expect(rest.more).toBe(false);
    expect((await out(`/api/spaces/${s.id}/activity`)).status).toBe(404);
    expect((await sam(`/api/spaces/${s.id}/activity?before=x`)).status).toBe(400);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run test/inbox.test.js`
Expected: FAIL (`404` for `/api/inbox`).

- [ ] **Step 3: Write `worker/activity.js`**

```js
// Activity (spec §12): the rows routes write for member and space events (the triggers in
// migrations/0005_activity.sql write the rest), and the reads: your inbox, its unread count,
// and a space's Activity tab. Nothing is fanned out: the inbox is a query over the spaces you
// are in and the rows about you.
import { memberGuard, assertAllowed } from './access.js';

export const BUCKET_MS = 600_000;
const NAME = (id) => `(SELECT COALESCE(NULLIF(u.display_name, ''), u.username) FROM users AS u WHERE u.id = ${id})`;
/** A space's name now: its class course's, or its project item's title. `id` is SQL for the space id. */
export const SPACE_NAME = (id) => `(SELECT CASE s.kind WHEN 'class' THEN (SELECT name FROM courses WHERE scope = 'c:' || s.id LIMIT 1)
  ELSE (SELECT title FROM items WHERE scope = 'p:' || s.id AND id = 'project') END FROM spaces AS s WHERE s.id = ${id})`;

/**
 * An activity row a route writes in its own batch (Decision 9): who did what in a space, about
 * whom. `when` is SQL that holds only if the act happened in this batch, using ?9 onwards for
 * `binds`; ?1 the space, ?2 the actor, ?4 the person it is about, ?8 now. detail gains the
 * actor's and the person's names and the space's name as they are now.
 */
export function noteStmt(db, { spaceId, actorId, verb, subjectUser = '', oldValue = null, newValue = null, detail = {}, now, when = '1', binds = [] }) {
  return db.prepare(`INSERT INTO activity (space_id, actor_id, verb, subject, subject_user, old_value, new_value, detail, bucket, at)
    SELECT ?1, ?2, ?3, '', ?4, ?5, ?6, json_set(?7, '$.by', ${NAME('?2')}, '$.whom', ${NAME('?4')}, '$.space', ${SPACE_NAME('?1')}), ?8 / ${BUCKET_MS}, ?8
    WHERE ${when}
    ON CONFLICT (space_id, actor_id, verb, subject, subject_user, bucket) DO UPDATE SET
      new_value = excluded.new_value, n = activity.n + 1, at = excluded.at, detail = excluded.detail`)
    .bind(spaceId, actorId, verb, subjectUser, oldValue, newValue, JSON.stringify(detail), now, ...binds);
}

/* Verbs every member is told of; the rest reach someone only when they are about them (Decision 4). a = activity, ?1 you. */
const CONCERNS = `(a.verb IN ('item.created', 'item.deleted', 'item.date', 'course.meetings', 'space.archived', 'space.linked')
  OR (a.verb = 'task.assigned' AND a.subject_user = '')
  OR (a.verb = 'task.status' AND EXISTS (SELECT 1 FROM json_each(a.detail, '$.assignees') AS j WHERE j.value IN (?1, '*'))))`;
const COLS = 'a.seq, a.space_id, a.actor_id, a.verb, a.subject, a.subject_user, a.old_value, a.new_value, a.detail, a.n, a.at';
/* The inbox's rows above `since` (SQL): about you anywhere, and what concerns you in your live spaces since you joined. */
const INBOX = (since) => `SELECT ${COLS} FROM activity AS a WHERE a.subject_user = ?1 AND a.actor_id != ?1 AND a.seq > ${since}
  UNION ALL
  SELECT ${COLS} FROM members AS m JOIN activity AS a ON a.space_id = m.space_id AND a.seq > ${since} AND a.at >= m.joined_at
  WHERE m.user_id = ?1 AND m.deleted_at IS NULL AND a.actor_id != ?1 AND a.subject_user != ?1 AND ${CONCERNS}`;
const SEEN = '(SELECT COALESCE(MAX(seq), 0) FROM inbox_seen WHERE user_id = ?1)';

/** A row as the API answers it; `about` is whether it is about you. */
export function toApi(r, userId) {
  return {
    seq: r.seq, spaceId: r.space_id, space: r.space ?? JSON.parse(r.detail).space ?? '', kind: r.kind ?? null, verb: r.verb, subject: r.subject,
    actor: r.actor_id, subjectUser: r.subject_user, about: r.subject_user === userId,
    old: r.old_value, new: r.new_value, detail: JSON.parse(r.detail), n: r.n, at: r.at,
  };
}

/** Your inbox's newest 50 rows within the 90 days kept, and where you have read up to. */
export async function inboxRows(db, userId) {
  const [rows, seen] = await db.batch([
    db.prepare(`SELECT x.*, COALESCE(${SPACE_NAME('x.space_id')}, json_extract(x.detail, '$.space')) AS space,
        (SELECT kind FROM spaces WHERE id = x.space_id) AS kind
      FROM (${INBOX('0')}) AS x ORDER BY x.seq DESC LIMIT 50`).bind(userId),
    db.prepare(`SELECT ${SEEN} AS seq`).bind(userId),
  ]);
  return { items: rows.results.map((r) => toApi(r, userId)), seen: seen.results[0].seq };
}

/** Unread (Decision 5): pending unexpired invites plus inbox rows above what you read; at most 99. */
export async function unreadCount(db, userId, now = Date.now()) {
  const r = await db.prepare(`SELECT MIN(99,
      (SELECT count(*) FROM invites WHERE user_id = ?1 AND status = 'pending' AND expires_at > ?2)
      + (SELECT count(*) FROM (SELECT 1 FROM (${INBOX(SEEN)}) LIMIT 100))) AS n`).bind(userId, now).first();
  return r.n;
}

/** You have read up to `seq`: forward only, never past the newest row there is. */
export function markSeen(db, userId, seq) {
  return db.prepare(`INSERT INTO inbox_seen (user_id, seq) VALUES (?1, MIN(?2, COALESCE((SELECT MAX(seq) FROM activity), 0)))
    ON CONFLICT (user_id) DO UPDATE SET seq = MAX(inbox_seen.seq, excluded.seq)`).bind(userId, seq).run();
}

export const PAGE = 30;
/** A space's Activity tab (Decision 7): 30 rows below `before` (all when null), newest first, for a live member. 404 outside it. */
export async function spaceActivity(db, userId, spaceId, before = null) {
  const me = await assertAllowed(db, userId, spaceId, 'read');
  const g = memberGuard(spaceId, userId);
  const { results } = await db.prepare(`SELECT ${COLS} FROM activity AS a WHERE a.space_id = ? AND a.seq < ? AND ${g.sql}
    ORDER BY a.seq DESC LIMIT ?`).bind(spaceId, before ?? Number.MAX_SAFE_INTEGER, ...g.binds, PAGE + 1).all();
  return { items: results.slice(0, PAGE).map((r) => toApi({ ...r, kind: me.kind }, userId)), more: results.length > PAGE };
}
```

`toApi` reads `r.space` (the inbox query's live name, else `detail.space`); for the Activity tab the sheet already knows the space's name, so `space` falls back to `detail.space` or `''`.

- [ ] **Step 4: Write `worker/inbox.js`**

```js
// The inbox and a space's Activity tab (spec §12, §14). Reads only: activity is written by
// triggers and by the routes that change members and spaces.
import { json, readJson, HttpError } from './http.js';
import { requireUser } from './auth.js';
import { myInvites } from './invites.js';
import { inboxRows, markSeen, spaceActivity } from './activity.js';

const route = (path) => new RegExp(`^/api/${path}$`);
const seqOf = (v, field) => {
  const n = typeof v === 'string' && /^\d{1,16}$/.test(v) ? Number(v) : v;
  if (!Number.isSafeInteger(n) || n < 0) throw new HttpError(400, { error: 'invalid', field });
  return n;
};

export const inboxRoutes = [
  ['GET', route('inbox'), async ({ request, env }) => {
    const userId = await requireUser(request, env);
    const [invites, box] = await Promise.all([myInvites(env.DB, userId), inboxRows(env.DB, userId)]);
    return json({ invites, ...box });
  }],
  ['PUT', route('inbox/seen'), async ({ request, env }) => {
    const userId = await requireUser(request, env);
    await markSeen(env.DB, userId, seqOf((await readJson(request)).seq, 'seq'));
    return new Response(null, { status: 204 });
  }],
  ['GET', route('spaces/([a-z0-9]{12})/activity'), async ({ request, env, url, params: [sid] }) => {
    const userId = await requireUser(request, env);
    const raw = url.searchParams.get('before');
    return json(await spaceActivity(env.DB, userId, sid, raw === null || raw === '' ? null : seqOf(raw, 'before')));
  }],
];
```

- [ ] **Step 5: Register them in `worker/api.js`**

Add `import { inboxRoutes } from './inbox.js';` beside `layerRoutes`, and spread `...inboxRoutes` into `routes` where `...classRoutes` and `...layerRoutes` are spread (`grep -n "classRoutes" worker/api.js` finds the line). If the maintenance guard (`guardMaintenance`) lists the class routes by path to answer 503 while classes are switched off, add `/api/inbox` and `/api/spaces/:sid/activity` to it the same way (`grep -n "spaces" worker/maintenance.js`).

- [ ] **Step 6: Run the tests**

Run: `npx vitest run test/inbox.test.js test/invites.test.js test/maintenance.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add worker/activity.js worker/inbox.js worker/api.js worker/maintenance.js test/inbox.test.js
git commit -m "Stage 7: the inbox, its read marker and a space's activity on the Worker

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Member and space events from the routes

**Files:**
- Modify: `worker/invites.js` (`acceptInvite`, `joinByCode`), `worker/spaces.js` (`setRole`, `transfer`), `worker/leaving.js` (`detach`, `leave`, `removeMember`, `setArchived`, `handOnStmts`; all defined by the Stage 5 plan, Tasks 1–3 and 6)
- Test: `test/activity-routes.test.js`

- [ ] **Step 1: Write the failing test**

`test/activity-routes.test.js`:

```js
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { signIn } from './helpers.js';
import { makeSpace, post } from './spaces.js';

let n = 0;
const verbs = async (spaceId) => (await env.DB.prepare(`SELECT actor_id, verb, subject_user, old_value, new_value, json_extract(detail, '$.space') AS space
  FROM activity WHERE space_id = ? AND verb GLOB 'member.*' OR (space_id = ? AND verb GLOB 'space.*') ORDER BY seq`).bind(spaceId, spaceId).all()).results;
async function people() {
  const tag = ++n;
  const make = async (p) => { const api = await signIn(p + tag); api.id = 'u-' + p + tag; return api; };
  return { owner: await make('aro'), ed: await make('are'), guest: await make('arg') };
}

describe('member and space activity (spec §12)', () => {
  it('records a join by invite once, however often accept is retried', async () => {
    const { owner, guest } = await people();
    const s = await makeSpace({ members: { [owner.id]: 'owner' } });
    await env.DB.prepare("INSERT INTO invites (space_id, user_id, invited_by, role, created_at, expires_at) VALUES (?, ?, ?, 'member', ?, ?)")
      .bind(s.id, guest.id, owner.id, Date.now(), Date.now() + 86_400_000).run();
    await post(guest, `/api/invites/${s.id}/accept`);
    await post(guest, `/api/invites/${s.id}/accept`);
    expect(await verbs(s.id)).toEqual([{ actor_id: guest.id, verb: 'member.joined', subject_user: '', old_value: null, new_value: null, space: 'Web Services' }]);
  });

  it('records a role change and a transfer about the person they concern', async () => {
    const { owner, ed } = await people();
    const s = await makeSpace({ members: { [owner.id]: 'owner', [ed.id]: 'member' } });
    await owner(`/api/spaces/${s.id}/members/${ed.id}`, { method: 'PUT', body: { role: 'editor' } });
    await owner(`/api/spaces/${s.id}/members/${ed.id}`, { method: 'PUT', body: { role: 'editor' } });
    await post(owner, `/api/spaces/${s.id}/transfer`, { userId: ed.id });
    expect((await verbs(s.id)).map((r) => [r.verb, r.subject_user, r.old_value, r.new_value])).toEqual([
      ['member.role', ed.id, 'member', 'editor'], ['space.transferred', ed.id, null, null],
    ]);
  });

  it('records leaving, a removal (about the removed person) and archiving', async () => {
    const { owner, ed, guest } = await people();
    const s = await makeSpace({ members: { [owner.id]: 'owner', [ed.id]: 'member', [guest.id]: 'member' } });
    await post(ed, `/api/spaces/${s.id}/leave`, { keepCopy: false });
    await owner(`/api/spaces/${s.id}/members/${guest.id}`, { method: 'DELETE' });
    await post(owner, `/api/spaces/${s.id}/archive`, { archived: true });
    await post(owner, `/api/spaces/${s.id}/archive`, { archived: true });
    expect((await verbs(s.id)).map((r) => [r.actor_id, r.verb, r.subject_user, r.new_value])).toEqual([
      [ed.id, 'member.left', '', null], [owner.id, 'member.removed', guest.id, null], [owner.id, 'space.archived', '', '1'],
    ]);
  });
});
```

The `/archive`, `/leave` and `DELETE …/members/:uid` routes are the Stage 5 plan's (Tasks 2 and 3).

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run test/activity-routes.test.js`
Expected: FAIL (no member or space rows).

- [ ] **Step 3: Accept and join (`worker/invites.js`)**

Add `import { noteStmt } from './activity.js';`. A joiner is a member whose `joined_at` is this batch's `now`:

```js
/* member.joined, only when the membership was made or revived in this batch. */
const joinedNote = (db, spaceId, userId, now) => noteStmt(db, { spaceId, actorId: userId, verb: 'member.joined', now,
  when: 'EXISTS (SELECT 1 FROM members WHERE space_id = ?1 AND user_id = ?2 AND deleted_at IS NULL AND joined_at = ?8)' });
```

In `acceptInvite`'s batch, append `joinedNote(db, spaceId, userId, now)` after `joinPrefs(…)`. In `joinByCode`'s batch, append `joinedNote(db, space.id, userId, now)` after `joinPrefs(…)`. Both stay last, so the `changes()` conditions in `touchSpace` and the code update still read the statements they were written for.

- [ ] **Step 4: Roles and transfer (`worker/spaces.js`)**

Add `import { noteStmt } from './activity.js';` (check `worker/activity.js` does not import `worker/spaces.js`, so there is no cycle).

In `setRole`'s batch, after `touchSpace(…)`, append (a role write moves only between `editor` and `member`, so the old role is the other one):

```js
    noteStmt(db, { spaceId, actorId: userId, verb: 'member.role', subjectUser: targetId, oldValue: role === 'editor' ? 'member' : 'editor', newValue: role, now,
      when: 'EXISTS (SELECT 1 FROM members WHERE space_id = ?1 AND user_id = ?4 AND role = ?6 AND updated_at = ?8 AND deleted_at IS NULL)' }),
```

In `transfer`'s batch, after `touchSpace(…)`, append:

```js
    noteStmt(db, { spaceId, actorId: userId, verb: 'space.transferred', subjectUser: targetId, now,
      when: "EXISTS (SELECT 1 FROM members WHERE space_id = ?1 AND user_id = ?4 AND role = 'owner' AND updated_at = ?8)" }),
```

- [ ] **Step 5: Leaving, removing, archiving, handing on (`worker/leaving.js`)**

Add `import { noteStmt } from './activity.js';`.

`detach` (Stage 5 plan, Task 1 Step 5) gains an `after` option of statements run at the end of its batch; its answer still comes from the `SELECT changes()` after the membership update:

```js
export async function detach(db, userId, spaceId, { keepCopy, who, actor = null, closing = false, after = [], now = Date.now() }) {
```

and its tail becomes:

```js
  const counted = stmts.length - 2;   // the SELECT changes() after the membership update
  stmts.push(...after);
  const results = await db.batch(stmts);
  return results[counted].results[0].n > 0;
```

(`counted` is computed right after the `stmts.push(members update, SELECT changes(), touch/close)` call, so it indexes the `SELECT changes()`.)

A membership that ended in this batch has `deleted_at = now`:

```js
const ENDED = 'EXISTS (SELECT 1 FROM members WHERE space_id = ?1 AND user_id = ?9 AND deleted_at = ?8)';
```

In `leave`, pass `after: [noteStmt(db, { spaceId, actorId: userId, verb: 'member.left', now, when: ENDED, binds: [userId] })]` to `detach`. In `removeMember`, pass `after: [noteStmt(db, { spaceId, actorId: userId, verb: 'member.removed', subjectUser: targetId, now, when: ENDED, binds: [targetId] })]`. `deleteClass` writes nothing: the owner is its only member, and the space goes.

`setArchived` becomes a batch:

```js
  await db.batch([
    db.prepare(`UPDATE spaces SET archived = ?, updated_at = ?, revision = ${NEXT_SPACE_REVISION} WHERE id = ? AND archived != ? AND ${g.sql}`)
      .bind(a, now, spaceId, a, ...g.binds),
    noteStmt(db, { spaceId, actorId: userId, verb: 'space.archived', oldValue: String(1 - a), newValue: String(a), now,
      when: 'EXISTS (SELECT 1 FROM spaces WHERE id = ?1 AND archived = CAST(?6 AS INTEGER) AND updated_at = ?8)' }),
  ]);
```

In `handOnStmts` (Stage 5 plan, Task 6), inside `if (heir)`, after the two member updates, push:

```js
        noteStmt(db, { spaceId: id, actorId: userId, verb: 'space.transferred', subjectUser: heir, now }),
```

It runs before the account's rows are deleted (the batch puts `handOn` first), so `detail.by` still finds the name.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run test/activity-routes.test.js test/leaving.test.js test/space-admin.test.js test/members.test.js test/invites.test.js test/join-code.test.js test/admin.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add worker/invites.js worker/spaces.js worker/leaving.js test/activity-routes.test.js
git commit -m "Stage 7: joins, leaves, removals, roles, transfers and archiving write activity

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Unread on sync; the purge; account deletion

**Files:**
- Modify: `worker/api.js` (the sync route), `worker/db.js` (`purgeTombstones`), `worker/accounts.js`
- Test: `test/inbox.test.js` (new `describe`), `test/purge.test.js`, `test/admin.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `test/inbox.test.js`:

```js
describe('the unread count on sync (Decision 5)', () => {
  it('rides on the last v3 page: invites plus unread rows, and drops once seen', async () => {
    const { alex, sam, s } = await team();
    await sharedItem(s.scope, 'a1', { course_id: 'web', updated_by: alex.id, ...at(Date.now()) });
    const page = async () => (await sam(`/api/sync?v=3&cursors=${encodeURIComponent('u:' + sam.id + ':0')}&sv=0`)).json();
    const first = await page();
    expect(first.more).toBe(false);
    expect(first.unread).toBe(1);
    const top = (await inbox(sam)).items[0].seq;
    await sam('/api/inbox/seen', { method: 'PUT', body: { seq: top } });
    expect((await page()).unread).toBe(0);
  });
});
```

Append to `test/purge.test.js` (inside its nightly-purge `describe`, using its `runNightly`, `one` and `DAY`):

```js
  it('deletes activity after 90 days, and a purged space\'s rows except those about a person', async () => {
    const owner = await createUser('pga4');
    const gone = await makeSpace({ members: { [owner]: 'owner' } }), kept = await makeSpace({ members: { [owner]: 'owner' } });
    const row = (space, verb, who, at) => env.DB.prepare('INSERT INTO activity (space_id, verb, subject_user, bucket, at) VALUES (?, ?, ?, ?, ?)').bind(space, verb, who, at, at);
    await env.DB.batch([
      row(kept.id, 'item.created', '', Date.now() - 91 * DAY), row(kept.id, 'item.created', '', Date.now() - DAY),
      row(gone.id, 'item.created', '', Date.now() - DAY), row(gone.id, 'member.removed', owner, Date.now() - DAY),
      env.DB.prepare('UPDATE spaces SET deleted_at = ? WHERE id = ?').bind(Date.now() - 31 * DAY, gone.id),
    ]);
    await runNightly();
    expect(await one('SELECT count(*) AS n FROM activity WHERE space_id = ?', kept.id)).toEqual({ n: 1 });
    expect(await one('SELECT verb FROM activity WHERE space_id = ?', gone.id)).toEqual({ verb: 'member.removed' });
  });
```

In `test/admin.test.js`, in the account-deletion case the Stage 5 plan rewrote ("hands a class the account owns…"), add before the delete call:

```js
    await env.DB.batch([
      env.DB.prepare("INSERT INTO activity (space_id, actor_id, verb, subject_user, bucket, at) VALUES ('ownsclass001', ?1, 'member.joined', '', 1, 1), ('ownsclass001', ?2, 'member.role', ?1, 2, 2)").bind(id, ed),
      env.DB.prepare('INSERT INTO inbox_seen (user_id, seq) VALUES (?, 1)').bind(id),
    ]);
```

and after it:

```js
    expect((await env.DB.prepare('SELECT verb FROM activity WHERE subject_user = ?').bind(id).all()).results).toEqual([]);
    expect(await env.DB.prepare('SELECT count(*) AS n FROM inbox_seen WHERE user_id = ?').bind(id).first()).toEqual({ n: 0 });
    expect(await env.DB.prepare("SELECT count(*) AS n FROM activity WHERE actor_id = ? AND verb = 'member.joined'").bind(id).first()).toEqual({ n: 1 });
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run test/inbox.test.js test/purge.test.js test/admin.test.js`
Expected: the three new cases FAIL (`unread` undefined; activity not purged; rows about the account kept).

- [ ] **Step 3: `unread` on the last page (`worker/api.js`)**

Import `unreadCount` from `./activity.js`. The v3 branch of the sync route becomes:

```js
    if (q.get('v') === '3') {
      const page = await syncPageV3(env.DB, userId, cursorsParam(q.get('cursors')), svParam(q.get('sv')));
      /* once per sync cycle: only the last page carries the inbox's count (spec §12, §18) */
      return json(page.more ? page : { ...page, unread: await unreadCount(env.DB, userId) });
    }
```

- [ ] **Step 4: The purge (`worker/db.js`)**

In `purgeTombstones` (the Stage 5 plan's version, Task 5 Step 4), add to the batch, right after the `['members', 'invites', 'marks', 'space_prefs'].map(…)` line:

```js
    db.prepare(`DELETE FROM activity WHERE subject_user = '' AND space_id IN ${GONE}`).bind(before),
```

and, beside the invites line at the end:

```js
    db.prepare('DELETE FROM activity WHERE at < ?').bind(now - ACTIVITY_DAYS * 24 * 60 * 60 * 1000),
```

with `const ACTIVITY_DAYS = 90;` beside `INVITE_DAYS`. Add "activity 90 days after it happened (a purged space's own rows with it, except those about a person)" to the function's doc comment.

- [ ] **Step 5: Account deletion (`worker/accounts.js`)**

Add to `ACCOUNT_TABLES`, first:

```js
  ['activity', 'subject_user = ?1'],
```

and to the header comment: "Activity about the account goes; activity it took part in keeps its name in detail.by. Its inbox_seen row goes by ON DELETE CASCADE."

- [ ] **Step 6: Run the tests**

Run: `npx vitest run test/inbox.test.js test/purge.test.js test/admin.test.js test/sync-v3.test.js`
Expected: PASS. If a `test/sync-v3.test.js` case compares a whole last page with `toEqual`, add `unread: 0` to its expected object in this step.

- [ ] **Step 7: Commit**

```bash
git add worker/api.js worker/db.js worker/accounts.js test/inbox.test.js test/purge.test.js test/admin.test.js test/sync-v3.test.js
git commit -m "Stage 7: unread count on the last sync page; activity purged at 90 days and with its account

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The client's inbox data (`src/data/inbox.ts`)

**Files:**
- Create: `src/data/inbox.ts`
- Modify: `src/core/types.ts`, `src/core/api.ts`, `src/core/sync.ts`, `src/core/dates.ts`, `src/components/admin/use-admin.ts`, `src/data/classes.ts`, `src/data/session.ts`
- Test: `src/data/inbox.test.ts`

- [ ] **Step 1: Write the failing test**

`src/data/inbox.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { describe as say } from "./inbox"
import type { ActivityRow } from "./types"

const row = (o: Partial<ActivityRow>): ActivityRow => ({
    seq: 1, spaceId: "abcdefabcdef", space: "Web Services", kind: "class", verb: "item.created", subject: "", actor: "u-alex", subjectUser: "",
    about: false, old: null, new: null, detail: { by: "Alex" }, n: 1, at: 0, ...o,
})

describe("what an activity row says", () => {
    it("names creations, one or many", () => {
        expect(say(row({ detail: { by: "Alex", titles: ["Lab 3"] } }), "u-me")).toBe("Alex added Lab 3")
        expect(say(row({ n: 12, detail: { by: "Alex", titles: ["Lab 1", "Lab 2", "Lab 3", "Lab 4"] } }), "u-me")).toBe("Alex added 12 items: Lab 1, Lab 2, Lab 3…")
    })
    it("reads moves, renames, weights and removals", () => {
        expect(say(row({ verb: "item.date", old: "2026-10-15||", new: "2026-10-18|09:00|", detail: { by: "Alex", title: "REST API" } }), "u-me"))
            .toBe("Alex moved REST API: 15 Oct → 18 Oct 09:00")
        expect(say(row({ verb: "item.title", old: "Quiz", new: "Quiz 1", detail: { by: "Alex" } }), "u-me")).toBe("Alex renamed Quiz to Quiz 1")
        expect(say(row({ verb: "item.weight", old: "10.0", new: "15.0", detail: { by: "Alex", title: "Quiz" } }), "u-me")).toBe("Alex changed Quiz's weight: 10% → 15%")
        expect(say(row({ verb: "item.deleted", new: "1", detail: { by: "Alex", title: "Lab 3" } }), "u-me")).toBe("Alex deleted Lab 3")
        expect(say(row({ verb: "item.deleted", new: "0", detail: { by: "Alex", title: "Lab 3" } }), "u-me")).toBe("Alex restored Lab 3")
    })
    it("speaks to you about you, and calls you You", () => {
        expect(say(row({ verb: "member.role", about: true, subjectUser: "u-me", new: "editor", detail: { by: "Gabriel" } }), "u-me")).toBe("Gabriel made you an editor")
        expect(say(row({ verb: "member.removed", about: true, subjectUser: "u-me", detail: { by: "Gabriel" } }), "u-me")).toBe("Gabriel removed you from Web Services")
        expect(say(row({ verb: "task.assigned", about: true, subjectUser: "u-me", new: "u-me", detail: { by: "Gabriel", title: "Endpoint" } }), "u-me")).toBe("Gabriel assigned you Endpoint")
        expect(say(row({ verb: "member.joined", actor: "u-me", detail: { by: "Me" } }), "u-me")).toBe("You joined")
        expect(say(row({ verb: "task.status", new: "done", detail: {} }), "u-me")).toBe("A former member completed this task")
    })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/data/inbox.test.ts`
Expected: FAIL (no module `./inbox`).

- [ ] **Step 3: Types (`src/core/types.ts`)** — after `Invite`:

```ts
/** One row of the inbox or an Activity tab (spec §12): who did what in a space; `about` when it is about you. */
export interface ActivityRow {
    seq: number; spaceId: string; space: string; kind: "class" | "project" | null; verb: string; subject: string
    actor: string; subjectUser: string; about: boolean; old: string | null; new: string | null
    detail: { by?: string; title?: string; titles?: string[]; whom?: string; space?: string; assignees?: string[]; assignment?: string }
    n: number; at: number
}
/** GET /api/inbox: your pending invites, the newest rows, and where you have read up to. */
export interface Inbox { invites: Invite[]; items: ActivityRow[]; seen: number }
```

- [ ] **Step 4: API (`src/core/api.ts`)**

Import `ActivityRow, Inbox` with the other types. `PageV3` gains `unread?: number`. In `changesV3`'s `valid` check, add `&& (page.unread === undefined || (Number.isSafeInteger(page.unread) && page.unread >= 0 && page.unread <= 99))`. In `api`, replace the `invites` block's `list` and add:

```ts
  inbox: {
    get: (): Promise<Inbox> => request('GET', '/api/inbox'),
    seen: (seq: number) => empty(request('PUT', '/api/inbox/seen', { seq })),
  },
```

and in `spaces`:

```ts
    activity: (sid: string, before?: number): Promise<{ items: ActivityRow[]; more: boolean }> =>
      request('GET', `/api/spaces/${sid}/activity` + (before ? `?before=${before}` : '')),
```

Keep `invites.accept` and `invites.decline`; delete `invites.list` only once nothing calls it (Step 7).

- [ ] **Step 5: The count from sync (`src/core/sync.ts`)**

Beside `onPulled`:

```ts
let unreadFn: (n: number) => void = () => {};
/** The inbox's unread count, as the last page of each complete pull carries it (spec §12). */
export const onUnread = (fn: (n: number) => void): void => { unreadFn = fn; };
```

In `pullAll`, keep the last page's count: declare `let unread: number | undefined;` with `wipe` and `revoked`, set `unread = page.unread;` after `revoked = page.revoked || [];`, and inside `if (complete) { … }` after `listsFor = cycle.account;` add `if (unread !== undefined) unreadFn(unread);`.

- [ ] **Step 6: `ago` into `src/core/dates.ts`**

Move `ago` (with its doc comment) from `src/components/admin/use-admin.ts` to the end of `src/core/dates.ts`, and in `use-admin.ts` replace it with `export { ago } from "@/core/dates"`.

- [ ] **Step 7: Write `src/data/inbox.ts`; move invites out of `classes.ts`**

```ts
// The inbox (spec §12): your invites and what others did in your classes and projects that
// concerns you. The unread count arrives with each sync; the list is fetched when the inbox
// opens and kept in IndexedDB's meta store, so it still reads offline. Nothing is pushed.

import { useSyncExternalStore } from "react"
import { api } from "@/core/api"
import * as store from "@/core/store"
import { data } from "@/core/store"
import { dayMonth } from "@/core/dates"
import { itemByKey } from "./effective"
import { openItem } from "./actions"
import { openClass } from "./classes"
import { openSheet } from "./overlay"
import type { ActivityRow, Inbox, Invite } from "./types"

let unread = 0
let box: Inbox | null = null
let offline = false
const listeners = new Set<() => void>()
const emit = () => { for (const fn of listeners) fn() }
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }

export const useUnread = () => useSyncExternalStore(subscribe, () => unread)
export const useInbox = () => useSyncExternalStore(subscribe, () => box)
export const useInboxOffline = () => useSyncExternalStore(subscribe, () => offline)
/** Your pending invites, as the inbox last fetched them. */
export const useInvites = (): Invite[] => useSyncExternalStore(subscribe, () => box?.invites ?? NONE)
const NONE: Invite[] = []

/** The count sync brought (core/sync.ts onUnread). */
export function setUnread(n: number): void { if (n !== unread) { unread = n; emit() } }

export const openInbox = () => openSheet({ kind: "inbox" })

/** Fetch the inbox; offline, the copy kept from last time. */
export async function refreshInbox(): Promise<void> {
    try {
        box = await api.inbox.get()
        offline = false
        await store.meta.set("inbox", box)
    } catch {
        offline = true
        box ??= ((await store.meta.get("inbox").catch(() => null)) as Inbox | null) ?? { invites: [], items: [], seen: 0 }
    }
    emit()
}

/** Everything in the list is read: the count falls to the invites still waiting. */
export async function markSeen(): Promise<void> {
    const top = box?.items[0]?.seq ?? 0
    if (!box || top <= box.seen) return
    box = { ...box, seen: top }
    setUnread(box.invites.filter((i) => !i.expired).length)
    emit()
    try { await api.inbox.seen(top) } catch { /* offline: the next open sends it again */ }
}

/** An invite answered (accepted, declined): it leaves the list and the count. */
export function dropInvite(spaceId: string): void {
    if (!box) return
    const had = box.invites.some((i) => i.spaceId === spaceId && !i.expired)
    box = { ...box, invites: box.invites.filter((i) => i.spaceId !== spaceId) }
    if (had) setUnread(Math.max(0, unread - 1))
    emit()
}

/* ── words ── */

const when = (v: string | null) => {
    const [date = "", start = ""] = (v ?? "").split("|")
    return date ? dayMonth(date) + (start ? " " + start : "") : "no date"
}
const pct = (v: string | null) => (v === null ? "none" : Number(v) + "%")
const role = (r: string | null) => (r === "editor" ? "an editor" : r === "owner" ? "the owner" : "a member")

/** What a row says (spec §12), for the inbox and the Activity tabs. `me` is your user id. */
export function describe(r: ActivityRow, me: string): string {
    const by = r.actor === me ? "You" : r.detail.by || "A former member"
    const title = r.detail.title || "this " + (r.verb.startsWith("task") ? "task" : "item")
    const whom = r.subjectUser === me ? "you" : r.detail.whom || "a former member"
    switch (r.verb) {
        case "item.created": {
            const t = r.detail.titles ?? []
            return r.n === 1 ? `${by} added ${t[0] ?? "an item"}` : `${by} added ${r.n} items: ${t.slice(0, 3).join(", ")}${r.n > 3 ? "…" : ""}`
        }
        case "item.deleted": return `${by} ${r.new === "1" ? "deleted" : "restored"} ${title}`
        case "item.date": return `${by} moved ${title}: ${when(r.old)} → ${when(r.new)}`
        case "item.weight": return `${by} changed ${title}'s weight: ${pct(r.old)} → ${pct(r.new)}`
        case "item.title": return `${by} renamed ${r.old} to ${r.new}`
        case "course.meetings": return `${by} changed the class times`
        case "course.instructor": return `${by} changed the instructor: ${r.old || "none"} → ${r.new || "none"}`
        case "task.assigned":
            if (r.new === "*") return `${by} gave ${title} to everyone`
            if (r.actor === r.subjectUser) return `${by} took ${title}`
            return r.about ? `${by} assigned you ${title}` : `${by} assigned ${title} to ${whom}`
        case "task.unassigned": return `${title} has nobody on it now`
        case "task.status": return `${by} ${r.new === "done" ? "completed" : "reopened"} ${title}`
        case "member.joined": return `${by} joined`
        case "member.left": return `${by} left`
        case "member.removed": return r.about ? `${by} removed you from ${r.space}` : `${by} removed ${whom}`
        case "member.role": return `${by} made ${whom} ${role(r.new)}`
        case "space.archived": return `${by} ${r.new === "1" ? "archived" : "unarchived"} ${r.space}`
        case "space.linked": return `${by} linked ${r.space} to ${r.detail.assignment || "an assignment"}`
        case "space.transferred": return r.about ? `${by} made you the owner of ${r.space}` : `${by} handed ${r.space} to ${whom}`
        case "space.deleted": return `${by} deleted ${r.space}`
        default: return `${by} changed ${r.space}`
    }
}

/** Open what a row is about: its item while it is on this device, else its space (a class's sheet; projects in Stage 9). */
export function openRow(r: ActivityRow): void {
    const scope = (r.kind === "project" ? "p:" : "c:") + r.spaceId
    if (r.subject && itemByKey(scope + "/" + r.subject)) { openItem(scope + "/" + r.subject); return }
    if (r.kind === "class" && data.spaces.some((s) => s.id === r.spaceId)) openClass(r.spaceId)
}

/** A page of a space's Activity tab; null offline. */
export async function loadActivity(spaceId: string, before?: number): Promise<{ items: ActivityRow[]; more: boolean } | null> {
    try { return await api.spaces.activity(spaceId, before) } catch { return null }
}
```

Check `src/data/actions.ts` does not import `src/data/inbox.ts` (it would make a cycle with `openItem`); if a cycle appears in the build, import `openItem` lazily inside `openRow` with `const { openItem } = await import("./actions")` and make `openRow` async.

In `src/data/classes.ts`: delete the invites block (`invites`, `listeners`, `emit`, `subscribe`, `useInvites`, `getInvites`, `refreshInvites`, `watching`, `watchInvites`) and `openInvites`; `answered(spaceId)` becomes `dropInvite(spaceId)` imported from `./inbox`. Re-export `useInvites` from `./inbox` if a component imports it from `@/data/classes` (`grep -rn "useInvites\|getInvites\|refreshInvites" src`); change those imports to `@/data/inbox`. Then delete `api.invites.list` from `src/core/api.ts`.

In `src/data/session.ts`: drop `watchInvites` from the import and its call; add `sync.onUnread(setUnread)` (import `setUnread` from `./inbox`) beside `sync.init()`.

- [ ] **Step 8: Run the tests**

Run: `npx vitest run src/data/inbox.test.ts src/data/classes.test.ts src/data/session.test.ts && npm run typecheck`
Expected: PASS. Any `classes.test.ts` case about `refreshInvites` or `watchInvites` moves to `inbox.test.ts` as a `refreshInbox` case with the same expectations (the fake API answers `/api/inbox` with `{invites, items: [], seen: 0}`).

- [ ] **Step 9: Commit**

```bash
git add src/core/types.ts src/core/api.ts src/core/sync.ts src/core/dates.ts src/components/admin/use-admin.ts src/data/inbox.ts src/data/inbox.test.ts src/data/classes.ts src/data/classes.test.ts src/data/session.ts
git commit -m "Stage 7: the inbox on the client: unread from sync, the list kept offline, what each row says

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The bell and the inbox sheet

**Files:**
- Create: `src/components/inbox-bell.tsx`, `src/components/sheet/inbox-sheet.tsx`
- Delete: `src/components/sheet/invites-sheet.tsx`
- Modify: `src/components/top-bar.tsx`, `src/data/overlay.ts`, `src/components/sheet/sheet.tsx`, `src/components/sidebar-classes.tsx`, `src/components/sidebar.tsx`
- Test: `src/components/inbox.test.tsx`; update `src/components/sidebar.test.tsx`, `src/components/sheet/sheet.test.tsx`, `src/components/sheet/classes.test.tsx` where they open the invites sheet or find the Invites row

- [ ] **Step 1: Write the failing test**

`src/components/inbox.test.tsx` (follow the render and fake-API setup of `src/components/sheet/classes.test.tsx`: read its first 60 lines and reuse its helpers, e.g. its `fakeApi`/`respond` and render wrapper):

```tsx
import { describe, expect, it } from "vitest"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { TopBar } from "./top-bar"
import { Sheet } from "./sheet/sheet"
import { setUnread } from "@/data/inbox"
// + the fake API and sign-in helpers classes.test.tsx uses

describe("the bell and the inbox (spec §12, §15)", () => {
    it("shows the unread count, and none at zero", () => {
        render(<TopBar />)
        act(() => setUnread(0))
        expect(screen.getByRole("button", { name: "Inbox" })).toBeTruthy()
        act(() => setUnread(3))
        expect(screen.getByRole("button", { name: "Inbox, 3 unread" })).toBeTruthy()
        act(() => setUnread(99))
        expect(screen.getByRole("button", { name: "Inbox, 99 unread" }).textContent).toContain("99")
    })

    it("lists invites and news, marks them read, and accepts an invite", async () => {
        // fake: GET /api/inbox → {invites: [{spaceId:'abcdefabcdef', kind:'class', name:'Web Services', role:'member', from:'Gabriel', createdAt: 0, expiresAt: 9e15, expired: false}],
        //        items: [{seq: 7, spaceId: 'abcdefabcdef', space: 'Web Services', kind: 'class', verb: 'item.date', subject: 'a1', actor: 'u-g', subjectUser: '',
        //                 about: false, old: '2026-10-15||', new: '2026-10-18||', detail: {by: 'Gabriel', title: 'REST API'}, n: 1, at: Date.now()}], seen: 0}
        //       PUT /api/inbox/seen → 204; POST /api/invites/abcdefabcdef/accept → {space: {...}}
        render(<><TopBar /><Sheet /></>)
        act(() => setUnread(2))
        fireEvent.click(screen.getByRole("button", { name: "Inbox, 2 unread" }))
        expect(await screen.findByText("Gabriel moved REST API: 15 Oct → 18 Oct")).toBeTruthy()
        expect(screen.getByText(/invited you to the shared class/)).toBeTruthy()
        // the fake saw PUT /api/inbox/seen {seq: 7}; the bell now reads "Inbox, 1 unread" (the invite)
        expect(screen.getByRole("button", { name: "Inbox, 1 unread" })).toBeTruthy()
        fireEvent.click(screen.getByRole("button", { name: "Accept the invite to Web Services" }))
        // the fake saw POST …/accept; the join sheet opens
    })

    it("offline, shows the copy kept from last time and says so", async () => {
        // fake: GET /api/inbox fails once after a first good answer
    })
})
```

Fill in the three fakes with the helpers `classes.test.tsx` uses (the comments say what each answers and what to assert), then delete the comments.

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/components/inbox.test.tsx`
Expected: FAIL (no Inbox button).

- [ ] **Step 3: The sheet state (`src/data/overlay.ts`)**

Replace `| { kind: "invites" }` with `| { kind: "inbox" }`, and `export type ClassTab = "details" | "members"` with `export type ClassTab = "details" | "members" | "activity"`.

- [ ] **Step 4: `src/components/inbox-bell.tsx`**

```tsx
// The bell in the top bar (spec §15): the inbox, with how much in it is unread. The count
// comes with each sync; nothing is pushed.

import { TextureButton } from "@/components/ui/texture-button"
import { openInbox, useUnread } from "@/data/inbox"

export function InboxBell() {
    const n = useUnread()
    return (
        <TextureButton variant="minimal" size="sm" aria-label={n ? `Inbox, ${n} unread` : "Inbox"} title="Inbox" onClick={openInbox} className="relative">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="size-4">
                <path d="M4 11V7a4 4 0 0 1 8 0v4l1.5 1.5h-11zM6.5 14a1.5 1.5 0 0 0 3 0" />
            </svg>
            {n > 0 && (
                <span aria-hidden="true" className="absolute -top-1 -right-1 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] leading-4 font-semibold text-primary-foreground">
                    {n}
                </span>
            )}
        </TextureButton>
    )
}
```

In `src/components/top-bar.tsx`, import it and render `<InboxBell />` between `<Search />` and the Import with AI button.

- [ ] **Step 5: `src/components/sheet/inbox-sheet.tsx`**

Delete `src/components/sheet/invites-sheet.tsx` and write:

```tsx
// The inbox (spec §12, §15): invites to you, with Accept or Decline, then what others did in
// your classes and projects that concerns you, newest first. Opening it marks everything
// read. Offline it shows the copy kept from last time. While the admins have shared classes
// switched off, everyone else gets the maintenance page instead.

import { useEffect, useState } from "react"
import { ago, dayMonth, iso } from "@/core/dates"
import { data } from "@/core/store"
import { closeSheet } from "@/data/overlay"
import { accept, decline, messageFor, openJoin } from "@/data/classes"
import { describe, markSeen, openRow, refreshInbox, useInbox, useInboxOffline } from "@/data/inbox"
import { useMaintenance } from "@/data/maintenance"
import { MaintenanceBar, MaintenancePage } from "@/components/maintenance"
import type { ActivityRow, Invite } from "@/data/types"
import { Button, Note, SheetBody, SheetFoot, SheetHead } from "./fields"

export function InboxSheet() {
    const maintenance = useMaintenance("classes")
    if (maintenance !== "blocked") return <InboxCard bar={maintenance === "admin"} />
    return (
        <>
            <SheetHead kind="Inbox" onClose={closeSheet} />
            <SheetBody><MaintenancePage feature="classes" inSheet /></SheetBody>
        </>
    )
}

const LIST = "m-0 flex list-none flex-col gap-1.5 p-0"
const ROW = "flex flex-col gap-1 rounded-lg bg-muted px-3 py-2 text-[12.5px]"

function InboxCard({ bar }: { bar: boolean }) {
    const box = useInbox()
    const offline = useInboxOffline()
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState("")
    useEffect(() => { void refreshInbox().then(markSeen) }, [])
    /* what was read when the fetch landed, so rows new on opening keep their "New" while the sheet is open */
    const seenAtOpen = useRef<number | null>(null)
    if (box && seenAtOpen.current === null) seenAtOpen.current = box.seen
    const me = data.profile?.id ?? ""

    const yes = async (inv: Invite) => {
        setBusy(true); setErr("")
        try { openJoin("", await accept(inv.spaceId)) } catch (e) { setErr(messageFor(e)); setBusy(false) }
    }
    const no = async (inv: Invite) => {
        setBusy(true); setErr("")
        try { await decline(inv.spaceId) } catch (e) { setErr(messageFor(e)) } finally { setBusy(false) }
    }
    const kindWord = (k: string) => (k === "project" ? "team project" : "shared class")

    return (
        <>
            <SheetHead kind="Inbox" onClose={closeSheet} />
            <SheetBody>
                {bar && <MaintenanceBar className="mb-0" />}
                <h2 className="m-0 text-[22px] leading-[1.22] font-[750] tracking-[-.02em]">Inbox</h2>
                {offline && <Note>You're offline. This is what the inbox held last time.</Note>}
                {!box ? <Note>Loading…</Note> : (
                    <>
                        {box.invites.length > 0 && (
                            <ul aria-label="Invites to you" className={LIST}>
                                {box.invites.map((inv) => (
                                    <li key={inv.spaceId} className={ROW}>
                                        <span><b>{inv.from}</b> invited you to the {kindWord(inv.kind)} <b>{inv.name}</b></span>
                                        <span className="text-[11px] text-muted-foreground">As {inv.role} · {dayMonth(iso(new Date(inv.createdAt)))}</span>
                                        {inv.expired ? <Note>This invite has expired. Ask for a new one.</Note> : (
                                            <span className="flex gap-2">
                                                <Button variant="ghost" disabled={busy || offline} aria-label={"Decline the invite to " + inv.name} onClick={() => void no(inv)}>Decline</Button>
                                                <Button disabled={busy || offline} aria-label={"Accept the invite to " + inv.name} onClick={() => void yes(inv)}>Accept</Button>
                                            </span>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        )}
                        {box.items.length === 0 && box.invites.length === 0 ? <Note>Nothing new. News from your classes shows here.</Note> : (
                            <ul aria-label="News" className={LIST}>
                                {box.items.map((r) => <NewsRow key={r.seq} row={r} me={me} unread={r.seq > (seenAtOpen.current ?? box.seen)} />)}
                            </ul>
                        )}
                    </>
                )}
                {err && <Note tone="bad">{err}</Note>}
            </SheetBody>
            <SheetFoot hint="Nothing is pushed: news comes with each sync.">
                <Button variant="ghost" onClick={closeSheet}>Close</Button>
            </SheetFoot>
        </>
    )
}

function NewsRow({ row, me, unread }: { row: ActivityRow; me: string; unread: boolean }) {
    return (
        <li>
            <button type="button" onClick={() => openRow(row)} className={ROW + " w-full cursor-pointer border-0 text-left font-[inherit] text-foreground hover:bg-accent"}>
                <span>{unread && <span className="sr-only">New: </span>}{describe(row, me)}</span>
                <span className="text-[11px] text-muted-foreground">{row.space} · {ago(row.at)}</span>
            </button>
        </li>
    )
}
```

The inbox marks rows read once it has fetched them (`refreshInbox().then(markSeen)`); `seenAtOpen` keeps the read marker from before that, so rows that were new keep their "New:" label for screen readers while the sheet is open. Add `useRef` to the `react` import.

- [ ] **Step 6: Route the sheet (`src/components/sheet/sheet.tsx`)**

`import { InboxSheet } from "./inbox-sheet"` in place of the invites import (keep the file's lazy/eager pattern for sheets); `sheetLabel`: `if (s.kind === "inbox") return "Inbox"` in place of the invites line; the body: `{shown?.kind === "inbox" && <InboxSheet />}` in place of the invites line.

- [ ] **Step 7: The sidebar loses the Invites row**

In `src/components/sidebar-classes.tsx`, delete `InvitesRow` and its imports (`openInvites`, `useInvites`, `Count` if now unused) and the `ROW` constant if nothing else uses it; update the header comment ("+ New as a menu: …; the invites are in the inbox, top bar"). In `src/components/sidebar.tsx`, delete `{admin && <InvitesRow />}` (Stage 6 may have dropped the `admin &&`) and `InvitesRow` from the import.

- [ ] **Step 8: Run the tests**

Run: `npx vitest run src/components/inbox.test.tsx src/components/sidebar.test.tsx src/components/sheet/sheet.test.tsx src/components/sheet/classes.test.tsx src/components/top-bar.test.tsx && npm run typecheck`
Expected: PASS after updating the older tests: a case that finds the sidebar's **Invites** row now clicks the bell (`{ name: /^Inbox/ }`); a case that opens `{kind: "invites"}` opens `{kind: "inbox"}`; the invites list's words are unchanged except "shared class" now comes from `kindWord`.

- [ ] **Step 9: Build (non-ASCII: →, …, ·)**

Run: `npm run build`
Expected: success.

- [ ] **Step 10: Commit**

```bash
git add src/components/inbox-bell.tsx src/components/top-bar.tsx src/components/sheet/inbox-sheet.tsx src/components/sheet/sheet.tsx src/data/overlay.ts src/components/sidebar-classes.tsx src/components/sidebar.tsx src/components/inbox.test.tsx src/components/sidebar.test.tsx src/components/sheet/sheet.test.tsx src/components/sheet/classes.test.tsx
git rm src/components/sheet/invites-sheet.tsx
git commit -m "Stage 7: the bell and the inbox sheet replace the Invites row and sheet

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The class sheet's Activity tab

**Files:**
- Create: `src/components/sheet/activity-list.tsx`
- Modify: `src/components/sheet/class-sheet.tsx`
- Test: `src/components/sheet/classes.test.tsx` (new case)

- [ ] **Step 1: Write the failing test** (append to `src/components/sheet/classes.test.tsx`, with its helpers)

```tsx
it("shows a class's activity a page at a time, and says when it needs a connection", async () => {
    // a class space 'abcdefabcdef' on the device (the file's existing class fixture);
    // fake: GET /api/spaces/abcdefabcdef/activity → {items: 30 rows seq 40..11, verb 'item.created', detail {by:'Gabriel', titles:['Lab N']}}, more: true}
    //       GET /api/spaces/abcdefabcdef/activity?before=11 → {items: [seq 10, 'member.joined', actor 'u-sam', detail {by:'Sam'}], more: false}
    openClass("abcdefabcdef", "activity")
    expect(await screen.findAllByText(/^Gabriel added Lab/)).toHaveLength(30)
    fireEvent.click(screen.getByRole("button", { name: "Show older" }))
    expect(await screen.findByText("Sam joined")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Show older" })).toBeNull()
    // fake: the next GET fails
    openClass("abcdefabcdef", "details"); openClass("abcdefabcdef", "activity")
    expect(await screen.findByText("Connect to see activity.")).toBeTruthy()
})
```

Fill the fakes in with the file's helpers, then delete the comments.

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/components/sheet/classes.test.tsx`
Expected: the new case FAILS (no Activity tab).

- [ ] **Step 3: `src/components/sheet/activity-list.tsx`**

```tsx
// A space's history (spec §12, §15): the Activity tab of a class's sheet, and from Stage 9 a
// project's. Fetched when the tab opens, 30 rows at a time; it needs a connection.

import { useEffect, useState } from "react"
import { ago } from "@/core/dates"
import { data } from "@/core/store"
import { describe, loadActivity, openRow } from "@/data/inbox"
import type { ActivityRow } from "@/data/types"
import { Button, Note } from "./fields"

export function ActivityList({ spaceId }: { spaceId: string }) {
    const [rows, setRows] = useState<ActivityRow[] | null>(null)
    const [more, setMore] = useState(false)
    const [offline, setOffline] = useState(false)
    const [busy, setBusy] = useState(false)
    const me = data.profile?.id ?? ""

    const load = async (before?: number) => {
        setBusy(true)
        const page = await loadActivity(spaceId, before)
        setBusy(false)
        if (!page) { setOffline(true); return }
        setOffline(false)
        setRows((r) => (before ? [...(r ?? []), ...page.items] : page.items))
        setMore(page.more)
    }
    useEffect(() => { void load() }, [spaceId])

    if (offline && !rows) return <Note>Connect to see activity.</Note>
    if (!rows) return <Note>Loading…</Note>
    if (!rows.length) return <Note>Nothing has happened here yet.</Note>
    return (
        <>
            <ul aria-label="Activity" className="m-0 flex list-none flex-col gap-1 p-0">
                {rows.map((r) => (
                    <li key={r.seq}>
                        <button type="button" onClick={() => openRow(r)} className="flex w-full cursor-pointer flex-col gap-0.5 rounded-lg border-0 bg-muted px-2.5 py-1.5 text-left font-[inherit] text-[12.5px] text-foreground hover:bg-accent">
                            <span>{describe(r, me)}</span>
                            <span className="text-[11px] text-muted-foreground">{ago(r.at)}</span>
                        </button>
                    </li>
                ))}
            </ul>
            {offline && <Note>Connect to see older activity.</Note>}
            {more && <Button variant="ghost" disabled={busy} onClick={() => void load(rows[rows.length - 1].seq)}>Show older</Button>}
        </>
    )
}
```

- [ ] **Step 4: The tab (`src/components/sheet/class-sheet.tsx`)**

`const TABS: readonly [ClassTab, string][] = [["details", "Details"], ["members", "Members"], ["activity", "Activity"]]`; import `ActivityList`; where the panel renders `tab === "members" ? <MembersTab …/> : …`, add the third case `tab === "activity" ? <ActivityList spaceId={spaceId} />`. Add "**Activity**: what happened in the class (90 days)." to the file's header comment.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/components/sheet/classes.test.tsx && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/sheet/activity-list.tsx src/components/sheet/class-sheet.tsx src/components/sheet/classes.test.tsx
git commit -m "Stage 7: the class sheet's Activity tab

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Docs

**Files:**
- Modify: `docs/DATA-MODEL.md`, `docs/PROJECT-OVERVIEW.md`, `docs/DEPLOYING.md`, `docs/superpowers/plans/2026-10-02-collaboration.md`

- [ ] **Step 1: `docs/DATA-MODEL.md`**: the `activity` and `inbox_seen` tables (columns as in the migration, the unique key, the three indexes, the triggers in one paragraph, "kept 90 days"); the API table gains `GET /api/inbox`, `PUT /api/inbox/seen`, `GET /api/spaces/:sid/activity?before=`, and the sync row notes "`unread` on the last v3 page". Mark `GET /api/invites` "old clients only".
- [ ] **Step 2: `docs/PROJECT-OVERVIEW.md`**: history line "Stage 7 (inbox and activity), <date>"; the repo map gains `worker/activity.js`, `worker/inbox.js`, `src/data/inbox.ts`, `src/components/inbox-bell.tsx`, `src/components/sheet/inbox-sheet.tsx`, `src/components/sheet/activity-list.tsx`; `invites-sheet.tsx` leaves it.
- [ ] **Step 3: `docs/DEPLOYING.md`**: migrations table row `| \`0005_activity.sql\` | \`activity\` (what members did, from triggers on shared rows and from the member routes) and \`inbox_seen\` |`.
- [ ] **Step 4: The master plan**: Stage 7's "Detailed plan" cell becomes `` `docs/superpowers/plans/2026-10-07-collab-stage-7-inbox.md` ``. Under the Stages 8–10 outline add **Hand-offs from Stage 7**: "The triggers already record task events (`task.assigned` per assignee, `task.unassigned`, `task.status` with `detail.assignees`), and the inbox already tells assignees. Stage 8 writes `space.linked` (detail.assignment = the assignment's title) and `space.deleted` (one row per other live member, `subject_user` set) with `noteStmt`; a removal from a project writes `member.removed` as for a class. `openRow` opens only classes' sheets; Stage 9 opens a project's. `ActivityList` takes any space id."
- [ ] **Step 5: Commit**

```bash
git add docs/DATA-MODEL.md docs/PROJECT-OVERVIEW.md docs/DEPLOYING.md docs/superpowers/plans/2026-10-02-collaboration.md
git commit -m "Stage 7: docs for the inbox and activity

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Full check, browser check, migration, merge (George's yes)

- [ ] **Step 1: Full check**

Run: `npm run check`
Expected: typecheck, every test and the build pass.

- [ ] **Step 2: Local migration and a two-account check**

Run: `npm run db:local` (or the script `package.json` names for local migrations: `grep -n "db:" package.json`), then `npm run dev` (port check first, see "How to work" 2). With two local accounts in one class (the QA accounts `qaa` and `qab` exist on local v7), in two browser profiles:
1. `qaa` adds an item, moves another's date, and changes the class's meeting time.
2. `qab` syncs (focus the tab): the bell shows 3; the inbox lists the three in words ("qaa moved … → …"); the count goes to 0; reopening shows them without "New".
3. `qaa` makes `qab` an editor: `qab`'s inbox says "qaa made you an editor".
4. The class sheet's **Activity** tab on both shows everything, including `qab`'s own joins; **Show older** appears after 30 rows.
5. Offline (DevTools → Network → Offline) on `qab`: the inbox shows the kept copy with the offline note; the Activity tab says "Connect to see activity."
6. Phone width (≤ 700px): the bell fits the top bar and the inbox sheet is full-screen.

Fix what fails, with a test where one can catch it, and run Step 1 again.

- [ ] **Step 3: Ask George.** Say what the migration adds and that the live database's triggers start recording from the moment it is applied (nothing earlier is in the inbox). Only on an explicit yes:

```bash
npm run db:remote
npm run db:check -- --remote
```

Expected: `0005_activity.sql` applied; every check OK. Then merge and push:

```bash
git checkout main && git pull --ff-only && git merge --no-ff collab-7-inbox -m "Merge collab-7-inbox: inbox and activity

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" && git push
```

- [ ] **Step 4: After the Git build deploys**, ask George to open the live site: the bell is there, and an invite he sends from his second admin account shows in the other's inbox.

---

## Self-review against the spec and the outline

- §12 recorded events: item created/deleted/restored (triggers, Decision 1), date/times/weight/title (triggers), course meetings/room/instructor (course trigger), task assigned per assignee/completed/reopened (triggers), member joined/left/removed/role, space archived/unarchived/transferred (Task 3); linked and deleted are written by Stage 8, their verbs and words are here. Coalescing and the return-to-start delete: Task 1's tests. Creations: one row, ten titles.
- §12 inbox: invites, others' activity that concerns you, rows about you after leaving (Task 2 tests); titles from `detail`; `GET /api/inbox` when the sheet opens, cached offline (Task 5); unread on each sync, capped at 99 (Tasks 2, 4); `PUT /api/inbox/seen` (Task 2). Permission changes and removals reach the person (`subject_user`). Activity tab with `before=` and the offline line (Tasks 2, 7). 90-day purge (Task 4).
- §13: the purge drops a deleted space's rows except those about a person; account deletion drops rows about it and its read marker (Task 4).
- §15: bell with count, inbox sheet full-screen on phones (the sheet already is, Task 9 Step 2 checks), the class sheet's Activity tab.
- §17: activity records only shared fields (titles, dates, weights, times, names, roles) — never marks or prefs, which have no triggers.
- §18: no fan-out; the count is one query per sync cycle on the last page; the list loads on open.
- The master plan's Stage 7 outline: the inbox replaces Stage 3's Invites sheet and sidebar row (Task 6); pending invites count towards unread (Task 2).
- Placeholders: Task 6 Step 1 and Task 7 Step 1 describe their fakes in comments because the jsdom fake-API helpers live in `classes.test.tsx` and must be read first; the assertions are spelled out.
- Names used from other plans: `detach`, `leave`, `removeMember`, `setArchived`, `handOnStmts`, `ENDED` binds, the `/leave`, `/archive`, member `DELETE` routes, `purgeTombstones`' `GONE` and `INVITE_DAYS` (Stage 5 plan); the removed `ADMINS_ONLY`/`isAdmin` checks (Stage 6 plan).
