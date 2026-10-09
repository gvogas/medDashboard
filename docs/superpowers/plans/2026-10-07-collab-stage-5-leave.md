# Collaboration Stage 5: Leaving and removal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

This is **Stage 5** of the master plan `docs/superpowers/plans/2026-10-02-collaboration.md` (its "The stages" table, the Stage 5 outline, and the hand-offs the Stage 4 plan recorded). Stages 1–4 are live (`main` 3bb488a and later). Stage 2's plan (`2026-10-05-collab-stage-2-sync.md`), Stage 3's (`2026-10-05-collab-stage-3-classes.md`) and Stage 4's (`2026-10-06-collab-stage-4-layer.md`) bind this one: every guard inside the statement, set-based batches safe to retry, field merge for shared rows and marks, effective lists keyed `scope/id`, roll-forward only, admin-only until Stage 6.

Everything below is written against the code on `main` as of 2026-10-07: `worker/spaces.js` (`createClass`, `absorb`, `setRole`, `transfer`, `spaceDetails`, `touchSpace`, `NEXT_SPACE_REVISION`, `LIVE_MEMBERS`), `worker/access.js` (`guard`, `ownerGuard`, `assertAllowed`, `assertOwner`, `roleOf`), `worker/classes.js` (`classRoutes`, `idOf`, `bad`, `absorbBody`), `worker/db.js` (`purgeTombstones`, `syncPageV3`), `worker/admin.js` (account `DELETE`), `src/core/store.ts` (`applyPage`, `applyRevoked`, `saveShared`, `reload`), `src/core/sync.ts` (`pushAll`, `pullAll`), `src/data/effective.ts`, `src/data/classes.ts`, `src/data/marks.ts`, `src/data/refs.ts`, `src/components/sheet/{class-sheet,members-tab,class-item-sheet,item-sheet}.tsx`.

**Goal:** A member can leave a class (keeping a copy of it as their own course, or not); the owner can remove a member (who always keeps a copy), archive and unarchive the class, hand it on while it is archived, and delete it when they are its only member; a class item an editor deleted stays with everyone who has a grade, status or notes on it as **Removed from … by …** with **Keep as mine** / **Dismiss** (and **Restore for everyone** for editors); an editor can share one personal item filed under the class with the class; deleting an account hands its classes on; and the nightly purge detaches before it deletes.

**Architecture:** One new Worker module, `worker/leaving.js`, holds every Stage 5 batch. Its core is **detach**: a few `INSERT … SELECT` / `UPDATE` statements that copy the class course and items into `u:<you>` (an upsert, so the tombstones a Stage 4 convert or merge left revive under the same ids), fold your mark and prefs in, repoint your filed items, sessions and achievements, and delete your layer there. Every statement carries a `live` condition that the batch's last statement ends (your membership, or your mark), so a retry copies nothing twice. Ids the copy takes are worked out before the batch (a live personal row with the same id makes the copy `'k' + id`). On the client, removed class items are kept in IndexedDB as tombstones (`shared_items` rows with `deletedAt`), surfaced as `data.removed_items`; `applyRevoked` drops your layer for a lost class and carries a mark edit still waiting to upload onto your copy.

**Tech Stack:** Cloudflare Workers + D1 (plain JS ES modules), React 19 + TypeScript + Vite, IndexedDB (fake-indexeddb in node tests), Vitest (Workers pool + jsdom), wrangler.

**Spec:** `docs/superpowers/specs/2026-10-02-shared-classes-design.md`: §5 (permissions: leave, remove, archive, delete, transfer), §6 Revocation, §13 (deletion and archiving, detach, Keep as mine, share one item, the nightly purge, account deletion), §14, §15 (removed items, the class sheet), §19.

**UI reference:** the prototype George approved (artifact https://claude.ai/artifact/NsegZJE8Wu4A6MvsvWx6HE): the removed-item banner "Removed from Web Services by Alex" with **Keep as mine** / **Dismiss**, and the class sheet's member controls. This plan builds them in the app's own sheets and fields.

---

## How to work in this repo (read before any task)

1. **Checks:** `npm run typecheck`, `npm test` (Vitest: Workers + jsdom projects, then node tests), `npm run build`. `npm run check` runs all three. One file: `npx vitest run test/leaving.test.js`. The jsdom tests alone: `npm run test:ui`. The Worker tests alone: `npm run test:api`. The node tests: `npm run test:local`.
2. **Dev server:** `npm run dev` → http://127.0.0.1:8787. On this Windows machine a stopped dev server can leave `vite.js` holding 8787/8790 and serving old code: check `Get-NetTCPConnection -LocalPort 8787 -State Listen` in PowerShell first and stop the owning process. Don't run `npm run build` while the dev server runs.
3. **Line endings:** keep every file LF. A CRLF in `index.html` breaks the CSP hash.
4. **Non-ASCII** (·, —, …): write it with the Edit/Write tools, never through a shell; after a commit that adds any, `npm run build` (Vite refuses Latin-1 bytes that tests miss). A sub-agent may write `·` as Latin-1: check a touched file with `iconv -f utf-8 -t utf-8 <file> >/dev/null` in Git Bash.
5. **Deploying:** the Cloudflare Git build runs `npm run build`. **This stage has no migration**: every index it needs exists (`spaces_deleted`, `members_deleted`, `invites_created`, `items_deleted`, `marks_deleted`).
6. **Commits:** end each message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Commit only on `collab-5-leave`; never push or merge to `main` without George's yes (Task 13).
7. **Workers AI:** nothing in this stage calls AI.
8. **The suite stays green after every task.** A task that changes a behaviour an older test spells out updates that test in the same task; the step says which.

Branch: `collab-5-leave`, made from `main`:

```bash
git checkout main && git pull --ff-only && git checkout -b collab-5-leave
```

---

## Decisions this plan takes (where the spec left a choice)

1. **Detach is one function for three callers.** Leaving with a copy, being removed, and deleting a class with **Keep a copy** all run the same statements (`copyClass`). Leaving without a copy runs `dropLayer`. **Keep as mine** and the nightly purge's auto-detach run `keepItems` (one or more removed items, filed under the class). Every statement in a batch carries a `live` condition (your live membership, the owner's for a removal, your live mark for a keep) and the batch's last write ends it, so a retry finds nothing to do.
2. **What a copy holds** (spec §13): the class course with your prefs' colour, semester, target and archive flag (the class's own when you have none); every live class item except those you hid that hold nothing of yours and that no session or achievement of yours points at; and every **removed** class item whose mark holds anything of yours. Each item takes your status, grade, weight (yours, else the class's), checklist and completion; its notes are yours, then a blank line, `Class notes:` and the class's notes (cut at 5000 characters). Your items filed under the class move into the copy (`course_id` set, `class_id` cleared); your sessions and achievements on the class lose `space_id` and point at the copy; your marks and prefs there are soft-deleted.
3. **Ids.** A copy keeps each row's id, so the tombstones a convert or a merge left (your old course and items) revive under the same ids. When a **live** row of yours already has the id (a Stage 3 copy you never merged, or a copy kept from an earlier leave), the copy takes `'k' + the first 23 characters of the id` if that is free too, else `'k'`, a counter and as much of the id as fits in 24 characters (`k1a1`, `k2a1`, …), counting up until free; sessions and achievements follow it. "Free" means no live row of yours has it **and** no other row in the same copy takes it: rows that keep their own id are placed first, then the clashing ones. A copy id must never be live, because the copy's upsert only revives tombstones: a live target would make the copy silently do nothing while your marks are still deleted (a third leave of the same class, or a class holding both `a1` and `ka1`). The ids are worked out in one read of the class's ids and your live ids before the batch (`copyIds`).
4. **Permissions.** Leaving: any member but the owner (`403 {error:'owner'}`: hand the class on first), archived or not. Removing: the owner, never themselves or the owner; the removed person always keeps a copy. Archive and unarchive: the owner. Delete a class: the owner, only while they are its only member (`409 {error:'members'}`); **Keep a copy** is on by default. **Membership management works while archived:** roles, transfer, remove and archive/unarchive use a new `keeperGuard` (the owner, archived or not); invites, codes and shared edits stay refused while archived (`403 archived`). This settles the master plan's open question on transfer in an archived class.
5. **Routes** (spec §14, with one change): `POST /api/spaces/:sid/leave {keepCopy}`, `DELETE /api/spaces/:sid/members/:uid`, `DELETE /api/spaces/:sid {keepCopy}`, `POST /api/spaces/:sid/items/:id/keep`, `POST /api/spaces/:sid/absorb {items}`. Archiving is **`POST /api/spaces/:sid/archive {archived}`** rather than the spec's `PATCH /api/spaces/:sid`: every other space action is a POST, and nothing else in the Worker takes PATCH. `keepCopy` defaults to `true` when absent.
6. **Removed items on the client.** `applyPage` keeps a class item's tombstone in the `shared_items` store (with `deletedAt`) instead of deleting it; `reload()` splits the store into `data.shared_items` (live) and `data.removed_items` (tombstones). No IndexedDB version change. A removed item whose mark holds anything of yours (and that you did not hide) stays in `effectiveItems()` with `removed: {by, at}`, so it still counts in your grades and shows in your views until you choose (spec §13). Its card shows the banner and **Keep as mine** / **Dismiss**, plus **Restore for everyone** for the owner and editors; your layer on it is read-only (the Worker refuses a mark on a removed item). The class sheet lists removed items: those you hold something on, and every one for the owner and editors.
7. **Dismiss** deletes your mark (an ordinary personal delete). **Restore** writes the tombstone back whole at its revision, which the shared upsert revives (`deleted_at = NULL`).
8. **Revocation on the client** (spec §6). After a complete pull, `applyRevoked` also drops your marks and prefs in the lost spaces (unless an edit to them is waiting), and a waiting mark edit is carried onto your copy of the item when the copy has arrived (the item with the same id, else `'k'`-prefixed, with no `classId`): each field you changed since the edit began goes onto the copy, your notes replacing your part of the copy's notes. Because sync uploads before it downloads, a mark upload refused with `404` waits for the pull in the same cycle instead of going straight to Saved copies; if nothing carried it, it goes there then.
9. **Share one item** (`absorb {items}`, spec §13): the owner or an editor, on items of theirs **filed under the class** (`class_id`), not archived. Lecture reviews are refused (`400 {field:'items'}`), a custom-typed item too (`400 {field:'type'}`: give it a built-in type first), an id the class already has live is `409 {error:'exists'}`. The class item takes the facts; your status, grade, checklist, notes and completion go into your mark; your sessions and grade achievements on it get `space_id`.
10. **Account deletion** (spec §13): each class the account owns passes to its longest-standing editor, else its longest-standing member; one with nobody else in it is soft-deleted (the purge removes it 30 days later) and its invites deleted. Every space the account was in moves its revision on, so the others' member lists refresh. Memberships, invites, marks and prefs go by `ON DELETE CASCADE` (so `ACCOUNT_TABLES` needs no new entries, as the Stage 4 hand-off noted). Projects' assignees are Stage 8.
11. **The nightly purge** (spec §13), in order: (1) auto-**Keep as mine** every mark holding anything of yours on a class item whose tombstone expires; (2) delete the other marks on expiring shared items; (3) for each space deleted more than 30 days ago, its items, course, change feed, members, invites, marks and prefs, then the space; (4) today's floor and tombstones, now also `members`, and never an expiring class item that still has a meaningful live mark (it waits for the next night); invites 90 days after `created_at`. Activity rows are Stage 7.
12. **Sessions on a class you left without a copy** keep their minutes and ids; History and Today label them **A class you left**.
13. **Everything stays admin-only** (Stage 6 opens it): only admins are in spaces, so the new routes need no extra gate beyond membership.

## File map

| File | Change |
|---|---|
| `worker/leaving.js` | new: `MEANINGFUL`, `copyIds`, `copyClass`/`dropLayer`/`keepItems` statements, `leave`, `removeMember`, `setArchived`, `deleteClass`, `keep`, `shareItems`, `handOnStmts`, `autoKeep` |
| `worker/spaces.js` | `NEXT_ROW_REVISION` exported; `setRole`, `transfer` use the keeper guard |
| `worker/access.js` | `keeperGuard`, `assertKeeper` |
| `worker/classes.js` | the five routes; `absorb` body takes `{items}` too |
| `worker/db.js` | `purgeTombstones` in §13's order |
| `worker/admin.js` | account deletion hands spaces on instead of refusing |
| `src/components/admin/use-admin.ts` | `owns_space` message removed |
| `src/core/types.ts` | `SharedItem.deletedAt` |
| `src/core/store.ts` | tombstones kept; `removed_items`; `restoreShared`, `deleteMark`; `applyRevoked` drops your layer and carries waiting marks |
| `src/core/sync.ts` | a mark's `404` waits for the pull |
| `src/core/api.ts` | `spaces.leave`, `remove`, `archive`, `del`, `keep`, `share` |
| `src/data/effective.ts` | `meaningful`; removed items in the views |
| `src/data/store.ts` | `useRemovedItems` |
| `src/data/leave.ts` | new: `leaveClass`, `removeMember`, `setArchived`, `deleteClass`, `keepItem`, `dismissItem`, `restoreItem`, `shareItem`, `canShareItem`, `removedLine` |
| `src/data/classes.ts` | `messageFor` learns `owner`, `members`, `exists`, `archived` |
| `src/data/refs.ts` | `leftClass` |
| `src/data/study.ts`, `src/components/study/history.tsx` | "A class you left" |
| `src/components/sheet/class-actions.tsx` | new: archived banner, Leave / Archive / Delete |
| `src/components/sheet/removed.tsx` | new: `RemovedCard`, `RemovedList` |
| `src/components/sheet/share-item.tsx` | new: Share with the class |
| `src/components/sheet/class-sheet.tsx` | actions and removed list in Details |
| `src/components/sheet/members-tab.tsx` | Remove |
| `src/components/sheet/class-item-sheet.tsx` | a removed item opens `RemovedCard` |
| `src/components/sheet/item-sheet.tsx` | `ShareItem` |
| `docs/DATA-MODEL.md`, `docs/OVERVIEW.md`, master plan | the new routes and behaviour; Stage 5 row; Stage 6 hand-offs |
| Tests | new `test/leaving.test.js`, `test/space-admin.test.js`, `test/keep.test.js`, `src/data/removed.test.ts`, `src/components/sheet/leaving.test.tsx`; changed `test/purge.test.js`, `test/admin.test.js`, `test/members.test.js` (only if a case expects `403 archived` for roles/transfer), `test/local-store.node.mjs`, `test/sync.test.js` |

---

### Task 1: Detach statements (`worker/leaving.js`)

**Files:**
- Create: `worker/leaving.js`
- Modify: `worker/spaces.js:58` (export `NEXT_ROW_REVISION`), `test/spaces.js` (raw-row helpers)
- Test: `test/leaving.test.js` (created here; Task 2 adds route tests; this task tests the statements directly)

- [ ] **Step 1: Export the row revision from `worker/spaces.js`**

Change line 58:

```js
/* A row's first revision: the change feed's next sequence value, as worker/db.js writes it. */
export const NEXT_ROW_REVISION = "COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'changes'), 0) + 1";
```

- [ ] **Step 2: Add raw-row helpers to `test/spaces.js`** (Tasks 1, 2, 4 and 5 import them; a test file must never import another test file, or its tests run twice)

Append to `test/spaces.js`:

```js
/* Raw rows of a person's layer and labels, as Stage 5's tests need them. */
export function mark(userId, spaceId, itemId, cols = {}) {
  const row = { id: spaceId + ':' + itemId, space_id: spaceId, item_id: itemId, created_at: 1, updated_at: 1, ...cols };
  const names = Object.keys(row);
  return env.DB.prepare(`INSERT INTO marks (user_id, ${names.join(', ')}) VALUES (?, ${names.map(() => '?').join(', ')})`).bind(userId, ...Object.values(row)).run();
}
export const pref = (userId, spaceId, cols = {}) => {
  const row = { id: spaceId, space_id: spaceId, color: '#4F74D9', term: 'Fall 2026', target: 85, created_at: 1, updated_at: 1, ...cols };
  const names = Object.keys(row);
  return env.DB.prepare(`INSERT INTO space_prefs (user_id, ${names.join(', ')}) VALUES (?, ${names.map(() => '?').join(', ')})`).bind(userId, ...Object.values(row)).run();
};
export const ownItem = (userId, id, cols = {}) => {
  const row = { type: 'assignment', title: id, date: '2026-10-20', status: 'todo', created_at: 1, updated_at: 1, ...cols };
  const names = Object.keys(row);
  return env.DB.prepare(`INSERT INTO items (scope, id, ${names.join(', ')}) VALUES (?, ?, ${names.map(() => '?').join(', ')})`).bind('u:' + userId, id, ...Object.values(row)).run();
};
export const session = (userId, id, cols) => env.DB.prepare(`INSERT INTO study_sessions (user_id, id, course_id, item_id, space_id, started_at, study_minutes, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, 1700000000000, 25, 1, 1)`).bind(userId, id, cols.course_id ?? null, cols.item_id ?? null, cols.space_id ?? null).run();
export const achievement = (userId, id, cols) => env.DB.prepare(`INSERT INTO achievements (user_id, id, name, sticker, rule, course_id, item_id, space_id, target, created_at, updated_at)
  VALUES (?, ?, 'Ace', 'data:image/png;base64,AA', ?, ?, ?, ?, ?, 1, 1)`).bind(userId, id, cols.rule, cols.course_id ?? null, cols.item_id ?? null, cols.space_id ?? null, cols.target ?? 90).run();
```

- [ ] **Step 3: Write the failing test**

`test/leaving.test.js`:

```js
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createUser } from './helpers.js';
import { achievement, makeSpace, mark, ownItem, pref, session, sharedItem } from './spaces.js';
import { copyIds, detach } from '../worker/leaving.js';

let n = 0;
const rows = async (sql, ...binds) => (await env.DB.prepare(sql).bind(...binds).all()).results;
const one = (sql, ...binds) => env.DB.prepare(sql).bind(...binds).first();

/* A class with an owner and a member and three items; the member's layer on it. */
async function classWithLayer() {
  const tag = ++n, owner = await createUser('dtown' + tag), member = await createUser('dtmem' + tag);
  const s = await makeSpace({ members: { [owner]: 'owner', [member]: 'member' } });
  await sharedItem(s.scope, 'a1', { course_id: 'web', title: 'REST API Project', weight: 20, notes: 'Use the starter repo' });
  await sharedItem(s.scope, 'q1', { course_id: 'web', title: 'Quiz 1', weight: 10 });
  await sharedItem(s.scope, 'q2', { course_id: 'web', title: 'Quiz 2', weight: 10 });
  await mark(member, s.id, 'a1', { status: 'graded', grade: 88, notes: 'Mine' });
  await mark(member, s.id, 'q1', { hidden: 1 });
  await mark(member, s.id, 'q2', { hidden: 1, grade: 70 });
  await pref(member, s.id);
  await ownItem(member, 'f1', { class_id: s.id, title: 'Extra reading' });
  await session(member, 's1', { course_id: 'web', item_id: 'a1', space_id: s.id });
  await achievement(member, 'g1', { rule: 'grade', item_id: 'a1', space_id: s.id });
  return { owner, member, s };
}

const LEAVING = "EXISTS (SELECT 1 FROM members AS lv WHERE lv.space_id = ?2 AND lv.user_id = ?1 AND lv.deleted_at IS NULL AND lv.role != 'owner')";

describe('detach', () => {
  it('copies the class into your scope with your layer folded in, once', async () => {
    const { member, s } = await classWithLayer();
    expect(await detach(env.DB, member, s.id, { keepCopy: true, who: LEAVING, now: 50 })).toBe(true);
    expect(await one("SELECT id, name, color, term, target, archived FROM courses WHERE scope = 'u:' || ?", member))
      .toEqual({ id: 'web', name: 'Web Services', color: '#4F74D9', term: 'Fall 2026', target: 85, archived: 0 });
    expect(await rows("SELECT id, course_id, class_id, status, grade, weight, notes FROM items WHERE scope = 'u:' || ? ORDER BY id", member)).toEqual([
      { id: 'a1', course_id: 'web', class_id: null, status: 'graded', grade: 88, weight: 20, notes: 'Mine\n\nClass notes:\nUse the starter repo' },
      { id: 'f1', course_id: 'web', class_id: null, status: 'todo', grade: null, weight: null, notes: '' },
      { id: 'q2', course_id: 'web', class_id: null, status: 'todo', grade: 70, weight: 10, notes: '' },
    ]);
    expect(await one('SELECT course_id, item_id, space_id FROM study_sessions WHERE user_id = ?', member)).toEqual({ course_id: 'web', item_id: 'a1', space_id: null });
    expect(await one('SELECT item_id, space_id FROM achievements WHERE user_id = ?', member)).toEqual({ item_id: 'a1', space_id: null });
    expect(await one('SELECT count(*) AS n FROM marks WHERE user_id = ? AND deleted_at IS NULL', member)).toEqual({ n: 0 });
    expect(await one('SELECT count(*) AS n FROM space_prefs WHERE user_id = ? AND deleted_at IS NULL', member)).toEqual({ n: 0 });
    expect(await one('SELECT deleted_at FROM members WHERE space_id = ? AND user_id = ?', s.id, member)).toEqual({ deleted_at: 50 });
    expect(await one('SELECT count(*) AS n FROM items WHERE scope = ? AND deleted_at IS NULL', s.scope)).toEqual({ n: 3 });
    /* a retry finds no membership: nothing more */
    expect(await detach(env.DB, member, s.id, { keepCopy: true, who: LEAVING, now: 60 })).toBe(false);
    expect(await one("SELECT count(*) AS n FROM items WHERE scope = 'u:' || ?", member)).toEqual({ n: 3 });
  });

  it('without a copy, drops your layer and unfiles your items; sessions keep the class', async () => {
    const { member, s } = await classWithLayer();
    await detach(env.DB, member, s.id, { keepCopy: false, who: LEAVING, now: 50 });
    expect(await one("SELECT count(*) AS n FROM courses WHERE scope = 'u:' || ?", member)).toEqual({ n: 0 });
    expect(await rows("SELECT id, course_id, class_id FROM items WHERE scope = 'u:' || ?", member)).toEqual([{ id: 'f1', course_id: null, class_id: null }]);
    expect(await one('SELECT space_id FROM study_sessions WHERE user_id = ?', member)).toEqual({ space_id: s.id });
    expect(await one('SELECT count(*) AS n FROM marks WHERE user_id = ? AND deleted_at IS NULL', member)).toEqual({ n: 0 });
  });

  it("gives a copy a new id when a live row of yours has the class's, and revives a tombstone under its own", async () => {
    const { member, s } = await classWithLayer();
    await env.DB.prepare("INSERT INTO courses (scope, id, code, name, color, created_at, updated_at) VALUES ('u:' || ?, 'web', 'WEB', 'Mine', '#17B3AE', 1, 1)").bind(member).run();
    await ownItem(member, 'q2', { deleted_at: 3, title: 'Old quiz 2' });
    await ownItem(member, 'a1', { title: 'My own a1' });
    expect(await copyIds(env.DB, member, s.id)).toEqual({ course: 'kweb', items: JSON.stringify([['a1', 'ka1'], ['q1', 'q1'], ['q2', 'q2']]) });
    await detach(env.DB, member, s.id, { keepCopy: true, who: LEAVING, now: 50 });
    expect(await rows("SELECT id, course_id, title, deleted_at FROM items WHERE scope = 'u:' || ? AND id IN ('a1', 'ka1', 'q2') ORDER BY id", member)).toEqual([
      { id: 'a1', course_id: null, title: 'My own a1', deleted_at: null },
      { id: 'ka1', course_id: 'kweb', title: 'REST API Project', deleted_at: null },
      { id: 'q2', course_id: 'kweb', title: 'Quiz 2', deleted_at: null },
    ]);
    expect(await one('SELECT course_id, item_id FROM study_sessions WHERE user_id = ?', member)).toEqual({ course_id: 'kweb', item_id: 'ka1' });
  });

  it('brings a removed item along when your mark on it holds something', async () => {
    const { member, s } = await classWithLayer();
    await env.DB.prepare("UPDATE items SET deleted_at = 9 WHERE scope = ? AND id = 'a1'").bind(s.scope).run();
    await detach(env.DB, member, s.id, { keepCopy: true, who: LEAVING, now: 50 });
    expect(await one("SELECT grade, deleted_at FROM items WHERE scope = 'u:' || ? AND id = 'a1'", member)).toEqual({ grade: 88, deleted_at: null });
  });
});
```

- [ ] **Step 4: Run it to see it fail**

Run: `npx vitest run test/leaving.test.js`
Expected: FAIL, `Failed to load url ../worker/leaving.js`.

- [ ] **Step 5: Write `worker/leaving.js` (detach part)**

```js
// Leaving and removal (spec §13). Detach turns a class's rows into your own: leaving or being
// removed copies the class course and its items into your scope with your layer folded in;
// Keep as mine (and the nightly purge, for an item about to be purged) copies removed items,
// filed under the class. Each is a handful of set-based statements in one batch. Every
// statement carries a `live` condition that the batch's last write ends (your membership, or
// your mark), so a retry copies nothing twice. Statements use numbered parameters:
//   ?1 whose rows   ?2 the space   ?3 'u:' || ?1   ?4 'c:' || ?2   ?5 now
//   ?6 the item ids a copy takes, [[class id, copy id]]   ?7 the course copy's id
//   ?8 the items a keep copies (JSON)   ?9 who acts (a removal's owner)
import { NEXT_ROW_REVISION, NEXT_SPACE_REVISION, touchSpace } from './spaces.js';

/** A mark holding anything of yours (spec §13): a status, grade, weight, notes, a checklist or a completion. `m` is its alias. */
export const MEANINGFUL = (m) =>
  `(${m}.status != 'todo' OR ${m}.grade IS NOT NULL OR ${m}.weight IS NOT NULL OR ${m}.notes != '' OR ${m}.checklist != '[]' OR ${m}.completed_at IS NOT NULL)`;

/* Bind only the numbered parameters a statement uses: SQLite counts up to the highest. */
function prepare(db, sql, values) {
  const n = Math.max(0, ...[...sql.matchAll(/\?(\d+)/g)].map((m) => Number(m[1])));
  return db.prepare(sql).bind(...values.slice(0, n));
}
const valuesOf = ({ userId, spaceId, now, items = '[]', course = null, only = null, actor = null }) =>
  [userId, spaceId, 'u:' + userId, 'c:' + spaceId, now, items, course, only, actor];

/* The copy ids as rows, and a class id's copy (the id itself when the map has none). */
const MAP = "(SELECT json_extract(value, '$[0]') AS from_id, json_extract(value, '$[1]') AS to_id FROM json_each(?6))";
const TO = (col) => `COALESCE((SELECT to_id FROM ${MAP} WHERE from_id = ${col}), ${col})`;

/**
 * The ids a copy into your scope takes (spec §13): each class row's own, unless a live row of
 * yours already has it, then 'k' and its first 23 characters. `only` limits the items (a keep).
 * Returns {course: the course copy's id or null, items: JSON [[class id, copy id]]}.
 */
export async function copyIds(db, userId, spaceId, only = null) {
  const mine = 'u:' + userId, scope = 'c:' + spaceId;
  const [course, items] = await db.batch([
    db.prepare(`SELECT c.id, EXISTS (SELECT 1 FROM courses AS x WHERE x.scope = ?1 AND x.id = c.id AND x.deleted_at IS NULL) AS clash
      FROM courses AS c WHERE c.scope = ?2 LIMIT 1`).bind(mine, scope),
    db.prepare(`SELECT i.id, EXISTS (SELECT 1 FROM items AS x WHERE x.scope = ?1 AND x.id = i.id AND x.deleted_at IS NULL) AS clash
      FROM items AS i WHERE i.scope = ?2${only ? ' AND i.id IN (SELECT value FROM json_each(?3))' : ''} ORDER BY i.id`)
      .bind(mine, scope, ...(only ? [JSON.stringify(only)] : [])),
  ]);
  const to = (r) => (r.clash ? 'k' + r.id.slice(0, 23) : r.id);
  return { course: course.results[0] ? to(course.results[0]) : null, items: JSON.stringify(items.results.map((r) => [r.id, to(r)])) };
}

/* Your notes win; the class's follow under "Class notes:" (spec §13). */
const NOTES = `substr(CASE WHEN i.notes = '' THEN COALESCE(m.notes, '')
    WHEN COALESCE(m.notes, '') = '' THEN 'Class notes:' || char(10) || i.notes
    ELSE m.notes || char(10) || char(10) || 'Class notes:' || char(10) || i.notes END, 1, 5000)`;

/* Class items `which` into your scope as copies, your mark folded in; an upsert, so a tombstone of yours revives. */
const itemCopy = (which, course, classId) => `INSERT INTO items (scope, id, type, title, course_id, date, start, end, location, status, grade, weight, notes,
    checklist, links, recur, weekday, recur_until, dept, completed_at, class_id, created_at, updated_at, revision)
  SELECT ?3, map.to_id, i.type, i.title, ${course}, i.date, i.start, i.end, i.location, COALESCE(m.status, 'todo'), m.grade, COALESCE(m.weight, i.weight), ${NOTES},
    COALESCE(m.checklist, '[]'), i.links, i.recur, i.weekday, i.recur_until, i.dept, m.completed_at, ${classId}, ?5, ?5, ${NEXT_ROW_REVISION}
  FROM items AS i JOIN ${MAP} AS map ON map.from_id = i.id
    LEFT JOIN marks AS m ON m.user_id = ?1 AND m.space_id = ?2 AND m.item_id = i.id AND m.deleted_at IS NULL
  WHERE i.scope = ?4 AND ${which}
  ON CONFLICT (scope, id) DO UPDATE SET type = excluded.type, title = excluded.title, course_id = excluded.course_id, date = excluded.date,
    start = excluded.start, end = excluded.end, location = excluded.location, status = excluded.status, grade = excluded.grade,
    weight = excluded.weight, notes = excluded.notes, checklist = excluded.checklist, links = excluded.links, recur = excluded.recur,
    weekday = excluded.weekday, recur_until = excluded.recur_until, dept = excluded.dept, completed_at = excluded.completed_at,
    class_id = excluded.class_id, updated_at = excluded.updated_at, deleted_at = NULL, revision = items.revision + 1
    WHERE items.deleted_at IS NOT NULL`;

/* What a copy takes (Decision 2): live items, except hidden ones holding nothing of yours that
   nothing of yours points at; removed items holding something of yours. */
const TAKEN = `((i.deleted_at IS NULL AND (COALESCE(m.hidden, 0) = 0 OR ${MEANINGFUL('m')}
      OR EXISTS (SELECT 1 FROM study_sessions AS ss WHERE ss.user_id = ?1 AND ss.space_id = ?2 AND ss.item_id = i.id AND ss.deleted_at IS NULL)
      OR EXISTS (SELECT 1 FROM achievements AS aa WHERE aa.user_id = ?1 AND aa.space_id = ?2 AND aa.item_id = i.id AND aa.deleted_at IS NULL)))
  OR (i.deleted_at IS NOT NULL AND m.id IS NOT NULL AND ${MEANINGFUL('m')}))`;

/* Your layer in the space, deleted. */
const layerGone = (live) => [
  `UPDATE marks SET deleted_at = ?5, updated_at = ?5, revision = revision + 1 WHERE user_id = ?1 AND space_id = ?2 AND deleted_at IS NULL AND ${live}`,
  `UPDATE space_prefs SET deleted_at = ?5, updated_at = ?5, revision = revision + 1 WHERE user_id = ?1 AND space_id = ?2 AND deleted_at IS NULL AND ${live}`,
];

/** The class copied into your scope (spec §13 Detach), then your layer there deleted. */
const copyClass = (live) => [
  `INSERT INTO courses (scope, id, code, name, color, instructor, term, archived, meetings, target, created_at, updated_at, revision)
    SELECT ?3, ?7, c.code, c.name, COALESCE(p.color, c.color), c.instructor, COALESCE(p.term, c.term), COALESCE(p.archived, 0), c.meetings, p.target, ?5, ?5, ${NEXT_ROW_REVISION}
    FROM courses AS c LEFT JOIN space_prefs AS p ON p.user_id = ?1 AND p.id = ?2 AND p.deleted_at IS NULL
    WHERE c.scope = ?4 AND c.deleted_at IS NULL AND ${live}
    ON CONFLICT (scope, id) DO UPDATE SET code = excluded.code, name = excluded.name, color = excluded.color, instructor = excluded.instructor,
      term = excluded.term, archived = excluded.archived, meetings = excluded.meetings, target = excluded.target,
      updated_at = excluded.updated_at, deleted_at = NULL, revision = courses.revision + 1 WHERE courses.deleted_at IS NOT NULL`,
  itemCopy(`${TAKEN} AND ${live}`, 'CASE WHEN i.course_id IS NULL THEN NULL ELSE ?7 END', 'NULL'),
  `UPDATE items SET course_id = ?7, class_id = NULL, updated_at = ?5, revision = revision + 1
    WHERE scope = ?3 AND class_id = ?2 AND deleted_at IS NULL AND ${live}`,
  `UPDATE study_sessions SET space_id = NULL, course_id = CASE WHEN course_id IS NULL THEN NULL ELSE ?7 END,
      item_id = CASE WHEN item_id IS NULL THEN NULL ELSE ${TO('study_sessions.item_id')} END, updated_at = ?5, revision = revision + 1
    WHERE user_id = ?1 AND space_id = ?2 AND deleted_at IS NULL AND ${live}`,
  `UPDATE achievements SET space_id = NULL, course_id = CASE WHEN course_id IS NULL THEN NULL ELSE ?7 END,
      item_id = CASE WHEN item_id IS NULL THEN NULL ELSE ${TO('achievements.item_id')} END, updated_at = ?5, revision = revision + 1
    WHERE user_id = ?1 AND space_id = ?2 AND deleted_at IS NULL AND ${live}`,
  ...layerGone(live),
];

/** Leaving without a copy (spec §13): your items filed under the class stay, without a course; sessions keep the class. */
const dropLayer = (live) => [
  `UPDATE items SET class_id = NULL, updated_at = ?5, revision = revision + 1 WHERE scope = ?3 AND class_id = ?2 AND deleted_at IS NULL AND ${live}`,
  ...layerGone(live),
];

/**
 * Detach `userId` from the class `spaceId` and end their membership, in one batch: a copy
 * (keepCopy) or only their layer dropped. `who` is the SQL the membership must still meet
 * (leaving, a removal by ?9, or closing the class); `closing` also deletes the space's
 * invites and, once nobody is left, the space. True when the membership ended now.
 */
export async function detach(db, userId, spaceId, { keepCopy, who, actor = null, closing = false, now = Date.now() }) {
  const ids = keepCopy ? await copyIds(db, userId, spaceId) : { course: null, items: '[]' };
  const v = valuesOf({ userId, spaceId, now, items: ids.items, course: ids.course, actor });
  const live = `EXISTS (SELECT 1 FROM spaces AS ls WHERE ls.id = ?2 AND ls.deleted_at IS NULL) AND ${who}`;
  const stmts = (keepCopy ? copyClass(live) : dropLayer(live)).map((sql) => prepare(db, sql, v));
  if (closing) stmts.push(prepare(db, `DELETE FROM invites WHERE space_id = ?2 AND ${live}`, v));
  stmts.push(
    prepare(db, `UPDATE members SET deleted_at = ?5, updated_at = ?5, revision = revision + 1 WHERE space_id = ?2 AND user_id = ?1 AND deleted_at IS NULL AND ${live}`, v),
    db.prepare('SELECT changes() AS n'),
    closing
      ? prepare(db, `UPDATE spaces SET deleted_at = ?5, updated_at = ?5, revision = ${NEXT_SPACE_REVISION}
          WHERE id = ?2 AND deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM members WHERE space_id = ?2 AND deleted_at IS NULL)
            AND EXISTS (SELECT 1 FROM members WHERE space_id = ?2 AND user_id = ?1 AND role = 'owner' AND deleted_at = ?5)`, v)
      : touchSpace(db, spaceId, now, { ifChanged: true }),
  );
  const results = await db.batch(stmts);
  return results[results.length - 2].results[0].n > 0;
}
```

Note: `touchSpace(…, {ifChanged: true})` checks `changes()`, which a `SELECT` does not reset, so it still sees the membership update.

- [ ] **Step 6: Run the test**

Run: `npx vitest run test/leaving.test.js`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add worker/leaving.js worker/spaces.js test/spaces.js test/leaving.test.js
git commit -m "Stage 5: detach statements (copy a class into your scope, or drop your layer)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Leave and remove routes

**Files:**
- Modify: `worker/access.js` (keeper guard), `worker/leaving.js` (`leave`, `removeMember`), `worker/classes.js` (routes), `worker/spaces.js` (`setRole`, `transfer` on the keeper guard)
- Test: `test/leaving.test.js` (new `describe`)

- [ ] **Step 1: Write the failing tests** (append to `test/leaving.test.js`)

```js
import { post, signInAdmin, spaceRevision } from './spaces.js';

describe('leaving and removing, through the routes', () => {
  async function three() {
    const tag = ++n;
    const owner = await signInAdmin('lvo' + tag), member = await signInAdmin('lvm' + tag), outsider = await signInAdmin('lvx' + tag);
    const s = await makeSpace({ members: { [owner.id]: 'owner', [member.id]: 'member' } });
    await sharedItem(s.scope, 'a1', { course_id: 'web', weight: 20 });
    await mark(member.id, s.id, 'a1', { grade: 75 });
    return { owner, member, outsider, s };
  }

  it('a member leaves with a copy by default, and the revision moves', async () => {
    const { member, s } = await three();
    const before = await spaceRevision(s.id);
    expect((await post(member, `/api/spaces/${s.id}/leave`, {})).status).toBe(204);
    expect(await one("SELECT grade FROM items WHERE scope = 'u:' || ? AND id = 'a1'", member.id)).toEqual({ grade: 75 });
    expect(await spaceRevision(s.id)).toBeGreaterThan(before);
    expect((await post(member, `/api/spaces/${s.id}/leave`, {})).status).toBe(404);
  });

  it('keepCopy false leaves no course; a bad keepCopy is refused', async () => {
    const { member, s } = await three();
    expect(await (await post(member, `/api/spaces/${s.id}/leave`, { keepCopy: 'yes' })).json()).toEqual({ error: 'invalid', field: 'keepCopy' });
    expect((await post(member, `/api/spaces/${s.id}/leave`, { keepCopy: false })).status).toBe(204);
    expect(await one("SELECT count(*) AS n FROM courses WHERE scope = 'u:' || ?", member.id)).toEqual({ n: 0 });
  });

  it('the owner cannot leave; an outsider gets 404', async () => {
    const { owner, outsider, s } = await three();
    const res = await post(owner, `/api/spaces/${s.id}/leave`, {});
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'owner' });
    expect((await post(outsider, `/api/spaces/${s.id}/leave`, {})).status).toBe(404);
  });

  it('the owner removes a member, who keeps a copy; nobody else removes, nor the owner themselves', async () => {
    const { owner, member, outsider, s } = await three();
    const remove = (api, uid) => api(`/api/spaces/${s.id}/members/${uid}`, { method: 'DELETE' });
    expect((await remove(member, owner.id)).status).toBe(403);
    expect((await remove(outsider, member.id)).status).toBe(404);
    expect((await remove(owner, owner.id)).status).toBe(403);
    expect((await remove(owner, member.id)).status).toBe(204);
    expect(await one("SELECT grade FROM items WHERE scope = 'u:' || ? AND id = 'a1'", member.id)).toEqual({ grade: 75 });
    expect(await one('SELECT deleted_at IS NOT NULL AS gone FROM members WHERE space_id = ? AND user_id = ?', s.id, member.id)).toEqual({ gone: 1 });
    expect((await remove(owner, member.id)).status).toBe(404);
  });

  it('a member who merged their course gets it back under its ids on leaving', async () => {
    const { member, s } = await three();
    await env.DB.prepare("INSERT INTO courses (scope, id, code, name, color, created_at, updated_at, deleted_at) VALUES ('u:' || ?, 'web', 'WEB', 'Web', '#17B3AE', 1, 1, 5)").bind(member.id).run();
    expect((await post(member, `/api/spaces/${s.id}/leave`, {})).status).toBe(204);
    expect(await one("SELECT id, deleted_at FROM courses WHERE scope = 'u:' || ?", member.id)).toEqual({ id: 'web', deleted_at: null });
  });
});
```

Merge `post, signInAdmin, spaceRevision` into the file's existing `./spaces.js` import at the top instead of a second import line.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run test/leaving.test.js`
Expected: the five new tests FAIL with `405` / `404` (no such routes).

- [ ] **Step 3: Add the keeper guard to `worker/access.js`**

After `ownerGuard`:

```js
/** The owner's management of the space, archived or not: roles, transfer, removing, archiving (Stage 5 plan, Decision 4). */
export const keeperGuard = guard(" AND gm.role = 'owner'");
```

After `assertOwner`:

```js
/** 404 outside the space, 403 forbidden for anyone in it but its owner; archived or not. */
export async function assertKeeper(db, userId, spaceId) {
  const r = await assertAllowed(db, userId, spaceId, 'read');
  if (r.role !== 'owner') throw new HttpError(403, { error: 'forbidden' });
  return r;
}
```

- [ ] **Step 4: Put `setRole` and `transfer` on it (`worker/spaces.js`)**

Change the import: `import { assertAllowed, assertKeeper, keeperGuard, memberGuard, scopeOf } from './access.js';` (drop `assertOwner`, `ownerGuard` if nothing else in the file uses them: `grep -n "assertOwner\|ownerGuard" worker/spaces.js`).

In `setRole`, replace `await assertOwner(db, userId, spaceId);` with `await assertKeeper(db, userId, spaceId);` and `const g = ownerGuard(spaceId, userId);` with `const g = keeperGuard(spaceId, userId);`. In `transfer`, the same two replacements. Update both doc comments to say "archived or not".

- [ ] **Step 5: Add `leave` and `removeMember` to `worker/leaving.js`**

Add to the imports: `import { HttpError } from './http.js';` and `import { assertAllowed, assertKeeper, roleOf } from './access.js';`. Then:

```js
/* Whom a statement may still detach: a live member who is not the owner (leaving, or removed by ?9, the live owner). */
const LEAVING = "EXISTS (SELECT 1 FROM members AS lv WHERE lv.space_id = ?2 AND lv.user_id = ?1 AND lv.deleted_at IS NULL AND lv.role != 'owner')";
const REMOVING = `${LEAVING} AND EXISTS (SELECT 1 FROM members AS ow WHERE ow.space_id = ?2 AND ow.user_id = ?9 AND ow.role = 'owner' AND ow.deleted_at IS NULL)`;

/** Leave a class (spec §13): with a copy (the default) or without one. The owner hands it on first: 403 owner. */
export async function leave(db, userId, spaceId, keepCopy, now = Date.now()) {
  const me = await assertAllowed(db, userId, spaceId, 'read');
  if (me.kind !== 'class') throw new HttpError(404, { error: 'not_found' });
  if (me.role === 'owner') throw new HttpError(403, { error: 'owner' });
  if (!(await detach(db, userId, spaceId, { keepCopy, who: LEAVING, now }))) throw new HttpError(404, { error: 'not_found' });
}

/** The owner removes a member, who always keeps a copy (spec §13); never themselves or the owner. 404 when not a live member. */
export async function removeMember(db, userId, spaceId, targetId, now = Date.now()) {
  const me = await assertKeeper(db, userId, spaceId);
  if (me.kind !== 'class') throw new HttpError(404, { error: 'not_found' });
  if (targetId === userId) throw new HttpError(403, { error: 'forbidden' });
  if (await detach(db, targetId, spaceId, { keepCopy: true, who: REMOVING, actor: userId, now })) return;
  const them = await roleOf(db, targetId, spaceId);
  throw them ? new HttpError(403, { error: 'forbidden' }) : new HttpError(404, { error: 'not_found' });
}
```

In Task 1's test, `LEAVING` was written out by hand; leave it there (the test checks the statements, not the module's constant).

- [ ] **Step 6: Add the routes to `worker/classes.js`**

Import `leave, removeMember` from `./leaving.js`. Add a helper below `idOf`:

```js
/* keepCopy: on unless false is sent. */
function keepOf(v) {
  if (v == null) return true;
  if (typeof v !== 'boolean') throw bad('keepCopy');
  return v;
}
```

Add to `classRoutes`:

```js
  ['POST', route(`spaces/${SID}/leave`), async ({ request, env, params: [sid] }) => {
    const userId = await requireUser(request, env);
    await leave(env.DB, userId, sid, keepOf((await readJson(request)).keepCopy));
    return done();
  }],
  ['DELETE', route(`spaces/${SID}/members/${UID}`), async ({ request, env, params: [sid, uid] }) => {
    await removeMember(env.DB, await requireUser(request, env), sid, uid);
    return done();
  }],
```

`readJson` on an empty body: check `worker/http.js` (`grep -n "export async function readJson" -A8 worker/http.js`). If it throws on an empty body, the client always sends `{}` or `{keepCopy}` and the tests post `{}`: keep it as it is.

- [ ] **Step 7: Run the tests**

Run: `npx vitest run test/leaving.test.js test/members.test.js`
Expected: PASS. If a `members.test.js` case expects `403 archived` for a role change or transfer in an archived space, change it to expect `204`/`200` (Decision 4) in this task.

- [ ] **Step 8: Commit**

```bash
git add worker/access.js worker/spaces.js worker/leaving.js worker/classes.js test/leaving.test.js test/members.test.js
git commit -m "Stage 5: leave a class (with or without a copy) and remove a member

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Archive, unarchive, delete a class

**Files:**
- Modify: `worker/leaving.js` (`setArchived`, `deleteClass`), `worker/classes.js` (routes)
- Test: `test/space-admin.test.js`

- [ ] **Step 1: Write the failing test**

`test/space-admin.test.js`:

```js
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { makeSpace, post, sharedItem, signInAdmin, spaceRevision } from './spaces.js';

let n = 0;
const one = (sql, ...binds) => env.DB.prepare(sql).bind(...binds).first();
async function pair() {
  const tag = ++n, owner = await signInAdmin('sao' + tag), member = await signInAdmin('sam' + tag);
  const s = await makeSpace({ members: { [owner.id]: 'owner', [member.id]: 'editor' } });
  await sharedItem(s.scope, 'a1', { course_id: 'web' });
  return { owner, member, s };
}

describe('archiving a class', () => {
  it('the owner archives and unarchives; it is read-only meanwhile, but the owner still manages members', async () => {
    const { owner, member, s } = await pair();
    const archive = (api, archived) => post(api, `/api/spaces/${s.id}/archive`, { archived });
    expect((await archive(member, true)).status).toBe(403);
    expect(await (await archive(owner, 'yes')).json()).toEqual({ error: 'invalid', field: 'archived' });
    const before = await spaceRevision(s.id);
    expect((await archive(owner, true)).status).toBe(204);
    expect(await one('SELECT archived FROM spaces WHERE id = ?', s.id)).toEqual({ archived: 1 });
    expect(await spaceRevision(s.id)).toBeGreaterThan(before);
    /* shared edits and invites are refused; a role change and a transfer are not */
    const edit = await member(`/api/spaces/${s.id}/items/a1`, { method: 'DELETE', headers: { 'if-match': '"1"' } });
    expect(await edit.json()).toEqual({ error: 'archived' });
    expect((await post(owner, `/api/spaces/${s.id}/invites`, { username: 'nobody' })).status).toBe(403);
    expect((await owner(`/api/spaces/${s.id}/members/${member.id}`, { method: 'PUT', body: { role: 'member' } })).status).toBe(200);
    expect((await post(owner, `/api/spaces/${s.id}/transfer`, { userId: member.id })).status).toBe(204);
    /* the new owner unarchives; again is a no-op */
    expect((await archive(member, false)).status).toBe(204);
    expect((await archive(member, false)).status).toBe(204);
    expect(await one('SELECT archived FROM spaces WHERE id = ?', s.id)).toEqual({ archived: 0 });
  });
});

describe('deleting a class', () => {
  it('only while the owner is its only member; with a copy by default', async () => {
    const { owner, member, s } = await pair();
    const del = (api, body = {}) => api(`/api/spaces/${s.id}`, { method: 'DELETE', body });
    expect((await del(member)).status).toBe(403);
    const busy = await del(owner);
    expect(busy.status).toBe(409);
    expect(await busy.json()).toEqual({ error: 'members' });
    await env.DB.prepare("INSERT INTO invites (space_id, user_id, role, created_at, expires_at) VALUES (?, ?, 'member', 1, 2)").bind(s.id, member.id).run();
    expect((await owner(`/api/spaces/${s.id}/members/${member.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await del(owner)).status).toBe(204);
    expect(await one('SELECT deleted_at IS NOT NULL AS gone FROM spaces WHERE id = ?', s.id)).toEqual({ gone: 1 });
    expect(await one("SELECT count(*) AS n FROM courses WHERE scope = 'u:' || ?", owner.id)).toEqual({ n: 1 });
    expect(await one('SELECT count(*) AS n FROM invites WHERE space_id = ?', s.id)).toEqual({ n: 0 });
    expect(await one('SELECT count(*) AS n FROM members WHERE space_id = ? AND deleted_at IS NULL', s.id)).toEqual({ n: 0 });
    expect((await owner(`/api/spaces/${s.id}`)).status).toBe(404);
    expect((await del(owner)).status).toBe(404);
  });

  it('without a copy, nothing comes into your scope', async () => {
    const tag = ++n, owner = await signInAdmin('solo' + tag);
    const s = await makeSpace({ members: { [owner.id]: 'owner' } });
    expect((await owner(`/api/spaces/${s.id}`, { method: 'DELETE', body: { keepCopy: false } })).status).toBe(204);
    expect(await one("SELECT count(*) AS n FROM courses WHERE scope = 'u:' || ?", owner.id)).toEqual({ n: 0 });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run test/space-admin.test.js`
Expected: FAIL (`405` for `/archive` and `DELETE /api/spaces/:sid`).

- [ ] **Step 3: Add `setArchived` and `deleteClass` to `worker/leaving.js`**

Add `keeperGuard` to the `./access.js` import, `LIVE_MEMBERS` to the `./spaces.js` import. Then:

```js
/** Archive or unarchive a class (spec §13), the owner only, archived or not; moves the revision when it changes. */
export async function setArchived(db, userId, spaceId, archived, now = Date.now()) {
  await assertKeeper(db, userId, spaceId);
  const g = keeperGuard(spaceId, userId), a = archived ? 1 : 0;
  await db.prepare(`UPDATE spaces SET archived = ?, updated_at = ?, revision = ${NEXT_SPACE_REVISION} WHERE id = ? AND archived != ? AND ${g.sql}`)
    .bind(a, now, spaceId, a, ...g.binds).run();
}

/* The owner, the space's only live member. */
const CLOSING = "EXISTS (SELECT 1 FROM members AS lv WHERE lv.space_id = ?2 AND lv.user_id = ?1 AND lv.deleted_at IS NULL AND lv.role = 'owner') AND (SELECT count(*) FROM members AS sm WHERE sm.space_id = ?2 AND sm.deleted_at IS NULL) = 1";

/**
 * Delete a class (spec §13): the owner, while nobody else is in it (409 members). Keep a copy
 * (the default) detaches first; the invites go, then the membership, then the space. Sync
 * revokes it from every device; the nightly purge removes it 30 days later.
 */
export async function deleteClass(db, userId, spaceId, keepCopy, now = Date.now()) {
  const me = await assertKeeper(db, userId, spaceId);
  if (me.kind !== 'class') throw new HttpError(404, { error: 'not_found' });
  const { n } = await db.prepare(`SELECT ${LIVE_MEMBERS('?')} AS n`).bind(spaceId).first();
  if (n > 1) throw new HttpError(409, { error: 'members' });
  if (!(await detach(db, userId, spaceId, { keepCopy, who: CLOSING, closing: true, now }))) throw new HttpError(404, { error: 'not_found' });
}
```

- [ ] **Step 4: Add the routes to `worker/classes.js`**

Import `setArchived, deleteClass`. Add:

```js
  ['POST', route(`spaces/${SID}/archive`), async ({ request, env, params: [sid] }) => {
    const userId = await requireUser(request, env);
    const { archived } = await readJson(request);
    if (typeof archived !== 'boolean') throw bad('archived');
    await setArchived(env.DB, userId, sid, archived);
    return done();
  }],
  ['DELETE', route(`spaces/${SID}`), async ({ request, env, params: [sid] }) => {
    const userId = await requireUser(request, env);
    await deleteClass(env.DB, userId, sid, keepOf((await readJson(request)).keepCopy));
    return done();
  }],
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run test/space-admin.test.js test/leaving.test.js test/members.test.js test/invites.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add worker/leaving.js worker/classes.js test/space-admin.test.js
git commit -m "Stage 5: archive, unarchive and delete a class

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Keep as mine, and share one item with the class

**Files:**
- Modify: `worker/leaving.js` (`keepItems`, `keep`, `shareItems`), `worker/classes.js` (keep route; absorb takes `{items}`)
- Test: `test/keep.test.js`

- [ ] **Step 1: Write the failing test**

`test/keep.test.js`:

```js
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { achievement, makeSpace, mark, ownItem, post, session, sharedItem, signInAdmin } from './spaces.js';

let n = 0;
const one = (sql, ...binds) => env.DB.prepare(sql).bind(...binds).first();
async function pair(role = 'member') {
  const tag = ++n, owner = await signInAdmin('kpo' + tag), member = await signInAdmin('kpm' + tag);
  const s = await makeSpace({ members: { [owner.id]: 'owner', [member.id]: role } });
  return { owner, member, s };
}

describe('Keep as mine', () => {
  it('copies a removed item with your layer into your scope, filed under the class', async () => {
    const { owner, member, s } = await pair();
    await sharedItem(s.scope, 'a1', { course_id: 'web', title: 'Lab 3', weight: 15, deleted_at: 9, updated_by: owner.id });
    await mark(member.id, s.id, 'a1', { grade: 90, status: 'graded' });
    await session(member.id, 's1', { course_id: 'web', item_id: 'a1', space_id: s.id });
    const keep = () => post(member, `/api/spaces/${s.id}/items/a1/keep`);
    expect((await keep()).status).toBe(204);
    expect(await one("SELECT title, course_id, class_id, grade, status, weight FROM items WHERE scope = 'u:' || ? AND id = 'a1'", member.id))
      .toEqual({ title: 'Lab 3', course_id: null, class_id: s.id, grade: 90, status: 'graded', weight: 15 });
    expect(await one('SELECT deleted_at IS NOT NULL AS gone FROM marks WHERE user_id = ?', member.id)).toEqual({ gone: 1 });
    expect(await one('SELECT course_id, item_id, space_id FROM study_sessions WHERE user_id = ?', member.id)).toEqual({ course_id: null, item_id: 'a1', space_id: null });
    expect((await keep()).status).toBe(404);
  });

  it('is refused on a live item, on one holding nothing of yours, and outside the class', async () => {
    const { owner, member, s } = await pair();
    await sharedItem(s.scope, 'live', { course_id: 'web' });
    await sharedItem(s.scope, 'bare', { course_id: 'web', deleted_at: 9 });
    await mark(member.id, s.id, 'live', { grade: 50 });
    await mark(member.id, s.id, 'bare', { hidden: 1 });
    expect((await post(member, `/api/spaces/${s.id}/items/live/keep`)).status).toBe(404);
    expect((await post(member, `/api/spaces/${s.id}/items/bare/keep`)).status).toBe(404);
    const outsider = await signInAdmin('kpx' + ++n);
    expect((await post(outsider, `/api/spaces/${s.id}/items/bare/keep`)).status).toBe(404);
    expect(owner).toBeTruthy();
  });
});

describe('sharing one item with the class', () => {
  it('makes an item filed under the class a class item, your layer moving to a mark', async () => {
    const { owner, s } = await pair();
    await ownItem(owner.id, 'p1', { class_id: s.id, title: 'Reading 4', status: 'done', notes: 'Chapter 4 only', weight: 5 });
    await session(owner.id, 's1', { item_id: 'p1' });
    await achievement(owner.id, 'g1', { rule: 'grade', item_id: 'p1' });
    const res = await post(owner, `/api/spaces/${s.id}/absorb`, { items: ['p1'] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ shared: 1 });
    expect(await one('SELECT title, course_id, status, notes, weight, updated_by FROM items WHERE scope = ? AND id = ?', s.scope, 'p1'))
      .toEqual({ title: 'Reading 4', course_id: 'web', status: 'todo', notes: '', weight: 5, updated_by: owner.id });
    expect(await one('SELECT status, notes FROM marks WHERE user_id = ? AND id = ?', owner.id, s.id + ':p1')).toEqual({ status: 'done', notes: 'Chapter 4 only' });
    expect(await one("SELECT deleted_at IS NOT NULL AS gone FROM items WHERE scope = 'u:' || ? AND id = 'p1'", owner.id)).toEqual({ gone: 1 });
    expect(await one('SELECT course_id, space_id FROM study_sessions WHERE user_id = ?', owner.id)).toEqual({ course_id: 'web', space_id: s.id });
    expect(await one('SELECT space_id FROM achievements WHERE user_id = ?', owner.id)).toEqual({ space_id: s.id });
    /* a retry: the item is no longer yours to share */
    expect((await post(owner, `/api/spaces/${s.id}/absorb`, { items: ['p1'] })).status).toBe(400);
  });

  it('refuses members, custom types, lecture reviews, items not filed under it, and an id the class has', async () => {
    const { owner, member, s } = await pair();
    await ownItem(member.id, 'm1', { class_id: s.id });
    expect((await post(member, `/api/spaces/${s.id}/absorb`, { items: ['m1'] })).status).toBe(403);
    await ownItem(owner.id, 'c1', { class_id: s.id, type: 'c-essay' });
    expect(await (await post(owner, `/api/spaces/${s.id}/absorb`, { items: ['c1'] })).json()).toEqual({ error: 'invalid', field: 'type' });
    await ownItem(owner.id, 'loose');
    expect(await (await post(owner, `/api/spaces/${s.id}/absorb`, { items: ['loose'] })).json()).toEqual({ error: 'invalid', field: 'items' });
    await ownItem(owner.id, 'dup', { class_id: s.id });
    await sharedItem(s.scope, 'dup', { course_id: 'web' });
    expect(await (await post(owner, `/api/spaces/${s.id}/absorb`, { items: ['dup'] })).json()).toEqual({ error: 'exists' });
  });
});
```

`c-essay` must be a type the schema accepts for a personal item (`type GLOB 'c-*'`); if `ownItem` fails on it, look at the items `type` CHECK in `migrations/0001_schema.sql` and use a custom type id it allows.

The lecture-review refusal is covered by `REVIEW_ID` (`src/core/shared.ts`): add a case with an id matching `REVIEW_ID` if you can build one from that regex (`grep -n "REVIEW_ID" src/core/shared.ts`).

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run test/keep.test.js`
Expected: FAIL (`405` on `/keep`; absorb answers `400 courseId` for `{items}`).

- [ ] **Step 3: Add `keepItems`, `keep`, `shareItems` to `worker/leaving.js`**

Add `import { REVIEW_ID } from '../src/core/shared.ts';`.

```js
/* Your live mark on one of the items a keep names. */
const MARK_LIVE = "EXISTS (SELECT 1 FROM marks AS k WHERE k.user_id = ?1 AND k.space_id = ?2 AND k.deleted_at IS NULL AND k.item_id IN (SELECT value FROM json_each(?8)))";
const MEMBER_LIVE = 'EXISTS (SELECT 1 FROM members AS km WHERE km.space_id = ?2 AND km.user_id = ?1 AND km.deleted_at IS NULL)';

/**
 * Keep as mine (spec §13): each removed class item `only` names that holds something of yours
 * becomes your own item, filed under the class, with your layer folded in; your sessions and
 * grade achievements on it follow; your marks on them go. With `member`, only while you are
 * still in the class (the route); the nightly purge keeps without it.
 */
export async function keepItems(db, userId, spaceId, only, now = Date.now(), { member = false } = {}) {
  const ids = await copyIds(db, userId, spaceId, only);
  const v = valuesOf({ userId, spaceId, now, items: ids.items, only: JSON.stringify(only) });
  const live = member ? `${MARK_LIVE} AND ${MEMBER_LIVE}` : MARK_LIVE;
  const ONLY = '(SELECT value FROM json_each(?8))';
  await db.batch([
    itemCopy(`i.deleted_at IS NOT NULL AND i.id IN ${ONLY} AND m.id IS NOT NULL AND ${MEANINGFUL('m')} AND ${live}`, 'NULL', '?2'),
    `UPDATE study_sessions SET space_id = NULL, course_id = NULL, item_id = ${TO('study_sessions.item_id')}, updated_at = ?5, revision = revision + 1
      WHERE user_id = ?1 AND space_id = ?2 AND deleted_at IS NULL AND item_id IN ${ONLY} AND ${live}`,
    `UPDATE achievements SET space_id = NULL, item_id = ${TO('achievements.item_id')}, updated_at = ?5, revision = revision + 1
      WHERE user_id = ?1 AND space_id = ?2 AND rule = 'grade' AND deleted_at IS NULL AND item_id IN ${ONLY} AND ${live}`,
    `UPDATE marks SET deleted_at = ?5, updated_at = ?5, revision = revision + 1
      WHERE user_id = ?1 AND space_id = ?2 AND deleted_at IS NULL AND item_id IN ${ONLY} AND ${live}`,
  ].map((sql) => prepare(db, sql, v)));
}

/** POST …/items/:id/keep: a removed item of the class you hold something on. 404 otherwise. */
export async function keep(db, userId, spaceId, itemId, now = Date.now()) {
  const me = await assertAllowed(db, userId, spaceId, 'read');
  if (me.kind !== 'class') throw new HttpError(404, { error: 'not_found' });
  const found = await db.prepare(`SELECT 1 AS x FROM items AS i JOIN marks AS m ON m.user_id = ? AND m.space_id = ? AND m.item_id = i.id AND m.deleted_at IS NULL
    WHERE i.scope = ? AND i.id = ? AND i.deleted_at IS NOT NULL AND ${MEANINGFUL('m')}`).bind(userId, spaceId, 'c:' + spaceId, itemId).first();
  if (!found) throw new HttpError(404, { error: 'not_found' });
  await keepItems(db, userId, spaceId, [itemId], now, { member: true });
}

/* The owner or an editor of the unarchived class. */
const EDITOR = `EXISTS (SELECT 1 FROM members AS gm JOIN spaces AS gs ON gs.id = gm.space_id WHERE gm.space_id = ?2 AND gm.user_id = ?1
  AND gm.deleted_at IS NULL AND gs.deleted_at IS NULL AND gs.archived = 0 AND gm.role IN ('owner', 'editor'))`;

/**
 * Share items of yours filed under a class with it (spec §13; absorb {items}): each becomes a
 * class item under the same id, its facts the class's; your status, grade, checklist, notes and
 * completion move into your mark; your sessions and grade achievements on it get the space;
 * your item goes. 400 items for one that is not yours under the class or is a lecture review,
 * 400 type for a custom type, 409 exists for an id the class has live. Answers {shared}.
 */
export async function shareItems(db, userId, spaceId, ids, now = Date.now()) {
  const me = await assertAllowed(db, userId, spaceId, 'editor');
  if (me.kind !== 'class') throw new HttpError(404, { error: 'not_found' });
  const mine = 'u:' + userId, scope = 'c:' + spaceId, J = JSON.stringify(ids);
  const [own, taken] = await db.batch([
    db.prepare('SELECT id, type FROM items WHERE scope = ? AND class_id = ? AND deleted_at IS NULL AND id IN (SELECT value FROM json_each(?))').bind(mine, spaceId, J),
    db.prepare('SELECT id FROM items WHERE scope = ? AND deleted_at IS NULL AND id IN (SELECT value FROM json_each(?))').bind(scope, J),
  ]);
  if (own.results.length !== ids.length || own.results.some((r) => r.type === 'task' && REVIEW_ID.test(r.id))) throw new HttpError(400, { error: 'invalid', field: 'items' });
  if (own.results.some((r) => r.type.startsWith('c-'))) throw new HttpError(400, { error: 'invalid', field: 'type' });
  if (taken.results.length) throw new HttpError(409, { error: 'exists' });
  const v = [userId, spaceId, mine, scope, now, J];
  const OWN = 'p.scope = ?3 AND p.class_id = ?2 AND p.deleted_at IS NULL AND p.id IN (SELECT value FROM json_each(?6))';
  const COURSE = '(SELECT id FROM courses WHERE scope = ?4 AND deleted_at IS NULL LIMIT 1)';
  const results = await db.batch([
    `INSERT INTO items (scope, id, type, title, course_id, date, start, end, location, status, weight, notes, links, recur, weekday, recur_until, dept,
        updated_by, created_at, updated_at, revision)
      SELECT ?4, p.id, p.type, p.title, ${COURSE}, p.date, p.start, p.end, p.location, 'todo', p.weight, '', p.links, p.recur, p.weekday, p.recur_until, p.dept,
        ?1, ?5, ?5, ${NEXT_ROW_REVISION}
      FROM items AS p WHERE ${OWN} AND ${EDITOR}
      ON CONFLICT (scope, id) DO UPDATE SET type = excluded.type, title = excluded.title, course_id = excluded.course_id, date = excluded.date,
        start = excluded.start, end = excluded.end, location = excluded.location, weight = excluded.weight, links = excluded.links,
        recur = excluded.recur, weekday = excluded.weekday, recur_until = excluded.recur_until, dept = excluded.dept,
        updated_by = excluded.updated_by, updated_at = excluded.updated_at, deleted_at = NULL, revision = items.revision + 1
        WHERE items.deleted_at IS NOT NULL`,
    `INSERT INTO marks (user_id, id, space_id, item_id, status, grade, weight, notes, checklist, completed_at, hidden, created_at, updated_at, revision)
      SELECT ?1, ?2 || ':' || p.id, ?2, p.id, p.status, p.grade, NULL, p.notes, p.checklist, p.completed_at, 0, ?5, ?5, ${NEXT_ROW_REVISION}
      FROM items AS p WHERE ${OWN} AND ${EDITOR}
        AND (p.status != 'todo' OR p.grade IS NOT NULL OR p.notes != '' OR p.checklist != '[]' OR p.completed_at IS NOT NULL)
      ON CONFLICT (user_id, id) DO UPDATE SET status = excluded.status, grade = excluded.grade, weight = NULL, notes = excluded.notes,
        checklist = excluded.checklist, completed_at = excluded.completed_at, hidden = 0, deleted_at = NULL,
        updated_at = excluded.updated_at, revision = marks.revision + 1`,
    `UPDATE study_sessions SET space_id = ?2, course_id = ${COURSE}, updated_at = ?5, revision = revision + 1
      WHERE user_id = ?1 AND space_id IS NULL AND deleted_at IS NULL AND item_id IN (SELECT p.id FROM items AS p WHERE ${OWN}) AND ${EDITOR}`,
    `UPDATE achievements SET space_id = ?2, updated_at = ?5, revision = revision + 1
      WHERE user_id = ?1 AND space_id IS NULL AND rule = 'grade' AND deleted_at IS NULL AND item_id IN (SELECT p.id FROM items AS p WHERE ${OWN}) AND ${EDITOR}`,
    `UPDATE items SET deleted_at = ?5, updated_at = ?5, revision = revision + 1
      WHERE scope = ?3 AND class_id = ?2 AND deleted_at IS NULL AND id IN (SELECT value FROM json_each(?6)) AND ${EDITOR}`,
    'SELECT changes() AS n',
  ].map((sql) => prepare(db, sql, v)));
  return { shared: results[5].results[0].n };
}
```

`prepare` with `'SELECT changes() AS n'` binds nothing (no `?n`), as wanted.

- [ ] **Step 4: Add the routes (`worker/classes.js`)**

Import `keep, shareItems`. Add the keep route:

```js
  ['POST', route(`spaces/${SID}/items/([^/]{1,24})/keep`), async ({ request, env, params: [sid, itemId] }) => {
    await keep(env.DB, await requireUser(request, env), sid, idOf(decodeURIComponent(itemId), 'id'));
    return done();
  }],
```

Replace the absorb route's handler so `{items}` shares and `{courseId, pairs}` merges as before:

```js
  ['POST', route(`spaces/${SID}/absorb`), async ({ request, env, params: [sid] }) => {
    const userId = await requireUser(request, env);
    const body = await readJson(request);
    if (body.items !== undefined) return json(await shareItems(env.DB, userId, sid, shareBody(body)));
    return json(await absorb(env.DB, userId, sid, absorbBody(body)));
  }],
```

and below `absorbBody`:

```js
/** POST /api/spaces/:sid/absorb {items}: share items of yours filed under the class (1 to 50 ids, each once). */
export function shareBody(body) {
  const items = body.items;
  if (!Array.isArray(items) || items.length < 1 || items.length > 50) throw bad('items');
  const out = items.map((id) => idOf(id, 'items'));
  if (new Set(out).size !== out.length) throw bad('items');
  return out;
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run test/keep.test.js test/absorb.test.js test/leaving.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add worker/leaving.js worker/classes.js test/keep.test.js
git commit -m "Stage 5: Keep as mine for a removed class item; share one item with the class

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The nightly purge in §13's order

**Files:**
- Modify: `worker/leaving.js` (`autoKeep`), `worker/db.js` (`purgeTombstones`)
- Test: `test/purge.test.js`

- [ ] **Step 1: Write the failing tests** (append to `test/purge.test.js`)

```js
import { createUser } from './helpers.js';
import { makeSpace, mark, sharedItem } from './spaces.js';

const DAY = 24 * 60 * 60 * 1000;
async function runNightly() {
  const ctx = createExecutionContext();
  await worker.scheduled(createScheduledController({ cron: '0 3 * * *' }), env, ctx);
  await waitOnExecutionContext(ctx);
}
const one = (sql, ...binds) => env.DB.prepare(sql).bind(...binds).first();

describe('nightly purge of shared rows (spec §13)', () => {
  it('keeps a removed item for whoever holds something on it before purging it; drops bare marks', async () => {
    const owner = await createUser('pgo1'), member = await createUser('pgm1'), other = await createUser('pgx1');
    const s = await makeSpace({ members: { [owner]: 'owner', [member]: 'member', [other]: 'member' } });
    const old = Date.now() - 31 * DAY;
    await sharedItem(s.scope, 'a1', { course_id: 'web', title: 'Lab 3', deleted_at: old });
    await mark(member, s.id, 'a1', { grade: 81 });
    await mark(other, s.id, 'a1', { hidden: 1 });
    await runNightly();
    expect(await one("SELECT class_id, grade FROM items WHERE scope = 'u:' || ? AND id = 'a1'", member)).toEqual({ class_id: s.id, grade: 81 });
    expect(await one('SELECT count(*) AS n FROM marks WHERE item_id = ? AND space_id = ?', 'a1', s.id)).toEqual({ n: 1 });   // the kept one's tombstone
    expect(await one('SELECT count(*) AS n FROM items WHERE scope = ? AND id = ?', s.scope, 'a1')).toEqual({ n: 0 });
  });

  it('removes a space deleted over 30 days ago with everything in it; a newer one stays', async () => {
    const owner = await createUser('pgo2');
    const gone = await makeSpace({ members: { [owner]: 'owner' } }), fresh = await makeSpace({ members: { [owner]: 'owner' } });
    await sharedItem(gone.scope, 'x', { course_id: 'web' });
    await env.DB.batch([
      env.DB.prepare('UPDATE spaces SET deleted_at = ? WHERE id = ?').bind(Date.now() - 31 * DAY, gone.id),
      env.DB.prepare('UPDATE spaces SET deleted_at = ? WHERE id = ?').bind(Date.now() - 2 * DAY, fresh.id),
    ]);
    await runNightly();
    expect(await one('SELECT count(*) AS n FROM spaces WHERE id = ?', gone.id)).toEqual({ n: 0 });
    for (const t of ['items', 'courses', 'changes']) expect(await one(`SELECT count(*) AS n FROM ${t} WHERE scope = ?`, gone.scope)).toEqual({ n: 0 });
    expect(await one('SELECT count(*) AS n FROM members WHERE space_id = ?', gone.id)).toEqual({ n: 0 });
    expect(await one('SELECT count(*) AS n FROM spaces WHERE id = ?', fresh.id)).toEqual({ n: 1 });
  });

  it('deletes invites 90 days after they were made, and old membership tombstones', async () => {
    const owner = await createUser('pgo3'), guest = await createUser('pgg3'), left = await createUser('pgl3');
    const s = await makeSpace({ members: { [owner]: 'owner', [left]: 'member' } });
    await env.DB.batch([
      env.DB.prepare("INSERT INTO invites (space_id, user_id, role, created_at, expires_at) VALUES (?, ?, 'member', ?, ?)").bind(s.id, guest, Date.now() - 91 * DAY, Date.now() - 84 * DAY),
      env.DB.prepare('UPDATE members SET deleted_at = ? WHERE space_id = ? AND user_id = ?').bind(Date.now() - 31 * DAY, s.id, left),
    ]);
    await runNightly();
    expect(await one('SELECT count(*) AS n FROM invites WHERE space_id = ?', s.id)).toEqual({ n: 0 });
    expect(await one('SELECT count(*) AS n FROM members WHERE space_id = ?', s.id)).toEqual({ n: 1 });
  });
});
```

Merge the new imports into the file's existing import lines.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run test/purge.test.js`
Expected: the three new tests FAIL (no auto-keep, spaces and invites not purged).

- [ ] **Step 3: Add `autoKeep` to `worker/leaving.js`**

```js
/**
 * The purge's first step (spec §13): Keep as mine, for its holder, every mark holding something
 * on a class item whose tombstone is older than `before`; at most 500 a night, the rest the next.
 */
export async function autoKeep(db, before, now = Date.now()) {
  const { results } = await db.prepare(`SELECT m.user_id, m.space_id, m.item_id FROM marks AS m
      JOIN items AS i ON i.scope = 'c:' || m.space_id AND i.id = m.item_id
    WHERE m.deleted_at IS NULL AND i.deleted_at IS NOT NULL AND i.deleted_at < ? AND ${MEANINGFUL('m')}
    ORDER BY m.user_id, m.space_id LIMIT 500`).bind(before).all();
  const groups = new Map();
  for (const r of results) {
    const k = r.user_id + '\n' + r.space_id;
    groups.set(k, [...(groups.get(k) || []), r]);
  }
  for (const rows of groups.values()) await keepItems(db, rows[0].user_id, rows[0].space_id, rows.map((r) => r.item_id), now);
}
```

- [ ] **Step 4: Rewrite `purgeTombstones` in `worker/db.js`**

Add `import { MEANINGFUL, autoKeep } from './leaving.js';`. Replace the function:

```js
const INVITE_DAYS = 90;

/**
 * The nightly purge (spec §13), in order: removed class items holding something of someone's
 * become theirs (Keep as mine); the other marks on expiring shared items go; each space deleted
 * before `before` goes with everything in it; then the floor moves and old tombstones go,
 * items first so course rows go last (a class item still holding a meaningful mark waits); and
 * invites 90 days after they were made.
 */
export async function purgeTombstones(db, before, now = Date.now()) {
  await autoKeep(db, before, now);
  const GONE = '(SELECT id FROM spaces WHERE deleted_at IS NOT NULL AND deleted_at < ?)';
  const tombstones = (table) => db.prepare(`DELETE FROM ${table} WHERE deleted_at IS NOT NULL AND deleted_at < ?`).bind(before);
  await db.batch([
    db.prepare(`DELETE FROM marks WHERE NOT ${MEANINGFUL('marks')} AND EXISTS (SELECT 1 FROM items AS i
      WHERE i.scope IN ('c:' || marks.space_id, 'p:' || marks.space_id) AND i.id = marks.item_id AND i.deleted_at IS NOT NULL AND i.deleted_at < ?)`).bind(before),
    ...['items', 'courses', 'changes'].map((t) =>
      db.prepare(`DELETE FROM ${t} WHERE scope IN (SELECT 'c:' || id FROM ${GONE} UNION ALL SELECT 'p:' || id FROM ${GONE})`).bind(before, before)),
    ...['members', 'invites', 'marks', 'space_prefs'].map((t) => db.prepare(`DELETE FROM ${t} WHERE space_id IN ${GONE}`).bind(before)),
    tombstones('spaces'),
    db.prepare('UPDATE sync_state SET floor = MAX(floor, COALESCE((SELECT MAX(seq) FROM changes WHERE deleted_at < ?), 0)) WHERE id = 1').bind(before),
    db.prepare('DELETE FROM changes WHERE deleted_at < ?').bind(before),
    ...['marks', 'space_prefs', 'members', 'achievements', 'study_sessions'].map(tombstones),
    db.prepare(`DELETE FROM items WHERE deleted_at IS NOT NULL AND deleted_at < ? AND (scope GLOB 'u:*' OR NOT EXISTS (SELECT 1 FROM marks AS m
      WHERE m.space_id = substr(items.scope, 3) AND m.item_id = items.id AND m.deleted_at IS NULL AND ${MEANINGFUL('m')}))`).bind(before),
    tombstones('quotes'),
    tombstones('courses'),
    db.prepare('DELETE FROM invites WHERE created_at < ?').bind(now - INVITE_DAYS * 24 * 60 * 60 * 1000),
  ]);
}
```

Check the circular import is harmless: `worker/leaving.js` imports `worker/spaces.js`, which does not import `worker/db.js` (`grep -n "from './db.js'" worker/spaces.js worker/leaving.js` must print nothing).

- [ ] **Step 5: Run the tests**

Run: `npx vitest run test/purge.test.js test/database-health.test.js test/sync-v3.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add worker/leaving.js worker/db.js test/purge.test.js
git commit -m "Stage 5: the nightly purge keeps removed items for their holders, then purges spaces, invites and memberships

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Deleting an account hands its classes on

**Files:**
- Modify: `worker/leaving.js` (`handOnStmts`), `worker/admin.js` (account `DELETE`), `src/components/admin/use-admin.ts` (message), `worker/accounts.js` (comment only)
- Test: `test/admin.test.js`

- [ ] **Step 1: Rewrite the failing test** (`test/admin.test.js`, the case "will not delete an account that owns a shared class…")

```js
  it('hands a class the account owns to its longest-standing editor, deletes one with nobody else, and drops its memberships', async () => {
    const admin = await signInAdmin('boss-own');
    const id = await createUser('owner9'), ed = await createUser('ed9'), mem = await createUser('mem9');
    await env.DB.batch([
      env.DB.prepare("INSERT INTO spaces (id, kind, created_at, updated_at) VALUES ('ownsclass001', 'class', 1, 1), ('ownsclass002', 'class', 1, 1)"),
      env.DB.prepare(`INSERT INTO members (space_id, user_id, role, joined_at, updated_at) VALUES
        ('ownsclass001', ?1, 'owner', 1, 1), ('ownsclass001', ?2, 'member', 2, 2), ('ownsclass001', ?3, 'editor', 3, 3), ('ownsclass002', ?1, 'owner', 1, 1)`).bind(id, mem, ed),
      env.DB.prepare("INSERT INTO request_limits (key, hits, reset_at) VALUES ('invite:' || ?1, 1, 9e15), ('join:' || ?1, 1, 9e15)").bind(id),
    ]);
    const before = (await env.DB.prepare("SELECT revision FROM spaces WHERE id = 'ownsclass001'").first()).revision;
    expect((await admin('/api/admin/accounts/u-owner9', { method: 'DELETE', body: { confirm: 'owner9' } })).status).toBe(204);
    const { results } = await env.DB.prepare("SELECT user_id, role FROM members WHERE space_id = 'ownsclass001' ORDER BY user_id").all();
    expect(results).toEqual([{ user_id: ed, role: 'owner' }, { user_id: mem, role: 'member' }]);
    expect((await env.DB.prepare("SELECT revision FROM spaces WHERE id = 'ownsclass001'").first()).revision).toBeGreaterThan(before);
    expect(await env.DB.prepare("SELECT deleted_at IS NOT NULL AS gone FROM spaces WHERE id = 'ownsclass002'").first()).toEqual({ gone: 1 });
    expect(await env.DB.prepare('SELECT count(*) AS n FROM members WHERE user_id = ?').bind(id).first()).toEqual({ n: 0 });
    expect(await env.DB.prepare("SELECT count(*) AS n FROM request_limits WHERE key IN ('invite:' || ?1, 'join:' || ?1)").bind(id).first()).toEqual({ n: 0 });
  });
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run test/admin.test.js`
Expected: FAIL: `409` (`owns_space`).

- [ ] **Step 3: Add `handOnStmts` to `worker/leaving.js`**

```js
/**
 * Before an account is deleted (spec §13): each space it owns passes to its longest-standing
 * editor, else its longest-standing member (demoted before promoted, for the one-owner index);
 * one with nobody else in it is soft-deleted with its invites. Every space it is in moves its
 * revision on, so the others' member lists refresh. Its memberships, invites, marks and prefs
 * go with the user row (ON DELETE CASCADE).
 */
export async function handOnStmts(db, userId, now = Date.now()) {
  const { results } = await db.prepare(`SELECT s.id, (SELECT o.user_id FROM members AS o WHERE o.space_id = s.id AND o.user_id != ?1 AND o.deleted_at IS NULL
        ORDER BY o.role = 'member', o.joined_at, o.user_id LIMIT 1) AS heir
      FROM members AS m JOIN spaces AS s ON s.id = m.space_id
      WHERE m.user_id = ?1 AND m.role = 'owner' AND m.deleted_at IS NULL AND s.deleted_at IS NULL`).bind(userId).all();
  const stmts = [db.prepare(`UPDATE spaces SET revision = ${NEXT_SPACE_REVISION}, updated_at = ?2
    WHERE deleted_at IS NULL AND id IN (SELECT space_id FROM members WHERE user_id = ?1 AND deleted_at IS NULL)`).bind(userId, now)];
  for (const { id, heir } of results) {
    if (heir) {
      stmts.push(
        db.prepare("UPDATE members SET role = 'editor', updated_at = ?, revision = revision + 1 WHERE space_id = ? AND user_id = ? AND role = 'owner'").bind(now, id, userId),
        db.prepare("UPDATE members SET role = 'owner', updated_at = ?, revision = revision + 1 WHERE space_id = ? AND user_id = ? AND deleted_at IS NULL").bind(now, id, heir),
      );
    } else {
      stmts.push(
        db.prepare('UPDATE spaces SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL').bind(now, now, id),
        db.prepare('DELETE FROM invites WHERE space_id = ?').bind(id),
      );
    }
  }
  return stmts;
}
```

- [ ] **Step 4: Use it in `worker/admin.js`**

Import `handOnStmts` from `./leaving.js`. Replace the comment, the `owns` read and the `409` with:

```js
    const handOn = await handOnStmts(db, id);
    await db.batch([
      ...handOn,
      ...ACCOUNT_TABLES.map(([table, owner]) => db.prepare(`DELETE FROM ${table} WHERE ${owner}`).bind(id)),
```

(the rest of the batch unchanged).

- [ ] **Step 5: Drop the message (`src/components/admin/use-admin.ts`)**

Delete the line `owns_space: "This account owns a shared class. Make someone else its owner first.",`. If the account-delete confirm text in `src/components/admin/` mentions classes (`grep -rn "class" src/components/admin/*.tsx | grep -i delet`), add: "Shared classes they own pass to another member, or are deleted when nobody else is in them."

- [ ] **Step 6: `worker/accounts.js` comment**

Add a sentence to its header: "Memberships, invites, marks and space prefs go by ON DELETE CASCADE; worker/leaving.js handOnStmts passes owned spaces on first."

- [ ] **Step 7: Run the tests**

Run: `npx vitest run test/admin.test.js && npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add worker/leaving.js worker/admin.js worker/accounts.js src/components/admin/use-admin.ts test/admin.test.js
git commit -m "Stage 5: deleting an account hands its classes on, or deletes those with nobody else

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The client store keeps removed items and drops a lost class's layer

**Files:**
- Modify: `src/core/types.ts` (`SharedItem`), `src/core/store.ts`
- Test: `test/local-store.node.mjs`

- [ ] **Step 1: Write the failing tests** (append to `test/local-store.node.mjs`)

```js
test('a removed class item stays as a tombstone, apart from the live ones, and a restore revives it', async () => {
 await first.open(p());
 await first.applyPage({ cursors: {}, changes: [{ scope: WEB, kind: 'items', row: { id: 'x', title: 'Lab 3', revision: 4 } }] });
 await first.applyPage({ cursors: {}, changes: [{ scope: WEB, kind: 'items', row: { id: 'x', title: 'Lab 3', revision: 5, deletedAt: 77, updatedBy: 'u-alex' } }] });
 assert.deepEqual(first.data.shared_items, []);
 assert.deepEqual(first.data.removed_items.map((r) => [r.id, r.deletedAt, r.updatedBy]), [['x', 77, 'u-alex']]);
 await first.restoreShared(WEB, 'x');
 assert.deepEqual(first.data.shared_items.map((r) => [r.id, r.deletedAt]), [['x', null]]);
 assert.deepEqual(first.data.removed_items, []);
 const [op] = await first.pending();
 assert.equal(op.key, `shared_items:${WEB}:x`); assert.equal(op.base.deletedAt, 77); assert.equal(op.revision, 5);
});

test('losing a class drops your layer there and carries a waiting mark edit onto your copy', async () => {
 const user = p(); await first.open(user);
 const own = `u:${user.id}`, sid = 'abcdefghij12';
 await first.applyPage({ cursors: { [own]: 3 }, changes: [
  { scope: own, kind: 'marks', row: { id: sid + ':a1', spaceId: sid, itemId: 'a1', notes: 'old', grade: 70, revision: 2 } },
  { scope: own, kind: 'marks', row: { id: sid + ':q1', spaceId: sid, itemId: 'q1', hidden: true, revision: 2 } },
  { scope: own, kind: 'space_prefs', row: { id: sid, spaceId: sid, color: '#4F74D9', revision: 2 } },
 ] });
 await first.saveMark({ ...first.data.marks.find((m) => m.itemId === 'a1'), notes: 'new', grade: 91 });
 /* the copy arrives in your own scope on the same sync, then the class is revoked */
 await first.applyPage({ cursors: { [own]: 9 }, changes: [
  { scope: own, kind: 'items', row: { id: 'a1', title: 'Lab', courseId: 'web', notes: 'old\n\nClass notes:\nBring a laptop', grade: 70, revision: 1 } },
 ] });
 await first.applyRevoked([WEB]);
 assert.equal(first.item('a1').notes, 'new\n\nClass notes:\nBring a laptop');
 assert.equal(first.item('a1').grade, 91);
 assert.deepEqual((await first.pending()).map((o) => o.key), ['items:a1']);
 assert.deepEqual([first.data.marks, first.data.space_prefs], [[], []]);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm run test:local`
Expected: the two new tests FAIL (`removed_items` undefined; marks kept).

- [ ] **Step 3: `src/core/types.ts`**

```ts
export type SharedItem = Item & { scope: string; updatedBy: string | null; assignees: string[]; completedBy: string | null; deletedAt?: number | null }
```

- [ ] **Step 4: `src/core/store.ts`**

(a) `data` gains `removed_items: SharedItem[];` after `shared_items` in the type, with a comment, and `removed_items: []` in the initial value:

```ts
  /* class items an editor deleted, kept as tombstones until you choose (spec §13 Keep as mine / Dismiss) */
  removed_items: SharedItem[];
```

(b) `normalShared.shared_items` keeps the tombstone time:

```ts
  shared_items: (r: Row): SharedItem => ({
    ...normalizeItem(r as unknown as RawItem), scope: r.scope as string, updatedBy: (r.updatedBy as string | null) ?? null,
    assignees: Array.isArray(r.assignees) ? r.assignees as string[] : [], completedBy: (r.completedBy as string | null) ?? null,
    deletedAt: typeof r.deletedAt === 'number' ? r.deletedAt : null,
  }),
```

(c) In `reload()`, split the items:

```ts
  const sharedItems = snapshot.shared_items.filter((r) => !hidden.has(sharedKey('shared_items', r.scope, r.id))).map((r) => normalShared.shared_items(r as unknown as Row));
  data.shared_items = sharedItems.filter((r) => !r.deletedAt);
  data.removed_items = sharedItems.filter((r) => !!r.deletedAt);
```

(d) In `close()`: `data.shared_courses = []; data.shared_items = []; data.removed_items = []; data.spaces = [];`

(e) In `applyPage`, the shared branch: a class item's tombstone is kept, a course's still goes:

```ts
      if (row.deletedAt && s === 'shared_courses') await store.del([scope, row.id]);
      else await store.put(normalShared[s]({ ...row, scope }) as SharedItem);
```

and update the function's doc comment: "A class item's tombstone is kept in its store (Stage 5 plan, Decision 6); `reload` lists it apart."

(f) New exports after `removeShared`:

```ts
/** Bring a removed class item back for everyone (owner and editors, spec §13): the whole row at its tombstone's revision, which the Worker revives. */
export function restoreShared(scope: string, id: string): Promise<void> {
  return mutate(async (a) => {
    const before = await a('shared_items').get([scope, id]);
    if (!before?.deletedAt) return;
    const row = { ...before, deletedAt: null };
    await a('shared_items').put(row);
    await queue(a, sharedKey('shared_items', scope, id), 'put', row as unknown as Row, before as unknown as Row);
  });
}
/** Dismiss (spec §13): your mark on a removed class item goes. */
export const deleteMark = (id: string) => deleteRow('marks', id);
```

(g) `applyRevoked` drops your layer there and carries a waiting mark edit onto your copy. Add above it:

```ts
/* A mark edit not yet uploaded, carried onto the copy of its item you were given (spec §6
   Revocation): each field changed since the edit began; your notes replace your part of the
   copy's notes, which a detach wrote as yours, a blank line, then the class's. */
function carryMark(copy: Item, mark: Mark, base: Record<string, unknown>): Item {
  const out = { ...copy };
  const moved = (f: keyof Mark) => stable(mark[f]) !== stable(base[f] ?? MARK_DEFAULTS[f]);
  if (moved('status')) out.status = mark.status;
  if (moved('grade')) out.grade = mark.grade;
  if (moved('checklist')) out.checklist = mark.checklist;
  if (moved('completedAt')) out.completedAt = mark.completedAt;
  if (moved('weight') && mark.weight != null) out.weight = mark.weight;
  const was = typeof base.notes === 'string' ? base.notes : '';
  if (moved('notes')) out.notes = (copy.notes.startsWith(was) ? mark.notes + copy.notes.slice(was.length) : mark.notes).slice(0, 5000);
  return out;
}
```

(import `stable` and `MARK_DEFAULTS` from `./shared.ts` if not already imported; `Item` and `Mark` from `./types.ts`). Then in `applyRevoked`, after the cursor lines and before `return true`:

```ts
    const lost = new Set(scopes.map((s) => s.slice(2)));
    for (const op of await a('pending').all()) {
      if (!op.key.startsWith('marks:') || op.op !== 'put' || !op.body) continue;
      const mark = op.body as unknown as Mark;
      if (!lost.has(mark.spaceId)) continue;
      const copy = (await a('items').get(mark.itemId)) ?? (await a('items').get('k' + mark.itemId.slice(0, 23)));
      if (!copy || copy.classId) continue;
      const moved = carryMark(copy, mark, (op.base ?? {}) as Record<string, unknown>);
      await a('items').put(moved);
      await queue(a, `items:${moved.id}`, 'put', moved as unknown as Row);
      await a('pending').del(op.key);
      await a('marks').del(mark.id);
    }
    for (const m of await a('marks').all()) if (lost.has(m.spaceId) && !(await a('pending').get(`marks:${m.id}`))) await a('marks').del(m.id);
    for (const p of await a('space_prefs').all()) if (lost.has(p.spaceId) && !(await a('pending').get(`space_prefs:${p.id}`))) await a('space_prefs').del(p.id);
```

Update its doc comment: "…their shared rows (removed ones too), their space, their cursor, and your marks and prefs there. A mark edit still waiting is carried onto your copy of the item when one came; any other pending edit stays queued and, refused with 404, moves to the saved copies."

- [ ] **Step 5: Run the tests**

Run: `npm run test:local && npm run typecheck`
Expected: PASS. If `typecheck` finds code reading `data.shared_items` that should also see removed items, leave it: views get removed items through `effectiveItems()` (Task 9).

- [ ] **Step 6: Commit**

```bash
git add src/core/types.ts src/core/store.ts test/local-store.node.mjs
git commit -m "Stage 5: keep removed class items on the device; drop a lost class's layer, carrying waiting mark edits onto the copy

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Sync holds a mark's 404 until the pull; API calls

**Files:**
- Modify: `src/core/sync.ts`, `src/core/api.ts`
- Test: `test/sync.test.js`, `test/api-client.test.js`

- [ ] **Step 1: Read how `test/sync.test.js` fakes the API and store** (`sed -n 1,80p test/sync.test.js`), then write the failing test in its style. The case, in words, with the fakes that file already has:

1. pending: one op `{ key: 'marks:abcdefghij12:a1', op: 'put', body: {id: 'abcdefghij12:a1', spaceId: 'abcdefghij12', itemId: 'a1', notes: 'new'}, base: {notes: 'old'}, revision: 2, token: 't1' }`;
2. `api.put` for it rejects with `new ApiError(404, { error: 'not_found' })`;
3. the pull answers one complete page with `revoked: ['c:abcdefghij12']`;
4. the fake `store.applyRevoked` removes the op from pending (as carrying does);
5. assert `store.rejectOperation` was **not** called, and `store.applyRevoked` was called with `['c:abcdefghij12']`.

A second case: same, but `applyRevoked` leaves the op pending → assert `store.rejectOperation` was called once with that op and the reason `'This item was removed from the class, or you left it.'`.

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run test/sync.test.js`
Expected: FAIL (`rejectOperation` called during the push).

- [ ] **Step 3: `src/core/sync.ts`**

`Cycle` gains `deferred: PendingOp[]` (initialised `deferred: []` in `syncNow`). In `pushAll`'s `catch`, before the maintenance line:

```ts
      /* your mark refused as not found: you may have lost the class, and the pull that follows
         carries the edit onto your copy (store.applyRevoked); it is settled after the pull */
      if (e instanceof ApiError && e.status === 404 && op.op === 'put' && op.key.startsWith('marks:')) { cycle.deferred.push(op); continue; }
```

Add below `holdBack`:

```ts
/** After a complete pull: a deferred mark edit still waiting (nothing carried it) goes to the saved copies. */
async function settleDeferred(cycle: Cycle): Promise<boolean> {
  if (!cycle.deferred.length) return true;
  const waiting = new Set((await store.pending()).map((op) => op.token));
  for (const op of cycle.deferred) {
    if (!waiting.has(op.token)) continue;
    const current = await serverCopy(op);
    if (!active(cycle)) return false;
    await store.rejectOperation(op, current, 'This item was removed from the class, or you left it.');
  }
  return active(cycle);
}
```

In `syncNow`, after `const complete = await pullAll(cycle); if (!active(cycle)) return false;`:

```ts
        if (complete && !(await settleDeferred(cycle))) return false;
```

(An incomplete pull leaves deferred edits pending; the next cycle tries them again.)

- [ ] **Step 4: `src/core/api.ts`**, in `spaces`:

```ts
    /* Stage 5 (spec §13): leaving, removing, archiving, deleting; Keep as mine; sharing one item */
    leave: (sid: string, keepCopy: boolean) => empty(request('POST', `/api/spaces/${sid}/leave`, { keepCopy })),
    remove: (sid: string, userId: string) => empty(request('DELETE', `/api/spaces/${sid}/members/${encodeURIComponent(userId)}`)),
    archive: (sid: string, archived: boolean) => empty(request('POST', `/api/spaces/${sid}/archive`, { archived })),
    del: (sid: string, keepCopy: boolean) => empty(request('DELETE', `/api/spaces/${sid}`, { keepCopy })),
    keep: (sid: string, itemId: string) => empty(request('POST', `/api/spaces/${sid}/items/${encodeURIComponent(itemId)}/keep`)),
    share: (sid: string, items: string[]): Promise<{ shared: number }> => request('POST', `/api/spaces/${sid}/absorb`, { items }),
```

Add one `test/api-client.test.js` case in its style that `api.spaces.leave('abcdefghij12', false)` sends `POST /api/spaces/abcdefghij12/leave` with body `{"keepCopy":false}` and `api.spaces.keep('abcdefghij12', 'a 1')` posts to `/api/spaces/abcdefghij12/items/a%201/keep`.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run test/sync.test.js test/api-client.test.js && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/sync.ts src/core/api.ts test/sync.test.js test/api-client.test.js
git commit -m "Stage 5: a mark refused as not found waits for the pull; client calls for leaving and keeping

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Removed items in the views; the leaving actions (`src/data`)

**Files:**
- Modify: `src/data/effective.ts`, `src/data/store.ts`, `src/data/classes.ts`, `src/data/refs.ts`, `src/data/study.ts`, `src/components/study/history.tsx`
- Create: `src/data/leave.ts`
- Test: `src/data/removed.test.ts`

- [ ] **Step 1: Write the failing test**

`src/data/removed.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest"

const fake = vi.hoisted(() => ({
    data: { profile: { id: "u-me", isAdmin: true }, items: [], courses: [], shared_items: [], removed_items: [] as unknown[], shared_courses: [], marks: [] as unknown[], space_prefs: [], spaces: [] as unknown[] },
    api: { spaces: { leave: vi.fn(async () => undefined), keep: vi.fn(async () => undefined), share: vi.fn(async () => ({ shared: 1 })) } },
    store: { deleteMark: vi.fn(async () => undefined), restoreShared: vi.fn(async () => undefined) },
    syncNow: vi.fn(async () => true),
    closeSheet: vi.fn(), toast: vi.fn(),
}))
vi.mock("@/core/store", () => ({ data: fake.data, subscribe: () => () => {}, ...fake.store }))
vi.mock("@/core/api", () => ({ api: fake.api, ApiError: class extends Error {} }))
vi.mock("@/core/sync", () => ({ syncNow: fake.syncNow }))
vi.mock("@/data/overlay", () => ({ closeSheet: fake.closeSheet, openSheet: vi.fn() }))
vi.mock("@/data/toast", () => ({ toast: fake.toast }))
vi.mock("@/data/query", () => ({ schoolCal: () => null }))

import { normalizeItem } from "@/core/model"
import { meaningful, mergeItems } from "./effective"
import { canShareItem, dismissItem, keepItem, leaveClass, removedLine, restoreItem } from "./leave"
import { leftClass } from "./refs"
import type { Mark } from "./types"

const SID = "abcdefghij12", WEB = "c:" + SID
const row = { ...normalizeItem({ id: "a1", type: "lab", title: "Lab 3", date: "2026-10-09", courseId: "web" }), scope: WEB, updatedBy: "u-alex", assignees: [], completedBy: null, deletedAt: 1000 }
const mark = (over: Partial<Mark> = {}) => ({ id: SID + ":a1", spaceId: SID, itemId: "a1", status: "todo", grade: null, weight: null, notes: "", checklist: [], completedAt: null, hidden: false, ...over }) as Mark
afterEach(() => vi.clearAllMocks())

describe("removed class items", () => {
    it("stay in the views while your mark holds something, marked removed", () => {
        expect(meaningful(mark())).toBe(false)
        expect(meaningful(mark({ grade: 80 }))).toBe(true)
        const out = mergeItems([], [], true, { marks: new Map([[SID + ":a1", mark({ grade: 80 })]]), removed: [row] })
        expect(out.map((it) => [it.key, it.grade, it.removed])).toEqual([[WEB + "/a1", 80, { by: "u-alex", at: 1000 }]])
        expect(mergeItems([], [], true, { marks: new Map([[SID + ":a1", mark({ hidden: true, grade: 80 })]]), removed: [row] })).toEqual([])
        expect(mergeItems([], [], true, { marks: new Map(), removed: [row] })).toEqual([])
    })

    it("say who removed them, and from where", () => {
        const space = { members: [{ userId: "u-alex", name: "Alex", role: "editor" }] }
        expect(removedLine(row, space, "Web Services", "u-me", 1000 + 2 * 3600e3)).toBe("Removed from Web Services by Alex · 2h ago")
        expect(removedLine({ ...row, updatedBy: "u-me" }, space, "Web Services", "u-me", 1000)).toBe("Removed from Web Services by you · just now")
    })

    it("Keep, Dismiss and Restore call the server or the store, then sync", async () => {
        await keepItem(WEB + "/a1")
        expect(fake.api.spaces.keep).toHaveBeenCalledWith(SID, "a1")
        await dismissItem(WEB + "/a1")
        expect(fake.store.deleteMark).toHaveBeenCalledWith(SID + ":a1")
        await restoreItem(WEB + "/a1")
        expect(fake.store.restoreShared).toHaveBeenCalledWith(WEB, "a1")
        expect(fake.syncNow).toHaveBeenCalled()
    })
})

describe("leaving", () => {
    it("syncs first, leaves, closes the sheet and says where the copy is", async () => {
        await leaveClass(SID, true, "Web Services")
        expect(fake.syncNow.mock.invocationCallOrder[0]).toBeLessThan(fake.api.spaces.leave.mock.invocationCallOrder[0])
        expect(fake.api.spaces.leave).toHaveBeenCalledWith(SID, true)
        expect(fake.closeSheet).toHaveBeenCalled()
        expect(fake.toast).toHaveBeenCalledWith("You left Web Services. Your copy is in your courses.")
    })

    it("knows a class you left, and what you may share", () => {
        fake.data.spaces = []
        expect(leftClass(WEB + "/web")).toBe(true)
        expect(leftClass("web")).toBe(false)
        const space = { id: SID, kind: "class" as const, role: "editor" as const, archived: false }
        expect(canShareItem({ id: "x1", type: "lab", classId: SID }, space)).toBe(true)
        expect(canShareItem({ id: "x1", type: "c-essay", classId: SID }, space)).toBe(false)
        expect(canShareItem({ id: "x1", type: "lab", classId: SID }, { ...space, role: "member" })).toBe(false)
        expect(canShareItem({ id: "x1", type: "lab", classId: SID }, { ...space, archived: true })).toBe(false)
    })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/data/removed.test.ts`
Expected: FAIL (`./leave` missing; `meaningful` not exported).

- [ ] **Step 3: `src/data/effective.ts`**

`EffectiveItem` gains `/** a class item an editor removed, kept while your mark holds something (spec §13) */ removed?: { by: string | null; at: number | null }`. `Layer` gains `removed?: (Item & { scope: string; updatedBy?: string | null; deletedAt?: number | null })[]`. Add:

```ts
/** A mark holding anything of yours (spec §13): kept through a removal, copied on leaving. */
export const meaningful = (m: Mark): boolean =>
    m.status !== "todo" || m.grade != null || m.weight != null || m.notes !== "" || m.checklist.length > 0 || m.completedAt != null
```

In `mergeItems`, change the early return to `if (!show || (!shared.length && !filed && !layer.removed?.length)) return own` and after the `for (const it of shared)` loop:

```ts
    for (const it of layer.removed ?? []) {
        const mark = layer.marks?.get(it.scope.slice(2) + ":" + it.id) ?? null
        if (mark && !mark.hidden && meaningful(mark)) theirs.push({ ...withMark(it, mark), removed: { by: it.updatedBy ?? null, at: it.deletedAt ?? null } })
    }
```

In `effectiveItems`, read `removed = data.removed_items ?? NONE`, add `removed` to the memo record and its comparison, and pass `removed` in the layer. Update the file's header comment: "…and a class item an editor removed stays, marked, while your mark on it holds something."

- [ ] **Step 4: `src/data/store.ts`**

```ts
const removedItems = () => data.removed_items ?? NONE
/** Class items an editor removed, as tombstones: their cards and the class sheet's Removed list read them. */
export const useRemovedItems = () => useSyncExternalStore(subscribe, removedItems)
```

- [ ] **Step 5: `src/data/refs.ts`**

```ts
/** A session's or an achievement's class key whose class this device no longer holds: one you left (spec §13). */
export const leftClass = (key: string | null | undefined): boolean =>
    isSharedKey(key) && !(data.spaces ?? []).some((s) => s.scope === splitKey(key).scope)
```

- [ ] **Step 6: Label them**

`src/data/study.ts` (in `todayOf`): replace `course?.name || "No course",` with `course?.name || (leftClass(s.courseId) ? "A class you left" : "No course"),` and import `leftClass` from `./refs`.

`src/components/study/history.tsx`: line 27 becomes

```tsx
const courseCode = (id: string | null) => (courseOf(id) as Course | null)?.code || (leftClass(id) ? "A class you left" : "No course")
```

and line 247's `|| "No course"` becomes `|| (leftClass(s.courseId) ? "A class you left" : "No course")`; import `leftClass` from `@/data/refs`.

- [ ] **Step 7: `src/data/classes.ts` `messageFor`** gains, before the `rate_limited` line:

```ts
    if (code === "owner") return "Hand the class on to someone first: the owner can't leave."
    if (code === "members") return "Only a class with nobody else in it can be deleted. Remove the others or hand it on."
    if (code === "exists") return "The class already has an item with this id."
    if (code === "archived") return "This class is archived. Unarchive it first."
```

- [ ] **Step 8: Create `src/data/leave.ts`**

```ts
// Leaving and removal on this device (spec §13, §15): leave a class (with a copy or without),
// remove a member, archive, delete; a removed class item kept as yours, dismissed, or restored
// for everyone; one item of yours shared with its class. Every call but Dismiss and Restore
// needs a connection; what changed arrives by sync like everything else.

import { api } from "@/core/api"
import * as store from "@/core/store"
import { syncNow } from "@/core/sync"
import { REVIEW_ID } from "@/core/shared"
import { closeSheet } from "./overlay"
import { toast } from "./toast"
import { ago } from "./marks"
import { splitKey } from "./refs"
import type { Item, SharedItem, Space } from "./types"

/** Leave a class: your edits upload first, so the copy holds them. */
export async function leaveClass(spaceId: string, keepCopy: boolean, name: string): Promise<void> {
    await syncNow()
    await api.spaces.leave(spaceId, keepCopy)
    closeSheet()
    toast(keepCopy ? `You left ${name}. Your copy is in your courses.` : `You left ${name}.`)
    await syncNow()
}

/** The owner removes someone; they keep a copy of the class. */
export async function removeMember(spaceId: string, userId: string): Promise<void> {
    await api.spaces.remove(spaceId, userId)
    await syncNow()
}

export async function setArchived(spaceId: string, archived: boolean): Promise<void> {
    await api.spaces.archive(spaceId, archived)
    await syncNow()
}

/** Delete a class only you are in; a copy by default. */
export async function deleteClass(spaceId: string, keepCopy: boolean, name: string): Promise<void> {
    await syncNow()
    await api.spaces.del(spaceId, keepCopy)
    closeSheet()
    toast(keepCopy ? `${name} is deleted. Your copy is in your courses.` : `${name} is deleted.`)
    await syncNow()
}

/** Keep as mine: a removed item becomes yours, filed under the class. */
export async function keepItem(key: string): Promise<void> {
    const k = splitKey(key)
    await api.spaces.keep(k.spaceId!, k.id)
    closeSheet()
    await syncNow()
}

/** Dismiss: your mark on a removed item goes; the item leaves your views. */
export async function dismissItem(key: string): Promise<void> {
    const k = splitKey(key)
    await store.deleteMark(k.spaceId + ":" + k.id)
    closeSheet()
}

/** Restore for everyone (owner, editors). */
export async function restoreItem(key: string): Promise<void> {
    const k = splitKey(key)
    await store.restoreShared(k.scope!, k.id)
    void syncNow()
}

/** Whether an item of yours filed under a class can become the class's: you edit it, it isn't archived, the type is built in, it isn't a lecture review. */
export function canShareItem(it: Pick<Item, "id" | "type" | "classId">, space: Pick<Space, "id" | "kind" | "role" | "archived"> | null): boolean {
    return !!space && it.classId === space.id && space.kind === "class" && space.role !== "member" && !space.archived
        && !it.type.startsWith("c-") && !(it.type === "task" && REVIEW_ID.test(it.id))
}

/** Share an item of yours with its class: your edits upload first. */
export async function shareItem(itemId: string, spaceId: string, name: string): Promise<void> {
    await syncNow()
    await api.spaces.share(spaceId, [itemId])
    closeSheet()
    toast(`Shared with ${name}. Your status, grade and notes stay yours.`)
    await syncNow()
}

/** "Removed from Web Services by Alex · 2h ago": "you" for your own, "a former member" for an account gone. */
export function removedLine(row: Pick<SharedItem, "updatedBy" | "deletedAt">, space: Pick<Space, "members"> | null, course: string, me: string | undefined, now = Date.now()): string {
    const who = row.updatedBy === me ? "you" : space?.members.find((m) => m.userId === row.updatedBy)?.name ?? "a former member"
    const when = ago(row.deletedAt, now)
    return `Removed from ${course} by ${who}` + (when ? " · " + when : "")
}
```

If `src/data/marks.ts` importing nothing from `./leave` is true (it is), there is no import cycle.

- [ ] **Step 9: Run the tests**

Run: `npx vitest run src/data/removed.test.ts src/data/effective.test.ts src/data/study.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/data src/components/study/history.tsx
git commit -m "Stage 5: removed class items stay in your views while they hold something of yours; leaving actions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: The class sheet: archived banner, Leave, Archive, Delete; Removed list; Remove in Members

**Files:**
- Create: `src/components/sheet/class-actions.tsx`, `src/components/sheet/removed.tsx` (`RemovedList` here; `RemovedCard` in Task 11)
- Modify: `src/components/sheet/class-sheet.tsx`, `src/components/sheet/members-tab.tsx`
- Test: `src/components/sheet/leaving.test.tsx`

- [ ] **Step 1: Write the failing test**

`src/components/sheet/leaving.test.tsx` uses the same fakes as `classes.test.tsx` (copy its `vi.hoisted` block and mocks), with these additions:

- `fake.data` also has `removed_items: [] as unknown[]`;
- `fake.api.spaces` also has `leave, remove, archive, del, keep, share` (`vi.fn(async () => undefined)`);
- the `@/core/store` mock also returns `deleteMark: vi.fn(async () => undefined), restoreShared: vi.fn(async () => undefined)` (put them on `fake.store` and spread it).

```tsx
describe("leaving a class", () => {
    beforeEach(() => { fake.data.shared_courses = [course]; fake.data.space_prefs = [pref] })

    it("a member leaves, keeping a copy unless they untick it", async () => {
        fake.data.spaces = [space("member")]
        render(<ClassSheet spaceId={SID} tab="details" />)
        fireEvent.click(screen.getByRole("button", { name: "Leave the class…" }))
        const keep = screen.getByRole("checkbox", { name: /Keep a copy/ })
        expect(keep).toBeChecked()
        fireEvent.click(keep)
        fireEvent.click(screen.getByRole("button", { name: "Leave Web Services" }))
        await waitFor(() => expect(fake.api.spaces.leave).toHaveBeenCalledWith(SID, false))
    })

    it("the owner archives, and is told to hand on before leaving; delete waits until they are alone", async () => {
        fake.data.spaces = [space("owner")]
        render(<ClassSheet spaceId={SID} tab="details" />)
        expect(screen.queryByRole("button", { name: "Leave the class…" })).toBeNull()
        expect(screen.getByText(/Hand the class on in Members to leave it/)).toBeTruthy()
        expect(screen.queryByRole("button", { name: "Delete the class…" })).toBeNull()
        fireEvent.click(screen.getByRole("button", { name: "Archive the class" }))
        await waitFor(() => expect(fake.api.spaces.archive).toHaveBeenCalledWith(SID, true))
    })

    it("an archived class says so, and its owner unarchives it", async () => {
        fake.data.spaces = [{ ...space("owner"), archived: true }]
        render(<ClassSheet spaceId={SID} tab="details" />)
        expect(screen.getByText(/Archived: read-only for everyone/)).toBeTruthy()
        fireEvent.click(screen.getByRole("button", { name: "Unarchive" }))
        await waitFor(() => expect(fake.api.spaces.archive).toHaveBeenCalledWith(SID, false))
    })

    it("the owner alone deletes it, with a copy by default", async () => {
        fake.data.spaces = [{ ...space("owner"), members: [{ userId: "u-me", name: "George", role: "owner" }] }]
        render(<ClassSheet spaceId={SID} tab="details" />)
        fireEvent.click(screen.getByRole("button", { name: "Delete the class…" }))
        fireEvent.click(screen.getByRole("button", { name: "Delete Web Services" }))
        await waitFor(() => expect(fake.api.spaces.del).toHaveBeenCalledWith(SID, true))
    })

    it("lists removed items: Keep and Dismiss for yours, Restore for editors", async () => {
        fake.data.spaces = [space("owner")]
        fake.data.removed_items = [{ scope: SCOPE, id: "a1", type: "lab", title: "Lab 3", courseId: "web", date: "2026-10-09", updatedBy: "u-sam", deletedAt: 5 }]
        fake.data.marks = [{ id: SID + ":a1", spaceId: SID, itemId: "a1", status: "todo", grade: 80, weight: null, notes: "", checklist: [], completedAt: null, hidden: false }]
        render(<ClassSheet spaceId={SID} tab="details" />)
        const list = screen.getByRole("list", { name: "Removed from the class" })
        expect(within(list).getByText(/by Sam/)).toBeTruthy()
        fireEvent.click(within(list).getByRole("button", { name: "Restore Lab 3" }))
        await waitFor(() => expect(fake.store.restoreShared).toHaveBeenCalledWith(SCOPE, "a1"))
        fireEvent.click(within(list).getByRole("button", { name: "Keep Lab 3 as mine" }))
        await waitFor(() => expect(fake.api.spaces.keep).toHaveBeenCalledWith(SID, "a1"))
    })
})

describe("removing a member", () => {
    it("the owner removes someone after a confirm", async () => {
        fake.data.spaces = [space("owner")]
        fake.data.shared_courses = [course]
        fake.api.spaces.get.mockResolvedValue(details("owner"))
        render(<ClassSheet spaceId={SID} tab="members" />)
        fireEvent.click(await screen.findByRole("button", { name: "Remove Sam" }))
        expect(screen.getByText(/They keep a copy of the class/)).toBeTruthy()
        fireEvent.click(screen.getByRole("button", { name: "Remove Sam from the class" }))
        await waitFor(() => expect(fake.api.spaces.remove).toHaveBeenCalledWith(SID, "u-sam"))
    })
})
```

(`space`, `course`, `details`, `pref`, `SID`, `SCOPE` as in `classes.test.tsx`; copy them.)

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/components/sheet/leaving.test.tsx`
Expected: FAIL (no such buttons).

- [ ] **Step 3: Create `src/components/sheet/class-actions.tsx`**

```tsx
// A class's own controls at the foot of its Details (spec §13, §15): the archived banner;
// Leave (anyone but the owner), with Keep a copy on; Archive / Unarchive (the owner); Delete
// (the owner, while nobody else is in it), with Keep a copy on. Each asks once, inline.

import { useId, useState } from "react"
import { deleteClass, leaveClass, setArchived } from "@/data/leave"
import { messageFor } from "@/data/classes"
import type { Space } from "@/data/types"
import { Button, Checkbox, Note, Section } from "./fields"

export function ArchivedBanner({ space }: { space: Space }) {
    const [err, setErr] = useState("")
    if (!space.archived) return null
    return (
        <div role="note" className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--warn-line)] bg-[var(--warn-bg)] px-2.5 py-2 text-[12px] text-[var(--warn-ink)]">
            <span className="min-w-0 flex-1">Archived: read-only for everyone. Your own status, grades and settings still save.</span>
            {space.role === "owner" && <Button variant="ghost" onClick={() => void setArchived(space.id, false).catch((e) => setErr(messageFor(e)))}>Unarchive</Button>}
            {err && <Note tone="bad">{err}</Note>}
        </div>
    )
}

export function ClassActions({ space, name }: { space: Space; name: string }) {
    const f = useId()
    const [asking, setAsking] = useState<"leave" | "delete" | null>(null)
    const [keep, setKeep] = useState(true)
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState("")
    const owner = space.role === "owner", alone = space.members.length <= 1
    const run = async (fn: () => Promise<void>) => {
        setBusy(true)
        try { await fn(); setErr("") } catch (e) { setErr(messageFor(e)) } finally { setBusy(false) }
    }
    const confirm = (what: "leave" | "delete") => (
        <div className="flex flex-col gap-2 rounded-lg bg-muted px-2.5 py-2">
            <Note>{what === "leave"
                ? `You stop seeing ${name}'s changes. With a copy, its course and items become your own, with your grades and notes.`
                : `${name} goes for good. With a copy, its course and items become your own.`}</Note>
            <Checkbox id={f + "keep"} checked={keep} onChange={setKeep}>Keep a copy as my own course</Checkbox>
            <span className="flex flex-wrap gap-2">
                <Button variant="ghost" onClick={() => setAsking(null)}>Cancel</Button>
                <Button variant="danger" disabled={busy} onClick={() => void run(() => (what === "leave" ? leaveClass(space.id, keep, name) : deleteClass(space.id, keep, name)))}>
                    {what === "leave" ? "Leave " + name : "Delete " + name}
                </Button>
            </span>
        </div>
    )
    return (
        <Section title="This class">
            {owner ? <>
                <span className="flex flex-wrap gap-2">
                    {!space.archived && <Button variant="ghost" disabled={busy} onClick={() => void run(() => setArchived(space.id, true))}>Archive the class</Button>}
                    {alone && <Button variant="ghost" onClick={() => { setKeep(true); setAsking("delete") }}>Delete the class…</Button>}
                </span>
                <Note>{alone ? "Archiving makes it read-only for everyone until you unarchive it." : "Hand the class on in Members to leave it. A class can be deleted once nobody else is in it."}</Note>
            </> : (
                <Button variant="ghost" className="self-start" onClick={() => { setKeep(true); setAsking("leave") }}>Leave the class…</Button>
            )}
            {asking && confirm(asking)}
            {err && <Note tone="bad">{err}</Note>}
        </Section>
    )
}
```

`Checkbox` takes `{id, checked, onChange, children}` (`src/components/sheet/fields.tsx:227`); its label must make the accessible name "Keep a copy as my own course" (the test matches `/Keep a copy/`).

- [ ] **Step 4: Create `src/components/sheet/removed.tsx` with `RemovedList`**

```tsx
// Class items an editor removed (spec §13, §15). The list in the class sheet: the ones you hold
// something on (Keep as mine / Dismiss) and, for the owner and editors, every one (Restore).
// The card a removed item opens is RemovedCard, below.

import { useState } from "react"
import { cn } from "@/lib/utils"
import { useMarks, useProfile, useRemovedItems } from "@/data/store"
import { meaningful } from "@/data/effective"
import { markIdOf } from "@/data/marks"
import { dismissItem, keepItem, removedLine, restoreItem } from "@/data/leave"
import { messageFor } from "@/data/classes"
import type { Space } from "@/data/types"
import { Button, Note, Section } from "./fields"

const LIST = "m-0 flex list-none flex-col gap-1 p-0"
const ROW = "flex flex-wrap items-center gap-2 rounded-lg bg-muted px-2.5 py-1.5 text-[12.5px]"

export function RemovedList({ space, course }: { space: Space; course: string }) {
    const me = useProfile()?.id
    const marks = useMarks()
    const editor = space.role !== "member" && !space.archived
    const [err, setErr] = useState("")
    const rows = useRemovedItems().filter((it) => it.scope === space.scope).map((it) => {
        const key = it.scope + "/" + it.id, mark = marks.find((m) => m.id === markIdOf(key)) ?? null
        return { it, key, mark, mine: !!mark && meaningful(mark) }
    }).filter((r) => editor || r.mine)
    if (!rows.length) return null
    const act = (fn: () => Promise<void>) => () => void fn().then(() => setErr(""), (e) => setErr(messageFor(e)))
    return (
        <Section title="Removed from the class" note={String(rows.length)}>
            <ul aria-label="Removed from the class" className={LIST}>
                {rows.map(({ it, key, mark, mine }) => (
                    <li key={key} className={cn(ROW)}>
                        <span className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate">{it.title}</span>
                            <span className="text-[11px] text-muted-foreground">{removedLine(it, space, course, me)}</span>
                        </span>
                        {editor && <Button variant="ghost" aria-label={"Restore " + it.title} onClick={act(() => restoreItem(key))}>Restore</Button>}
                        {mark && <Button variant="ghost" aria-label={"Dismiss " + it.title} onClick={act(() => dismissItem(key))}>Dismiss</Button>}
                        {mine && <Button variant="ghost" aria-label={"Keep " + it.title + " as mine"} onClick={act(() => keepItem(key))}>Keep as mine</Button>}
                    </li>
                ))}
            </ul>
            {err && <Note tone="bad">{err}</Note>}
        </Section>
    )
}
```

- [ ] **Step 5: Put them in `class-sheet.tsx`**

Import `ArchivedBanner, ClassActions` from `./class-actions` and `RemovedList` from `./removed`. In `Details`, first child of the fragment (before the merge banner): `<ArchivedBanner space={space} />`. After the "Hidden from you" section, at the end of the fragment:

```tsx
            <RemovedList space={space} course={course.name} />
            <ClassActions space={space} name={course.name} />
```

Update the file's header comment: "…**Details** … the items removed from it, and the class's own controls (leave, archive, delete)."

- [ ] **Step 6: Remove in `members-tab.tsx`**

Import `removeMember` from `@/data/leave`. In `MemberList`, add state `const [removing, setRemoving] = useState<SpaceMember | null>(null)` and, in each row after the role control:

```tsx
                        {owner && m.role !== "owner" && m.userId !== me && (
                            <Button variant="ghost" aria-label={"Remove " + m.name} onClick={() => setRemoving(m)}>Remove</Button>
                        )}
```

After the list:

```tsx
            {removing && (
                <div className="flex flex-wrap items-center gap-2">
                    <Note>Remove {removing.name}? They keep a copy of the class as their own course.</Note>
                    <Button variant="ghost" onClick={() => setRemoving(null)}>Cancel</Button>
                    <Button variant="danger" onClick={() => void (async () => {
                        try { await removeMember(spaceId, removing.userId); setRemoving(null); setErr(""); await reload() } catch (e) { setErr(messageFor(e)) }
                    })()}>Remove {removing.name} from the class</Button>
                </div>
            )}
```

Rewrite the header comment's last sentences: "Only the owner gives another role, makes a code, changes roles, removes someone (who keeps a copy) and hands the class on; those work while the class is archived, inviting does not."

- [ ] **Step 7: Run the tests**

Run: `npx vitest run src/components/sheet/leaving.test.tsx src/components/sheet/classes.test.tsx src/components/sheet/layer.test.tsx && npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/components/sheet/class-actions.tsx src/components/sheet/removed.tsx src/components/sheet/class-sheet.tsx src/components/sheet/members-tab.tsx src/components/sheet/leaving.test.tsx
git commit -m "Stage 5: leave, archive and delete in the class sheet; removed items listed; remove a member

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: The removed item's card; Share with the class

**Files:**
- Modify: `src/components/sheet/removed.tsx` (`RemovedCard`), `src/components/sheet/class-item-sheet.tsx`, `src/components/sheet/item-sheet.tsx`
- Create: `src/components/sheet/share-item.tsx`
- Test: `src/components/sheet/leaving.test.tsx`

- [ ] **Step 1: Write the failing tests** (append to `leaving.test.tsx`; import `ClassItemSheet` from `./class-item-sheet` and `ShareItem` from `./share-item`)

```tsx
describe("a removed item's card", () => {
    const removed = { scope: SCOPE, id: "a1", type: "lab", title: "Lab 3", courseId: "web", date: "2026-10-09", updatedBy: "u-sam", deletedAt: Date.now() - 3600e3 }
    const graded = { id: SID + ":a1", spaceId: SID, itemId: "a1", status: "graded", grade: 80, weight: null, notes: "", checklist: [], completedAt: 1, hidden: false }
    beforeEach(() => { fake.data.shared_courses = [course]; fake.data.removed_items = [removed]; fake.data.marks = [graded] })

    it("says who removed it, and offers Keep as mine and Dismiss to a member", async () => {
        fake.data.spaces = [space("member")]
        render(<ClassItemSheet itemKey={SCOPE + "/a1"} />)
        expect(screen.getByText("Removed from Web Services by Sam · 1h ago")).toBeTruthy()
        expect(screen.queryByRole("button", { name: "Restore for everyone" })).toBeNull()
        fireEvent.click(screen.getByRole("button", { name: "Keep as mine" }))
        await waitFor(() => expect(fake.api.spaces.keep).toHaveBeenCalledWith(SID, "a1"))
        fireEvent.click(screen.getByRole("button", { name: "Dismiss" }))
        await waitFor(() => expect(fake.store.deleteMark).toHaveBeenCalledWith(SID + ":a1"))
    })

    it("offers an editor Restore for everyone", async () => {
        fake.data.spaces = [space("owner")]
        render(<ClassItemSheet itemKey={SCOPE + "/a1"} />)
        fireEvent.click(screen.getByRole("button", { name: "Restore for everyone" }))
        await waitFor(() => expect(fake.store.restoreShared).toHaveBeenCalledWith(SCOPE, "a1"))
    })
})

describe("sharing an item with its class", () => {
    const it1 = { id: "x1", type: "lab", title: "Lab 4", classId: SID, courseId: null, links: [], date: "2026-10-12" }
    it("an editor shares an item filed under the class; a member sees nothing", async () => {
        fake.data.spaces = [space("owner")]
        const { unmount } = render(<ShareItem item={it1 as never} />)
        fireEvent.click(screen.getByRole("button", { name: "Share with the class" }))
        await waitFor(() => expect(fake.api.spaces.share).toHaveBeenCalledWith(SID, ["x1"]))
        unmount()
        fake.data.spaces = [space("member")]
        render(<ShareItem item={it1 as never} />)
        expect(screen.queryByRole("button", { name: "Share with the class" })).toBeNull()
    })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/components/sheet/leaving.test.tsx`
Expected: the three new tests FAIL (the card closes; `./share-item` missing).

- [ ] **Step 3: Add `RemovedCard` to `removed.tsx`**

Add imports: `closeSheet` from `@/data/overlay`; `tmeta` from `@/core/model`; `shortDate` from `@/core/dates`; `SharedItem` to the types import; `SheetBody, SheetFoot, SheetHead` from `./fields`.

```tsx
const TITLE = "font-serif text-[30px] leading-[1.15] font-[500] tracking-[-.015em]"

/** A removed class item's card (spec §15): who removed it; Keep as mine and Dismiss when you hold something on it; Restore for the owner and editors. Read-only otherwise. */
export function RemovedCard({ row, space, course }: { row: SharedItem; space: Space; course: string }) {
    const me = useProfile()?.id
    const key = row.scope + "/" + row.id
    const mark = useMarks().find((m) => m.id === markIdOf(key)) ?? null
    const mine = !!mark && meaningful(mark)
    const editor = space.role !== "member" && !space.archived
    const [err, setErr] = useState("")
    const act = (fn: () => Promise<void>) => () => void fn().then(() => setErr(""), (e) => setErr(messageFor(e)))
    return (
        <>
            <SheetHead kind="Class item" onClose={closeSheet} />
            <SheetBody>
                <div role="note" className="rounded-lg border border-[var(--warn-line)] bg-[var(--warn-bg)] px-2.5 py-2 text-[12px] text-[var(--warn-ink)]">
                    {removedLine(row, space, course, me)}
                </div>
                <h2 className={TITLE}>{row.title}</h2>
                <Note>{tmeta(row.type).label} · {shortDate(row.date)}{row.weight != null ? " · " + row.weight + "%" : ""}</Note>
                <Note>{mine
                    ? "Your " + (mark!.grade != null ? "grade of " + mark!.grade + "% " : "status and notes ") + "still count until you choose. Keep it as your own item, or dismiss it."
                    : "Nothing of yours is on it."}</Note>
                {err && <Note tone="bad">{err}</Note>}
            </SheetBody>
            <SheetFoot hint="">
                {editor && <Button variant="ghost" onClick={act(() => restoreItem(key))}>Restore for everyone</Button>}
                {mark && <Button variant="ghost" onClick={act(() => dismissItem(key))}>Dismiss</Button>}
                {mine ? <Button onClick={act(() => keepItem(key))}>Keep as mine</Button> : <Button onClick={closeSheet}>Done</Button>}
            </SheetFoot>
        </>
    )
}
```

- [ ] **Step 4: Open it from `class-item-sheet.tsx`**

In `ClassItemCard`: import `useRemovedItems, useSharedCourses` from `@/data/store` and `RemovedCard` from `./removed`. After `const row = …`:

```tsx
    const gone = useRemovedItems().find((it) => it.scope === scope && it.id === id) ?? null
    const courseName = useSharedCourses().find((c) => c.scope === scope)?.name ?? "the class"
```

Change the closing effect to `useEffect(() => { if ((!row && !gone) || !space) closeSheet() }, [row, gone, space])`, and just before `if (!row || !space || !scope) return null` add:

```tsx
    if (!row && gone && space) return <RemovedCard row={gone} space={space} course={courseName} />
```

Check no hook is called after these returns (`grep -n "use[A-Z][a-zA-Z]*(" src/components/sheet/class-item-sheet.tsx` and compare line numbers with the return); move any that are into the block above.

- [ ] **Step 5: Create `src/components/sheet/share-item.tsx`**

```tsx
// "Share with the class" on an item of yours filed under a class (spec §13): for its owner and
// editors, while it isn't archived; a built-in type only, never a lecture review. Your status,
// grade and notes move into your own layer on the class's new item.

import { useState } from "react"
import { useSpaces } from "@/data/store"
import { useMaintenance } from "@/data/maintenance"
import { canShareItem, shareItem } from "@/data/leave"
import { messageFor } from "@/data/classes"
import type { Item } from "@/data/types"
import { SharedGlyph } from "@/components/shared-glyph"
import { Button, Note, Section } from "./fields"

export function ShareItem({ item }: { item: Item }) {
    const space = useSpaces().find((s) => s.id === item.classId) ?? null
    const maintenance = useMaintenance("classes")
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState("")
    if (maintenance === "blocked" || !space || !canShareItem(item, space)) return null
    const go = async () => {
        setBusy(true)
        try { await shareItem(item.id, space.id, space.name); setErr("") } catch (e) { setErr(messageFor(e)) } finally { setBusy(false) }
    }
    return (
        <Section title={<><SharedGlyph /> Share with the class</>}>
            <Note>Make it a {space.name} item for everyone. Your status, grade and notes stay yours.{item.links.length ? " Links become visible to the class." : ""}</Note>
            <Button variant="ghost" className="self-start" disabled={busy} onClick={() => void go()}>Share with the class</Button>
            {err && <Note tone="bad">{err}</Note>}
        </Section>
    )
}
```

- [ ] **Step 6: Put it in `item-sheet.tsx`**

Import `ShareItem` from `./share-item`. After `{show.links && <Links … />}`:

```tsx
                {!isNew && it.classId && <ShareItem item={it} />}
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run src/components/sheet && npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/components/sheet
git commit -m "Stage 5: a removed item's card (Keep as mine, Dismiss, Restore); share an item with its class

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Docs

**Files:**
- Modify: `docs/DATA-MODEL.md`, `docs/OVERVIEW.md`, `docs/superpowers/plans/2026-10-02-collaboration.md`

- [ ] **Step 1: `docs/DATA-MODEL.md`**: in its routes list add the five Stage 5 routes with one line each (as Decision 5 words them); in the sync / IndexedDB section, that a class item's tombstone stays in `shared_items` (with `deletedAt`) and the app lists it apart; in the purge section, §13's order (Decision 11); under accounts, that deleting one hands its spaces on (Decision 10).

- [ ] **Step 2: `docs/OVERVIEW.md`**: in the shared classes part, a short paragraph: leaving keeps a copy by default; the owner removes, archives (read-only for everyone, still manages members), deletes when alone; removed items stay with whoever has something on them until **Keep as mine** / **Dismiss**; editors share one of their items with the class.

- [ ] **Step 3: The master plan**: the Stage 5 row's "Detailed plan" cell becomes `` `docs/superpowers/plans/2026-10-07-collab-stage-5-leave.md` ``. Under the Stage 6 outline add a **Hand-offs from Stage 5** paragraph: "The ICS feed must leave out a removed class item unless it is in `effectiveItems()` (a meaningful mark), and treat a left class's sessions as nothing. `POST /api/spaces/:sid/archive` replaced the spec's `PATCH`. Leaving a project, deleting a project and stripping assignees are Stage 8."

- [ ] **Step 4: Commit**

```bash
git add docs
git commit -m "Stage 5: docs for leaving and removal

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Full check, browser check, merge (George's yes)

- [ ] **Step 1: The whole suite**

Run: `npm run check`
Expected: typecheck clean, every test passing, build OK. Then `iconv -f utf-8 -t utf-8` over every file this stage touched (`git diff --name-only main` in Git Bash).

- [ ] **Step 2: Review**

Request a code review of `main..collab-5-leave` (superpowers:requesting-code-review), with spec §13 and this plan's Decisions as the brief. Fix what it confirms.

- [ ] **Step 3: Browser check** (`npm run dev`, two local admin accounts, e.g. `qaa` owner and `qab` member, in two Chrome windows)

1. As `qaa`, make a class, invite `qab`; `qab` accepts and gives one item a grade and notes.
2. As `qaa`, delete that item for everyone. As `qab`: the item still shows in the Week with its grade; its card says "Removed from … by …"; the class sheet lists it. **Keep as mine**: the item is now `qab`'s own, under the class. Repeat with another item and **Dismiss**: it leaves the views.
3. As `qaa`, delete a third item, then **Restore** it from the class sheet's Removed list: it is back for `qab`.
4. As `qab`, give an item a grade, then **Leave the class…** with Keep a copy: the class goes from the sidebar; a personal course with the same name holds the items with the grade and the class notes under "Class notes:". History shows past sessions on the course.
5. Rejoin `qab` with a code; leave **without** a copy: no new course; an old session reads "A class you left".
6. As `qaa`: **Archive**: `qab` (rejoined) sees the banner and cannot edit class facts; `qaa` hands the class on to `qab` while it is archived; `qab` unarchives.
7. As the owner with nobody else in it: **Delete the class…** with Keep a copy: the copy appears.
8. Admin page: delete a throwaway account that owns a class with a member: the member becomes its owner.

- [ ] **Step 4: Merge and push, only with George's yes**

Ask George. On yes:

```bash
git checkout main && git merge --no-ff collab-5-leave -m "Merge collab-5-leave: leaving and removal (Stage 5)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" && npm run check && git push
```

No migration: nothing to apply remotely. After the Cloudflare build is live, ask George to open the site signed in and open a class sheet.

---

## Self-review against the spec and the outline

- §13 table: delete a class item (Removed / Keep / Dismiss / Restore: Tasks 4, 7, 9–11); archive (Task 3); delete a class (Task 3); a member leaves with and without a copy (Tasks 1–2, 9–10); removed (Tasks 2, 10); transfer (Task 2, archived allowed); account deleted (Task 6). Project rows are Stage 8 (master plan hand-off, Task 12).
- §13 purge order: Task 5 (activity rows are Stage 7).
- §13 detach rules: Decision 2 and Task 1 (hidden items, notes merge, filed items, sessions, achievements, layer deleted, clash ids, tombstones revived).
- §13 share one item: Task 4 and Task 11.
- §6 Revocation (marks and prefs dropped, waiting mark edits carried): Tasks 7–8.
- Outline items from Stage 3/4: invites purged at 90 days (Task 5); account deletion replaces `409 owns_space` (Task 6); transfer while archived decided (Decision 4); Members tab Remove, class sheet Leave/Archive (Task 10); `applyPage` no longer drops a removed item that holds a mark (Task 7); `ACCOUNT_TABLES` left as is (cascade, Decision 10).
