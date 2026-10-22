# Study Together Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Friends (search, request, accept) and shared study rooms with one timer, each person's minutes logged as their own study session plus a group record.

**Architecture:** Friendships and settings live in D1 behind a new `worker/friends.js`. Rooms (Stage 2) store the same timestamp run record as `src/core/timer.ts`, so every device computes the clock itself and polls only for changes. Sessions stay ordinary synced `study_sessions` rows with a new `room_id`.

**Tech Stack:** Cloudflare Workers + D1 (plain JS ES modules), React 19 + TypeScript + Vite, IndexedDB, Vitest (Workers pool + jsdom), wrangler.

**Spec:** `docs/superpowers/specs/2026-10-21-study-together-design.md`. **Prototype:** https://claude.ai/artifact/AZ8dFbcYmd4UnMeo8WErUw

---

## How to work in this repo (read before any task)

1. **Checks:** `npm run typecheck`, `npm test` (Workers + jsdom + node tests), `npm run build`. `npm run check` runs all three. One file: `npx vitest run test/friends.test.js`.
2. **Dev server:** `npm run build` first (wrangler dev serves `dist/rounds`), then `npm run dev` → http://127.0.0.1:8787. On Windows a stopped dev server can leave vite/workerd holding 8787/8790 and serving old code: `Get-NetTCPConnection -LocalPort 8787 -State Listen` and stop the owner.
3. **Line endings:** keep every file LF.
4. **Non-ASCII** (·, —, …): write it with Edit/Write, never through a shell; run `npm run build` after (Vite refuses Latin-1 bytes the tests miss).
5. **Deploying:** the Cloudflare Git build does **not** apply remote D1 migrations. A stage with a migration needs `npm run db:remote` and `npm run db:check -- --remote` before its merge to `main`.
6. **Commits:** end each message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Commit only on the stage branch; never push, merge to `main` or touch remote D1 without George's yes.
7. **Sub-agent worktrees** may start from `main`: create the stage branch yourself and point agents at it.

---

## The stages

| # | Stage | Branch | Database | Detailed plan |
|---|---|---|---|---|
| 1 | Friends: settings, requests, search, Friends tab, inbox entries, maintenance switch, nightly purge | `together-1-friends` | `0006_friends.sql` | **below** (**built** 2026-10-21) |
| 2 | Rooms: shared timer, Study together sheet, room screen, host controls, join/leave, invites in the inbox, `roomId` on sessions, polling | `together-2-rooms` | `0007_rooms.sql` | written after Stage 1 merges |
| 3 | Presence and records: solo "studying now", end summary, group record, History "with" row, With friends tile, room cleanup | `together-3-records` | `0008_presence.sql` | written after Stage 2 merges |

**One change from the spec:** each stage brings its own migration rather than all tables landing in Stage 1, so Stage 2's tables are designed against the code Stage 1 leaves. And the two switches live in a `friend_settings` table, not on `users`: that keeps them out of the profile's revision and out of `scripts/lib/move-db.js`'s users column list. Update spec §4 to match in Stage 1's docs task.

### What Stage 2 must cover (its plan starts from this)
- `0007_rooms.sql`: `rooms` (as spec §4, with `feed`), `room_members`, `study_sessions.room_id` + index; `move-db.js` TABLES/ADDED_TABLES/ORDER_BY; `LATEST_MIGRATION`.
- `worker/rooms.js`: create, get (`?v=` → 304), join, leave (host handover, end when empty), clock (host only: pause/resume/skip/end using `core/timer.ts` arithmetic on the server), invite, me. Join rule: invited or friend of host, under 8, one open room per person. `last_seen` written at most every 30 s.
- `GET /api/inbox` gains `roomInvites` (open rooms only); `unreadCount` counts them.
- `worker/db.js`: `roomId: 'room_id'` in study_sessions `cols`, and in `KEPT_WHEN_ABSENT`.
- Client: `run.ts` room runs (`roomId`, the server's record replaces the local one on each poll), session id `r-<roomId>`, `joined_study_ms` subtraction for minutes; poller 5 s visible / 30 s hidden; Study together card + sheet; room focus screen (people panel, host controls, Leave, Reconnecting note); Join from Friends tab and inbox; maintenance `friends` covers rooms.

### What Stage 3 must cover
- `0008_presence.sql`: `presence`. `PUT/DELETE /api/presence` from `run.ts` start/stop when show_studying is on; `GET /api/friends` adds `live` (room or presence) and `lastStudied`.
- "Studying now" section with Join/Invite; Study nav dot.
- End summary sheet; `GET /api/rooms/:id/record` (minutes summed from sessions); History "with" chips + Group record; With friends this week tile.
- Cron: end rooms unpolled 30 min, drop expired presence, delete rooms 90 days after end unless sessions point at them.

---

# Stage 1: Friends

**Branch:** `git checkout -b together-1-friends` from `main`.

**Files:**
- Create: `migrations/0006_friends.sql`, `worker/friends.js`, `test/friends.test.js`, `src/data/friends.ts`, `src/components/study/friends.tsx`, `src/components/study/friends.test.tsx`
- Modify: `worker/api.js` (routes), `worker/index.js` (purge), `worker/inbox.js` + `worker/activity.js` (requests in the inbox and count), `worker/maintenance.js`, `worker/admin.js` (`LATEST_MIGRATION`), `scripts/lib/move-db.js`, `src/core/types.ts`, `src/core/api.ts`, `src/core/maintenance.ts`, `src/data/types.ts`, `src/data/ui.ts`, `src/data/inbox.ts`, `src/components/study/study-view.tsx`, `src/components/study/study.test.tsx`, `src/components/sheet/inbox-sheet.tsx`, `src/components/admin/maintenance.tsx`, `docs/DATA-MODEL.md`, the spec

### Task 1: Migration

**Files:** Create `migrations/0006_friends.sql`; Modify `worker/admin.js:19`, `scripts/lib/move-db.js:8-30`; Test `test/friends.test.js`

- [ ] **Step 1: Write the failing schema test**

```js
// test/friends.test.js
// Friends (study together, Stage 1): the schema, requests, search, settings, the inbox.
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createUser, signIn } from './helpers.js';

describe('the friendships table', () => {
  it('keeps one row per pair, smaller id first, and drops it with either account', async () => {
    const a = await createUser('fs-a'), b = await createUser('fs-b');
    const ins = (lo, hi, by) => env.DB.prepare("INSERT INTO friendships (user_lo, user_hi, requested_by, status, created_at) VALUES (?, ?, ?, 'pending', 1)").bind(lo, hi, by).run();
    await expect(ins(b, a, a)).rejects.toThrow(/CHECK constraint failed/);           /* u-fs-b > u-fs-a */
    await expect(ins(a, b, 'u-someone')).rejects.toThrow(/CHECK constraint failed/);  /* requester not in the pair */
    await ins(a, b, a);
    await expect(ins(a, b, b)).rejects.toThrow(/UNIQUE|PRIMARY KEY/);
    await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(b).run();
    expect(await env.DB.prepare('SELECT count(*) AS n FROM friendships WHERE user_lo = ?').bind(a).first()).toEqual({ n: 0 });
  });

  it('defaults the settings to on for someone with no row', async () => {
    const api = await signIn('fs-c');
    const body = await (await api('/api/friends')).json();
    expect(body.settings).toEqual({ findable: true, showStudying: true });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run test/friends.test.js`
Expected: FAIL, `no such table: friendships`.

- [ ] **Step 3: Write the migration**

```sql
-- migrations/0006_friends.sql
-- Friends (study together, Stage 1; spec docs/superpowers/specs/2026-10-21-study-together-design.md §1, §4).
-- One row per pair, smaller id first. pending → accepted or declined. Removing a friend or
-- cancelling a request deletes the row; a decline is kept 30 days (from created_at, reset when
-- declined) so the sender keeps seeing "Requested" and is never told. The nightly purge drops it.
CREATE TABLE friendships (
  user_lo       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_hi       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requested_by  TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at    INTEGER NOT NULL,
  accepted_at   INTEGER,
  PRIMARY KEY (user_lo, user_hi),
  CHECK (user_lo < user_hi AND requested_by IN (user_lo, user_hi))
);
-- Rows where you are the larger id (the primary key covers the smaller).
CREATE INDEX friendships_hi ON friendships (user_hi);
-- The nightly purge of old declines.
CREATE INDEX friendships_declined ON friendships (created_at) WHERE status = 'declined';

-- The two switches on the Friends tab. No row means both on. Kept off users, so a change
-- never moves the profile's revision.
CREATE TABLE friend_settings (
  user_id        TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  findable       INTEGER NOT NULL DEFAULT 1 CHECK (findable IN (0, 1)),
  show_studying  INTEGER NOT NULL DEFAULT 1 CHECK (show_studying IN (0, 1))
);
```

- [ ] **Step 4: Register the migration**

`worker/admin.js:19`:
```js
export const LATEST_MIGRATION = '0006_friends.sql';
```

`scripts/lib/move-db.js`, add to `TABLES` after `inbox_seen`:
```js
  friendships: ['user_lo', 'user_hi', 'requested_by', 'status', 'created_at', 'accepted_at'],
  friend_settings: ['user_id', 'findable', 'show_studying'],
```
and change the comment and set below it to:
```js
/* Tables added after rounds-v7's first schema (0002_spaces.sql … 0006_friends.sql): a
   database made before them has none of their rows. */
const ADDED_TABLES = new Set(['spaces', 'members', 'invites', 'marks', 'space_prefs', 'activity', 'inbox_seen', 'friendships', 'friend_settings']);
```
and add `friendships: 'user_lo, user_hi', friend_settings: 'user_id'` to `ORDER_BY`.

The second test needs the route, so it still fails. Go on to Task 2; the first test should pass now:

Run: `npx vitest run test/friends.test.js -t "one row per pair"`
Expected: PASS. Then `npx vitest run test/move-db.test.js test/admin.test.js` → PASS (fix any test that pins the latest migration's name).

- [ ] **Step 5: Commit**

```bash
git add migrations/0006_friends.sql worker/admin.js scripts/lib/move-db.js test/friends.test.js
git commit -m "Study together 1: friendships and friend_settings tables"
```

### Task 2: Reading your friends and the settings

**Files:** Create `worker/friends.js`; Modify `worker/api.js` (import + spread `...friendRoutes` beside `...inboxRoutes` at line 446); Test `test/friends.test.js`

- [ ] **Step 1: Add the failing tests** (append to `test/friends.test.js`)

```js
/* a signed-in user who knows their own username and id (helpers.js makes ids 'u-' + username) */
async function person(name) {
  const api = await signIn(name);
  api.username = name;
  api.id = 'u-' + name;
  return api;
}

describe('GET /api/friends', () => {
  it('lists friends, requests to you and from you, by name', async () => {
    const ann = await person('fr-ann'), bob = await person('fr-bob'), cat = await person('fr-cat'), dan = await person('fr-dan');
    await env.DB.prepare("UPDATE users SET display_name = 'Bob B' WHERE id = ?").bind(bob.id).run();
    await ann('/api/friends', { method: 'POST', body: { username: 'fr-bob' } });
    await bob(`/api/friends/${ann.id}`, { method: 'PUT', body: { accept: true } });
    await cat('/api/friends', { method: 'POST', body: { username: 'fr-ann' } });
    await ann('/api/friends', { method: 'POST', body: { username: 'fr-dan' } });
    const body = await (await ann('/api/friends')).json();
    expect(body.friends.map((f) => [f.userId, f.username, f.name])).toEqual([[bob.id, 'fr-bob', 'Bob B']]);
    expect(body.incoming.map((f) => f.userId)).toEqual([cat.id]);
    expect(body.sent.map((f) => f.userId)).toEqual([dan.id]);
  });

  it('saves the two switches', async () => {
    const eve = await person('fr-eve');
    expect((await eve('/api/friends/settings', { method: 'PUT', body: { findable: false, showStudying: true } })).status).toBe(204);
    expect((await (await eve('/api/friends')).json()).settings).toEqual({ findable: false, showStudying: true });
    expect((await eve('/api/friends/settings', { method: 'PUT', body: { findable: 'no' } })).status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run test/friends.test.js`
Expected: FAIL, 404 on `/api/friends`.

- [ ] **Step 3: Write `worker/friends.js` (reads and settings)**

```js
// Friends (study together, spec §1): requests by username, search, the friends list and the
// two switches. One friendships row per pair, smaller id first (migrations/0006_friends.sql).
// Every check runs here on the server; the client hides buttons only for convenience.
import { json, readJson, HttpError } from './http.js';
import { requireUser } from './auth.js';
import { claimLimit, rateLimited } from './limits.js';
import { normalizeUsername } from './password.js';

const DAY_MS = 24 * 60 * 60 * 1000;
export const FRIEND_LIMIT = 200;
/** Requests one person may send in a day, and searches in a minute. */
export const REQUEST_LIMIT = 20;
export const SEARCH_LIMIT = 30;
export const RESULTS = 8;
export const DECLINE_KEEP_MS = 30 * DAY_MS;
const NAME = "COALESCE(NULLIF(u.display_name, ''), u.username)";

/** The pair's key: smaller id first. */
export const pairOf = (a, b) => (a < b ? [a, b] : [b, a]);
/* the other person in a row read with ?1 = me */
const OTHER = 'CASE WHEN f.user_lo = ?1 THEN f.user_hi ELSE f.user_lo END';

const person = (r) => ({ userId: r.id, username: r.username, name: r.name });

/** {friends, incoming, sent, settings}: names as they are now, newest first. */
export async function listFriends(db, userId) {
  const [rows, settings] = await db.batch([
    db.prepare(`SELECT u.id, u.username, ${NAME} AS name, f.status, f.requested_by, f.created_at, f.accepted_at
      FROM friendships AS f JOIN users AS u ON u.id = ${OTHER}
      WHERE (f.user_lo = ?1 OR f.user_hi = ?1) AND (f.status != 'declined' OR f.requested_by = ?1)
      ORDER BY COALESCE(f.accepted_at, f.created_at) DESC`).bind(userId),
    db.prepare('SELECT findable, show_studying FROM friend_settings WHERE user_id = ?').bind(userId),
  ]);
  const out = { friends: [], incoming: [], sent: [] };
  for (const r of rows.results) {
    if (r.status === 'accepted') out.friends.push({ ...person(r), since: r.accepted_at });
    /* a decline reads as still waiting to the one who asked (spec §1) */
    else if (r.requested_by === userId) out.sent.push({ ...person(r), at: r.created_at });
    else out.incoming.push({ ...person(r), at: r.created_at });
  }
  const s = settings.results[0];
  return { ...out, settings: { findable: s ? s.findable === 1 : true, showStudying: s ? s.show_studying === 1 : true } };
}

/** Requests waiting for your answer, for the inbox: newest first. */
export async function incomingRequests(db, userId) {
  const { results } = await db.prepare(`SELECT u.id, u.username, ${NAME} AS name, f.created_at
    FROM friendships AS f JOIN users AS u ON u.id = f.requested_by
    WHERE (f.user_lo = ?1 OR f.user_hi = ?1) AND f.status = 'pending' AND f.requested_by != ?1
    ORDER BY f.created_at DESC LIMIT 50`).bind(userId).all();
  return results.map((r) => ({ ...person(r), at: r.created_at }));
}

export async function saveSettings(db, userId, body) {
  const { findable, showStudying } = body || {};
  if (typeof findable !== 'boolean') throw new HttpError(400, { error: 'invalid', field: 'findable' });
  if (typeof showStudying !== 'boolean') throw new HttpError(400, { error: 'invalid', field: 'showStudying' });
  await db.prepare(`INSERT INTO friend_settings (user_id, findable, show_studying) VALUES (?1, ?2, ?3)
    ON CONFLICT (user_id) DO UPDATE SET findable = ?2, show_studying = ?3`).bind(userId, findable ? 1 : 0, showStudying ? 1 : 0).run();
}

/** Drop declines older than 30 days (the nightly cron). */
export function purgeFriends(db, now = Date.now()) {
  return db.prepare("DELETE FROM friendships WHERE status = 'declined' AND created_at < ?").bind(now - DECLINE_KEEP_MS).run();
}

const route = (path) => new RegExp(`^/api/${path}$`);

export const friendRoutes = [
  ['GET', route('friends'), async ({ request, env }) => json(await listFriends(env.DB, await requireUser(request, env)))],
  ['PUT', route('friends/settings'), async ({ request, env }) => {
    await saveSettings(env.DB, await requireUser(request, env), await readJson(request));
    return new Response(null, { status: 204 });
  }],
];
```

In `worker/api.js` add `import { friendRoutes } from './friends.js';` beside the inbox import and `...friendRoutes,` right after `...inboxRoutes,` in `routes`.

- [ ] **Step 4: Run** `npx vitest run test/friends.test.js -t "saves the two switches"` → PASS (the listing test needs Task 3's routes).

- [ ] **Step 5: Commit**

```bash
git add worker/friends.js worker/api.js test/friends.test.js
git commit -m "Study together 1: list friends and save the two switches"
```

### Task 3: Requests: send, answer, remove

**Files:** Modify `worker/friends.js`; Test `test/friends.test.js`

Rules (spec §1), with `row` the pair's row and `me` the caller:

| Row before | POST (I ask) | PUT accept / decline (they asked) | DELETE |
|---|---|---|---|
| none | pending, by me | 404 | 404 |
| pending, by me | unchanged, `requested` | 404 | delete (cancel) |
| pending, by them | **accepted** (limits) | accepted / declined | 404 (answer it instead) |
| declined, by me (they declined) | unchanged, `requested` | 404 | delete (cancel) |
| declined, by them (I declined) | pending, by me | 404 | 404 |
| accepted | 409 `friends` | 404 | delete (remove) |

- [ ] **Step 1: Add the failing tests**

```js
describe('friend requests', () => {
  const ask = (api, username) => api('/api/friends', { method: 'POST', body: { username } });
  const answer = (api, id, accept) => api(`/api/friends/${encodeURIComponent(id)}`, { method: 'PUT', body: { accept } });
  const drop = (api, id) => api(`/api/friends/${encodeURIComponent(id)}`, { method: 'DELETE' });
  const lists = async (api) => (await api('/api/friends')).json();

  it('asks, and the other person accepts', async () => {
    const a = await person('rq-a'), b = await person('rq-b');
    const res = await ask(a, 'rq-b');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: b.id, username: 'rq-b', name: 'rq-b', state: 'requested' });
    expect((await answer(b, a.id, true)).status).toBe(200);
    expect((await lists(a)).friends.map((f) => f.userId)).toEqual([b.id]);
    expect((await lists(b)).friends.map((f) => f.userId)).toEqual([a.id]);
    expect((await ask(a, 'rq-b')).status).toBe(409);
  });

  it('accepts when the other person already asked', async () => {
    const a = await person('rq-c'), b = await person('rq-d');
    await ask(a, 'rq-d');
    const res = await ask(b, 'rq-c');
    expect((await res.json()).state).toBe('friends');
  });

  it('declines silently: the asker still sees Requested, and may cancel', async () => {
    const a = await person('rq-e'), b = await person('rq-f');
    await ask(a, 'rq-f');
    expect((await answer(b, a.id, false)).status).toBe(200);
    expect((await lists(a)).sent.map((f) => f.userId)).toEqual([b.id]);
    expect((await lists(b)).incoming).toEqual([]);
    expect((await ask(a, 'rq-f')).status).toBe(200);           /* asking again changes nothing */
    expect((await lists(b)).incoming).toEqual([]);
    expect((await drop(a, b.id)).status).toBe(204);
    expect((await lists(a)).sent).toEqual([]);
  });

  it('lets the one who declined ask later', async () => {
    const a = await person('rq-g'), b = await person('rq-h');
    await ask(a, 'rq-h');
    await answer(b, a.id, false);
    expect((await (await ask(b, 'rq-g')).json()).state).toBe('requested');
    expect((await lists(a)).incoming.map((f) => f.userId)).toEqual([b.id]);
  });

  it('removes a friend, and refuses what does not fit', async () => {
    const a = await person('rq-i'), b = await person('rq-j');
    expect((await ask(a, 'nobody-here')).status).toBe(404);
    expect((await ask(a, 'rq-i')).status).toBe(400);           /* yourself */
    expect((await answer(a, b.id, true)).status).toBe(404);    /* nothing to answer */
    await ask(a, 'rq-j');
    expect((await answer(a, b.id, true)).status).toBe(404);    /* you cannot accept your own */
    expect((await drop(b, a.id)).status).toBe(404);            /* answer it instead */
    await answer(b, a.id, true);
    expect((await drop(b, a.id)).status).toBe(204);
    expect((await lists(a)).friends).toEqual([]);
  });

  it('allows 20 requests a day', async () => {
    const a = await person('rq-k');
    for (let i = 0; i < 20; i++) await ask(a, 'nobody-' + i);   /* unknown names count too */
    expect((await ask(a, 'nobody-x')).status).toBe(429);
  });

  it('stops at 200 friends', async () => {
    const a = await person('rq-l'), b = await person('rq-m');
    const stmts = [];
    for (let i = 0; i < 200; i++) {
      const id = await createUser('rq-many-' + i);
      const [lo, hi] = [a.id, id].sort();
      stmts.push(env.DB.prepare("INSERT INTO friendships (user_lo, user_hi, requested_by, status, created_at, accepted_at) VALUES (?, ?, ?, 'accepted', 1, 1)").bind(lo, hi, lo));
    }
    await env.DB.batch(stmts);
    await ask(b, 'rq-l');
    const res = await answer(a, b.id, true);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('friend_limit');
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run test/friends.test.js`
Expected: FAIL, 404/405 on POST `/api/friends`.

- [ ] **Step 3: Implement** (add to `worker/friends.js`, above `route`)

```js
const ROW = 'SELECT status, requested_by FROM friendships WHERE user_lo = ? AND user_hi = ?';
/* both still under the limit, checked inside the write */
const ROOM_FOR_BOTH = `(SELECT count(*) FROM friendships WHERE status = 'accepted' AND (user_lo = ?3 OR user_hi = ?3)) < ${FRIEND_LIMIT}
  AND (SELECT count(*) FROM friendships WHERE status = 'accepted' AND (user_lo = ?4 OR user_hi = ?4)) < ${FRIEND_LIMIT}`;

async function accept(db, me, other, now) {
  const [lo, hi] = pairOf(me, other);
  const done = await db.prepare(`UPDATE friendships SET status = 'accepted', accepted_at = ?5
    WHERE user_lo = ?1 AND user_hi = ?2 AND status = 'pending' AND requested_by = ?4 AND ${ROOM_FOR_BOTH}
    RETURNING user_lo`).bind(lo, hi, me, other, now).first();
  if (done) return;
  const row = await db.prepare(ROW).bind(lo, hi).first();
  if (row?.status === 'pending' && row.requested_by === other) throw new HttpError(409, { error: 'friend_limit' });
  throw new HttpError(404, { error: 'not_found' });
}

/** Ask someone by username; accepts instead when they already asked you. */
export async function requestFriend(db, me, body, now = Date.now()) {
  const wait = await claimLimit(db, `friend-req:${me}`, REQUEST_LIMIT, now, DAY_MS);
  if (wait) throw rateLimited(wait);
  const name = normalizeUsername(body?.username);
  const who = name && await db.prepare(`SELECT u.id, u.username, ${NAME} AS name FROM users AS u WHERE u.username = ?`).bind(name).first();
  if (!who) throw new HttpError(404, { error: 'no_user' });
  if (who.id === me) throw new HttpError(400, { error: 'invalid', field: 'username' });
  const [lo, hi] = pairOf(me, who.id);
  const row = await db.prepare(ROW).bind(lo, hi).first();
  const out = (state) => ({ ...person(who), state });
  if (row?.status === 'accepted') throw new HttpError(409, { error: 'friends' });
  if (row?.requested_by === who.id && row.status === 'pending') { await accept(db, me, who.id, now); return out('friends'); }
  if (row?.requested_by === me) return out('requested');   /* waiting, or declined unseen */
  /* none, or they asked and I declined: a fresh request from me */
  await db.prepare(`INSERT INTO friendships (user_lo, user_hi, requested_by, status, created_at) VALUES (?1, ?2, ?3, 'pending', ?4)
    ON CONFLICT (user_lo, user_hi) DO UPDATE SET requested_by = ?3, status = 'pending', created_at = ?4
      WHERE friendships.status = 'declined'`).bind(lo, hi, me, now).run();
  return out('requested');
}

/** Accept or decline a request someone sent you. */
export async function answerFriend(db, me, other, body, now = Date.now()) {
  if (typeof body?.accept !== 'boolean') throw new HttpError(400, { error: 'invalid', field: 'accept' });
  if (body.accept) return accept(db, me, other, now);
  const [lo, hi] = pairOf(me, other);
  const done = await db.prepare(`UPDATE friendships SET status = 'declined', created_at = ?4
    WHERE user_lo = ?1 AND user_hi = ?2 AND status = 'pending' AND requested_by = ?3 RETURNING user_lo`).bind(lo, hi, other, now).first();
  if (!done) throw new HttpError(404, { error: 'not_found' });
}

/** Remove a friend, or cancel a request you sent (seen or declined). */
export async function removeFriend(db, me, other) {
  const [lo, hi] = pairOf(me, other);
  const gone = await db.prepare(`DELETE FROM friendships WHERE user_lo = ?1 AND user_hi = ?2
    AND (status = 'accepted' OR requested_by = ?3) RETURNING user_lo`).bind(lo, hi, me).first();
  if (!gone) throw new HttpError(404, { error: 'not_found' });
}
```

Add the routes to `friendRoutes` **after** `friends/settings` (so `settings` is never read as a user id):

```js
  ['POST', route('friends'), async ({ request, env }) =>
    json(await requestFriend(env.DB, await requireUser(request, env), await readJson(request)))],
  ['PUT', route('friends/([^/]{1,64})'), async ({ request, env, params: [other] }) => {
    await answerFriend(env.DB, await requireUser(request, env), other, await readJson(request));
    return json({ ok: true });
  }],
  ['DELETE', route('friends/([^/]{1,64})'), async ({ request, env, params: [other] }) => {
    await removeFriend(env.DB, await requireUser(request, env), other);
    return new Response(null, { status: 204 });
  }],
```

- [ ] **Step 4: Run** `npx vitest run test/friends.test.js` → all PASS so far (the GET listing test now passes too).

- [ ] **Step 5: Commit**

```bash
git add worker/friends.js test/friends.test.js
git commit -m "Study together 1: send, answer, cancel and remove friend requests"
```

### Task 4: Search

**Files:** Modify `worker/friends.js`; Test `test/friends.test.js`

- [ ] **Step 1: Add the failing tests**

```js
describe('GET /api/friends/search', () => {
  const search = async (api, q) => api('/api/friends/search?q=' + encodeURIComponent(q));

  it('finds people by part of their username or name, up to 8, never you', async () => {
    const me = await person('sr-morgan');
    for (const n of ['sr-mora', 'sr-morb', 'sr-other']) await createUser(n);
    await env.DB.prepare("UPDATE users SET display_name = 'Dana Morrow' WHERE id = 'u-sr-other'").run();
    const body = await (await search(me, 'mor')).json();
    const names = body.people.map((p) => p.username);
    expect(names).toEqual(expect.arrayContaining(['sr-mora', 'sr-morb', 'sr-other']));
    expect(names).not.toContain('sr-morgan');
    expect(body.people.length).toBeLessThanOrEqual(8);
    expect(body.people.every((p) => p.state === 'none')).toBe(true);
  });

  it('shows each person\'s state', async () => {
    const a = await person('sr-st-a'), b = await person('sr-st-b'), c = await person('sr-st-c');
    await a('/api/friends', { method: 'POST', body: { username: 'sr-st-b' } });
    await c('/api/friends', { method: 'POST', body: { username: 'sr-st-a' } });
    const by = Object.fromEntries((await (await search(a, 'sr-st')).json()).people.map((p) => [p.username, p.state]));
    expect(by).toEqual({ 'sr-st-b': 'requested', 'sr-st-c': 'asked' });
  });

  it('hides someone who turned off search, except for their exact username', async () => {
    const a = await person('sr-hide-a'), b = await person('sr-hide-b');
    await b('/api/friends/settings', { method: 'PUT', body: { findable: false, showStudying: true } });
    expect((await (await search(a, 'sr-hide')).json()).people).toEqual([]);
    expect((await (await search(a, 'sr-hide-b')).json()).people.map((p) => p.username)).toEqual(['sr-hide-b']);
  });

  it('wants 2 to 40 characters, takes % and _ literally, and allows 30 a minute', async () => {
    const a = await person('sr-lim');
    expect((await search(a, 'x')).status).toBe(400);
    expect((await (await search(a, '%%')).json()).people).toEqual([]);
    /* 'x' is refused before it counts; '%%' counts: 1 + 29 = 30, the most a minute allows */
    for (let i = 0; i < 29; i++) await search(a, 'zz');
    expect((await search(a, 'zz')).status).toBe(429);
  });
});
```

- [ ] **Step 2: Run to see them fail** — `npx vitest run test/friends.test.js -t search` → FAIL (404).

- [ ] **Step 3: Implement** (add to `worker/friends.js`)

```js
const STATE = `CASE WHEN f.status = 'accepted' THEN 'friends'
  WHEN f.requested_by = ?1 THEN 'requested'
  WHEN f.status = 'pending' THEN 'asked' ELSE 'none' END`;

/** Up to 8 people matching `q` (2–40 characters) with where you stand with each. */
export async function searchPeople(db, me, raw, now = Date.now()) {
  const q = String(raw ?? '').trim().toLowerCase();
  if (q.length < 2 || q.length > 40) throw new HttpError(400, { error: 'invalid', field: 'q' });
  const wait = await claimLimit(db, `friend-search:${me}`, SEARCH_LIMIT, now);
  if (wait) throw rateLimited(wait);
  const like = '%' + q.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
  const { results } = await db.prepare(`SELECT u.id, u.username, ${NAME} AS name, ${STATE} AS state
    FROM users AS u
    LEFT JOIN friend_settings AS s ON s.user_id = u.id
    LEFT JOIN friendships AS f ON f.user_lo = min(?1, u.id) AND f.user_hi = max(?1, u.id)
    WHERE u.id != ?1 AND (u.username = ?2
      OR (COALESCE(s.findable, 1) = 1 AND (u.username LIKE ?3 ESCAPE '\\' OR lower(u.display_name) LIKE ?3 ESCAPE '\\')))
    ORDER BY u.username = ?2 DESC, name LIMIT ${RESULTS}`).bind(me, q, like).all();
  return { people: results.map((r) => ({ ...person(r), state: r.state })) };
}
```

Add the route **before** the `friends/([^/]{1,64})` routes:

```js
  ['GET', route('friends/search'), async ({ request, env, url }) =>
    json(await searchPeople(env.DB, await requireUser(request, env), url.searchParams.get('q')))],
```

(`friends/([^/]{1,64})` has no GET, so order only matters for PUT/DELETE, but keep the fixed paths first.)

- [ ] **Step 4: Run** `npx vitest run test/friends.test.js` → PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/friends.js test/friends.test.js
git commit -m "Study together 1: search people by name or username"
```

### Task 5: Inbox, unread count, maintenance switch, nightly purge

**Files:** Modify `worker/inbox.js:16-20`, `worker/activity.js:81-87`, `worker/maintenance.js:12,55-59`, `worker/index.js`; Test `test/friends.test.js`

- [ ] **Step 1: Add the failing tests**

```js
describe('friend requests elsewhere', () => {
  it('appear in the inbox and its unread count until answered', async () => {
    const a = await person('ib-a'), b = await person('ib-b');
    await a('/api/friends', { method: 'POST', body: { username: 'ib-b' } });
    const box = await (await b('/api/inbox')).json();
    expect(box.friendRequests.map((r) => r.userId)).toEqual([a.id]);
    const unread = async () => (await (await b('/api/sync?v=3&cursors=%7B%7D&sv=0')).json()).unread;
    expect(await unread()).toBe(1);
    await b(`/api/friends/${a.id}`, { method: 'PUT', body: { accept: true } });
    expect((await (await b('/api/inbox')).json()).friendRequests).toEqual([]);
    expect(await unread()).toBe(0);
  });

  it('are refused while friends are in maintenance', async () => {
    const a = await person('mt-a');
    await env.DB.prepare("INSERT INTO app_meta (key, value, updated_at) VALUES ('maintenance', ?1, 1) ON CONFLICT (key) DO UPDATE SET value = ?1")
      .bind(JSON.stringify({ features: ['friends'], message: '', updatedAt: 1 })).run();
    try {
      expect((await a('/api/friends')).status).toBe(503);
    } finally {
      await env.DB.prepare("DELETE FROM app_meta WHERE key = 'maintenance'").run();
    }
  });

  it('drops declines after 30 days', async () => {
    const { purgeFriends } = await import('../worker/friends.js');
    const a = await createUser('pg-a'), b = await createUser('pg-b');
    await env.DB.prepare("INSERT INTO friendships (user_lo, user_hi, requested_by, status, created_at) VALUES (?, ?, ?, 'declined', 1)").bind(a, b, a).run();
    await purgeFriends(env.DB, 1 + 31 * 86_400_000);
    expect(await env.DB.prepare('SELECT count(*) AS n FROM friendships WHERE user_lo = ?').bind(a).first()).toEqual({ n: 0 });
  });
});
```

Check the cursor format `GET /api/sync?v=3` accepts (`cursorsParam` in `worker/api.js`); if `{}` is refused, copy the query a test in `test/inbox.test.js` uses for the unread count.

- [ ] **Step 2: Run to see them fail** — FAIL on `friendRequests` undefined, 200 instead of 503.

- [ ] **Step 3: Implement**

`worker/inbox.js`, the `GET inbox` handler:
```js
    const [invites, box, friendRequests] = await Promise.all([myInvites(env.DB, userId), inboxRows(env.DB, userId), incomingRequests(env.DB, userId)]);
    return json({ invites, friendRequests, ...box });
```
with `import { incomingRequests } from './friends.js';`.

`worker/activity.js` `unreadCount`, add a third term inside `MIN(...)`:
```js
      + (SELECT count(*) FROM friendships WHERE (user_lo = ?1 OR user_hi = ?1) AND status = 'pending' AND requested_by != ?1)
```

`worker/maintenance.js`:
```js
export const FEATURES = ['app', 'week', 'month', 'table', 'study', 'spotify', 'import', 'classes', 'friends'];
```
and in `GUARDED`:
```js
  [/^\/api\/friends(\/|$)/, 'friends'],
```

`worker/index.js`: `import { purgeFriends } from './friends.js';` and in `scheduled`:
```js
    ctx.waitUntil(purgeFriends(env.DB));
```

- [ ] **Step 4: Run** `npx vitest run test/friends.test.js test/inbox.test.js test/maintenance.test.js` → PASS. If `test/maintenance.test.js` pins the feature list, add `'friends'` there.

- [ ] **Step 5: Commit**

```bash
git add worker/inbox.js worker/activity.js worker/maintenance.js worker/index.js test/friends.test.js test/maintenance.test.js
git commit -m "Study together 1: requests in the inbox, a maintenance switch, the decline purge"
```

### Task 6: Client types, API and the friends store

**Files:** Modify `src/core/types.ts`, `src/core/api.ts`, `src/core/maintenance.ts`; Create `src/data/friends.ts`; Test `src/data/friends.test.ts`

- [ ] **Step 1: Types** (`src/core/types.ts`, after `Inbox`; and give `Inbox` the new field)

```ts
/** Someone on the app, as the Friends tab names them. */
export interface FriendPerson { userId: string; username: string; name: string }
export interface FriendRequest extends FriendPerson { at: number }
export interface Friend extends FriendPerson { since: number }
/** Where you stand with someone: friends, you asked, they asked, or nothing yet. */
export type FriendState = "none" | "friends" | "requested" | "asked"
export interface FriendMatch extends FriendPerson { state: FriendState }
export interface FriendSettings { findable: boolean; showStudying: boolean }
export interface Friends { friends: Friend[]; incoming: FriendRequest[]; sent: FriendRequest[]; settings: FriendSettings }
```
```ts
export interface Inbox { invites: Invite[]; friendRequests?: FriendRequest[]; items: ActivityRow[]; seen: number }
```
Re-export from `src/data/types.ts` the way the other core types are re-exported there.

- [ ] **Step 2: API** (`src/core/api.ts`, after `invites`; add the types to the import on line 6)

```ts
  /* friends (study together, spec §1) */
  friends: {
    get: (): Promise<Friends> => request('GET', '/api/friends'),
    search: (q: string): Promise<{ people: FriendMatch[] }> => request('GET', '/api/friends/search?q=' + encodeURIComponent(q)),
    ask: (username: string): Promise<FriendMatch> => request('POST', '/api/friends', { username }),
    answer: (userId: string, accept: boolean) => request('PUT', `/api/friends/${encodeURIComponent(userId)}`, { accept }),
    remove: (userId: string) => empty(request('DELETE', `/api/friends/${encodeURIComponent(userId)}`)),
    settings: (s: FriendSettings) => empty(request('PUT', '/api/friends/settings', s)),
  },
```

`src/core/maintenance.ts`: add `"friends"` to `Feature` and `FEATURES`, and to the doc comment ("…shared classes & projects, friends, or the whole app").

- [ ] **Step 3: Write the failing store test**

```ts
// src/data/friends.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest"

const fake = vi.hoisted(() => ({ api: { friends: { get: vi.fn(), search: vi.fn(), ask: vi.fn(), answer: vi.fn(), remove: vi.fn(), settings: vi.fn() } } }))
vi.mock("@/core/api", () => ({ api: fake.api, ApiError: class extends Error { status = 0 } }))
vi.mock("@/core/sync", () => ({ syncNow: vi.fn(() => Promise.resolve()) }))
vi.mock("./inbox", () => ({ dropFriendRequest: vi.fn() }))

import { friendsNow, loadFriends, answerRequest, askFriend, resetFriends } from "./friends"

const list = { friends: [], incoming: [{ userId: "u-b", username: "b", name: "Bea", at: 1 }], sent: [], settings: { findable: true, showStudying: true } }

beforeEach(() => { resetFriends(); vi.clearAllMocks(); fake.api.friends.get.mockResolvedValue(structuredClone(list)) })

describe("the friends store", () => {
    it("loads the list", async () => {
        await loadFriends()
        expect(friendsNow().list?.incoming[0].name).toBe("Bea")
    })

    it("moves an accepted request into friends without waiting for a reload", async () => {
        await loadFriends()
        fake.api.friends.answer.mockResolvedValue({ ok: true })
        fake.api.friends.get.mockReturnValue(new Promise(() => {}))   /* the reload never answers */
        await answerRequest("u-b", true)
        expect(friendsNow().list?.incoming).toEqual([])
        expect(friendsNow().list?.friends.map((f) => f.userId)).toEqual(["u-b"])
    })

    it("says what went wrong when a request fails", async () => {
        await loadFriends()
        const { ApiError } = await import("@/core/api")
        fake.api.friends.ask.mockRejectedValue(Object.assign(new ApiError("x"), { status: 404, body: { error: "no_user" } }))
        expect(await askFriend("ghost")).toBe("Nobody has that username.")
    })
})
```

Check `ApiError`'s real constructor and fields in `src/core/api.ts:11-24` and build the rejected error the way other tests in `src/data/*.test.ts` do (e.g. `classes.test.ts`); keep the expected message.

- [ ] **Step 4: Run** `npx vitest run src/data/friends.test.ts` → FAIL (module missing).

- [ ] **Step 5: Write `src/data/friends.ts`**

```ts
// Friends (study together, spec §1): the list, requests and the two switches, as the server
// has them. Fetched when the Study page opens (and again after a minute); nothing is pushed.
// Each change updates the list at once and then asks the server again.

import { useSyncExternalStore } from "react"
import { api, ApiError } from "@/core/api"
import * as sync from "@/core/sync"
import { dropFriendRequest } from "./inbox"
import type { FriendMatch, FriendSettings, Friends } from "./types"

export const STALE_MS = 60_000
export const LOAD_ERROR = "Could not load your friends. Try again in a minute."

interface State { list: Friends | null; at: number; loading: boolean; offline: boolean; error: string }
let state: State = { list: null, at: 0, loading: false, offline: false, error: "" }
const listeners = new Set<() => void>()
const set = (patch: Partial<State>) => { state = { ...state, ...patch }; for (const fn of listeners) fn() }
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }

export const friendsNow = () => state
export const useFriends = () => useSyncExternalStore(subscribe, friendsNow)
/** For tests and sign-out. */
export const resetFriends = () => set({ list: null, at: 0, loading: false, offline: false, error: "" })

export const friendsStale = (now = Date.now()) => !state.list || (!state.loading && now - state.at > STALE_MS)

export async function loadFriends(): Promise<void> {
    if (state.loading) return
    set({ loading: true })
    try {
        set({ list: await api.friends.get(), at: Date.now(), loading: false, offline: false, error: "" })
    } catch (e) {
        if ((e as Error)?.name === "AbortError") { set({ loading: false }); return }
        set({ loading: false, offline: navigator.onLine === false, error: navigator.onLine === false ? "" : LOAD_ERROR })
    }
}

/** What a failed change says. */
export function friendMessage(e: unknown): string {
    if (!(e instanceof ApiError)) return "That needs a connection. Try again when you're online."
    const code = (e.body as { error?: string } | undefined)?.error
    if (code === "no_user") return "Nobody has that username."
    if (code === "friends") return "You're already friends."
    if (code === "friend_limit") return "One of you already has 200 friends."
    if (e.status === 429) return "That's a lot of requests. Try again later."
    if (e.status === 503) return "Friends are switched off for a moment. Try again soon."
    return "That did not go through. Try again."
}

const edit = (fn: (l: Friends) => Friends) => { if (state.list) set({ list: fn(state.list) }) }
const after = () => { void loadFriends(); sync.syncNow().catch(() => {}) }

/** Ask someone by username. Returns an error message, or "" when it went through. */
export async function askFriend(username: string, shown?: FriendMatch): Promise<string> {
    try {
        const m = await api.friends.ask(username)
        edit((l) => m.state === "friends"
            ? { ...l, incoming: l.incoming.filter((r) => r.userId !== m.userId), friends: [{ ...m, since: Date.now() }, ...l.friends] }
            : { ...l, sent: [{ userId: m.userId, username: m.username, name: m.name, at: Date.now() }, ...l.sent.filter((r) => r.userId !== m.userId)] })
        if (shown) shown.state = m.state
        after()
        return ""
    } catch (e) { return friendMessage(e) }
}

/** Accept or decline someone's request. */
export async function answerRequest(userId: string, accept: boolean): Promise<string> {
    try {
        await api.friends.answer(userId, accept)
        edit((l) => {
            const r = l.incoming.find((x) => x.userId === userId)
            return { ...l, incoming: l.incoming.filter((x) => x.userId !== userId), friends: accept && r ? [{ ...r, since: Date.now() }, ...l.friends] : l.friends }
        })
        dropFriendRequest(userId)
        after()
        return ""
    } catch (e) { return friendMessage(e) }
}

/** Remove a friend, or cancel a request you sent. */
export async function removeFriend(userId: string): Promise<string> {
    try {
        await api.friends.remove(userId)
        edit((l) => ({ ...l, friends: l.friends.filter((x) => x.userId !== userId), sent: l.sent.filter((x) => x.userId !== userId) }))
        after()
        return ""
    } catch (e) { return friendMessage(e) }
}

export async function saveFriendSettings(s: FriendSettings): Promise<string> {
    const before = state.list?.settings
    edit((l) => ({ ...l, settings: s }))
    try { await api.friends.settings(s); return "" } catch (e) {
        if (before) edit((l) => ({ ...l, settings: before }))
        return friendMessage(e)
    }
}

/** Up to 8 people for the search box; [] while it is too short. */
export async function searchPeople(q: string): Promise<{ people: FriendMatch[]; error: string }> {
    if (q.trim().length < 2) return { people: [], error: "" }
    try { return { people: (await api.friends.search(q.trim())).people, error: "" } } catch (e) { return { people: [], error: friendMessage(e) } }
}
```

In `src/data/inbox.ts`, after `dropInvite`:
```ts
/** A friend request answered on the Friends tab: it leaves the list and the count. */
export function dropFriendRequest(userId: string): void {
    if (!box?.friendRequests?.some((r) => r.userId === userId)) return
    box = { ...box, friendRequests: box.friendRequests.filter((r) => r.userId !== userId) }
    setUnread(Math.max(0, unread - 1))
    keep(box)
    emit()
}
```
Also in `markSeen`, the count after reading is invites **plus** friend requests:
```ts
    setUnread(box.invites.filter((i) => !i.expired).length + (box.friendRequests?.length ?? 0))
```

In `src/data/session.ts` sign-out/account change, call `resetFriends()` beside `forgetReads` (find where `ui.lb` is cleared and do it there).

- [ ] **Step 6: Run** `npx vitest run src/data/friends.test.ts src/data/inbox.test.ts` and `npm run typecheck` → PASS.

- [ ] **Step 7: Commit**

```bash
git add src/core/types.ts src/core/api.ts src/core/maintenance.ts src/data/types.ts src/data/friends.ts src/data/friends.test.ts src/data/inbox.ts src/data/session.ts
git commit -m "Study together 1: friends API client and store"
```

### Task 7: The Friends tab

**Files:** Create `src/components/study/friends.tsx`, `src/components/study/friends.test.tsx`; Modify `src/data/types.ts:16`, `src/data/ui.ts:36,59`, `src/components/study/study-view.tsx`, `src/components/study/study.test.tsx:98`

Layout (prototype): two columns, one on narrow screens. Left: **Friends** panel (each row: avatar initials, name, `@username`, Invite (disabled with title "Study together comes next" until Stage 2, so leave it out in Stage 1), Remove). Right: **Add friends** (search), **Requests** (incoming Accept/Decline, sent Cancel; hidden when both empty), and the two switches. "Studying now" arrives in Stage 3.

- [ ] **Step 1: Write the failing component test**

```tsx
// src/components/study/friends.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"

const fake = vi.hoisted(() => ({
    api: { friends: { get: vi.fn(), search: vi.fn(), ask: vi.fn(), answer: vi.fn(), remove: vi.fn(), settings: vi.fn() } },
    maintenance: null as null | "blocked" | "admin",
}))
vi.mock("@/core/api", () => ({ api: fake.api, ApiError: class extends Error {} }))
vi.mock("@/core/sync", () => ({ syncNow: vi.fn(() => Promise.resolve()) }))
vi.mock("@/data/inbox", () => ({ dropFriendRequest: vi.fn() }))
vi.mock("@/data/maintenance", () => ({ useMaintenance: () => fake.maintenance }))
vi.mock("@/components/maintenance", () => ({ MaintenancePage: () => <p>Maintenance</p>, MaintenanceBar: () => null }))
vi.mock("@/data/signin", () => ({ useScreen: () => "app" }))

import { FriendsCard } from "./friends"
import { resetFriends } from "@/data/friends"

const list = () => ({
    friends: [{ userId: "u-sam", username: "samo", name: "Sam Okoye", since: 1 }],
    incoming: [{ userId: "u-jo", username: "jordanlee", name: "Jordan Lee", at: 1 }],
    sent: [{ userId: "u-tk", username: "tkim", name: "Taylor Kim", at: 1 }],
    settings: { findable: true, showStudying: true },
})

beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    resetFriends()
    fake.maintenance = null
    fake.api.friends.get.mockResolvedValue(list())
    vi.stubGlobal("navigator", { onLine: true })
})
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers() })

const show = async () => { render(<FriendsCard />); await act(async () => {}) }

describe("the Friends tab", () => {
    it("lists friends, requests to you and from you", async () => {
        await show()
        expect(within(screen.getByRole("region", { name: "Friends" })).getByText("Sam Okoye")).toBeTruthy()
        const req = screen.getByRole("region", { name: "Requests" })
        expect(within(req).getByRole("button", { name: "Accept Jordan Lee" })).toBeTruthy()
        expect(within(req).getByRole("button", { name: "Cancel the request to Taylor Kim" })).toBeTruthy()
    })

    it("accepts a request", async () => {
        fake.api.friends.answer.mockResolvedValue({ ok: true })
        await show()
        fireEvent.click(screen.getByRole("button", { name: "Accept Jordan Lee" }))
        await act(async () => {})
        expect(fake.api.friends.answer).toHaveBeenCalledWith("u-jo", true)
        expect(within(screen.getByRole("region", { name: "Friends" })).getByText("Jordan Lee")).toBeTruthy()
    })

    it("searches after 2 letters and sends a request", async () => {
        fake.api.friends.search.mockResolvedValue({ people: [{ userId: "u-mo", username: "morgand", name: "Morgan Diaz", state: "none" }] })
        fake.api.friends.ask.mockResolvedValue({ userId: "u-mo", username: "morgand", name: "Morgan Diaz", state: "requested" })
        await show()
        const box = screen.getByRole("searchbox", { name: "Name or username" })
        fireEvent.change(box, { target: { value: "m" } })
        await act(async () => { vi.advanceTimersByTime(400) })
        expect(fake.api.friends.search).not.toHaveBeenCalled()
        fireEvent.change(box, { target: { value: "mor" } })
        await act(async () => { vi.advanceTimersByTime(400) })
        expect(fake.api.friends.search).toHaveBeenCalledWith("mor")
        fireEvent.click(screen.getByRole("button", { name: "Add Morgan Diaz" }))
        await act(async () => {})
        expect(fake.api.friends.ask).toHaveBeenCalledWith("morgand")
        expect(screen.getByText("Requested")).toBeTruthy()
    })

    it("saves the search switch", async () => {
        fake.api.friends.settings.mockResolvedValue(undefined)
        await show()
        fireEvent.click(screen.getByRole("checkbox", { name: /Let people find me in search/ }))
        await act(async () => {})
        expect(fake.api.friends.settings).toHaveBeenCalledWith({ findable: false, showStudying: true })
    })

    it("shows the maintenance page while friends are switched off", async () => {
        fake.maintenance = "blocked"
        await show()
        expect(screen.getByText("Maintenance")).toBeTruthy()
        expect(fake.api.friends.get).not.toHaveBeenCalled()
    })
})
```

Check `Checkbox` in `src/components/sheet/fields.tsx:227` renders an `<input type="checkbox">` labelled by its children; if it does not, use a plain labelled input.

- [ ] **Step 2: Run** `npx vitest run src/components/study/friends.test.tsx` → FAIL (module missing).

- [ ] **Step 3: Write `src/components/study/friends.tsx`**

```tsx
// The Friends tab on the Study page (study together, spec §1): your friends, requests to and
// from you, Add friends (search), and the two switches. Loads when it opens and the list is
// missing or a minute old. While friends are switched off, the maintenance page.

import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { Panel } from "@/components/views/bits"
import { Button, Checkbox, Note, TextInput } from "@/components/sheet/fields"
import { MaintenanceBar, MaintenancePage } from "@/components/maintenance"
import { useMaintenance } from "@/data/maintenance"
import { useScreen } from "@/data/signin"
import { answerRequest, askFriend, friendsStale, loadFriends, removeFriend, saveFriendSettings, searchPeople, useFriends } from "@/data/friends"
import type { FriendMatch, FriendPerson } from "@/data/types"

const ROW = "flex flex-wrap items-center gap-3 border-b border-line-2 py-2.5 last:border-b-0"
const SMALL = "text-[12.5px] text-muted-foreground"
const SEARCH_WAIT_MS = 300

export function FriendsCard() {
    const maintenance = useMaintenance("friends")
    if (maintenance === "blocked") return <MaintenancePage feature="friends" />
    return <Friends bar={maintenance === "admin"} />
}

function Friends({ bar }: { bar: boolean }) {
    const { list, offline, error } = useFriends()
    const screen = useScreen()
    const [msg, setMsg] = useState("")
    useEffect(() => { if (screen === "app" && friendsStale()) void loadFriends() }, [screen])

    const run = async (p: Promise<string>) => setMsg(await p)

    if (!list) return <Panel title="Friends" label="Friends"><div className="p-4"><Note>{offline ? "Friends need a connection." : error || "Loading…"}</Note></div></Panel>

    return (
        <div className="grid items-start gap-4 min-[900px]:grid-cols-[minmax(0,1fr)_320px]">
            {bar && <MaintenanceBar className="min-[900px]:col-span-2" />}
            <Panel title={<>Friends <span className="font-normal text-muted-foreground">{list.friends.length}</span></>} label="Friends">
                <div className="px-4 py-1.5">
                    {list.friends.length === 0 && <p className={cn(SMALL, "py-3")}>No friends yet. Find people with Add friends.</p>}
                    {list.friends.map((f) => (
                        <div key={f.userId} className={ROW}>
                            <Avatar p={f} />
                            <span className="flex min-w-[140px] flex-1 flex-col"><span>{f.name}</span><span className={SMALL}>@{f.username}</span></span>
                            <Button variant="danger" aria-label={"Remove " + f.name} onClick={() => void run(removeFriend(f.userId))}>Remove</Button>
                        </div>
                    ))}
                </div>
            </Panel>
            <div className="flex min-w-0 flex-col gap-4">
                <AddFriends onMessage={setMsg} />
                {(list.incoming.length > 0 || list.sent.length > 0) && (
                    <Panel title="Requests" label="Requests">
                        <div className="px-4 py-1.5">
                            {list.incoming.map((r) => (
                                <div key={r.userId} className={ROW}>
                                    <Avatar p={r} />
                                    <span className="flex min-w-[120px] flex-1 flex-col"><span>{r.name}</span><span className={SMALL}>Wants to be friends</span></span>
                                    <span className="flex gap-1.5">
                                        <Button aria-label={"Accept " + r.name} onClick={() => void run(answerRequest(r.userId, true))}>Accept</Button>
                                        <Button variant="ghost" aria-label={"Decline " + r.name} onClick={() => void run(answerRequest(r.userId, false))}>Decline</Button>
                                    </span>
                                </div>
                            ))}
                            {list.sent.map((r) => (
                                <div key={r.userId} className={ROW}>
                                    <Avatar p={r} />
                                    <span className="flex min-w-[120px] flex-1 flex-col"><span>{r.name}</span><span className={SMALL}>You asked</span></span>
                                    <Button variant="ghost" aria-label={"Cancel the request to " + r.name} onClick={() => void run(removeFriend(r.userId))}>Cancel</Button>
                                </div>
                            ))}
                        </div>
                    </Panel>
                )}
                <Panel title="Privacy" label="Privacy">
                    <div className="flex flex-col gap-3 p-4">
                        <Checkbox id="friends-findable" checked={list.settings.findable}
                            onChange={(on) => void run(saveFriendSettings({ ...list.settings, findable: on }))}>
                            Let people find me in search
                        </Checkbox>
                        <p className={cn(SMALL, "m-0 -mt-1.5 pl-6")}>{list.settings.findable ? "Your name and username show in Add friends." : "Only someone who types your exact username can find you."}</p>
                        <Checkbox id="friends-live" checked={list.settings.showStudying}
                            onChange={(on) => void run(saveFriendSettings({ ...list.settings, showStudying: on }))}>
                            Show friends when I'm studying
                        </Checkbox>
                        <p className={cn(SMALL, "m-0 -mt-1.5 pl-6")}>They see the class you picked and how long you've been going.</p>
                    </div>
                </Panel>
                {msg && <Note tone="bad">{msg}</Note>}
            </div>
        </div>
    )
}

function AddFriends({ onMessage }: { onMessage: (m: string) => void }) {
    const [q, setQ] = useState("")
    const [people, setPeople] = useState<FriendMatch[]>([])
    const [err, setErr] = useState("")
    const asked = useRef(0)
    useEffect(() => {
        const n = ++asked.current
        if (q.trim().length < 2) { setPeople([]); setErr(""); return }
        const t = setTimeout(() => {
            void searchPeople(q).then((r) => { if (n === asked.current) { setPeople(r.people); setErr(r.error) } })
        }, SEARCH_WAIT_MS)
        return () => clearTimeout(t)
    }, [q])

    const add = async (p: FriendMatch) => {
        const m = await askFriend(p.username)
        onMessage(m)
        if (!m) setPeople((all) => all.map((x) => (x.userId === p.userId ? { ...x, state: x.state === "asked" ? "friends" : "requested" } : x)))
    }

    return (
        <Panel title="Add friends" label="Add friends">
            <div className="flex flex-col gap-2.5 p-4">
                <TextInput type="search" aria-label="Name or username" placeholder="Name or username" value={q} maxLength={40}
                    autoComplete="off" onChange={(e) => setQ(e.target.value)} />
                {q.trim().length === 1 && <p className={cn(SMALL, "m-0")}>Keep typing: at least 2 letters.</p>}
                {err && <Note tone="bad">{err}</Note>}
                {q.trim().length >= 2 && !err && people.length === 0 && <p className={cn(SMALL, "m-0")}>Nobody matches. People hidden from search show up only for their exact username.</p>}
                <div>
                    {people.map((p) => (
                        <div key={p.userId} className={ROW}>
                            <Avatar p={p} />
                            <span className="flex min-w-[110px] flex-1 flex-col"><span>{p.name}</span><span className={SMALL}>@{p.username}</span></span>
                            {p.state === "none" && <Button aria-label={"Add " + p.name} onClick={() => void add(p)}>Add</Button>}
                            {p.state === "asked" && <Button aria-label={"Accept " + p.name} onClick={() => void add(p)}>Accept</Button>}
                            {p.state === "requested" && <span className={SMALL}>Requested</span>}
                            {p.state === "friends" && <span className={SMALL}>Friends</span>}
                        </div>
                    ))}
                </div>
            </div>
        </Panel>
    )
}

/* initials on a colour picked from the user id, so a person keeps theirs */
const COLORS = ["#4F74D9", "#8B5CC7", "#F08A6C", "#B8457E", "#4FBF8B", "#7D8A99", "#E8B33A", "#17B3AE"]
function Avatar({ p }: { p: FriendPerson }) {
    let h = 0
    for (const c of p.userId) h = (h * 31 + c.charCodeAt(0)) >>> 0
    const initials = p.name.split(/\s+/).map((w) => w[0] ?? "").join("").slice(0, 2).toUpperCase()
    return (
        <span aria-hidden="true" style={{ background: COLORS[h % COLORS.length] }}
            className="grid size-[30px] flex-none place-items-center rounded-full text-[12px] font-semibold text-white">
            {initials}
        </span>
    )
}
```

Before writing, read `Button`'s variants in `fields.tsx:51` and `Checkbox` at `fields.tsx:227`, and match their real props. `TextInput` with `type="search"` gives the `searchbox` role the test uses.

- [ ] **Step 4: Add the tab**

`src/data/types.ts:16`:
```ts
export type StudyTab = "timer" | "history" | "achievements" | "leaderboard" | "friends"
```
`src/data/ui.ts:59`: add `"friends"` to the list of remembered tabs, and on line 36 make the comment "Timer, History, Achievements, Leaderboard or Friends".

`src/components/study/study-view.tsx`: import `FriendsCard`, extend `TABS` with `["friends", "Friends"]`, add `{open === "friends" && <FriendsCard />}` in the panel, and update the header comment ("then five tabs … Friends is the friends list and Add friends"). Show the incoming count on the tab: read `useFriends().list?.incoming.length` and render, inside the Friends tab button only,
```tsx
{id === "friends" && waiting > 0 && <span className="ml-1.5 rounded-full bg-primary px-1.5 text-[10.5px] leading-4 font-semibold text-primary-foreground" aria-label={waiting + " waiting"}>{waiting}</span>}
```

`src/components/study/study.test.tsx:98`: the tab list now reads `["Timer", "History", "Achievements", "Leaderboard", "Friends"]`; add `friends: { get: vi.fn(() => new Promise(() => {})) }` to the fake `api` so the tab can render, and fix the "four tabs" test name.

- [ ] **Step 5: Run** `npx vitest run src/components/study` and `npm run typecheck` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/study src/data/types.ts src/data/ui.ts
git commit -m "Study together 1: the Friends tab"
```

### Task 8: Friend requests in the inbox sheet, and the Admin switch

**Files:** Modify `src/components/sheet/inbox-sheet.tsx`, `src/components/admin/maintenance.tsx:26`; Test the inbox sheet's existing test file (`src/components/inbox.test.tsx`)

- [ ] **Step 1: Add the failing test** to `src/components/inbox.test.tsx`, following how its invite tests set the fake `api.inbox.get` answer:

```tsx
it("lists friend requests with Accept and Decline", async () => {
    fake.api.inbox.get.mockResolvedValue({ invites: [], friendRequests: [{ userId: "u-jo", username: "jordanlee", name: "Jordan Lee", at: Date.now() }], items: [], seen: 0 })
    fake.api.friends = { answer: vi.fn().mockResolvedValue({ ok: true }) }
    await openTheInbox()   /* the helper this file already uses */
    const list = screen.getByRole("list", { name: "Friend requests" })
    fireEvent.click(within(list).getByRole("button", { name: "Accept Jordan Lee" }))
    await act(async () => {})
    expect(fake.api.friends.answer).toHaveBeenCalledWith("u-jo", true)
})
```

Adjust the helper names to the ones the file has; the assertions stay.

- [ ] **Step 2: Run** it → FAIL.

- [ ] **Step 3: Implement.** In `InboxCard`, before the invites list:

```tsx
{(box.friendRequests?.length ?? 0) > 0 && (
    <ul aria-label="Friend requests" className={LIST}>
        {box.friendRequests!.map((r) => (
            <li key={r.userId} className={ROW}>
                <span><b>{r.name}</b> wants to be friends</span>
                <span className="text-[11px] text-muted-foreground">@{r.username} · {dayMonth(iso(new Date(r.at)))}</span>
                <span className="flex gap-2">
                    <Button variant="ghost" disabled={busy || offline} aria-label={"Decline " + r.name} onClick={() => void friend(r.userId, false)}>Decline</Button>
                    <Button disabled={busy || offline} aria-label={"Accept " + r.name} onClick={() => void friend(r.userId, true)}>Accept</Button>
                </span>
            </li>
        ))}
    </ul>
)}
```
with
```tsx
    const friend = async (userId: string, yes: boolean) => {
        setBusy(true); setErr("")
        const m = await answerRequest(userId, yes)
        setErr(m); setBusy(false)
    }
```
(`import { answerRequest } from "@/data/friends"`), and make the empty note check `box.friendRequests?.length` too. Update the header comment: "invites and friend requests to you, with Accept or Decline, then …".

`src/components/admin/maintenance.tsx`, after the `classes` switch:
```tsx
    ["friends", "Friends & study together", "The Friends tab shows the message, and its routes are refused."],
```

- [ ] **Step 4: Run** `npx vitest run src/components` and `npm run typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/sheet/inbox-sheet.tsx src/components/admin/maintenance.tsx src/components/inbox.test.tsx
git commit -m "Study together 1: friend requests in the inbox; Admin switch"
```

### Task 9: Docs, full check, try it, release

- [ ] **Step 1: Docs.** `docs/DATA-MODEL.md`: add `friendships` and `friend_settings` (what a row means, the pair rule, the 30-day decline). Spec §4 and §9: each stage has its own migration and the switches live in `friend_settings` (the change noted at the top of this plan). Mark Stage 1 built in this plan's stage table.

- [ ] **Step 2: Full check.** `npm run check` → typecheck, every test, and the build pass. Fix anything red before going on.

- [ ] **Step 3: Try it.** `npm run db:local`, `npm run build`, `npm run dev`. Make two users (`npm run user:add`), sign in as each in a normal and a private window: search with 2+ letters, Add, see the bell count and the Requests list on the other side, Accept, Remove; turn off search and check that only the exact username finds you; switch Friends off in Admin and check the tab shows the maintenance page for the non-admin.

- [ ] **Step 4: Commit the docs**

```bash
git add docs
git commit -m "Study together 1: docs"
```

- [ ] **Step 5: Release (only with George's yes).** `npm run db:remote` then `npm run db:check -- --remote` (applies `0006_friends.sql` to rounds-v7), merge `together-1-friends` into `main` with a merge commit, push; the Cloudflare Git build deploys. Check the live site: Friends tab loads, search works.

---

## Self-review notes (done while writing)

- Spec §1 search, requests, limits, silent decline, Remove, switches → Tasks 2–4, 7. "Studying now" and Invite are Stage 3/2 by design.
- Spec §5 inbox → Task 5 (server), Task 8 (sheet). Spec §8 maintenance → Tasks 5, 6, 8. Cron purge → Task 5.
- Route order: `friends/settings` and `friends/search` are listed before `friends/([^/]{1,64})`.
- Names used across tasks: `listFriends`, `incomingRequests`, `requestFriend`, `answerFriend`, `removeFriend` (worker); `loadFriends`, `askFriend`, `answerRequest`, `removeFriend`, `saveFriendSettings`, `searchPeople`, `useFriends`, `friendsNow`, `resetFriends`, `dropFriendRequest` (client). The worker and client both have a `removeFriend` and a `searchPeople`; they are in different modules and never imported together.
