# Study Buddy — Spec

2026-10-14 · George · Revised 2026-11-02 (OpenRouter removed; Use your own AI, Sign in with ChatGPT, connector; checked against main at `3aaeaae`; the plant became a study buddy; the seven decisions in #35 written in) · Companion design: [2026-10-14-study-buddy-design.md](2026-10-14-study-buddy-design.md)

## 1. Scope and conventions

This spec defines what to build for Study Buddy in eight stages (the eighth optional). The why, the economy reasoning and the alternatives are in the design doc.

- **Numbers** live in one file, `src/core/buddy-rules.ts`, imported by the Worker (as `worker/db.js` imports `src/core/shared.ts`) and by the app. Changing a value changes one place.
- **Ids and times** follow the tracker: text ids ≤ 24 chars, times in ms since epoch, days as the viewer's local `YYYY-MM-DD` sent by the browser and checked by the Worker (±1 day, like the leaderboard's week start).
- **Personal rows** follow `marks`: `user_id` + text `id`, `revision`, `deleted_at` tombstones, changes written to the user's `u:` feed.
- **Errors** follow `worker/http.js`: `HttpError(status, {error, ...})`; new codes are listed under API.
- **Gameplay off** means the Buddy API answers `{enabled: false}` and nothing is awarded. XP, coins and health count only activity after `buddy_settings.since`, set the first time gameplay is turned on (no back-pay). Coins are written only while gameplay is on, and nothing finished while it was off pays later. XP from timed study and health are worked out from all activity since `since`, so turning gameplay off and on again never takes XP away.
- **Names in the app:** the tab is "Buddy" and the Settings toggle is "Gameplay"; study tools keep plain names (Cards, Quiz, Notes & plan). "Study Buddy" is only the project name. The two ways to generate are "Generate here" (Workers AI) and "Use your own AI" (copy and paste).
- **Shared AI code:** prompts and answer rules live in `src/core/study-prompts.ts` and `src/core/study-answers.ts`, imported by the browser and by `worker/study-ai.js` (as the Worker imports `src/core/grades.ts`), so a pasted answer and a model answer meet the same limits.
- **Maintenance:** `buddy` and `studyai` are added to `FEATURES` and the route map in `worker/maintenance.js`, and to `src/core/maintenance.ts`.
- **Migrations:** each one bumps `LATEST_MIGRATION` (`worker/admin.js`, `scripts/lib/move-db.js`) and adds its row to the list in `docs/DEPLOYING.md`.
- **Tiers and ranks:** the code and the API say *tier* (ids `egg`, `hatchling`, `r3`, `r4`, `r5`, `r6`, `legend`); the app says *rank* and shows each buddy's own rank names (design doc, The buddies).
- **Out of scope:** showing anyone's buddy or coins to others, web research, API key paste for any provider, OpenRouter, a buddy that dies, storing uploaded pictures.

## 2. Data model

Seven migrations (`0010`–`0016`: Stages 1–3, 5–8; Stage 4 has none) add a `buddy_settings` table, nine more tables, a rebuilt `activity` table and, with the optional connector, three OAuth tables. `0001`–`0009` are already taken. Study content (decks, cards, quizzes, docs) carries a `scope` like `items` does: `u:<user>` when personal, `c:<space>` when shared with a class. Each person's review progress is always personal, so one shared deck serves the whole class.

**`buddy_settings`** (one row per person who has turned gameplay on; not on `users`, so the toggle stays out of the profile's revision and out of `scripts/lib/move-db.js`'s users list)

| Column | Stage | Type | Rule |
| --- | --- | --- | --- |
| `enabled` | 1 | INTEGER 0/1 | Default 0 |
| `since` | 1 | INTEGER ms, NULL | Set once, the first time `enabled` becomes 1 |
| `on_at` | 1 | INTEGER ms, NULL | The latest time it became 1; events before it never pay |
| `reconciled_at` | 1 | INTEGER ms | The last time the Worker looked for new awards; a finish is dated no earlier than this |
| `tz` | 1 | TEXT | The browser's IANA zone, checked with `validTz` (`worker/push.js`); days are counted in it. Default `UTC` |
| `look` | 1 | TEXT JSON | `{buddy, bg, frame, name}`: `buddy` is `auto` (follows the profile's theme), a theme id or `custom` (only once one is saved); `bg` and `frame` `none` or an owned shop item (`frame` from Stage 2); `name` ≤ 16 chars or empty for the buddy's own. Default `{"buddy":"auto","bg":"none","name":""}`; a missing `frame` reads as `none` |
| `xp_bonus` | 1 | INTEGER ≥ 0 | Default 0; admin-granted XP for testing, added to derived XP |
| `custom` | 2 | TEXT JSON, NULL | The custom buddy: `{palette: [hex] 1–16, rows: [string] n of n chars, n 4–24}`, each char a palette index `0`–`f` or `.` for empty; at most 1 KB. Never the uploaded file |
| `cards_in_feed` | 3 | INTEGER 0/1 | Default 0; adds daily "Flashcards: N due" events to the calendar feed |

Migration `0010` also rebuilds `admin_log` so its `action` CHECK allows `grant`.

**Tables**

| Table | Stage | Key | Columns | Synced |
| --- | --- | --- | --- | --- |
| `buddy_ledger` | 1 | `(user_id, source)` unique | `amount` INTEGER (±, ≠ 0), `kind` ('earn','spend'), `source` TEXT ≤ 64 (see §4), `at` INTEGER | No; read through `/api/buddy` |
| `buddy_owned` | 2 | `(user_id, sku)` | `level` INTEGER ≥ 1 (upgrades) or 1 (cosmetics), `at` | No |
| `decks` | 3 | `(scope, id)` | `author_id`, `course_id`, `title` ≤ 80, `revision`, timestamps, `deleted_at` | Yes, kind `decks`, in the deck's scope feed |
| `cards` | 3 | `(scope, id)` | `deck_id`, `author_id`, `front` ≤ 500, `back` ≤ 1,000, `source` ('hand','ai','paste','connector'), `revision`, timestamps | Yes, kind `cards`, in the deck's scope feed |
| `card_state` | 3 | `(user_id, id)`, id = the card id (random 24-char ids, unique across scopes) | `due` TEXT day, `interval` INTEGER days, `ease` REAL 1.3–3.0, `reps`, `lapses`, `revision`, timestamps | Yes, kind `card_state`, user's `u:` feed only |
| `card_reviews` | 3 | `(user_id, id)` | `card_ref` (the card id), `day` TEXT, `grade` ('again','good','easy'), `at` | Yes, kind `card_reviews`, `u:` feed; append-only |
| `quizzes` | 5 | `(scope, id)` | `author_id`, `deck_id` NULL, `course_id`, `item_id` NULL (the exam it prepares for), `questions` JSON ≤ 20 `[{q, choices[4], answer 0–3, topic}]`, `source`, timestamps | Yes, kind `quizzes`, scope feed |
| `quiz_attempts` | 5 | `(user_id, id)` | `quiz_ref`, `answers` JSON, `score`, `weak_topics` JSON, `at` | Yes, `u:` feed |
| `study_docs` | 6 | `(scope, id)` | `author_id`, `course_id`, `kind` ('notes','plan','material'), `title` ≤ 120, `body` JSON ≤ 60 KB, `source`, timestamps | Yes, kind `study_docs`, scope feed |
| `activity` (rebuilt) | 7 | as today | The `verb` CHECK list gains `material.shared`; rows copied across in the migration | As today |
| `mcp_clients` | 8 | `client_id` | `name` ≤ 80, `redirect_uris` JSON ≤ 5, `created_at` (dynamic client registration) | No |
| `mcp_codes` | 8 | `code_hash` | `client_id`, `user_id`, `challenge` (S256), `redirect_uri`, `expires_at` (10 min) | No |
| `mcp_tokens` | 8 | `token_hash` | `client_id`, `user_id`, `kind` ('access','refresh'), `expires_at` (1 h / 30 days), `revoked_at` | No; only hashes are stored |

A study plan is always `u:` (it is built from one person's weak topics). `material` is plain text a member pastes or uploads (extracted in the browser), stored as text, never as the file. Every study row records how it was made in `source`: `'hand'`, `'ai'` (Workers AI), `'paste'` or `'connector'`; cards, quizzes and docs all carry it.

**Feed.** The client rejects a whole v3 sync page if any change has a kind it does not know, or a `c:` change that is not `courses` or `items` (`src/core/api.ts:187`). The Worker's `syncPageV3` (`worker/db.js:635`) filters no kinds today, so Stage 3 first gives `v=3` an explicit filter to its seven kinds, then serves the new kinds only on `GET /api/sync?v=4`, whose client accepts shared `decks`, `cards`, `quizzes` and `study_docs`. `v=2` keeps its five kinds (`db.js:318`) for any old tab, though its client was removed on 10/27. The Worker change ships before the client that asks for v4. Shared rows ride the class's `c:` feed, so the existing member guard decides who pulls them. Account deletion (`worker/accounts.js`, one statement list) deletes every new table's rows.

## 3. API

Two new route groups (three with the Stage 8 connector) plus additions to rows, sync and spaces. Every Buddy route checks the `buddy` switch; every study-AI and connector route checks `studyai`; sharing also checks `classes`. Use your own AI adds no route: the browser builds the prompt and checks the answer, and saving uses the row routes.

| Stage | Method + path | Body | Answer |
| --- | --- | --- | --- |
| 1 | `PUT /api/buddy/settings` | `{enabled: bool, tz: string, cardsInFeed?: bool}` (`cardsInFeed` from Stage 3) | Buddy state; the first `enabled: true` sets `since`, each one sets `on_at` and `reconciled_at`; a bad `tz` keeps the stored one |
| 1 | `GET /api/buddy?day=YYYY-MM-DD` | — | `{enabled, xp, tier, next: {tier, xp}, health, mood, streak, coins, look, tiers: [{id, minXp, reward, reached, claimed}], recent: [{source, amount, at}] ×10, due}` |
| 1 | `POST /api/buddy/claim` | `{tier}` | Buddy state; claiming twice pays once |
| 1 | `PUT /api/buddy/look` | `{buddy?, bg?, frame?, name?}` | Buddy state; `custom` needs a saved custom buddy, `bg` and `frame` must be owned (`not_owned`) |
| 1 | `POST /api/admin/buddy/grant` | `{userId, coins?: 1–5000, xp?: 0–10000}` | Admin only; writes `admin:<at>` coins and/or sets `buddy_settings.xp_bonus`; logged in `admin_log` |
| 2 | `GET /api/buddy/shop` | — | `{coins, items: [{sku, kind, level, max, cost, effect}]}` |
| 2 | `PUT /api/buddy/custom` | `{palette, rows}` (made in the browser, §9) | Buddy state; checked against the `buddy_settings.custom` rules, else 400 `invalid` |
| 2 | `DELETE /api/buddy/custom` | — | Buddy state; a look of `custom` goes back to `auto` |
| 2 | `POST /api/buddy/buy` | `{sku, level}` (the level being bought, guards double taps) | `{coins, item}` |
| 3 | `PUT`/`DELETE /api/(decks\|cards\|card_state\|card_reviews)/<id>` | A row, as the existing `ROW` routes take | The stored row; coins and heal follow on the next Buddy read (§4) |
| 3 | `PUT`/`DELETE /api/spaces/<id>/(decks\|cards)/<id>` | A shared row, as the existing `SHARED_ROW` routes take | The stored row; permissions in §9 |
| 3 | `GET /api/sync?v=4` | — | As v3, plus the new kinds |
| 4 | `GET /api/study-ai/status?day=` | — | `{providers: ['workers'], left, extraLeft, globalOpen}`; `providers` gains `'chatgpt'` only if step 2 ships (§7.2) |
| 4 | `POST /api/study-ai/cards` | `{courseId, itemId?, sources: {items: bool, text?: string ≤ 60k chars, topic?: string ≤ 120}, count 1–30, level, provider?: 'workers'}` | `{cards: [{front, back}], provider, left}`; a preview, not saved |
| 4 | `GET /api/admin/study-ai` | — | Admin only: `{today: {neurons, ceiling, generations, byProvider}, last14: [...], caps}` |
| 4 | `PUT /api/admin/study-ai/caps` | `{perUser 0–20, extraMax 0–5, ceiling 0–9000}` | Admin only; stored in `app_meta` `studyai_caps` |
| 5 | `POST /api/study-ai/quiz` | `{courseId, itemId?, deckId?, sources, count 1–20, level}` | `{questions: [...]}`; a preview |
| 5 | `PUT`/`DELETE` rows `quizzes`, `quiz_attempts` (and shared `quizzes`) | As stage 3 | As stage 3 |
| 6 | `POST /api/study-ai/notes` | `{courseId, sources}` | `{title, summary, concepts[], sections[]}` |
| 6 | `POST /api/study-ai/plan` | `{courseId, startDay, endDay?}` (default: the class's next exam date, at most 30 days out) | `{days: [{day, tasks: [{text, minutes, priority}]}], endDay, examId}`; weights the last attempt's weak topics |
| 7 | `POST /api/spaces/<id>/share` | `{kind: 'deck'\|'quiz'\|'doc', id}` | The new `c:` row; a copy of the personal one |
| 8 | `GET /.well-known/oauth-protected-resource`, `GET /.well-known/oauth-authorization-server` | — | Metadata for the connector (§7.3) |
| 8 | `POST /oauth/register` | `{client_name, redirect_uris}` | `{client_id}`; dynamic client registration |
| 8 | `GET /oauth/authorize` | `client_id, redirect_uri, code_challenge, state` | Signed-in consent page; 302 back with `code` |
| 8 | `POST /oauth/token` | `authorization_code` + `code_verifier`, or `refresh_token` | `{access_token, refresh_token, expires_in}` |
| 8 | `POST /mcp` | MCP (streamable HTTP), `Authorization: Bearer` | The tools in §7.3 |
| 8 | `GET`/`DELETE /api/connectors` | — | The user's connected chats, and disconnect (revokes their tokens) |

**New error codes**

| Code | Status | When |
| --- | --- | --- |
| `gameplay_off` | 409 | A Buddy write while gameplay is off |
| `not_enough_coins` | 409 | Buy with too few coins (checked in the same statement as the spend) |
| `stale_level` | 409 | `level` in a buy is not the next one |
| `tier_not_reached` | 409 | Claim above current XP |
| `not_owned` | 409 | A look that names a background not bought, or `custom` with none saved |
| `study_ai_cap` | 429 | The user's daily uses are spent; `{retryAfter, extra: bool}` |
| `study_ai_busy` | 429 | The global Workers AI ceiling for study is reached today |
| `material_too_large` | 413 | Text over 60k chars or a doc over 60 KB |
| `invalid_token` | 401 | Connector call with a missing, expired or revoked token (with `WWW-Authenticate` naming the resource metadata) |

`study_ai_cap` and `study_ai_busy` answers also carry `paste: true`, so the browser offers Use your own AI right away. A pasted answer that yields nothing is a message in the Generate sheet, not an HTTP error.

## 4. Earning rules

XP and health are worked out on every `GET /api/buddy` from synced rows. Coins are ledger rows, and the same read writes them: `reconcile()` finds the events that have no ledger row yet and inserts them (`ON CONFLICT DO NOTHING`, keyed by source), so it is safe to run twice at once. No row-write route changes; sessions, items and marks reach D1 through `putRow`, `upsertMark`, `memberTaskWrite`, the importers and sync, and all of them are covered. The app reads the Buddy after each sync that carried a session, item or mark while gameplay is on. Values are the starting set from the design doc.

**XP**

```
XP = Σ over days ≥ since of min(240, timed minutes that day)
   + 10 × paid first finishes still finished
   + xp_bonus
```

- Timed minutes: `study_sessions` with `manual = 0`, not deleted, `started_at ≥ since`, and saved within 48 hours of starting (`created_at − started_at ≤ 48 h`; the Worker sets `created_at`), grouped by local day in `tz`. `manual` is set by the browser, so the 240-minute day is the real limit.
- First finish: a personal `items` row (`u:` scope, not recurring), or a `marks` row on a class (`c:`) item, in a finished status: `done`, `submitted` or `graded`. It counts once it has a paid `item:` ledger row; turning it back to `todo` removes the 10 XP until it is finished again. Project (`p:`) tasks earn nothing for now.
- A finish is dated by the Worker: its `completed_at`, clamped between `reconciled_at` and now, so it can't be backdated past the Worker's last look. A row whose `completed_at` is before `on_at` (finished while gameplay was off) never pays.
- **Daily limits:** personal finishes of every type, exams included, share a limit of 5 a day. Lecture review tasks (`reviewId` ids `rv…` titled "Review n/4 · …", `src/core/reviews.ts`) have their own limit of 4 a day. Class finishes have no limit. A finish over a limit writes a 0-coin row, so it never pays later.
- Tier = the highest tier with `minXp ≤ XP`. Claiming pays its reward once (`claim:<tier>`).

**Coins (ledger)**

| Event | Ledger source | Amount | Written when |
| --- | --- | --- | --- |
| Timed session lands | `session:<id>` | floor(counted minutes / 5) × (1 + 0.2 × Focus Engine level); counted = minutes left under the 240/day cap | First read after the session lands; a room session written again with a larger total raises the amount, nothing lowers it |
| Item finished | `item:<scope>:<id>` | 5 + 2 × Finisher level; a class `exam` or `project` pays 15 + 2 × Finisher level | First read after it is finished; never again for that item; 0 over the daily limit |
| Cards reviewed | `cards:<day>` | min(10 + Card Foundry, floor(reviews that day / 10)) | Upserted on each review write |
| Correct quiz answers | `quiz:<day>` | min(20 + 5 × Quiz Magnet, correct that day) | Upserted on each attempt write |
| Grade ≥ 80 (class items) | `grade80:c:<space>:<id>` | +10 | First read after the mark's grade reaches 80 |
| Grade ≥ 90 (class items) | `grade90:c:<space>:<id>` | +15 (25 in all with the 80 bonus) | First read after it reaches 90 |
| Streak day | `streak:<day>` | min(20, 2 × streak length) | The first read after the day counts |
| Classmate uses a shared deck or quiz | `use:<shared id>:<classmate id>` (on the author's ledger) | +1, at most 20 a day | Classmate's first card review in that deck, or first attempt on that quiz |
| Tier claimed | `claim:<tier>` | Tier reward | Claim call |
| Purchase | `buy:<sku>:<level>` (`buy:ai:<day>:<n>` for extra AI uses) | −cost | Buy call, only if balance ≥ cost in the same statement |
| Admin grant | `admin:<at>` | 1–5000 | Admin call |

- **Grade bonus:** only a class item's grade (a mark's grade) pays, once per threshold; a personal item's grade pays nothing, since anyone can make those. Lowering a grade takes nothing back.
- **Streak:** the Buddy's own rule, apart from the study streak (whose daily minimum each person sets): a day counts when it has 15+ timed minutes, or from Stage 3 10+ card reviews. A day that does not count resets the streak to 0; it never touches health. `GET /api/buddy` returns `streak`.
- **Author reward:** nothing for the author's own use, for shared notes (opening them writes nothing), or while the author's gameplay is off.
- **Balance** = sum of `amount`. Deleting a session does not take its coins back; this keeps the balance from going negative after a purchase.

**Health**

Start at 100 on the first day of the window (the later of `since` and 14 days ago), apply each day's events in time order, and clamp to 0–100 after each one.

| Event (from rows) | Change |
| --- | --- |
| A lab marked `missed` (Missed) or an office hour marked `missed` (Skipped), on its date | −10 |
| An assignment still `todo` the day after its due date | −10, once |
| Wrong answer in a `quiz_attempts` row | −3 |
| 4th and later day in a row with no timed minutes | −5 |
| Each 10 timed minutes | +1 |
| A card reviewed, once per card per day | +2 |
| Correct answer | +5 |

Not counted: tutoring `missed` (it means Cancelled) and project `missed` (Dropped). Exams and quizzes have no missed status.

Moods: 70–100 `happy`, 40–69 `tired`, 15–39 `sick`, 0–14 `hurt` (shown as Bandaged). The mood only changes the buddy's face and extras (design doc, The buddies); nothing dies.

Shared decks and quizzes earn and heal the same as personal ones; the person reviewing gets the reward (the author gets only the author reward).

## 5. Spaced repetition

Scheduling is a simplified SM-2 with three grades, run in the browser (`src/core/srs.ts`) so review works offline. The result syncs as a `card_state` row plus a `card_reviews` row.

A card with no `card_state` row is new: ease 2.5, reps 0, interval 0.

| Grade | reps | interval (days) | ease | lapses |
| --- | --- | --- | --- | --- |
| Again | 0 | 1 | max(1.3, ease − 0.2) | +1 |
| Good | +1 | 1 if reps was 0; 3 if reps was 1; else round(interval × ease) | unchanged | — |
| Easy | +1 | 4 if reps was 0; else round(interval × ease × 1.3) | min(3.0, ease + 0.15) | — |

- `due` = review day + interval, capped at 180 days.
- A card graded Again goes back to the end of today's queue once.
- **Queue:** due cards first (oldest due first), then up to 20 new cards a day per class, in deck order.
- **Due count** on Study and on each class = cards with `due ≤ today`, plus new cards up to the daily 20.
- Two devices reviewing the same card offline: the later `updated_at` wins `card_state`; both `card_reviews` rows stay (they are append-only and keyed by their own id).
- Editing a card's text keeps its schedule. Deleting a card deletes its `card_state`.
- **Reminders.** Week view shows "N cards due" on today. The header badge's buddy shows its tired face while cards are due and none were reviewed today (look only; health is unchanged). With `cards_in_feed` on, the calendar feed (`worker/calendar.js`) adds an all-day "Flashcards: N due" event for each of the next 7 days, N from `card_state.due` (worded apart from the lecture review tasks, "Review 1/4 …", from `src/core/reviews.ts`).

## 6. AI gateway

One module, `worker/study-ai.js`, serves all four Workers AI routes: it picks the provider, enforces caps, builds the prompt from `src/core/study-prompts.ts`, calls the model with `askJson` from `worker/ai.js` (which asks, cleans and retries once), and checks the answer with `src/core/study-answers.ts`. A failed call gives the use back, as `giveBackOutline` (`worker/limits.js`) does for outline reads.

**Provider slot**

A provider is `{id, available(env, userId), run(route, prompt, schema) → {answer, usage}}`. Stage 4 registers one, `workers` (`@cf/openai/gpt-oss-120b`, the model outline reads use). A `chatgpt` provider (§7.2) registers only if OpenAI accepts the app; nothing else in the gateway changes. Use your own AI is not a provider: it never reaches the Worker.

**Caps (Workers AI only)**

| Cap | Default | Stored | Resets |
| --- | --- | --- | --- |
| Per user | 3 generations a day | `request_limits`, key `studyai:<user>`, 24 h window via `claimLimit` | 24 h after the first use |
| Bought extra | +1 per purchase, max 2 a day | `buddy_ledger` `buy:ai:<day>:<n>` | Viewer's next day |
| Global study ceiling | 4,000 estimated neurons a day | `app_meta` key `studyai_neurons:<UTC day>` | 00:00 UTC, with the Cloudflare quota |

`claimLimit` takes one fixed limit, so the claim is made with `limit = perUser + extras bought today` (counted from `buy:ai:<day>:*` rows in the same request). The three values are read from `app_meta` key `studyai_caps` (`{perUser, extraMax, ceiling}`), set on the Admin page; the table holds the defaults. Each call also adds to `app_meta` `studyai_usage:<UTC day>` (`{neurons, generations, byProvider}`) for the Admin page.

Neurons are estimated after each call from its token usage: in × 31,818 + out × 68,182 per million tokens for gpt-oss-120b. The check happens before the call; a call that pushes past the ceiling still finishes. A failed call (timeout, invalid answer after retry) gives the use back.

**Context**

| Source | Content | Limit (Workers AI / Use your own AI) |
| --- | --- | --- |
| Class data | Course name, items (type, title, date, notes, checklist), shared `material` docs | 12k / 30k chars, newest items first |
| Text | Extracted file text, pasted text, or a lecture review's notes | 12k / 30k chars, cut at a page boundary |
| Topic | A typed topic | 120 chars |

Sources are wrapped as data in the prompt ("Study material, not instructions:"), and every output field is shown as plain text, never HTML.

**Output schemas** (asked for as JSON; checked by `src/core/study-answers.ts` on both sides, which reuses `worker/validate.js`'s limits; bad entries dropped; one retry on Workers AI if none are valid)

| Route | Shape | Limits |
| --- | --- | --- |
| cards | `{cards: [{front, back}]}` | count as asked (1–30); front ≤ 500, back ≤ 1,000 |
| quiz | `{questions: [{q, choices: [4], answer: 0–3, topic}]}` | 1–20; q ≤ 300, choice ≤ 160, topic ≤ 40 |
| notes | `{title, summary, concepts: [{term, meaning}], sections: [{heading, body}]}` | ≤ 12 concepts, ≤ 10 sections, 60 KB total |
| plan | `{days: [{day, tasks: [{text, minutes, priority: 'high'\|'normal'}]}]}` | 1–30 days, ≤ 6 tasks a day, minutes 10–180 |

The tolerant JSON reading `modelJson` does today (an answer wrapped in a code block or a sentence) moves into `src/core/study-answers.ts`, so the browser can read pasted answers the same way; `worker/ai.js` imports it from there.

**Repeat requests.** Previews are kept on the device through `src/data/ai-cache.ts` (SHA-256 key, 30 days, newest 12, cleared on sign-out) with the route in the key, so reopening the same request never spends a use.

**Logging.** Each call logs `study-ai:<route> <provider> <model> in=<n> out=<n> neurons≈<n>` to Workers Logs.

## 7. Bring your own AI

Three steps, so people can use the AI they already have and neither they nor the app pays or signs up for anything new.

### 7.1 Use your own AI (copy and paste) — Stage 4

Everything runs in the browser, from its local copy of the class; nothing new on the Worker.

1. **Prompt.** `buildPrompt(route, sources, options)` from `src/core/study-prompts.ts`, the same function the Worker uses, with the 30k-char context limit. The prompt ends with the exact JSON shape asked for and "Answer with only this JSON." It never includes anyone else's data: class data is what the user can already see.
2. **Copy.** A **Copy prompt** button (`navigator.clipboard.writeText`; on failure, the prompt is shown selected in a read-only box), and links that open `chatgpt.com`, `claude.ai` and `gemini.google.com` in a new tab. The app remembers the last one picked (per device).
3. **Paste.** A box for the answer, up to 200k chars. `readAnswer(route, text)` finds the JSON (bare, in a code block, or with text around it), checks it against the schema in §6, drops bad entries, and reports "18 of 20 cards could be read". Nothing readable: "That answer had no cards in it. Copy the prompt again and ask for only the JSON."
4. **Preview and save.** The same preview as Generate here. Saved rows carry `source: 'paste'` and are written through the normal row routes, which validate them again.

Use your own AI works while `studyai` is in maintenance and when the free quota is spent; it never counts toward either cap and writes nothing to the usage log. Plan generation (§3, Stage 6) works the same way: the prompt includes the last attempt's weak topics and the class's next exam date from the local store.

### 7.2 Sign in with ChatGPT — if accepted

OpenAI announced Sign in with ChatGPT at DevDay 2026: an OAuth sign-in that can let an app spend the user's ChatGPT plan allowance, with a per-app weekly cap the user sets. It is a limited preview; hosted apps must request access.

- **Now:** apply from the OpenAI developer dashboard. Nothing is built except the provider slot in §6.
- **If accepted:** write a short addendum to this spec from OpenAI's published terms (endpoints, scopes, token lifetime, what the app may show). Expected shape: a `chatgpt` provider; its tokens stored encrypted with the AES-GCM keyring in `worker/spotify/tokens.js` (own HKDF info, `chatgpt-token`), never sent to the browser or logged; Settings › AI for study gets Connect / Disconnect; Generate here uses ChatGPT when connected, with no app cap but 20 calls an hour per user to protect the Worker; a spent weekly cap falls back to Workers AI, then to Use your own AI.
- **If not accepted:** nothing to undo.

### 7.3 Connector (MCP) — Stage 8, optional

A Model Context Protocol server on the Worker, so a user can add Rounds as a connector in ChatGPT (Apps SDK, private testing first) or Claude (custom connector) and say "make 20 cards for my Pharm exam". Their chat does the AI work on their plan.

**Sign-in.** OAuth 2.1 with PKCE (S256 only), as the MCP authorization spec asks: protected-resource and authorization-server metadata, dynamic client registration, a consent page that requires the normal session cookie ("Allow ChatGPT to read your classes and save study material?"), codes for 10 minutes, access tokens for 1 hour, refresh tokens for 30 days, all stored as SHA-256 hashes (§2). Redirect URIs must be `https`. Disconnect in Settings revokes every token for that client. Evaluate `@cloudflare/workers-oauth-provider` at the start of Stage 8; it needs a KV binding, so D1 tables as in §2 are the default.

**Tools**

| Tool | Input | Output | Notes |
| --- | --- | --- | --- |
| `list_classes` | — | `[{courseId, name, nextExam?: {itemId, title, date}, due}]` | The user's personal and shared classes |
| `get_class_material` | `{courseId, itemId?, maxChars ≤ 30000}` | Text: items, notes, checklists, shared `material` docs, newest first | Wrapped as data, as in §6 |
| `save_deck` | `{courseId, title, cards: [{front, back}] ≤ 30}` | `{deckId, saved, dropped}` | Checked by `study-answers.ts`; `source: 'connector'` |
| `save_quiz` | `{courseId, itemId?, questions ≤ 20}` | `{quizId, saved, dropped}` | Stage 5 rules |
| `save_notes` | `{courseId, title, summary, concepts, sections}` | `{docId}` | Stage 6 rules |

- All tools are personal (`u:`); sharing to a class stays in the app.
- `studyai` maintenance stops `/mcp`; `classes` maintenance hides shared classes from `list_classes`.
- 60 tool calls an hour per user (`claimLimit`, key `mcp:<user>`); saves count as row writes for the API limit.
- Saved rows reach the user's devices through the normal `u:` feed. Saving earns nothing; reviewing the cards earns as usual.
- Logs record the tool name and sizes, never the material or the token.

## 8. File ingestion

Files are read in the browser and only their text goes to the Worker. No new library is added.

| Type | Check | Reader | Text shape |
| --- | --- | --- | --- |
| PDF | Starts with `%PDF-` | `src/core/pdftext.ts` (vendored pdf.js, already used by Import with AI) | `### Page N` blocks |
| PPTX | Starts with `PK\x03\x04` and holds `ppt/presentation.xml` | New `src/core/pptxtext.ts`: reads the zip directory, inflates `ppt/slides/slideN.xml` and notes with `DecompressionStream('deflate-raw')`, keeps `<a:t>` text | `### Slide N` blocks, speaker notes after each |
| TXT, MD | Extension + valid UTF-8 | `File.text()` | As is |

- **Limits:** 20 MB per file, 5 files per generate, then text cut to the limit (12k chars for Generate here, 30k for Use your own AI) at a page or slide boundary.
- **No text layer** (a scanned PDF): "This PDF has no text to read." No OCR, which would spend neurons.
- **Rejected:** `.ppt`, `.doc`, `.docx`, images. The drop zone names what it accepts.
- **Sharing a file with a class** saves its extracted text as a `material` doc (≤ 60 KB), never the file itself. There is no file storage on the free tier.

## 9. UI

Each surface follows the tracker's Term components and theme tokens. The buddies are drawn in code by `src/core/buddy-art.ts`: `sprite(buddy, tier, mood, frame, custom?)` returns a 32 × 32 grid of colours, and `src/components/buddy/buddy-sprite.tsx` paints it on a canvas at a whole-number scale. The idle animation swaps two frames every 550 ms, and stops under `prefers-reduced-motion` and in hidden tabs. The prototype, `design/study-buddies-prototype.html`, is the reference for every theme, rank and mood.

| Surface | States | Notes |
| --- | --- | --- |
| Settings › Gameplay | Off (default); On; "Review cards in my calendar" | Turning on shows a one-time card explaining earning; turning off hides the Buddy page and badge, keeps data |
| Settings › AI for study | Free quota ("2 of 3 left today"); Off for maintenance; a line that Use your own AI works with any chat, always | Gains Connect ChatGPT only if §7.2 ships, and Connected chats (Disconnect) with Stage 8 |
| Header badge | Buddy at 32 px + coins; pulses once on a new rank to claim; tired face while cards are due | Hidden when gameplay is off or `buddy` is in maintenance |
| Buddy › The buddy | The chosen buddy at its rank and mood; its name and rank title; XP bar; health bar; streak; "+N XP" since last visit | Mood never blocks anything |
| Buddy › Ranks | Locked / Reached (Claim) / Claimed | Seven rows with the buddy's rank names and what each adds (hat, item, outfit, legend) |
| Buddy › Pick a buddy | Auto (your theme); the six theme buddies; Custom; rename | Stage 1 has the six and Auto; Custom and naming come in Stage 2 |
| Buddy › Custom buddy (Stage 2) | Empty (upload, drop or paste); picture and pixel version side by side; Detail 12–24 px, Colours 3–16, Remove the background; errors (not a picture, over 10 MB, nothing left after removing the background) | Made in the browser by `src/core/pixelate.ts`: shrink in halving steps, flood the commonest edge colour away, k-means to the chosen colours, crop and stand on the bottom row. Saving sends only the grid and palette |
| Buddy › Shop | Upgrades (level, next cost, effect); Backgrounds and frames; Extra AI use | Buy disabled with the reason when coins are short or max level |
| Study › Cards | Class list with due counts; deck list (Mine, Shared with class); review screen; editor | Review: front, tap to flip, Again / Good / Easy, progress "12 of 30"; keyboard 1/2/3 and space |
| Generate sheet | Sources → options → Generate here or Use your own AI → (generating \| copy prompt → paste answer) → preview → saved | Generate here shows uses left; when spent or in maintenance it is disabled with the reason and Use your own AI is offered. Paste states: empty, reading, "18 of 20 could be read", nothing readable. Preview lets the user delete or edit items; Save into a new or existing deck |
| Study › Quiz | Setup (optional exam link), question (one at a time), result with weak topics, history | Result offers "Make cards for weak topics" and, when linked to an exam, "Add N weak topics to exam prep" (that exam's checklist, max 50 entries, no duplicates) |
| Study › Notes & plan | Notes reader (summary, concepts, sections); plan as a day list with tick boxes | The plan ends at the class's next exam by default (at most 30 days; the date can be changed); its tasks can be sent to the week |
| Class sheet › Materials | Shared decks, quizzes, notes and materials with author and date; Add material; Share from mine; Generate | Materials shown only for shared classes when `classes` is not in maintenance; Generate on every class |
| Exam item card | Make cards / Make quiz for this exam; linked quizzes with best score | Opens the Generate sheet with the class and exam filled in |
| Lecture review done | Toast: "Make cards from today's notes" | Only when the review task has notes; uses those notes as the text source |
| Week view | "N cards due" chip on today | Tap opens the review screen |
| Admin › Study Buddy | Neurons today vs ceiling, generations (Workers AI; connector tool calls from Stage 8), 14-day chart; caps form; grant coins/XP to a user | Admins only; replaces hacks' hidden demo unlock |

**Who can change shared materials**

| Action | Author | Class owner, editor | Member |
| --- | --- | --- | --- |
| Share a deck, quiz, notes or material | — | Yes | Yes |
| Edit a shared item | Yes | No | No |
| Remove a shared item | Yes | Yes | No |
| Review or take it | Yes | Yes | Yes |

Sharing makes a copy in the class; later edits to the personal original do not change it. Each share writes an `activity` row (Collab Stage 7), so classmates see "<name> shared <n> cards for <class>" in their inbox; removing the item removes the entry. When a member leaves, their shared items stay with the class under their name, like class items do. Plans are never shared.

## 10. Stages and acceptance criteria

Eight stages, each on its own `buddy-N-<name>` branch; Stage 8 is optional. Collab Stage 10 is on main. A stage is done when its boxes are ticked, `npm test` passes, its migration (if any) is applied with `db:remote` and `LATEST_MIGRATION` bumped, and it has been tried on the live site.

**1 · Game core** (`0010`)

- [ ] Gameplay toggle in Settings; `buddy_settings.since` set once
- [ ] `buddy` maintenance switch hides the Buddy page, badge and earning for non-admins
- [ ] Timed session writes pay `session:<id>` coins; manual logs pay none; the 240 min/day cap holds across several sessions
- [ ] Finishing an item pays once even after todo → done → todo → done; the sixth personal finish in a day (exams included) pays nothing, lecture reviews pay up to 4 apart from that, class finishes have no limit; a session saved over 48 h after it began pays nothing; a cancelled tutoring session does not hurt the buddy's health
- [ ] XP, tier and health match the formulas in worker tests (fixtures for missed items and idle days)
- [ ] Buddy tab shows the buddy for the person's theme (or the one picked), XP bar, ranks; claim pays once
- [ ] `buddy-art.ts`: every theme × tier × mood fits 32 × 32 with an outline, and matches its snapshot; the animation stops under reduced motion
- [ ] Streak: 15 timed minutes or 10 reviews makes a day count; bonus 2 × length, max 20; a day that doesn't count resets it with no health change
- [ ] Admin grant writes coins or XP plus an `admin_log` row; non-admins get 403

**2 · Shop and custom buddy** (`0011`)

- [ ] Buying with too few coins fails with no ledger row; two quick taps buy one level
- [ ] Upgrade effects change the next award amounts
- [ ] A grade of 92 on a class item pays 25 once (a personal item's grade pays nothing); editing it to 85 and back pays nothing more
- [ ] Backgrounds and frames equip and show behind the buddy
- [ ] A custom buddy made from a PNG, a JPG and a photo with a plain background saves as a grid of at most 24 × 24 and shows at every rank and mood; the uploaded file is never sent
- [ ] A bad custom buddy (wrong size, unknown palette index, over 1 KB) gets 400; deleting it puts a `custom` look back to `auto`
- [ ] A name up to 16 characters shows on the Buddy page and the badge's label

**3 · Decks and spaced repetition** (`0012`)

- [ ] Make, edit, delete decks and cards by hand, offline included
- [ ] Scheduling matches the table in `srs.test.ts`; due counts correct across midnight
- [ ] `v=3` filters to its seven kinds (new in this stage, test first); a tab on today's build never receives the new kinds and keeps syncing; only v4 does, including shared `c:` decks and cards
- [ ] Card reviews pay `cards:<day>` coins and heal the buddy when gameplay is on
- [ ] Week view chip, the badge's tired face and the calendar's "Flashcards: N due" events (with `cards_in_feed` on) show the right counts

**4 · AI gateway and Use your own AI** (no migration)

- [ ] Per-user cap (3/day), bought extras (max 2) and the 4,000-neuron global ceiling enforced; failed calls give the use back
- [ ] The gateway runs through the provider slot with one provider, `workers`; adding a fake second provider in a test needs no other change
- [ ] Prompts and answer rules come from `src/core/study-prompts.ts` and `study-answers.ts`, used by both browser and Worker (one test table for both)
- [ ] Cards from class data, PDF, PPTX, TXT, MD and a topic, both ways; preview then save
- [ ] Use your own AI: Copy prompt works (and falls back to a selectable box); a pasted answer in a code block, with text around it, or bare is read; bad entries dropped with "N of M"; saved cards have `source: 'paste'`
- [ ] Use your own AI works with the quota spent and with `studyai` in maintenance, and spends no use
- [ ] `studyai` switch stops Generate here; hand-made cards still work
- [ ] One measured 20-card Workers AI run recorded in the neuron log
- [ ] Admin page shows today's usage and 14 days; changed caps apply to the next call
- [ ] Generate from the exam item card, the class sheet and the lecture-review toast opens with class, exam and notes filled in
- [ ] Applied for Sign in with ChatGPT (§7.2); outcome noted in the design doc

**5 · Quizzes** (`0013`)

- [ ] Generate (here or with your own AI), take, score; weak topics stored per attempt
- [ ] Wrong and correct answers change health; `quiz:<day>` coins capped
- [ ] A quiz linked to an exam adds its weak topics to that exam's prep checklist when asked (no duplicates, max 50)

**6 · Notes and study plan** (`0014`)

- [ ] Notes from class data, files or topic, both ways, saved as a `study_docs` row
- [ ] Plan runs to the class's next exam by default (max 30 days, date changeable) and weights the last attempt's weak topics; tasks can be sent to the week

**7 · Shared class materials** (`0015`: rebuilds `activity` with the `material.shared` verb; content uses `scope` from 3–6)

- [ ] Share a deck, quiz or notes to a class as a copy; add pasted or uploaded material
- [ ] Permissions match the table in §9; non-members never pull `c:` rows
- [ ] Each member's review progress stays personal on a shared deck
- [ ] The author earns +1 per classmate's first use of a shared deck or quiz, max 20 a day; own use pays nothing
- [ ] Class data in AI prompts includes the class's shared material
- [ ] Hidden while `classes` is in maintenance
- [ ] Sharing writes an `activity` row, so classmates see it in their inbox; removing it removes the entry

**8 · Connector, optional** (`0016`)

- [ ] Metadata, dynamic registration, authorize (consent needs the session cookie) and token endpoints pass an MCP client's sign-in; PKCE S256 only; codes expire after 10 min; tokens are stored only as hashes
- [ ] `list_classes`, `get_class_material`, `save_deck`, `save_quiz`, `save_notes` work from ChatGPT (private app) and Claude (custom connector); saved rows sync to the user's devices with `source: 'connector'`
- [ ] Another user's classes are never listed or read; an expired or revoked token gets 401 `invalid_token`
- [ ] Disconnect in Settings revokes the client's tokens; `studyai` maintenance stops `/mcp`; 60 calls an hour per user
- [ ] No material or token in Workers Logs
