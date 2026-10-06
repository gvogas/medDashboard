# Collaboration Stage 2: Spaces and sync v3 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

This is **Stage 2** of the master plan `docs/superpowers/plans/2026-10-02-collaboration.md` (its "The stages" table and the Stage 2 outline). Stage 1 is live: courses, items and the change feed are keyed by `scope`, and `worker/db.js` exports `personal(userId)`.

**Goal:** Add spaces and memberships, a guarded shared-row API with field-level merge, and sync v3 (one cursor per scope, `sv`, `revoked`) end to end, client included. Nothing changes for anyone: there is still no way to create a space, and every screen shows exactly what it shows today.

**Architecture:** `migrations/0002_spaces.sql` adds `spaces` and `members`. `worker/access.js` builds every guard as a SQL fragment that runs inside the statement it protects. `worker/db.js` gains shared-row reads and writes (whole row at a matching revision, else a field-level merge on `changed`) and `syncPageV3`. On the client, IndexedDB version 5 adds `shared_courses`, `shared_items` and `spaces` and moves the cursor into `meta.cursors`; `src/core/sync.ts` pulls v3, applies `revoked` after the last page, rejects 403 at once and pushes shared edits with the fields they changed; `src/data/effective.ts` is the one read path for the views.

**Tech Stack:** Cloudflare Workers + D1 (plain JS ES modules), React 19 + TypeScript + Vite, IndexedDB (fake-indexeddb in node tests), Vitest (Workers pool + jsdom), wrangler.

**Spec:** `docs/superpowers/specs/2026-10-02-shared-classes-design.md`: §2, §3, §5, §6, §7, §16, §17, §23.

---

## How to work in this repo (read before any task)

1. **Checks:** `npm run typecheck`, `npm test` (Vitest: Workers + jsdom projects, then node tests), `npm run build`. `npm run check` runs all three. One file: `npx vitest run test/scope.test.js`. The node tests: `npm run test:local`.
2. **Dev server:** `npm run dev` → http://127.0.0.1:8787. On this Windows machine a stopped dev server can leave `vite.js` holding 8787/8790 and serving old code: check `Get-NetTCPConnection -LocalPort 8787 -State Listen` in PowerShell first and stop the owning process. Don't run `npm run build` while the dev server runs.
3. **Line endings:** keep every file LF. A CRLF in `index.html` breaks the CSP hash.
4. **Non-ASCII** (·, —, α): write it with the Edit/Write tools, never through a shell; after a commit that adds any, `npm run build` (Vite refuses Latin-1 bytes that tests miss).
5. **Deploying:** the Cloudflare Git build runs `npm run build` and does **not** apply remote D1 migrations. A stage with a migration needs `npm run db:remote` and `npm run db:check -- --remote` before its merge to `main`. After changing `wrangler.jsonc`, run `npm run build` before `npx wrangler deploy` (deploy uses the config the build generated).
6. **Commits:** end each message with the two lines below. Commit only on the stage branch; never push, merge to `main` or touch remote D1 without George's yes.
   ```
   Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
   Claude-Session: https://claude.ai/code/session_01JpUR1JXMY3ehtkiJwuij95
   ```
7. **Workers AI:** the automated tests use fakes; never call real AI from a test (10k neurons a day, shared with the live site).

Branch: work on `collab-2-sync` (it exists; `git switch collab-2-sync`). The suite stays green after every task.

---

## Decisions this plan takes (where the spec left a choice, or the platform forced one)

1. **The v3 page is a batch, not one `UNION ALL`.** The spec (§6 step 2) pages every scope in one `UNION ALL` statement. Checked on 2026-10-05 in the local Workers runtime: D1 refuses a compound SELECT of more than 5 terms (`too many terms in compound SELECT`; 5 works, 6 and 21 fail). `readPage` therefore sends one statement per scope, each `ORDER BY seq LIMIT 101` with its membership guard inside, in **one `db.batch`** with the floor/head read. A batch is one round trip and one transaction, so the properties the spec wants (≤ 101 rows per scope, guard inside the reading statement, a consistent floor and head) all hold. The Worker merges the branches by `seq` and cuts at 101.
2. **Space revisions are monotonic across spaces.** "The next global sequence value" (§3) does not move when only spaces change, so two spaces touched with no row write between them would get the same revision, and a client holding the first as its `sv` would miss the second's member list. `NEXT_SPACE_REVISION` (in `worker/spaces.js`) is `MAX(changes head, MAX(spaces.revision)) + 1`, served by an index on `spaces (revision)`.
3. **Per-scope reset, v2-style.** A scope whose non-zero cursor is below the floor (or above the head) comes back in `reset` with its cursor at 0 and `more: true`; its rows are left out of that response (filtered before the page is cut, so no other scope skips rows). The client wipes that scope's clean rows on that same reset page, in the transaction that stores its cursor 0: the page carries none of the scope's rows, so nothing is lost, and a failed next request cannot leave a stored 0 with the old rows still held (the Worker never resets cursor 0, so that would page from 0 without a wipe). Like v2, a personal cursor of 0 or none at the start of a pull wipes the personal scope's clean rows first. Cursor 0 never resets.
4. **`changed` is computed when pushing, not stored.** A pending op stores `base` (the row when first queued); `src/core/shared.ts` `changedFields(op)` derives `changed: {field: old value}` from `base` vs `body` at upload time. A create (`base` null) names every shared field; the server takes the table's defaults as the old values for a create (§6).
5. **Views: personal rows keep their bare id as key.** `effectiveItems()`/`effectiveCourses()` return today's arrays themselves (same references) while no shared row is shown; a shared row gets `key = '<scope>/<id>'`, `source`, and items `courseKey`. A personal id never looks like `c:<12 chars>/…` (ids are generated by `uid()`), so keys cannot collide, the course filter (`ui.course`) and React keys keep working unchanged, and the views are key-correct for Stage 4.
6. **Shared rows stay out of the views until Stage 4** (`SHARED_IN_VIEWS = false` in `src/data/effective.ts`). Without marks and the split item card, a class item shown in the Week could be ticked through the personal save path and duplicated into the person's own scope. Stage 4 turns the flag on together with marks and audits the writers (item card, course sheet, pickers) that read `useItems()`/`useCourses()`.
7. **Who reads the effective lists in Stage 2:** the hooks `useItems()`/`useCourses()` (so every component), the selectors in `src/data/views.ts`, and the read-only `data.items`/`data.courses` uses in `src/data/actions.ts` and `src/data/ai-context.ts`. Writers that read `data.*` to build personal rows (imports, reviews, school calendar moves, study pickers, achievements) stay personal; Stage 4 moves grades, stats, achievements, exam prep, reviews and pickers (master plan Stage 4 bullet).
8. **Shared-route answers:** someone outside the space gets `404 {error:'not_found'}` for everything under `/api/spaces/:sid/`. A member asking for an editor action gets `403 {error:'forbidden'}`; any write to an archived space `403 {error:'archived'}`. The class's course and the project's `project` item are made with the space (Stage 3): a `PUT` with `If-Match: "0"` on them, or any `DELETE` of them, is `403 forbidden`. A `DELETE` of a shared row that answers `404` goes to Conflicts on the client (it can mean lost access), unlike a personal one.
9. **Class rows are forced into class shape.** `PUT /api/spaces/:sid/items/:id` in a class takes only shared fields: status is stored `todo`, grade `null`, checklist `[]`, completion `null` (the `c:` CHECK), a custom type is `400 {field:'type'}`, a missing course `400 {field:'courseId'}`. A class course is stored with `target: null, archived: false`. Project rows refuse a grade, weight or course (`400`), and `type` must be `task`, or `project` exactly for the id `project`.
10. **`members.user_id` cascades on account deletion** (`ON DELETE CASCADE`). Stage 5 transfers or deletes owned spaces before deleting the account (§13); until then nobody has a space.
11. **The client keeps `api.sync` (v2)** because `test/api-client.test.js` exercises it against the real Worker; the sync loop calls the new `api.syncV3`. Stage 3 may drop the v2 client call with its tests. The `/api/sync?v=2` route itself stays for stale tabs (§16).
12. **The `inbox` count** in the v3 response arrives with the inbox (Stage 7); Stage 2 does not send it.
13. **A resync carries a tagged cursor below the floor.** `floor` is global, so a scope paging from 0 could end a page below it and be reset to 0 forever. A scope that started from 0 and is still below the floor gets back `r<seq>.<floor>` (the floor its resync began at); the client stores and sends that token as it came, and the Worker pages on from it while the floor is unchanged (that scope was wiped, so a tombstone purged before the resync began is nothing it holds), resets it if a purge has moved the floor since, and answers a plain number once the scope is past the floor. Each scope's cursor moves to just below its first undelivered row (the head when none is left), so a scope that paged nothing does not drop below the floor. A plain non-zero cursor below the floor still resets (decision 3). v2 keeps the old behaviour: an old client refuses a cursor that moves back, so no number it echoes could carry the mark and later drop it. A space the person left between `readMemberships` and `readPage` (checked in readPage's batch) is dropped from `scopes` and `cursors` and revoked if sent.
14. **A project member sets only `todo` or `done`.** Any other status is `403 forbidden`. `completedAt` is the Worker's: kept when the task was already complete, `now` when it becomes so, `null` on reopening; a `completedAt` sent alone changes nothing. A status, claim or unclaim that changes nothing answers the current row without moving its revision.

## File map

| File | Change |
|---|---|
| `migrations/0002_spaces.sql` | new: `spaces`, `members`, their indexes |
| `scripts/lib/move-db.js` | `TABLES` gains `spaces`, `members`; a source without them reads as empty |
| `worker/spaces.js` | new: `NEXT_SPACE_REVISION`, `touchSpace()` |
| `worker/access.js` | new: `parseScope`, `scopeOf`, `memberGuard`, `writerGuard`, `editorGuard`, `roleOf`, `assertAllowed` |
| `src/core/shared.ts` | new, shared by Worker and client: `SHARED_FIELDS`, `stable`, `changedFields`, `parseKey`, `sharedKey` |
| `worker/validate.js` | `validateSharedCourse`, `validateSharedItem`, `validateChanged` |
| `worker/db.js` | `getShared`, `upsertShared`, `deleteShared`, `memberTaskWrite`, `readMemberships`, `readPage`, `syncPageV3` |
| `worker/api.js` | `/api/spaces/:sid/(courses\|items)/:id` GET/PUT/DELETE; `GET /api/sync?v=3` |
| `src/core/types.ts` | `Space`, `SharedCourse`, `SharedItem` |
| `src/core/db.ts` | IndexedDB version 5 |
| `src/core/store.ts` | shared rows in memory, v3 `applyPage`, `applyRevoked`, `saveShared`, `removeShared`, `spaceRevision` |
| `src/core/api.ts` | `syncV3`, `shared.get/put/del` |
| `src/core/sync.ts` | v3 pull, `sv`, `revoked`, 403, shared pushes |
| `src/data/effective.ts` | new: `effectiveItems()`, `effectiveCourses()`, `keyOf`, `courseKeyOf` |
| `src/data/store.ts`, `src/data/views.ts`, `src/data/actions.ts`, `src/data/ai-context.ts` | read the effective lists, key by `keyOf`/`courseKeyOf` |
| `docs/DATA-MODEL.md` | `spaces`, `members`, sync v3 |
| Tests | new `test/spaces.js` (helper), `test/spaces-schema.test.js`, `test/access.test.js`, `test/shared-rows.test.js`, `test/shared-routes.test.js`, `test/sync-v3.test.js`, `src/data/effective.test.ts`; changed `test/move-db.test.js`, `test/sync.test.js`, `test/local-store.node.mjs` |

---

### Task 1: Record the trigger-upsert spike (done while planning)

The master plan asks, first thing in Stage 2, whether D1 accepts a coalescing upsert inside a trigger body, so Stage 7's activity design is settled before the shared write routes exist.

**Result, run on 2026-10-05 while writing this plan** (a throwaway `test/spike-trigger-upsert.test.js` in the Workers pool, local D1, then deleted): **yes.** A trigger `AFTER UPDATE ON spike_src WHEN OLD.title != NEW.title` whose body ran

```sql
INSERT INTO spike_act (subject, bucket, first_from, last_to)
SELECT NEW.id, 7, OLD.title, NEW.title WHERE true
ON CONFLICT (subject, bucket) DO UPDATE SET last_to = excluded.last_to, n = n + 1;
DELETE FROM spike_act WHERE subject = NEW.id AND bucket = 7 AND first_from = last_to;
```

coalesced two updates (`one → two → three`) into one row `{first_from: 'one', last_to: 'three', n: 2}`, deleted it when the title went back to `one`, and behaved the same for two updates inside one `db.batch`. So Stage 7 uses the triggers; the Worker-batch fallback is not needed. (`sqlite_version()` is not callable on D1: "not authorized to use function".)

**Files:**
- Modify: `docs/superpowers/plans/2026-10-02-collaboration.md` (Stage 7 outline; already edited while planning)

- [ ] **Step 1: Check the master plan carries the result**

Run: `git grep -n "verified 2026-10-05" docs/superpowers/plans/2026-10-02-collaboration.md`
Expected: one line in the Stage 7 outline ("D1 accepts the coalescing upsert inside a trigger body: verified 2026-10-05 …") and one in the Stage 2 outline's spike bullet. Both were committed with this plan; nothing to do if they are there. If they are missing, add them as quoted above and commit with the message `Master plan: D1 accepts an upsert inside a trigger (Stage 7 spike)`.

- [ ] **Step 2: Make sure no spike file is left**

Run: `git ls-files test | grep -i spike` 
Expected: no output.

---

### Task 2: `spaces` and `members` (migration 0002)

**Files:**
- Create: `migrations/0002_spaces.sql`
- Create: `test/spaces-schema.test.js`
- Modify: `scripts/lib/move-db.js`
- Modify: `test/move-db.test.js`
- Modify: `docs/DATA-MODEL.md`

- [ ] **Step 1: Write the failing schema test**

`test/spaces-schema.test.js`:

```js
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createUser } from './helpers.js';

const FAILS = /CHECK constraint failed/;
/* Raw rows, so these tests see the schema's own rules and not the Worker's. */
function space(id, kind = 'class', cols = {}) {
  const row = { kind, created_at: 1, updated_at: 1, ...cols };
  const names = Object.keys(row);
  return env.DB.prepare(`INSERT INTO spaces (id, ${names.join(', ')}) VALUES (?, ${names.map(() => '?').join(', ')})`)
    .bind(id, ...Object.values(row)).run();
}
const member = (spaceId, userId, role) => env.DB.prepare(
  'INSERT INTO members (space_id, user_id, role, joined_at, updated_at) VALUES (?, ?, ?, 1, 1)',
).bind(spaceId, userId, role).run();

describe('spaces and members in the schema', () => {
  it('takes 12-character Worker-made ids and the two kinds only', async () => {
    await space('aaaaaaaaaaa1');
    await space('aaaaaaaaaaa2', 'project');
    await expect(space('short')).rejects.toThrow(FAILS);
    await expect(space('AAAAAAAAAAA3')).rejects.toThrow(FAILS);
    await expect(space('aaaaaaaaaa-4')).rejects.toThrow(FAILS);
    await expect(space('aaaaaaaaaaa5', 'group')).rejects.toThrow(FAILS);
  });

  it('keeps the school calendar on classes and the parent link, whole, on projects', async () => {
    await space('bbbbbbbbbbb1', 'class', { school_calendar: '{"terms":[]}' });
    await space('bbbbbbbbbbb2', 'project', { parent_space: 'bbbbbbbbbbb1', parent_item: 'a1' });
    await expect(space('bbbbbbbbbbb3', 'project', { school_calendar: '{}' })).rejects.toThrow(FAILS);
    await expect(space('bbbbbbbbbbb4', 'class', { parent_space: 'bbbbbbbbbbb1', parent_item: 'a1' })).rejects.toThrow(FAILS);
    await expect(space('bbbbbbbbbbb5', 'project', { parent_space: 'bbbbbbbbbbb1' })).rejects.toThrow(FAILS);
    await expect(space('bbbbbbbbbbb6', 'class', { school_calendar: '[1]' })).rejects.toThrow(FAILS);
  });

  it('allows one live owner per space, and only the three roles', async () => {
    const a = await createUser('space-owner-a'), b = await createUser('space-owner-b');
    await space('ccccccccccc1');
    await member('ccccccccccc1', a, 'owner');
    await expect(member('ccccccccccc1', b, 'owner')).rejects.toThrow(/UNIQUE constraint failed/);
    await member('ccccccccccc1', b, 'editor');
    await env.DB.prepare("UPDATE members SET deleted_at = 5 WHERE space_id = 'ccccccccccc1' AND user_id = ?").bind(a).run();
    await env.DB.prepare("UPDATE members SET role = 'owner' WHERE space_id = 'ccccccccccc1' AND user_id = ?").bind(b).run();
    await expect(env.DB.prepare("UPDATE members SET role = 'admin' WHERE space_id = 'ccccccccccc1' AND user_id = ?").bind(b).run()).rejects.toThrow(FAILS);
  });

  it('ties each membership to a real space and a real account', async () => {
    const a = await createUser('space-fk');
    await expect(member('nonexistent1', a, 'member')).rejects.toThrow(/FOREIGN KEY constraint failed/);
    await space('ddddddddddd1');
    await expect(member('ddddddddddd1', 'u-nobody', 'member')).rejects.toThrow(/FOREIGN KEY constraint failed/);
  });

  it.each([
    ["SELECT space_id FROM members WHERE user_id = 'u' AND deleted_at IS NULL", 'members_user'],
    ["SELECT id FROM spaces WHERE code_hash = 'x'", 'spaces_code'],
    ['SELECT MAX(revision) FROM spaces', 'spaces_revision'],
  ])('uses an index for %s', async (sql, index) => {
    const plan = await env.DB.prepare('EXPLAIN QUERY PLAN ' + sql).all();
    expect(plan.results.some((row) => row.detail.includes(index))).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run test/spaces-schema.test.js`
Expected: FAIL with `no such table: spaces`.

- [ ] **Step 3: Write the migration**

`migrations/0002_spaces.sql`:

```sql
-- Shared spaces: a class ('c:<id>' scope) or a team project ('p:<id>'), and who is in it.
-- A space has no name of its own: a class is named by its one course, a project by its
-- 'project' item. Spec: docs/superpowers/specs/2026-10-02-shared-classes-design.md §3.

CREATE TABLE spaces (
  -- 12 characters of [a-z0-9], made by the Worker, never by a client.
  id              TEXT PRIMARY KEY CHECK (length(id) = 12 AND id NOT GLOB '*[^a-z0-9]*'),
  kind            TEXT NOT NULL CHECK (kind IN ('class', 'project')),
  archived        INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  -- The owner's school calendar, offered to joiners who have none (class only).
  school_calendar TEXT CHECK (school_calendar IS NULL OR (json_valid(school_calendar) AND json_type(school_calendar) = 'object')),
  -- The class assignment a project belongs to (project only; ids, no foreign key).
  parent_space    TEXT CHECK (parent_space IS NULL OR length(parent_space) = 12),
  parent_item     TEXT CHECK (parent_item IS NULL OR length(parent_item) BETWEEN 1 AND 24),
  -- The join code, stored as its SHA-256 (hex), with its expiry and uses left.
  code_hash       TEXT CHECK (code_hash IS NULL OR length(code_hash) = 64),
  code_expires    INTEGER,
  code_uses_left  INTEGER CHECK (code_uses_left IS NULL OR code_uses_left BETWEEN 0 AND 10),
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  deleted_at      INTEGER,
  -- Moved on by every change to the space or its members (worker/spaces.js), so sync
  -- can tell which member lists moved.
  revision        INTEGER NOT NULL DEFAULT 1 CHECK (typeof(revision) = 'integer' AND revision > 0),
  CHECK (school_calendar IS NULL OR kind = 'class'),
  CHECK ((parent_space IS NULL AND parent_item IS NULL) OR (kind = 'project' AND parent_space IS NOT NULL AND parent_item IS NOT NULL))
);
CREATE INDEX spaces_revision ON spaces (revision);
CREATE INDEX spaces_code ON spaces (code_hash) WHERE code_hash IS NOT NULL;
CREATE INDEX spaces_deleted ON spaces (deleted_at) WHERE deleted_at IS NOT NULL;

CREATE TABLE members (
  space_id    TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  -- Deleting an account deletes its memberships; Stage 5 transfers or deletes the
  -- spaces it owns first.
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'member')),
  joined_at   INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  -- Left or removed. A rejoin revives the row.
  deleted_at  INTEGER,
  revision    INTEGER NOT NULL DEFAULT 1 CHECK (typeof(revision) = 'integer' AND revision > 0),
  PRIMARY KEY (space_id, user_id)
);
-- Exactly one live owner, stored nowhere else. A transfer demotes before it promotes.
CREATE UNIQUE INDEX members_one_owner ON members (space_id) WHERE role = 'owner' AND deleted_at IS NULL;
-- My spaces, on every sync.
CREATE INDEX members_user ON members (user_id) WHERE deleted_at IS NULL;
CREATE INDEX members_deleted ON members (deleted_at) WHERE deleted_at IS NOT NULL;
```

- [ ] **Step 4: Run the schema test**

Run: `npx vitest run test/spaces-schema.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: See the move test fail**

Run: `npx vitest run test/move-db.test.js`
Expected: FAIL in "names every source column the copy would leave behind": `uncopied(await columns(env.DB))` lists `members.space_id`, …, `spaces.id`, ….

- [ ] **Step 6: Add a test for a source made before the new tables**

Append to `test/move-db.test.js`:

```js
it('reads spaces and members as empty from a database made before them, and copies them after users', async () => {
  const queries = new Map(readQueries(await columns(env.MIGRATION_DB)));
  expect((await env.MIGRATION_DB.prepare(queries.get('spaces')).all()).results).toEqual([]);
  expect((await env.MIGRATION_DB.prepare(queries.get('members')).all()).results).toEqual([]);
  const sql = copyStatements({
    users: [{ id: 'ana', username: 'ana' }],
    spaces: [{ id: 'abcdefghij12', kind: 'class', archived: 0, created_at: 1, updated_at: 1, revision: 4 }],
    members: [{ space_id: 'abcdefghij12', user_id: 'ana', role: 'owner', joined_at: 1, updated_at: 1, revision: 4 }],
  });
  expect(sql.slice(0, 3).map((s) => s.split(' ').slice(0, 3).join(' '))).toEqual(['INSERT INTO users', 'INSERT INTO spaces', 'INSERT INTO members']);
});
```

- [ ] **Step 7: Extend the copy**

In `scripts/lib/move-db.js`, in `TABLES`, after the `users: […],` line add:

```js
  spaces: ['id', 'kind', 'archived', 'school_calendar', 'parent_space', 'parent_item', 'code_hash', 'code_expires', 'code_uses_left', 'created_at', 'updated_at', 'deleted_at', 'revision'],
  members: ['space_id', 'user_id', 'role', 'joined_at', 'updated_at', 'deleted_at', 'revision'],
```

Replace

```js
const ORDER_BY = { users: 'id', courses: 'scope, id', items: 'scope, id', changes: 'seq', spotify_tokens: 'user_id', admin_log: 'id' };
```

with

```js
const ORDER_BY = { users: 'id', spaces: 'id', members: 'space_id, user_id', courses: 'scope, id', items: 'scope, id', changes: 'seq', spotify_tokens: 'user_id', admin_log: 'id' };
/* Tables migrations/0002_spaces.sql added: a database made before it has none of their rows. */
const ADDED_TABLES = new Set(['spaces', 'members']);
```

In `readQueries`, replace

```js
  const has = new Set(columns.map(({ tbl, col }) => `${tbl}.${col}`));
```

with

```js
  const has = new Set(columns.map(({ tbl, col }) => `${tbl}.${col}`));
  const tables = new Set(columns.map(({ tbl }) => tbl));
```

and replace

```js
  const out = Object.entries(TABLES).map(([table, cols]) => {
    const list = cols.map((col) => (table === 'changes' && col === 'payload' && has.has('changes.user_id') ? PAYLOAD_FROM_USER : pick(table, col)));
```

with

```js
  const out = Object.entries(TABLES).map(([table, cols]) => {
    if (ADDED_TABLES.has(table) && !tables.has(table)) return [table, `SELECT ${cols.map((col) => `NULL AS "${col}"`).join(', ')} WHERE 0`];
    const list = cols.map((col) => (table === 'changes' && col === 'payload' && has.has('changes.user_id') ? PAYLOAD_FROM_USER : pick(table, col)));
```

- [ ] **Step 8: Run the move test**

Run: `npx vitest run test/move-db.test.js test/spaces-schema.test.js`
Expected: PASS (both files).

- [ ] **Step 9: Document the tables**

In `docs/DATA-MODEL.md`, insert before the line `## Indexes`:

```markdown
## `spaces`

A shared class (`kind = 'class'`, its rows in scope `c:<id>`) or team project (`'project'`, scope `p:<id>`). The id is 12 characters of `[a-z0-9]`, made by the Worker. A space has no name of its own: a class is named by its one course, a project by its `project` item. `archived` makes it read-only for everyone. `school_calendar` (class) is the owner's calendar offered to joiners; `parent_space`/`parent_item` (project) link it to a class assignment. `code_hash`/`code_expires`/`code_uses_left` hold the join code (Stage 3). `revision` moves on with every change to the space **or its members** (`worker/spaces.js`: above the change feed's head and above every other space's revision), so sync sends a member list only when it moved.

## `members`

`(space_id, user_id)`, `role` `owner`|`editor`|`member`, `joined_at`, `deleted_at` (left or removed; a rejoin revives the row). A partial unique index keeps exactly one live owner per space. Every shared read and write checks live membership of a live space inside its own statement (`worker/access.js`).
```

- [ ] **Step 10: Commit**

```bash
git add migrations/0002_spaces.sql test/spaces-schema.test.js scripts/lib/move-db.js test/move-db.test.js docs/DATA-MODEL.md
git commit -m "Spaces and members: migration 0002, copied by the move

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JpUR1JXMY3ehtkiJwuij95"
```

---

### Task 3: `worker/access.js` and the space revision

**Files:**
- Create: `worker/access.js`
- Create: `worker/spaces.js`
- Create: `test/spaces.js` (test helper, used by Tasks 3–7)
- Create: `test/access.test.js`

- [ ] **Step 1: Write the test helper**

`test/spaces.js`:

```js
// Spaces made straight in D1, the way Stage 3's routes will make them: no route creates
// one yet. Storage is per test file, so a counter keeps ids apart.
import { env } from 'cloudflare:test';
import { NEXT_SPACE_REVISION, touchSpace } from '../worker/spaces.js';

let n = 0;
/** A fresh space id: 12 characters of [a-z0-9]. */
export const newSpaceId = () => 'sp' + String(++n).padStart(10, '0');

/**
 * A space with its members ({userId: role}) and its class course (id `course`) or its
 * project item (id 'project'). Returns {id, scope, course}.
 */
export async function makeSpace({ kind = 'class', members = {}, archived = 0, course = 'web' } = {}) {
  const id = newSpaceId(), scope = (kind === 'class' ? 'c:' : 'p:') + id;
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO spaces (id, kind, archived, created_at, updated_at, revision) VALUES (?, ?, ?, 1, 1, ${NEXT_SPACE_REVISION})`).bind(id, kind, archived),
    ...Object.entries(members).map(([userId, role]) =>
      env.DB.prepare('INSERT INTO members (space_id, user_id, role, joined_at, updated_at) VALUES (?, ?, ?, 1, 1)').bind(id, userId, role)),
    kind === 'class'
      ? env.DB.prepare("INSERT INTO courses (scope, id, code, name, color, created_at, updated_at) VALUES (?, ?, 'WEB', 'Web Services', '#17B3AE', 1, 1)").bind(scope, course)
      : env.DB.prepare("INSERT INTO items (scope, id, type, title, date, status, created_at, updated_at) VALUES (?, 'project', 'project', 'Fire Response API', '2026-10-15', 'todo', 1, 1)").bind(scope),
  ]);
  return { id, scope, course };
}

/** Join (a role), change role, or leave (null), moving the space's revision on in the same batch. */
export function setMember(spaceId, userId, role) {
  return env.DB.batch([
    role === null
      ? env.DB.prepare('UPDATE members SET deleted_at = 2, updated_at = 2, revision = revision + 1 WHERE space_id = ? AND user_id = ?').bind(spaceId, userId)
      : env.DB.prepare(`INSERT INTO members (space_id, user_id, role, joined_at, updated_at) VALUES (?, ?, ?, 2, 2)
          ON CONFLICT (space_id, user_id) DO UPDATE SET role = excluded.role, deleted_at = NULL, updated_at = 2, revision = revision + 1`).bind(spaceId, userId, role),
    touchSpace(env.DB, spaceId, 2),
  ]);
}

/** A shared item written raw (class rows need the class course). */
export function sharedItem(scope, id, cols = {}) {
  const row = { type: scope.startsWith('p:') ? 'task' : 'assignment', title: id, date: '2026-10-15', status: 'todo', created_at: 1, updated_at: 1, ...cols };
  const names = Object.keys(row);
  return env.DB.prepare(`INSERT INTO items (scope, id, ${names.join(', ')}) VALUES (?, ?, ${names.map(() => '?').join(', ')})`)
    .bind(scope, id, ...Object.values(row)).run();
}

export const spaceRevision = async (id) => (await env.DB.prepare('SELECT revision FROM spaces WHERE id = ?').bind(id).first()).revision;
```

- [ ] **Step 2: Write the failing test**

`test/access.test.js`:

```js
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createUser } from './helpers.js';
import { makeSpace, setMember, spaceRevision } from './spaces.js';
import { assertAllowed, editorGuard, memberGuard, parseScope, roleOf, scopeOf, writerGuard } from '../worker/access.js';
import { touchSpace } from '../worker/spaces.js';
import { upsertRow } from '../worker/db.js';

const check = async (g) => (await env.DB.prepare(`SELECT ${g.sql} AS ok`).bind(...g.binds).first()).ok;
/* [read, write as a member, write as an editor] */
const row = async (space, user) => [await check(memberGuard(space.id, user)), await check(writerGuard(space.id, user)), await check(editorGuard(space.id, user))];

describe('scopes', () => {
  it('parse the three kinds and refuse anything else', () => {
    expect(parseScope('u:u-ana')).toEqual({ kind: 'user', userId: 'u-ana' });
    expect(parseScope('c:abcdefghij12')).toEqual({ kind: 'class', spaceId: 'abcdefghij12' });
    expect(parseScope('p:abcdefghij12')).toEqual({ kind: 'project', spaceId: 'abcdefghij12' });
    for (const bad of ['', 'u:', 'c:short', 'c:ABCDEFGHIJ12', 'x:abcdefghij12', 'c:abcdefghij123', 'u:a,b', 'u:' + 'x'.repeat(39), 42, null]) {
      expect(parseScope(bad)).toBeNull();
    }
    expect(scopeOf('class', 'abcdefghij12')).toBe('c:abcdefghij12');
    expect(scopeOf('project', 'abcdefghij12')).toBe('p:abcdefghij12');
  });
});

describe('the guards', () => {
  it('let each role do what spec §5 allows, in a live space and an archived one', async () => {
    const ids = {};
    for (const name of ['owner', 'editor', 'member', 'left', 'outsider']) ids[name] = await createUser('ac-' + name);
    const live = await makeSpace({ members: { [ids.owner]: 'owner', [ids.editor]: 'editor', [ids.member]: 'member', [ids.left]: 'member' } });
    await setMember(live.id, ids.left, null);
    const archived = await makeSpace({ archived: 1, members: { [ids.owner]: 'owner', [ids.member]: 'member' } });
    expect(await row(live, ids.owner)).toEqual([1, 1, 1]);
    expect(await row(live, ids.editor)).toEqual([1, 1, 1]);
    expect(await row(live, ids.member)).toEqual([1, 1, 0]);
    expect(await row(live, ids.left)).toEqual([0, 0, 0]);
    expect(await row(live, ids.outsider)).toEqual([0, 0, 0]);
    expect(await row(archived, ids.owner)).toEqual([1, 0, 0]);
    expect(await row(archived, ids.member)).toEqual([1, 0, 0]);
  });

  it('see nothing of a deleted space', async () => {
    const owner = await createUser('ac-deleted');
    const s = await makeSpace({ members: { [owner]: 'owner' } });
    await env.DB.prepare('UPDATE spaces SET deleted_at = 5 WHERE id = ?').bind(s.id).run();
    expect(await row(s, owner)).toEqual([0, 0, 0]);
    expect(await roleOf(env.DB, owner, s.id)).toBeNull();
  });

  it('explain a refusal: 404 outside the space, 403 archived, 403 forbidden', async () => {
    const owner = await createUser('ac-why-owner'), member = await createUser('ac-why-member'), outsider = await createUser('ac-why-out');
    const s = await makeSpace({ kind: 'project', members: { [owner]: 'owner', [member]: 'member' } });
    expect(await roleOf(env.DB, member, s.id)).toEqual({ kind: 'project', role: 'member', archived: false });
    await expect(assertAllowed(env.DB, outsider, s.id, 'read')).rejects.toMatchObject({ status: 404, body: { error: 'not_found' } });
    await expect(assertAllowed(env.DB, member, s.id, 'editor')).rejects.toMatchObject({ status: 403, body: { error: 'forbidden' } });
    expect(await assertAllowed(env.DB, member, s.id, 'write')).toMatchObject({ role: 'member' });
    await env.DB.prepare('UPDATE spaces SET archived = 1 WHERE id = ?').bind(s.id).run();
    expect(await assertAllowed(env.DB, member, s.id, 'read')).toMatchObject({ archived: true });
    await expect(assertAllowed(env.DB, owner, s.id, 'editor')).rejects.toMatchObject({ status: 403, body: { error: 'archived' } });
  });
});

describe('space revisions', () => {
  it('move above every other space and the change feed, even when no row changed', async () => {
    const owner = await createUser('ac-revision');
    const a = await makeSpace({ members: { [owner]: 'owner' } }), b = await makeSpace({ members: { [owner]: 'owner' } });
    expect(await spaceRevision(b.id)).toBeGreaterThan(await spaceRevision(a.id));
    await touchSpace(env.DB, a.id).run();
    expect(await spaceRevision(a.id)).toBeGreaterThan(await spaceRevision(b.id));
    const saved = await upsertRow(env.DB, 'quotes', owner, 'q', { text: 'Go', source: '' });
    await touchSpace(env.DB, b.id).run();
    expect(await spaceRevision(b.id)).toBeGreaterThan(saved.revision);
  });
});
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `npx vitest run test/access.test.js`
Expected: FAIL with `Failed to load url ../worker/spaces.js` (or `Cannot find module`).

- [ ] **Step 4: Write `worker/spaces.js`**

```js
// Space rows (migrations/0002_spaces.sql). Stage 3 adds the routes that create and change them.

/**
 * The next space revision: above the change feed's head and above every space's own, so a
 * space whose row or members changed is always above the `sv` a client sends, even when no
 * course or item was written in between (spec §3, §6).
 */
export const NEXT_SPACE_REVISION =
  "(SELECT MAX(COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'changes'), 0), COALESCE((SELECT MAX(revision) FROM spaces), 0)) + 1)";

/** Move a space's revision on. Put it in the same batch as the change to the space or its members. */
export const touchSpace = (db, spaceId, now = Date.now()) =>
  db.prepare(`UPDATE spaces SET revision = ${NEXT_SPACE_REVISION}, updated_at = ? WHERE id = ?`).bind(now, spaceId);
```

- [ ] **Step 5: Write `worker/access.js`**

```js
// Who may do what in a shared space (spec §5). Every guard is a SQL fragment with its binds,
// run inside the statement that reads or writes, so there is no gap between the check and
// the act. A scope and a user id always come from the route and the session, never a body.
import { HttpError } from './http.js';

const SPACE_ID = /^[a-z0-9]{12}$/;
const PREFIX = { class: 'c', project: 'p' };

/**
 * 'u:<user id>' → {kind:'user', userId}; 'c:<space id>' → {kind:'class', spaceId};
 * 'p:<space id>' → {kind:'project', spaceId}; anything else null. A scope is at most 40
 * characters (the schema's CHECK) and never holds a comma (sync's cursor list).
 */
export function parseScope(scope) {
  if (typeof scope !== 'string' || scope.length > 40) return null;
  const prefix = scope.slice(0, 2), rest = scope.slice(2);
  if (prefix === 'u:') return rest && !/[\u0000-\u001f\u007f,]/.test(rest) ? { kind: 'user', userId: rest } : null;
  if ((prefix === 'c:' || prefix === 'p:') && SPACE_ID.test(rest)) return { kind: prefix === 'c:' ? 'class' : 'project', spaceId: rest };
  return null;
}

/** The scope of a space's rows. */
export const scopeOf = (kind, spaceId) => `${PREFIX[kind]}:${spaceId}`;

/* Live membership of a live space, plus what the action needs. */
const guard = (extra) => (spaceId, userId) => ({
  sql: `EXISTS (SELECT 1 FROM members AS gm JOIN spaces AS gs ON gs.id = gm.space_id
    WHERE gm.space_id = ? AND gm.user_id = ? AND gm.deleted_at IS NULL AND gs.deleted_at IS NULL${extra})`,
  binds: [spaceId, userId],
});
/** Reading a space: any live member, archived or not. */
export const memberGuard = guard('');
/** A member's own writes (completing a task): any live member of an unarchived space. */
export const writerGuard = guard(' AND gs.archived = 0');
/** Shared facts: the owner or an editor of an unarchived space. */
export const editorGuard = guard(" AND gs.archived = 0 AND gm.role IN ('owner', 'editor')");

/** {kind, role, archived} of this person in the space, or null outside it (or if it is deleted). */
export async function roleOf(db, userId, spaceId) {
  const r = await db.prepare(`SELECT s.kind, s.archived, m.role FROM members AS m JOIN spaces AS s ON s.id = m.space_id
    WHERE m.space_id = ? AND m.user_id = ? AND m.deleted_at IS NULL AND s.deleted_at IS NULL`).bind(spaceId, userId).first();
  return r ? { kind: r.kind, role: r.role, archived: r.archived === 1 } : null;
}

/**
 * Throws the answer a refused action gets: 404 to someone outside the space (ids reveal
 * nothing), 403 archived for a write to an archived space, 403 forbidden for a member
 * asking for an editor's action. `need` is 'read', 'write' or 'editor'. Returns the role
 * when the action is allowed, so a caller can look for another cause of a miss.
 */
export async function assertAllowed(db, userId, spaceId, need) {
  const r = await roleOf(db, userId, spaceId);
  if (!r) throw new HttpError(404, { error: 'not_found' });
  if (need === 'read') return r;
  if (r.archived) throw new HttpError(403, { error: 'archived' });
  if (need === 'editor' && r.role === 'member') throw new HttpError(403, { error: 'forbidden' });
  return r;
}
```

- [ ] **Step 6: Run the test**

Run: `npx vitest run test/access.test.js`
Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
git add worker/access.js worker/spaces.js test/spaces.js test/access.test.js
git commit -m "Access guards for spaces, and a space revision that always moves up

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JpUR1JXMY3ehtkiJwuij95"
```

---
### Task 4: Shared rows in `worker/db.js`, with the field-level merge

**Files:**
- Create: `src/core/shared.ts`
- Modify: `worker/db.js` (imports at the top; a new section after `syncPage`)
- Create: `test/shared-rows.test.js`

- [ ] **Step 1: Write the failing test**

`test/shared-rows.test.js`:

```js
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createUser } from './helpers.js';
import { makeSpace } from './spaces.js';
import { deleteShared, getShared, memberTaskWrite, upsertShared } from '../worker/db.js';
import { normalizeItem } from '../src/core/model.ts';

/* An item as the route hands it over: validated and in its scope's shape. */
const classItem = (over = {}) => ({
  ...normalizeItem({ id: 'x', type: 'assignment', title: 'REST API Project', courseId: 'web', date: '2026-10-15', weight: 20 }),
  status: 'todo', grade: null, checklist: [], completedAt: null, assignees: [], ...over,
});
const task = (over = {}) => ({ ...normalizeItem({ id: 't', type: 'task', title: 'Create incidents endpoint', date: '2026-10-10' }), assignees: [], ...over });

async function space(tag, kind = 'class') {
  const owner = await createUser(tag + '-owner'), editor = await createUser(tag + '-editor');
  const member = await createUser(tag + '-member'), other = await createUser(tag + '-other');
  const s = await makeSpace({ kind, members: { [owner]: 'owner', [editor]: 'editor', [member]: 'member', [other]: 'member' } });
  return { ...s, owner, editor, member, other };
}

describe('shared rows', () => {
  it('are written by editors, who are named on the row, and read by members', async () => {
    const s = await space('sr-write');
    const saved = await upsertShared(env.DB, 'items', s.scope, s.editor, 'x', classItem());
    expect(saved).toMatchObject({ id: 'x', scope: s.scope, updatedBy: s.editor, title: 'REST API Project', weight: 20, courseId: 'web' });
    expect(await getShared(env.DB, 'items', s.scope, s.member, 'x')).toMatchObject({ revision: saved.revision });
    expect(await env.DB.prepare("SELECT scope FROM changes WHERE kind = 'items' AND row_id = 'x' AND scope = ?").bind(s.scope).first()).toEqual({ scope: s.scope });
  });

  it('refuse members, outsiders, a course from outside the class, and an archived space', async () => {
    const s = await space('sr-refuse'), outsider = await createUser('sr-refuse-out');
    await expect(upsertShared(env.DB, 'items', s.scope, s.member, 'x', classItem())).rejects.toMatchObject({ status: 403, body: { error: 'forbidden' } });
    await expect(upsertShared(env.DB, 'items', s.scope, outsider, 'x', classItem())).rejects.toMatchObject({ status: 404 });
    expect(await getShared(env.DB, 'items', s.scope, outsider, 'x')).toBeNull();
    await expect(upsertShared(env.DB, 'items', s.scope, s.editor, 'x', classItem({ courseId: 'nope' }))).rejects.toMatchObject({ status: 400, body: { field: 'courseId' } });
    await env.DB.prepare('UPDATE spaces SET archived = 1 WHERE id = ?').bind(s.id).run();
    await expect(upsertShared(env.DB, 'items', s.scope, s.owner, 'x', classItem())).rejects.toMatchObject({ status: 403, body: { error: 'archived' } });
  });

  it('merge disjoint edits made at the same revision, so both stand', async () => {
    const s = await space('sr-disjoint');
    const v1 = await upsertShared(env.DB, 'items', s.scope, s.owner, 'x', classItem());
    const gabriel = await upsertShared(env.DB, 'items', s.scope, s.owner, 'x', classItem({ date: '2026-10-18' }), { revision: v1.revision, changed: { date: '2026-10-15' } });
    const alex = await upsertShared(env.DB, 'items', s.scope, s.editor, 'x', classItem({ notes: 'Teams of 3' }), { revision: v1.revision, changed: { notes: '' } });
    expect(alex).toMatchObject({ date: '2026-10-18', notes: 'Teams of 3', updatedBy: s.editor });
    expect(alex.revision).toBe(gabriel.revision + 1);
  });

  it('refuse one field changed by two people, naming the field and who changed it first', async () => {
    const s = await space('sr-same');
    const v1 = await upsertShared(env.DB, 'items', s.scope, s.owner, 'x', classItem());
    await upsertShared(env.DB, 'items', s.scope, s.owner, 'x', classItem({ date: '2026-10-18' }), { revision: v1.revision, changed: { date: '2026-10-15' } });
    await expect(upsertShared(env.DB, 'items', s.scope, s.editor, 'x', classItem({ date: '2026-10-20' }), { revision: v1.revision, changed: { date: '2026-10-15' } }))
      .rejects.toMatchObject({ status: 409, body: { error: 'conflict', fields: ['date'], by: s.owner, current: { date: '2026-10-18' } } });
  });

  it('compare JSON fields by value, whatever the key order', async () => {
    const s = await space('sr-json');
    const links = [{ label: 'Brief', url: 'https://example.edu' }];
    const v1 = await upsertShared(env.DB, 'items', s.scope, s.owner, 'x', classItem({ links }));
    await upsertShared(env.DB, 'items', s.scope, s.owner, 'x', classItem({ links, date: '2026-10-18' }), { revision: v1.revision, changed: { date: '2026-10-15' } });
    const saved = await upsertShared(env.DB, 'items', s.scope, s.editor, 'x', classItem({ links, title: 'REST API' }),
      { revision: v1.revision, changed: { links: [{ url: 'https://example.edu', label: 'Brief' }], title: 'REST API Project' } });
    expect(saved).toMatchObject({ title: 'REST API', date: '2026-10-18', links });
  });

  it('never merge onto a deleted row, and refuse deleting a row edited since', async () => {
    const s = await space('sr-delete');
    const v1 = await upsertShared(env.DB, 'items', s.scope, s.owner, 'x', classItem());
    const v2 = await upsertShared(env.DB, 'items', s.scope, s.owner, 'x', classItem({ date: '2026-10-18' }), { revision: v1.revision, changed: { date: '2026-10-15' } });
    await expect(deleteShared(env.DB, 'items', s.scope, s.editor, 'x', 5, v1.revision)).rejects.toMatchObject({ status: 409, body: { by: s.owner, current: { revision: v2.revision } } });
    await expect(deleteShared(env.DB, 'items', s.scope, s.member, 'x', 5, v2.revision)).rejects.toMatchObject({ status: 403 });
    expect(await deleteShared(env.DB, 'items', s.scope, s.owner, 'x', 5, v2.revision)).toBe(true);
    await expect(upsertShared(env.DB, 'items', s.scope, s.editor, 'x', classItem({ notes: 'Late' }), { revision: v1.revision, changed: { notes: '' } }))
      .rejects.toMatchObject({ status: 409, body: { fields: ['notes'], current: { deletedAt: 5 } } });
    expect(await deleteShared(env.DB, 'items', s.scope, s.owner, 'nothing', 5, 1)).toBe(false);
  });

  it('merge two first writes of one new row against the defaults', async () => {
    const s = await space('sr-create');
    await upsertShared(env.DB, 'items', s.scope, s.owner, 'y', classItem({ title: 'Lab 1' }));
    const both = await upsertShared(env.DB, 'items', s.scope, s.editor, 'y', classItem({ title: 'Lab 1', notes: 'Bring goggles' }), { revision: 0, changed: { title: null, notes: null } });
    expect(both).toMatchObject({ title: 'Lab 1', notes: 'Bring goggles', updatedBy: s.editor });
  });

  it('treat a stale write without `changed` as a whole-row write, as an old client sends it', async () => {
    const s = await space('sr-old');
    const v1 = await upsertShared(env.DB, 'items', s.scope, s.owner, 'x', classItem());
    await upsertShared(env.DB, 'items', s.scope, s.owner, 'x', classItem({ date: '2026-10-18' }), { revision: v1.revision });
    const refused = await upsertShared(env.DB, 'items', s.scope, s.editor, 'x', classItem({ notes: 'x' }), { revision: v1.revision }).catch((e) => e);
    expect(refused).toMatchObject({ status: 409, body: { error: 'conflict', current: { date: '2026-10-18' } } });
    expect(refused.body).not.toHaveProperty('fields');
  });

  it('retry once when another write lands between reading the row and merging onto it', async () => {
    const s = await space('sr-race');
    const v1 = await upsertShared(env.DB, 'items', s.scope, s.owner, 'x', classItem());
    const v2 = await upsertShared(env.DB, 'items', s.scope, s.owner, 'x', classItem({ date: '2026-10-18' }), { revision: v1.revision, changed: { date: '2026-10-15' } });
    let raced = false;
    const racing = {
      prepare(sql) {
        const stmt = env.DB.prepare(sql);
        if (raced || !sql.startsWith('UPDATE items SET')) return stmt;
        raced = true;
        return { bind: (...args) => ({ first: async () => {
          await upsertShared(env.DB, 'items', s.scope, s.owner, 'x', classItem({ date: '2026-10-18', weight: 25 }), { revision: v2.revision, changed: { weight: 20 } });
          return stmt.bind(...args).first();
        } }) };
      },
      batch: (list) => env.DB.batch(list),
    };
    const saved = await upsertShared(racing, 'items', s.scope, s.editor, 'x', classItem({ notes: 'Teams of 3' }), { revision: v1.revision, changed: { notes: '' } });
    expect(raced).toBe(true);
    expect(saved).toMatchObject({ date: '2026-10-18', weight: 25, notes: 'Teams of 3' });
  });
});

describe('a project member writing a task', () => {
  it('completes a task assigned to them: only status and completion are written, and the Worker names who', async () => {
    const p = await space('mt-done', 'project');
    await upsertShared(env.DB, 'items', p.scope, p.owner, 't', task({ assignees: [p.member] }));
    const done = await memberTaskWrite(env.DB, p.scope, p.member, 't', task({ title: 'Hacked', status: 'done', completedAt: 5, assignees: [] }), { changed: { status: 'todo', completedAt: null } });
    expect(done).toMatchObject({ status: 'done', completedAt: 5, completedBy: p.member, title: 'Create incidents endpoint', assignees: [p.member], updatedBy: p.member });
  });

  it('refuses a task assigned to someone else, any other field, a whole-row write and an archived project', async () => {
    const p = await space('mt-refuse', 'project');
    await upsertShared(env.DB, 'items', p.scope, p.owner, 't', task({ assignees: [p.member] }));
    const forbidden = { status: 403, body: { error: 'forbidden' } };
    await expect(memberTaskWrite(env.DB, p.scope, p.other, 't', task({ status: 'done', completedAt: 5 }), { changed: { status: 'todo', completedAt: null } })).rejects.toMatchObject(forbidden);
    await expect(memberTaskWrite(env.DB, p.scope, p.member, 't', task({ title: 'Mine' }), { changed: { title: 'Create incidents endpoint' } })).rejects.toMatchObject(forbidden);
    await expect(memberTaskWrite(env.DB, p.scope, p.member, 't', task(), {})).rejects.toMatchObject(forbidden);
    await expect(memberTaskWrite(env.DB, p.scope, p.member, 'project', task({ status: 'done' }), { changed: { status: 'todo' } })).rejects.toMatchObject(forbidden);
    await env.DB.prepare('UPDATE spaces SET archived = 1 WHERE id = ?').bind(p.id).run();
    await expect(memberTaskWrite(env.DB, p.scope, p.member, 't', task({ status: 'done', completedAt: 5 }), { changed: { status: 'todo', completedAt: null } }))
      .rejects.toMatchObject({ status: 403, body: { error: 'archived' } });
  });

  it('claims an unassigned task and unclaims only themselves, from the current list', async () => {
    const p = await space('mt-claim', 'project');
    await upsertShared(env.DB, 'items', p.scope, p.owner, 't', task());
    const claimed = await memberTaskWrite(env.DB, p.scope, p.member, 't', task({ assignees: [p.member, p.other] }), { changed: { assignees: [] } });
    expect(claimed.assignees).toEqual([p.member]);
    await expect(memberTaskWrite(env.DB, p.scope, p.other, 't', task({ assignees: [p.other] }), { changed: { assignees: [] } })).rejects.toMatchObject({ status: 403 });
    const left = await memberTaskWrite(env.DB, p.scope, p.member, 't', task({ assignees: [] }), { changed: { assignees: [p.member] } });
    expect(left.assignees).toEqual([]);
  });

  it('lets anyone complete a task for everyone, and an editor\'s later edit keeps who completed it', async () => {
    const p = await space('mt-all', 'project');
    await upsertShared(env.DB, 'items', p.scope, p.owner, 't', task({ assignees: ['*'] }));
    const done = await memberTaskWrite(env.DB, p.scope, p.other, 't', task({ status: 'done', completedAt: 5, assignees: ['*'] }), { changed: { status: 'todo', completedAt: null } });
    expect(done.completedBy).toBe(p.other);
    const retitled = await upsertShared(env.DB, 'items', p.scope, p.editor, 't', task({ title: 'Incidents API', status: 'done', completedAt: 5, assignees: ['*'] }), { revision: done.revision });
    expect(retitled).toMatchObject({ title: 'Incidents API', completedBy: p.other });
    const reopened = await upsertShared(env.DB, 'items', p.scope, p.editor, 't', task({ title: 'Incidents API', assignees: ['*'] }), { revision: retitled.revision });
    expect(reopened.completedBy).toBeNull();
  });

  it('refuses an editor assigning someone who is not in the project', async () => {
    const p = await space('mt-assign', 'project'), outsider = await createUser('mt-assign-out');
    await expect(upsertShared(env.DB, 'items', p.scope, p.editor, 't', task({ assignees: [outsider] }))).rejects.toMatchObject({ status: 400, body: { field: 'assignees' } });
    expect(await upsertShared(env.DB, 'items', p.scope, p.editor, 't', task({ assignees: [p.member, p.other] }))).toMatchObject({ assignees: [p.member, p.other] });
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run test/shared-rows.test.js`
Expected: FAIL — `upsertShared` is not exported (`does not provide an export named 'deleteShared'` or similar).

- [ ] **Step 3: Write `src/core/shared.ts`**

```ts
// What the Worker and the client agree on about shared rows (a class's or a project's
// courses and items): the fields each kind shares, how two values compare, and how a
// pending key names a shared row. Plain TypeScript with no imports: worker/ uses it too.

/** The fields a shared row's `changed` may name, in API shape (spec §4). */
export const SHARED_FIELDS = {
  courses: ['code', 'name', 'color', 'instructor', 'term', 'meetings'],
  class: ['type', 'title', 'courseId', 'date', 'start', 'end', 'where', 'weight', 'notes', 'links', 'recur', 'weekday', 'recurUntil', 'dept'],
  project: ['type', 'title', 'date', 'start', 'end', 'where', 'status', 'notes', 'checklist', 'links', 'recur', 'weekday', 'recurUntil', 'dept', 'completedAt', 'assignees'],
} as const satisfies Record<string, readonly string[]>
export type FieldSet = keyof typeof SHARED_FIELDS

/** JSON with object keys sorted, so equal values compare equal however they were built. Undefined reads as null. */
export function stable(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']'
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return '{' + Object.keys(o).sort().map((k) => JSON.stringify(k) + ':' + stable(o[k])).join(',') + '}'
  }
  return JSON.stringify(v ?? null)
}

export type SharedStore = 'shared_courses' | 'shared_items'
export const SHARED_STORES: SharedStore[] = ['shared_courses', 'shared_items']

/** The pending key of a shared row: its store, then its scope, then its id. */
export const sharedKey = (store: SharedStore, scope: string, id: string): string => `${store}:${scope}:${id}`

/**
 * What a pending key names. 'profile'; a personal '<kind>:<id>'; a shared
 * 'shared_items:c:<space id>:<id>'. A space id never holds ':', so a shared scope ends at
 * the key's third ':'; the id after it may hold ':' itself (spec §7).
 */
export function parseKey(key: string): { store: string; scope: string | null; id: string } {
  if (key === 'profile') return { store: 'meta', scope: null, id: 'profile' }
  const at = key.indexOf(':'), store = key.slice(0, at), rest = key.slice(at + 1)
  if (store === 'shared_courses' || store === 'shared_items') {
    const end = rest.indexOf(':', 2)
    return { store, scope: rest.slice(0, end), id: rest.slice(end + 1) }
  }
  return { store, scope: null, id: rest }
}

/** The field set of a shared row: its course's, a class item's or a project item's. */
export const fieldSetOf = (store: string, scope: string): FieldSet =>
  store === 'shared_courses' || store === 'courses' ? 'courses' : scope.startsWith('p:') ? 'project' : 'class'

/**
 * What a shared edit changed since it was queued, as `changed: {field: value before}`.
 * A new row (no base) names every shared field with null before: the server merges a
 * create against its own defaults (spec §6).
 */
export function changedFields(store: string, scope: string, body: Record<string, unknown>, base: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of SHARED_FIELDS[fieldSetOf(store, scope)]) {
    if (!base) out[f] = null
    else if (stable(body[f]) !== stable(base[f])) out[f] = base[f] ?? null
  }
  return out
}
```

- [ ] **Step 4: Add the shared rows to `worker/db.js`**

Replace the import line

```js
import { HttpError } from './http.js';
```

with

```js
import { HttpError } from './http.js';
import { assertAllowed, editorGuard, memberGuard, parseScope, writerGuard } from './access.js';
import { stable } from '../src/core/shared.ts';
```

Then, after the end of `syncPage` (the line `}` closing it, just before `// ── Spotify ──…`), add:

```js
// ── shared rows: a class's or a project's courses and items ─────────────────
// The scope comes from the route ('c:' or 'p:' and a space id); every statement carries a
// guard from access.js. A write at the row's revision replaces the row, as a personal one
// does. Otherwise the fields named in `changed` ({field: value before}) merge onto the
// current row when each still holds its old or its new value (spec §6). Personal rows keep
// whole-row If-Match. `updated_by` and `completed_by` come from the session.

/* Columns a shared row has beyond a personal one. */
const SHARED_EXTRA = { courses: ['scope', 'updated_by'], items: ['scope', 'updated_by', 'assignees', 'completed_by'] };
const sharedCols = (table) => `${selectCols(table)}, ${SHARED_EXTRA[table].join(', ')}`;
function sharedToApi(table, r) {
  const out = { ...rowToApi(table, r), scope: r.scope, updatedBy: r.updated_by ?? null };
  if (table === 'items') Object.assign(out, { assignees: jsonOut(r.assignees), completedBy: r.completed_by ?? null });
  return out;
}
/* What each field holds before anyone sets it: what a first write merges against. */
const DEFAULTS = {
  courses: { code: '', name: '', color: null, instructor: '', term: '', meetings: [] },
  items: { type: 'task', title: '', courseId: null, date: null, start: '', end: '', where: '', status: 'todo', weight: null, notes: '', checklist: [], links: [], recur: null, weekday: null, recurUntil: null, dept: '', completedAt: null, assignees: [] },
};
/* An item's course must be a live course of the same scope (the class's one course). */
const COURSE_LIVE = '(? IS NULL OR EXISTS (SELECT 1 FROM courses WHERE scope = ? AND id = ? AND deleted_at IS NULL))';
/* Every assignee must be a live member of the project; "*" is everyone. */
const ASSIGNEES_LIVE = `NOT EXISTS (SELECT 1 FROM json_each(?) AS a WHERE a.value != '*'
  AND NOT EXISTS (SELECT 1 FROM members AS am WHERE am.space_id = ? AND am.user_id = a.value AND am.deleted_at IS NULL))`;
/* The checks an item write carries besides access: on the fields it writes (all, when `keys` is absent). */
function itemChecks(scope, fields, keys) {
  const out = [];
  if (!keys || keys.includes('courseId')) out.push({ sql: COURSE_LIVE, binds: [fields.courseId ?? null, scope, fields.courseId ?? null] });
  if (scope.startsWith('p:') && (!keys || keys.includes('assignees'))) out.push({ sql: ASSIGNEES_LIVE, binds: [jsonIn(fields.assignees), parseScope(scope).spaceId] });
  return out;
}
const conflict = (current, fields) =>
  new HttpError(409, { error: 'conflict', current, ...(fields ? { fields, by: current?.updatedBy ?? null } : {}) });

/** A shared row in API shape, if this person may read its space; deleted rows included. */
export async function getShared(db, table, scope, userId, id) {
  const g = memberGuard(parseScope(scope).spaceId, userId);
  const r = await db.prepare(`SELECT ${sharedCols(table)} FROM ${table} WHERE scope = ? AND id = ? AND ${g.sql}`).bind(scope, id, ...g.binds).first();
  return r ? sharedToApi(table, r) : null;
}

/* Insert or replace a whole shared row at a revision, as upsertStmt does for a personal one. */
function sharedUpsertStmt(db, table, scope, userId, id, fields, now, revision, guard) {
  const t = TABLES[table], row = t.toRow(fields), cols = Object.entries(t.cols);
  const names = ['scope', 'id', ...cols.map(([, col]) => col), 'updated_by', 'created_at', 'updated_at', 'deleted_at'];
  const values = [scope, id, ...cols.map(([field]) => row[field] ?? null), userId, now, now, null];
  const updates = [...cols.map(([, col]) => `${col} = excluded.${col}`), 'updated_by = excluded.updated_by', 'updated_at = excluded.updated_at', 'deleted_at = NULL', 'revision = revision + 1'];
  const checks = [guard];
  if (table === 'items') {
    names.push('assignees', 'completed_by');
    values.push(jsonIn(fields.assignees), scope.startsWith('p:') && fields.completedAt != null ? userId : null);
    /* whoever completed a task stays named until it is reopened */
    updates.push('assignees = excluded.assignees',
      'completed_by = CASE WHEN excluded.completed_at IS NULL THEN NULL WHEN items.completed_at IS NOT NULL THEN items.completed_by ELSE excluded.completed_by END');
    checks.push(...itemChecks(scope, fields));
  }
  return db.prepare(
    `INSERT INTO ${table} (${names.join(', ')}, revision) SELECT ${names.map(() => '?').join(', ')}, COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'changes'), 0) + 1
     WHERE (? = 0 OR EXISTS (SELECT 1 FROM ${table} WHERE scope = ? AND id = ?)) AND ${checks.map((c) => c.sql).join(' AND ')}
     ON CONFLICT (scope, id) DO UPDATE SET ${updates.join(', ')} WHERE revision = ?
     RETURNING ${sharedCols(table)}`,
  ).bind(...values, revision, scope, id, ...checks.flatMap((c) => c.binds), revision);
}

/* Write only `keys` onto the live row at `revision`. Each SET reads the row as it was. */
function sharedFieldsStmt(db, table, scope, userId, id, fields, keys, now, revision, guard) {
  const t = TABLES[table], row = t.toRow(fields), sets = [], binds = [];
  for (const f of keys) {
    if (f === 'assignees') { sets.push('assignees = ?'); binds.push(jsonIn(fields.assignees)); }
    else { sets.push(`${t.cols[f]} = ?`); binds.push(row[f] ?? null); }
  }
  if (table === 'items' && scope.startsWith('p:') && keys.includes('completedAt')) {
    sets.push('completed_by = CASE WHEN ? IS NULL THEN NULL WHEN completed_at IS NOT NULL THEN completed_by ELSE ? END');
    binds.push(fields.completedAt ?? null, userId);
  }
  sets.push('updated_by = ?', 'updated_at = ?', 'revision = revision + 1');
  binds.push(userId, now);
  const checks = [guard, ...(table === 'items' ? itemChecks(scope, fields, keys) : [])];
  return db.prepare(`UPDATE ${table} SET ${sets.join(', ')} WHERE scope = ? AND id = ? AND revision = ? AND deleted_at IS NULL
    AND ${checks.map((c) => c.sql).join(' AND ')} RETURNING ${sharedCols(table)}`)
    .bind(...binds, scope, id, revision, ...checks.flatMap((c) => c.binds));
}

/* Why a guarded write wrote nothing when the revision is not the reason: access (404/403),
   a course outside the class or an assignee outside the project (400). */
async function assertWritable(db, table, scope, userId, fields, need) {
  const { spaceId } = parseScope(scope);
  await assertAllowed(db, userId, spaceId, need);
  if (table !== 'items') return;
  if (fields.courseId && !(await db.prepare('SELECT 1 AS x FROM courses WHERE scope = ? AND id = ? AND deleted_at IS NULL').bind(scope, fields.courseId).first())) {
    throw new HttpError(400, { error: 'invalid', field: 'courseId' });
  }
  const ids = [...new Set((fields.assignees || []).filter((u) => u !== '*'))];
  if (scope.startsWith('p:') && ids.length) {
    const { n } = await db.prepare('SELECT count(*) AS n FROM members WHERE space_id = ? AND deleted_at IS NULL AND user_id IN (SELECT value FROM json_each(?))').bind(spaceId, JSON.stringify(ids)).first();
    if (n !== ids.length) throw new HttpError(400, { error: 'invalid', field: 'assignees' });
  }
}

/**
 * An owner's or editor's write to a shared row (spec §6 Push): the whole row at its
 * revision; else the fields in `changed` merged onto the current row, with one retry on a
 * lost race; else 409 {current, fields, by}. A create (revision 0) that meets a live row
 * merges against the table's defaults. A deleted row never merges. No `changed` (an old
 * client) is a whole-row write and a plain 409, as today.
 */
export async function upsertShared(db, table, scope, userId, id, fields, { revision = 0, changed, now = Date.now() } = {}) {
  const guard = editorGuard(parseScope(scope).spaceId, userId);
  const saved = await sharedUpsertStmt(db, table, scope, userId, id, fields, now, revision, guard).first();
  if (saved) return sharedToApi(table, saved);
  await assertWritable(db, table, scope, userId, fields, 'editor');
  for (let attempt = 0; ; attempt++) {
    const current = await getShared(db, table, scope, userId, id);
    if (!current) throw conflict(null);
    if (current.deletedAt || !changed) throw conflict(current, changed && Object.keys(changed));
    const keys = Object.keys(changed);
    const old = (f) => (revision === 0 ? DEFAULTS[table][f] : changed[f]);
    const unsafe = keys.filter((f) => stable(current[f]) !== stable(old(f)) && stable(current[f]) !== stable(fields[f]));
    if (unsafe.length) throw conflict(current, unsafe);
    const write = keys.filter((f) => stable(current[f]) !== stable(fields[f]));
    if (!write.length) return current;
    const merged = await sharedFieldsStmt(db, table, scope, userId, id, fields, write, now, current.revision, guard).first();
    if (merged) return sharedToApi(table, merged);
    if (attempt) throw conflict(await getShared(db, table, scope, userId, id), keys);
  }
}

/**
 * A project member's write to a task (spec §5): never the body as a whole. `changed` names
 * only status/completedAt (complete or reopen a task assigned to you or to everyone) or
 * only assignees (claim an unassigned task, or unclaim yourself, computed from the current
 * list). Checked against the current row, written at its revision, one retry.
 */
export async function memberTaskWrite(db, scope, userId, id, fields, { changed, now = Date.now() } = {}) {
  const { spaceId } = parseScope(scope);
  const keys = Object.keys(changed || {});
  const kind = keys.length && keys.every((f) => f === 'status' || f === 'completedAt') ? 'status' : keys.length === 1 && keys[0] === 'assignees' ? 'claim' : null;
  if (!kind) throw new HttpError(403, { error: 'forbidden' });
  const guard = writerGuard(spaceId, userId);
  const forbidden = () => new HttpError(403, { error: 'forbidden' });
  for (let attempt = 0; ; attempt++) {
    await assertAllowed(db, userId, spaceId, 'write');
    const current = await getShared(db, 'items', scope, userId, id);
    if (!current) throw new HttpError(404, { error: 'not_found' });
    if (current.deletedAt) throw conflict(current, keys);
    if (current.type !== 'task') throw forbidden();
    let set, binds;
    if (kind === 'status') {
      if (!current.assignees.includes(userId) && !current.assignees.includes('*')) throw forbidden();
      const unsafe = keys.filter((f) => stable(current[f]) !== stable(changed[f]) && stable(current[f]) !== stable(fields[f]));
      if (unsafe.length) throw conflict(current, unsafe);
      const status = keys.includes('status') ? fields.status : current.status;
      const completedAt = keys.includes('completedAt') ? fields.completedAt ?? null : current.completedAt;
      set = 'status = ?, completed_at = ?, completed_by = CASE WHEN ? IS NULL THEN NULL WHEN completed_at IS NOT NULL THEN completed_by ELSE ? END';
      binds = [status, completedAt, completedAt, userId];
    } else {
      const mine = current.assignees.includes(userId), wants = (fields.assignees || []).includes(userId);
      let next = current.assignees;
      if (wants && !mine) {
        if (current.assignees.length) throw forbidden();   // assigned to someone else
        next = [userId];
      } else if (!wants && mine) next = current.assignees.filter((u) => u !== userId);
      set = 'assignees = ?';
      binds = [JSON.stringify(next)];
    }
    const saved = await db.prepare(`UPDATE items SET ${set}, updated_by = ?, updated_at = ?, revision = revision + 1
      WHERE scope = ? AND id = ? AND revision = ? AND deleted_at IS NULL AND type = 'task' AND ${guard.sql} RETURNING ${sharedCols('items')}`)
      .bind(...binds, userId, now, scope, id, current.revision, ...guard.binds).first();
    if (saved) return sharedToApi('items', saved);
    if (attempt) throw conflict(await getShared(db, 'items', scope, userId, id), keys);
  }
}

/**
 * Soft-delete a shared row (owner or editor). False when there is no such row; true when it
 * is deleted (now or before); 409 {current, by} when it changed since `revision`.
 */
export async function deleteShared(db, table, scope, userId, id, now = Date.now(), revision = 0) {
  const { spaceId } = parseScope(scope);
  const g = editorGuard(spaceId, userId);
  const gone = await db.prepare(`UPDATE ${table} SET deleted_at = ?, updated_at = ?, updated_by = ?, revision = revision + 1
    WHERE scope = ? AND id = ? AND deleted_at IS NULL AND revision = ? AND ${g.sql} RETURNING id`)
    .bind(now, now, userId, scope, id, revision, ...g.binds).first();
  if (gone) return true;
  await assertAllowed(db, userId, spaceId, 'editor');
  const current = await getShared(db, table, scope, userId, id);
  if (!current) return false;
  if (current.deletedAt) return true;
  throw new HttpError(409, { error: 'conflict', current, by: current.updatedBy });
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run test/shared-rows.test.js test/scope.test.js test/rows.test.js`
Expected: PASS (all three; the personal paths are untouched).

- [ ] **Step 6: Commit**

```bash
git add src/core/shared.ts worker/db.js test/shared-rows.test.js
git commit -m "Shared rows: guarded reads and writes with a field-level merge

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JpUR1JXMY3ehtkiJwuij95"
```

---

### Task 5: The `/api/spaces/:sid/{courses,items}/:id` routes

Guarded, unused by the UI yet. Validation shapes a class row into class shape (Decision 9).

**Files:**
- Modify: `worker/validate.js`
- Modify: `worker/api.js`
- Create: `test/shared-routes.test.js`

- [ ] **Step 1: Write the failing test**

`test/shared-routes.test.js`:

```js
import { beforeAll, describe, expect, it } from 'vitest';
import { signIn } from './helpers.js';
import { makeSpace } from './spaces.js';

const ROLES = ['owner', 'editor', 'member', 'outsider'];
const as = {}, uid = (role) => `u-rt-${role}`;
let cls, proj;
beforeAll(async () => {
  for (const role of ROLES) as[role] = await signIn(`rt-${role}`);
  const members = { [uid('owner')]: 'owner', [uid('editor')]: 'editor', [uid('member')]: 'member' };
  cls = await makeSpace({ members });
  proj = await makeSpace({ kind: 'project', members });
});

const path = (s, table, id) => `/api/spaces/${s.id}/${table}/${id}`;
const put = (api, p, body, revision = 0) => api(p, { method: 'PUT', body, headers: { 'if-match': `"${revision}"` } });
const del = (api, p, revision) => api(p, { method: 'DELETE', headers: { 'if-match': `"${revision}"` } });
const item = (over = {}) => ({ type: 'assignment', title: 'REST API Project', courseId: 'web', date: '2026-10-15', status: 'todo', weight: 20, ...over });
const task = { type: 'task', title: 'Create incidents endpoint', date: '2026-10-10', status: 'todo', assignees: [] };

describe('shared routes', () => {
  it('answer 404 to someone outside the space, whatever they ask', async () => {
    for (const method of ['GET', 'PUT', 'DELETE']) {
      const res = await as.outsider(path(cls, 'items', 'x'), { method, body: method === 'PUT' ? item() : undefined, headers: { 'if-match': '"0"' } });
      expect(res.status).toBe(404);
    }
    expect((await as.owner(path(proj, 'courses', 'web'))).status).toBe(404);
    expect((await as.owner('/api/spaces/nonexistent1/items/x')).status).toBe(404);
  });

  it('let editors write class items, in class shape, and members only read them', async () => {
    const res = await put(as.editor, path(cls, 'items', 'a1'), item({ status: 'done', grade: 90, checklist: [{ id: 'c', text: 'x', done: true }] }));
    expect(res.status).toBe(200);
    const saved = await res.json();
    expect(saved).toMatchObject({ scope: cls.scope, updatedBy: uid('editor'), status: 'todo', grade: null, checklist: [], weight: 20 });
    expect(await (await as.member(path(cls, 'items', 'a1'))).json()).toMatchObject({ id: 'a1', revision: saved.revision });
    expect(await (await put(as.member, path(cls, 'items', 'a1'), item(), saved.revision)).json()).toEqual({ error: 'forbidden' });
    expect((await del(as.member, path(cls, 'items', 'a1'), saved.revision)).status).toBe(403);
    expect(await (await put(as.editor, path(cls, 'items', 'a2'), item({ type: 'c-quiz1' }))).json()).toEqual({ error: 'invalid', field: 'type' });
    expect(await (await put(as.editor, path(cls, 'items', 'a2'), item({ courseId: null }))).json()).toEqual({ error: 'invalid', field: 'courseId' });
    expect(await (await put(as.editor, path(cls, 'items', 'a2'), item({ courseId: 'other' }))).json()).toEqual({ error: 'invalid', field: 'courseId' });
    expect((await del(as.editor, path(cls, 'items', 'a1'), saved.revision)).status).toBe(204);
    expect((await as.member(path(cls, 'items', 'a1'))).status).toBe(404);
  });

  it('keep the class course and the project item, made with the space, from being created or deleted', async () => {
    const course = { code: 'WEB', name: 'Web Services', color: '#17B3AE', target: 80, archived: true, meetings: [] };
    expect((await put(as.owner, path(cls, 'courses', 'second'), course)).status).toBe(403);
    const current = await (await as.owner(path(cls, 'courses', 'web'))).json();
    const res = await put(as.owner, path(cls, 'courses', 'web'), { ...course, name: 'Web Services II' }, current.revision);
    expect(await res.json()).toMatchObject({ name: 'Web Services II', target: null, archived: false, updatedBy: uid('owner') });
    expect((await del(as.owner, path(cls, 'courses', 'web'), current.revision + 1)).status).toBe(403);
    expect((await del(as.owner, path(proj, 'items', 'project'), 1)).status).toBe(403);
    expect((await put(as.owner, path(proj, 'items', 'project'), { ...task, type: 'project' })).status).toBe(403);
    expect(await (await put(as.owner, path(proj, 'items', 'other'), { ...task, type: 'project' })).json()).toEqual({ error: 'invalid', field: 'type' });
    expect(await (await put(as.owner, path(proj, 'items', 'w'), { ...task, weight: 10 })).json()).toEqual({ error: 'invalid', field: 'weight' });
  });

  it('refuse writes to an archived space and still serve reads', async () => {
    const s = await makeSpace({ archived: 1, members: { [uid('owner')]: 'owner' } });
    expect(await (await put(as.owner, path(s, 'items', 'x'), item())).json()).toEqual({ error: 'archived' });
    expect((await as.owner(path(s, 'courses', 'web'))).status).toBe(200);
  });

  it('let a project member complete or claim a task and nothing else', async () => {
    const created = await (await put(as.editor, path(proj, 'items', 't1'), task)).json();
    const claimed = await (await put(as.member, path(proj, 'items', 't1'),
      { ...task, title: 'Mine now', assignees: [uid('member'), uid('editor')], changed: { assignees: [] } }, created.revision)).json();
    expect(claimed).toMatchObject({ assignees: [uid('member')], title: 'Create incidents endpoint' });
    const done = await (await put(as.member, path(proj, 'items', 't1'),
      { ...task, status: 'done', completedAt: 5, changed: { status: 'todo', completedAt: null } }, claimed.revision)).json();
    expect(done).toMatchObject({ status: 'done', completedBy: uid('member'), assignees: [uid('member')] });
    expect(await (await put(as.member, path(proj, 'items', 't1'), { ...task, title: 'x', changed: { title: 'Create incidents endpoint' } }, done.revision)).json()).toEqual({ error: 'forbidden' });
    expect(await (await put(as.member, path(proj, 'items', 't2'), task)).json()).toEqual({ error: 'forbidden' });
    expect(await (await put(as.editor, path(proj, 'items', 't3'), { ...task, assignees: [uid('outsider')] })).json()).toEqual({ error: 'invalid', field: 'assignees' });
    expect(await (await put(as.editor, path(proj, 'items', 't3'), { ...task, assignees: ['*', uid('member')] })).json()).toEqual({ error: 'invalid', field: 'assignees' });
  });

  it('merge through the route, and name the field and who on a conflict', async () => {
    const v1 = await (await put(as.owner, path(cls, 'items', 'm1'), item())).json();
    await put(as.owner, path(cls, 'items', 'm1'), { ...item({ date: '2026-10-18' }), changed: { date: '2026-10-15' } }, v1.revision);
    /* `by` names the row's last writer, so the conflict is checked before the editor's own merge */
    const same = await put(as.editor, path(cls, 'items', 'm1'), { ...item({ date: '2026-10-20' }), changed: { date: '2026-10-15' } }, v1.revision);
    expect(same.status).toBe(409);
    expect(await same.json()).toMatchObject({ error: 'conflict', fields: ['date'], by: uid('owner'), current: { date: '2026-10-18' } });
    const notes = await put(as.editor, path(cls, 'items', 'm1'), { ...item({ notes: 'Teams of 3' }), changed: { notes: '' } }, v1.revision);
    expect(await notes.json()).toMatchObject({ date: '2026-10-18', notes: 'Teams of 3' });
    expect(await (await put(as.editor, path(cls, 'items', 'm1'), { ...item(), changed: { status: 'todo' } }, v1.revision)).json()).toEqual({ error: 'invalid', field: 'changed' });
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run test/shared-routes.test.js`
Expected: FAIL — every shared path answers `404 not_found` from the router, so "let editors write class items" fails at `expect(res.status).toBe(200)` (received 404).

- [ ] **Step 3: Add the shared validators**

In `worker/validate.js`, replace

```js
import { SCHOOL_KINDS, SCHOOL_LIMITS, validDate } from '../src/core/school.ts';
```

with

```js
import { SCHOOL_KINDS, SCHOOL_LIMITS, validDate } from '../src/core/school.ts';
import { SHARED_FIELDS } from '../src/core/shared.ts';
```

and append to the end of the file:

```js
/* A class's course: the class's facts. Each member's target and "archived in my sidebar"
   are theirs (space_prefs, Stage 4), never on the shared row (the schema's CHECK). */
export function validateSharedCourse(body) {
  return { ...validateCourse(body), target: null, archived: false };
}

/* A task's assignees: user ids, or ["*"] for everyone. Membership is checked in the write. */
function assigneeList(v) {
  if (!Array.isArray(v) || v.length > 30) fail('assignees');
  v.forEach((u, i) => str(u, `assignees[${i}]`, 64, 1));
  if (new Set(v).size !== v.length || (v.includes('*') && v.length > 1)) fail('assignees');
  return v;
}

/**
 * A class's or a project's item, in the shape its scope allows. A class row holds the
 * class's facts: status, grade, checklist and completion are each member's own (marks,
 * Stage 4), so they are stored empty. A project row carries no grade, weight or course;
 * its type is task, or project for the space's one 'project' item.
 */
export function validateSharedItem(body, kind, id) {
  const out = validateItem(body);
  if (kind === 'class') {
    if (CUSTOM_TYPE.test(out.type)) fail('type');
    if (!out.courseId) fail('courseId');
    return { ...out, status: 'todo', grade: null, checklist: [], completedAt: null, assignees: [] };
  }
  if (!['task', 'project'].includes(out.type) || (out.type === 'project') !== (id === 'project')) fail('type');
  if (out.courseId !== null) fail('courseId');
  if (out.grade !== null) fail('grade');
  if (out.weight !== null) fail('weight');
  return { ...out, assignees: assigneeList(body.assignees ?? []) };
}

/** `changed`: {field: value before}, naming only the shared fields of `set` ('courses', 'class' or 'project'); absent for a whole-row write. */
export function validateChanged(body, set) {
  if (body.changed === undefined || body.changed === null) return undefined;
  const changed = obj(body.changed, 'changed');
  for (const f of Object.keys(changed)) if (!SHARED_FIELDS[set].includes(f)) fail('changed');
  return changed;
}
```

- [ ] **Step 4: Add the routes**

In `worker/api.js`, replace the two import lines

```js
import { validateProfile, validateCourse, validateItem, validateQuote, validateStudySession, validateAchievement, validateId } from './validate.js';
import { getUserForLogin, getProfile, updateProfile, getRow, upsertRow, deleteRow, syncPage, bumpPasswordGen, saveSpotifyTokens, deleteSpotifyTokens } from './db.js';
```

with

```js
import { validateProfile, validateCourse, validateItem, validateQuote, validateStudySession, validateAchievement, validateId, validateSharedCourse, validateSharedItem, validateChanged } from './validate.js';
import { getUserForLogin, getProfile, updateProfile, getRow, upsertRow, deleteRow, syncPage, bumpPasswordGen, saveSpotifyTokens, deleteSpotifyTokens, getShared, upsertShared, deleteShared, memberTaskWrite } from './db.js';
import { roleOf, scopeOf } from './access.js';
```

After the line `const ROW = /^\/api\/(courses|items|quotes|study_sessions|achievements)\/([^/]+)$/;` add:

```js
// ── a space's shared rows ───────────────────────────────────────────────────
// Someone outside the space gets 404 for everything here (spec §5); the guard inside each
// statement is the boundary, and these checks only pick the answer and the write.

const SHARED_ROW = /^\/api\/spaces\/([a-z0-9]{12})\/(courses|items)\/([^/]+)$/;

async function sharedRoute(request, env, spaceId, table, id) {
  const userId = await requireUser(request, env);
  validateId(id);
  const space = await roleOf(env.DB, userId, spaceId);
  if (!space || (table === 'courses' && space.kind !== 'class')) throw new HttpError(404, { error: 'not_found' });
  return { userId, space, scope: scopeOf(space.kind, spaceId) };
}
/* The class's one course and the project's 'project' item are made with the space and live as long as it does. */
const madeWithSpace = (table, id) => table === 'courses' || id === 'project';

async function readShared({ request, env, params: [spaceId, table, id] }) {
  const { userId, scope } = await sharedRoute(request, env, spaceId, table, id);
  const row = await getShared(env.DB, table, scope, userId, id);
  if (!row || row.deletedAt) throw new HttpError(404, { error: 'not_found' });
  return json(row);
}

async function putShared({ request, env, params: [spaceId, table, id] }) {
  const { userId, space, scope } = await sharedRoute(request, env, spaceId, table, id);
  const body = await readJson(request);
  const fields = table === 'courses' ? validateSharedCourse(body) : validateSharedItem(body, space.kind, id);
  const changed = validateChanged(body, table === 'courses' ? 'courses' : space.kind);
  const revision = revisionOf(request);
  if (space.archived) throw new HttpError(403, { error: 'archived' });
  if (space.role === 'member') {
    if (space.kind !== 'project' || table !== 'items') throw new HttpError(403, { error: 'forbidden' });
    return json(await memberTaskWrite(env.DB, scope, userId, id, fields, { changed }));
  }
  if (revision === 0 && madeWithSpace(table, id)) throw new HttpError(403, { error: 'forbidden' });
  return json(await upsertShared(env.DB, table, scope, userId, id, fields, { revision, changed }));
}

async function removeShared({ request, env, params: [spaceId, table, id] }) {
  const { userId, space, scope } = await sharedRoute(request, env, spaceId, table, id);
  const revision = revisionOf(request);
  if (space.archived) throw new HttpError(403, { error: 'archived' });
  if (space.role === 'member' || madeWithSpace(table, id)) throw new HttpError(403, { error: 'forbidden' });
  if (!(await deleteShared(env.DB, table, scope, userId, id, Date.now(), revision))) throw new HttpError(404, { error: 'not_found' });
  return new Response(null, { status: 204 });
}
```

In `routes`, after

```js
  ['DELETE', ROW, removeRow],
```

add

```js
  ['GET', SHARED_ROW, readShared],
  ['PUT', SHARED_ROW, putShared],
  ['DELETE', SHARED_ROW, removeShared],
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run test/shared-routes.test.js test/endpoints.test.js test/security.test.js test/validation.test.js`
Expected: PASS (all four).

- [ ] **Step 6: Commit**

```bash
git add worker/validate.js worker/api.js test/shared-routes.test.js
git commit -m "Routes for a space's shared courses and items, guarded and unused by the UI

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JpUR1JXMY3ehtkiJwuij95"
```

---
### Task 6: `syncPageV3` and `GET /api/sync?v=3`

v2 stays exactly as it is.

**Files:**
- Modify: `worker/db.js` (the access import; a new section after the shared rows)
- Modify: `worker/api.js` (imports; `cursorsParam`/`svParam`; the sync route)
- Create: `test/sync-v3.test.js`

- [ ] **Step 1: Write the failing test**

`test/sync-v3.test.js`:

```js
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createUser, signIn } from './helpers.js';
import { makeSpace, setMember, sharedItem } from './spaces.js';
import { personal, readMemberships, readPage, syncPageV3, upsertRow } from '../worker/db.js';

const course = { code: 'BIO', name: 'Biology', color: '#17B3AE', instructor: '', term: '', archived: false, meetings: [] };
async function pageAll(userId, cursors, sv, limit) {
  const pages = [];
  for (let more = true; more;) {
    const page = await syncPageV3(env.DB, userId, Object.entries(cursors), sv, limit);
    pages.push(page);
    ({ cursors, more } = page);
  }
  return pages;
}

describe('sync v3', () => {
  it("pages the person's own scope and their spaces in one sequence order, a few rows at a time", async () => {
    const ana = await createUser('v3-order'), gabriel = await createUser('v3-order-g');
    const web = await makeSpace({ members: { [gabriel]: 'owner', [ana]: 'member' } });   /* its course is the first change */
    await upsertRow(env.DB, 'courses', ana, 'bio', course);
    await sharedItem(web.scope, 'a1', { course_id: 'web' });
    await upsertRow(env.DB, 'quotes', ana, 'q', { text: 'Go', source: '' });
    await sharedItem(web.scope, 'a2', { course_id: 'web' });
    const pages = await pageAll(ana, {}, 0, 2);
    expect(pages.flatMap((p) => p.changes.map((c) => `${c.scope === web.scope ? 'web' : 'own'}:${c.kind}:${c.row.id}`)))
      .toEqual(['web:courses:web', 'own:courses:bio', 'web:items:a1', 'own:quotes:q', 'web:items:a2']);
    expect(pages.map((p) => p.more)).toEqual([true, true, false]);
    expect(Object.keys(pages.at(-1).cursors).sort()).toEqual([personal(ana), web.scope].sort());
    expect(pages[0].changes[0].row).toMatchObject({ scope: web.scope, code: 'WEB', updatedBy: null });
    expect(pages[1].changes[0].row).toMatchObject({ scope: web.scope, courseId: 'web', assignees: [], completedBy: null });
    expect(pages[0].scopes).toMatchObject([{ id: web.id, scope: web.scope, kind: 'class', role: 'member', name: 'Web Services' }]);
  });

  it('loads a space the client did not send from 0, and sends back the scopes it may not read', async () => {
    const ana = await createUser('v3-new'), owner = await createUser('v3-new-o');
    const old = await makeSpace({ members: { [owner]: 'owner' } });
    const web = await makeSpace({ members: { [owner]: 'owner', [ana]: 'member' } });
    const head = (await syncPageV3(env.DB, ana, [], 0)).cursors[personal(ana)];
    const page = await syncPageV3(env.DB, ana, [[personal(ana), head], [old.scope, 3], ['u:u-someone', 2]], 0);
    expect(page.revoked).toEqual([old.scope, 'u:u-someone']);
    expect(page.reset).toEqual([]);
    expect(page.changes.map((c) => `${c.scope}:${c.row.id}`)).toEqual([`${web.scope}:web`]);
  });

  it('sends member lists only for spaces above sv, and all of them when sv is 0', async () => {
    const ana = await createUser('v3-sv', 'Ana'), ben = await createUser('v3-sv-b');
    const web = await makeSpace({ members: { [ana]: 'owner', [ben]: 'member' } });
    const [first] = await readMemberships(env.DB, ana, 0);
    expect(first).toMatchObject({ id: web.id, scope: web.scope, kind: 'class', role: 'owner', archived: false, name: 'Web Services', parent: null });
    expect(first.members).toEqual([{ userId: ana, name: 'Ana', role: 'owner' }, { userId: ben, name: 'v3-sv-b', role: 'member' }]);
    const [held] = await readMemberships(env.DB, ana, first.revision);
    expect(held).not.toHaveProperty('members');
    await setMember(web.id, ben, 'editor');
    const [moved] = await readMemberships(env.DB, ana, first.revision);
    expect(moved.members.map((m) => m.role)).toEqual(['owner', 'editor']);
  });

  it('pages nothing from a space the person left between reading their spaces and reading the page', async () => {
    const ana = await createUser('v3-race'), owner = await createUser('v3-race-o');
    const web = await makeSpace({ members: { [owner]: 'owner', [ana]: 'member' } });
    expect((await readMemberships(env.DB, ana, 0)).map((s) => s.scope)).toEqual([web.scope]);
    await setMember(web.id, ana, null);
    const { rows } = await readPage(env.DB, ana, [[personal(ana), 0], [web.scope, 0]]);
    expect(rows.filter((r) => r.scope === web.scope)).toEqual([]);
    expect((await syncPageV3(env.DB, ana, [[web.scope, 0]], 0)).revoked).toEqual([web.scope]);
  });

  it('resets only a scope whose cursor fell below the floor; cursor 0 never resets', async () => {
    const ana = await createUser('v3-reset'), owner = await createUser('v3-reset-o');
    const web = await makeSpace({ members: { [owner]: 'owner', [ana]: 'member' } });
    await upsertRow(env.DB, 'quotes', ana, 'q', { text: 'Go', source: '' });
    const head = (await syncPageV3(env.DB, ana, [], 0)).cursors[personal(ana)];
    await env.DB.prepare('UPDATE sync_state SET floor = ? WHERE id = 1').bind(head).run();
    try {
      const page = await syncPageV3(env.DB, ana, [[personal(ana), head], [web.scope, 1]], 0);
      expect(page).toMatchObject({ reset: [web.scope], more: true, changes: [] });
      expect(page.cursors[web.scope]).toBe(0);
      const again = await syncPageV3(env.DB, ana, Object.entries(page.cursors), 0);
      expect(again.reset).toEqual([]);
      expect(again.changes.map((c) => c.row.id)).toEqual(['web']);
    } finally {
      await env.DB.prepare('UPDATE sync_state SET floor = 0 WHERE id = 1').run();
    }
  });

  it('answers GET /api/sync?v=3, refuses malformed cursors, and keeps v2 as it was', async () => {
    const api = await signIn('v3-route');
    const ok = await (await api('/api/sync?v=3&cursors=' + encodeURIComponent('u:u-v3-route:0,c:abcdefghij12:4') + '&sv=0')).json();
    expect(ok).toMatchObject({ scopes: [], more: false, reset: [], revoked: ['c:abcdefghij12'] });
    expect(Object.keys(ok.cursors)).toEqual(['u:u-v3-route']);
    for (const bad of ['u:u-v3-route', 'x:1:2', 'c:abcdefghij12:-1', 'u:a:1,u:a:2', Array.from({ length: 26 }, (_, i) => `u:x${i}:1`).join(',')]) {
      expect((await api('/api/sync?v=3&cursors=' + encodeURIComponent(bad))).status).toBe(400);
    }
    expect((await api('/api/sync?v=3&sv=x')).status).toBe(400);
    expect(await (await api('/api/sync?v=2&cursor=0')).json()).toMatchObject({ reset: false, more: false, changes: [] });
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run test/sync-v3.test.js`
Expected: FAIL — `readMemberships` is not exported.

- [ ] **Step 3: Implement `syncPageV3`**

In `worker/db.js`, replace the access import added in Task 4

```js
import { assertAllowed, editorGuard, memberGuard, parseScope, writerGuard } from './access.js';
```

with

```js
import { assertAllowed, editorGuard, memberGuard, parseScope, scopeOf, writerGuard } from './access.js';
```

and after `deleteShared` (the end of the shared-rows section) add:

```js
// ── sync v3: a cursor per scope (spec §6 Pull) ──────────────────────────────

/* The most spaces a person holds (spec §3 Limits). */
const SPACE_LIMIT = 20;

/**
 * The person's live spaces (at most 20) as sync describes them, each with its member list
 * when its revision is above `sv` (all of them when sv is 0). A class is named by its
 * course, a project by its 'project' item.
 */
export async function readMemberships(db, userId, sv) {
  const [spaces, members] = await db.batch([
    db.prepare(`SELECT s.id, s.kind, s.archived, s.parent_space, s.parent_item, s.revision, m.role,
        CASE s.kind WHEN 'class' THEN (SELECT name FROM courses WHERE scope = 'c:' || s.id AND deleted_at IS NULL LIMIT 1)
          ELSE (SELECT title FROM items WHERE scope = 'p:' || s.id AND id = 'project') END AS name
      FROM members AS m JOIN spaces AS s ON s.id = m.space_id
      WHERE m.user_id = ? AND m.deleted_at IS NULL AND s.deleted_at IS NULL ORDER BY s.id LIMIT ?`).bind(userId, SPACE_LIMIT),
    db.prepare(`SELECT o.space_id, o.user_id, o.role, COALESCE(NULLIF(u.display_name, ''), u.username) AS name
      FROM members AS m JOIN spaces AS s ON s.id = m.space_id
      JOIN members AS o ON o.space_id = s.id AND o.deleted_at IS NULL JOIN users AS u ON u.id = o.user_id
      WHERE m.user_id = ? AND m.deleted_at IS NULL AND s.deleted_at IS NULL AND s.revision > ?
      ORDER BY o.space_id, o.joined_at, o.user_id`).bind(userId, sv),
  ]);
  const lists = new Map();
  for (const m of members.results) lists.set(m.space_id, [...(lists.get(m.space_id) || []), { userId: m.user_id, name: m.name, role: m.role }]);
  return spaces.results.map((s) => ({
    id: s.id, scope: scopeOf(s.kind, s.id), kind: s.kind, role: s.role, archived: s.archived === 1, name: s.name ?? '',
    parent: s.parent_space ? { space: s.parent_space, item: s.parent_item } : null, revision: s.revision,
    ...(s.revision > sv ? { members: lists.get(s.id) || [] } : {}),
  }));
}

/**
 * The changes after each [scope, cursor] of `wanted`, read in one batch with the feed's
 * floor and head: a statement per scope, each capped at limit + 1 and, for a space, guarded
 * by live membership inside the statement, so a removal since readMemberships pages
 * nothing. D1 refuses a compound SELECT of more than five terms, so this is a batch rather
 * than one UNION ALL. Rows come back in sequence order, not yet cut.
 */
export async function readPage(db, userId, wanted, limit = 100) {
  const [state, ...pages] = await db.batch([
    db.prepare("SELECT floor, COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'changes'), 0) AS head FROM sync_state WHERE id = 1"),
    ...wanted.map(([scope, cursor]) => {
      const p = parseScope(scope);
      const g = p.kind === 'user' ? { sql: p.userId === userId ? '1' : '0', binds: [] } : memberGuard(p.spaceId, userId);
      return db.prepare(`SELECT seq, scope, kind, payload FROM changes WHERE scope = ? AND seq > ? AND ${g.sql} ORDER BY seq LIMIT ?`)
        .bind(scope, cursor, ...g.binds, limit + 1);
    }),
  ]);
  return { ...state.results[0], rows: pages.flatMap((p) => p.results).sort((a, b) => a.seq - b.seq) };
}

/**
 * One v3 page. `cursors` is [[scope, seq]] as the client sent them; `sv` the highest space
 * revision it holds (0 on its first sync after opening). The Worker pages the scopes it
 * builds itself, the person's own and their spaces': a scope sent that is not among them
 * comes back in `revoked`, and one not sent starts at 0. A non-zero cursor below the floor
 * (or above the head) comes back in `reset` at 0, its rows left out, with `more` set. Each
 * cursor moves to the last sequence delivered (the head on the last page), never back.
 */
export async function syncPageV3(db, userId, cursors, sv, limit = 100) {
  const spaces = await readMemberships(db, userId, sv);
  const sent = new Map(cursors);
  const scopes = [personal(userId), ...spaces.map((s) => s.scope)];
  const revoked = [...sent.keys()].filter((s) => !scopes.includes(s));
  const { floor, head, rows: all } = await readPage(db, userId, scopes.map((s) => [s, sent.get(s) || 0]), limit);
  const reset = scopes.filter((s) => { const c = sent.get(s) || 0; return c > 0 && (c < floor || c > head); });
  const rows = all.filter((r) => !reset.includes(r.scope));
  const full = rows.length > limit, page = rows.slice(0, limit);
  const end = full ? page.at(-1).seq : head;
  return {
    scopes: spaces,
    cursors: Object.fromEntries(scopes.map((s) => [s, reset.includes(s) ? 0 : Math.max(sent.get(s) || 0, end)])),
    changes: page.map((r) => {
      const raw = JSON.parse(r.payload);
      return { scope: r.scope, kind: r.kind, row: r.scope.startsWith('u:') ? rowToApi(r.kind, raw) : sharedToApi(r.kind, raw) };
    }),
    more: full || reset.length > 0,
    reset,
    revoked,
  };
}
```

- [ ] **Step 4: Add the route**

In `worker/api.js`, replace the two lines changed in Task 5

```js
import { getUserForLogin, getProfile, updateProfile, getRow, upsertRow, deleteRow, syncPage, bumpPasswordGen, saveSpotifyTokens, deleteSpotifyTokens, getShared, upsertShared, deleteShared, memberTaskWrite } from './db.js';
import { roleOf, scopeOf } from './access.js';
```

with

```js
import { getUserForLogin, getProfile, updateProfile, getRow, upsertRow, deleteRow, syncPage, syncPageV3, bumpPasswordGen, saveSpotifyTokens, deleteSpotifyTokens, getShared, upsertShared, deleteShared, memberTaskWrite } from './db.js';
import { parseScope, roleOf, scopeOf } from './access.js';
```

After `revisionOf` (its closing `}`) add:

```js
/** `cursors=u:<me>:812,c:<space id>:640`: each entry split at its last ':'. At most 25; anything malformed is a 400. */
export function cursorsParam(raw) {
  if (!raw) return [];
  const bad = () => new HttpError(400, { error: 'invalid', field: 'cursors' });
  const parts = raw.split(',');
  if (parts.length > 25) throw bad();
  const seen = new Set();
  return parts.map((part) => {
    const at = part.lastIndexOf(':'), scope = part.slice(0, at), seq = part.slice(at + 1);
    if (at < 0 || !parseScope(scope) || seen.has(scope) || !/^\d{1,16}$/.test(seq) || !Number.isSafeInteger(Number(seq))) throw bad();
    seen.add(scope);
    return [scope, Number(seq)];
  });
}

/** `sv`: the highest space revision the client holds; 0 when absent. */
function svParam(raw) {
  if (raw === null || raw === '') return 0;
  if (!/^\d{1,16}$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw new HttpError(400, { error: 'invalid', field: 'sv' });
  return Number(raw);
}
```

Replace the sync route

```js
  ['GET', /^\/api\/sync$/, async ({ request, env, url }) => {
    const userId = await requireUser(request, env);
    // The client still sends v=2; the timestamp feed it replaced is gone.
    const cursor = url.searchParams.get('cursor') || '0';
```

with

```js
  ['GET', /^\/api\/sync$/, async ({ request, env, url }) => {
    const userId = await requireUser(request, env);
    const q = url.searchParams;
    if (q.get('v') === '3') return json(await syncPageV3(env.DB, userId, cursorsParam(q.get('cursors')), svParam(q.get('sv'))));
    // v=2, for tabs still on the old client: the person's own scope, one cursor (spec §16).
    const cursor = url.searchParams.get('cursor') || '0';
```

(the two lines after it stay as they are).

- [ ] **Step 5: Run the tests**

Run: `npx vitest run test/sync-v3.test.js test/sync-protocol.test.js test/scope.test.js test/move-db.test.js test/api-client.test.js`
Expected: PASS (all five; v2 and its client contract unchanged).

- [ ] **Step 6: Commit**

```bash
git add worker/db.js worker/api.js test/sync-v3.test.js
git commit -m "Sync v3: a cursor per scope, member lists above sv, reset and revoked per scope

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JpUR1JXMY3ehtkiJwuij95"
```

---

### Task 7: IndexedDB version 5

**Files:**
- Modify: `src/core/types.ts` (append)
- Modify: `src/core/db.ts`
- Modify: `src/core/store.ts` (`open` passes the account)
- Modify: `test/local-store.node.mjs`

- [ ] **Step 1: Write the failing test**

Append to `test/local-store.node.mjs`:

```js
test('version 4 upgrade keeps pending edits and moves the cursor to the person\'s own scope', async () => {
 const user = p(), name = `rounds:${user.id}`;
 await new Promise((resolve, reject) => {
  const request = indexedDB.open(name, 4);
  request.onupgradeneeded = () => { for (const s of ['courses', 'items', 'quotes', 'study_sessions', 'achievements', 'meta', 'pending', 'conflicts']) request.result.createObjectStore(s, { keyPath: ['meta', 'pending'].includes(s) ? 'key' : 'id' }); };
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
   const db = request.result, tx = db.transaction(['items', 'meta', 'pending'], 'readwrite');
   tx.objectStore('items').put({ id: 'a', title: 'Unsent', revision: 3 });
   tx.objectStore('pending').put({ key: 'items:a', op: 'put', body: { id: 'a', title: 'Unsent', revision: 3 }, revision: 3, reviewRequired: false, token: 't', owner: 'old-tab' });
   tx.objectStore('meta').put({ key: 'syncCursor', value: 812 });
   tx.oncomplete = () => { db.close(); resolve(); };
  };
 });
 await first.open(user);
 assert.deepEqual((await first.pending()).map((op) => op.key), ['items:a']);
 assert.deepEqual(await first.meta.get('cursors'), { [`u:${user.id}`]: 812 });
 assert.equal(await first.meta.get('syncCursor'), undefined);
 assert.equal(first.item('a').title, 'Unsent');
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm run test:local`
Expected: FAIL in the new test: `cursors` is `undefined` (version 4 has no migration to 5).

- [ ] **Step 3: Add the shared types**

Append to `src/core/types.ts`:

```ts

/** A shared space as sync describes it (spec §6): your role in it, and its members when they last moved. */
export interface Space {
    id: string
    scope: string
    kind: "class" | "project"
    role: "owner" | "editor" | "member"
    archived: boolean
    name: string
    parent: { space: string; item: string } | null
    revision: number
    members: { userId: string; name: string; role: string }[]
}
/** A class's one course, as the class keeps it. */
export type SharedCourse = Course & { scope: string; updatedBy: string | null }
/** A class's item (its facts), or a project's item or task (the team's). */
export type SharedItem = Item & { scope: string; updatedBy: string | null; assignees: string[]; completedBy: string | null }
```

- [ ] **Step 4: Move IndexedDB to version 5**

In `src/core/db.ts`:

Replace

```ts
import type { Achievement, Course, Item, Quote, StudySession } from './types.ts';
```

with

```ts
import type { Achievement, Course, Item, Quote, SharedCourse, SharedItem, Space, StudySession } from './types.ts';
```

In `PendingOp`, after `owner: string;` add:

```ts
  /** A shared row's edit: the row as it was when first queued, from which sync works out `changed`. */
  base?: Row | null;
```

In `Rows`, after `achievements: Achievement;` add:

```ts
  shared_courses: SharedCourse;
  shared_items: SharedItem;
  spaces: Space;
```

Replace

```ts
export const STORES: StoreName[] = ['courses', 'items', 'quotes', 'study_sessions', 'achievements', 'meta', 'pending', 'conflicts'];
```

with

```ts
export const STORES: StoreName[] = ['courses', 'items', 'quotes', 'study_sessions', 'achievements', 'shared_courses', 'shared_items', 'spaces', 'meta', 'pending', 'conflicts'];
/* Shared rows are keyed [scope, id], so a class's id can never shadow a personal row (spec §7). */
const keyPathOf = (s: StoreName): string | string[] =>
  s === 'meta' || s === 'pending' ? 'key' : s === 'shared_courses' || s === 'shared_items' ? ['scope', 'id'] : 'id';
```

Replace

```ts
export function openDb(name: string, onVersionChange: () => void = () => {}): Promise<Db> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 4);
    let blocked = false;
    req.onupgradeneeded = () => {
      const db = req.result, tx = req.transaction!;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: ['meta', 'pending'].includes(s) ? 'key' : 'id' });
```

with

```ts
/** Version 5 (spec §7): shared rows, spaces, and a sync cursor per scope. `account` names whose cursor version 4 kept. */
export function openDb(name: string, onVersionChange: () => void = () => {}, account: string | null = null): Promise<Db> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 5);
    let blocked = false;
    req.onupgradeneeded = (event) => {
      const db = req.result, tx = req.transaction!;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: keyPathOf(s) });
      // Version 4 kept one cursor, for the person's own rows: it becomes theirs in the map.
      if (event.oldVersion >= 1 && event.oldVersion < 5 && account) {
        const meta = tx.objectStore('meta'), old: IDBRequest<{ value?: number } | undefined> = meta.get('syncCursor');
        old.onsuccess = () => {
          if (old.result?.value) meta.put({ key: 'cursors', value: { ['u:' + account]: old.result.value } });
          meta.delete('syncCursor');
        };
      }
```

(the version 1 `dirty` migration that follows stays as it is).

In `src/core/store.ts`, in `open`, replace

```ts
  db = await openDb(dbName(p.id), () => { close().finally(() => notify({ type: 'signed-out' })); });
```

with

```ts
  db = await openDb(dbName(p.id), () => { close().finally(() => notify({ type: 'signed-out' })); }, p.id);
```

- [ ] **Step 5: Run the tests**

Run: `npm run test:local && npm run typecheck`
Expected: PASS; typecheck clean. (`reload` does not read the new stores yet; Task 8 does.)

- [ ] **Step 6: Commit**

```bash
git add src/core/types.ts src/core/db.ts src/core/store.ts test/local-store.node.mjs
git commit -m "IndexedDB 5: shared stores, spaces, a cursor per scope

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JpUR1JXMY3ehtkiJwuij95"
```

---

### Task 8: The store keeps shared rows, applies v3 pages and revocations

**Files:**
- Modify: `src/core/store.ts`
- Modify: `test/local-store.node.mjs`

- [ ] **Step 1: Write the failing tests**

Append to `test/local-store.node.mjs`:

```js
const WEB = 'c:abcdefghij12', LAB = 'c:bbbbbbbbbbb2';
const webSpace = (over = {}) => ({ id: 'abcdefghij12', scope: WEB, kind: 'class', role: 'member', archived: false, name: 'Web', parent: null, revision: 6, ...over });

test('a v3 page files shared rows by scope beside a personal row with the same id; revoking the space removes them', async () => {
 const user = p(); await first.open(user);
 const own = `u:${user.id}`;
 await first.applyPage({ cursors: { [own]: 5, [WEB]: 6 }, scopes: [webSpace({ members: [{ userId: 'g', name: 'Gabriel', role: 'owner' }] })], changes: [
  { scope: own, kind: 'items', row: { id: 'a', title: 'Mine', revision: 4 } },
  { scope: WEB, kind: 'items', row: { id: 'a', title: 'Class', courseId: 'web', revision: 5 } },
  { scope: WEB, kind: 'courses', row: { id: 'web', code: 'WEB', name: 'Web', revision: 6 } },
 ] });
 assert.equal(first.item('a').title, 'Mine');
 assert.deepEqual(first.data.shared_items.map((r) => [r.scope, r.id, r.title]), [[WEB, 'a', 'Class']]);
 assert.deepEqual(first.data.shared_courses.map((r) => [r.scope, r.id]), [[WEB, 'web']]);
 assert.equal(first.spaceRevision(), 6);
 assert.deepEqual(await first.meta.get('cursors'), { [own]: 5, [WEB]: 6 });
 /* a page without the member list keeps the one held */
 await first.applyPage({ cursors: {}, scopes: [webSpace()], changes: [] });
 assert.equal(first.data.spaces[0].members[0].name, 'Gabriel');
 await first.applyRevoked([WEB]);
 assert.deepEqual([first.data.shared_items, first.data.shared_courses, first.data.spaces], [[], [], []]);
 assert.deepEqual(await first.meta.get('cursors'), { [own]: 5 });
 assert.equal(first.item('a').title, 'Mine');
});

test('a shared edit queues under its scope with the row it started from', async () => {
 await first.open(p());
 await first.applyPage({ cursors: {}, changes: [{ scope: WEB, kind: 'items', row: { id: 'x', title: 'Old', date: '2026-10-15', courseId: 'web', revision: 7 } }] });
 const [stored] = first.data.shared_items;
 await first.saveShared('shared_items', { ...stored, title: 'New' });
 await first.saveShared('shared_items', { ...stored, title: 'Newer' });
 const [op] = await first.pending();
 assert.equal(op.key, `shared_items:${WEB}:x`);
 assert.equal(op.base.title, 'Old'); assert.equal(op.body.title, 'Newer'); assert.equal(op.revision, 7);
 /* a page cannot overwrite a row with a pending edit */
 await first.applyPage({ cursors: {}, changes: [{ scope: WEB, kind: 'items', row: { ...stored, title: 'Server', revision: 8 } }] });
 assert.equal(first.data.shared_items[0].title, 'Newer');
 await first.settleOperation(op, { ...op.body, scope: WEB, revision: 9 });
 assert.equal(first.data.shared_items[0].revision, 9);
 assert.deepEqual(await first.pending(), []);
 await first.removeShared('shared_items', WEB, 'x');
 assert.deepEqual(first.data.shared_items, []);
 assert.deepEqual((await first.pending()).map((o) => [o.key, o.op]), [[`shared_items:${WEB}:x`, 'delete']]);
});

test('a reset of one space wipes only that space\'s clean rows', async () => {
 await first.open(p());
 await first.applyPage({ cursors: {}, changes: [
  { scope: WEB, kind: 'items', row: { id: 'a', title: 'Web A', revision: 1 } },
  { scope: WEB, kind: 'items', row: { id: 'b', title: 'Web B', revision: 1 } },
  { scope: LAB, kind: 'items', row: { id: 'a', title: 'Lab A', revision: 1 } },
  { kind: 'items', row: { id: 'a', title: 'Mine', revision: 1 } },
 ] });
 await first.saveShared('shared_items', { ...first.data.shared_items.find((r) => r.scope === WEB && r.id === 'b'), title: 'Offline' });
 await first.applyPage({ cursors: { [WEB]: 9 }, changes: [] }, [WEB]);
 assert.deepEqual(first.data.shared_items.map((r) => `${r.scope}/${r.id}:${r.title}`).sort(), [`${LAB}/a:Lab A`, `${WEB}/b:Offline`]);
 assert.equal(first.item('a').title, 'Mine');
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npm run test:local`
Expected: FAIL — `first.data.shared_items` is `undefined` / `first.spaceRevision is not a function`.

- [ ] **Step 3: Implement**

In `src/core/store.ts`:

(a) Replace the import block

```ts
import { openDb, deleteDb, STORES as stores } from './db.ts';
import { normalizeItem, normalizeCourse, normalizeQuote, normalizeStudySession, normalizeAchievement, normalizeFlow, normalizePrefs, DEFAULT_COAT } from './model.ts';
import type { Accessor, Conflict, Db, PendingOp, Row, Rows } from './db.ts';
import type { Raw, RawCourse, RawItem } from './model.ts';
import type { Achievement, Coat, Course, Item, Profile, Quote, StudySession } from './types.ts';
```

with

```ts
import { openDb, deleteDb, STORES as stores } from './db.ts';
import { normalizeItem, normalizeCourse, normalizeQuote, normalizeStudySession, normalizeAchievement, normalizeFlow, normalizePrefs, DEFAULT_COAT } from './model.ts';
import { parseKey, sharedKey, SHARED_STORES, type SharedStore } from './shared.ts';
import type { Accessor, Conflict, Db, PendingOp, Row, Rows } from './db.ts';
import type { Raw, RawCourse, RawItem } from './model.ts';
import type { Achievement, Coat, Course, Item, Profile, Quote, SharedCourse, SharedItem, Space, StudySession } from './types.ts';
```

(b) Replace

```ts
/** A page of changes from the server. */
export interface Page { cursor: number; changes: { kind: Kind; row: Row }[] }
```

with

```ts
/**
 * A page of changes from the server. v3 names each change's scope (none: the person's
 * own), carries a cursor per scope and the person's spaces; v2's single `cursor` is the
 * person's own.
 */
export interface Page { cursor?: number; cursors?: Record<string, number>; scopes?: Space[]; changes: { scope?: string; kind: Kind; row: Row }[] }
```

(c) Replace the `data` declaration

```ts
export const data: {
  profile: Profile | null;
  courses: Course[];
  items: Item[];
  quotes: Quote[];
  study_sessions: StudySession[];
  achievements: Achievement[];
} = { profile: null, courses: [], items: [], quotes: [], study_sessions: [], achievements: [] };
```

with

```ts
export const data: {
  profile: Profile | null;
  courses: Course[];
  items: Item[];
  quotes: Quote[];
  study_sessions: StudySession[];
  achievements: Achievement[];
  /* a class's or a project's rows, and the spaces themselves (spec §7) */
  shared_courses: SharedCourse[];
  shared_items: SharedItem[];
  spaces: Space[];
} = { profile: null, courses: [], items: [], quotes: [], study_sessions: [], achievements: [], shared_courses: [], shared_items: [], spaces: [] };
```

(d) After the line `const normalizer = (kind: Kind) => normal[kind] as (raw: unknown, index?: number) => Rows[Kind];` add:

```ts
/* A shared row keeps its scope, who last wrote it and, for an item, the team's fields. */
const normalShared = {
  shared_courses: (r: Row): SharedCourse => ({ ...normalizeCourse(r as unknown as RawCourse), scope: r.scope as string, updatedBy: (r.updatedBy as string | null) ?? null }),
  shared_items: (r: Row): SharedItem => ({
    ...normalizeItem(r as unknown as RawItem), scope: r.scope as string, updatedBy: (r.updatedBy as string | null) ?? null,
    assignees: Array.isArray(r.assignees) ? r.assignees as string[] : [], completedBy: (r.completedBy as string | null) ?? null,
  }),
};
/* The shared store a change of `kind` goes to: only courses and items are shared. */
const sharedStoreOf = (kind: Kind): SharedStore | null => (kind === 'courses' ? 'shared_courses' : kind === 'items' ? 'shared_items' : null);
```

(e) Replace

```ts
const rowStore = (key: string) => (key === 'profile' ? 'meta' : key.split(':')[0]) as Kind | 'meta';
const rowId = (key: string) => key === 'profile' ? 'profile' : key.slice(key.indexOf(':') + 1);
/* The profile is kept in `meta` under its key; any other row is stored as it is. */
const wrap: { (key: 'profile', row: unknown): Rows['meta']; (key: string, row: unknown): Rows[Kind | 'meta'] } =
  (key: string, row: unknown) => (key === 'profile' ? { key: 'profile', value: row } : row) as Rows['meta'];
```

with

```ts
/* A pending key's store, and the row's key in it: [scope, id] for a shared row (src/core/shared.ts). */
const rowStore = (key: string) => parseKey(key).store as Kind | SharedStore | 'meta';
const rowId = (key: string): IDBValidKey => { const k = parseKey(key); return k.scope ? [k.scope, k.id] : k.id; };
/* The profile is kept in `meta` under its key; any other row is stored as it is. */
const wrap: { (key: 'profile', row: unknown): Rows['meta']; (key: string, row: unknown): Rows[Kind | SharedStore | 'meta'] } =
  (key: string, row: unknown) => (key === 'profile' ? { key: 'profile', value: row } : row) as Rows['meta'];
```

(f) In `reload`, replace

```ts
    courses: await a('courses').all(), items: await a('items').all(), quotes: await a('quotes').all(), study_sessions: await a('study_sessions').all(), achievements: await a('achievements').all(),
```

with

```ts
    courses: await a('courses').all(), items: await a('items').all(), quotes: await a('quotes').all(), study_sessions: await a('study_sessions').all(), achievements: await a('achievements').all(),
    shared_courses: await a('shared_courses').all(), shared_items: await a('shared_items').all(), spaces: await a('spaces').all(),
```

and after

```ts
  for (const kind of kinds) (data as Record<Kind, Rows[Kind][]>)[kind] = snapshot[kind].filter((r) => !hidden.has(kind + ':' + r.id)).map(normalizer(kind));
```

add

```ts
  data.shared_courses = snapshot.shared_courses.filter((r) => !hidden.has(sharedKey('shared_courses', r.scope, r.id))).map((r) => normalShared.shared_courses(r as unknown as Row));
  data.shared_items = snapshot.shared_items.filter((r) => !hidden.has(sharedKey('shared_items', r.scope, r.id))).map((r) => normalShared.shared_items(r as unknown as Row));
  data.spaces = snapshot.spaces;
```

(g) In `close`, replace

```ts
  for (const kind of kinds) data[kind] = [];
```

with

```ts
  for (const kind of kinds) data[kind] = [];
  data.shared_courses = []; data.shared_items = []; data.spaces = [];
```

(h) Replace `queue`

```ts
async function queue(a: Accessor, key: string, op: string, body: Row | null) {
  const previous = await a('pending').get(key);
  if (previous && previous.owner !== owner) {
    await a('conflicts').put({ id: crypto.randomUUID(), ...previous, reason: 'Another tab edited this record.', at: Date.now() });
  }
  const revision = previous?.revision ?? body?.revision ?? 0;
  await a('pending').put({ key, op, body, revision, reviewRequired: !!previous?.reviewRequired, token: crypto.randomUUID(), owner });
}
```

with

```ts
/* `base` (a shared row's edit only): the row before this edit; an op already queued keeps
   the base it started from, so `changed` covers every edit since the last upload. */
async function queue(a: Accessor, key: string, op: string, body: Row | null, base?: Row | null) {
  const previous = await a('pending').get(key);
  if (previous && previous.owner !== owner) {
    await a('conflicts').put({ id: crypto.randomUUID(), ...previous, reason: 'Another tab edited this record.', at: Date.now() });
  }
  const revision = previous?.revision ?? body?.revision ?? 0;
  const kept = base === undefined ? {} : { base: previous ? previous.base ?? null : base };
  await a('pending').put({ key, op, body, revision, reviewRequired: !!previous?.reviewRequired, token: crypto.randomUUID(), owner, ...kept });
}
```

(i) After `export const saveAchievement = …` (the line), add:

```ts
/** Save a class's or a project's course or item; it uploads with the row it started from (spec §6 Push). The UI calls this from Stage 4. */
export function saveShared(store: SharedStore, row: Row & { scope: string }): Promise<SharedCourse | SharedItem> {
  const clean = normalShared[store](structuredClone(row));
  return mutate(async (a) => {
    const shared = a(store) as unknown as Access<'shared_items'>;
    const before = await shared.get([clean.scope, clean.id]);
    await shared.put(clean as SharedItem);
    await queue(a, sharedKey(store, clean.scope, clean.id), 'put', clean as unknown as Row, (before as unknown as Row | undefined) ?? null);
    return clean;
  });
}
/** Delete a class's or a project's row on this device and queue the delete. */
export function removeShared(store: SharedStore, scope: string, id: string): Promise<void> {
  return mutate(async (a) => {
    const before = await a(store).get([scope, id]) as unknown as Row | undefined;
    await queue(a, sharedKey(store, scope, id), 'delete', before ?? { id, scope }, before ?? null);
    await a(store).del([scope, id]);
  });
}
```

and add `Access` to the type import from `./db.ts`:

```ts
import type { Access, Accessor, Conflict, Db, PendingOp, Row, Rows } from './db.ts';
```

(j) Replace the whole `applyPage`

```ts
export function applyPage(page: Page, reset = false): Promise<boolean> {
  return mutate(async (a) => {
    if (reset) for (const kind of kinds) {
      for (const row of await a(kind).all()) if (!(await a('pending').get(`${kind}:${row.id}`))) await a(kind).del(row.id);
    }
    for (const { kind, row } of page.changes) {
      if (await a('pending').get(`${kind}:${row.id}`)) continue;
      const local = await a(kind).get(row.id);
      if (local && local.revision! > row.revision!) continue;
      if (row.deletedAt) await a(kind).del(row.id);
      else await a(kind).put(normalizer(kind)(row));
    }
    await a('meta').put({ key: 'syncCursor', value: page.cursor });
    return reset || page.changes.length > 0;
  }, 'synced');
}
```

with

```ts
/**
 * Apply a page. A change in the person's own scope (or with none) goes to the personal
 * stores; a class's or a project's course or item to the shared ones, under [scope, id].
 * `reset` lists scopes whose clean rows are wiped first (true: the person's own, as v2
 * did). A row with a pending edit, or held at a newer revision, is left alone.
 */
export function applyPage(page: Page, reset: boolean | string[] = false): Promise<boolean> {
  return mutate(async (a) => {
    const own = 'u:' + userId;
    const wipe = reset === true ? [own] : reset || [];
    for (const scope of wipe) {
      if (scope === own) {
        for (const kind of kinds) for (const row of await a(kind).all()) if (!(await a('pending').get(`${kind}:${row.id}`))) await a(kind).del(row.id);
      } else for (const s of SHARED_STORES) {
        for (const row of await a(s).all()) if (row.scope === scope && !(await a('pending').get(sharedKey(s, scope, row.id)))) await a(s).del([scope, row.id]);
      }
    }
    for (const { scope = own, kind, row } of page.changes) {
      if (scope === own) {
        if (await a('pending').get(`${kind}:${row.id}`)) continue;
        const local = await a(kind).get(row.id);
        if (local && local.revision! > row.revision!) continue;
        if (row.deletedAt) await a(kind).del(row.id);
        else await a(kind).put(normalizer(kind)(row));
        continue;
      }
      const s = sharedStoreOf(kind);
      if (!s || await a('pending').get(sharedKey(s, scope, row.id))) continue;
      const store = a(s) as unknown as Access<'shared_items'>;
      const local = await store.get([scope, row.id]);
      if (local && local.revision! > row.revision!) continue;
      if (row.deletedAt) await store.del([scope, row.id]);
      else await store.put(normalShared[s]({ ...row, scope }) as SharedItem);
    }
    /* a space's member list comes only when it moved (spec §6): keep the one held */
    for (const space of page.scopes || []) {
      const held = await a('spaces').get(space.id);
      await a('spaces').put({ ...space, members: space.members ?? held?.members ?? [] });
    }
    const cursors = (await a('meta').get('cursors'))?.value as Record<string, number> | undefined;
    await a('meta').put({ key: 'cursors', value: { ...cursors, ...(page.cursors ?? (page.cursor !== undefined ? { [own]: page.cursor } : {})) } });
    return wipe.length > 0 || page.changes.length > 0;
  }, 'synced');
}

/**
 * Take away what this device holds of scopes it may no longer read (sync's `revoked`,
 * applied after the cycle's last page): their shared rows, their space, their cursor.
 * Pending edits to them stay queued; uploading them gets 404 and moves them to the saved
 * copies, so nothing is silently thrown away (spec §6 Revocation).
 */
export function applyRevoked(scopes: string[]): Promise<boolean> {
  if (!scopes.length) return Promise.resolve(false);
  return mutate(async (a) => {
    for (const s of SHARED_STORES) for (const row of await a(s).all()) if (scopes.includes(row.scope)) await a(s).del([row.scope, row.id]);
    for (const space of await a('spaces').all()) if (scopes.includes(space.scope)) await a('spaces').del(space.id);
    const cursors = { ...((await a('meta').get('cursors'))?.value as Record<string, number> | undefined) };
    for (const s of scopes) delete cursors[s];
    await a('meta').put({ key: 'cursors', value: cursors });
    return true;
  }, 'synced');
}

/** The highest space revision this device holds: sync's `sv`. */
export const spaceRevision = (): number => Math.max(0, ...data.spaces.map((s) => s.revision));
```

(k) In `resolveConflict`, replace

```ts
      await queue(a, conflict.key, conflict.op, body);
```

with

```ts
      /* a shared copy restored merges against the server's row as it now is */
      await queue(a, conflict.key, conflict.op, body, parseKey(conflict.key).scope ? (current as Row | undefined) ?? null : undefined);
```

- [ ] **Step 4: Run the tests**

Run: `npm run test:local && npm run typecheck`
Expected: PASS (every node test, old and new); typecheck clean. If `tsc` objects to a union store accessor, cast through `Access<'shared_items'>` as in (i) and (j); the runtime is the same.

- [ ] **Step 5: Commit**

```bash
git add src/core/store.ts test/local-store.node.mjs
git commit -m "Store: shared rows by scope, v3 pages, per-scope reset, revocation, shared edits with a base

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JpUR1JXMY3ehtkiJwuij95"
```

---
### Task 9: The client API: `syncV3` and shared rows

**Files:**
- Modify: `src/core/api.ts`
- Modify: `test/api-client.test.js`

- [ ] **Step 1: Write the failing test**

In `test/api-client.test.js`, add `import { makeSpace } from './spaces.js';` below the helpers import, and add inside `describe('browser API response contracts', …)`, after the test "accepts the real Worker profile, write, change-feed, and deletion responses":

```js
  it('accepts the real Worker v3 page and shared writes, and refuses a v3 cursor that moves back', async () => {
    const session = await signIn();
    vi.stubGlobal('fetch', (path, options) => SELF.fetch(BASE + path, {
      ...options, redirect: 'manual', headers: { ...options.headers, cookie: session.cookie },
    }));
    const profile = await client.api.me();
    client.bindAccount(profile.id);
    const web = await makeSpace({ members: { [profile.id]: 'owner' } });
    const own = 'u:' + profile.id;
    const first = await client.api.syncV3({ [own]: 0 }, 0);
    expect(first.scopes).toMatchObject([{ id: web.id, scope: web.scope, role: 'owner', members: [{ userId: profile.id }] }]);
    expect(first.changes).toContainEqual(expect.objectContaining({ scope: web.scope, kind: 'courses' }));
    const saved = await client.api.shared.put(web.scope, 'items', 'a1',
      { type: 'assignment', title: 'Lab report', courseId: 'web', date: '2026-10-15', status: 'todo', revision: 0 }, { title: null });
    expect(saved).toMatchObject({ id: 'a1', scope: web.scope, updatedBy: profile.id });
    expect(await client.api.shared.get(web.scope, 'items', 'a1')).toEqual(saved);
    const next = await client.api.syncV3(first.cursors, first.scopes[0].revision);
    expect(next.changes).toEqual([{ scope: web.scope, kind: 'items', row: saved }]);
    expect(next.scopes[0]).not.toHaveProperty('members');
    expect(await client.api.shared.del(web.scope, 'items', 'a1', saved.revision)).toBeNull();
    respond({ ...next, cursors: { [own]: 0 } });
    await expect(client.api.syncV3({ [own]: 5 }, 0)).rejects.toMatchObject({ status: 502 });
    respond({ ...next, changes: [{ scope: own, kind: 'marks', row: saved }] });
    await expect(client.api.syncV3({}, 0)).rejects.toMatchObject({ status: 502 });
  });
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run test/api-client.test.js`
Expected: FAIL — `client.api.syncV3 is not a function`.

- [ ] **Step 3: Implement**

In `src/core/api.ts`:

Replace

```ts
import type { Row } from './db.ts';
import type { Page, ServerProfile } from './store.ts';
```

with

```ts
import type { Row } from './db.ts';
import type { Page, ServerProfile } from './store.ts';
import type { Space } from './types.ts';
```

After the `changes` function (its closing `}`) add:

```ts
/** A v3 page (spec §6): changes across your own scope and your spaces', a cursor per scope. */
export interface PageV3 extends Page { cursors: Record<string, number>; scopes: Space[]; more: boolean; reset: string[]; revoked: string[] }
const SCOPE = /^(u:[^,]+|[cp]:[a-z0-9]{12})$/;
const KINDS = ['courses', 'items', 'quotes', 'study_sessions', 'achievements'];
const scopeList = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === 'string' && SCOPE.test(s));
async function changesV3(cursors: Record<string, number>, sv: number): Promise<PageV3> {
  const list = Object.entries(cursors).map(([scope, seq]) => `${scope}:${seq}`).join(',');
  const page = await request('GET', `/api/sync?v=3&cursors=${encodeURIComponent(list)}&sv=${sv}`);
  const valid = !!page && typeof page.more === 'boolean' && scopeList(page.reset) && scopeList(page.revoked)
    && !!page.cursors && typeof page.cursors === 'object'
    && Object.entries(page.cursors).every(([s, n]) => SCOPE.test(s) && Number.isSafeInteger(n) && (n as number) >= 0)
    && Array.isArray(page.scopes) && page.scopes.every((s: Space | null) => !!s && typeof s.id === 'string' && SCOPE.test(s.scope) && Number.isSafeInteger(s.revision))
    && Array.isArray(page.changes) && page.changes.every((c: { scope?: unknown; kind?: unknown; row?: Row } | null) =>
      !!c && typeof c.scope === 'string' && SCOPE.test(c.scope) && KINDS.includes(c.kind as string)
      && (c.scope.startsWith('u:') || c.kind === 'courses' || c.kind === 'items') && validRecord(c.row));
  if (!valid) throw invalidResponse();
  /* a cursor never moves back, except to 0 for a scope that reset */
  for (const [scope, seq] of Object.entries(page.cursors as Record<string, number>)) {
    if (seq < (cursors[scope] || 0) && !page.reset.includes(scope)) throw invalidResponse();
  }
  return page;
}
/* A shared row's URL: the space id is the scope without its 'c:' or 'p:'. */
const sharedPath = (scope: string, kind: string, id: string) => `/api/spaces/${scope.slice(2)}/${kind}/${encodeURIComponent(id)}`;
```

In `export const api = {`, after `sync: changes,` add:

```ts
  syncV3: changesV3,
  /* a class's or a project's course or item; `changed` is {field: value before} (spec §6 Push) */
  shared: {
    get: (scope: string, kind: string, id: string) => record(request('GET', sharedPath(scope, kind, id)), id),
    put: (scope: string, kind: string, id: string, row: { revision?: number; [field: string]: unknown }, changed?: Record<string, unknown>) =>
      record(request('PUT', sharedPath(scope, kind, id), changed ? { ...row, changed } : row, match(row.revision)), id, row.revision),
    del: (scope: string, kind: string, id: string, revision = 0) => empty(request('DELETE', sharedPath(scope, kind, id), undefined, match(revision))),
  },
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/api-client.test.js && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/core/api.ts test/api-client.test.js
git commit -m "Client API: the v3 page, checked, and a space's shared rows

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JpUR1JXMY3ehtkiJwuij95"
```

---

### Task 10: The sync loop on v3

**Files:**
- Modify: `src/core/sync.ts`
- Modify: `test/sync.test.js`

- [ ] **Step 1: Point the existing tests at v3, and write the new ones**

In `test/sync.test.js`:

(a) In the `vi.mock('../src/core/store.ts', …)` factory, replace

```js
 settleOperation: vi.fn(), rejectOperation: vi.fn(), applyPage: vi.fn(), applyServerProfile: vi.fn(),
```

with

```js
 settleOperation: vi.fn(), rejectOperation: vi.fn(), applyPage: vi.fn(), applyServerProfile: vi.fn(),
 applyRevoked: vi.fn(), spaceRevision: vi.fn(() => 0),
```

(b) Replace

```js
 vi.spyOn(api, 'sync').mockResolvedValue({ changes: [], cursor: 1, more: false });
```

with

```js
 vi.spyOn(api, 'syncV3').mockResolvedValue({ changes: [], cursors: { 'u:u1': 1 }, scopes: [], more: false, reset: [], revoked: [] });
```

(c) Replace

```js
 it.each([403, 408, 429, 500, 502, 503])('retains edits on HTTP %s', async (code) => {
```

with

```js
 it.each([408, 429, 500, 502, 503])('retains edits on HTTP %s', async (code) => {
```

(d) Replace the whole test

```js
 it('reconciles an expired cursor and follows every page', async () => {
   api.sync.mockResolvedValueOnce({ reset: true }).mockResolvedValueOnce({ changes: [], cursor: 10, more: true }).mockResolvedValueOnce({ changes: [], cursor: 12, more: false });
   await sync.syncNow();
   expect(api.sync.mock.calls.map(([cursor]) => cursor)).toEqual([1, 0, 10]);
   expect(store.applyPage).toHaveBeenNthCalledWith(1, { changes: [], cursor: 10, more: true }, true);
 });
```

with

```js
 it('follows every page with a cursor per scope, wipes a reset scope as its rows arrive, and revokes after the last page', async () => {
   store.meta.get.mockImplementation(async (key) => (key === 'cursors' ? { 'u:u1': 7, 'c:abcdefghij12': 3 } : undefined));
   const page = (over) => ({ changes: [], scopes: [], more: false, reset: [], revoked: ['c:zzzzzzzzzzzz'], ...over });
   api.syncV3.mockResolvedValueOnce(page({ cursors: { 'u:u1': 9, 'c:abcdefghij12': 0 }, more: true, reset: ['c:abcdefghij12'] }))
     .mockResolvedValueOnce(page({ cursors: { 'u:u1': 12, 'c:abcdefghij12': 10 }, more: true }))
     .mockResolvedValueOnce(page({ cursors: { 'u:u1': 12, 'c:abcdefghij12': 12 } }));
   await sync.syncNow();
   expect(api.syncV3.mock.calls.map(([cursors]) => cursors)).toEqual([
     { 'u:u1': 7, 'c:abcdefghij12': 3 }, { 'u:u1': 9, 'c:abcdefghij12': 0 }, { 'u:u1': 12, 'c:abcdefghij12': 10 }]);
   expect(store.applyPage.mock.calls.map(([, wipe]) => wipe)).toEqual([[], ['c:abcdefghij12'], []]);
   expect(store.applyRevoked).toHaveBeenCalledTimes(1);
   expect(store.applyRevoked).toHaveBeenCalledWith(['c:zzzzzzzzzzzz']);
   store.meta.get.mockImplementation(() => 1);
 });
 it("sends sv 0 on an account's first sync after the app opens, then the highest space revision held", async () => {
   store.data.profile = { id: 'u9' };
   store.spaceRevision.mockReturnValue(42);
   await sync.syncNow();
   await sync.syncNow();
   expect(api.syncV3.mock.calls.map(([, sv]) => sv)).toEqual([0, 42]);
   store.spaceRevision.mockReturnValue(0);
 });
 it('uploads a shared edit with the fields it changed since it was queued', async () => {
   const shared = { key: 'shared_items:c:abcdefghij12:x', op: 'put', body: { id: 'x', scope: 'c:abcdefghij12', title: 'New', date: '2026-10-18', revision: 4 }, base: { id: 'x', title: 'Old', date: '2026-10-18', revision: 4 }, revision: 4, token: 's' };
   store.pending.mockResolvedValue([shared]);
   vi.spyOn(api.shared, 'put').mockResolvedValue({ ...shared.body, revision: 5 });
   await sync.syncNow();
   expect(api.shared.put).toHaveBeenCalledWith('c:abcdefghij12', 'items', 'x', { ...shared.body, revision: 4 }, { title: 'Old' });
   expect(store.settleOperation).toHaveBeenCalledWith(shared, expect.objectContaining({ revision: 5 }));
 });
 it('sets a refused shared edit aside at once on 403, saying why', async () => {
   const shared = { key: 'shared_items:c:abcdefghij12:x', op: 'put', body: { id: 'x', title: 'New', revision: 4 }, base: { id: 'x', title: 'Old', revision: 4 }, revision: 4, token: 's' };
   store.pending.mockResolvedValue([shared]);
   vi.spyOn(api.shared, 'put').mockRejectedValue(new ApiError(403, { error: 'forbidden' }));
   vi.spyOn(api.shared, 'get').mockResolvedValue({ id: 'x', title: 'Old', revision: 4 });
   await sync.syncNow();
   expect(store.rejectOperation).toHaveBeenCalledWith(shared, { id: 'x', title: 'Old', revision: 4 }, 'You no longer have permission to change this.');
 });
 it('keeps a shared delete that answers 404 for review, since it may mean lost access', async () => {
   const gone = { key: 'shared_items:c:abcdefghij12:x', op: 'delete', body: { id: 'x' }, base: { id: 'x' }, revision: 4, token: 'd' };
   store.pending.mockResolvedValue([gone]);
   vi.spyOn(api.shared, 'del').mockRejectedValue(new ApiError(404, { error: 'not_found' }));
   vi.spyOn(api.shared, 'get').mockRejectedValue(new ApiError(404, { error: 'not_found' }));
   await sync.syncNow();
   expect(store.rejectOperation).toHaveBeenCalledWith(gone, null, 'The server could not accept this edit.');
 });
```

(e) Then point every remaining `api.sync` at `api.syncV3`:

```bash
sed -i 's/api\.sync\b/api.syncV3/g' test/sync.test.js
```

(`\b` leaves the `api.syncV3` already written alone.)

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run test/sync.test.js`
Expected: FAIL — the loop still calls `api.sync` (v2), so `api.syncV3` is never called; the shared tests fail on `op.key.split`.

- [ ] **Step 3: Implement**

In `src/core/sync.ts`:

(a) Replace

```ts
import { untouchedReview } from './reviews.ts';
```

with

```ts
import { untouchedReview } from './reviews.ts';
import { changedFields, parseKey } from './shared.ts';
```

(b) Replace

```ts
const tries = new Map<string, number>();   /* op token → cycles it failed in */
```

with

```ts
const tries = new Map<string, number>();   /* op token → cycles it failed in */
/* Answers no retry can change: the edit goes to the saved copies at once. A lost
   permission (403) does not come back by retrying (spec §6). */
const REFUSED = [400, 403, 404, 409, 413, 422];
/* 'shared_items' → 'items', for the shared routes. */
const sharedKind = (store: string) => store.slice('shared_'.length);
/* Why an edit was set aside, as Settings shows it. */
function reasonFor(e: ApiError): string {
  const body = e.body || {};
  if (body.error === 'legacy_edit') return 'This edit was saved before conflict protection. Review it before restoring.';
  if (body.error === 'conflict') return Array.isArray(body.fields) ? `Someone else changed ${(body.fields as string[]).join(', ')}.` : 'A newer version was saved on another device.';
  if (body.error === 'archived') return 'This class is archived, so it is read-only.';
  if (e.status === 403) return 'You no longer have permission to change this.';
  return 'The server could not accept this edit.';
}
```

(c) In `serverCopy`, replace

```ts
    const [kind, id] = op.key.split(/:(.*)/s);
    return op.key === 'profile' ? await api.me() : await api.get(kind, id);
```

with

```ts
    const k = parseKey(op.key);
    return op.key === 'profile' ? await api.me() : k.scope ? await api.shared.get(k.scope, sharedKind(k.store), k.id) : await api.get(k.store, k.id);
```

(d) In `pushAll`, replace

```ts
      else {
        const [kind, id] = op.key.split(/:(.*)/s);
        if (op.op === 'delete') {
          try { await api.del(kind, id, op.revision); }
          catch (e) { if (!(e instanceof ApiError && e.status === 404)) throw e; }
        } else saved = await api.put(kind, id, { ...op.body, revision: op.revision });
      }
```

with

```ts
      else {
        const k = parseKey(op.key);
        if (k.scope) {
          /* a shared row: a 404 may mean lost access, so a delete is not taken as done */
          if (op.op === 'delete') await api.shared.del(k.scope, sharedKind(k.store), k.id, op.revision);
          else saved = await api.shared.put(k.scope, sharedKind(k.store), k.id, { ...op.body, revision: op.revision }, changedFields(k.store, k.scope, op.body || {}, op.base));
        } else if (op.op === 'delete') {
          try { await api.del(k.store, k.id, op.revision); }
          catch (e) { if (!(e instanceof ApiError && e.status === 404)) throw e; }
        } else saved = await api.put(k.store, k.id, { ...op.body, revision: op.revision });
      }
```

(e) Replace

```ts
      if (e instanceof ApiError && [400, 404, 409, 413, 422].includes(e.status)) {
```

with

```ts
      if (e instanceof ApiError && REFUSED.includes(e.status)) {
```

and replace

```ts
        await store.rejectOperation(op, current, e.body?.error === 'legacy_edit' ? 'This edit was saved before conflict protection. Review it before restoring.' : e.body?.error === 'conflict' ? 'A newer version was saved on another device.' : 'The server could not accept this edit.');
```

with

```ts
        await store.rejectOperation(op, current, reasonFor(e));
```

(f) Replace

```ts
        if (op.key.startsWith('courses:') && op.op === 'put') break;
```

with

```ts
        if (/^(shared_)?courses:/.test(op.key) && op.op === 'put') break;
```

and replace

```ts
function rank(op: PendingOp): number { return op.key.startsWith('courses:') ? (op.op === 'put' ? 0 : 3) : 1; }
```

with

```ts
function rank(op: PendingOp): number { return /^(shared_)?courses:/.test(op.key) ? (op.op === 'put' ? 0 : 3) : 1; }
```

(g) Replace the start of `pullAll`, from

```ts
async function pullAll(cycle: Cycle): Promise<boolean> {
  let cursor = (await store.meta.get('syncCursor') as number | undefined) || 0;
  let reset = cursor === 0;
  let complete = false;
  // Bound resets as well as ordinary pages, then yield the account's sync lock.
  for (let pages = 0; pages < 20 && active(cycle); pages++) {
    const page = await api.sync(cursor);
    if (!active(cycle)) return false;
    if (page.reset) { cursor = 0; reset = true; continue; }
    await store.applyPage(page, reset);
    reset = false; cursor = page.cursor;
    if (!page.more) { complete = true; break; }
  }
  if (!active(cycle)) return false;
```

to the line before `const profile = await api.me();`, with

```ts
/* The account whose member lists this tab holds: until its first complete pull after the
   app opens, `sv` is 0, so every list comes again (a renamed member shows on next open). */
let listsFor: string | null = null;
async function pullAll(cycle: Cycle): Promise<boolean> {
  const stored = await store.meta.get('cursors');
  let cursors: Record<string, number> = stored && typeof stored === 'object' ? { ...(stored as Record<string, number>) } : {};
  const sv = listsFor === cycle.account ? store.spaceRevision() : 0;
  /* a personal cursor of 0 or none: wipe the clean rows and refill (as v2 did) */
  const own = 'u:' + cycle.account;
  let wipe: string[] = cursors[own] ? [] : [own], revoked: string[] = [], complete = false;
  // Bound resets as well as ordinary pages, then yield the account's sync lock.
  for (let pages = 0; pages < 20 && active(cycle); pages++) {
    const page = await api.syncV3(cursors, sv);
    if (!active(cycle)) return false;
    /* a scope that reset comes back with none of its rows: wiped on that page, with its cursor 0 stored in the same transaction */
    await store.applyPage(page, [...new Set([...wipe, ...(page.reset || [])])]);
    wipe = []; revoked = page.revoked || [];
    cursors = { ...cursors, ...page.cursors };
    if (!page.more) { complete = true; break; }
  }
  if (!active(cycle)) return false;
  /* after the last page, so a copy paged into your own scope is already here (spec §6 Revocation) */
  if (complete) {
    await store.applyRevoked(revoked);
    if (!active(cycle)) return false;
    listsFor = cycle.account;
  }
```

(the profile read and everything after it stay as they are).

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/sync.test.js && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/core/sync.ts test/sync.test.js
git commit -m "Sync loop on v3: cursors per scope, sv, revoked after the last page, 403 refused at once, shared pushes with changed

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JpUR1JXMY3ehtkiJwuij95"
```

---

### Task 11: `effectiveItems()` / `effectiveCourses()`, read by every view

Decisions 5–7: the lists are today's arrays themselves while no shared row is shown; views key by `keyOf`/`courseKeyOf`.

**Files:**
- Create: `src/data/effective.ts`
- Create: `src/data/effective.test.ts`
- Modify: `src/data/store.ts`, `src/data/views.ts`, `src/data/actions.ts`, `src/data/ai-context.ts`

- [ ] **Step 1: Write the failing test**

`src/data/effective.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"

vi.mock("@/core/store", () => ({ data: { items: [], courses: [], shared_items: [], shared_courses: [] }, subscribe: () => () => {} }))
vi.mock("@/data/query", () => ({ schoolCal: () => null }))

import { data } from "@/core/store"
import { normalizeCourse, normalizeItem } from "@/core/model"
import { courseKeyOf, effectiveCourses, effectiveItems, keyOf, mergeCourses, mergeItems } from "./effective"
import { instances, tableRows, typeCounts, weekDays } from "./views"
import type { Course, Item } from "./types"

const WEB = "c:abcdefghij12"
const item = (row: Partial<Item> & { id: string }) => normalizeItem({ type: "assignment", title: row.id, date: "2026-09-23", status: "todo", ...row }) as Item
const course = (row: Partial<Course> & { id: string }) => normalizeCourse({ code: row.id.toUpperCase(), name: row.id, ...row }) as Course
const ALL = { search: "", course: "all" }

describe("the effective lists", () => {
    it("are today's arrays themselves while no shared row is shown", () => {
        const store = data as unknown as Record<string, unknown[]>
        store.items = [item({ id: "a" })]
        store.courses = [course({ id: "bio" })]
        store.shared_items = [{ ...item({ id: "a" }), scope: WEB }]
        expect(effectiveItems()).toBe(data.items)
        expect(effectiveCourses()).toBe(data.courses)
        expect(effectiveItems()).toBe(effectiveItems())
    })

    it("leave shared rows out until they are shown, and key them by scope when they are", () => {
        const own = [item({ id: "a" })], shared = [{ ...item({ id: "a" }), scope: WEB }]
        expect(mergeItems(own, shared, false)).toBe(own)
        const both = mergeItems(own, shared, true)
        expect(both.map(keyOf)).toEqual(["a", WEB + "/a"])
        expect(both.map((it) => it.source ?? "personal")).toEqual(["personal", "class"])
        expect(mergeItems(own, [{ ...item({ id: "t", type: "task" }), scope: "p:abcdefghij12" }], true)[1].source).toBe("project")
    })

    it("keep a class course and a personal course with the same id apart in every view", () => {
        const courses = mergeCourses([course({ id: "bio", name: "Biology" })], [{ ...course({ id: "bio", name: "Biology (class)" }), scope: WEB }], true)
        const items = mergeItems([item({ id: "mine", courseId: "bio" })], [{ ...item({ id: "theirs", courseId: "bio" }), scope: WEB }], true)
        expect(courses.map(keyOf)).toEqual(["bio", WEB + "/bio"])
        expect(items.map(courseKeyOf)).toEqual(["bio", WEB + "/bio"])
        const ids = (picked: string) => instances(items, courses, { ...ALL, course: picked }, "2026-09-21", "2026-09-27").map((x) => x.item.id)
        expect(ids("bio")).toEqual(["mine"])
        expect(ids(WEB + "/bio")).toEqual(["theirs"])
        expect(instances(items, courses, { ...ALL, search: "(class)" }, "2026-09-21", "2026-09-27").map((x) => x.item.id)).toEqual(["theirs"])
        expect(tableRows(items, courses, { ...ALL, types: {}, show: "all" }, { key: "course", dir: -1 }).map((it) => it.id)).toEqual(["theirs", "mine"])
        expect(typeCounts(items, WEB + "/bio")).toEqual({ assignment: 1 })
        const day = weekDays({ items, courses, filters: ALL, schedule: "deadlines", anchor: "2026-09-23", today: "2026-09-23", cal: null }).days[2]
        expect(day.entries.map((e) => e.key)).toEqual(["imine", "i" + WEB + "/theirs"])
    })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/data/effective.test.ts`
Expected: FAIL — `Failed to resolve import "./effective"`.

- [ ] **Step 3: Write `src/data/effective.ts`**

```ts
// What every view reads: your own courses and items and, once Stage 4 shows them with your
// marks, your classes' and projects' (spec §7). A class course and a personal course may
// share an id, so a shared row carries `key` '<scope>/<id>' and items name their course by
// `courseKey`. A personal row is left as it is and its key is its id: with no shared row
// shown these are today's arrays themselves, so every view shows exactly what it did.

import { data } from "@/core/store"
import type { Course, Item } from "./types"

/** Where a row comes from; a personal row has none. */
export type Source = "class" | "project"
export type EffectiveCourse = Course & { key?: string; scope?: string; source?: Source }
export type EffectiveItem = Item & { key?: string; scope?: string; source?: Source; courseKey?: string | null }

/** Shared rows join the views in Stage 4, with marks and the split item card: until then an
    edit to one shown here would go through the personal save path. */
export const SHARED_IN_VIEWS = false

/** A row's key in the views: '<scope>/<id>' for a shared row, the id for your own. */
export const keyOf = (r: { id: string; key?: string }): string => r.key ?? r.id
/** The key of an item's course: a shared item's course is in its own scope. */
export const courseKeyOf = (it: EffectiveItem): string | null => (it.courseKey !== undefined ? it.courseKey : it.courseId)

const sourceOf = (scope: string): Source => (scope.startsWith("p:") ? "project" : "class")

export function mergeCourses(own: Course[], shared: (Course & { scope: string })[], show: boolean): EffectiveCourse[] {
    if (!show || !shared.length) return own
    return [...own, ...shared.map((c) => ({ ...c, key: c.scope + "/" + c.id, source: sourceOf(c.scope) }))]
}

export function mergeItems(own: Item[], shared: (Item & { scope: string })[], show: boolean): EffectiveItem[] {
    if (!show || !shared.length) return own
    return [...own, ...shared.map((it) => ({ ...it, key: it.scope + "/" + it.id, source: sourceOf(it.scope), courseKey: it.courseId ? it.scope + "/" + it.courseId : null }))]
}

/* Memoised on the store's arrays, which are new after every reload, so each is a stable
   snapshot for useSyncExternalStore. */
let courses: { own: unknown; shared: unknown; out: EffectiveCourse[] } = { own: null, shared: null, out: [] }
let items: { own: unknown; shared: unknown; out: EffectiveItem[] } = { own: null, shared: null, out: [] }

export function effectiveCourses(): EffectiveCourse[] {
    if (courses.own !== data.courses || courses.shared !== data.shared_courses) {
        courses = { own: data.courses, shared: data.shared_courses, out: mergeCourses(data.courses, data.shared_courses, SHARED_IN_VIEWS) }
    }
    return courses.out
}

export function effectiveItems(): EffectiveItem[] {
    if (items.own !== data.items || items.shared !== data.shared_items) {
        items = { own: data.items, shared: data.shared_items, out: mergeItems(data.items, data.shared_items, SHARED_IN_VIEWS) }
    }
    return items.out
}
```

- [ ] **Step 4: Key the views by `keyOf`/`courseKeyOf`**

In `src/data/views.ts`:

(a) Replace

```ts
import { useCourses, useItems, useProfile, useQuotes, useStudySessions } from "./store"
```

with

```ts
import { useCourses, useItems, useProfile, useQuotes, useStudySessions } from "./store"
import { courseKeyOf, keyOf } from "./effective"
```

(b) Replace

```ts
const courseMap = (courses: Course[]) => new Map(courses.map((c) => [c.id, c]))
```

with

```ts
/* Courses by key: a class course and a personal one may share an id (effective.ts). */
const courseMap = (courses: Course[]) => new Map(courses.map((c) => [keyOf(c), c]))
```

(c) Replace

```ts
    const c = it.courseId ? byId.get(it.courseId) : undefined
```

with

```ts
    const key = courseKeyOf(it), c = key ? byId.get(key) : undefined
```

(d) Replace every `it.courseId === f.course` with `courseKeyOf(it) === f.course` (three places: `passFilters`, `officeHours`, `tasks`):

```bash
sed -i 's/it\.courseId === f\.course/courseKeyOf(it) === f.course/g' src/data/views.ts
```

(e) Replace

```ts
        if (c.archived || (f.course !== "all" && c.id !== f.course)) continue
```

with

```ts
        if (c.archived || (f.course !== "all" && keyOf(c) !== f.course)) continue
```

(f) Replace each of the two `key: "c" + slot.course.id + slot.mtg.id` with `key: "c" + keyOf(slot.course) + slot.mtg.id`, and each of the two `key: "i" + inst.item.id` with `key: "i" + keyOf(inst.item)` (in `weekDays` and `monthCells`):

```bash
sed -i 's/"c" + slot\.course\.id + slot\.mtg\.id/"c" + keyOf(slot.course) + slot.mtg.id/g; s/"i" + inst\.item\.id/"i" + keyOf(inst.item)/g' src/data/views.ts
```

(g) Replace

```ts
            case "course": return (it.courseId && byId.get(it.courseId)?.name) || "zz"
```

with

```ts
            case "course": { const key = courseKeyOf(it); return (key && byId.get(key)?.name) || "zz" }
```

(h) Replace

```ts
        if (course !== "all" && it.courseId !== course) continue
```

with

```ts
        if (course !== "all" && courseKeyOf(it) !== course) continue
```

Check nothing was missed: `grep -n "courseId\|\.id" src/data/views.ts` shows only `x.mtg.id`-style uses and no course lookup by `courseId`.

- [ ] **Step 5: Every hook and read-only list reads the effective lists**

In `src/data/store.ts`, replace

```ts
const items = () => data.items
const courses = () => data.courses
```

with

```ts
/* What the views read: your own rows and, from Stage 4, your classes' and projects' (effective.ts). */
const items = () => effectiveItems()
const courses = () => effectiveCourses()
```

and add below `import type { SavedCopy } from "./types"`:

```ts
import { effectiveCourses, effectiveItems } from "./effective"
```

In `src/data/actions.ts`, add below `import { setSide } from "./sidebar"`:

```ts
import { effectiveCourses, effectiveItems, keyOf } from "./effective"
```

and replace

```ts
export const itemTypes = (): ItemType[] => typeList(ui.bg, data.items)
```

with

```ts
export const itemTypes = (): ItemType[] => typeList(ui.bg, effectiveItems())
```

replace

```ts
    const c = ui.course === "all" ? null : (data.courses as Course[]).find((x) => x.id === ui.course)
```

with

```ts
    const c = ui.course === "all" ? null : (effectiveCourses() as Course[]).find((x) => keyOf(x) === ui.course)
```

and replace

```ts
export const canDeleteType = (t: ItemType) => t.custom && !data.items.some((it) => it.type === t.id)
```

with

```ts
export const canDeleteType = (t: ItemType) => t.custom && !effectiveItems().some((it) => it.type === t.id)
```

In `src/data/ai-context.ts`, replace

```ts
import { data } from "@/core/store"
import { schoolCal } from "@/data/query"
```

with

```ts
import { schoolCal } from "@/data/query"
import { effectiveCourses } from "@/data/effective"
```

and replace

```ts
    const codes = data.courses.filter((c) => !c.archived && c.code).map((c) => c.code).slice(0, 30).join(",")
```

with

```ts
    const codes = effectiveCourses().filter((c) => !c.archived && c.code).map((c) => c.code).slice(0, 30).join(",")
```

If `data` is now unused in `src/data/actions.ts`, leave the import: other lines there still read `data` (`data.courses` in `newAchievement`, `data.profile`). Run `npm run typecheck` to be sure.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/data/effective.test.ts src/data/views.test.ts src/data/data.test.tsx src/components/sidebar.test.tsx src/components/views/table-filters.test.tsx && npm run typecheck`
Expected: PASS; typecheck clean. The view tests did not change: personal rows behave exactly as before.

- [ ] **Step 7: Commit**

```bash
git add src/data/effective.ts src/data/effective.test.ts src/data/store.ts src/data/views.ts src/data/actions.ts src/data/ai-context.ts
git commit -m "Views read effectiveItems/effectiveCourses, keyed by scope; today's lists while no shared row is shown

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JpUR1JXMY3ehtkiJwuij95"
```

---

### Task 12: Documentation and the full check

**Files:**
- Modify: `docs/DATA-MODEL.md` (the `## Sync` section)
- Modify: `docs/superpowers/plans/2026-10-02-collaboration.md` (the stages table)

- [ ] **Step 1: Describe sync v3**

In `docs/DATA-MODEL.md`, at the end of the `## Sync` section (just before the line `## Security model`), add:

```markdown
### Sync v3 (a cursor per scope)

The app pulls `GET /api/sync?v=3&cursors=u:<me>:812,c:<space id>:640&sv=905`. The Worker pages the person's own scope and their live spaces (at most 20), never a scope taken from the request; each scope's changes are read by its own statement, capped at 101 rows and guarded by live membership, all in one D1 batch (D1 refuses a compound SELECT of more than five terms). The answer is `{scopes, cursors, changes:[{scope, kind, row}], more, reset, revoked}`: `scopes` describes each space (with its members only when its revision is above `sv`), `reset` lists scopes whose cursor fell below the floor (each starts again from 0), and `revoked` lists scopes sent that the person may no longer read; the app removes them after the cycle's last page. Shared rows are written through `/api/spaces/<space id>/{courses,items}/<id>`: at the row's revision as a whole; otherwise the fields named in `changed` merge when each still holds its old or new value, else `409 {current, fields, by}`. `?v=2` remains for tabs on the old client and pages only the person's own scope.

On the device, IndexedDB version 5 holds shared rows in `shared_courses` and `shared_items` (keyed `[scope, id]`), the spaces in `spaces`, and `meta.cursors` (`{scope: seq}`); pending keys for shared rows are `shared_items:<scope>:<id>`.
```

- [ ] **Step 2: Mark the stage in the master plan**

In `docs/superpowers/plans/2026-10-02-collaboration.md`, in the stages table, replace the Stage 2 row's last cell `written when Stage 1 is merged` with `docs/superpowers/plans/2026-10-05-collab-stage-2-sync.md`.

- [ ] **Step 3: Run everything**

Run: `npm run check`
Expected: typecheck clean, every Vitest project and the node tests pass, the build succeeds. (Stop any dev server on 8787 first, and kill a leftover vite on 8787/8790; see rule 2.)

- [ ] **Step 4: Check the app by hand, with no spaces**

Run `npm run dev`, sign in, and check: the Week, Month and All items show what they showed before; adding, editing and deleting an item syncs (Network tab: `GET /api/sync?v=3&cursors=u%3A…` answers 200, `scopes: []`); reloading the page keeps everything; DevTools → Application → IndexedDB → `rounds:<id>` is version 5 with `shared_courses`, `shared_items`, `spaces`, and `meta.cursors` holds `{"u:<id>": <seq>}` (no `syncCursor`). Stop the dev server and make sure nothing holds 8787/8790.

- [ ] **Step 5: Commit**

```bash
git add docs/DATA-MODEL.md docs/superpowers/plans/2026-10-02-collaboration.md
git commit -m "Docs: spaces, members and sync v3

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JpUR1JXMY3ehtkiJwuij95"
```

---

### Task 13: Apply the migration remotely, then merge and push

**Only with George's yes** (rule 6). **The deploy is roll-forward only:** once any tab upgrades IndexedDB to version 5, v4 code cannot open that database, so rolling the client back to the old build would leave those devices unable to open their local data. A fix after deploy ships as a new build. The order matters: the new client calls `?v=3`, which reads `spaces` and `members`; the Cloudflare Git build does **not** apply migrations, so the remote database must have `0002_spaces.sql` **before** `main` moves.

- [ ] **Step 1: Apply the migration to the live database**

Run: `npm run db:remote`
Expected: wrangler lists `0002_spaces.sql` as the one migration to apply on `rounds-v7` and reports it applied.

- [ ] **Step 2: Check the live database**

Run: `npm run db:check -- --remote`
Expected: every check passes and the table counts print (no "no such table").

- [ ] **Step 3: Merge and push**

```bash
git switch main
git pull --ff-only
git merge --no-ff collab-2-sync -m "Merge collab-2-sync: spaces and sync v3 (Stage 2)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JpUR1JXMY3ehtkiJwuij95"
npm run check
git push origin main
```

Expected: `npm run check` green on `main`; the push starts the Cloudflare Git build (`npm run build`), which deploys without touching D1.

- [ ] **Step 4: Check the live site**

Once the build is live, open the site (hard reload), sign in, and check as in Task 12 Step 4: views unchanged, `GET /api/sync?v=3…` answers 200, an edit syncs, IndexedDB is version 5. A tab left open on the old client does not keep working on `?v=2`: as soon as another tab opens IndexedDB 5, the old tab's connection is closed through `versionchange` and the tab is reloaded onto the new client. If the live site answers 500 on sync, check first that the remote migration was applied (`npx wrangler d1 migrations list DB --remote`).

---

## Self-review against the spec (done while writing this plan)

| Spec requirement (Stage 2 part) | Where |
|---|---|
| §3 `spaces`: Worker-made 12-char ids, `kind`, `archived`, `school_calendar`, `parent_space`/`parent_item`, code columns, timestamps, `revision` | Task 2 |
| §3 `members`: `role`, the one-live-owner partial unique index, `members (user_id) WHERE deleted_at IS NULL` | Task 2 |
| §3 indexes: join by code `spaces (code_hash)`; purge indexes on `deleted_at` | Task 2 |
| `move-db.js` TABLES gains both tables | Task 2 |
| §5 one builder for guards, inside the statement; non-member 404, member 403, archived 403 | Tasks 3, 4, 5 |
| §5 member task rules: only allowed fields in `changed`; assignee on the current row; claim/unclaim from the current list; `completed_by` from the session | Task 4 (`memberTaskWrite`), Task 5 route |
| §5 assignees must be live members, or `["*"]` | Task 4 (`ASSIGNEES_LIVE`), Task 5 validator |
| §3 "the Worker refuses a second course in a class and a second project item" | Task 5 (`madeWithSpace`, type rule) |
| §6 Pull: memberships ≤ 20, member lists above `sv`, guarded per-scope page, cursor rule, `scopes`, `revoked`, per-scope `reset`, cursor 0 never resets, ≤ 25 cursors, malformed → 400 | Task 6 (page as a batch: Decision 1) |
| §6 member and space writes bump `spaces.revision` in the same batch | Task 3 (`touchSpace`, `NEXT_SPACE_REVISION`; Decision 2). Stage 3's routes use it |
| §6 Push: revision match → whole row; disjoint fields merge; stable JSON; one retry on a lost race; create merges against defaults; deleted never merges; no `changed` = old client | Task 4 |
| §6 409 `{current, fields, by}` | Task 4 |
| §6 statuses: 403 rejected at once; `404` on a shared PUT fetches the row and removes it | Task 10 (`REFUSED`; `serverCopy` → `rejectOperation(op, null)` deletes the local row) |
| §6 Revocation: `revoked` applied after the last page; rows, space, cursor removed; pending ops kept until they 404 into Conflicts | Tasks 8, 10. Carrying mark edits onto a detached copy is Stage 5 (master plan) |
| §7 IndexedDB 5: `shared_courses`/`shared_items` keyed `[scope, id]`, `spaces`, `meta.cursors` migrated from `syncCursor`, pending ops kept | Task 7 |
| §7 pending keys `shared_items:<scope>:<id>`, parsed at the third `:` | Tasks 4 (`parseKey`), 8 |
| §7 ops gain `base` and `changed` | Task 8 (`base`), Task 10 (`changed` computed at push: Decision 4) |
| §7 `effectiveItems()`/`effectiveCourses()`, keyed `scope/id`, every view reads them | Task 11 (Decisions 5–7) |
| §16 v2 sync and personal routes unchanged; personal rows keep whole-row If-Match | Tasks 4–6 add beside them; Task 6 test checks v2 |
| §17 scope never from the body; ids from the Worker; `updated_by`/`completed_by` from the session | Tasks 4, 5 |
| §23 Worker tests: access matrix, v3 paging and cursors, new scope from 0, per-scope reset, `revoked`, removal between the two queries, merge cases (disjoint, same field, JSON by value, edit vs delete both ways, lost race, two first writes), member task rules, lists above `sv`, every new CHECK | Tasks 2–6 |
| §23 Client tests: IndexedDB v5 upgrade, 403 in the sync loop, `revoked` after the last page, `scope/id` keys with a shared id | Tasks 7, 8, 10, 11 |

Not in Stage 2, by the master plan: `marks`/`space_prefs` and merging marks into `effectiveItems()` (Stage 4), `sync?v=2` paging only five kinds (Stage 4, when new kinds exist), the `inbox` count (Stage 7), creating/joining spaces (Stage 3), detach and the extended purge (Stage 5).
