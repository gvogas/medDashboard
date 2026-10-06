# Collaboration Stage 3: Classes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

This is **Stage 3** of the master plan `docs/superpowers/plans/2026-10-02-collaboration.md` (its "The stages" table and the Stage 3 outline). Stages 1 and 2 are live: courses, items and the change feed are keyed by `scope`; `spaces` and `members` exist (migration 0002); `worker/access.js` builds every guard; `worker/spaces.js` has `NEXT_SPACE_REVISION` and `touchSpace`; shared rows are written through `/api/spaces/:sid/{courses,items}/:id`; the client syncs with v3 and keeps `spaces`, `shared_courses` and `shared_items` in IndexedDB 5; `src/data/effective.ts` keeps shared rows out of the views (`SHARED_IN_VIEWS = false`). Stage 2's plan, `docs/superpowers/plans/2026-10-05-collab-stage-2-sync.md`, and its Decisions bind this one.

**Goal:** Admins can make a shared class (blank, or from one of their courses), invite people by username, hand out a join code, accept or decline invites, join with a code or a `/#join=` link, see a class's members and change roles, and hand a class on. Everyone else sees exactly what they see today.

**Architecture:** `migrations/0003_invites.sql` adds `invites`. The Worker gains `worker/classes.js` (the routes), with the SQL in `worker/spaces.js` (making a class, details, roles, transfer) and `worker/invites.js` (invites and join codes). Every statement that makes a membership carries the limits (20 spaces a person, 30 members a space) and its guard inside itself; the routes that make or join a space refuse non-admins (`ADMINS_ONLY`). On the client, `src/data/classes.ts` holds the calls, the invites list and the wording; new sheets show a class (Details, Members), make one, pick a course's items to share, join with a code and list invites; the sidebar lists an admin's classes and turns **+ New course** into a menu.

**Tech Stack:** Cloudflare Workers + D1 (plain JS ES modules), React 19 + TypeScript + Vite, IndexedDB, Vitest (Workers pool + jsdom), wrangler.

**Spec:** `docs/superpowers/specs/2026-10-02-shared-classes-design.md`: §3 (`invites`, limits), §5, §11, §13 (convert only), §14, §15, §17, §18, §20, §22, §23.

**UI reference:** the clickable prototype George approved (`term-shared.html` in the planning session's scratchpad): the **+** menu ("New shared class · Blank, from an outline, or convert a course", "Join with code · 8 characters from a classmate"), the class sheet's Members tab (invite by username, the code box, roles), the inbox's invite rows (Accept / Decline), the join flow ("Downloading Web Services…" → "You're in Web Services"), and the convert picker ("Share Databases"). This plan keeps its wording and structure in the app's own sheets and controls, and changes words only where Stage 3 does less than the prototype (see Decisions 1 and 3).

---

## How to work in this repo (read before any task)

1. **Checks:** `npm run typecheck`, `npm test` (Vitest: Workers + jsdom projects, then node tests), `npm run build`. `npm run check` runs all three. One file: `npx vitest run test/classes.test.js`. The jsdom tests alone: `npm run test:ui`.
2. **Dev server:** `npm run dev` → http://127.0.0.1:8787. On this Windows machine a stopped dev server can leave `vite.js` holding 8787/8790 and serving old code: check `Get-NetTCPConnection -LocalPort 8787 -State Listen` in PowerShell first and stop the owning process. Don't run `npm run build` while the dev server runs.
3. **Line endings:** keep every file LF. A CRLF in `index.html` breaks the CSP hash.
4. **Non-ASCII** (·, —, …): write it with the Edit/Write tools, never through a shell; after a commit that adds any, `npm run build` (Vite refuses Latin-1 bytes that tests miss). Several files below contain `·`, `—` and `…`.
5. **Deploying:** the Cloudflare Git build runs `npm run build` and does **not** apply remote D1 migrations. A stage with a migration needs `npm run db:remote` and `npm run db:check -- --remote` before its merge to `main`. After changing `wrangler.jsonc`, run `npm run build` before `npx wrangler deploy`.
6. **Commits:** end each message with the two lines below. Commit only on the stage branch; never push, merge to `main` or touch remote D1 without George's yes.
   ```
   Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
   Claude-Session: https://claude.ai/code/session_01JpUR1JXMY3ehtkiJwuij95
   ```
7. **Workers AI:** the automated tests use fakes; never call real AI from a test (10k neurons a day, shared with the live site). Nothing in this stage calls AI.

Branch: work on `collab-3-classes` (it exists and holds this plan; `git switch collab-3-classes`). The suite stays green after every task.

---

## Decisions this plan takes (where the spec left a choice, or the stage order forced one)

1. **A Stage 3 convert copies; it does not move.** Spec §13's convert moves your status, grade, checklist, notes and completion into `marks`, your colour/target/term into `space_prefs`, soft-deletes your course and the ticked items, files the unticked ones under the class (`class_id`) and labels your sessions (`space_id`). `marks` and `space_prefs` arrive in Stage 4, and shared rows stay out of the views until then (`SHARED_IN_VIEWS = false`), so a moving convert now would lose grades and take the course out of the Week, the Month and the calendar feed. In Stage 3 the batch makes the class, copies the course and the ticked items into `c:<sid>` in class shape (status `todo`, no grade, no checklist, empty class notes; type, title, dates, times, place, weight, recurrence, links and dept copied) and **leaves every personal row as it is**. Stage 4 makes convert move, and its merge sheet pairs a Stage 3 class with its owner's personal course by identical ids (recorded in the master plan's Stage 4 outline). The picker keeps §13's rules: tasks start unticked; lecture reviews and items of your own types cannot be ticked (`400 {field:'items'}` if sent).
2. **A convert is safe to retry.** The space `INSERT` runs only while you own no live class whose course has the converted course's id; a repeat answers `200` with that class and writes nothing. A blank create is not deduplicated (it is a person pressing Continue, not a background retry).
3. **No `space_prefs` writes in Stage 3, and a short join screen.** The table arrives in Stage 4, whose backfill gives every Stage 3 membership a prefs row (master plan). Joining therefore shows "Downloading *name*…" until the class is on the device, then "You're in *name*" with **Open the class**; the semester, colour and school-calendar choices and the merge sheet come with Stage 4 (prefs) and Stage 6 (calendar).
4. **What an admin sees.** Their classes are listed under **Courses** in the sidebar with the shared glyph ("*name*, shared, *n* members"); a class row opens the **class sheet** rather than filtering the views, because the class's items are not in the views until Stage 4. The class sheet has **Details** (the class course's facts and its items, read-only: shared edits come with Stage 4's split item card) and **Members**. Nobody's Week, Month, All items, grades or calendar feed changes.
5. **New sheets, not modals.** The class sheet is its own kind (`class`), apart from the personal course sheet, which is a draft editor of your own row; the personal course sheet gains a **Share this course** section (Convert, or **Open the class** once made). New shared class, the convert picker, joining and invites are sheets too: the app has no modal component, and the sheet already handles focus, Escape and the scrim. The class sheets load with `lazyNamed(…, { idle: false })`, so nobody who is not an admin downloads them.
6. **The admin-only gate** (§22): `ADMINS_ONLY = true` in `worker/spaces.js`. `POST /api/spaces`, `POST /api/invites/:sid/accept` and `POST /api/join` call `requireAdmin` (`403 {error:'forbidden'}`). Inviting someone who is not an admin answers `409 {error:'not_admin'}` (an invite they could never see or accept would only confuse the inviter). Every other class route acts inside a space, which only admins can be in. On the client, every entry point checks `profile.isAdmin`. Stage 6 sets the flag to `false` and removes the client checks (master plan Stage 6).
7. **A blank class** needs a name and a code (the course validator requires both); the Worker makes the course id (12 characters, like a space id) and the client picks the first of the twelve colours none of your courses uses. *From a course outline* is left out of the New shared class sheet until Stage 6 (outline import into a class). `kind: 'project'` is `400 {field:'kind'}` until Stage 8.
8. **Invites.** Default role: `member` in a class, `editor` in a project; only the owner gives the other (`403` for an editor). An invite lasts 30 days. A repeat upserts the one row (pending again, new inviter, new expiry), also after a decline. **Withdraw** (`DELETE …/invites/:uid`) is for the inviter or the owner and deletes the row; it works on pending and declined invites. Decline marks `declined`, which owner and editors see under Members. An expired pending invite reads `expired` in both lists. Stage 5's nightly purge deletes invites 90 days after creation (master plan).
9. **Answers.** Accept or join of a class you are already in answers `200` with it (safe to retry). Accept with no pending invite (withdrawn, declined, never sent, or the class deleted) is `404`; expired `410 expired`; at 20 spaces `409 limit`; at 30 members `409 full` (the spec names `full` for codes; accept uses it too). The invite stays pending after a `409`/`410`. Join: unknown code `404`, expired or used up `410 expired`.
10. **Join codes.** 8 Crockford base32 characters from 5 random bytes (40 bits), stored as SHA-256 hex, 7 days, 10 uses; a new code retires the old. `normalizeCode` (in `src/core/shared.ts`, used by both sides) drops spaces and hyphens, uppercases, and reads O as 0 and I/L as 1. Only the hash is kept, so the code is shown once, when made; afterwards the owner sees "works until *date*, for *n* more people", with **Make a new one** and **Turn off** (`DELETE …/code`). Joining while a member uses nothing. Joining by code takes a pending invite's role and marks it accepted.
11. **Rate limits** through `worker/limits.js` `claimLimit`: 20 invites an hour per inviter (`invite:<id>`), counted after the access check and before the username lookup, so unknown names count; 10 join attempts an hour per person (`join:<id>`), counted before anything else. Both answer `429 {error:'rate_limited', retryAfter}`. Deleting an account clears both keys.
12. **Limits inside the statement.** The `INSERT` that makes or revives a membership carries `MY_SPACES < 20` and `LIVE_MEMBERS < 30`; a create's space `INSERT` carries the 20, and each later statement in its batch runs only if that space row exists, so a refused create leaves nothing. `touchSpace` gains `{ifChanged}` (`AND changes() > 0`) so a membership statement that changed nothing does not move the revision.
13. **Roles and transfer** are the owner's (`assertOwner`, `ownerGuard`). The owner cannot change their own role (`403`); the target must be a live member (`404`); `owner` is never set by the role route (`400 {field:'role'}`). Transfer demotes the owner to editor, then promotes the target, in one batch (the one-owner index is checked statement by statement). Like every other owner action, it refuses an archived space; nothing archives a space before Stage 5.
14. **An account that owns a space cannot be deleted** (`409 {error:'owns_space'}`) until Stage 5 hands spaces on. Its memberships and invites go with the account by their foreign keys.
15. **The inbox stub** is `GET /api/invites` (your pending invites, expired ones marked) shown in an **Invites** sheet, opened from an **Invites** row in the sidebar that appears only while an admin has invites. The list is fetched when the app starts and whenever it comes back into view, for admins only; sync does not carry an unread count (Stage 7's inbox replaces both).
16. **`GET /api/spaces/:sid`** answers members to everyone in the space, invites to the owner and editors, and the code's status to the owner; the school-calendar snapshot is added with Stage 6. Removing a member, leaving, archiving and activity are not offered (Stage 5, Stage 7).
17. **`/#join=<code>`** is read once in `src/data/session.ts`, like `#spotify=`, and the hash cleared for everyone; an admin gets the join sheet with the code filled in, anyone else nothing.
18. **Existing users see no change.** For someone who is not an admin: the sidebar, the course sheet and every view render as today, no request goes to `/api/invites`, and no class sheet is downloaded. The only shared code they load is the small `share-course.tsx` inside the course sheet's chunk, which renders nothing for them.

## File map

| File | Change |
|---|---|
| `migrations/0003_invites.sql` | new: `invites` and its indexes |
| `scripts/lib/move-db.js` | `TABLES` gains `invites`; a source without it reads as empty |
| `worker/admin.js` | `LATEST_MIGRATION`; account deletion refuses an owner of a space, clears `invite:`/`join:` limits |
| `src/components/admin/use-admin.ts` | the words for `owns_space` |
| `src/core/shared.ts` | `REVIEW_ID`, `normalizeCode` |
| `src/core/reviews.ts` | reads `REVIEW_ID` from `shared.ts` |
| `worker/access.js` | `ownerGuard`, `assertOwner` |
| `worker/spaces.js` | `ADMINS_ONLY`, limits, `MY_SPACES`, `LIVE_MEMBERS`, `touchSpace({ifChanged})`, `randomId`, `spaceSummary`, `createClass`, `checkConvert`, `spaceDetails`, `setRole`, `transfer` |
| `worker/invites.js` | new: `invite`, `revokeInvite`, `myInvites`, `acceptInvite`, `declineInvite`, `newCode`, `hashCode`, `makeCode`, `dropCode`, `joinByCode` |
| `worker/classes.js` | new: `classRoutes`, `classBody` |
| `worker/db.js` | `SPACE_LIMIT` from `spaces.js` |
| `worker/api.js` | `...classRoutes` |
| `src/core/types.ts` | `SpaceSummary`, `SpaceMember`, `SpaceInvite`, `SpaceDetails`, `JoinCode`, `Invite` |
| `src/core/api.ts` | `api.spaces.*`, `api.invites.*`, `api.join` |
| `src/data/overlay.ts` | sheet kinds `class`, `new-class`, `convert`, `join`, `invites`; `ClassTab` |
| `src/data/store.ts` | `useSpaces`, `useSharedCourses`, `useSharedItems` |
| `src/data/classes.ts` | new: opening the sheets, invites list, download, convert rules, the calls, the words |
| `src/data/session.ts` | `/#join=`; invites for admins |
| `src/components/shared-glyph.tsx` | new: the two-person glyph |
| `src/components/sheet/class-sheet.tsx` | new: `ClassSheet` (Details, Members) |
| `src/components/sheet/members-tab.tsx` | new: `MembersTab` |
| `src/components/sheet/new-class-sheet.tsx` | new: `NewClassSheet` |
| `src/components/sheet/convert-sheet.tsx` | new: `ConvertSheet` |
| `src/components/sheet/share-course.tsx` | new: `ShareCourse` (in the course sheet) |
| `src/components/sheet/join-sheet.tsx` | new: `JoinSheet` |
| `src/components/sheet/invites-sheet.tsx` | new: `InvitesSheet` |
| `src/components/sheet/sheet.tsx` | the new kinds |
| `src/components/sheet/course-sheet.tsx` | **Share this course** for admins |
| `src/components/sidebar-classes.tsx` | new: `ClassRows`, `InvitesRow`, `NewMenu` |
| `src/components/sidebar.tsx` | the class rows, the Invites row and the menu for admins |
| `docs/DATA-MODEL.md` | `invites`; the class routes |
| Tests | new `test/invites-schema.test.js`, `test/space-rules.test.js`, `test/classes.test.js`, `test/members.test.js`, `test/invites.test.js`, `test/join-code.test.js`, `src/data/classes.test.ts`, `src/components/sheet/classes.test.tsx`; changed `test/spaces.js`, `test/move-db.test.js`, `test/admin.test.js`, `test/api-client.test.js`, `src/components/sheet/sheet.test.tsx`, `src/components/sidebar.test.tsx`, `src/data/session.test.ts` |

---

### Task 1: `invites` (migration 0003)

**Files:**
- Create: `migrations/0003_invites.sql`
- Create: `test/invites-schema.test.js`
- Modify: `scripts/lib/move-db.js`, `test/move-db.test.js`
- Modify: `worker/admin.js` (`LATEST_MIGRATION`)
- Modify: `docs/DATA-MODEL.md`

- [ ] **Step 1: Write the failing schema test**

`test/invites-schema.test.js`:

```js
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createUser } from './helpers.js';
import { makeSpace } from './spaces.js';

const FAILS = /CHECK constraint failed/;
/* A raw row, so these tests see the schema's own rules and not the Worker's. */
function invite(spaceId, userId, cols = {}) {
  const row = { invited_by: null, role: 'member', status: 'pending', created_at: 1, expires_at: 2, ...cols };
  const names = Object.keys(row);
  return env.DB.prepare(`INSERT INTO invites (space_id, user_id, ${names.join(', ')}) VALUES (?, ?, ${names.map(() => '?').join(', ')})`)
    .bind(spaceId, userId, ...Object.values(row)).run();
}
const count = async (spaceId) => (await env.DB.prepare('SELECT count(*) AS n FROM invites WHERE space_id = ?').bind(spaceId).first()).n;

describe('invites in the schema', () => {
  it('keeps one invite per person and space', async () => {
    const a = await createUser('inv-schema-a');
    const s = await makeSpace();
    await invite(s.id, a);
    await expect(invite(s.id, a)).rejects.toThrow(/UNIQUE constraint failed/);
  });

  it('gives only the two roles an invite can give, its three states, and an expiry after it was made', async () => {
    const b = await createUser('inv-schema-b');
    const s = await makeSpace();
    await expect(invite(s.id, b, { role: 'owner' })).rejects.toThrow(FAILS);
    await expect(invite(s.id, b, { status: 'revoked' })).rejects.toThrow(FAILS);
    await expect(invite(s.id, b, { created_at: 5, expires_at: 5 })).rejects.toThrow(FAILS);
    await invite(s.id, b, { role: 'editor', status: 'declined' });
  });

  it('goes with its space and with the invited account; the inviter leaving keeps it, unsigned', async () => {
    const c = await createUser('inv-schema-c'), boss = await createUser('inv-schema-boss');
    const s = await makeSpace({ members: { [boss]: 'owner' } });
    await invite(s.id, c, { invited_by: boss });
    await expect(invite('nonexistent1', c)).rejects.toThrow(/FOREIGN KEY constraint failed/);
    await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(boss).run();
    expect(await env.DB.prepare('SELECT invited_by FROM invites WHERE space_id = ? AND user_id = ?').bind(s.id, c).first()).toEqual({ invited_by: null });
    await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(c).run();
    expect(await count(s.id)).toBe(0);
    const d = await createUser('inv-schema-d');
    const t = await makeSpace();
    await invite(t.id, d);
    await env.DB.prepare('DELETE FROM spaces WHERE id = ?').bind(t.id).run();
    expect(await count(t.id)).toBe(0);
  });

  it.each([
    ["SELECT space_id FROM invites WHERE user_id = 'u' AND status = 'pending'", 'invites_user'],
    ['SELECT space_id FROM invites WHERE created_at < 5', 'invites_created'],
  ])('uses an index for %s', async (sql, index) => {
    const plan = await env.DB.prepare('EXPLAIN QUERY PLAN ' + sql).all();
    expect(plan.results.some((row) => row.detail.includes(index))).toBe(true);
  });
});
```

Deleting the space in the last case: `makeSpace` also writes the class course in `c:<id>`, which has no foreign key to `spaces`, so the delete goes through and the invite cascades.

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run test/invites-schema.test.js`
Expected: FAIL with `no such table: invites`.

- [ ] **Step 3: Write the migration**

`migrations/0003_invites.sql`:

```sql
-- Invitations to a space by username (spec §11). One row per person and space: a repeat
-- refreshes it. Accepting makes the membership and marks the row, so the inviter sees what
-- became of it. Join codes live on spaces (0002). Stage 5's nightly purge deletes invites
-- 90 days after they were made.

CREATE TABLE invites (
  space_id    TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  -- The person invited; deleting their account deletes their invites.
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Who sent it; NULL once that account is gone.
  invited_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  -- The role accepting gives. Never 'owner': ownership moves only by a transfer.
  role        TEXT NOT NULL CHECK (role IN ('editor', 'member')),
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL CHECK (expires_at > created_at),
  PRIMARY KEY (space_id, user_id)
);
-- Invites to me: the invites list, and from Stage 7 the inbox count.
CREATE INDEX invites_user ON invites (user_id) WHERE status = 'pending';
-- The nightly purge (Stage 5).
CREATE INDEX invites_created ON invites (created_at);
```

- [ ] **Step 4: Run the schema test**

Run: `npx vitest run test/invites-schema.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: See the move and admin tests fail**

Run: `npx vitest run test/move-db.test.js test/admin.test.js`
Expected: FAIL. In `move-db`, "names every source column the copy would leave behind" lists `invites.space_id`, …; in `admin`, the migrations check expects `0002_spaces.sql` and finds `0003_invites.sql`.

- [ ] **Step 6: Add a move test for a source made before the table**

Append to `test/move-db.test.js`:

```js
it('reads invites as empty from a database made before them, and copies them after members', async () => {
  const queries = new Map(readQueries(await columns(env.MIGRATION_DB)));
  expect((await env.MIGRATION_DB.prepare(queries.get('invites')).all()).results).toEqual([]);
  const sql = copyStatements({
    users: [{ id: 'ana', username: 'ana' }],
    spaces: [{ id: 'abcdefghij12', kind: 'class', archived: 0, created_at: 1, updated_at: 1, revision: 4 }],
    members: [{ space_id: 'abcdefghij12', user_id: 'ana', role: 'owner', joined_at: 1, updated_at: 1, revision: 4 }],
    invites: [{ space_id: 'abcdefghij12', user_id: 'ana', invited_by: null, role: 'member', status: 'pending', created_at: 1, expires_at: 2 }],
  });
  expect(sql.slice(0, 4).map((s) => s.split(' ').slice(0, 3).join(' '))).toEqual(['INSERT INTO users', 'INSERT INTO spaces', 'INSERT INTO members', 'INSERT INTO invites']);
});
```

- [ ] **Step 7: Extend the copy and the latest migration**

In `scripts/lib/move-db.js`, in `TABLES`, after the `members: […],` line add:

```js
  invites: ['space_id', 'user_id', 'invited_by', 'role', 'status', 'created_at', 'expires_at'],
```

Replace

```js
/* Tables migrations/0002_spaces.sql added: a database made before it has none of their rows. */
const ADDED_TABLES = new Set(['spaces', 'members']);
const ORDER_BY ={ users: 'id', spaces: 'id', members: 'space_id, user_id', courses: 'scope, id', items: 'scope, id', changes: 'seq', spotify_tokens: 'user_id', admin_log: 'id' };
```

with

```js
/* Tables added after rounds-v7's first schema (0002_spaces.sql, 0003_invites.sql): a database
   made before them has none of their rows. */
const ADDED_TABLES = new Set(['spaces', 'members', 'invites']);
const ORDER_BY = { users: 'id', spaces: 'id', members: 'space_id, user_id', invites: 'space_id, user_id', courses: 'scope, id', items: 'scope, id', changes: 'seq', spotify_tokens: 'user_id', admin_log: 'id' };
```

In `worker/admin.js`, replace `export const LATEST_MIGRATION = '0002_spaces.sql';` with `export const LATEST_MIGRATION = '0003_invites.sql';`.

- [ ] **Step 8: Run the three files**

Run: `npx vitest run test/invites-schema.test.js test/move-db.test.js test/admin.test.js`
Expected: PASS.

- [ ] **Step 9: Document the table**

In `docs/DATA-MODEL.md`, insert before the line `## Indexes`:

```markdown
## `invites`

`(space_id, user_id)`: an invitation to a space by username (spec §11). `invited_by` (NULL once that account is gone), `role` given on accepting (`editor` or `member`; never `owner`, which moves only by a transfer), `status` `pending` | `accepted` | `declined`, `created_at`, `expires_at` (30 days on). A repeat invite refreshes the one row; accepting makes or revives the membership and marks the row `accepted`. Deleted with its space or the invited account; Stage 5's nightly purge removes rows 90 days old.

```

- [ ] **Step 10: Commit**

```bash
git add migrations/0003_invites.sql test/invites-schema.test.js scripts/lib/move-db.js test/move-db.test.js worker/admin.js docs/DATA-MODEL.md
git commit -m "Invites: migration 0003, copied by the move

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JpUR1JXMY3ehtkiJwuij95"
```

---

### Task 2: What the class routes share: limits, ids, the owner's guard, codes

**Files:**
- Modify: `worker/spaces.js` (whole file below)
- Modify: `worker/access.js`
- Modify: `worker/db.js`
- Modify: `src/core/shared.ts`, `src/core/reviews.ts`
- Modify: `test/spaces.js` (helpers for Tasks 3–7)
- Create: `test/space-rules.test.js`

- [ ] **Step 1: Write the failing test**

`test/space-rules.test.js`:

```js
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createUser } from './helpers.js';
import { makeSpace, spaceRevision } from './spaces.js';
import { MY_SPACES, LIVE_MEMBERS, randomId, spaceSummary, touchSpace } from '../worker/spaces.js';
import { assertOwner, ownerGuard } from '../worker/access.js';
import { normalizeCode, REVIEW_ID } from '../src/core/shared.ts';

describe('what the class routes share', () => {
  it('makes ids of [a-z0-9], twelve by default, different each time', () => {
    const ids = new Set(Array.from({ length: 200 }, () => randomId()));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]{12}$/);
    expect(randomId(5)).toMatch(/^[a-z0-9]{5}$/);
  });

  it('reads a join code the way people type it', () => {
    expect(normalizeCode('7kq2 m9xd')).toBe('7KQ2M9XD');
    expect(normalizeCode('7KQ2-M9XD')).toBe('7KQ2M9XD');
    expect(normalizeCode('OIL0abcd')).toBe('0110ABCD');
    expect(normalizeCode('7KQ2M9X')).toBeNull();
    expect(normalizeCode('7KQ2M9XU')).toBeNull();
    expect(normalizeCode(12345678)).toBeNull();
  });

  it('knows a lecture review by its id', () => {
    expect(REVIEW_ID.test('rvab12cd31')).toBe(true);
    expect(REVIEW_ID.test('rvab12cd35')).toBe(false);
    expect(REVIEW_ID.test('abc1234')).toBe(false);
  });

  it('moves a space revision only when the statement before it changed a row, if asked', async () => {
    const s = await makeSpace();
    const before = await spaceRevision(s.id);
    await env.DB.batch([env.DB.prepare('UPDATE spaces SET updated_at = 3 WHERE id = ? AND 0').bind(s.id), touchSpace(env.DB, s.id, 5, { ifChanged: true })]);
    expect(await spaceRevision(s.id)).toBe(before);
    await env.DB.batch([env.DB.prepare('UPDATE spaces SET updated_at = 3 WHERE id = ?').bind(s.id), touchSpace(env.DB, s.id, 5, { ifChanged: true })]);
    expect(await spaceRevision(s.id)).toBeGreaterThan(before);
  });

  it('sums a space up for the person in it, and nothing for anyone else', async () => {
    const a = await createUser('rules-a'), b = await createUser('rules-b');
    const s = await makeSpace({ members: { [a]: 'owner' } });
    expect(await spaceSummary(env.DB, a, s.id)).toEqual({ id: s.id, scope: s.scope, kind: 'class', name: 'Web Services', role: 'owner', members: 1 });
    expect(await spaceSummary(env.DB, b, s.id)).toBeNull();
  });

  it('lets only the owner past assertOwner, and counts live spaces and members', async () => {
    const o = await createUser('rules-o'), e = await createUser('rules-e');
    const s = await makeSpace({ members: { [o]: 'owner', [e]: 'editor' } });
    expect(await assertOwner(env.DB, o, s.id)).toMatchObject({ role: 'owner' });
    await expect(assertOwner(env.DB, e, s.id)).rejects.toMatchObject({ status: 403, body: { error: 'forbidden' } });
    const mine = ownerGuard(s.id, o), theirs = ownerGuard(s.id, e);
    expect((await env.DB.prepare(`SELECT ${mine.sql} AS ok`).bind(...mine.binds).first()).ok).toBe(1);
    expect((await env.DB.prepare(`SELECT ${theirs.sql} AS ok`).bind(...theirs.binds).first()).ok).toBe(0);
    expect((await env.DB.prepare(`SELECT ${MY_SPACES} AS n`).bind(o).first()).n).toBe(1);
    expect((await env.DB.prepare(`SELECT ${LIVE_MEMBERS('?')} AS n`).bind(s.id).first()).n).toBe(2);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run test/space-rules.test.js`
Expected: FAIL: `MY_SPACES` (and the others) are not exported by `worker/spaces.js`.

- [ ] **Step 3: The shared rules**

Append to `src/core/shared.ts`:

```ts

/** A generated lecture review's id (core/reviews.ts): 'rv', seven characters, its step. A review is yours alone and never goes into a class (spec §13). */
export const REVIEW_ID = /^rv[0-9a-z]{7}([1-4])$/

/**
 * A join code as typed: Crockford base32 read the forgiving way (any case, O as 0, I and L
 * as 1, spaces and hyphens dropped). The eight characters, or null (spec §11).
 */
export function normalizeCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const code = raw.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')
  return /^[0-9A-HJKMNP-TV-Z]{8}$/.test(code) ? code : null
}
```

In `src/core/reviews.ts`, delete the line `const ID = /^rv[0-9a-z]{7}([1-4])$/;` and after the line `import type { Course, Item, Meeting } from './types.ts';` add:

```ts
import { REVIEW_ID as ID } from './shared.ts';
```

- [ ] **Step 4: The owner's guard**

In `worker/access.js`, after the line that defines `editorGuard`, add:

```js
/** The owner's own acts on an unarchived space: codes, roles, inviting with another role, handing it on. */
export const ownerGuard = guard(" AND gs.archived = 0 AND gm.role = 'owner'");
```

and at the end of the file add:

```js

/** As assertAllowed(…, 'editor'), and 403 forbidden for anyone in the space but its owner. */
export async function assertOwner(db, userId, spaceId) {
  const r = await assertAllowed(db, userId, spaceId, 'editor');
  if (r.role !== 'owner') throw new HttpError(403, { error: 'forbidden' });
  return r;
}
```

- [ ] **Step 5: `worker/spaces.js`**

Replace the whole of `worker/spaces.js` with:

```js
// Spaces (migrations/0002_spaces.sql) and what the class routes share: the gate, the limits,
// Worker-made ids, the space revision and a space's summary. Making a class, its details,
// roles and transfer follow below; invites and join codes are in worker/invites.js.
import { scopeOf } from './access.js';

/* Classes are open to admins only until Stage 6 (spec §22): the routes that make or join a
   space refuse anyone else, and an invite to anyone else is refused. Stage 6 sets this false. */
export const ADMINS_ONLY = true;
/** The most live spaces a person holds, and the most live members a space holds (spec §3 Limits). */
export const SPACE_LIMIT = 20;
export const MEMBER_LIMIT = 30;

/** A person's live spaces, counted in SQL; bind the user id. */
export const MY_SPACES = `(SELECT count(*) FROM members AS lm JOIN spaces AS ls ON ls.id = lm.space_id
  WHERE lm.user_id = ? AND lm.deleted_at IS NULL AND ls.deleted_at IS NULL)`;
/** A space's live members, counted in SQL; `space` is a column, or '?' to bind the id. */
export const LIVE_MEMBERS = (space) => `(SELECT count(*) FROM members AS sm WHERE sm.space_id = ${space} AND sm.deleted_at IS NULL)`;

/**
 * The next space revision: above the change feed's head and above every space's own, so a
 * space whose row or members changed is always above the `sv` a client sends, even when no
 * course or item was written in between (spec §3, §6).
 */
export const NEXT_SPACE_REVISION =
  "(SELECT MAX(COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'changes'), 0), COALESCE((SELECT MAX(revision) FROM spaces), 0)) + 1)";

/**
 * Move a space's revision on. Put it in the same batch as the change to the space or its
 * members; with `ifChanged`, only when the statement just before it changed a row.
 */
export const touchSpace = (db, spaceId, now = Date.now(), { ifChanged = false } = {}) =>
  db.prepare(`UPDATE spaces SET revision = ${NEXT_SPACE_REVISION}, updated_at = ? WHERE id = ?${ifChanged ? ' AND changes() > 0' : ''}`).bind(now, spaceId);

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
/** An id the Worker makes: `n` characters of [a-z0-9], each equally likely. */
export function randomId(n = 12) {
  let out = '';
  while (out.length < n) {
    for (const b of crypto.getRandomValues(new Uint8Array(n))) if (b < 252 && out.length < n) out += ALPHABET[b % 36];
  }
  return out;
}

/** A space as the class routes answer it, for someone in it: {id, scope, kind, name, role, members}; null for anyone else. */
export async function spaceSummary(db, userId, spaceId) {
  const r = await db.prepare(`SELECT s.id, s.kind, m.role, ${LIVE_MEMBERS('s.id')} AS members,
      CASE s.kind WHEN 'class' THEN (SELECT name FROM courses WHERE scope = 'c:' || s.id AND deleted_at IS NULL LIMIT 1)
        ELSE (SELECT title FROM items WHERE scope = 'p:' || s.id AND id = 'project') END AS name
    FROM spaces AS s JOIN members AS m ON m.space_id = s.id AND m.user_id = ? AND m.deleted_at IS NULL
    WHERE s.id = ? AND s.deleted_at IS NULL`).bind(userId, spaceId).first();
  return r ? { id: r.id, scope: scopeOf(r.kind, r.id), kind: r.kind, name: r.name ?? '', role: r.role, members: r.members } : null;
}
```

In `worker/db.js`, delete

```js
/* The most spaces a person holds (spec §3 Limits). */
const SPACE_LIMIT = 20;
```

and after the line `import { assertAllowed, editorGuard, memberGuard, parseScope, scopeOf, writerGuard } from './access.js';` add:

```js
import { SPACE_LIMIT } from './spaces.js';
```

- [ ] **Step 6: Helpers for the route tests**

Append to `test/spaces.js`:

```js

/** Sign in as a new admin (classes are open to admins only until Stage 6). `api.id` is the user id. */
export async function signInAdmin(username) {
  const api = await signIn(username);
  await env.DB.prepare('UPDATE users SET is_admin = 1 WHERE username = ?').bind(username).run();
  api.id = 'u-' + username;
  return api;
}

/** A POST with a JSON body. */
export const post = (api, path, body = {}) => api(path, { method: 'POST', body });
```

and change its import line `import { NEXT_SPACE_REVISION, touchSpace } from '../worker/spaces.js';` to

```js
import { NEXT_SPACE_REVISION, touchSpace } from '../worker/spaces.js';
import { signIn } from './helpers.js';
```

- [ ] **Step 7: Run the new test and the ones that use what changed**

Run: `npx vitest run test/space-rules.test.js test/access.test.js test/sync-v3.test.js test/shared-routes.test.js`
Then: `npx vitest run --project dom src/data` (reviews are read there) and `npm run typecheck`
Expected: PASS, and no type errors.

- [ ] **Step 8: Commit**

```bash
git add worker/spaces.js worker/access.js worker/db.js src/core/shared.ts src/core/reviews.ts test/spaces.js test/space-rules.test.js
git commit -m "Spaces: the gate, the limits, Worker ids, the owner's guard, join-code reading

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JpUR1JXMY3ehtkiJwuij95"
```

---

### Task 3: Making a class: blank, or from a course of yours

**Files:**
- Modify: `worker/spaces.js` (append; new imports)
- Create: `worker/classes.js`
- Modify: `worker/api.js`
- Create: `test/classes.test.js`

- [ ] **Step 1: Write the failing test**

`test/classes.test.js`:

```js
import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { signIn } from './helpers.js';
import { post, signInAdmin } from './spaces.js';

const course = { code: 'OS', name: 'Operating Systems', color: '#4FBF8B', instructor: 'Dr. Lin', term: 'Fall 2026', meetings: [] };
let owner, plain;
beforeAll(async () => { owner = await signInAdmin('cls-owner'); plain = await signIn('cls-plain'); });

const make = (api, body) => post(api, '/api/spaces', body);
const classRows = async (scope) => (await env.DB.prepare(
  'SELECT id, type, status, grade, notes, checklist, course_id AS courseId, updated_by AS updatedBy FROM items WHERE scope = ? ORDER BY id',
).bind(scope).all()).results;

describe('making a class', () => {
  it('refuses anyone who is not an admin while classes are theirs alone', async () => {
    const res = await make(plain, { kind: 'class', course });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
  });

  it('checks what it is given', async () => {
    expect(await (await make(owner, { kind: 'project', title: 'x' })).json()).toEqual({ error: 'invalid', field: 'kind' });
    expect(await (await make(owner, { kind: 'class' })).json()).toEqual({ error: 'invalid', field: 'course' });
    expect(await (await make(owner, { kind: 'class', course: { ...course, name: '' } })).json()).toEqual({ error: 'invalid', field: 'name' });
    expect(await (await make(owner, { kind: 'class', convertCourseId: 'nope', items: [] })).json()).toEqual({ error: 'invalid', field: 'convertCourseId' });
    expect(await (await make(owner, { kind: 'class', convertCourseId: 'nope', items: 'a1' })).json()).toEqual({ error: 'invalid', field: 'items' });
  });

  it('makes a blank class: the space, you as owner and its course, in class shape; sync brings it', async () => {
    const res = await make(owner, { kind: 'class', course: { ...course, target: 80, archived: true } });
    expect(res.status).toBe(201);
    const { space } = await res.json();
    expect(space).toMatchObject({ kind: 'class', name: 'Operating Systems', role: 'owner', members: 1 });
    expect(space.id).toMatch(/^[a-z0-9]{12}$/);
    expect(space.scope).toBe('c:' + space.id);
    const saved = await env.DB.prepare('SELECT id, name, target, archived, updated_by AS updatedBy FROM courses WHERE scope = ?').bind(space.scope).first();
    expect(saved).toMatchObject({ name: 'Operating Systems', target: null, archived: 0, updatedBy: owner.id });
    expect(saved.id).toMatch(/^[a-z0-9]{12}$/);
    const page = await (await owner('/api/sync?v=3&cursors=')).json();
    expect(page.scopes.find((s) => s.id === space.id)).toMatchObject({ role: 'owner', name: 'Operating Systems' });
    expect(page.changes.filter((c) => c.scope === space.scope).map((c) => c.kind)).toEqual(['courses']);
  });

  it('converts a course: copies it and the items ticked, in class shape, and leaves your own as they were', async () => {
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
    const a1 = await env.DB.prepare("SELECT links, weight FROM items WHERE scope = ? AND id = 'a1'").bind(space.scope).first();
    expect({ links: JSON.parse(a1.links), weight: a1.weight }).toEqual({ links: [{ label: 'Spec', url: 'https://example.com' }], weight: 20 });

    /* your own course and items are as they were: Stage 4 moves your layer (plan Decision 1) */
    const mine = await env.DB.prepare("SELECT id, status, grade, notes, deleted_at AS gone FROM items WHERE scope = ? ORDER BY id").bind('u:' + owner.id).all();
    expect(mine.results.find((r) => r.id === 'a1')).toEqual({ id: 'a1', status: 'graded', grade: 91, notes: 'mine', gone: null });
    expect(mine.results.filter((r) => r.gone === null)).toHaveLength(5);
    expect(await env.DB.prepare("SELECT target, deleted_at AS gone FROM courses WHERE scope = ? AND id = 'db'").bind('u:' + owner.id).first()).toEqual({ target: 85, gone: null });

    /* the same convert again answers the class it made and makes nothing */
    const again = await make(owner, { kind: 'class', convertCourseId: 'db', items: ['a1', 'q1'] });
    expect(again.status).toBe(200);
    expect((await again.json()).space.id).toBe(space.id);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM courses WHERE scope GLOB 'c:*' AND id = 'db'").first()).n).toBe(1);
    expect(await classRows(space.scope)).toHaveLength(2);
  });

  it('stops at 20 spaces with 409 limit, and leaves nothing half made', async () => {
    const full = await signInAdmin('cls-full');
    for (let i = 0; i < 20; i++) expect((await make(full, { kind: 'class', course })).status).toBe(201);
    const res = await make(full, { kind: 'class', course });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'limit' });
    expect((await env.DB.prepare('SELECT count(*) AS n FROM members WHERE user_id = ?').bind(full.id).first()).n).toBe(20);
    expect((await env.DB.prepare('SELECT count(*) AS n FROM spaces AS s WHERE NOT EXISTS (SELECT 1 FROM members WHERE space_id = s.id)').first()).n).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run test/classes.test.js`
Expected: FAIL: `POST /api/spaces` answers `404 not_found` (no route).

- [ ] **Step 3: Make a class (`worker/spaces.js`)**

In `worker/spaces.js`, replace the line `import { scopeOf } from './access.js';` with:

```js
import { HttpError } from './http.js';
import { scopeOf } from './access.js';
import { REVIEW_ID } from '../src/core/shared.ts';
```

and append:

```js

/* A row's first revision: the change feed's next sequence value, as worker/db.js writes it. */
const NEXT_ROW_REVISION = "COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'changes'), 0) + 1";
/* A live class this person owns whose course has the id bound second: an earlier convert of that course. */
const MADE_FROM = `SELECT s.id FROM spaces AS s JOIN members AS m ON m.space_id = s.id
  WHERE m.user_id = ? AND m.role = 'owner' AND m.deleted_at IS NULL AND s.kind = 'class' AND s.deleted_at IS NULL
    AND EXISTS (SELECT 1 FROM courses WHERE scope = 'c:' || s.id AND id = ?)`;

/**
 * A convert's course must be a live course of yours, and each item named a live item of it
 * that a class can take: not one of your own types (the c: CHECK refuses them) and not a
 * lecture review, which is yours alone (spec §13).
 */
export async function checkConvert(db, userId, courseId, ids) {
  const mine = 'u:' + userId;
  const [course, found] = await db.batch([
    db.prepare('SELECT 1 AS x FROM courses WHERE scope = ? AND id = ? AND deleted_at IS NULL').bind(mine, courseId),
    db.prepare('SELECT id, type FROM items WHERE scope = ? AND course_id = ? AND deleted_at IS NULL AND id IN (SELECT value FROM json_each(?))')
      .bind(mine, courseId, JSON.stringify(ids)),
  ]);
  if (!course.results.length) throw new HttpError(400, { error: 'invalid', field: 'convertCourseId' });
  if (found.results.length !== ids.length || found.results.some((r) => r.type.startsWith('c-') || (r.type === 'task' && REVIEW_ID.test(r.id)))) {
    throw new HttpError(400, { error: 'invalid', field: 'items' });
  }
}

/**
 * A new class with you as its owner (spec §13, §20), in one batch: the space, your
 * membership and its course: a blank one from `course`, or a copy of your course
 * `convertCourseId` with the items named in `items`, in class shape. Stage 3 copies and
 * leaves your own rows as they are (plan Decision 1). The space INSERT carries the 20-space
 * limit and, for a convert, "you own no class made from this course yet"; every later
 * statement runs only if that row was made, so a refusal leaves nothing. A repeated convert
 * answers the class it made ({created: false}). Past 20 spaces: 409 limit.
 */
export async function createClass(db, userId, { course, convertCourseId = null, items = [] }, now = Date.now()) {
  const id = randomId(), scope = scopeOf('class', id), mine = 'u:' + userId;
  const copy = convertCourseId !== null, courseId = copy ? convertCourseId : randomId();
  const made = 'EXISTS (SELECT 1 FROM spaces WHERE id = ?)';
  const stmts = [
    db.prepare(`INSERT INTO spaces (id, kind, created_at, updated_at, revision) SELECT ?, 'class', ?, ?, ${NEXT_SPACE_REVISION}
      WHERE ${MY_SPACES} < ?${copy ? ` AND EXISTS (SELECT 1 FROM courses WHERE scope = ? AND id = ? AND deleted_at IS NULL) AND NOT EXISTS (${MADE_FROM})` : ''}`)
      .bind(id, now, now, userId, SPACE_LIMIT, ...(copy ? [mine, courseId, userId, courseId] : [])),
    db.prepare(`INSERT INTO members (space_id, user_id, role, joined_at, updated_at) SELECT ?, ?, 'owner', ?, ? WHERE ${made}`).bind(id, userId, now, now, id),
    copy
      ? db.prepare(`INSERT INTO courses (scope, id, code, name, color, instructor, term, archived, meetings, target, updated_by, created_at, updated_at, revision)
          SELECT ?, id, code, name, color, instructor, term, 0, meetings, NULL, ?, ?, ?, ${NEXT_ROW_REVISION} FROM courses
          WHERE scope = ? AND id = ? AND deleted_at IS NULL AND ${made}`).bind(scope, userId, now, now, mine, courseId, id)
      : db.prepare(`INSERT INTO courses (scope, id, code, name, color, instructor, term, archived, meetings, target, updated_by, created_at, updated_at, revision)
          SELECT ?, ?, ?, ?, ?, ?, ?, 0, ?, NULL, ?, ?, ?, ${NEXT_ROW_REVISION} WHERE ${made}`)
          .bind(scope, courseId, course.code, course.name, course.color, course.instructor, course.term, JSON.stringify(course.meetings), userId, now, now, id),
  ];
  if (copy && items.length) {
    /* the class's facts only: no status, grade, checklist or notes of yours (the c: CHECK) */
    stmts.push(db.prepare(`INSERT INTO items (scope, id, type, title, course_id, date, start, end, location, status, weight, notes, links,
        recur, weekday, recur_until, dept, updated_by, created_at, updated_at, revision)
      SELECT ?, id, type, title, course_id, date, start, end, location, 'todo', weight, '', links,
        recur, weekday, recur_until, dept, ?, ?, ?, ${NEXT_ROW_REVISION} FROM items
      WHERE scope = ? AND course_id = ? AND deleted_at IS NULL AND type NOT GLOB 'c-*' AND id IN (SELECT value FROM json_each(?)) AND ${made}`)
      .bind(scope, userId, now, now, mine, courseId, JSON.stringify(items), id));
  }
  const [space] = await db.batch(stmts);
  if (space.meta.changes) return { created: true, space: await spaceSummary(db, userId, id) };
  if (copy) {
    const prior = await db.prepare(MADE_FROM).bind(userId, courseId).first();
    if (prior) return { created: false, space: await spaceSummary(db, userId, prior.id) };
  }
  const { n } = await db.prepare(`SELECT ${MY_SPACES} AS n`).bind(userId).first();
  if (n >= SPACE_LIMIT) throw new HttpError(409, { error: 'limit' });
  throw new HttpError(400, { error: 'invalid', field: 'convertCourseId' });
}
```

- [ ] **Step 4: The route (`worker/classes.js`)**

Create `worker/classes.js`:

```js
// The class routes (spec §11, §14): making a class, its members, its invites and its join
// code. Until classes open to everyone (Stage 6), making or joining a space is for admins
// only; the other routes act inside a space, which only admins can be in until then.
import { json, readJson, HttpError } from './http.js';
import { requireUser } from './auth.js';
import { requireAdmin } from './admin.js';
import { validateSharedCourse } from './validate.js';
import { ADMINS_ONLY, checkConvert, createClass } from './spaces.js';

const SID = '([a-z0-9]{12})';
const UID = '([^/]{1,64})';
const route = (path) => new RegExp(`^/api/${path}$`);
const done = () => new Response(null, { status: 204 });
const bad = (field) => new HttpError(400, { error: 'invalid', field });

/** Who may make or join a space: an admin while ADMINS_ONLY (spec §22), else anyone signed in. */
const joiner = async (request, env) => (ADMINS_ONLY ? (await requireAdmin(request, env)).id : requireUser(request, env));

/* An id as these routes take it: 1 to `max` characters, no control characters. */
function idOf(v, field, max = 24) {
  if (typeof v !== 'string' || v.length < 1 || v.length > max || /[\u0000-\u001f\u007f]/.test(v)) throw bad(field);
  return v;
}

/** POST /api/spaces in Stage 3: a class, blank (`course`) or from a course of yours (`convertCourseId`, `items`). */
export function classBody(body) {
  if (body.kind !== 'class') throw bad('kind');
  if (body.convertCourseId == null) {
    if (!body.course || typeof body.course !== 'object' || Array.isArray(body.course)) throw bad('course');
    return { course: validateSharedCourse(body.course) };
  }
  const items = body.items ?? [];
  if (!Array.isArray(items) || items.length > 500) throw bad('items');
  return { convertCourseId: idOf(body.convertCourseId, 'convertCourseId'), items: [...new Set(items.map((id) => idOf(id, 'items')))] };
}

export const classRoutes = [
  ['POST', route('spaces'), async ({ request, env }) => {
    const userId = await joiner(request, env);
    const body = classBody(await readJson(request));
    if (body.convertCourseId) await checkConvert(env.DB, userId, body.convertCourseId, body.items);
    const { created, space } = await createClass(env.DB, userId, body);
    return json({ space }, created ? 201 : 200);
  }],
];
```

(`SID`, `UID` and `done` are used by the routes Tasks 4–6 add.)

In `worker/api.js`, after the line `import { adminRoutes, markSeen, readAnnouncement } from './admin.js';` add:

```js
import { classRoutes } from './classes.js';
```

and replace the line `  ...adminRoutes,` with:

```js
  ...classRoutes,
  ...adminRoutes,
```

- [ ] **Step 5: Run the test**

Run: `npx vitest run test/classes.test.js`
Expected: PASS (5 tests).

- [ ] **Step 6: Run the Worker suite**

Run: `npm run test:api`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add worker/spaces.js worker/classes.js worker/api.js test/classes.test.js
git commit -m "Classes: make one blank or from a course (a copy, safe to retry), admins only

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JpUR1JXMY3ehtkiJwuij95"
```

---

### Task 4: A class's details, roles and handing it on

**Files:**
- Modify: `worker/spaces.js` (append; imports)
- Modify: `worker/classes.js`
- Create: `test/members.test.js`

- [ ] **Step 1: Write the failing test**

`test/members.test.js`:

```js
import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { signIn } from './helpers.js';
import { makeSpace, post, spaceRevision } from './spaces.js';

const ROLES = ['owner', 'editor', 'member', 'outsider'];
const as = {}, uid = (role) => `u-mb-${role}`;
let s;
beforeAll(async () => {
  for (const role of ROLES) as[role] = await signIn(`mb-${role}`);
  s = await makeSpace({ members: { [uid('owner')]: 'owner', [uid('editor')]: 'editor', [uid('member')]: 'member' } });
});

const details = async (role, space = s) => (await as[role](`/api/spaces/${space.id}`)).json();
const setRole = (role, target, body, space = s) => as[role](`/api/spaces/${space.id}/members/${target}`, { method: 'PUT', body });
const roles = async (space) => (await env.DB.prepare('SELECT user_id AS id, role FROM members WHERE space_id = ? AND deleted_at IS NULL ORDER BY user_id').bind(space.id).all()).results;

describe("a class's details", () => {
  it('show the members to everyone in it, invites to owner and editors, the code to the owner only', async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO invites (space_id, user_id, invited_by, role, status, created_at, expires_at) VALUES (?, ?, ?, 'member', 'pending', 1, ?)")
        .bind(s.id, uid('outsider'), uid('owner'), Date.now() + 1e9),
      env.DB.prepare('UPDATE spaces SET code_hash = ?, code_expires = ?, code_uses_left = 4 WHERE id = ?').bind('a'.repeat(64), Date.now() + 1e9, s.id),
    ]);
    const o = await details('owner');
    expect(o).toMatchObject({ id: s.id, scope: s.scope, kind: 'class', role: 'owner', archived: false, code: { usesLeft: 4 } });
    /* all joined at the same moment, so in user id order */
    expect(o.members.map((m) => [m.username, m.role])).toEqual([['mb-editor', 'editor'], ['mb-member', 'member'], ['mb-owner', 'owner']]);
    expect(o.members.find((m) => m.role === 'owner')).toMatchObject({ userId: uid('owner'), name: 'mb-owner', joinedAt: 1 });
    expect(o.invites).toEqual([expect.objectContaining({ userId: uid('outsider'), name: 'mb-outsider', role: 'member', status: 'pending', invitedBy: uid('owner') })]);
    expect(await details('editor')).toMatchObject({ role: 'editor', code: null, invites: [expect.objectContaining({ userId: uid('outsider') })] });
    expect(await details('member')).toMatchObject({ role: 'member', code: null, invites: [] });
    expect((await as.outsider(`/api/spaces/${s.id}`)).status).toBe(404);
    await env.DB.prepare('UPDATE invites SET created_at = 1, expires_at = 2 WHERE space_id = ?').bind(s.id).run();
    expect((await details('owner')).invites[0].status).toBe('expired');
  });
});

describe('roles', () => {
  it('let the owner make a member an editor and back, moving the space revision', async () => {
    const before = await spaceRevision(s.id);
    const res = await setRole('owner', uid('member'), { role: 'editor' });
    expect(await res.json()).toEqual({ userId: uid('member'), role: 'editor' });
    expect(await spaceRevision(s.id)).toBeGreaterThan(before);
    expect(await (await setRole('owner', uid('member'), { role: 'member' })).json()).toEqual({ userId: uid('member'), role: 'member' });
  });

  it('are the owner alone to change, never their own, never to owner', async () => {
    expect(await (await setRole('editor', uid('member'), { role: 'editor' })).json()).toEqual({ error: 'forbidden' });
    expect((await setRole('member', uid('editor'), { role: 'member' })).status).toBe(403);
    expect((await setRole('outsider', uid('member'), { role: 'editor' })).status).toBe(404);
    expect(await (await setRole('owner', uid('owner'), { role: 'editor' })).json()).toEqual({ error: 'forbidden' });
    expect(await (await setRole('owner', uid('member'), { role: 'owner' })).json()).toEqual({ error: 'invalid', field: 'role' });
    expect((await setRole('owner', uid('outsider'), { role: 'editor' })).status).toBe(404);
    expect(await roles(s)).toEqual([{ id: uid('editor'), role: 'editor' }, { id: uid('member'), role: 'member' }, { id: uid('owner'), role: 'owner' }]);
  });
});

describe('handing a class on', () => {
  it('makes a member the owner and the old owner an editor, in one batch; only the owner can', async () => {
    const t = await makeSpace({ members: { [uid('owner')]: 'owner', [uid('member')]: 'member' } });
    const transfer = (role, userId) => post(as[role], `/api/spaces/${t.id}/transfer`, { userId });
    expect((await transfer('outsider', uid('member'))).status).toBe(404);
    expect((await transfer('member', uid('member'))).status).toBe(403);
    expect((await transfer('owner', uid('outsider'))).status).toBe(404);
    expect(await (await transfer('owner', uid('owner'))).json()).toEqual({ error: 'invalid', field: 'userId' });
    expect(await roles(t)).toEqual([{ id: uid('member'), role: 'member' }, { id: uid('owner'), role: 'owner' }]);
    const before = await spaceRevision(t.id);
    expect((await transfer('owner', uid('member'))).status).toBe(204);
    expect(await roles(t)).toEqual([{ id: uid('member'), role: 'owner' }, { id: uid('owner'), role: 'editor' }]);
    expect(await spaceRevision(t.id)).toBeGreaterThan(before);
    expect((await transfer('owner', uid('member'))).status).toBe(403);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run test/members.test.js`
Expected: FAIL: `GET /api/spaces/<id>` answers `404` for the owner too (no route), and the role and transfer routes are missing.

- [ ] **Step 3: Details, roles and transfer (`worker/spaces.js`)**

In `worker/spaces.js`, replace the line `import { scopeOf } from './access.js';` with:

```js
import { assertAllowed, assertOwner, memberGuard, ownerGuard, scopeOf } from './access.js';
```

and append:

```js

const NAME = "COALESCE(NULLIF(u.display_name, ''), u.username)";

/**
 * A space for its Members tab (spec §11, §15): its members for everyone in it; its invites
 * not yet accepted for the owner and editors (a pending one past its expiry reads
 * 'expired'); and its join code's expiry and uses left for the owner. The code itself is
 * kept only as its hash. 404 outside the space.
 */
export async function spaceDetails(db, userId, spaceId, now = Date.now()) {
  const me = await assertAllowed(db, userId, spaceId, 'read');
  const g = memberGuard(spaceId, userId);
  const [members, invites, code] = await db.batch([
    db.prepare(`SELECT m.user_id, m.role, m.joined_at, u.username, ${NAME} AS name FROM members AS m JOIN users AS u ON u.id = m.user_id
      WHERE m.space_id = ? AND m.deleted_at IS NULL AND ${g.sql} ORDER BY m.joined_at, m.user_id`).bind(spaceId, ...g.binds),
    db.prepare(`SELECT i.user_id, i.role, i.status, i.created_at, i.expires_at, i.invited_by, u.username, ${NAME} AS name
      FROM invites AS i JOIN users AS u ON u.id = i.user_id
      WHERE i.space_id = ? AND i.status != 'accepted' AND ${g.sql} ORDER BY i.created_at DESC, i.user_id`).bind(spaceId, ...g.binds),
    db.prepare(`SELECT code_expires, code_uses_left FROM spaces WHERE id = ? AND code_hash IS NOT NULL AND ${g.sql}`).bind(spaceId, ...g.binds),
  ]);
  const c = code.results[0];
  return {
    id: spaceId, scope: scopeOf(me.kind, spaceId), kind: me.kind, role: me.role, archived: me.archived,
    members: members.results.map((m) => ({ userId: m.user_id, username: m.username, name: m.name, role: m.role, joinedAt: m.joined_at })),
    invites: me.role === 'member' ? [] : invites.results.map((i) => ({
      userId: i.user_id, username: i.username, name: i.name, role: i.role,
      status: i.status === 'pending' && i.expires_at <= now ? 'expired' : i.status,
      createdAt: i.created_at, expiresAt: i.expires_at, invitedBy: i.invited_by,
    })),
    code: me.role === 'owner' && c && c.code_expires > now && c.code_uses_left > 0 ? { expires: c.code_expires, usesLeft: c.code_uses_left } : null,
  };
}

/**
 * The owner makes a member an editor or a member (spec §5): never themselves, never the
 * owner (a transfer does that). Answers {userId, role}; 404 when they are not a live member.
 */
export async function setRole(db, userId, spaceId, targetId, role, now = Date.now()) {
  await assertOwner(db, userId, spaceId);
  if (targetId === userId) throw new HttpError(403, { error: 'forbidden' });
  const g = ownerGuard(spaceId, userId);
  await db.batch([
    db.prepare(`UPDATE members SET role = ?, updated_at = ?, revision = revision + 1
      WHERE space_id = ? AND user_id = ? AND deleted_at IS NULL AND role NOT IN ('owner', ?) AND ${g.sql}`)
      .bind(role, now, spaceId, targetId, role, ...g.binds),
    touchSpace(db, spaceId, now, { ifChanged: true }),
  ]);
  const row = await db.prepare('SELECT role FROM members WHERE space_id = ? AND user_id = ? AND deleted_at IS NULL').bind(spaceId, targetId).first();
  if (!row) throw new HttpError(404, { error: 'not_found' });
  if (row.role === 'owner') throw new HttpError(403, { error: 'forbidden' });
  return { userId: targetId, role: row.role };
}

/**
 * The owner hands the space to another live member (spec §13): the owner becomes an editor
 * before the other becomes the owner, since the one-owner index is checked statement by
 * statement; both in one batch. 404 when the other is not a live member.
 */
export async function transfer(db, userId, spaceId, targetId, now = Date.now()) {
  await assertOwner(db, userId, spaceId);
  if (targetId === userId) throw new HttpError(400, { error: 'invalid', field: 'userId' });
  const g = ownerGuard(spaceId, userId);
  const [demoted] = await db.batch([
    db.prepare(`UPDATE members SET role = 'editor', updated_at = ?, revision = revision + 1
      WHERE space_id = ? AND user_id = ? AND role = 'owner' AND deleted_at IS NULL AND ${g.sql}
        AND EXISTS (SELECT 1 FROM members AS t WHERE t.space_id = ? AND t.user_id = ? AND t.deleted_at IS NULL)`)
      .bind(now, spaceId, userId, ...g.binds, spaceId, targetId),
    db.prepare(`UPDATE members SET role = 'owner', updated_at = ?, revision = revision + 1
      WHERE space_id = ? AND user_id = ? AND deleted_at IS NULL AND changes() > 0`).bind(now, spaceId, targetId),
    touchSpace(db, spaceId, now, { ifChanged: true }),
  ]);
  if (!demoted.meta.changes) throw new HttpError(404, { error: 'not_found' });
}
```

- [ ] **Step 4: The routes**

In `worker/classes.js`, replace the line `import { ADMINS_ONLY, checkConvert, createClass } from './spaces.js';` with:

```js
import { ADMINS_ONLY, checkConvert, createClass, setRole, spaceDetails, transfer } from './spaces.js';
```

and replace the last line of the file, `];`, with:

```js
  ['GET', route(`spaces/${SID}`), async ({ request, env, params: [sid] }) => json(await spaceDetails(env.DB, await requireUser(request, env), sid))],
  ['PUT', route(`spaces/${SID}/members/${UID}`), async ({ request, env, params: [sid, uid] }) => {
    const userId = await requireUser(request, env);
    const { role } = await readJson(request);
    if (role !== 'editor' && role !== 'member') throw bad('role');
    return json(await setRole(env.DB, userId, sid, uid, role));
  }],
  ['POST', route(`spaces/${SID}/transfer`), async ({ request, env, params: [sid] }) => {
    const userId = await requireUser(request, env);
    await transfer(env.DB, userId, sid, idOf((await readJson(request)).userId, 'userId', 64));
    return done();
  }],
];
```

- [ ] **Step 5: Run the test**

Run: `npx vitest run test/members.test.js test/classes.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add worker/spaces.js worker/classes.js test/members.test.js
git commit -m "Classes: details for the Members tab, roles, handing a class on

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JpUR1JXMY3ehtkiJwuij95"
```

---

### Task 5: Invites by username: send, list, accept, decline, withdraw

**Files:**
- Create: `worker/invites.js`
- Modify: `worker/classes.js`
- Create: `test/invites.test.js`

- [ ] **Step 1: Write the failing test**

`test/invites.test.js`:

```js
import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { createUser, signIn } from './helpers.js';
import { makeSpace, post, signInAdmin, spaceRevision } from './spaces.js';

let owner, editor, member, guest, guest2, guest3, plain, s;
beforeAll(async () => {
  owner = await signInAdmin('iv-owner');
  editor = await signIn('iv-editor'); editor.id = 'u-iv-editor';
  member = await signIn('iv-member'); member.id = 'u-iv-member';
  guest = await signInAdmin('iv-guest');
  guest2 = await signInAdmin('iv-guest2');
  guest3 = await signInAdmin('iv-guest3');
  plain = await signIn('iv-plain');
  s = await makeSpace({ members: { [owner.id]: 'owner', [editor.id]: 'editor', [member.id]: 'member' } });
}, 60_000);

const invite = (api, username, role = null, space = s) => post(api, `/api/spaces/${space.id}/invites`, role ? { username, role } : { username });
const accept = (api, space = s) => post(api, `/api/invites/${space.id}/accept`);
const decline = (api, space = s) => post(api, `/api/invites/${space.id}/decline`);
const withdraw = (api, userId, space = s) => api(`/api/spaces/${space.id}/invites/${userId}`, { method: 'DELETE' });
const row = (space, userId) => env.DB.prepare('SELECT role, status, invited_by AS invitedBy FROM invites WHERE space_id = ? AND user_id = ?').bind(space.id, userId).first();

describe('invites', () => {
  it("go by username with the class's default role; only the owner gives another", async () => {
    const res = await invite(editor, 'IV-Guest');
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ userId: guest.id, username: 'iv-guest', name: 'iv-guest', role: 'member', status: 'pending', invitedBy: editor.id });
    expect(await (await invite(editor, 'iv-guest2', 'editor')).json()).toEqual({ error: 'forbidden' });
    expect(await (await invite(owner, 'iv-guest2', 'editor')).json()).toMatchObject({ userId: guest2.id, role: 'editor' });
    expect((await invite(member, 'iv-guest3')).status).toBe(403);
    expect((await invite(guest3, 'iv-guest')).status).toBe(404);
  });

  it('name what is wrong: no such account, already a member, not open to them yet, a bad body', async () => {
    const nobody = await invite(owner, 'nobody-here');
    expect(nobody.status).toBe(404);
    expect(await nobody.json()).toEqual({ error: 'no_user' });
    expect(await (await invite(owner, 'x')).json()).toEqual({ error: 'no_user' });
    expect(await (await invite(owner, 'iv-member')).json()).toEqual({ error: 'member' });
    expect(await (await invite(owner, 'iv-plain')).json()).toEqual({ error: 'not_admin' });
    expect(await (await post(owner, `/api/spaces/${s.id}/invites`, { username: 7 })).json()).toEqual({ error: 'invalid', field: 'username' });
    expect(await (await invite(owner, 'iv-guest3', 'owner')).json()).toEqual({ error: 'invalid', field: 'role' });
  });

  it('are listed to the one invited, with who sent them; a decline shows to the inviter; a repeat refreshes the one row', async () => {
    const mine = await (await guest('/api/invites')).json();
    expect(mine.invites).toEqual([expect.objectContaining({ spaceId: s.id, kind: 'class', name: 'Web Services', role: 'member', from: 'iv-editor', expired: false })]);
    expect((await decline(guest)).status).toBe(204);
    expect((await decline(guest)).status).toBe(404);
    expect((await (await guest('/api/invites')).json()).invites).toEqual([]);
    expect((await (await owner(`/api/spaces/${s.id}`)).json()).invites.find((i) => i.userId === guest.id)).toMatchObject({ status: 'declined' });
    expect((await invite(owner, 'iv-guest')).status).toBe(201);
    expect(await row(s, guest.id)).toEqual({ role: 'member', status: 'pending', invitedBy: owner.id });
    expect((await env.DB.prepare('SELECT count(*) AS n FROM invites WHERE space_id = ? AND user_id = ?').bind(s.id, guest.id).first()).n).toBe(1);
  });

  it('accepted make you a member with their role, move the space on, and sync loads the class from 0; again is the same', async () => {
    const before = await spaceRevision(s.id);
    const res = await accept(guest);
    expect(res.status).toBe(200);
    expect((await res.json()).space).toMatchObject({ id: s.id, scope: s.scope, name: 'Web Services', role: 'member', members: 4 });
    expect(await row(s, guest.id)).toMatchObject({ status: 'accepted' });
    expect(await spaceRevision(s.id)).toBeGreaterThan(before);
    const page = await (await guest('/api/sync?v=3&cursors=')).json();
    expect(page.scopes.map((x) => x.id)).toContain(s.id);
    expect(page.changes.filter((c) => c.scope === s.scope).map((c) => `${c.kind}:${c.row.id}`)).toEqual(['courses:web']);
    expect((await accept(guest)).status).toBe(200);
    expect((await env.DB.prepare('SELECT count(*) AS n FROM members WHERE space_id = ?').bind(s.id).first()).n).toBe(4);
    expect(await (await invite(owner, 'iv-guest')).json()).toEqual({ error: 'member' });
  });

  it('refuse to be accepted by a non-admin, when withdrawn or missing, expired, or the class is gone', async () => {
    expect(await (await accept(plain)).json()).toEqual({ error: 'forbidden' });
    expect((await accept(guest3)).status).toBe(404);
    /* expired: 410, shown as expired, and still pending */
    expect((await invite(owner, 'iv-guest3')).status).toBe(201);
    await env.DB.prepare('UPDATE invites SET created_at = 1, expires_at = 2 WHERE space_id = ? AND user_id = ?').bind(s.id, guest3.id).run();
    expect((await (await guest3('/api/invites')).json()).invites).toEqual([expect.objectContaining({ spaceId: s.id, expired: true })]);
    expect(await (await accept(guest3)).json()).toEqual({ error: 'expired' });
    expect((await accept(guest3)).status).toBe(410);
    expect(await row(s, guest3.id)).toMatchObject({ status: 'pending' });
    /* withdrawn: by the one who sent it, or the owner */
    expect((await invite(owner, 'iv-guest3')).status).toBe(201);
    expect(await (await withdraw(editor, guest3.id)).json()).toEqual({ error: 'forbidden' });
    expect((await withdraw(member, guest3.id)).status).toBe(403);
    expect((await withdraw(owner, guest3.id)).status).toBe(204);
    expect((await withdraw(owner, guest3.id)).status).toBe(404);
    expect((await accept(guest3)).status).toBe(404);
    expect((await invite(editor, 'iv-guest3')).status).toBe(201);
    expect((await withdraw(editor, guest3.id)).status).toBe(204);
    /* a class deleted before the invite was accepted */
    const t = await makeSpace({ members: { [owner.id]: 'owner' } });
    expect((await invite(owner, 'iv-guest3', null, t)).status).toBe(201);
    await env.DB.prepare('UPDATE spaces SET deleted_at = 5 WHERE id = ?').bind(t.id).run();
    expect((await accept(guest3, t)).status).toBe(404);
  });

  it('stop at 20 spaces (409 limit) and 30 members (409 full); the invite stays pending', async () => {
    const busy = await signInAdmin('iv-busy');
    for (let i = 0; i < 20; i++) await makeSpace({ members: { [busy.id]: 'member' } });
    expect((await invite(owner, 'iv-busy')).status).toBe(201);
    expect(await (await accept(busy)).json()).toEqual({ error: 'limit' });
    expect(await row(s, busy.id)).toMatchObject({ status: 'pending' });

    const crowd = { [owner.id]: 'owner' };
    for (let i = 0; i < 29; i++) crowd[await createUser(`iv-crowd-${i}`)] = 'member';
    const full = await makeSpace({ members: crowd });
    const late = await signInAdmin('iv-late');
    expect((await invite(owner, 'iv-late', null, full)).status).toBe(201);
    expect(await (await accept(late, full)).json()).toEqual({ error: 'full' });
    expect(await row(full, late.id)).toMatchObject({ status: 'pending' });
  });

  it('count 20 an hour per person sending them, unknown names too', async () => {
    const boss = await signInAdmin('iv-boss');
    const t = await makeSpace({ members: { [boss.id]: 'owner' } });
    for (let i = 0; i < 20; i++) expect((await invite(boss, `nobody-${i}`, null, t)).status).toBe(404);
    const res = await invite(boss, 'iv-guest', null, t);
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: 'rate_limited' });
  });
});
```

The owner sends about a dozen invites across the file, under its 20 an hour; the last case uses an inviter of its own.

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run test/invites.test.js`
Expected: FAIL: the invite routes answer `404 not_found` (no route).

- [ ] **Step 3: `worker/invites.js`**

Create `worker/invites.js`:

```js
// Invites by username (spec §11); join codes follow. An invite is one row per person and
// space, upserted, so a repeat refreshes it. Every statement that makes a membership carries
// the 20-spaces and 30-members limits inside itself (Stage 3 plan, Decision 12).
import { HttpError } from './http.js';
import { claimLimit, rateLimited } from './limits.js';
import { normalizeUsername } from './password.js';
import { assertAllowed, editorGuard, ownerGuard } from './access.js';
import { ADMINS_ONLY, LIVE_MEMBERS, MEMBER_LIMIT, MY_SPACES, SPACE_LIMIT, spaceSummary, touchSpace } from './spaces.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** Invites one person may send in an hour, and how long an invite stays open (spec §11). */
export const INVITE_LIMIT = 20;
export const INVITE_TTL_MS = 30 * DAY_MS;
const NAME = "COALESCE(NULLIF(u.display_name, ''), u.username)";
const SPACE_NAME = `CASE s.kind WHEN 'class' THEN (SELECT name FROM courses WHERE scope = 'c:' || s.id AND deleted_at IS NULL LIMIT 1)
  ELSE (SELECT title FROM items WHERE scope = 'p:' || s.id AND id = 'project') END`;

/* Make the membership, or revive one that was left (a rejoin); a live one is left as it is. */
const REVIVE = `ON CONFLICT (space_id, user_id) DO UPDATE SET role = excluded.role, joined_at = excluded.joined_at,
    updated_at = excluded.updated_at, deleted_at = NULL, revision = revision + 1 WHERE members.deleted_at IS NOT NULL`;
/* The person's pending invite to the space, marked accepted once they are a live member. */
const acceptedStmt = (db, spaceId, userId) => db.prepare(`UPDATE invites SET status = 'accepted'
    WHERE space_id = ? AND user_id = ? AND status = 'pending'
      AND EXISTS (SELECT 1 FROM members WHERE space_id = ? AND user_id = ? AND deleted_at IS NULL)`).bind(spaceId, userId, spaceId, userId);

/**
 * Invite someone by username: the owner or an editor, with the space's default role (a
 * class's is member, a project's editor); only the owner gives the other. 404 no_user for
 * a name with no account, 409 member for someone already in, 409 not_admin for someone who
 * cannot join yet (ADMINS_ONLY). 20 an hour per inviter, counted before the name is looked
 * up, so unknown names count too.
 */
export async function invite(db, userId, spaceId, { username, role = null }, now = Date.now()) {
  const me = await assertAllowed(db, userId, spaceId, 'editor');
  const standard = me.kind === 'class' ? 'member' : 'editor', give = role ?? standard, other = give !== standard;
  if (other && me.role !== 'owner') throw new HttpError(403, { error: 'forbidden' });
  const wait = await claimLimit(db, `invite:${userId}`, INVITE_LIMIT, now, HOUR_MS);
  if (wait) throw rateLimited(wait);
  const name = normalizeUsername(username);
  const who = name && await db.prepare(`SELECT u.id, u.username, u.is_admin, ${NAME} AS name,
      EXISTS (SELECT 1 FROM members WHERE space_id = ? AND user_id = u.id AND deleted_at IS NULL) AS member
    FROM users AS u WHERE u.username = ?`).bind(spaceId, name).first();
  if (!who) throw new HttpError(404, { error: 'no_user' });
  if (who.member) throw new HttpError(409, { error: 'member' });
  if (ADMINS_ONLY && who.is_admin !== 1) throw new HttpError(409, { error: 'not_admin' });
  const g = (other ? ownerGuard : editorGuard)(spaceId, userId), expires = now + INVITE_TTL_MS;
  const saved = await db.prepare(`INSERT INTO invites (space_id, user_id, invited_by, role, status, created_at, expires_at)
      SELECT ?, ?, ?, ?, 'pending', ?, ? WHERE ${g.sql}
        AND NOT EXISTS (SELECT 1 FROM members WHERE space_id = ? AND user_id = ? AND deleted_at IS NULL)
      ON CONFLICT (space_id, user_id) DO UPDATE SET invited_by = excluded.invited_by, role = excluded.role, status = 'pending',
        created_at = excluded.created_at, expires_at = excluded.expires_at
      RETURNING user_id`).bind(spaceId, who.id, userId, give, now, expires, ...g.binds, spaceId, who.id).first();
  if (!saved) {
    /* since the checks above: lost access, lost the owner's role, or they joined */
    const again = await assertAllowed(db, userId, spaceId, 'editor');
    throw other && again.role !== 'owner' ? new HttpError(403, { error: 'forbidden' }) : new HttpError(409, { error: 'member' });
  }
  return { userId: who.id, username: who.username, name: who.name, role: give, status: 'pending', createdAt: now, expiresAt: expires, invitedBy: userId };
}

/** Withdraw an invite not yet accepted: whoever sent it, or the owner. 403 for someone else's; 404 when there is none. */
export async function revokeInvite(db, userId, spaceId, targetId) {
  await assertAllowed(db, userId, spaceId, 'editor');
  const g = editorGuard(spaceId, userId);
  const gone = await db.prepare(`DELETE FROM invites WHERE space_id = ? AND user_id = ? AND status != 'accepted' AND ${g.sql}
      AND (invited_by = ? OR EXISTS (SELECT 1 FROM members WHERE space_id = ? AND user_id = ? AND role = 'owner' AND deleted_at IS NULL))
    RETURNING user_id`).bind(spaceId, targetId, ...g.binds, userId, spaceId, userId).first();
  if (gone) return;
  const there = await db.prepare("SELECT 1 AS x FROM invites WHERE space_id = ? AND user_id = ? AND status != 'accepted'").bind(spaceId, targetId).first();
  throw there ? new HttpError(403, { error: 'forbidden' }) : new HttpError(404, { error: 'not_found' });
}

/** Your invites not yet answered, newest first: the space's name, who sent it, and whether it has expired. */
export async function myInvites(db, userId, now = Date.now()) {
  const { results } = await db.prepare(`SELECT i.space_id, i.role, i.created_at, i.expires_at, s.kind, ${NAME} AS sender, ${SPACE_NAME} AS name
    FROM invites AS i JOIN spaces AS s ON s.id = i.space_id AND s.deleted_at IS NULL LEFT JOIN users AS u ON u.id = i.invited_by
    WHERE i.user_id = ? AND i.status = 'pending' ORDER BY i.created_at DESC LIMIT 50`).bind(userId).all();
  return results.map((r) => ({
    spaceId: r.space_id, kind: r.kind, name: r.name ?? '', role: r.role, from: r.sender ?? 'A former member',
    createdAt: r.created_at, expiresAt: r.expires_at, expired: r.expires_at <= now,
  }));
}

/** Decline an invite to you; the owner and editors see it as declined. 404 when none is pending. */
export async function declineInvite(db, userId, spaceId) {
  const r = await db.prepare("UPDATE invites SET status = 'declined' WHERE space_id = ? AND user_id = ? AND status = 'pending' RETURNING user_id")
    .bind(spaceId, userId).first();
  if (!r) throw new HttpError(404, { error: 'not_found' });
}

/**
 * Accept an invite (spec §11), in one batch: the membership with the invite's role (made, or
 * revived after leaving), the space's revision moved on, the invite marked accepted; the
 * next sync pages the class from 0. A class you are in already answers as it is. 404 with no
 * pending invite (withdrawn, declined, never sent, or the class deleted), 410 expired,
 * 409 limit or full; the invite stays pending after a 409 or 410.
 */
export async function acceptInvite(db, userId, spaceId, now = Date.now()) {
  const [joined] = await db.batch([
    db.prepare(`INSERT INTO members (space_id, user_id, role, joined_at, updated_at)
      SELECT i.space_id, i.user_id, i.role, ?, ? FROM invites AS i JOIN spaces AS s ON s.id = i.space_id
      WHERE i.space_id = ? AND i.user_id = ? AND i.status = 'pending' AND i.expires_at > ? AND s.deleted_at IS NULL
        AND ${MY_SPACES} < ? AND ${LIVE_MEMBERS('i.space_id')} < ?
      ${REVIVE}`).bind(now, now, spaceId, userId, now, userId, SPACE_LIMIT, MEMBER_LIMIT),
    touchSpace(db, spaceId, now, { ifChanged: true }),
    acceptedStmt(db, spaceId, userId),
  ]);
  const held = await spaceSummary(db, userId, spaceId);
  if (joined.meta.changes || held) return held;
  const why = await db.prepare(`SELECT i.status, i.expires_at, ${MY_SPACES} AS mine, ${LIVE_MEMBERS('i.space_id')} AS n
    FROM invites AS i JOIN spaces AS s ON s.id = i.space_id AND s.deleted_at IS NULL WHERE i.space_id = ? AND i.user_id = ?`)
    .bind(userId, spaceId, userId).first();
  if (!why || why.status !== 'pending') throw new HttpError(404, { error: 'not_found' });
  if (why.expires_at <= now) throw new HttpError(410, { error: 'expired' });
  if (why.mine >= SPACE_LIMIT) throw new HttpError(409, { error: 'limit' });
  if (why.n >= MEMBER_LIMIT) throw new HttpError(409, { error: 'full' });
  throw new HttpError(409, { error: 'conflict' });
}
```

- [ ] **Step 4: The routes**

In `worker/classes.js`, after the line `import { ADMINS_ONLY, checkConvert, createClass, setRole, spaceDetails, transfer } from './spaces.js';` add:

```js
import { acceptInvite, declineInvite, invite, myInvites, revokeInvite } from './invites.js';
```

and replace the last line of the file, `];`, with:

```js
  ['POST', route(`spaces/${SID}/invites`), async ({ request, env, params: [sid] }) => {
    const userId = await requireUser(request, env);
    const body = await readJson(request);
    if (typeof body.username !== 'string') throw bad('username');
    if (body.role != null && body.role !== 'editor' && body.role !== 'member') throw bad('role');
    return json(await invite(env.DB, userId, sid, { username: body.username, role: body.role ?? null }), 201);
  }],
  ['DELETE', route(`spaces/${SID}/invites/${UID}`), async ({ request, env, params: [sid, uid] }) => {
    await revokeInvite(env.DB, await requireUser(request, env), sid, uid);
    return done();
  }],
  ['GET', route('invites'), async ({ request, env }) => json({ invites: await myInvites(env.DB, await requireUser(request, env)) })],
  ['POST', route(`invites/${SID}/accept`), async ({ request, env, params: [sid] }) =>
    json({ space: await acceptInvite(env.DB, await joiner(request, env), sid) })],
  ['POST', route(`invites/${SID}/decline`), async ({ request, env, params: [sid] }) => {
    await declineInvite(env.DB, await requireUser(request, env), sid);
    return done();
  }],
];
```

- [ ] **Step 5: Run the test**

Run: `npx vitest run test/invites.test.js test/members.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add worker/invites.js worker/classes.js test/invites.test.js
git commit -m "Invites: by username, listed, accepted (admins only), declined, withdrawn; limits in the statement

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JpUR1JXMY3ehtkiJwuij95"
```

---

### Task 6: Join codes and `/api/join`

**Files:**
- Modify: `worker/invites.js` (append; imports)
- Modify: `worker/classes.js`
- Create: `test/join-code.test.js`

- [ ] **Step 1: Write the failing test**

`test/join-code.test.js`:

```js
import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { createUser, signIn } from './helpers.js';
import { makeSpace, post, signInAdmin } from './spaces.js';
import { hashCode, newCode } from '../worker/invites.js';

const WEEK_MS = 7 * 24 * 3600 * 1000;
let owner, editor, member, joiner1, joiner2, plain, s;
beforeAll(async () => {
  owner = await signInAdmin('jc-owner');
  editor = await signIn('jc-editor'); editor.id = 'u-jc-editor';
  member = await signIn('jc-member'); member.id = 'u-jc-member';
  joiner1 = await signInAdmin('jc-joiner1');
  joiner2 = await signInAdmin('jc-joiner2');
  plain = await signIn('jc-plain');
  s = await makeSpace({ members: { [owner.id]: 'owner', [editor.id]: 'editor', [member.id]: 'member' } });
}, 60_000);

const makeCode = (api, space = s) => post(api, `/api/spaces/${space.id}/code`);
const join = (api, code) => post(api, '/api/join', { code });
const usesLeft = async (space = s) => (await env.DB.prepare('SELECT code_uses_left AS n FROM spaces WHERE id = ?').bind(space.id).first()).n;

describe('join codes', () => {
  it('are 8 Crockford characters from 40 random bits, kept as their SHA-256', async () => {
    const codes = new Set(Array.from({ length: 100 }, newCode));
    expect(codes.size).toBe(100);
    for (const c of codes) expect(c).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
    expect(await hashCode('7KQ2M9XD')).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashCode('7KQ2M9XD')).not.toBe(await hashCode('7KQ2M9XE'));
  });

  it('are made by the owner only, stored only as the hash, for 7 days and 10 uses', async () => {
    expect((await makeCode(editor)).status).toBe(403);
    expect((await makeCode(member)).status).toBe(403);
    expect((await makeCode(joiner1)).status).toBe(404);
    const before = Date.now();
    const res = await makeCode(owner);
    expect(res.status).toBe(201);
    const made = await res.json();
    expect(made.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
    expect(made.usesLeft).toBe(10);
    expect(made.expires - before).toBeGreaterThanOrEqual(WEEK_MS);
    expect(made.expires - before).toBeLessThan(WEEK_MS + 60_000);
    const stored = await env.DB.prepare('SELECT code_hash, code_expires, code_uses_left FROM spaces WHERE id = ?').bind(s.id).first();
    expect(stored).toEqual({ code_hash: await hashCode(made.code), code_expires: made.expires, code_uses_left: 10 });
    expect((await (await owner(`/api/spaces/${s.id}`)).json()).code).toEqual({ expires: made.expires, usesLeft: 10 });
  });

  it('let an admin join as the code is typed, as a member, once; a new code retires the old', async () => {
    const old = (await (await makeCode(owner)).json()).code;
    const { code } = await (await makeCode(owner)).json();
    expect((await join(joiner1, old)).status).toBe(404);
    const typed = (code.slice(0, 4) + ' ' + code.slice(4)).toLowerCase();
    const res = await join(joiner1, typed);
    expect(res.status).toBe(200);
    expect((await res.json()).space).toMatchObject({ id: s.id, role: 'member', name: 'Web Services', members: 4 });
    expect(await usesLeft()).toBe(9);
    expect((await join(joiner1, code)).status).toBe(200);
    expect(await usesLeft()).toBe(9);
    const page = await (await joiner1('/api/sync?v=3&cursors=')).json();
    expect(page.scopes.map((x) => x.id)).toContain(s.id);
  });

  it('take a pending invite with its role, and mark it accepted', async () => {
    expect((await post(owner, `/api/spaces/${s.id}/invites`, { username: 'jc-joiner2', role: 'editor' })).status).toBe(201);
    const { code } = await (await makeCode(owner)).json();
    expect((await (await join(joiner2, code)).json()).space).toMatchObject({ role: 'editor' });
    expect(await env.DB.prepare('SELECT status FROM invites WHERE space_id = ? AND user_id = ?').bind(s.id, joiner2.id).first()).toEqual({ status: 'accepted' });
  });

  it('refuse: not an admin 403, malformed 400, unknown 404, expired or used up 410', async () => {
    const t = await makeSpace({ members: { [owner.id]: 'owner' } });
    const { code } = await (await makeCode(owner, t)).json();
    const late = await signInAdmin('jc-late');
    expect(await (await join(plain, code)).json()).toEqual({ error: 'forbidden' });
    expect(await (await join(late, 'ABC')).json()).toEqual({ error: 'invalid', field: 'code' });
    expect(await (await join(late, 12345678)).json()).toEqual({ error: 'invalid', field: 'code' });
    expect(await (await join(late, 'ZZZZZZZZ')).json()).toEqual({ error: 'not_found' });
    await env.DB.prepare('UPDATE spaces SET code_expires = 1 WHERE id = ?').bind(t.id).run();
    expect(await (await join(late, code)).json()).toEqual({ error: 'expired' });
    await env.DB.prepare('UPDATE spaces SET code_expires = ?, code_uses_left = 0 WHERE id = ?').bind(Date.now() + 1e9, t.id).run();
    expect((await join(late, code)).status).toBe(410);
    expect((await env.DB.prepare('SELECT count(*) AS n FROM members WHERE space_id = ?').bind(t.id).first()).n).toBe(1);
  });

  it('stop at 30 members (409 full) and at 20 spaces (409 limit), using nothing', async () => {
    const crowd = { [owner.id]: 'owner' };
    for (let i = 0; i < 29; i++) crowd[await createUser(`jc-crowd-${i}`)] = 'member';
    const full = await makeSpace({ members: crowd });
    const { code } = await (await makeCode(owner, full)).json();
    const busy = await signInAdmin('jc-busy');
    expect(await (await join(busy, code)).json()).toEqual({ error: 'full' });
    expect(await usesLeft(full)).toBe(10);
    const room = await makeSpace({ members: { [owner.id]: 'owner' } });
    const second = (await (await makeCode(owner, room)).json()).code;
    for (let i = 0; i < 20; i++) await makeSpace({ members: { [busy.id]: 'member' } });
    expect(await (await join(busy, second)).json()).toEqual({ error: 'limit' });
    expect(await usesLeft(room)).toBe(10);
  });

  it('count ten tries an hour per person', async () => {
    const tries = await signInAdmin('jc-tries');
    for (let i = 0; i < 10; i++) expect((await join(tries, 'ZZZZZZZZ')).status).toBe(404);
    const res = await join(tries, 'ZZZZZZZZ');
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: 'rate_limited' });
  });

  it('can be turned off by the owner', async () => {
    const t = await makeSpace({ members: { [owner.id]: 'owner', [editor.id]: 'editor' } });
    const { code } = await (await makeCode(owner, t)).json();
    expect((await editor(`/api/spaces/${t.id}/code`, { method: 'DELETE' })).status).toBe(403);
    expect((await owner(`/api/spaces/${t.id}/code`, { method: 'DELETE' })).status).toBe(204);
    expect((await (await owner(`/api/spaces/${t.id}`)).json()).code).toBeNull();
    const late2 = await signInAdmin('jc-late2');
    expect((await join(late2, code)).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run test/join-code.test.js`
Expected: FAIL: `newCode` is not exported by `worker/invites.js`.

- [ ] **Step 3: Codes and joining (`worker/invites.js`)**

In `worker/invites.js`, replace

```js
import { assertAllowed, editorGuard, ownerGuard } from './access.js';
import { ADMINS_ONLY, LIVE_MEMBERS, MEMBER_LIMIT, MY_SPACES, SPACE_LIMIT, spaceSummary, touchSpace } from './spaces.js';
```

with

```js
import { hex } from './auth.js';
import { assertAllowed, assertOwner, editorGuard, ownerGuard } from './access.js';
import { ADMINS_ONLY, LIVE_MEMBERS, MEMBER_LIMIT, MY_SPACES, NEXT_SPACE_REVISION, SPACE_LIMIT, spaceSummary, touchSpace } from './spaces.js';
import { normalizeCode } from '../src/core/shared.ts';
```

and append:

```js

// ── join codes ──────────────────────────────────────────────────────────────

/** Join attempts one person may make in an hour; a code's life and its uses (spec §11). */
export const JOIN_LIMIT = 10;
export const CODE_TTL_MS = 7 * DAY_MS;
export const CODE_USES = 10;
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A new code: 8 Crockford base32 characters from 5 random bytes (40 bits). */
export function newCode() {
  let n = 0;
  for (const b of crypto.getRandomValues(new Uint8Array(5))) n = n * 256 + b;
  let out = '';
  for (let i = 0; i < 8; i++) { out = CROCKFORD[n % 32] + out; n = Math.floor(n / 32); }
  return out;
}

/** What is stored of a code: its SHA-256, in hex. */
export const hashCode = async (code) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code)));

/** The owner makes a join code, retiring the one before: {code, expires, usesLeft}. Only its hash is kept, so the code is shown now and never again. */
export async function makeCode(db, userId, spaceId, now = Date.now()) {
  await assertOwner(db, userId, spaceId);
  const code = newCode(), expires = now + CODE_TTL_MS, g = ownerGuard(spaceId, userId);
  const r = await db.prepare(`UPDATE spaces SET code_hash = ?, code_expires = ?, code_uses_left = ?, updated_at = ?, revision = ${NEXT_SPACE_REVISION}
    WHERE id = ? AND ${g.sql} RETURNING id`).bind(await hashCode(code), expires, CODE_USES, now, spaceId, ...g.binds).first();
  if (!r) throw new HttpError(404, { error: 'not_found' });
  return { code, expires, usesLeft: CODE_USES };
}

/** The owner turns the join code off. */
export async function dropCode(db, userId, spaceId, now = Date.now()) {
  await assertOwner(db, userId, spaceId);
  const g = ownerGuard(spaceId, userId);
  await db.prepare(`UPDATE spaces SET code_hash = NULL, code_expires = NULL, code_uses_left = NULL, updated_at = ?, revision = ${NEXT_SPACE_REVISION}
    WHERE id = ? AND ${g.sql}`).bind(now, spaceId, ...g.binds).run();
}

/**
 * Join with a code (spec §11), in one batch: the membership (with a pending invite's role,
 * else the space's default), one use fewer and the space's revision moved on, the invite
 * marked accepted. A space you are in already answers at once and uses nothing. Ten tries
 * an hour, counted first; 400 malformed, 404 unknown, 410 expired or used up, 409 limit or full.
 */
export async function joinByCode(db, userId, raw, now = Date.now()) {
  const wait = await claimLimit(db, `join:${userId}`, JOIN_LIMIT, now, HOUR_MS);
  if (wait) throw rateLimited(wait);
  const code = normalizeCode(raw);
  if (!code) throw new HttpError(400, { error: 'invalid', field: 'code' });
  const hash = await hashCode(code);
  const space = await db.prepare('SELECT id, kind, code_expires, code_uses_left FROM spaces WHERE code_hash = ? AND deleted_at IS NULL').bind(hash).first();
  if (!space) throw new HttpError(404, { error: 'not_found' });
  const held = await spaceSummary(db, userId, space.id);
  if (held) return held;
  if (space.code_expires <= now || space.code_uses_left <= 0) throw new HttpError(410, { error: 'expired' });
  const standard = space.kind === 'class' ? 'member' : 'editor';
  const [joined] = await db.batch([
    db.prepare(`INSERT INTO members (space_id, user_id, role, joined_at, updated_at)
      SELECT s.id, ?, COALESCE((SELECT i.role FROM invites AS i WHERE i.space_id = s.id AND i.user_id = ? AND i.status = 'pending' AND i.expires_at > ?), ?), ?, ?
      FROM spaces AS s WHERE s.id = ? AND s.code_hash = ? AND s.code_expires > ? AND s.code_uses_left > 0 AND s.deleted_at IS NULL
        AND ${MY_SPACES} < ? AND ${LIVE_MEMBERS('s.id')} < ?
      ${REVIVE}`).bind(userId, userId, now, standard, now, now, space.id, hash, now, userId, SPACE_LIMIT, MEMBER_LIMIT),
    db.prepare(`UPDATE spaces SET code_uses_left = code_uses_left - 1, updated_at = ?, revision = ${NEXT_SPACE_REVISION} WHERE id = ? AND changes() > 0`)
      .bind(now, space.id),
    acceptedStmt(db, space.id, userId),
  ]);
  if (joined.meta.changes) return spaceSummary(db, userId, space.id);
  const why = await db.prepare(`SELECT ${MY_SPACES} AS mine, ${LIVE_MEMBERS('?')} AS n`).bind(userId, space.id).first();
  if (why.mine >= SPACE_LIMIT) throw new HttpError(409, { error: 'limit' });
  if (why.n >= MEMBER_LIMIT) throw new HttpError(409, { error: 'full' });
  throw new HttpError(410, { error: 'expired' });
}
```

- [ ] **Step 4: The routes**

In `worker/classes.js`, replace the line `import { acceptInvite, declineInvite, invite, myInvites, revokeInvite } from './invites.js';` with:

```js
import { acceptInvite, declineInvite, dropCode, invite, joinByCode, makeCode, myInvites, revokeInvite } from './invites.js';
```

and replace the last line of the file, `];`, with:

```js
  ['POST', route(`spaces/${SID}/code`), async ({ request, env, params: [sid] }) => json(await makeCode(env.DB, await requireUser(request, env), sid), 201)],
  ['DELETE', route(`spaces/${SID}/code`), async ({ request, env, params: [sid] }) => {
    await dropCode(env.DB, await requireUser(request, env), sid);
    return done();
  }],
  ['POST', route('join'), async ({ request, env }) => {
    const userId = await joiner(request, env);
    return json({ space: await joinByCode(env.DB, userId, (await readJson(request)).code) });
  }],
];
```

- [ ] **Step 5: Run the test and the Worker suite**

Run: `npx vitest run test/join-code.test.js`, then `npm run test:api`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add worker/invites.js worker/classes.js test/join-code.test.js
git commit -m "Join codes: made by the owner, hashed, 7 days and 10 uses; /api/join (admins only, 10 tries an hour)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JpUR1JXMY3ehtkiJwuij95"
```

---

### Task 7: Deleting an account that owns a class

**Files:**
- Modify: `worker/admin.js`
- Modify: `src/components/admin/use-admin.ts`
- Modify: `test/admin.test.js`

- [ ] **Step 1: Write the failing test**

In `test/admin.test.js`, after the test `'deletes an account and its data, only with the name typed'`, add:

```js
  it('will not delete an account that owns a shared class; its memberships and limits go with it otherwise', async () => {
    const admin = await signInAdmin('boss9');
    const id = await createUser('owner9');
    await env.DB.batch([
      env.DB.prepare("INSERT INTO spaces (id, kind, created_at, updated_at) VALUES ('ownsclass001', 'class', 1, 1)"),
      env.DB.prepare("INSERT INTO members (space_id, user_id, role, joined_at, updated_at) VALUES ('ownsclass001', ?, 'owner', 1, 1)").bind(id),
      env.DB.prepare("INSERT INTO request_limits (key, hits, reset_at) VALUES ('invite:' || ?1, 1, 9e15), ('join:' || ?1, 1, 9e15)").bind(id),
    ]);
    const res = await admin('/api/admin/accounts/u-owner9', { method: 'DELETE', body: { confirm: 'owner9' } });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'owns_space' });
    await env.DB.prepare("UPDATE members SET role = 'editor' WHERE space_id = 'ownsclass001'").run();
    expect((await admin('/api/admin/accounts/u-owner9', { method: 'DELETE', body: { confirm: 'owner9' } })).status).toBe(204);
    expect(await env.DB.prepare('SELECT count(*) AS n FROM members WHERE user_id = ?').bind(id).first()).toEqual({ n: 0 });
    expect(await env.DB.prepare("SELECT count(*) AS n FROM request_limits WHERE key IN ('invite:' || ?1, 'join:' || ?1)").bind(id).first()).toEqual({ n: 0 });
  });
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run test/admin.test.js`
Expected: FAIL: the first delete answers `204`, not `409`.

- [ ] **Step 3: Refuse it, and clear the class limits**

In `worker/admin.js`, in the `DELETE` account route, after

```js
    if (user.is_admin === 1) {
      const { n } = await db.prepare('SELECT count(*) AS n FROM users WHERE is_admin = 1').first();
      if (n <= 1) throw new HttpError(409, { error: 'last_admin' });
    }
```

add

```js
    /* Stage 5 hands an owner's spaces on before deleting the account; until then it is refused. */
    const owns = await db.prepare(`SELECT 1 AS x FROM members AS m JOIN spaces AS s ON s.id = m.space_id
      WHERE m.user_id = ? AND m.role = 'owner' AND m.deleted_at IS NULL AND s.deleted_at IS NULL LIMIT 1`).bind(id).first();
    if (owns) throw new HttpError(409, { error: 'owns_space' });
```

and replace

```js
      db.prepare("DELETE FROM request_limits WHERE key IN ('api:' || ?1, 'spotify:' || ?1, 'outline:' || ?1)").bind(id),
```

with

```js
      db.prepare("DELETE FROM request_limits WHERE key IN ('api:' || ?1, 'spotify:' || ?1, 'outline:' || ?1, 'invite:' || ?1, 'join:' || ?1)").bind(id),
```

In `src/components/admin/use-admin.ts`, in `WORDS`, after the line `    last_admin: "There has to be at least one admin.",` add:

```ts
    owns_space: "This account owns a shared class. Make someone else its owner first.",
```

- [ ] **Step 4: Run it**

Run: `npx vitest run test/admin.test.js`, then `npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add worker/admin.js src/components/admin/use-admin.ts test/admin.test.js
git commit -m "Admin: an account that owns a class is not deleted until Stage 5 hands it on

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JpUR1JXMY3ehtkiJwuij95"
```

---

### Task 8: The client: the class calls, the sheet kinds, `src/data/classes.ts`

**Files:**
- Modify: `src/core/types.ts`, `src/core/api.ts`
- Modify: `src/data/overlay.ts`, `src/data/store.ts`
- Modify: `src/components/sheet/sheet.tsx` (the labels only; the sheets come in Tasks 9–11)
- Create: `src/data/classes.ts`, `src/data/classes.test.ts`
- Modify: `test/api-client.test.js`

- [ ] **Step 1: Write the failing tests**

`src/data/classes.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// The class rules and calls, with the store, the API, sync, the sheet and the toast as fakes.
const fake = vi.hoisted(() => ({
    data: {
        profile: { id: "u-me", isAdmin: true } as Record<string, unknown> | null,
        courses: [] as { color: string }[],
        spaces: [] as { id: string }[],
        shared_courses: [] as { scope: string; id: string }[],
    },
    api: { invites: { list: vi.fn(), accept: vi.fn(), decline: vi.fn() }, spaces: { create: vi.fn() }, join: vi.fn() },
    syncNow: vi.fn(async () => true),
    openSheet: vi.fn(),
    toast: vi.fn(),
}))
vi.mock("@/core/store", () => ({ data: fake.data }))
vi.mock("@/core/api", () => {
    class ApiError extends Error {
        status: number
        body: Record<string, unknown> | null
        constructor(status: number, body: Record<string, unknown> | null) { super(String(body?.error ?? status)); this.status = status; this.body = body }
    }
    return { api: fake.api, ApiError }
})
vi.mock("@/core/sync", () => ({ syncNow: fake.syncNow }))
vi.mock("./overlay", () => ({ openSheet: fake.openSheet }))
vi.mock("./toast", () => ({ toast: fake.toast }))

import { ApiError } from "@/core/api"
import {
    accept, classFrom, convert, convertChoice, decline, download, formatCode, freeColour, getInvites, joinLink, joinWithCode, makeBlank, messageFor, refreshInvites,
} from "./classes"

const SID = "sp0000000001"
const summary = { id: SID, scope: "c:" + SID, kind: "class", name: "Databases", role: "owner", members: 1 }
const arrive = () => { fake.data.spaces = [{ id: SID }]; fake.data.shared_courses = [{ scope: "c:" + SID, id: "db" }] }

beforeEach(() => {
    fake.data.profile = { id: "u-me", isAdmin: true }
    fake.data.courses = []
    fake.data.spaces = []
    fake.data.shared_courses = []
    fake.syncNow.mockImplementation(async () => true)
})
afterEach(() => { vi.clearAllMocks() })

describe("which items a class can take", () => {
    it("ticks all but tasks; lecture reviews and your own types stay yours", () => {
        expect(convertChoice({ id: "a1", type: "assignment" })).toEqual({ can: true, ticked: true, why: "" })
        expect(convertChoice({ id: "t1", type: "task" })).toEqual({ can: true, ticked: false, why: "" })
        expect(convertChoice({ id: "rvab12cd31", type: "task" })).toEqual({ can: false, ticked: false, why: "A lecture review: stays yours" })
        expect(convertChoice({ id: "c1", type: "c-viva" })).toEqual({ can: false, ticked: false, why: "Your own type: stays yours" })
    })
})

describe("words and small rules", () => {
    it("show a code in two halves, and its link", () => {
        expect(formatCode("7KQ2M9XD")).toBe("7KQ2 M9XD")
        expect(joinLink("7KQ2M9XD")).toBe(location.origin + "/#join=7KQ2M9XD")
    })

    it("pick the first colour none of your courses uses", () => {
        expect(freeColour([{ color: "#E4749B" }, { color: "#17B3AE" }])).toBe("#8B5CC7")
    })

    it("find the class you made from a course", () => {
        const s = { id: SID, scope: "c:" + SID, kind: "class", role: "owner" }
        const shared = [{ scope: "c:" + SID, id: "db" }]
        expect(classFrom("db", [s] as never, shared)).toBe(s)
        expect(classFrom("db", [{ ...s, role: "member" }] as never, shared)).toBeNull()
        expect(classFrom("other", [s] as never, shared)).toBeNull()
    })

    it("say what went wrong in words", () => {
        expect(messageFor(new ApiError(404, { error: "no_user" }), "gabriel")).toBe("No Term account named 'gabriel'.")
        expect(messageFor(new ApiError(409, { error: "member" }), "sam")).toBe("sam is already a member.")
        expect(messageFor(new ApiError(409, { error: "limit" }))).toMatch(/20 classes/)
        expect(messageFor(new ApiError(410, { error: "expired" }))).toBe("That has expired. Ask for a new code or invite.")
        expect(messageFor(new ApiError(400, { error: "invalid", field: "code" }))).toBe("A code is 8 characters.")
        expect(messageFor(new ApiError(429, { error: "rate_limited" }))).toBe("Too many tries. Wait a while, then try again.")
        expect(messageFor(new TypeError("Failed to fetch"))).toBe("You seem to be offline. This needs a connection.")
    })
})

describe("your invites", () => {
    it("are fetched for admins only, and the last list stays when a fetch fails", async () => {
        fake.api.invites.list.mockResolvedValueOnce({ invites: [{ spaceId: SID, name: "Databases" }] })
        await refreshInvites()
        expect(getInvites()).toEqual([{ spaceId: SID, name: "Databases" }])
        fake.api.invites.list.mockRejectedValueOnce(new TypeError("offline"))
        await refreshInvites()
        expect(getInvites()).toHaveLength(1)
        fake.data.profile = { id: "u-me" }
        await refreshInvites()
        expect(fake.api.invites.list).toHaveBeenCalledTimes(2)
    })

    it("leave the list once answered", async () => {
        fake.api.invites.list.mockResolvedValueOnce({ invites: [{ spaceId: SID }, { spaceId: "sp0000000002" }, { spaceId: "sp0000000003" }] })
        await refreshInvites()
        fake.api.invites.accept.mockResolvedValueOnce(summary)
        expect(await accept(SID)).toEqual(summary)
        await decline("sp0000000002")
        fake.api.join.mockResolvedValueOnce({ ...summary, id: "sp0000000003" })
        await joinWithCode("7KQ2M9XD")
        expect(getInvites()).toEqual([])
    })
})

describe("a class arriving", () => {
    it("syncs until the class and its course are here, a few times at most", async () => {
        let n = 0
        fake.syncNow.mockImplementation(async () => { if (++n === 2) arrive(); return true })
        expect(await download(SID)).toBe(true)
        expect(fake.syncNow).toHaveBeenCalledTimes(2)
        fake.data.spaces = []
        fake.syncNow.mockImplementation(async () => false)
        expect(await download(SID)).toBe(false)
        expect(fake.syncNow).toHaveBeenCalledTimes(6)
    })

    it("makes a blank class with a free colour, or one from a course, then opens its Members", async () => {
        fake.data.courses = [{ color: "#E4749B" }]
        fake.api.spaces.create.mockResolvedValue(summary)
        fake.syncNow.mockImplementation(async () => { arrive(); return true })
        await makeBlank("Operating Systems", "OS")
        expect(fake.api.spaces.create).toHaveBeenLastCalledWith({ kind: "class", course: { code: "OS", name: "Operating Systems", color: "#8B5CC7", instructor: "", term: "", meetings: [] } })
        expect(fake.openSheet).toHaveBeenLastCalledWith({ kind: "class", spaceId: SID, tab: "members" })
        await convert("db", ["a1"])
        expect(fake.api.spaces.create).toHaveBeenLastCalledWith({ kind: "class", convertCourseId: "db", items: ["a1"] })
        expect(fake.toast).toHaveBeenCalledWith("Databases is now a shared class too. Your own course stays as it is.")
    })
})
```

Append to `test/api-client.test.js`:

```js
describe('the class routes, as the client reads them', () => {
  it('checks the space they answer with', async () => {
    respond({ space: { id: 'short', scope: 'c:short' } });
    await expect(client.api.join('7KQ2M9XD')).rejects.toMatchObject({ status: 502 });
    respond({ space: { id: 'abcdefghij12', scope: 'p:abcdefghij12', kind: 'class' } });
    await expect(client.api.invites.accept('abcdefghij12')).rejects.toMatchObject({ status: 502 });
    const space = { id: 'abcdefghij12', scope: 'c:abcdefghij12', kind: 'class', name: 'Web', role: 'member', members: 2 };
    respond({ space });
    expect(await client.api.join('7KQ2M9XD')).toEqual(space);
    respond(null, 204);
    expect(await client.api.invites.decline('abcdefghij12')).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run src/data/classes.test.ts test/api-client.test.js`
Expected: FAIL: `./classes` does not exist; `client.api.join` is not a function.

- [ ] **Step 3: The shapes**

Append to `src/core/types.ts`:

```ts

/** A space as the class routes answer it: enough to download and open it. */
export interface SpaceSummary { id: string; scope: string; kind: "class" | "project"; name: string; role: "owner" | "editor" | "member"; members: number }
export interface SpaceMember { userId: string; username: string; name: string; role: "owner" | "editor" | "member"; joinedAt: number }
export interface SpaceInvite {
    userId: string; username: string; name: string; role: "editor" | "member"
    status: "pending" | "declined" | "expired"; createdAt: number; expiresAt: number; invitedBy: string | null
}
/** A space for its Members tab (GET /api/spaces/:sid): invites for owner and editors, the code's status for the owner. */
export interface SpaceDetails {
    id: string; scope: string; kind: "class" | "project"; role: "owner" | "editor" | "member"; archived: boolean
    members: SpaceMember[]; invites: SpaceInvite[]; code: { expires: number; usesLeft: number } | null
}
/** A join code just made: shown now and never again (only its hash is kept). */
export interface JoinCode { code: string; expires: number; usesLeft: number }
/** An invite to you (GET /api/invites). */
export interface Invite {
    spaceId: string; kind: "class" | "project"; name: string; role: "editor" | "member"; from: string
    createdAt: number; expiresAt: number; expired: boolean
}
```

- [ ] **Step 4: The calls (`src/core/api.ts`)**

Replace `import type { Space } from './types.ts';` with:

```ts
import type { Invite, JoinCode, Space, SpaceDetails, SpaceInvite, SpaceSummary } from './types.ts';
```

After the line

```ts
const sharedPath = (scope: string, kind: string, id: string) => `/api/spaces/${scope.slice(2)}/${kind}/${encodeURIComponent(id)}`;
```

add:

```ts
/* The class routes answer a space as {space}: its id is the Worker's and its scope matches its kind. */
async function spaceOf(response: Promise<unknown>): Promise<SpaceSummary> {
  const space = (await response as { space?: SpaceSummary } | null)?.space;
  if (!space || typeof space.id !== 'string' || !/^[a-z0-9]{12}$/.test(space.id) || space.scope !== `${space.kind === 'project' ? 'p' : 'c'}:${space.id}`) throw invalidResponse();
  return space;
}
```

In the `api` object, after the `shared: { … },` entry, add:

```ts
  /* shared classes (admins only until Stage 6); `sid` is a space id */
  spaces: {
    create: (body: { kind: 'class'; course?: Record<string, unknown>; convertCourseId?: string; items?: string[] }) => spaceOf(request('POST', '/api/spaces', body)),
    get: (sid: string): Promise<SpaceDetails> => request('GET', `/api/spaces/${sid}`),
    invite: (sid: string, username: string, role?: string): Promise<SpaceInvite> => request('POST', `/api/spaces/${sid}/invites`, role ? { username, role } : { username }),
    revokeInvite: (sid: string, userId: string) => empty(request('DELETE', `/api/spaces/${sid}/invites/${encodeURIComponent(userId)}`)),
    setRole: (sid: string, userId: string, role: string) => request('PUT', `/api/spaces/${sid}/members/${encodeURIComponent(userId)}`, { role }),
    transfer: (sid: string, userId: string) => empty(request('POST', `/api/spaces/${sid}/transfer`, { userId })),
    makeCode: (sid: string): Promise<JoinCode> => request('POST', `/api/spaces/${sid}/code`),
    dropCode: (sid: string) => empty(request('DELETE', `/api/spaces/${sid}/code`)),
  },
  invites: {
    list: (): Promise<{ invites: Invite[] }> => request('GET', '/api/invites'),
    accept: (sid: string) => spaceOf(request('POST', `/api/invites/${sid}/accept`)),
    decline: (sid: string) => empty(request('POST', `/api/invites/${sid}/decline`)),
  },
  join: (code: string) => spaceOf(request('POST', '/api/join', { code })),
```

- [ ] **Step 5: The sheet kinds and the store's hooks**

In `src/data/overlay.ts`, replace `import type { Item } from "./types"` with `import type { Item, SpaceSummary } from "./types"`, and in `SheetState`, after the line `    | { kind: "achievement"; draft: AchievementDraft }`, add:

```ts
    | { kind: "class"; spaceId: string; tab: ClassTab }
    | { kind: "new-class" }
    | { kind: "convert"; courseId: string }
    | { kind: "join"; code: string; space: SpaceSummary | null }
    | { kind: "invites" }
```

and before `export type SheetState =` add:

```ts
/** The class sheet's tabs. */
export type ClassTab = "details" | "members"

```

In `src/components/sheet/sheet.tsx`, in `sheetLabel`, after the line `    if (s.kind === "achievement") return s.draft.isNew ? "New achievement" : "Edit achievement"` add:

```ts
    if (s.kind === "class") return "Class"
    if (s.kind === "new-class") return "New shared class"
    if (s.kind === "convert") return "Convert to shared class"
    if (s.kind === "join") return "Join a class"
    if (s.kind === "invites") return "Invites"
```

In `src/data/store.ts`, after the line `export const useAchievements = () => useSyncExternalStore(subscribe, achievements)` add:

```ts

/* Read with `??`: a test's fake store may hold none of these. */
const NONE: never[] = []
const spaces = () => data.spaces ?? NONE
const sharedCourses = () => data.shared_courses ?? NONE
const sharedItems = () => data.shared_items ?? NONE
/** Your spaces as sync last described them, and your classes' rows: the class sheet reads them (they join the views in Stage 4). */
export const useSpaces = () => useSyncExternalStore(subscribe, spaces)
export const useSharedCourses = () => useSyncExternalStore(subscribe, sharedCourses)
export const useSharedItems = () => useSyncExternalStore(subscribe, sharedItems)
```

- [ ] **Step 6: `src/data/classes.ts`**

```ts
// Shared classes on this device (spec §11, §13, §15): opening their sheets, your invites,
// making a class, and the words for what went wrong. Shown to admins only until classes
// open to everyone (Stage 6); the Worker refuses anyone else too. Every call needs a
// connection; the class itself arrives by sync like everything else, and its rows stay out
// of the views until Stage 4 (effective.ts, SHARED_IN_VIEWS).

import { useSyncExternalStore } from "react"
import { api, ApiError } from "@/core/api"
import { data } from "@/core/store"
import * as sync from "@/core/sync"
import { HEXES } from "@/core/model"
import { REVIEW_ID } from "@/core/shared"
import { openSheet, type ClassTab } from "./overlay"
import { toast } from "./toast"
import type { Course, Invite, Item, Space, SpaceSummary } from "./types"

/* ── the sheets ── */

export const openClass = (spaceId: string, tab: ClassTab = "details") => openSheet({ kind: "class", spaceId, tab })
export const openNewClass = () => openSheet({ kind: "new-class" })
export const openConvert = (courseId: string) => openSheet({ kind: "convert", courseId })
/** Join with a code (`code`, from a link, fills it in), or follow a class just joined (`space`) while it downloads. */
export const openJoin = (code = "", space: SpaceSummary | null = null) => openSheet({ kind: "join", code, space })
export const openInvites = () => openSheet({ kind: "invites" })

/* ── your invites ── */

let invites: Invite[] = []
const listeners = new Set<() => void>()
const emit = () => { for (const fn of listeners) fn() }
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }

/** Your invites as last fetched: pending ones, the expired marked. */
export const useInvites = () => useSyncExternalStore(subscribe, () => invites)
export const getInvites = () => invites

/** Fetch your invites; offline, the last list stays. Admins only until Stage 6. */
export async function refreshInvites(): Promise<void> {
    if (!data.profile?.isAdmin) return
    try { invites = (await api.invites.list()).invites; emit() } catch { /* offline or signed out: keep the last list */ }
}

let watching = false
/** Fetch your invites now, and again whenever Term comes back into view. */
export function watchInvites(): void {
    void refreshInvites()
    if (watching) return
    watching = true
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void refreshInvites() })
}

const answered = (spaceId: string) => { invites = invites.filter((i) => i.spaceId !== spaceId); emit() }

/** Accept an invite: the Worker makes you a member, and the class downloads with the next sync. */
export async function accept(spaceId: string): Promise<SpaceSummary> {
    const space = await api.invites.accept(spaceId)
    answered(spaceId)
    return space
}
export async function decline(spaceId: string): Promise<void> {
    await api.invites.decline(spaceId)
    answered(spaceId)
}
/** Join with a code; a pending invite to the same class is accepted with it. */
export async function joinWithCode(code: string): Promise<SpaceSummary> {
    const space = await api.join(code)
    answered(space.id)
    return space
}

/* ── a class arriving on this device ── */

/** The class and its course are on this device. */
export const landed = (id: string): boolean =>
    data.spaces.some((s) => s.id === id) && data.shared_courses.some((c) => c.scope === "c:" + id)

/** Sync until a class just made or joined is here, a few times at most: false if it has not
    come (offline); it then arrives with a later sync. */
export async function download(id: string, tries = 4): Promise<boolean> {
    for (let i = 0; i < tries && !landed(id); i++) await sync.syncNow()
    return landed(id)
}

/* ── making a class ── */

/** How an item of your course goes into a class made from it (spec §13): tasks start
    unticked; lecture reviews and items of your own types cannot go, and stay yours. */
export function convertChoice(it: Pick<Item, "id" | "type">): { can: boolean; ticked: boolean; why: string } {
    if (it.type === "task" && REVIEW_ID.test(it.id)) return { can: false, ticked: false, why: "A lecture review: stays yours" }
    if (it.type.startsWith("c-")) return { can: false, ticked: false, why: "Your own type: stays yours" }
    return { can: true, ticked: it.type !== "task", why: "" }
}

/** The class you own that was made from your course `courseId`, if any. */
export function classFrom(courseId: string, spaces: Space[], shared: { scope: string; id: string }[]): Space | null {
    return spaces.find((s) => s.kind === "class" && s.role === "owner" && shared.some((c) => c.scope === s.scope && c.id === courseId)) ?? null
}

/** A colour none of your courses uses yet, for a new class. */
export const freeColour = (courses: Pick<Course, "color">[]): string => HEXES.find((h) => !courses.some((c) => c.color === h)) ?? HEXES[0]

async function arrive(space: SpaceSummary): Promise<void> {
    await download(space.id)
    openClass(space.id, "members")
}

/** A blank class: its course has the name and code given, and a colour you do not use yet. */
export async function makeBlank(name: string, code: string): Promise<void> {
    const space = await api.spaces.create({ kind: "class", course: { code, name, color: freeColour(data.courses), instructor: "", term: "", meetings: [] } })
    await arrive(space)
}

/** A class from your course `courseId` with the items picked. Stage 3 copies: your own course stays as it is. */
export async function convert(courseId: string, items: string[]): Promise<void> {
    const space = await api.spaces.create({ kind: "class", convertCourseId: courseId, items })
    await arrive(space)
    toast(space.name + " is now a shared class too. Your own course stays as it is.")
}

/* ── words ── */

export const formatCode = (code: string) => code.slice(0, 4) + " " + code.slice(4)
export const joinLink = (code: string) => location.origin + "/#join=" + code

/** What a failed class call says; `name` is the username it was about. */
export function messageFor(e: unknown, name = ""): string {
    if (!(e instanceof ApiError)) return "You seem to be offline. This needs a connection."
    const code = e.body?.error
    if (code === "no_user") return `No Term account named '${name}'.`
    if (code === "member") return `${name} is already a member.`
    if (code === "not_admin") return `${name} can't join shared classes yet: they're open to admins only for now.`
    if (code === "limit") return "You're in 20 classes and projects, the most anyone can be in."
    if (code === "full") return "This class is full: 30 people is the most it holds."
    if (code === "expired") return "That has expired. Ask for a new code or invite."
    if (code === "not_found") return "That doesn't match a class. The code or invite may have been withdrawn."
    if (code === "forbidden") return "Only the class's owner can do that."
    if (code === "rate_limited") return "Too many tries. Wait a while, then try again."
    if (code === "invalid") return e.body?.field === "code" ? "A code is 8 characters." : "Something in that isn't valid."
    return "That didn't work (" + (code || e.status) + "). Try again."
}
```

- [ ] **Step 7: Run the tests and the type check**

Run: `npx vitest run src/data/classes.test.ts test/api-client.test.js`, then `npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 8: Commit**

```bash
git add src/core/types.ts src/core/api.ts src/data/overlay.ts src/data/store.ts src/components/sheet/sheet.tsx src/data/classes.ts src/data/classes.test.ts test/api-client.test.js
git commit -m "Client: the class calls, the class sheets' kinds, data/classes.ts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JpUR1JXMY3ehtkiJwuij95"
```

---

### Task 9: The class sheet: Details and Members

**Files:**
- Create: `src/components/shared-glyph.tsx`
- Create: `src/components/sheet/class-sheet.tsx`, `src/components/sheet/members-tab.tsx`
- Modify: `src/components/sheet/sheet.tsx`
- Create: `src/components/sheet/classes.test.tsx`

- [ ] **Step 1: Write the failing test**

`src/components/sheet/classes.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"

// The class sheets with the store, the API, sync, the overlay and the toast as fakes; the
// hooks over the store (data/store.ts) and the class rules (data/classes.ts) are the real ones.
const fake = vi.hoisted(() => ({
    data: {
        profile: { id: "u-me", isAdmin: true } as Record<string, unknown> | null,
        courses: [] as unknown[], items: [] as unknown[], quotes: [] as unknown[], study_sessions: [] as unknown[], achievements: [] as unknown[],
        spaces: [] as unknown[], shared_courses: [] as unknown[], shared_items: [] as unknown[],
    },
    api: {
        spaces: { create: vi.fn(), get: vi.fn(), invite: vi.fn(), revokeInvite: vi.fn(), setRole: vi.fn(), transfer: vi.fn(), makeCode: vi.fn(), dropCode: vi.fn() },
        invites: { list: vi.fn(), accept: vi.fn(), decline: vi.fn() },
        join: vi.fn(),
    },
    syncNow: vi.fn(async () => true),
    overlay: { openSheet: vi.fn(), replaceSheet: vi.fn(), closeSheet: vi.fn() },
    toast: vi.fn(),
}))
vi.mock("@/core/store", () => ({ data: fake.data, subscribe: () => () => {} }))
vi.mock("@/core/api", () => {
    class ApiError extends Error {
        status: number
        body: Record<string, unknown> | null
        constructor(status: number, body: Record<string, unknown> | null) { super(String(body?.error ?? status)); this.status = status; this.body = body }
    }
    return { api: fake.api, ApiError }
})
vi.mock("@/core/sync", () => ({ syncNow: fake.syncNow }))
vi.mock("@/data/overlay", () => fake.overlay)
vi.mock("@/data/toast", () => ({ toast: fake.toast }))

import { ApiError } from "@/core/api"
import { ClassSheet } from "./class-sheet"

const SID = "sp0000000001", SCOPE = "c:" + SID
const space = (role = "owner") => ({
    id: SID, scope: SCOPE, kind: "class", role, name: "Web Services", archived: false, parent: null, revision: 9,
    members: [{ userId: "u-me", name: "George", role: "owner" }, { userId: "u-sam", name: "Sam", role: "member" }],
})
const course = { scope: SCOPE, id: "web", code: "CS 446", name: "Web Services", color: "#17B3AE", instructor: "Dr. Okafor", term: "Fall 2026", archived: false, target: null, meetings: [] }
const details = (role = "owner") => ({
    id: SID, scope: SCOPE, kind: "class", role, archived: false,
    members: [{ userId: "u-me", username: "george", name: "George", role: "owner", joinedAt: 1 }, { userId: "u-sam", username: "sam", name: "Sam", role: "member", joinedAt: 2 }],
    invites: role === "member" ? [] : [{ userId: "u-tay", username: "taylor", name: "Taylor", role: "member", status: "pending", createdAt: Date.UTC(2026, 9, 1, 12), expiresAt: Date.UTC(2026, 9, 31), invitedBy: "u-me" }],
    code: null,
})
const summary = { id: SID, scope: SCOPE, kind: "class", name: "Web Services", role: "member", members: 3 }

beforeEach(() => {
    Object.assign(fake.data, { profile: { id: "u-me", isAdmin: true }, courses: [], items: [], spaces: [], shared_courses: [], shared_items: [] })
    fake.syncNow.mockImplementation(async () => true)
    fake.api.invites.list.mockResolvedValue({ invites: [] })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe("the class sheet", () => {
    beforeEach(() => {
        fake.data.spaces = [space()]
        fake.data.shared_courses = [course]
        fake.data.shared_items = [
            { scope: SCOPE, id: "a1", type: "assignment", title: "REST API Project", courseId: "web", date: "2026-10-15", weight: 20 },
            { scope: SCOPE, id: "q1", type: "quiz", title: "Quiz 1", courseId: "web", date: "2026-10-01", weight: 10 },
            { scope: "c:sp0000000002", id: "x", type: "quiz", title: "Another class", courseId: "z", date: "2026-10-01", weight: 10 },
        ]
    })

    it("shows the class's facts and its items, read-only, and switches to Members", () => {
        render(<ClassSheet spaceId={SID} tab="details" />)
        expect(screen.getByRole("heading", { name: "Web Services" })).toBeTruthy()
        expect(screen.getByText(/Shared/)).toBeTruthy()
        expect(screen.getByText("Dr. Okafor")).toBeTruthy()
        const list = within(screen.getByRole("list", { name: "Class items" }))
        expect(list.getAllByRole("listitem").map((li) => li.firstChild?.textContent)).toEqual(["Quiz 1", "REST API Project"])
        expect(screen.queryByText("Another class")).toBeNull()
        expect(screen.queryByRole("textbox")).toBeNull()
        fireEvent.click(screen.getByRole("tab", { name: "Members" }))
        expect(fake.overlay.replaceSheet).toHaveBeenCalledWith({ kind: "class", spaceId: SID, tab: "members" })
    })

    it("says so when the class has not reached this device yet", () => {
        fake.data.spaces = []
        render(<ClassSheet spaceId={SID} tab="details" />)
        expect(screen.getByText(/isn't on this device yet/)).toBeTruthy()
    })
})

describe("the Members tab", () => {
    beforeEach(() => { fake.data.spaces = [space()]; fake.data.shared_courses = [course] })

    it("invites by username, and says why when it cannot", async () => {
        fake.api.spaces.get.mockResolvedValue(details())
        render(<ClassSheet spaceId={SID} tab="members" />)
        const name = await screen.findByRole("textbox", { name: "Username" })
        fireEvent.click(screen.getByRole("button", { name: "Invite" }))
        expect(screen.getByText("Type a username.")).toBeTruthy()
        fake.api.spaces.invite.mockRejectedValueOnce(new ApiError(404, { error: "no_user" }))
        fireEvent.change(name, { target: { value: "@Gabriel " } })
        fireEvent.click(screen.getByRole("button", { name: "Invite" }))
        expect(await screen.findByText("No Term account named 'gabriel'.")).toBeTruthy()
        expect(fake.api.spaces.invite).toHaveBeenLastCalledWith(SID, "gabriel", "member")
        fake.api.spaces.invite.mockResolvedValueOnce({ userId: "u-mo", name: "Morgan", role: "member", status: "pending" })
        fireEvent.change(name, { target: { value: "morgan" } })
        fireEvent.click(screen.getByRole("button", { name: "Invite" }))
        expect(await screen.findByText(/Invited Morgan/)).toBeTruthy()
        expect(fake.api.spaces.get).toHaveBeenCalledTimes(2)
    })

    it("lets the owner withdraw an invite, change a role and make a join code", async () => {
        fake.api.spaces.get.mockResolvedValue(details())
        fake.api.spaces.makeCode.mockResolvedValue({ code: "7KQ2M9XD", expires: Date.now() + 1e9, usesLeft: 10 })
        render(<ClassSheet spaceId={SID} tab="members" />)
        fireEvent.click(await screen.findByRole("button", { name: "Withdraw the invite to Taylor" }))
        await waitFor(() => expect(fake.api.spaces.revokeInvite).toHaveBeenCalledWith(SID, "u-tay"))
        fireEvent.change(screen.getByRole("combobox", { name: "Role for Sam" }), { target: { value: "editor" } })
        await waitFor(() => expect(fake.api.spaces.setRole).toHaveBeenCalledWith(SID, "u-sam", "editor"))
        fireEvent.click(screen.getByRole("button", { name: "Make a join code" }))
        expect(await screen.findByText("7KQ2 M9XD")).toBeTruthy()
        expect(screen.getByText(/#join=7KQ2M9XD$/)).toBeTruthy()
    })

    it("hands the class on after asking", async () => {
        fake.api.spaces.get.mockResolvedValue(details())
        render(<ClassSheet spaceId={SID} tab="members" />)
        fireEvent.change(await screen.findByRole("combobox", { name: "New owner" }), { target: { value: "u-sam" } })
        fireEvent.click(screen.getByRole("button", { name: "Make owner" }))
        expect(screen.getByText("Make Sam the owner? You become an editor.")).toBeTruthy()
        fireEvent.click(screen.getByRole("button", { name: "Make Sam owner" }))
        await waitFor(() => expect(fake.api.spaces.transfer).toHaveBeenCalledWith(SID, "u-sam"))
    })

    it("shows a member who is in it and who to ask, with nothing to change", async () => {
        fake.data.spaces = [space("member")]
        fake.api.spaces.get.mockResolvedValue(details("member"))
        render(<ClassSheet spaceId={SID} tab="members" />)
        expect(await screen.findByText("Owners and editors invite people. Ask George for a join code.")).toBeTruthy()
        expect(screen.getByText("Sam")).toBeTruthy()
        expect(screen.queryByRole("textbox")).toBeNull()
        expect(screen.queryByRole("combobox")).toBeNull()
        expect(screen.queryByRole("button", { name: /join code/ })).toBeNull()
    })
})
```

(`act` and `summary` are used by the tests Tasks 10 and 11 add to this file.)

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/components/sheet/classes.test.tsx`
Expected: FAIL: `./class-sheet` does not exist.

- [ ] **Step 3: The glyph**

`src/components/shared-glyph.tsx`:

```tsx
// The two-person glyph of a shared class (spec §15), as the prototype draws it.

import { cn } from "@/lib/utils"

export const SharedGlyph = ({ className }: { className?: string }) => (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className={cn("size-3.5 shrink-0", className)}>
        <circle cx="5.5" cy="5.5" r="2.3" />
        <circle cx="11" cy="6" r="1.9" />
        <path d="M1.5 13.5c.4-2.4 2-3.7 4-3.7s3.6 1.3 4 3.7M10 10c2 0 3.6.9 4.2 3.3" />
    </svg>
)
```

- [ ] **Step 4: The class sheet**

`src/components/sheet/class-sheet.tsx`:

```tsx
// A shared class in the sheet (spec §15), for admins until Stage 6: its facts and its items
// as the class keeps them, read-only until the split item card (Stage 4), and its members.
// What is yours about it (colour, semester, grades) arrives with Stage 4.

import { useId } from "react"
import { cn } from "@/lib/utils"
import { tmeta } from "@/core/model"
import { shortDate } from "@/core/dates"
import { useSharedCourses, useSharedItems, useSpaces } from "@/data/store"
import { closeSheet, replaceSheet, type ClassTab } from "@/data/overlay"
import type { SharedCourse, SharedItem, Space } from "@/data/types"
import { SharedGlyph } from "@/components/shared-glyph"
import { tabKeys } from "./radio-keys"
import { Button, Note, Section, SheetBody, SheetFoot, SheetHead } from "./fields"
import { MembersTab } from "./members-tab"

const TABS: readonly [ClassTab, string][] = [["details", "Details"], ["members", "Members"]]
const TITLE = "m-0 text-[22px] leading-[1.22] font-[750] tracking-[-.02em] text-foreground"

export function ClassSheet({ spaceId, tab }: { spaceId: string; tab: ClassTab }) {
    const scope = "c:" + spaceId
    const space = useSpaces().find((s) => s.id === spaceId) ?? null
    const course = useSharedCourses().find((c) => c.scope === scope) ?? null
    const items = useSharedItems().filter((it) => it.scope === scope).sort((a, b) => a.date.localeCompare(b.date))
    const f = useId()

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
                    {tab === "details" ? <Details space={space} course={course} items={items} /> : <MembersTab spaceId={spaceId} />}
                </div>
            </SheetBody>
            <SheetFoot hint={n + (n === 1 ? " member" : " members")}>
                <Button onClick={closeSheet}>Done</Button>
            </SheetFoot>
        </>
    )
}

const KEY = "text-muted-foreground"

function Details({ space, course, items }: { space: Space; course: SharedCourse; items: SharedItem[] }) {
    return (
        <>
            <Section title={<><SharedGlyph /> Class</>} note={space.role === "member" ? "The owner and editors keep it" : undefined}>
                <dl className="m-0 grid grid-cols-[86px_minmax(0,1fr)] gap-x-2.5 gap-y-1.5 text-[12.5px]">
                    <dt className={KEY}>Code</dt><dd className="m-0">{course.code || "—"}</dd>
                    <dt className={KEY}>Teacher</dt><dd className="m-0">{course.instructor || "—"}</dd>
                    <dt className={KEY}>Semester</dt><dd className="m-0">{course.term || "—"}</dd>
                    <dt className={KEY}>Classes</dt><dd className="m-0">{course.meetings.length ? course.meetings.length + " a week" : "—"}</dd>
                    <dt className={KEY}>Members</dt><dd className="m-0">{space.members.length}</dd>
                </dl>
            </Section>
            <Section title="Items" note={String(items.length)}>
                {items.length === 0 ? <Note>No items in this class yet.</Note> : (
                    <ul aria-label="Class items" className="m-0 flex list-none flex-col gap-1 p-0">
                        {items.map((it) => (
                            <li key={it.id} className="flex items-baseline gap-2 rounded-lg bg-muted px-2.5 py-1.5 text-[12.5px]">
                                <span className="min-w-0 flex-1 truncate">{it.title}</span>
                                <span className="shrink-0 text-[11px] text-muted-foreground">
                                    {tmeta(it.type).label} · {shortDate(it.date)}{it.weight != null ? " · " + it.weight + "%" : ""}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </Section>
        </>
    )
}
```

- [ ] **Step 5: The Members tab**

`src/components/sheet/members-tab.tsx`:

```tsx
// A class's Members tab (spec §11, §15): who is in it, invites by username, the join code,
// roles, and handing the class on. Owners and editors invite; only the owner gives another
// role, makes a code, changes roles and hands the class on. Removing someone and leaving
// wait for Stage 5, so neither is offered. Everything here needs a connection.

import { useCallback, useEffect, useState } from "react"
import { api } from "@/core/api"
import { syncNow } from "@/core/sync"
import { dayMonth, iso } from "@/core/dates"
import { useProfile } from "@/data/store"
import { formatCode, joinLink, messageFor } from "@/data/classes"
import { toast } from "@/data/toast"
import type { JoinCode, SpaceDetails, SpaceInvite, SpaceMember } from "@/data/types"
import { Button, Note, Section, Select, TextInput } from "./fields"

type Reload = () => Promise<void>
const ROLE: Record<SpaceMember["role"], string> = { owner: "Owner", editor: "Editor", member: "Member" }
const STATUS: Record<SpaceInvite["status"], string> = { pending: "Pending", declined: "Declined", expired: "Expired" }
const day = (ms: number) => dayMonth(iso(new Date(ms)))
const LIST = "m-0 flex list-none flex-col gap-1 p-0"
const ROW = "flex items-center gap-2 rounded-lg bg-muted px-2.5 py-1.5 text-[12.5px]"

export function MembersTab({ spaceId }: { spaceId: string }) {
    const me = useProfile()?.id ?? ""
    const [info, setInfo] = useState<SpaceDetails | null>(null)
    const [error, setError] = useState("")
    const load = useCallback(async () => {
        try { setInfo(await api.spaces.get(spaceId)); setError("") } catch (e) { setError(messageFor(e)) }
    }, [spaceId])
    useEffect(() => { void load() }, [load])

    if (!info) return error ? <Note tone="bad">{error}</Note> : <Note>Loading the members…</Note>
    const owner = info.role === "owner", editor = info.role !== "member"
    const ownerName = info.members.find((m) => m.role === "owner")?.name ?? "the owner"
    const others = info.members.filter((m) => m.userId !== me)
    return (
        <>
            {editor
                ? <InviteBox spaceId={spaceId} owner={owner} standard={info.kind === "class" ? "member" : "editor"} reload={load} />
                : <Note>Owners and editors invite people. Ask {ownerName} for a join code.</Note>}
            {editor && info.invites.length > 0 && <InviteList spaceId={spaceId} invites={info.invites} owner={owner} me={me} reload={load} />}
            {owner && <CodeBox spaceId={spaceId} code={info.code} reload={load} />}
            <MemberList spaceId={spaceId} members={info.members} owner={owner} me={me} reload={load} />
            {owner && others.length > 0 && <HandOn spaceId={spaceId} members={others} reload={load} />}
            {error && <Note tone="bad">{error}</Note>}
        </>
    )
}

function InviteBox({ spaceId, owner, standard, reload }: { spaceId: string; owner: boolean; standard: "member" | "editor"; reload: Reload }) {
    const [name, setName] = useState("")
    const [role, setRole] = useState<"member" | "editor">(standard)
    const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null)
    const [busy, setBusy] = useState(false)
    const send = async () => {
        const username = name.trim().toLowerCase().replace(/^@/, "")
        if (!username) { setSaid({ ok: false, text: "Type a username." }); return }
        setBusy(true)
        try {
            const sent = await api.spaces.invite(spaceId, username, role)
            setSaid({ ok: true, text: "Invited " + sent.name + ". They'll see it under Invites in Term." })
            setName("")
            await reload()
        } catch (e) { setSaid({ ok: false, text: messageFor(e, username) }) }
        finally { setBusy(false) }
    }
    return (
        <Section title="Invite by username">
            <div className="flex gap-2">
                <TextInput aria-label="Username" className="min-w-0 flex-1" value={name} maxLength={33} placeholder="e.g. morgan" autoComplete="off"
                    onChange={(e) => { setName(e.target.value); setSaid(null) }}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void send() } }} />
                {owner && (
                    <Select aria-label="Invite as" value={role} className="w-auto" onChange={(e) => setRole(e.target.value as "member" | "editor")}>
                        <option value="member">Member</option>
                        <option value="editor">Editor</option>
                    </Select>
                )}
                <Button disabled={busy} onClick={() => void send()}>Invite</Button>
            </div>
            {said ? <Note tone={said.ok ? "ok" : "bad"}>{said.text}</Note> : <Note>Accounts are made by the admin; invites never send email.</Note>}
        </Section>
    )
}

function InviteList({ spaceId, invites, owner, me, reload }: { spaceId: string; invites: SpaceInvite[]; owner: boolean; me: string; reload: Reload }) {
    const [err, setErr] = useState("")
    const withdraw = async (userId: string) => {
        try { await api.spaces.revokeInvite(spaceId, userId); setErr(""); await reload() } catch (e) { setErr(messageFor(e)) }
    }
    return (
        <Section title="Invited">
            <ul className={LIST}>
                {invites.map((v) => (
                    <li key={v.userId} className={ROW}>
                        <span className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate">{v.name}</span>
                            <span className="text-[11px] text-muted-foreground">Invited {day(v.createdAt)} · as {v.role}</span>
                        </span>
                        <span className="text-[11px] text-muted-foreground">{STATUS[v.status]}</span>
                        {(owner || v.invitedBy === me) && (
                            <Button variant="ghost" aria-label={"Withdraw the invite to " + v.name} onClick={() => void withdraw(v.userId)}>Withdraw</Button>
                        )}
                    </li>
                ))}
            </ul>
            {err && <Note tone="bad">{err}</Note>}
        </Section>
    )
}

function CodeBox({ spaceId, code, reload }: { spaceId: string; code: SpaceDetails["code"]; reload: Reload }) {
    const [made, setMade] = useState<JoinCode | null>(null)
    const [err, setErr] = useState("")
    const make = async () => {
        try { setMade(await api.spaces.makeCode(spaceId)); setErr(""); await reload() } catch (e) { setErr(messageFor(e)) }
    }
    const drop = async () => {
        try { await api.spaces.dropCode(spaceId); setMade(null); setErr(""); await reload() } catch (e) { setErr(messageFor(e)) }
    }
    const copy = (text: string) => {
        void navigator.clipboard?.writeText(text).then(() => toast("Copied."), () => toast("Copying failed: select it instead."))
    }
    return (
        <Section title="Join code">
            {made ? <>
                <Note>Valid 7 days, for up to 10 people. It shows only now: copy it.</Note>
                <span className="font-mono text-[20px] font-semibold tracking-[.12em]">{formatCode(made.code)}</span>
                <span className="font-mono text-[11px] break-all text-muted-foreground">{joinLink(made.code)}</span>
                <div className="flex flex-wrap gap-2">
                    <Button variant="ghost" onClick={() => copy(formatCode(made.code))}>Copy code</Button>
                    <Button variant="ghost" onClick={() => copy(joinLink(made.code))}>Copy link</Button>
                    <Button variant="ghost" onClick={() => void make()}>Make a new one</Button>
                    <Button variant="ghost" onClick={() => void drop()}>Turn off</Button>
                </div>
            </> : code ? <>
                <Note>A join code works until {day(code.expires)}, for {code.usesLeft} more {code.usesLeft === 1 ? "person" : "people"}. Only its hash is kept: make a new one to see a code again.</Note>
                <div className="flex flex-wrap gap-2">
                    <Button variant="ghost" onClick={() => void make()}>Make a new one</Button>
                    <Button variant="ghost" onClick={() => void drop()}>Turn off</Button>
                </div>
            </> : <>
                <Note>Anyone with the code can join as a member for 7 days. A new code retires the old one.</Note>
                <Button variant="ghost" className="self-start" onClick={() => void make()}>Make a join code</Button>
            </>}
            {err && <Note tone="bad">{err}</Note>}
        </Section>
    )
}

function MemberList({ spaceId, members, owner, me, reload }: { spaceId: string; members: SpaceMember[]; owner: boolean; me: string; reload: Reload }) {
    const [err, setErr] = useState("")
    const change = async (userId: string, role: string) => {
        try { await api.spaces.setRole(spaceId, userId, role); setErr(""); await reload(); void syncNow() } catch (e) { setErr(messageFor(e)) }
    }
    return (
        <Section title="Members" note={String(members.length)}>
            <ul className={LIST}>
                {members.map((m) => (
                    <li key={m.userId} className={ROW}>
                        <span className="min-w-0 flex-1 truncate">{m.name}{m.userId === me && <span className="text-muted-foreground"> (you)</span>}</span>
                        {owner && m.role !== "owner" ? (
                            <Select aria-label={"Role for " + m.name} value={m.role} className="w-auto" onChange={(e) => void change(m.userId, e.target.value)}>
                                <option value="editor">Editor</option>
                                <option value="member">Member</option>
                            </Select>
                        ) : <span className="text-[11px] font-semibold text-muted-foreground">{ROLE[m.role]}</span>}
                    </li>
                ))}
            </ul>
            {err && <Note tone="bad">{err}</Note>}
        </Section>
    )
}

function HandOn({ spaceId, members, reload }: { spaceId: string; members: SpaceMember[]; reload: Reload }) {
    const [to, setTo] = useState("")
    const [asking, setAsking] = useState(false)
    const [err, setErr] = useState("")
    const who = members.find((m) => m.userId === to)
    const go = async () => {
        try { await api.spaces.transfer(spaceId, to); setAsking(false); setErr(""); await reload(); void syncNow() } catch (e) { setErr(messageFor(e)) }
    }
    return (
        <Section title="Hand the class on">
            <div className="flex gap-2">
                <Select aria-label="New owner" value={to} className="min-w-0 flex-1" onChange={(e) => { setTo(e.target.value); setAsking(false) }}>
                    <option value="">Choose a member…</option>
                    {members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
                </Select>
                <Button variant="ghost" disabled={!who} onClick={() => setAsking(true)}>Make owner</Button>
            </div>
            {asking && who && (
                <div className="flex flex-wrap items-center gap-2">
                    <Note>Make {who.name} the owner? You become an editor.</Note>
                    <Button variant="ghost" onClick={() => setAsking(false)}>Cancel</Button>
                    <Button variant="danger" onClick={() => void go()}>Make {who.name} owner</Button>
                </div>
            )}
            {err && <Note tone="bad">{err}</Note>}
        </Section>
    )
}
```

- [ ] **Step 6: Show it in the sheet**

In `src/components/sheet/sheet.tsx`, after the line `const AchievementSheet = lazyNamed(() => import("./achievement-sheet"), "AchievementSheet")` add:

```tsx
/* the class sheets: admins only until Stage 6, so nobody else downloads them (lib/lazy.ts) */
const ClassSheet = lazyNamed(() => import("./class-sheet"), "ClassSheet", { idle: false })
```

and after the line `                {shown?.kind === "achievement" && <AchievementSheet key={shown.draft.id} draft={shown.draft} />}` add:

```tsx
                {shown?.kind === "class" && <ClassSheet key={shown.spaceId} spaceId={shown.spaceId} tab={shown.tab} />}
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run src/components/sheet/classes.test.tsx src/components/sheet/sheet.test.tsx`, then `npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 8: Commit**

```bash
git add src/components/shared-glyph.tsx src/components/sheet/class-sheet.tsx src/components/sheet/members-tab.tsx src/components/sheet/sheet.tsx src/components/sheet/classes.test.tsx
git commit -m "The class sheet: Details read-only, Members with invites, the join code, roles, hand-on

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JpUR1JXMY3ehtkiJwuij95"
npm run build
```

(The build checks the `·`, `—` and `…` these files add; rule 4.)

---

### Task 10: New shared class, the item picker, and Share this course

**Files:**
- Create: `src/components/sheet/new-class-sheet.tsx`, `src/components/sheet/convert-sheet.tsx`, `src/components/sheet/share-course.tsx`
- Modify: `src/components/sheet/course-sheet.tsx`, `src/components/sheet/sheet.tsx`
- Modify: `src/components/sheet/classes.test.tsx`, `src/components/sheet/sheet.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `src/components/sheet/classes.test.tsx`, after the line `import { ClassSheet } from "./class-sheet"` add:

```tsx
import { NewClassSheet } from "./new-class-sheet"
import { ConvertSheet } from "./convert-sheet"
import { ShareCourse } from "./share-course"
```

and append:

```tsx
describe("a new shared class", () => {
    it("makes a blank one with a colour you do not use, waits for it, then opens its Members", async () => {
        fake.data.courses = [{ id: "c1", name: "Anatomy", color: "#E4749B", archived: false }]
        fake.api.spaces.create.mockResolvedValue({ ...summary, role: "owner", name: "Operating Systems" })
        fake.syncNow.mockImplementation(async () => { fake.data.spaces = [space()]; fake.data.shared_courses = [course]; return true })
        render(<NewClassSheet />)
        fireEvent.click(screen.getByRole("button", { name: "Continue" }))
        expect(screen.getByText("Give it a name and a code.")).toBeTruthy()
        fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Operating Systems" } })
        fireEvent.change(screen.getByRole("textbox", { name: "Code" }), { target: { value: "OS" } })
        fireEvent.click(screen.getByRole("button", { name: "Continue" }))
        await waitFor(() => expect(fake.overlay.openSheet).toHaveBeenCalledWith({ kind: "class", spaceId: SID, tab: "members" }))
        expect(fake.api.spaces.create).toHaveBeenCalledWith({ kind: "class", course: { code: "OS", name: "Operating Systems", color: "#8B5CC7", instructor: "", term: "", meetings: [] } })
        expect(fake.syncNow).toHaveBeenCalledTimes(1)
    })

    it("goes on to the item picker for a course of yours", () => {
        fake.data.courses = [{ id: "db", name: "Databases", color: "#4F74D9", archived: false }, { id: "old", name: "Old", color: "#7D8A99", archived: true }]
        render(<NewClassSheet />)
        fireEvent.click(screen.getByRole("radio", { name: /Convert a course you have/ }))
        const select = screen.getByRole("combobox", { name: "Course" })
        expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["Databases"])
        fireEvent.click(screen.getByRole("button", { name: "Continue" }))
        expect(fake.overlay.openSheet).toHaveBeenCalledWith({ kind: "convert", courseId: "db" })
    })
})

describe("converting a course", () => {
    beforeEach(() => {
        fake.data.courses = [{ id: "db", name: "Databases", color: "#4F74D9", archived: false }]
        fake.data.items = [
            { id: "a1", type: "assignment", title: "Project", courseId: "db", date: "2026-10-15", grade: 91, links: [{ label: "Spec", url: "https://example.com" }] },
            { id: "t1", type: "task", title: "Read chapter 3", courseId: "db", date: "2026-10-02", grade: null, links: [] },
            { id: "c1", type: "c-viva", title: "Viva", courseId: "db", date: "2026-10-20", grade: null, links: [] },
            { id: "rvab12cd31", type: "task", title: "Review 1/4", courseId: "db", date: "2026-10-03", grade: null, links: [] },
            { id: "z1", type: "quiz", title: "Elsewhere", courseId: "other", date: "2026-10-03", grade: null, links: [] },
        ]
    })

    it("ticks all but tasks; lecture reviews and your own types stay yours; warns about links", async () => {
        fake.api.spaces.create.mockResolvedValue({ ...summary, role: "owner", name: "Databases" })
        render(<ConvertSheet courseId="db" />)
        const box = (name: RegExp) => screen.getByRole("checkbox", { name }) as HTMLInputElement
        expect(box(/^Project/).checked).toBe(true)
        expect(box(/^Read chapter 3/).checked).toBe(false)
        expect(box(/^Viva/).disabled).toBe(true)
        expect(box(/^Review 1\/4/).disabled).toBe(true)
        expect(screen.queryByRole("checkbox", { name: /Elsewhere/ })).toBeNull()
        expect(screen.getByText("Links on ticked items become visible to the class.")).toBeTruthy()
        fireEvent.click(box(/^Read chapter 3/))
        fireEvent.click(screen.getByRole("button", { name: "Create class" }))
        await waitFor(() => expect(fake.api.spaces.create).toHaveBeenCalledWith({ kind: "class", convertCourseId: "db", items: ["t1", "a1"] }))
        await waitFor(() => expect(fake.toast).toHaveBeenCalled())
    })

    it("says why it failed and lets you try again", async () => {
        fake.api.spaces.create.mockRejectedValue(new ApiError(409, { error: "limit" }))
        render(<ConvertSheet courseId="db" />)
        fireEvent.click(screen.getByRole("button", { name: "Create class" }))
        expect(await screen.findByText(/20 classes/)).toBeTruthy()
        expect((screen.getByRole("button", { name: "Create class" }) as HTMLButtonElement).disabled).toBe(false)
    })
})

describe("Share this course, in the course sheet", () => {
    it("offers Convert, or opens the class already made from the course", () => {
        render(<ShareCourse courseId="db" dirty={false} />)
        fireEvent.click(screen.getByRole("button", { name: "Convert to shared class" }))
        expect(fake.overlay.openSheet).toHaveBeenCalledWith({ kind: "convert", courseId: "db" })
        cleanup()
        fake.data.spaces = [{ ...space(), name: "Databases" }]
        fake.data.shared_courses = [{ ...course, id: "db" }]
        render(<ShareCourse courseId="db" dirty={false} />)
        fireEvent.click(screen.getByRole("button", { name: "Open the class" }))
        expect(fake.overlay.openSheet).toHaveBeenLastCalledWith({ kind: "class", spaceId: SID, tab: "details" })
    })

    it("waits for the course's changes to be saved", () => {
        render(<ShareCourse courseId="db" dirty />)
        expect((screen.getByRole("button", { name: "Convert to shared class" }) as HTMLButtonElement).disabled).toBe(true)
        expect(screen.getByText("Save your changes first.")).toBeTruthy()
    })
})
```

In `src/components/sheet/sheet.test.tsx`, in `describe("the course sheet", …)`, add as its first test:

```tsx
    it("offers sharing the course to admins only", () => {
        show()
        open({ kind: "course", id: "anat" })
        expect(screen.queryByRole("button", { name: "Convert to shared class" })).toBeNull()
        act(() => closeSheet())
        ;(fake.data as { profile: unknown }).profile = { id: "u1", isAdmin: true }
        try {
            open({ kind: "course", id: "anat" })
            expect(screen.getByRole("button", { name: "Convert to shared class" })).toBeTruthy()
        } finally {
            ;(fake.data as { profile: unknown }).profile = null
        }
    })
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run src/components/sheet/classes.test.tsx src/components/sheet/sheet.test.tsx`
Expected: FAIL: `./new-class-sheet` does not exist; the course sheet shows no Convert for an admin.

- [ ] **Step 3: New shared class**

`src/components/sheet/new-class-sheet.tsx`:

```tsx
// New shared class (spec §15, §20), for admins until Stage 6: blank, or from a course of
// yours (the item picker comes next). You become its owner. "From a course outline" comes
// with Stage 6.

import { useId, useState } from "react"
import { cn } from "@/lib/utils"
import { useCourses } from "@/data/store"
import { closeSheet } from "@/data/overlay"
import { makeBlank, messageFor, openConvert } from "@/data/classes"
import { Button, Fields, Label, Note, Select, SheetBody, SheetFoot, SheetHead, TextInput } from "./fields"

type Start = "blank" | "convert"
const OPTIONS: readonly [Start, string, string][] = [
    ["blank", "Blank", "Name it and add items as you go."],
    ["convert", "Convert a course you have", "Copies the course and the items you tick."],
]

export function NewClassSheet() {
    const courses = useCourses().filter((c) => !c.archived)
    const [start, setStart] = useState<Start>("blank")
    const [name, setName] = useState("")
    const [code, setCode] = useState("")
    const [courseId, setCourseId] = useState(courses[0]?.id ?? "")
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState("")
    const f = useId()

    const go = async () => {
        if (start === "convert") { if (courseId) openConvert(courseId); return }
        if (!name.trim() || !code.trim()) { setErr("Give it a name and a code."); return }
        setBusy(true); setErr("")
        try { await makeBlank(name.trim(), code.trim()) } catch (e) { setErr(messageFor(e)); setBusy(false) }
    }

    return (
        <>
            <SheetHead kind="New shared class" onClose={closeSheet} />
            <SheetBody>
                <h2 className="m-0 text-[22px] leading-[1.22] font-[750] tracking-[-.02em]">New shared class</h2>
                <Note>You become its owner. Choose editors later; members read the class and keep their own layer.</Note>
                <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
                    <legend className="sr-only">How to start</legend>
                    {OPTIONS.map(([v, title, sub]) => (
                        <label key={v} className={cn("flex cursor-pointer items-start gap-2.5 rounded-[10px] border border-border px-3 py-2.5", start === v && "border-[var(--accent)] bg-accent")}>
                            <input type="radio" name={f + "start"} value={v} checked={start === v} onChange={() => { setStart(v); setErr("") }} className="mt-0.5 accent-[var(--accent)]" />
                            <span className="flex flex-col gap-0.5">
                                <span className="text-[13px] font-semibold">{title}</span>
                                <span className="text-[11.5px] text-muted-foreground">{sub}</span>
                            </span>
                        </label>
                    ))}
                </fieldset>
                {start === "blank" ? (
                    <Fields>
                        <Label htmlFor={f + "name"}>Name</Label>
                        <TextInput id={f + "name"} value={name} maxLength={80} placeholder="Class name, e.g. Operating Systems" onChange={(e) => setName(e.target.value)} />
                        <Label htmlFor={f + "code"}>Code</Label>
                        <TextInput id={f + "code"} value={code} maxLength={8} placeholder="CS 446" onChange={(e) => setCode(e.target.value)} />
                    </Fields>
                ) : courses.length ? (
                    <Fields>
                        <Label htmlFor={f + "course"}>Course</Label>
                        <Select id={f + "course"} value={courseId} onChange={(e) => setCourseId(e.target.value)}>
                            {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </Select>
                    </Fields>
                ) : <Note>You have no course to convert yet.</Note>}
                {err && <Note tone="bad">{err}</Note>}
            </SheetBody>
            <SheetFoot hint="Needs a connection">
                <Button variant="ghost" onClick={closeSheet}>Cancel</Button>
                <Button disabled={busy || (start === "convert" && !courseId)} onClick={() => void go()}>{busy ? "Making…" : "Continue"}</Button>
            </SheetFoot>
        </>
    )
}
```

- [ ] **Step 4: The item picker**

`src/components/sheet/convert-sheet.tsx`:

```tsx
// Converting a course of yours into a shared class (spec §13), for admins until Stage 6:
// tick the items the class takes. Tasks start unticked; lecture reviews and items of your
// own types cannot go. Stage 3 copies the course and the ticked items into the class and
// leaves your own course as it is (Stage 3 plan, Decision 1).

import { useState } from "react"
import { cn } from "@/lib/utils"
import { tmeta } from "@/core/model"
import { shortDate } from "@/core/dates"
import { useCourses, useItems } from "@/data/store"
import { closeSheet } from "@/data/overlay"
import { convert, convertChoice, messageFor } from "@/data/classes"
import { Button, Note, SheetBody, SheetFoot, SheetHead, Warning } from "./fields"

export function ConvertSheet({ courseId }: { courseId: string }) {
    const course = useCourses().find((c) => c.id === courseId) ?? null
    const items = useItems().filter((it) => it.courseId === courseId).sort((a, b) => a.date.localeCompare(b.date))
    const [ticked, setTicked] = useState<Record<string, boolean>>(() => Object.fromEntries(items.map((it) => [it.id, convertChoice(it).ticked])))
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState("")

    if (!course) return (
        <>
            <SheetHead kind="Convert to shared class" onClose={closeSheet} />
            <SheetBody><Note>That course is no longer here.</Note></SheetBody>
            <SheetFoot hint=""><Button onClick={closeSheet}>Done</Button></SheetFoot>
        </>
    )
    const chosen = items.filter((it) => ticked[it.id] && convertChoice(it).can)
    const go = async () => {
        setBusy(true); setErr("")
        try { await convert(courseId, chosen.map((it) => it.id)) } catch (e) { setErr(messageFor(e)); setBusy(false) }
    }

    return (
        <>
            <SheetHead color={course.color} kind="Convert to shared class" onClose={closeSheet} />
            <SheetBody>
                <h2 className="m-0 text-[22px] leading-[1.22] font-[750] tracking-[-.02em]">Share {course.name}</h2>
                <Note>Ticked items are copied into the class. Tasks start unticked.</Note>
                {items.length === 0 ? <Note>This course has no items. The class starts empty.</Note> : (
                    <ul className="m-0 flex list-none flex-col gap-1 p-0">
                        {items.map((it) => {
                            const c = convertChoice(it)
                            return (
                                <li key={it.id}>
                                    <label className={cn("flex items-center gap-2.5 rounded-lg bg-muted px-2.5 py-1.5 text-[12.5px]", c.can ? "cursor-pointer" : "opacity-70")}>
                                        <input type="checkbox" disabled={!c.can} checked={c.can && !!ticked[it.id]} className="size-3.5 accent-[var(--accent)]"
                                            onChange={(e) => setTicked({ ...ticked, [it.id]: e.target.checked })} />
                                        <span className="flex min-w-0 flex-1 flex-col">
                                            <span className="truncate">{it.title}</span>
                                            <span className="text-[11px] text-muted-foreground">
                                                {c.why || tmeta(it.type).label + " · " + shortDate(it.date) + (it.grade != null ? " · your grade " + it.grade + "% stays yours" : "")}
                                            </span>
                                        </span>
                                    </label>
                                </li>
                            )
                        })}
                    </ul>
                )}
                {chosen.some((it) => it.links.length > 0) && <Warning>Links on ticked items become visible to the class.</Warning>}
                <Note>Your own course stays as it is, with your status, grades and notes. They are never shared.</Note>
                {err && <Note tone="bad">{err}</Note>}
            </SheetBody>
            <SheetFoot hint={chosen.length + " of " + items.length + " items"}>
                <Button variant="ghost" onClick={closeSheet}>Cancel</Button>
                <Button disabled={busy} onClick={() => void go()}>{busy ? "Creating…" : "Create class"}</Button>
            </SheetFoot>
        </>
    )
}
```

- [ ] **Step 5: Share this course**

`src/components/sheet/share-course.tsx`:

```tsx
// "Share this course" in a course's sheet, for admins until Stage 6 (spec §13, §15): convert
// it into a shared class, or open the class already made from it.

import { useSharedCourses, useSpaces } from "@/data/store"
import { classFrom, openClass, openConvert } from "@/data/classes"
import { SharedGlyph } from "@/components/shared-glyph"
import { Button, Note, Section } from "./fields"

export function ShareCourse({ courseId, dirty }: { courseId: string; dirty: boolean }) {
    const made = classFrom(courseId, useSpaces(), useSharedCourses())
    return (
        <Section title={<><SharedGlyph /> Share this course</>}>
            {made ? <>
                <Note>You made the shared class {made.name} from this course.</Note>
                <Button variant="ghost" className="self-start" onClick={() => openClass(made.id)}>Open the class</Button>
            </> : <>
                <Note>Turn it into a shared class. Classmates get the dates, weights and class notes; your status, grades and notes stay yours.</Note>
                <Button variant="ghost" className="self-start" disabled={dirty} onClick={() => openConvert(courseId)}>Convert to shared class</Button>
                {dirty && <Note>Save your changes first.</Note>}
            </>}
        </Section>
    )
}
```

In `src/components/sheet/course-sheet.tsx`, replace `import { useCourses, useItems } from "@/data/store"` with `import { useCourses, useItems, useProfile } from "@/data/store"`; after the line `import { TimeField } from "./time-field"` add `import { ShareCourse } from "./share-course"`; after the line `    const cal = schoolCal()` add `    const admin = !!useProfile()?.isAdmin`; and after the line

```tsx
                {!isNew && <Grades course={draft} items={mine} whatIf={whatIf} setWhatIf={setWhatIf} onTarget={(target) => edit({ target })} />}
```

add

```tsx
                {!isNew && admin && <ShareCourse courseId={draft.id} dirty={changed} />}
```

- [ ] **Step 6: Show them in the sheet**

In `src/components/sheet/sheet.tsx`, after the line `const ClassSheet = lazyNamed(() => import("./class-sheet"), "ClassSheet", { idle: false })` add:

```tsx
const NewClassSheet = lazyNamed(() => import("./new-class-sheet"), "NewClassSheet", { idle: false })
const ConvertSheet = lazyNamed(() => import("./convert-sheet"), "ConvertSheet", { idle: false })
```

and after the line `                {shown?.kind === "class" && <ClassSheet key={shown.spaceId} spaceId={shown.spaceId} tab={shown.tab} />}` add:

```tsx
                {shown?.kind === "new-class" && <NewClassSheet />}
                {shown?.kind === "convert" && <ConvertSheet key={shown.courseId} courseId={shown.courseId} />}
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run src/components/sheet/classes.test.tsx src/components/sheet/sheet.test.tsx`, then `npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 8: Commit**

```bash
git add src/components/sheet/new-class-sheet.tsx src/components/sheet/convert-sheet.tsx src/components/sheet/share-course.tsx src/components/sheet/course-sheet.tsx src/components/sheet/sheet.tsx src/components/sheet/classes.test.tsx src/components/sheet/sheet.test.tsx
git commit -m "New shared class (blank or convert), the item picker, Share this course for admins

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JpUR1JXMY3ehtkiJwuij95"
npm run build
```

---

### Task 11: Joining with a code, and the invites list

**Files:**
- Create: `src/components/sheet/join-sheet.tsx`, `src/components/sheet/invites-sheet.tsx`
- Modify: `src/components/sheet/sheet.tsx`
- Modify: `src/components/sheet/classes.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `src/components/sheet/classes.test.tsx`, after the line `import { ShareCourse } from "./share-course"` add:

```tsx
import { JoinSheet } from "./join-sheet"
import { InvitesSheet } from "./invites-sheet"
```

and append:

```tsx
describe("joining with a code", () => {
    it("checks the code, joins, shows the class downloading, then says you are in", async () => {
        fake.api.join.mockResolvedValue(summary)
        let arrive = () => {}
        fake.syncNow.mockImplementation(() => new Promise<boolean>((done) => {
            arrive = () => { fake.data.spaces = [space("member")]; fake.data.shared_courses = [course]; done(true) }
        }))
        render(<JoinSheet code="" space={null} />)
        const box = screen.getByRole("textbox", { name: "Join code" })
        fireEvent.change(box, { target: { value: "7kq2" } })
        fireEvent.click(screen.getByRole("button", { name: "Join" }))
        expect(screen.getByText("A code is 8 characters.")).toBeTruthy()
        expect(fake.api.join).not.toHaveBeenCalled()
        fireEvent.change(box, { target: { value: "7kq2 m9xd" } })
        fireEvent.click(screen.getByRole("button", { name: "Join" }))
        expect(await screen.findByText("Downloading Web Services…")).toBeTruthy()
        expect(fake.api.join).toHaveBeenCalledWith("7kq2 m9xd")
        await act(async () => arrive())
        expect(await screen.findByText("You're in Web Services")).toBeTruthy()
        expect(screen.getByText("3 members · you joined as a member.")).toBeTruthy()
        fireEvent.click(screen.getByRole("button", { name: "Open the class" }))
        expect(fake.overlay.openSheet).toHaveBeenCalledWith({ kind: "class", spaceId: SID, tab: "details" })
    })

    it("starts from a link's code, and says why a code fails", async () => {
        fake.api.join.mockRejectedValue(new ApiError(410, { error: "expired" }))
        render(<JoinSheet code="7KQ2M9XD" space={null} />)
        expect((screen.getByRole("textbox", { name: "Join code" }) as HTMLInputElement).value).toBe("7KQ2M9XD")
        fireEvent.click(screen.getByRole("button", { name: "Join" }))
        expect(await screen.findByText("That has expired. Ask for a new code or invite.")).toBeTruthy()
    })

    it("follows a class joined from an invite straight to its download", async () => {
        fake.syncNow.mockImplementation(async () => { fake.data.spaces = [space("member")]; fake.data.shared_courses = [course]; return true })
        render(<JoinSheet code="" space={summary} />)
        expect(await screen.findByText("You're in Web Services")).toBeTruthy()
        expect(screen.queryByText(/hasn't finished downloading/)).toBeNull()
    })
})

describe("invites to you", () => {
    const inv = (spaceId: string, over: Record<string, unknown> = {}) => ({
        spaceId, kind: "class", name: "Web Services", role: "member", from: "Gabriel",
        createdAt: Date.UTC(2026, 9, 1, 12), expiresAt: Date.UTC(2026, 9, 31), expired: false, ...over,
    })

    it("are listed with who sent each; Decline drops one, Accept follows the class as it downloads", async () => {
        fake.api.invites.list.mockResolvedValue({ invites: [inv(SID), inv("sp0000000002", { name: "Databases" }), inv("sp0000000003", { name: "Old class", expired: true })] })
        fake.api.invites.accept.mockResolvedValue(summary)
        render(<InvitesSheet />)
        await screen.findByText("Databases")
        const row = (name: string) => within(screen.getByText(name).closest("li") as HTMLElement)
        expect(row("Web Services").getByText("Gabriel")).toBeTruthy()
        expect(row("Old class").getByText("This invite has expired. Ask for a new one.")).toBeTruthy()
        expect(row("Old class").queryByRole("button")).toBeNull()
        fireEvent.click(row("Databases").getByRole("button", { name: "Decline the invite to Databases" }))
        await waitFor(() => expect(screen.queryByText("Databases")).toBeNull())
        expect(fake.api.invites.decline).toHaveBeenCalledWith("sp0000000002")
        fireEvent.click(row("Web Services").getByRole("button", { name: "Accept the invite to Web Services" }))
        await waitFor(() => expect(fake.overlay.openSheet).toHaveBeenCalledWith({ kind: "join", code: "", space: summary }))
    })

    it("say so when there are none", async () => {
        render(<InvitesSheet />)
        expect(await screen.findByText("Nothing new.")).toBeTruthy()
    })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run src/components/sheet/classes.test.tsx`
Expected: FAIL: `./join-sheet` does not exist.

- [ ] **Step 3: The join sheet**

`src/components/sheet/join-sheet.tsx`:

```tsx
// Joining a class (spec §11, §20), for admins until Stage 6: with a code (a /#join= link
// fills it in), or straight after accepting an invite. The class downloads onto this
// device, then the sheet says you are in. Your semester and colour for it come with
// Stage 4 (space_prefs), the school-calendar offer with Stage 6.

import { useEffect, useState } from "react"
import { normalizeCode } from "@/core/shared"
import { closeSheet } from "@/data/overlay"
import { download, joinWithCode, messageFor, openClass } from "@/data/classes"
import type { SpaceSummary } from "@/data/types"
import { Button, Note, SheetBody, SheetFoot, SheetHead, TextInput } from "./fields"

type Stage = { at: "code" } | { at: "loading"; space: SpaceSummary } | { at: "done"; space: SpaceSummary; here: boolean }
const TITLE = "m-0 text-[22px] leading-[1.22] font-[750] tracking-[-.02em] text-foreground"
const asRole = (role: string) => (role === "editor" ? "an editor" : "a " + role)

export function JoinSheet({ code: given, space }: { code: string; space: SpaceSummary | null }) {
    const [code, setCode] = useState(given)
    const [stage, setStage] = useState<Stage>(space ? { at: "loading", space } : { at: "code" })
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState("")

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

    if (stage.at === "loading") return (
        <>
            <SheetHead kind="Joining" onClose={closeSheet} />
            <SheetBody>
                <div role="status"><h2 className={TITLE}>Downloading {stage.space.name}…</h2></div>
                <Note>The class's course and items land on this device, so they work offline.</Note>
            </SheetBody>
        </>
    )
    if (stage.at === "done") {
        const { space: s, here } = stage
        return (
            <>
                <SheetHead kind="Joined" onClose={closeSheet} />
                <SheetBody>
                    <h2 className={TITLE}>You're in {s.name}</h2>
                    <Note>{s.members} {s.members === 1 ? "member" : "members"} · you joined as {asRole(s.role)}.</Note>
                    {!here && <Note>It hasn't finished downloading. It arrives with the next sync.</Note>}
                </SheetBody>
                <SheetFoot hint="">
                    <Button variant="ghost" onClick={closeSheet}>Done</Button>
                    <Button onClick={() => openClass(s.id)}>Open the class</Button>
                </SheetFoot>
            </>
        )
    }
    return (
        <>
            <SheetHead kind="Join a class" onClose={closeSheet} />
            <SheetBody>
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
```

- [ ] **Step 4: The invites list**

`src/components/sheet/invites-sheet.tsx`:

```tsx
// Your invites to shared classes (spec §11), a plain list until the inbox (Stage 7): who
// sent each, with Accept or Decline. Accepting follows the class as it downloads.

import { useEffect, useState } from "react"
import { dayMonth, iso } from "@/core/dates"
import { closeSheet } from "@/data/overlay"
import { accept, decline, messageFor, openJoin, refreshInvites, useInvites } from "@/data/classes"
import type { Invite } from "@/data/types"
import { Button, Note, SheetBody, SheetFoot, SheetHead } from "./fields"

export function InvitesSheet() {
    const list = useInvites()
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState("")
    useEffect(() => { void refreshInvites() }, [])

    const yes = async (inv: Invite) => {
        setBusy(true); setErr("")
        try { openJoin("", await accept(inv.spaceId)) } catch (e) { setErr(messageFor(e)); setBusy(false) }
    }
    const no = async (inv: Invite) => {
        setBusy(true); setErr("")
        try { await decline(inv.spaceId) } catch (e) { setErr(messageFor(e)) } finally { setBusy(false) }
    }

    return (
        <>
            <SheetHead kind="Invites" onClose={closeSheet} />
            <SheetBody>
                <h2 className="m-0 text-[22px] leading-[1.22] font-[750] tracking-[-.02em]">Invites</h2>
                <Note>Invites to shared classes. Nothing is pushed: new ones show when Term opens or you come back to it.</Note>
                {list.length === 0 ? <Note>Nothing new.</Note> : (
                    <ul aria-label="Invites to you" className="m-0 flex list-none flex-col gap-1.5 p-0">
                        {list.map((inv) => (
                            <li key={inv.spaceId} className="flex flex-col gap-1.5 rounded-lg bg-muted px-3 py-2 text-[12.5px]">
                                <span><b>{inv.from}</b> invited you to the shared class <b>{inv.name}</b></span>
                                <span className="text-[11px] text-muted-foreground">As {inv.role} · {dayMonth(iso(new Date(inv.createdAt)))}</span>
                                {inv.expired ? <Note>This invite has expired. Ask for a new one.</Note> : (
                                    <span className="flex gap-2">
                                        <Button variant="ghost" disabled={busy} aria-label={"Decline the invite to " + inv.name} onClick={() => void no(inv)}>Decline</Button>
                                        <Button disabled={busy} aria-label={"Accept the invite to " + inv.name} onClick={() => void yes(inv)}>Accept</Button>
                                    </span>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
                {err && <Note tone="bad">{err}</Note>}
            </SheetBody>
            <SheetFoot hint="">
                <Button variant="ghost" onClick={closeSheet}>Close</Button>
            </SheetFoot>
        </>
    )
}
```

- [ ] **Step 5: Show them in the sheet**

In `src/components/sheet/sheet.tsx`, after the line `const ConvertSheet = lazyNamed(() => import("./convert-sheet"), "ConvertSheet", { idle: false })` add:

```tsx
const JoinSheet = lazyNamed(() => import("./join-sheet"), "JoinSheet", { idle: false })
const InvitesSheet = lazyNamed(() => import("./invites-sheet"), "InvitesSheet", { idle: false })
```

and after the line `                {shown?.kind === "convert" && <ConvertSheet key={shown.courseId} courseId={shown.courseId} />}` add:

```tsx
                {shown?.kind === "join" && <JoinSheet key={shown.space?.id ?? "code:" + shown.code} code={shown.code} space={shown.space} />}
                {shown?.kind === "invites" && <InvitesSheet />}
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/components/sheet/classes.test.tsx src/components/sheet/sheet.test.tsx`, then `npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/sheet/join-sheet.tsx src/components/sheet/invites-sheet.tsx src/components/sheet/sheet.tsx src/components/sheet/classes.test.tsx
git commit -m "Joining a class with a code, and the list of invites to you

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JpUR1JXMY3ehtkiJwuij95"
npm run build
```

---

### Task 12: The sidebar, for admins

**Files:**
- Create: `src/components/sidebar-classes.tsx`
- Modify: `src/components/sidebar.tsx`
- Modify: `src/components/sidebar.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `src/components/sidebar.test.tsx`, replace

```ts
const fake = vi.hoisted(() => ({
    data: { items: [] as unknown[], courses: [] as unknown[], quotes: [] as unknown[], study_sessions: [] as unknown[], profile: null as unknown },
```

with

```ts
const fake = vi.hoisted(() => ({
    data: { items: [] as unknown[], courses: [] as unknown[], quotes: [] as unknown[], study_sessions: [] as unknown[], profile: null as unknown, spaces: [] as unknown[], shared_courses: [] as unknown[] },
    invites: [] as { spaceId: string; expired: boolean }[],
```

after the block

```ts
vi.mock("@/data/actions", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/data/actions")>()),
    openCourse: vi.fn(),
    openSettings: vi.fn(),
}))
```

add

```ts
const classes = vi.hoisted(() => ({ openClass: vi.fn(), openInvites: vi.fn(), openJoin: vi.fn(), openNewClass: vi.fn() }))
vi.mock("@/data/classes", () => ({ ...classes, useInvites: () => fake.invites }))
```

in the top-level `beforeEach`, after `    fake.data.courses = []` add:

```ts
    fake.data.spaces = []
    fake.data.shared_courses = []
    fake.invites = []
```

and append:

```tsx
describe("shared classes, for admins", () => {
    beforeEach(() => {
        fake.data.profile = { ...(fake.data.profile as object), isAdmin: true }
        fake.data.spaces = [{
            id: "sp0000000001", scope: "c:sp0000000001", kind: "class", role: "owner", name: "Web Services", archived: false, parent: null, revision: 5,
            members: [{ userId: "p", name: "Dr Demo", role: "owner" }, { userId: "q", name: "Sam", role: "member" }],
        }]
        fake.data.shared_courses = [{ scope: "c:sp0000000001", id: "web", name: "Web Services", color: "#17B3AE" }]
        fake.invites = [{ spaceId: "sp0000000002", expired: false }, { spaceId: "sp0000000003", expired: true }]
    })

    it("list each class under the courses, opening the class, and the invites waiting", () => {
        render(<Sidebar />)
        fireEvent.click(coursesNav().getByRole("button", { name: /^Web Services, shared, 2 members/ }))
        expect(classes.openClass).toHaveBeenCalledWith("sp0000000001")
        expect(coursesNav().getByRole("button", { name: /^Invites/ }).textContent).toBe("Invites1")
        fireEvent.click(coursesNav().getByRole("button", { name: /^Invites/ }))
        expect(classes.openInvites).toHaveBeenCalled()
    })

    it("turn + New course into a menu: a course, a shared class, or joining with a code", () => {
        render(<Sidebar />)
        expect(coursesNav().queryByRole("button", { name: "+ New course" })).toBeNull()
        const menu = () => { fireEvent.click(coursesNav().getByRole("button", { name: "+ New" })); return within(coursesNav().getByRole("menu", { name: "New" })) }
        fireEvent.click(menu().getByRole("menuitem", { name: /^New shared class/ }))
        expect(classes.openNewClass).toHaveBeenCalled()
        expect(coursesNav().queryByRole("menu")).toBeNull()
        fireEvent.click(menu().getByRole("menuitem", { name: /^Join with code/ }))
        expect(classes.openJoin).toHaveBeenCalled()
        fireEvent.click(menu().getByRole("menuitem", { name: /^New course/ }))
        expect(openCourse).toHaveBeenLastCalledWith(null)
    })

    it("close the menu on Escape, focus back on + New", () => {
        render(<Sidebar />)
        const button = coursesNav().getByRole("button", { name: "+ New" })
        fireEvent.click(button)
        const menu = coursesNav().getByRole("menu", { name: "New" })
        expect(document.activeElement).toBe(within(menu).getAllByRole("menuitem")[0])
        fireEvent.keyDown(menu, { key: "Escape" })
        expect(coursesNav().queryByRole("menu")).toBeNull()
        expect(document.activeElement).toBe(button)
    })
})

describe("shared classes, for everyone else", () => {
    it("are not there: no class rows, no invites, + New course as before", () => {
        fake.data.spaces = [{ id: "sp0000000001", scope: "c:sp0000000001", kind: "class", role: "owner", name: "Web Services", archived: false, parent: null, revision: 5, members: [] }]
        fake.invites = [{ spaceId: "sp0000000002", expired: false }]
        render(<Sidebar />)
        expect(coursesNav().queryByRole("button", { name: /Web Services/ })).toBeNull()
        expect(coursesNav().queryByRole("button", { name: /^Invites/ })).toBeNull()
        expect(coursesNav().getByRole("button", { name: "+ New course" })).toBeTruthy()
        expect(coursesNav().queryByRole("button", { name: "+ New" })).toBeNull()
    })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run src/components/sidebar.test.tsx`
Expected: FAIL: no class row, no "+ New" button, for the admin.

- [ ] **Step 3: `src/components/sidebar-classes.tsx`**

```tsx
// The sidebar's shared classes, for admins until Stage 6 (spec §15): each class under the
// courses with the shared glyph, opening the class sheet (its items stay out of the views
// until Stage 4); a row for the invites waiting; and + New as a menu: a course, a shared
// class, or joining with a code. The menu follows the ARIA menu pattern.

import { useEffect, useRef, useState, type KeyboardEvent } from "react"
import { useSharedCourses, useSpaces } from "@/data/store"
import { openClass, openInvites, openJoin, openNewClass, useInvites } from "@/data/classes"
import { openCourse } from "@/data/actions"
import { SharedGlyph } from "./shared-glyph"
import { Count, Pip } from "./sidebar-parts"

const ROW = "flex w-full min-w-0 items-center gap-2.5 rounded-[9px] border-0 bg-transparent px-2 py-1.5 text-left text-[13px] font-medium text-ink-2 hover:bg-muted hover:text-foreground"

/** Your classes, a row each, opening the class. */
export function ClassRows() {
    const spaces = useSpaces().filter((s) => s.kind === "class")
    const courses = useSharedCourses()
    return (
        <>
            {spaces.map((s) => {
                const c = courses.find((x) => x.scope === s.scope)
                const n = s.members.length, members = n + (n === 1 ? " member" : " members")
                return (
                    <button key={s.id} type="button" className={ROW} title={"Shared · " + members} onClick={() => openClass(s.id)}>
                        <Pip color={c?.color ?? "var(--ink-3)"} />
                        <span className="min-w-0 truncate">{s.name || c?.name || "Class"}</span>
                        <span className="sr-only">, shared, {members}</span>
                        <span className="ml-auto text-muted-foreground"><SharedGlyph /></span>
                    </button>
                )
            })}
        </>
    )
}

/** The invites waiting for you; with none, no row. */
export function InvitesRow() {
    const n = useInvites().filter((i) => !i.expired).length
    if (!n) return null
    return (
        <button type="button" className={ROW} onClick={openInvites}>
            <span className="min-w-0 truncate">Invites</span>
            <Count n={n} />
        </button>
    )
}

const ITEMS: readonly [string, string, () => void][] = [
    ["New course", "Only you", () => openCourse(null)],
    ["New shared class", "Blank, or convert a course", openNewClass],
    ["Join with code", "8 characters from a classmate", () => openJoin()],
]

/** + New: a course, a shared class, or joining with a code. */
export function NewMenu() {
    const [open, setOpen] = useState(false)
    const wrap = useRef<HTMLDivElement>(null)
    const button = useRef<HTMLButtonElement>(null)
    const menu = useRef<HTMLDivElement>(null)

    /* open, the first item takes focus; a click anywhere else closes */
    useEffect(() => {
        if (!open) return
        menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
        const away = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false) }
        document.addEventListener("mousedown", away)
        return () => document.removeEventListener("mousedown", away)
    }, [open])

    const close = () => { setOpen(false); button.current?.focus() }
    const keys = (e: KeyboardEvent<HTMLDivElement>) => {
        const opts = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'))
        const at = opts.indexOf(document.activeElement as HTMLElement), n = opts.length
        const to = e.key === "ArrowDown" ? (at + 1) % n : e.key === "ArrowUp" ? (at + n - 1) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1
        if (to >= 0) { e.preventDefault(); opts[to].focus() }
        /* the narrow sidebar must not close on this Escape */
        else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close() }
        else if (e.key === "Tab") setOpen(false)
    }

    return (
        <div ref={wrap} className="relative mt-1.5">
            <button
                ref={button}
                type="button"
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={() => setOpen((o) => !o)}
                className="w-full rounded-[9px] border border-dashed border-border bg-transparent px-2 py-1.5 text-left text-[12px] text-ink-2 hover:border-primary hover:text-primary"
            >
                + New
            </button>
            {open && (
                <div ref={menu} role="menu" aria-label="New" onKeyDown={keys}
                    className="absolute bottom-full left-0 z-50 mb-1 w-[230px] rounded-[10px] border border-border bg-card p-1 shadow-[var(--shadow-2)]">
                    {ITEMS.map(([label, sub, act]) => (
                        <button
                            key={label}
                            type="button"
                            role="menuitem"
                            tabIndex={-1}
                            onClick={() => { setOpen(false); act() }}
                            className="flex w-full cursor-pointer flex-col items-start gap-px rounded-md border-0 bg-transparent px-2.5 py-1.5 text-left font-[inherit] text-[12.5px] text-foreground outline-none hover:bg-muted focus-visible:bg-muted"
                        >
                            {label}
                            <span className="text-[11px] text-muted-foreground">{sub}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}
```

- [ ] **Step 4: Use them in the sidebar**

In `src/components/sidebar.tsx`, replace `import { useCourses, useItems } from "@/data/store"` with `import { useCourses, useItems, useProfile } from "@/data/store"`; after the line `import { SidebarPlayer } from "./spotify/sidebar-player"` add `import { ClassRows, InvitesRow, NewMenu } from "./sidebar-classes"`; in `CourseList`, after the line `    const cal = schoolCal()` add:

```tsx
    /* shared classes are for admins until Stage 6 */
    const admin = !!useProfile()?.isAdmin
```

and replace

```tsx
                <button
                    type="button"
                    onClick={() => openCourse(null)}
                    className="mt-1.5 w-full rounded-[9px] border border-dashed border-border bg-transparent px-2 py-1.5 text-left text-[12px] text-ink-2 hover:border-primary hover:text-primary"
                >
                    + New course
                </button>
```

with

```tsx
                {admin && <ClassRows />}
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
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/components/sidebar.test.tsx`, then `npm run typecheck`
Expected: PASS (the existing sidebar tests too), no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/sidebar-classes.tsx src/components/sidebar.tsx src/components/sidebar.test.tsx
git commit -m "Sidebar: an admin's classes, invites waiting, and + New as a menu

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JpUR1JXMY3ehtkiJwuij95"
npm run build
```

---

### Task 13: `/#join=` links, and invites fetched for admins

**Files:**
- Modify: `src/data/session.ts`
- Modify: `src/data/session.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/data/session.test.ts`, replace

```ts
    store: { open: vi.fn(async () => {}), close: vi.fn(async () => {}) },
}))
```

with

```ts
    store: { open: vi.fn(async () => {}), close: vi.fn(async () => {}) },
    classes: { openJoin: vi.fn(), watchInvites: vi.fn() },
}))
```

after the line `vi.mock("@/lib/lazy", () => ({ preloadIdle: vi.fn() }))` add:

```ts
vi.mock("./classes", () => fake.classes)
```

and append:

```ts
describe("a join link", () => {
    it("is read once and cleared; an admin gets the join sheet with its code, anyone else nothing", async () => {
        localStorage.setItem("rounds.session", JSON.stringify({ id: "u1" }))
        history.replaceState(null, "", "/#join=7KQ2M9XD")
        fake.store.open.mockImplementationOnce(async () => { fake.data.profile = { id: "u1", isAdmin: true } })
        await boot()
        expect(location.hash).toBe("")
        expect(fake.classes.openJoin).toHaveBeenCalledWith("7KQ2M9XD")
        expect(fake.classes.watchInvites).toHaveBeenCalled()

        vi.clearAllMocks()
        localStorage.setItem("rounds.session", JSON.stringify({ id: "u1" }))
        history.replaceState(null, "", "/#join=7KQ2M9XD")
        fake.store.open.mockImplementationOnce(async () => { fake.data.profile = { id: "u1" } })
        await boot()
        expect(location.hash).toBe("")
        expect(fake.classes.openJoin).not.toHaveBeenCalled()
        expect(fake.classes.watchInvites).not.toHaveBeenCalled()
    })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/data/session.test.ts`
Expected: FAIL: `location.hash` is still `#join=7KQ2M9XD`, and `openJoin` was not called.

- [ ] **Step 3: Read the link**

In `src/data/session.ts`, after the line `import { preloadIdle } from "@/lib/lazy"` add:

```ts
import { openJoin, watchInvites } from "./classes"
```

replace

```ts
    const back = spotifyReturn()
    if (back) { ui.spotifyNote = back; openSettings("spotifyGrp") }
}
```

with

```ts
    const back = spotifyReturn()
    if (back) { ui.spotifyNote = back; openSettings("spotifyGrp") }
    /* shared classes are for admins until Stage 6: their invites, and a join link's code */
    const join = joinReturn()
    if (p.isAdmin) {
        watchInvites()
        if (join) openJoin(join)
    }
}
```

and after the `spotifyReturn` function add:

```ts

/* A join link, /#join=<code> (spec §11): read once and cleared, so the code stays out of the
   history and never reaches the server. The join sheet checks it. */
function joinReturn(): string | null {
    const m = location.hash.match(/^#join=(.{0,32})$/)
    if (!m) return null
    history.replaceState(null, "", location.pathname + location.search)
    return m[1]
}
```

- [ ] **Step 4: Run it**

Run: `npx vitest run src/data/session.test.ts`, then `npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/data/session.ts src/data/session.test.ts
git commit -m "Session: /#join= opens the join sheet for admins; invites fetched for admins

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JpUR1JXMY3ehtkiJwuij95"
```

---

### Task 14: Documentation, the full check, and a check by hand

**Files:**
- Modify: `docs/DATA-MODEL.md` (the API table)

- [ ] **Step 1: Describe the class routes**

In `docs/DATA-MODEL.md`, in the `## API` table, after the row that starts ``| `GET /api/calendar/:userId/:token.ics?tz=` |`` add:

```markdown
| `POST /api/spaces` | `{kind:'class', course}` (blank) or `{kind:'class', convertCourseId, items:[id]}` → `201 {space}`; you become the owner. Admins only until Stage 6 (`403`). A convert copies your course and the items named into the class in class shape (no status, grade, checklist or notes of yours) and leaves your own course as it is; converting the same course again answers the class it made (`200`). `409 limit` past 20 spaces. |
| `GET /api/spaces/:sid` | → `{id, scope, kind, role, archived, members, invites, code}`: the members for everyone in the space, its invites for the owner and editors, the join code's expiry and uses left for the owner. `404` outside it. |
| `POST /api/spaces/:sid/invites` · `DELETE /api/spaces/:sid/invites/:userId` | `{username, role?}` → `201` the invite (30 days; a repeat refreshes it). The owner or an editor; only the owner gives a role other than the default. `404 no_user`, `409 member`, `409 not_admin` (until Stage 6); 20 an hour. DELETE withdraws it: whoever sent it, or the owner. |
| `GET /api/invites` · `POST /api/invites/:sid/accept` · `POST /api/invites/:sid/decline` | your invites, expired ones marked; accept → `{space}` (admins only until Stage 6; `404` once withdrawn, `410 expired`, `409 limit`/`full`); decline → `204`. |
| `POST /api/spaces/:sid/code` · `DELETE /api/spaces/:sid/code` | the owner: a new 8-character code → `201 {code, expires, usesLeft}` (7 days, 10 uses; only its SHA-256 is kept; a new one retires the old) · turn it off. |
| `POST /api/join` | `{code}` → `{space}`. Admins only until Stage 6; 10 tries an hour; `404` unknown, `410 expired`, `409 limit`/`full`. A pending invite to that class is accepted with it, with its role. |
| `PUT /api/spaces/:sid/members/:userId` · `POST /api/spaces/:sid/transfer` | the owner: `{role: 'editor'\|'member'}` → `{userId, role}`; `{userId}` makes that member the owner and you an editor → `204`. |
```

- [ ] **Step 2: Run everything**

Run: `npm run check`
Expected: typecheck clean, every Vitest project and the node tests pass, the build succeeds. (Stop any dev server on 8787 first, and kill a leftover vite on 8787/8790; rule 2.)

- [ ] **Step 3: Check the app by hand**

Use three accounts on the local dev server (`npm run dev`, then `npm run db:local` if the local database lacks `0003_invites.sql`): **A** and **B** admins (make B an admin on the Admin page → Accounts), **C** not an admin. Two browsers, or one normal and one private window.

1. **C sees nothing new.** The sidebar shows **+ New course** (no menu, no class rows, no Invites row); a course's sheet has no **Share this course**; the Network tab shows no request to `/api/invites`, and no `class-sheet`/`members-tab`/`join-sheet` chunk loads. Open `/#join=7KQ2M9XD`: the hash disappears and nothing opens.
2. **A makes a blank class.** **+ New → New shared class**, Blank, name *Operating Systems*, code *OS*, Continue: the class sheet opens on Members; the sidebar lists *Operating Systems* with the glyph (hover: "Shared · 1 member"). Details shows the code and no items. Week, Month and All items are unchanged.
3. **A invites.** Type `nobody-here` → "No Term account named 'nobody-here'."; type C's username → "… can't join shared classes yet …"; type B's username → "Invited …"; B appears under **Invited** as Pending.
4. **B accepts.** B's sidebar shows **Invites 1** (reload, or switch tabs away and back). Open it → *A invited you to the shared class Operating Systems* → **Accept** → "Downloading Operating Systems…" → "You're in Operating Systems · 2 members · you joined as a member" → **Open the class**. B's Members tab shows "Owners and editors invite people. Ask … for a join code." and no controls.
5. **A converts a course.** Open a course of A's with a task, a graded item, a lecture review (Settings → reviews on) and an item of a custom type → **Share this course → Convert to shared class**: graded items ticked, the task unticked, the review and the custom item greyed with "stays yours"; the links warning shows when a ticked item has links. **Create class** → the class opens on Members; a toast says the course stays as it is. A's Week still shows the course's items, grades intact. The course sheet now offers **Open the class**.
6. **Codes.** A, on the Members tab of the class converted in item 5 (B is not in it): **Make a join code** → the code and its link show once; reopen the sheet → "A join code works until …, for 10 more people". Copy the link; in B's browser open it: the join sheet opens with the code filled in → **Join** → "Downloading …" → B is in. A's code now reads 9 more people. **Turn off**; B opens the link again → "That doesn't match a class. …".
7. **Roles and handing on.** A sets B to Editor: after B's next sync (switch away and back), B's Members tab shows the invite box. A → **Hand the class on** → B → **Make owner** → confirm: A's tab now shows A as Editor without the code box; B's shows the code box.
8. **Offline.** In B's browser, DevTools → Network → Offline → **+ New → Join with code** → a code → "You seem to be offline. This needs a connection." Back online.

Stop the dev server and make sure nothing holds 8787/8790.

- [ ] **Step 4: Commit**

```bash
git add docs/DATA-MODEL.md
git commit -m "Docs: the class routes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JpUR1JXMY3ehtkiJwuij95"
```

---

### Task 15: Apply the migration remotely, then merge and push

> **Superseded (2026-10-06): Stages 3 and 4 ship together.** Skip this task. After Task 14, go on to Stage 4's Tasks 16–30 (`docs/superpowers/plans/2026-10-06-collab-stage-4-layer.md`) on this branch; its Task 30 applies `0003_invites.sql` and `0004_marks.sql` remotely, then merges and pushes.

**Only with George's yes** (rule 6): ask him before Step 1, and run nothing below until he says yes. The order matters: the new Worker's class routes and the admin page's health check read `invites`, and the Cloudflare Git build does **not** apply migrations, so the remote database must have `0003_invites.sql` **before** `main` moves. This stage changes no IndexedDB version, so a client rollback stays possible; the migration only adds a table.

- [ ] **Step 1: Ask George, then apply the migration to the live database**

Ask: "Stage 3 is ready. May I run `npm run db:remote` (applies `0003_invites.sql` to rounds-v7), then merge `collab-3-classes` to `main` and push?" With his yes:

Run: `npm run db:remote`
Expected: wrangler lists `0003_invites.sql` as the one migration to apply on `rounds-v7` and reports it applied.

- [ ] **Step 2: Check the live database**

Run: `npm run db:check -- --remote`
Expected: every check passes and the table counts print (no "no such table").

- [ ] **Step 3: Merge and push**

```bash
git switch main
git pull --ff-only
git merge --no-ff collab-3-classes -m "Merge collab-3-classes: shared classes for admins (Stage 3)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JpUR1JXMY3ehtkiJwuij95"
npm run check
git push origin main
```

Expected: `npm run check` green on `main`; the push starts the Cloudflare Git build (`npm run build`), which deploys without touching D1.

- [ ] **Step 4: Check the live site**

Once the build is live, open the site (hard reload). As a non-admin: nothing has changed (Task 14 Step 3, item 1). As George (admin): **+ New** is a menu; making a blank test class works and it shows in the sidebar; the Admin page's health shows `0003_invites.sql` as the latest migration. If a class route answers 500, check first that the remote migration was applied (`npx wrangler d1 migrations list DB --remote`).

---

## Self-review against the spec (done while writing this plan)

| Spec requirement (Stage 3 part) | Where |
|---|---|
| §3 `invites (space_id, user_id)`: `invited_by`, `role` (given on accept), `status` pending/accepted/declined, `created_at`, `expires_at` (30 days); index for invites to me; the purge index on `created_at` | Task 1 (the purge itself is Stage 5: master plan) |
| §3 limits: 20 spaces per user on join, accept or create → `409 limit`; 30 members per space | Tasks 3, 5, 6 (inside the statement: Decision 12) |
| §5 owner/editor invite with the default role; another role, codes and role changes owner-only; transfer owner-only; an owner cannot demote themselves; role guards in the statement | Tasks 2 (`ownerGuard`, `assertOwner`), 4, 5, 6 |
| §5 default join role: member (class), editor (project) | Tasks 5, 6 |
| §5 transfer demotes before it promotes, one batch | Task 4 |
| §11 invite by username; `404 no_user`; 20 an hour; upsert refreshes the one invite | Task 5 |
| §11 accept: one batch, pending and unexpired, membership made or revived with the invite's role, marked accepted; next sync loads from 0 | Task 5 (activity is Stage 7; `space_prefs` Stage 4: Decision 3) |
| §11 decline (the inviter sees it), expired → `410` and shown as expired, withdrawn → accept `404`, already a member → `409 member`, removed then invited again (revives the row), space deleted → `404`, at the limit → `409 limit` with the invite still pending | Tasks 4, 5 |
| §11 codes: owner, 8 Crockford characters (~40 bits), SHA-256, 7 days, ≤ 10 uses, a new one retires the old; `/#join=` read like `#spotify=` and cleared; 10 attempts an hour; `409 full`; joining by code accepts a pending invite | Tasks 2 (`normalizeCode`), 6, 13 |
| §11 joining continues on the device: "Downloading …" until the first page lands | Task 11 (semester/colour/calendar/merge: Stage 4/6, Decision 3) |
| §13 convert: set-based batch, safe to retry, the picker (tasks unticked; lecture reviews and custom-typed items cannot be ticked), "Links become visible to the class" | Tasks 3, 10 (copies rather than moves until Stage 4: Decisions 1, 2) |
| §14 `POST /api/spaces`, `GET /api/spaces/:sid`, `PUT …/members/:uid`, `POST …/transfer`, `POST …/invites`, `DELETE …/invites/:uid`, `POST /api/invites/:sid/accept · /decline`, `POST|DELETE …/code`, `POST /api/join` | Tasks 3–6; plus `GET /api/invites` for the inbox stub (Decision 15) |
| §14 errors keep `{error, field?}`; rate limits through `worker/limits.js` | Tasks 5, 6 |
| §15 **+ New course** becomes a menu (New course, New shared class, Join with code); classes in the course list with the two-person glyph and "Shared · n members" | Task 12 (New team project: Stage 8) |
| §15 the class's sheet with Members (names, roles, invite, code, transfer); Convert on a personal course | Tasks 9, 10 (remove, archive, merge and Activity: Stages 4, 5, 7) |
| §17 scope and ids from the Worker; role escalation (editors invite only with the default role, role changes owner-only, one-owner index); invitation abuse (rate limits, existing accounts only, upsert); guessable codes (~40 bits, hashed, 7 days, use limit, 10 attempts an hour) | Tasks 2–6 |
| §18 no fan-out: joining writes one membership; a handful of statements per batch | Tasks 3, 5, 6 |
| §20 create a class → one batch → the next sync pages the scope; join → membership batch → sync from 0 → join screen | Tasks 3, 5, 6, 8, 11 |
| §22 admin-only: the UI behind `profile.isAdmin`, and create/accept/join `403` for non-admins; removing and leaving not offered | Tasks 3, 5, 6 (routes), 10, 12, 13 (client); Decisions 6, 16, 18 |
| §23 the admin-only gate refusing non-admins; convert (with custom-typed items and reviews left personal) run twice with identical results; every new `CHECK`; `move-db.mjs` against the fixture | Tasks 1, 3, 5, 6 |

Not in Stage 3, by the master plan or the decisions above: `space_prefs` and the join screen's choices, marks, a moving convert and the merge sheet (Stage 4); remove, leave, archive, the nightly purge of invites, account deletion handing spaces on (Stage 5); the outline and school-calendar offers, and lifting the gate (Stage 6); activity, the inbox and its unread count (Stage 7); projects (Stages 8–10).
