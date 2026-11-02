# Study Buddy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An opt-in game layer on the tracker: a study buddy (a pixel creature per theme, or one made from the person's own picture) that hatches and evolves with timed study and finished items, coins kept by the Worker, tiers to claim, and later a shop, flashcards and AI study tools.

**Architecture:** Settings and the wallet live in D1 behind a new `worker/buddy.js`. Coins are ledger rows the Worker writes itself, keyed by source so nothing pays twice. XP, tier, health and streak are worked out on read from synced rows. The browser only shows what `GET /api/buddy` returns.

**Tech Stack:** Cloudflare Workers + D1 (plain JS ES modules), React 19 + TypeScript + Vite, IndexedDB, Vitest (`@cloudflare/vitest-plugin` + jsdom), wrangler.

**Spec:** `docs/superpowers/specs/2026-10-14-study-buddy-spec.md` and `-design.md` (revised 2026-11-02). Written against `main` at `3aaeaae`.

---

## How to work in this repo (read before any task)

1. **Checks:** `npm run typecheck`, `npm test` (Workers + jsdom + node tests), `npm run build`. `npm run check` runs all three. One file: `npx vitest run test/buddy.test.js`.
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
| 1 | Game core: Gameplay toggle, `buddy` switch, wallet ledger, XP, ranks and claim, health and moods, streak, the six theme buddies, Buddy page, header badge, "+N XP" toast, admin grant | `buddy-1-core` | `0010_buddy.sql` | **below** |
| 2 | Shop and custom buddy: upgrades, backgrounds and frames, grade bonus, a buddy from your own picture, naming | `buddy-2-shop` | `0011_buddy_shop.sql` | from "What Stage 2 must cover" |
| 3 | Decks and spaced repetition, sync v4 | `buddy-3-cards` | `0012_decks.sql` | from "What Stage 3 must cover" |
| 4 | AI gateway, Generate here (Workers AI), Use your own AI (copy and paste) | `buddy-4-ai` | none | written after Stage 3 ships |
| 5 | Quizzes | `buddy-5-quiz` | `0013_quizzes.sql` | later |
| 6 | Notes and study plan | `buddy-6-notes` | `0014_study_docs.sql` | later |
| 7 | Shared class materials | `buddy-7-share` | `0015_activity_share.sql` | later |
| 8 | Connector (MCP), optional | `buddy-8-connector` | `0016_mcp_oauth.sql` | later |

Each stage brings its own migration, so later tables are designed against the code the earlier stages leave, as Study together did.

## Changes from the spec (all accepted in #35, 2026-11-02, and written into the spec and design doc)

The spec was written against the 10/14 code. Reading today's write paths changed seven things. George accepted all seven, so Task 1 can start.

1. **Settings live in a `buddy_settings` table, not on `users`.** This follows `friend_settings`. It keeps the toggle out of the profile's `revision`, so turning gameplay on can't conflict with a Settings edit on another device, and it leaves `scripts/lib/move-db.js`'s `users` column list alone. The toggle is `PUT /api/buddy/settings`, not `PUT /api/me`. the `users.buddy_*` columns and `PUT /api/me {gameplay}` are dropped from spec §2/§3. (`cards_in_feed` moves here too in Stage 3.)
2. **The Worker works out awards when the Buddy page is read, not in each row write's batch.** Spec §4 says coins are written "in the same D1 batch as the row write". But a session, an item or a mark reaches D1 through `putRow`, `upsertMark`, `memberTaskWrite`, the importers and every sync push. Hooking all of them puts game code on the hot path for everyone, including people with gameplay off. Instead, `reconcile()` runs inside `GET /api/buddy`. It reads the live rows and inserts the missing ledger rows (`INSERT … ON CONFLICT DO NOTHING`, keyed by source), so it is idempotent and safe to run concurrently. The client reads the Buddy page after each push of a session, item or mark while gameplay is on, so awards arrive within a sync.
3. **One rules file.** `src/core/buddy-rules.ts` is imported by the Worker, as `worker/db.js` already imports `src/core/shared.ts`. There is no separate `worker/buddy-rules.js` and no parity test.
4. **Anti-farming defaults** (the open questions from the 11/02 review):
   - *Finishes:* every personal (`u:`) finish, exams included, shares one limit of **5 a day**. Class finishes (`marks` on a `c:` item) have no limit, since a class owner made the item. Lecture review tasks (`reviewId` ids, `rv…`, titled "Review n/4 · …") have their own limit of **4 a day** and don't use up the 5. A finish over the limit writes a 0-coin row, so it never pays later.
   - *Finish day:* `completed_at` comes from the browser, so it is clamped between the last reconcile and now. It can't be moved earlier than the Worker's last look.
   - *Sessions:* a session counts only if it was logged within **48 h** of its start (`created_at − started_at ≤ 48 h`; the Worker sets `created_at`). That stops sessions being typed in for past days to fill up each day's 240 minutes.
   - *Room sessions* are written again with a larger total when someone rejoins (`src/data/run.ts:163`), so `session:<id>` rows can grow but never shrink (`amount = max(amount, new)`).
5. **Project (`p:`) items earn nothing in Stage 1.** Added later if George wants (the assignee would get it).
6. **The streak keeps the Buddy page's own rule** (15 timed minutes; card reviews join in Stage 3). The study streak's `dayMin` is set by the person, so it can't be the earning rule.
7. **`admin_log`'s `CHECK` gains `'grant'`**, which means rebuilding the table in `0010`, like the `activity` rebuild in Stage 7.

Smaller points: health skips recurring items (`recur IS NOT NULL`: one status, many dates). XP from finishes counts only finishes recorded while gameplay was on. Days use the zone stored with the settings: the browser sends it, and `validTz` from `worker/push.js` checks it.

### What Stage 2 must cover (its plan starts from this)
- `0011_buddy_shop.sql`: `buddy_owned (user_id, sku, level, at)`; move-db TABLES/ORDER_BY; `LATEST_MIGRATION`.
- `POST /api/buddy/buy {sku, level}`: one statement inserts `buy:<sku>:<level>` only `WHERE` the balance ≥ cost and the level is the next one (`not_enough_coins`, `stale_level`). Focus Engine scales `session:` amounts in `reconcile()`; Finisher scales `item:`.
- Grade bonus: `grade80:` and `grade90:` rows in `reconcile()` for **class** items only (change 4); a personal grade earns nothing.
- Backgrounds and frames: `look.bg` must be an owned sku, drawn behind the buddy by `buddy-sprite.tsx`.
- Custom buddy: `buddy_settings.custom` (TEXT JSON, NULL) in `0011`, with the spec §2 `buddy_settings.custom` rules checked in `worker/buddy.js` (palette 1–16 hex colours, `n` rows of `n` chars, `n` 4–24, each char `0`–`f` or `.`, at most 1 KB). `PUT`/`DELETE /api/buddy/custom`; a `custom` look needs a saved one.
- `src/core/pixelate.ts` (ported from `downscale` and `pixelate` in `design/study-buddies-prototype.html`): halving downscale, background flood from the commonest edge colour, k-means to 3–16 colours, crop to the shape on the bottom row. Tests on small fixture images: a red square on white loses the white; a transparent PNG keeps its alpha; 3 colours give at most 3 palette entries; a blank picture returns null.
- Buddy page › Custom: upload, drop or paste; picture and pixel version side by side; Detail, Colours, Remove the background; the three error messages from spec §9; Save sends only the grid. `look.name` (≤ 16) for any buddy.

### What Stage 3 must cover
- `0012_decks.sql`: `decks`, `cards`, `card_state`, `card_reviews` with `changes` triggers like `marks`; `buddy_settings.cards_in_feed`.
- `worker/db.js`: first an explicit kind list in `syncPageV3` (`db.js:635`) for v3, with a test that a new kind never reaches v3. Then `v=4` serves the new kinds; `src/core/api.ts:170-188` accepts them, shared ones included.
- `reconcile()`: `cards:<day>` coins, +2 health per card per day, and reviews count toward the streak.

---

# Stage 1: Game core

**Branch:** `git checkout -b buddy-1-core` from `main`.

**Files:**
- Create: `migrations/0010_buddy.sql`, `src/core/buddy-rules.ts`, `src/core/buddy-rules.test.ts`, `worker/buddy.js`, `test/buddy-engine.test.js`, `test/buddy.test.js`, `src/data/buddy.ts`, `src/data/buddy.test.ts`, `src/components/buddy/buddy-page.tsx`, `src/components/buddy/buddy-badge.tsx`, `src/components/buddy/buddy.test.tsx`, `src/core/buddy-art.ts`, `src/core/buddy-art.test.ts`, `src/components/buddy/buddy-sprite.tsx`
- Modify: `worker/api.js` (routes), `worker/maintenance.js` (`buddy`), `worker/admin.js` (`LATEST_MIGRATION`, grant route), `scripts/lib/move-db.js`, `src/core/maintenance.ts`, `src/core/api.ts`, `src/core/types.ts`, `src/data/types.ts` (`View`), `src/data/ui.ts`, `src/data/maintenance.ts` (`pageFeature`), `src/data/keyboard.ts` (key 6), `src/data/run.ts` (toast), `src/data/sync.ts` (refresh after a push), `src/components/side-nav.tsx`, `src/components/shell.tsx` (`PAGES`), `src/components/views/views.tsx`, `src/components/top-bar.tsx`, `src/components/sheet/settings-study.tsx`, `src/components/admin/maintenance.tsx`, `src/components/admin/accounts.tsx`, `docs/DATA-MODEL.md`, `docs/DEPLOYING.md`, the spec and design

### Task 1: Migration

**Files:** Create `migrations/0010_buddy.sql`; Modify `worker/admin.js:21`, `scripts/lib/move-db.js:8-41`, `docs/DEPLOYING.md` (migration list); Test `test/buddy.test.js`

- [ ] **Step 1: Write the failing schema test**

```js
// test/buddy.test.js
// Study Buddy, Stage 1: settings, the ledger, the Buddy read, claim, look, admin grant.
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createUser, signIn } from './helpers.js';

describe('the buddy tables', () => {
  it('keeps one settings row per person, gone with the account', async () => {
    const id = await createUser('bd-a');
    await env.DB.prepare("INSERT INTO buddy_settings (user_id, enabled, since, on_at, reconciled_at) VALUES (?, 1, 1, 1, 1)").bind(id).run();
    await expect(env.DB.prepare("INSERT INTO buddy_settings (user_id) VALUES (?)").bind(id).run()).rejects.toThrow(/UNIQUE|PRIMARY KEY/);
    await expect(env.DB.prepare("UPDATE buddy_settings SET enabled = 2 WHERE user_id = ?").bind(id).run()).rejects.toThrow(/CHECK/);
    await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
    expect(await env.DB.prepare('SELECT 1 FROM buddy_settings WHERE user_id = ?').bind(id).first()).toBeNull();
  });

  it('pays each source once; earn rows are never negative, spend rows always are', async () => {
    const id = await createUser('bd-b');
    const ins = (source, kind, amount) => env.DB.prepare("INSERT INTO buddy_ledger (user_id, source, kind, amount, day, at) VALUES (?, ?, ?, ?, '2026-11-02', 1)").bind(id, source, kind, amount).run();
    await ins('session:s1', 'earn', 3);
    await expect(ins('session:s1', 'earn', 3)).rejects.toThrow(/UNIQUE|PRIMARY KEY/);
    await ins('item:u:t6', 'earn', 0);                                 /* over the day's limit: counted, pays nothing */
    await expect(ins('x:1', 'earn', -1)).rejects.toThrow(/CHECK/);
    await expect(ins('buy:x:1', 'spend', 5)).rejects.toThrow(/CHECK/);
    await expect(ins('a'.repeat(65), 'earn', 1)).rejects.toThrow(/CHECK/);
  });

  it('lets admin_log record a grant', async () => {
    await env.DB.prepare("INSERT INTO admin_log (at, admin, action, target) VALUES (1, 'root', 'grant', 'bd-b')").run();
  });
});
```

- [ ] **Step 2: Run it to see it fail:** `npx vitest run test/buddy.test.js` → `no such table: buddy_settings`.

- [ ] **Step 3: Write the migration**

```sql
-- migrations/0010_buddy.sql
-- Study Buddy, Stage 1 (docs/superpowers/specs/2026-10-14-study-buddy-spec.md): the gameplay
-- switch and the wallet. XP, tier, health and streak are worked out on read; only coins are kept.

-- One row per person who has ever turned gameplay on. `since` is the first time (never
-- changes: nothing before it counts); `on_at` the latest; `reconciled_at` the last time the
-- Worker looked for new awards (a finish is dated no earlier than this). `look` is the
-- chosen {buddy, bg, name}: buddy 'auto' follows the profile's theme. `xp_bonus` is admin-granted XP for testing.
CREATE TABLE buddy_settings (
  user_id        TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  enabled        INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  since          INTEGER,
  on_at          INTEGER,
  reconciled_at  INTEGER NOT NULL DEFAULT 0,
  tz             TEXT NOT NULL DEFAULT 'UTC' CHECK (length(tz) BETWEEN 1 AND 64),
  look           TEXT NOT NULL DEFAULT '{"buddy":"auto","bg":"none","name":""}' CHECK (json_valid(look) AND json_type(look) = 'object'),
  xp_bonus       INTEGER NOT NULL DEFAULT 0 CHECK (typeof(xp_bonus) = 'integer' AND xp_bonus BETWEEN 0 AND 100000)
);

-- One row per award or spend; the source names what paid (session:<id>, item:u:<id>,
-- item:c:<space>:<id>, streak:<day>, claim:<tier>, admin:<at>, later buy:<sku>:<level>), so
-- nothing pays twice. Balance = sum(amount). An earn of 0 records a finish over the day's limit.
CREATE TABLE buddy_ledger (
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source   TEXT NOT NULL CHECK (length(source) BETWEEN 1 AND 64),
  kind     TEXT NOT NULL CHECK (kind IN ('earn', 'spend')),
  amount   INTEGER NOT NULL CHECK (typeof(amount) = 'integer' AND ((kind = 'earn' AND amount >= 0) OR (kind = 'spend' AND amount < 0))),
  day      TEXT NOT NULL CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  at       INTEGER NOT NULL,
  PRIMARY KEY (user_id, source)
);
CREATE INDEX buddy_ledger_day ON buddy_ledger (user_id, day);
CREATE INDEX buddy_ledger_at ON buddy_ledger (user_id, at);

-- admin_log's CHECK lists its actions; SQLite cannot change a CHECK, so the table is made
-- again with 'grant' (coins or XP given to an account for testing). No triggers point at it.
CREATE TABLE admin_log_new (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  at       INTEGER NOT NULL,
  admin    TEXT NOT NULL,
  action   TEXT NOT NULL CHECK (action IN ('create', 'reset', 'revoke', 'delete', 'promote', 'demote', 'unlock', 'announce', 'unannounce', 'grant')),
  target   TEXT NOT NULL DEFAULT '',
  detail   TEXT NOT NULL DEFAULT '' CHECK (length(detail) <= 300)
);
INSERT INTO admin_log_new (id, at, admin, action, target, detail) SELECT id, at, admin, action, target, detail FROM admin_log;
DROP TABLE admin_log;
ALTER TABLE admin_log_new RENAME TO admin_log;
CREATE INDEX admin_log_at ON admin_log (at);
```

- [ ] **Step 4: Wire the migration in**
  - `worker/admin.js:21`: `LATEST_MIGRATION = '0010_buddy.sql'` (the test at `test/admin.test.js:439` checks it).
  - `scripts/lib/move-db.js`: add `buddy_settings: ['user_id', 'enabled', 'since', 'on_at', 'reconciled_at', 'tz', 'look', 'xp_bonus']` after `friend_settings`, and `buddy_ledger: ['user_id', 'source', 'kind', 'amount', 'day', 'at']` after it. The wallet moves with the account. `ORDER_BY`: `buddy_settings: 'user_id'`, `buddy_ledger: 'user_id, source'`. `admin_log` keeps its columns.
  - `docs/DEPLOYING.md`: a row `0010_buddy.sql | The Gameplay switch and the coin ledger (buddy_settings, buddy_ledger); admin_log takes 'grant'`, and the next file is `0011`.
  - Account deletion: both tables `ON DELETE CASCADE`, so `ACCOUNT_TABLES` (`worker/accounts.js:79`) needs nothing; the test above proves it.

- [ ] **Step 5: Run** `npx vitest run test/buddy.test.js test/admin.test.js test/move-db.test.js test/database-structure.test.js` → pass. Fix `database-structure.test.js` if it lists tables.
- [ ] **Step 6: Commit** `Buddy 1: migration 0010 (settings, ledger, admin_log grant)`.

### Task 2: The rules

**Files:** Create `src/core/buddy-rules.ts`, `src/core/buddy-rules.test.ts`

- [ ] **Step 1: Write the test**

```ts
// src/core/buddy-rules.test.ts
import { describe, expect, it } from 'vitest';
import { TIERS, tierOf, nextTier, moodOf, FINISHED } from './buddy-rules.ts';

describe('buddy rules', () => {
  it('has seven tiers in rising order, Legend at 4,000 XP', () => {
    expect(TIERS.map((t) => t.id)).toEqual(['egg', 'hatchling', 'r3', 'r4', 'r5', 'r6', 'legend']);
    expect(TIERS.every((t, i) => i === 0 || t.minXp > TIERS[i - 1].minXp)).toBe(true);
    expect(TIERS.at(-1)).toMatchObject({ minXp: 4000, reward: 800 });
  });
  it('picks the highest tier reached and the next one', () => {
    expect(tierOf(0).id).toBe('egg');
    expect(tierOf(119).id).toBe('egg');
    expect(tierOf(120).id).toBe('hatchling');
    expect(nextTier(120)).toMatchObject({ id: 'r3', minXp: 300 });
    expect(nextTier(9999)).toBeNull();
  });
  it('maps health to a mood', () => {
    expect([100, 70, 69, 40, 39, 15, 14, 0].map(moodOf)).toEqual(['happy', 'happy', 'tired', 'tired', 'sick', 'sick', 'hurt', 'hurt']);
  });
  it('counts done, submitted and graded as finished', () => {
    expect(FINISHED).toEqual(['done', 'submitted', 'graded']);
  });
});
```

- [ ] **Step 2: Write `src/core/buddy-rules.ts`.** It holds every number in design doc §Game economy, Stage 1 subset, plus the change-4 limits:

```ts
// The Study Buddy's numbers (design doc, Game economy): the Worker's awards and the
// Buddy page both read them here, so a change is one edit. Starting values, for tuning.
export interface Tier { id: string; minXp: number; reward: number }
/* Ids only: each buddy names its own ranks (src/core/buddy-art.ts BUDDIES[…].ranks). */
export const TIERS: readonly Tier[] = [
  { id: 'egg', minXp: 0, reward: 5 },
  { id: 'hatchling', minXp: 120, reward: 25 },
  { id: 'r3', minXp: 300, reward: 50 },
  { id: 'r4', minXp: 700, reward: 100 },
  { id: 'r5', minXp: 1400, reward: 200 },
  { id: 'r6', minXp: 2500, reward: 400 },
  { id: 'legend', minXp: 4000, reward: 800 },
];
export const DAY_MINUTES = 240;              /* timed minutes a day that earn XP and coins */
export const FINISH_XP = 10;
export const MINUTES_PER_COIN = 5;
export const FINISH_COINS = 5;
export const BIG_FINISH_COINS = 15;          /* a class exam or project; personal ones pay FINISH_COINS (plan change 4) */
export const BIG_TYPES: readonly string[] = ['exam', 'project'];
export const PERSONAL_FINISH_LIMIT = 5;      /* u: finishes a day, every type (plan change 4) */
export const REVIEW_FINISH_LIMIT = 4;        /* lecture review tasks a day, apart from the 5 */
export const LOG_WINDOW_MS = 48 * 3_600_000; /* a session logged later than this after its start earns nothing */
export const STREAK_MINUTES = 15;
export const STREAK_COINS = 2;               /* per streak day */
export const STREAK_MAX = 20;
export const HEALTH_DAYS = 14;
export const HEALTH = { missed: -10, idle: -5, idleFrom: 4, perTenMinutes: 1 } as const;
export const FINISHED: readonly string[] = ['done', 'submitted', 'graded'];
export const GRANT_MAX = { coins: 5000, xp: 10000 } as const;

export const tierOf = (xp: number): Tier => [...TIERS].reverse().find((t) => xp >= t.minXp)!;
export const nextTier = (xp: number): Tier | null => TIERS.find((t) => t.minXp > xp) ?? null;
export type Mood = 'happy' | 'tired' | 'sick' | 'hurt';
export const moodOf = (h: number): Mood => (h >= 70 ? 'happy' : h >= 40 ? 'tired' : h >= 15 ? 'sick' : 'hurt');
```

- [ ] **Step 3: Run** `npx vitest run src/core/buddy-rules.test.ts` → pass. **Commit** `Buddy 1: rules`.

### Task 3: The engine (pure)

**Files:** Create `worker/buddy.js` (the pure half), `test/buddy-engine.test.js`

The engine takes plain rows and returns awards and state. It doesn't touch D1, so every rule is tested on fixtures. Days come from `localNow(tz, ms).day` (`worker/push.js:91`).

- [ ] **Step 1: Write the tests.** Cover each acceptance box in spec §10 Stage 1, plus changes 4 to 6:

```js
// test/buddy-engine.test.js
// The Study Buddy's rules on plain rows: counted minutes, finishes, XP, health, streak.
import { describe, expect, it } from 'vitest';
import { countSessions, sessionAwards, finishAwards, xpOf, healthOf, streakAwards } from '../worker/buddy.js';

const H = 3_600_000, MIN = 60_000;
const T = Date.UTC(2026, 10, 2, 12);                  /* 2026-11-02 12:00 UTC */
const TZ = 'UTC';
const s = (id, startedAt, minutes, more = {}) => ({ id, started_at: startedAt, study_minutes: minutes, manual: 0, created_at: startedAt + minutes * MIN, deleted_at: null, ...more });

describe('counted minutes', () => {
  it('counts timed minutes only, at most 240 a day across sessions, in start order', () => {
    const rows = [s('a', T, 200), s('b', T + 4 * H, 100), s('m', T, 60, { manual: 1 }), s('d', T, 30, { deleted_at: T + H })];
    expect(countSessions(rows, TZ, 0)).toEqual([{ id: 'a', day: '2026-11-02', counted: 200 }, { id: 'b', day: '2026-11-02', counted: 40 }]);
  });
  it('ignores sessions before gameplay was on and sessions logged more than 48 h after they began', () => {
    const rows = [s('old', T - H, 30), s('late', T, 30, { created_at: T + 49 * H })];
    expect(countSessions(rows, TZ, T)).toEqual([]);
  });
  it('splits days in the stored zone', () => {
    const late = Date.UTC(2026, 10, 3, 3);              /* 22:00 on 11-02 in Toronto */
    expect(countSessions([s('t', late, 30)], 'America/Toronto', 0)[0].day).toBe('2026-11-02');
  });
  it('pays a coin per 5 counted minutes (a session written again larger is raised in the ledger, never lowered: Task 4)', () => {
    expect(sessionAwards([{ id: 'a', day: '2026-11-02', counted: 47 }])).toEqual([{ source: 'session:a', amount: 9, day: '2026-11-02' }]);
  });
});

describe('finishes', () => {
  const item = (id, type, more = {}) => ({ key: 'u:' + id, scope: 'u', id, type, status: 'done', completed_at: T, title: id, ...more });
  it('orders by finish time; over 5 personal finishes a day writes 0; class finishes have no limit and pay 15 for an exam', () => {
    /* finished in this order: t1..t6 a minute apart, then the two exams at T */
    const rows = ['t1', 't2', 't3', 't4', 't5', 't6'].map((id, i) => item(id, 'task', { completed_at: T - (6 - i) * MIN }));
    rows.push(item('e1', 'exam'));                                                     /* a personal exam shares the 5, and pays 5 */
    rows.push({ ...item('x1', 'exam'), key: 'c:sp:x1', scope: 'c' });               /* a class exam: no limit, 15 */
    const out = finishAwards(rows, { tz: TZ, from: T - H, now: T, paidToday: { personal: 0, review: 0 } });
    expect(out.filter((a) => a.amount > 0).map((a) => a.source)).toEqual(['item:u:t1', 'item:u:t2', 'item:u:t3', 'item:u:t4', 'item:u:t5', 'item:c:sp:x1']);
    expect(out.find((a) => a.source === 'item:c:sp:x1').amount).toBe(15);
    expect(out.filter((a) => a.amount === 0).map((a) => a.source)).toEqual(['item:u:t6', 'item:u:e1']);
  });
  it('gives lecture reviews their own 4 a day', () => {
    const rv = (n) => item('rvabc' + n, 'task', { title: `Review 1/4 · PHARM Lecture Mon ${n} Sep` });
    const out = finishAwards([1, 2, 3, 4, 5].map(rv), { tz: TZ, from: T - H, now: T, paidToday: { personal: 5, review: 0 } });
    expect(out.map((a) => a.amount)).toEqual([5, 5, 5, 5, 0]);
  });
  it('dates a finish no earlier than the last look and no later than now', () => {
    const out = finishAwards([item('t', 'task', { completed_at: T - 30 * 24 * H })], { tz: TZ, from: T - H, now: T, paidToday: { personal: 0, review: 0 } });
    expect(out[0].day).toBe('2026-11-02');
  });
});

describe('XP', () => {
  it('is counted minutes plus 10 per paid finish still finished, plus the bonus', () => {
    expect(xpOf({ counted: [{ counted: 200 }, { counted: 40 }], finishes: 3, bonus: 50 })).toBe(240 + 30 + 50);
  });
});

describe('health', () => {
  const days = (n) => Array.from({ length: n }, (_, i) => new Date(T - (n - 1 - i) * 24 * H).toISOString().slice(0, 10));
  it('starts at 100, loses 10 for a missed lab and 5 for each idle day from the 4th, gains 1 per 10 minutes, stays in 0-100', () => {
    const window = days(6);                                                     /* 10-28 .. 11-02 */
    const h = healthOf({ window, minutesByDay: { '2026-11-02': 25 }, events: [{ day: '2026-10-28', change: -10 }] });
    /* -10 on 10-28; idle 10-28..11-01 is five days: the 4th and 5th cost 5 each; +2 on 11-02 */
    expect(h).toBe(100 - 10 - 10 + 2);
  });
  it('never goes below 0 or above 100', () => {
    expect(healthOf({ window: days(1), minutesByDay: { [days(1)[0]]: 2000 }, events: [] })).toBe(100);
    expect(healthOf({ window: days(1), minutesByDay: {}, events: Array(20).fill({ day: days(1)[0], change: -10 }) })).toBe(0);
  });
});

describe('streak', () => {
  it('pays 2 per streak day, at most 20; a day under 15 minutes resets it', () => {
    const m = { '2026-10-30': 15, '2026-10-31': 20, '2026-11-01': 5, '2026-11-02': 30 };
    expect(streakAwards(m, '2026-10-30', '2026-11-02')).toEqual({
      awards: [{ source: 'streak:2026-10-30', amount: 2, day: '2026-10-30' }, { source: 'streak:2026-10-31', amount: 4, day: '2026-10-31' }, { source: 'streak:2026-11-02', amount: 2, day: '2026-11-02' }],
      streak: 1,
    });
  });
});
```

- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Write the pure functions in `worker/buddy.js`:**
  - `countSessions(rows, tz, since)`: keep `manual === 0`, `deleted_at === null`, `started_at >= since`, `created_at - started_at <= LOG_WINDOW_MS`. Sort by `(started_at, id)`, take each session's day from `localNow(tz, started_at).day`, and fill each day up to `DAY_MINUTES`. Return only `counted > 0`.
  - `sessionAwards(counted)` → `{source: 'session:'+id, amount: floor(counted / MINUTES_PER_COIN), day}`; drop amount 0.
  - `finishAwards(rows, {tz, from, now, paidToday})`: rows sorted by `(clamped completed_at, key)`, day = `localNow(tz, clamp(completed_at ?? now, from, now)).day`. A row is a review when `/^rv/.test(id)` and `reviewStep`'s title test passes (copy the regex from `src/core/reviews.ts:113`, or import `reviewStep` if the Worker build accepts it). Per day, count against `PERSONAL_FINISH_LIMIT` or `REVIEW_FINISH_LIMIT` for `scope === 'u'`, starting from `paidToday` for the current day. Amount `BIG_FINISH_COINS` for `BIG_TYPES` on class (`scope === 'c'`) rows, else `FINISH_COINS`; 0 over the limit. Source `'item:' + key`.
  - `xpOf({counted, finishes, bonus})`.
  - `healthOf({window, minutesByDay, events})`: walk `window` in order from 100. Per day, apply that day's events, then the idle rule (a run of days with 0 minutes; from the `HEALTH.idleFrom`-th day on, `HEALTH.idle`), then `+ floor(minutes / 10) * HEALTH.perTenMinutes`, clamping after each step.
  - `streakAwards(minutesByDay, fromDay, today)`: walk the days from `fromDay` to `today`. A day with ≥ `STREAK_MINUTES` raises the run and pays `min(STREAK_MAX, STREAK_COINS × run)`; a day under it resets the run. Today counts once it qualifies and doesn't reset the run while it's still under. Returns `{awards, streak}`.
- [ ] **Step 4: Run** → pass. **Commit** `Buddy 1: engine`.

### Task 4: Reconcile and the Buddy read

**Files:** Modify `worker/buddy.js` (the D1 half); Test `test/buddy.test.js`

- [ ] **Step 1: Write the API tests.** Use `signIn` and the row routes, so the real write paths feed the Buddy page:

```js
const MIN = 60_000;
async function player(name, tz = 'UTC') {
  const api = await signIn(name);
  api.id = 'u-' + name;
  expect((await api('/api/buddy/settings', { method: 'PUT', body: { enabled: true, tz } })).status).toBe(200);
  return api;
}
/* as if gameplay had been on since `ms`: nothing before turning it on counts, so tests that log earlier study move the start back */
const backdate = (api, ms) => env.DB.prepare('UPDATE buddy_settings SET since = ?1, on_at = ?1, reconciled_at = ?1 WHERE user_id = ?2').bind(ms, api.id).run();
const buddy = async (api) => (await api('/api/buddy')).json();
const session = (api, id, startedAt, minutes, manual = false) =>
  api(`/api/study_sessions/${id}`, { method: 'PUT', body: { startedAt, studyMinutes: minutes, manual } });

describe('GET /api/buddy', () => {
  it('answers {enabled: false} and writes nothing while gameplay is off', async () => {
    const api = await signIn('bd-off');
    expect(await buddy(api)).toEqual({ enabled: false });
    expect((await env.DB.prepare("SELECT count(*) AS n FROM buddy_ledger WHERE user_id = 'u-bd-off'").first()).n).toBe(0);
  });

  it('pays a timed session once; a manual log pays nothing; the 240-minute day holds', async () => {
    const api = await player('bd-sess');
    /* both sessions on one UTC day that has begun at least 6 h ago, whatever the clock says */
    const DAY = 86_400_000, day0 = Math.floor(Date.now() / DAY) * DAY;
    const base = Date.now() - day0 > 6 * 60 * MIN ? day0 : day0 - DAY;
    await backdate(api, base - MIN);
    await session(api, 's1', base, 200);
    await session(api, 's2', base + 210 * MIN, 100);
    await session(api, 'm1', base + 60 * MIN, 60, true);
    const g = await buddy(api);
    expect(g.coins).toBe(40 + 8 + 2);                   /* 200 → 40; 40 of 100 count → 8; a streak day → 2 */
    expect(g.xp).toBe(240);
    expect((await buddy(api)).coins).toBe(50);          /* a second read pays nothing more */
  });

  it('pays a finish once even after todo → done → todo → done, and stops at 5 personal a day', async () => {
    const api = await player('bd-fin');
    const put = (id, status) => api(`/api/items/${id}`, { method: 'PUT', body: { type: 'task', title: id, date: '2026-11-02', status } });
    await put('t1', 'done'); await buddy(api);
    await put('t1', 'todo'); await put('t1', 'done');
    for (const id of ['t2', 't3', 't4', 't5', 't6']) await put(id, 'done');
    const g = await buddy(api);
    expect(g.coins).toBe(25);
    expect(g.xp).toBe(50);
  });

  it('does not hurt health for a cancelled tutorial, does for a missed lab', async () => { /* … items dated yesterday … */ });
  it('counts nothing logged before gameplay was turned on, and turning it off and on never takes XP away', async () => { /* … */ });
  it('claims a reached tier once; a tier above the XP is tier_not_reached', async () => { /* … POST /api/buddy/claim twice → one claim:egg row … */ });
  it('picks any theme\'s buddy; custom needs a saved one', async () => { /* … PUT /api/buddy/look {buddy:'law'} → 200; {buddy:'custom'} → 409 not_owned; {buddy:'dragon'} → 400 … */ });
  it('two reads at once write each award once', async () => {
    const api = await player('bd-race');
    await session(api, 's1', Date.now() - 30 * MIN, 30);
    await Promise.all([buddy(api), buddy(api)]);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM buddy_ledger WHERE user_id = 'u-bd-race' AND source = 'session:s1'").first()).n).toBe(1);
  });
});
```

Fill in the four sketched tests in the same style before Step 3. Each one is an acceptance box in spec §10.

- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Write `reconcile(db, userId, now)` and `buddyState(db, userId, now)`:**
  - One `db.batch` of reads:
    - settings;
    - sessions `WHERE user_id = ? AND started_at >= since - 2 days` (index `study_sessions_user_started`);
    - personal finishes `SELECT id, type, status, completed_at, title FROM items WHERE scope = 'u:' || ? AND deleted_at IS NULL AND recur IS NULL AND status IN ('done','submitted','graded')`;
    - class finishes `SELECT m.space_id, m.item_id, m.completed_at, i.type, i.title FROM marks m JOIN items i ON i.scope = 'c:' || m.space_id AND i.id = m.item_id AND i.deleted_at IS NULL WHERE m.user_id = ? AND m.deleted_at IS NULL AND m.hidden = 0 AND m.status IN (…)`;
    - the ledger sources and today's paid counts.
  - New awards: `sessionAwards` for counted sessions, `finishAwards` for finished rows with no ledger row (from `reconciled_at`, `on_at` floor; a row with `completed_at < on_at` is skipped), and `streakAwards` from `localNow(tz, on_at).day`.
  - Write in one batch:
    - `INSERT INTO buddy_ledger (user_id, source, kind, amount, day, at) VALUES (?, ?, 'earn', ?, ?, ?) ON CONFLICT (user_id, source) DO UPDATE SET amount = max(amount, excluded.amount) WHERE buddy_ledger.source GLOB 'session:*'`. Only sessions grow (change 4); everything else is `DO NOTHING` in effect, because the `WHERE` fails.
    - `UPDATE buddy_settings SET reconciled_at = ?`.
  - `buddyState`:
    - balance `SELECT sum(amount)`;
    - XP `xpOf` with finishes = paid (`amount > 0`) `item:` rows whose item is still finished (reuse the rows read above);
    - health: `healthOf` over the last `HEALTH_DAYS` days (from no earlier than `since`), with events from personal and class labs and office hours marked `missed` on their date, and assignments still `todo` (no finished mark, for class ones) the day after their date. Tutoring and projects never count.
    - streak, tiers (`reached`, `claimed` from `claim:` rows), `recent` (the last 10 rows with `amount != 0`), `look`, and `due: 0` until Stage 3.
- [ ] **Step 4: Run** → pass. **Commit** `Buddy 1: reconcile and state`.

### Task 5: Routes and the `buddy` switch

**Files:** Modify `worker/buddy.js` (`buddyRoutes`), `worker/api.js` (spread `...buddyRoutes` beside `...friendRoutes`), `worker/maintenance.js`; Test `test/buddy.test.js`, `test/maintenance.test.js`

| Route | Body | Answer |
| --- | --- | --- |
| `GET /api/buddy` | — | `{enabled: false}`, or `{enabled: true, …buddyState}` after `reconcile` |
| `PUT /api/buddy/settings` | `{enabled: bool, tz: string}` | Buddy state. The first `enabled: true` sets `since` and `on_at`; each later one sets `on_at`. Turning on sets `reconciled_at = now`. `tz` must pass `validTz` (`worker/push.js:98`) or the stored one stays |
| `POST /api/buddy/claim` | `{tier}` | Buddy state; `tier_not_reached` 409 above XP; a second claim pays nothing (`ON CONFLICT DO NOTHING`) |
| `PUT /api/buddy/look` | `{buddy?}` | Buddy state; `buddy` is `auto` or one of the six theme ids (`custom` is 409 `not_owned` until Stage 2); `bg` only `'none'` and `name` only `''` until Stage 2 |

- [ ] **Step 1: Tests:**
  - every write while off → 409 `gameplay_off`;
  - a bad `tz` keeps the stored zone;
  - `buddy` maintenance → 503 for non-admins on all four routes, admins pass;
  - the leaderboard and sync are untouched by the switch.
- [ ] **Step 2: Implement.**
  - `worker/maintenance.js:13`: add `'buddy'` to `FEATURES`, and to `GUARDED`: `[/^\/api\/buddy(\/|$)/, 'buddy']`.
  - Ids and tiers are checked against `TIERS` from `src/core/buddy-rules.ts`.
- [ ] **Step 3: Run** `npx vitest run test/buddy.test.js test/maintenance.test.js test/endpoints.test.js` → pass. `endpoints.test.js` lists every route, so add the four there. **Commit** `Buddy 1: routes and switch`.

### Task 6: Admin grant

**Files:** Modify `worker/admin.js` (route next to the accounts routes); Test `test/admin.test.js`

- [ ] **Step 1: Tests:**
  - `POST /api/admin/buddy/grant {userId, coins: 100}` writes `admin:<at>` (earn 100) and an `admin_log` row `grant` whose detail is `coins 100`;
  - `{xp: 500}` sets `xp_bonus` (creating the settings row, off, when missing);
  - out of range → 400;
  - a non-admin → 403;
  - an unknown user → 404.
- [ ] **Step 2: Implement** with `requireAdmin`, `target()` and `audit(…, 'grant', username, detail)` in the same `db.batch` as the ledger insert or the settings upsert. Limits come from `GRANT_MAX`.
- [ ] **Step 3: Run and commit** `Buddy 1: admin grant`.

### Task 7: Client data

**Files:** Modify `src/core/types.ts`, `src/core/api.ts`, `src/core/maintenance.ts`; Create `src/data/buddy.ts`, `src/data/buddy.test.ts`; Modify `src/data/sync.ts`

- [ ] **Step 1: Types.** In `src/core/types.ts`, `BuddyState` as the `GET /api/buddy` answer, and `BuddyOff = {enabled: false}`.
- [ ] **Step 2: `api.buddy`** in `src/core/api.ts`, next to `api.friends` (`api.ts:272`):
  - methods `get()`, `settings(enabled, tz)`, `claim(tier)`, `look({buddy})`;
  - `get` checks the shape the way `changesV3` does (numbers are safe integers, `tiers` has 7 entries, `mood` is a known mood), and anything else is `invalidResponse()`.
- [ ] **Step 3: `src/data/buddy.ts`**, a `createStore` like `src/data/friends.ts`:
  - `useBuddy`, `loadBuddy()` (stale after a minute), `setGameplay(enabled)` (sends `Intl.DateTimeFormat().resolvedOptions().timeZone`), `claimTier`, `pickBuddy`, `resetBuddy` (sign-out);
  - `lastXp`, so the toast can show the difference.
- [ ] **Step 4:** After a push that carried `study_sessions`, `items` or `marks` while gameplay is on, `loadBuddy()`. Hook it in `src/data/sync.ts` where pushes settle, at most once per sync.
- [ ] **Step 5:** `src/core/maintenance.ts`: add `"buddy"` to `Feature` and `FEATURES`.
- [ ] **Step 6: Tests** (`src/data/buddy.test.ts`, with the api mocked as in `friends.test.ts`):
  - off → nothing shown;
  - on → state;
  - an invalid answer keeps the last good state;
  - a 503 maintenance answer hides the Buddy page.
- [ ] **Step 7: Commit** `Buddy 1: client data`.

### Task 8: Settings › Gameplay

**Files:** Modify `src/components/sheet/settings-study.tsx`; Test `src/components/sheet/settings-sheet.test.tsx`

- [ ] **Step 1:** Add a "Gameplay" row with a switch (Term components, as the other Study settings use).
  - The first time it's turned on, show a one-time card: "Your study buddy hatches and grows with timed study and finished items. Typed-in study doesn't count. Your buddy and coins are only ever shown to you." Remember that the card was shown in localStorage, per account, wrapped in try/catch.
  - Turning it off hides the Buddy page and the badge and keeps the data.
  - The switch is hidden while `buddy` is in maintenance.
- [ ] **Step 2: Tests:** toggling calls `api.buddy.settings`; the card shows once; a failed save shows the error and reverts the switch.
- [ ] **Step 3: Commit** `Buddy 1: Gameplay setting`.

### Task 9: The Buddy page

**Files:** Create `src/components/buddy/buddy-page.tsx`, `src/components/buddy/buddy.test.tsx`, `src/core/buddy-art.ts`, `src/core/buddy-art.test.ts`, `src/components/buddy/buddy-sprite.tsx`; Modify `src/data/types.ts` (`View` gains `"buddy"`), `src/components/shell.tsx:13` (`PAGES`), `src/components/views/views.tsx:23` (lazy `BuddyPage`), `src/components/side-nav.tsx` (a "Buddy" entry, key 6, shown only while gameplay is on), `src/data/keyboard.ts:18` (`6: "buddy"`, ignored while off), `src/data/maintenance.ts:28` (`pageFeature` includes `buddy`)

- [ ] **Step 1: The art.** Port the prototype (`design/study-buddies-prototype.html`; open it in a browser to compare) into `src/core/buddy-art.ts`:
  - `BUDDIES`: the six theme buddies (name, rank names, body colours, egg pattern, hat, item, outfit) keyed by theme id, matching `src/data/themes.ts`'s `Bg`;
  - `sprite(buddy, tier, mood, frame, custom?)` → a 32 × 32 array of colours or null, pure and deterministic, with the outline pass and the legend's aura and sparkles;
  - `buddyFor(look, bg)`: `auto` → the profile's theme.
  `src/components/buddy/buddy-sprite.tsx` paints a grid on a `<canvas>` at a whole-number scale with `image-rendering: pixelated`, an `aria-label` ("Pip, Resident, happy"), and the two-frame idle animation (550 ms; none under `prefers-reduced-motion` or while `document.hidden`). One shared timer drives every sprite on screen.
- [ ] **Step 2: Art tests** (`src/core/buddy-art.test.ts`):
  - every theme × tier × mood × frame stays inside 32 × 32 and has at least one outline pixel;
  - a short hash of each grid matches a table in the test, so an accidental change to the art fails loudly (update the table on purpose);
  - tier 0 is an egg (no eyes), tier 3 has the hat, tier 4 the item, tier 5 the outfit, and the legend has gold pixels;
  - `buddyFor({buddy: 'auto'}, 'law')` is `law`.
- [ ] **Step 3: Page.**
  - **The buddy:** the chosen buddy at its tier and mood, at 8×, with its name and rank title ("Pip · Resident").
  - **Bars and streak:** the XP bar to the next rank ("120 / 300 XP"), the health bar with the mood's word, the streak.
  - **Rank list:** seven rows with the buddy's rank names and what each adds (hat, item, outfit, legend), each Locked, Claim or Claimed.
  - **Pick a buddy:** Auto (your theme) and the six theme buddies, each shown at the person's current rank.
  - **Recent earnings:** the last 10, worded "Study session · +9", "Finished item · +5", "Streak day · +4", "Rank claimed · +25", "Admin grant · +100".
  - Empty, loading, offline and error states follow `friends.tsx`.
- [ ] **Step 4: Tests:**
  - the right mood for each health range;
  - Claim calls the api and the row becomes Claimed;
  - picking Law calls `api.buddy.look({buddy: 'law'})` and the art changes;
  - the page isn't reachable with gameplay off (key 6 does nothing, there's no nav entry);
  - maintenance shows the maintenance panel.
- [ ] **Step 5: Commit** `Buddy 1: buddy art and Buddy page`.

### Task 10: Header badge and the "+N XP" toast

**Files:** Create `src/components/buddy/buddy-badge.tsx`; Modify `src/components/top-bar.tsx:69` (beside `InboxBell`), `src/data/run.ts:163`

- [ ] **Step 1: Badge.** The buddy at 32 px (`buddy-sprite.tsx`, scale 1) plus the coin count; a tap opens the Buddy page. It pulses once when a tier is reached but not claimed, and is hidden while off or in maintenance. Its accessible name is "Buddy: 48 coins".
- [ ] **Step 2: Toast.** In `finish()`, after `store.saveStudySession(...)` succeeds, run, without awaiting the run's own result: `syncNow().then(loadBuddy).then(...)`. If XP rose, `toast("+N XP")`; offline it says nothing. Only for timed runs, which are the only ones `finish()` logs.
- [ ] **Step 3: Tests:**
  - the badge hides while off;
  - after a run ends, the toast shows the difference;
  - nothing shows when gameplay is off.
- [ ] **Step 4: Commit** `Buddy 1: badge and toast`.

### Task 11: Admin page

**Files:** Modify `src/components/admin/maintenance.tsx` (a "Buddy" switch label), `src/components/admin/accounts.tsx` (a "Grant coins or XP" action per account: two number fields, confirm), `src/components/admin/admin.test.tsx`

- [ ] Tests: the switch saves `buddy`; a grant posts the right body and shows the result. **Commit** `Buddy 1: admin`.

### Task 12: Docs, checks, ship

- [ ] **Spec and design:** the seven changes are already written in (#35). Update them only if building Stage 1 changes a detail.
- [ ] **`docs/DATA-MODEL.md`:** the two tables and the `admin_log` change. **`docs/PROJECT-OVERVIEW.md`:** one line on the Buddy page.
- [ ] `npm run check` passes.
- [ ] By hand on `npm run dev`:
  - turn Gameplay on, run a 2-minute timer and see "+2 XP";
  - finish 6 tasks and see coins stop at 25;
  - claim Egg, then pick the Law buddy and see it on the page and the badge;
  - set `buddy` in maintenance as an admin and check that a second account loses the page;
  - grant 100 coins to it.
- [ ] With George's yes: push the branch, open the PR, then before the merge `npm run db:remote` (it lists `0010_buddy.sql`; answer Y) and `npm run db:check -- --remote`.
- [ ] After the merge, try it on the live site; tick spec §10 Stage 1.
