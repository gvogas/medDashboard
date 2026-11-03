# AI Practice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Multiple-choice practice questions generated from a student's material (Generate here, or Use your own AI by paste), scored in the browser, with per-topic results that weight the study plan toward weak topics and give the buddy a small, capped health reward for correct answers and a small, capped loss for wrong ones.

**Architecture:** Practice reuses the study-AI gateway in `worker/study-ai.js` and the prompt and answer rules in `src/core/study-prompts.ts` and `src/core/study-answers.ts`, so the two paths ask for the same thing and read answers the same way. Generation is a stateless preview. Scoring happens in the browser, which holds the answer key. Only per-topic results are saved. Buddy health and practice coins are both derived on read from the saved rows, the same way card health and card coins are (see Tasks 7 and 8).

**Tech Stack:** Cloudflare Workers + D1 (plain JS ES modules), React 19 + TypeScript + Vite, Vitest (`@cloudflare/vitest-plugin` + jsdom), wrangler.

**Spec:** none yet. This plan sits inside the stage plan `docs/superpowers/plans/2026-11-02-study-buddy.md` (Stages 4 to 6). Its decisions and the existing spec §6 to §8 (AI gateway, Generate here, Use your own AI) are the baseline.

**Status:** plan complete, all tasks specified, all decisions recorded. No code has changed. Build order is below.

---

## Ported from gvogas/AI-Study-Assistant (MIT)

Ideas only; no code is copied. Each line below was checked against the source file named.

| Source idea | Where it is in the source (verified) | What the tracker does |
|---|---|---|
| Quiz questions carry a `topic_tag` | `agents/learning_agent.py` (question schema) | Same field, `topic_tag` |
| A topic is weak after any miss in one run (`count >= 1`) | `routers/quiz.py`, `weak_topics = [t for t, count in ... if count >= 1]` | Within the last 3 runs (decision 3). Same rule, wider window |
| "Give weak areas 1.5x time" | `agents/planning_agent.py`, prompt rule text | A prompt wish with no measured number. The tracker uses option (a) of decision 6 |
| Correct answers heal the plant | `routers/quiz.py` calls `apply_heal(score * HEAL_PER_CORRECT)`; `services/plant.py` has `HEAL_PER_CORRECT = 5`, no cap | +1 per correct answer, capped at +2 a day (decision 4). Smaller and capped |
| Wrong answers damage the plant | `routers/quiz.py` calls `apply_wrong_answers(len(wrong_ids))`; `services/plant.py` has `WITHER_PER_WRONG = 20`, no cap | -1 per wrong answer, capped at -2 a day, floor 1 (decision 5). Much smaller |
| Plant death costs 30 coins | `routers/quiz.py` `death_penalty` | Not ported (decision 7) |

Not ported: server-side answer checking (generation is a preview, and paste scores in the browser anyway); the demo admin unlock (the source says to remove it before production); the Python stack; the silent fallbacks that return empty lists on parse failure; the 30-coin death penalty.

**Correction to the earlier draft:** it said the damage rule was "to match the source". The source only matches in direction (damage per wrong answer). Its amount is 20 per wrong answer, uncapped, which can wipe a plant in five misses. The -1/-2 numbers are the tracker's own proposal. The tracker's health scale is different: `HEALTH` in `src/core/buddy-rules.ts` gives -10 per missed lab, -5 per idle day after 4 days, +1 per 10 timed minutes, and +2 per card. George chose to keep the scaled numbers (decisions 4 and 5).

---

## Naming

- The AI feature is **practice**: code, routes, tables and UI labels use `practice`, and the UI says "Practice questions".
- `quiz` stays the existing item type (calendar items, grade categories, `quiz-target` tests). Nothing new uses `quiz` in code or in a route.
- Decided (George): the stage is named **Practice**. The UI and the stage table use "Practice"; "Quizzes" is dropped.
- Migration: `migrations/0013_practice_attempts.sql` everywhere in this plan (the earlier `0013_quizzes.sql` is dropped).

## Fit with the stage plan

| Stage (existing plan) | What practice needs from it | Status (checked) |
|---|---|---|
| 3 Decks, sync v4 | Card health rule (+2 per distinct card per day, `cardHeal` in `worker/buddy.js` `reads`/`healthOf`) that the practice health rule copies | Merged to `main` (`migrations/0012_decks.sql` present) |
| 4 AI gateway (Generate here, Use your own AI) | `worker/study-ai.js` caps, refunds, preview route; `src/core/study-prompts.ts`; `src/core/study-answers.ts`; `src/data/study-ai.ts` | Merged to `main` (commit `17fa705`, "Buddy 4: study-AI gateway"). Checked with `git merge-base --is-ancestor` |
| 5 Practice (was "Quizzes") | Migration `0013_practice_attempts.sql` and the UI slot | Not started. Next free migration is `0013` |
| 6 Notes and study plan | `src/core/study-plan.ts` weighting (Task 6) | Not started |

Practice is **Stage 5**, using migration `0013`, so migration numbers don't collide.

## Build order

1. Task 1 (prompt) and Task 2 (answer rules): no dependencies, can run in parallel.
2. Task 3 (Worker route) needs Tasks 1 and 2.
3. Task 4 (UI and browser scoring) needs Tasks 2 and 3.
4. Task 5 (results storage) needs Task 4, since the browser produces the results.
5. Task 6 (weak topics) and Task 7 (buddy health) read the stored results, so they need Task 5.
6. Task 8 (Quiz Magnet) needs Task 5 (stored results) and Task 7 (the `practice_attempts` read and the reconcile hook).

Earlier text said "everything else can start after Task 2". That was wrong: Task 4 needs Task 3, and Tasks 6 and 7 need Task 5.

---

## How to work in this repo (read before any task)

Carried over from the stage plan. Follow it.

1. **Checks:** `npm run typecheck`, `npm test`, `npm run build`. `npm run check` runs all three. One file: `npx vitest run test/study-plan.test.js`.
2. **Line endings:** every file LF.
3. **Non-ASCII** (·, —, …): write with the edit or write tools, not through a shell. Run `npm run build` after, since Vite rejects Latin-1 bytes the tests can miss.
4. **Deploying:** the Cloudflare Git build does not apply remote D1 migrations. A stage with a migration needs `npm run db:remote` and `npm run db:check -- --remote` before its merge to `main`.
5. **Commits:** work only on the stage branch. Do not add `Co-Authored-By` or other trailers to commit messages. Never push, merge to `main`, or touch remote D1 without George's yes.
6. **Tests first:** every behavior change starts with a test that fails for the right reason.

---

## Task 1: Practice prompt

**Files:** `src/core/study-prompts.ts`; test beside `src/core/study-ai.test.ts`.

**Verified:** `SHAPES` is a map of shapes keyed by feature (it has `cards`); `cardsPrompt(src, opt, limit)` builds the system text and the user text, with the material wrapped as data and `LEVEL_WORDS` for the level; `HERE_LIMIT` and `OWN_LIMIT` cap the material.

- [ ] Add `practice` to `SHAPES`: `{"questions": [{"question": "...", "options": ["A. ...", "B. ...", "C. ...", "D. ..."], "answer": "A", "topic_tag": "...", "explanation": "..."}]}`.
- [ ] Add `practicePrompt(src, opt, limit)` beside `cardsPrompt()`. It reuses `LEVELS`, `LEVEL_WORDS`, the `Sources` shape, and the caps. The system text asks for exactly `count` questions, each with four options, one correct letter, a short `topic_tag`, and a one-sentence explanation.
- [ ] Test: the prompt contains the count, the level words, the shape, and the material wrapped as data; it is cut to the limit.

**Done when:** the Worker path and the copy-paste text (`asOneText()`, wired in Task 4) use the same prompt text.

## Task 2: Practice answer rules

**Files:** `src/core/study-answers.ts`; tests beside `src/core/study-ai.test.ts`.

**Verified:** `checkCards(o, count)` returns `{items, total}`; `parseLoose()` pulls JSON out of prose or code fences; `Route` is currently `'cards'`, and `readAnswer(route, text, count)` dispatches on it.

- [ ] Add `PRACTICE_MAX = 30` and `checkPractice(o, count)`. It keeps a question only if: non-empty question; exactly four options, each non-empty after `plain()`; `answer` is one of A to D; non-empty explanation and `topic_tag` (cut to 60 characters). It dedupes by question text, the same as `checkCards()`.
- [ ] Return `{items, total}` like `checkCards()`, so the UI can say "N of M".
- [ ] Extend `Route` to `'cards' | 'practice'` and handle `'practice'` in `readAnswer()`.

**Done when:** a model answer with one bad question out of five gives four items and "4 of 5"; a question with three options is dropped; no answer key appears in a dropped item's text.

## Task 3: Practice generation route (Worker)

**Files:** `worker/study-ai.js`; tests in `test/study-ai.test.js` with `test/fake-ai.js`.

**Verified (read this session):**
- `cardRequest(body)` validates `sources` (`classData`, `text` up to 60,000 characters with cut, `topic` up to `TOPIC_MAX`), `count` (1 to `CARDS_MAX`), `level` (in `LEVELS`), and `provider`. Errors are `HttpError(400, {error: 'invalid', field})`, or 413 `material_too_large`.
- `generateCards(env, userId, body, now, providers)`:
  1. `cardRequest`.
  2. Pick a provider: `providers.find(p => (!req.provider || p.id === req.provider) && p.available(env))`; none gives 503 `study_ai_unavailable` with `paste: true`.
  3. `readCaps`; if today's neurons are at the ceiling, 429 `study_ai_busy` with `paste: true`.
  4. `extrasToday`; `claimLimit(env.DB, limitKey(userId), caps.perUser + extras.n, now, DAY_MS)`; if refused, 429 `study_ai_cap` with `retryAfter`, `extra`, `paste: true`.
  5. `provider.run(env, prompt, clean, 'study-ai:cards')`, where `clean` runs `checkCards(safeParse(answer), req.count)` and throws 502 `outline_unreadable` on no items.
  6. On failure: codes in `GIVEN_BACK` (`outline_quota`, `outline_unavailable`, `ai_timeout`, `outline_unreadable`) give the use back via `giveBack`. Every error gets `paste: true`.
  7. `recordUsage`, then `usesLeft`; returns `{cards, provider, left}`.
- `studyAiRoutes` is an array of `[method, route(path), handler]`, with `route = (path) => new RegExp('^/api/' + path + '$')`.

**Steps:**
- [ ] Add `practiceRequest(body)`: same as `cardRequest`, with `count` up to `PRACTICE_MAX`.
- [ ] Add `generatePractice(env, userId, body, now, providers)`: the same seven steps as `generateCards`, using `practicePrompt`, `provider.run(..., 'study-ai:practice')`, and `checkPractice` through `readAnswer('practice', ...)`. The caps, the ceiling check, the refund codes and the `paste: true` flag are shared code, not a copy.
- [ ] Register `['POST', route('study-ai/practice'), ...]` in `studyAiRoutes`, beside the cards route.
- [ ] Response is a preview `{questions, provider, left}`. Nothing is saved. The answer key is sent to the browser, as in the cards flow.

**Done when:** a fake provider's valid answer returns items; a failed call returns the use; an over-cap user gets the same 429 `study_ai_cap` as cards; a practice request spends the same daily use as a cards request.

## Task 4: Practice UI and browser scoring

**Files:** `src/data/study-ai.ts`, `src/components/study/generate.tsx`; tests in `src/components/study/generate.test.tsx`.

**Verified:** `src/data/study-ai.ts` has `readStudyFile`, `saveDrafts`, `CHATS`, and `lastChat`/`pickChat`; the cards path is `generateHere` and `readPasted` (names to match when the file is read again before editing).

- [ ] Add `practiceHere(r)`, `ownPractice(r)`, and `readPastedPractice(text, count)` in `src/data/study-ai.ts`, mirroring the cards functions.
- [ ] Add a Practice option beside Cards in `generate.tsx`. Both paths (Generate here and Use your own AI) lead to the same preview.
- [ ] Scoring runs in the browser: the learner answers each question, and the browser compares the letter with the key it holds. Show the explanation after each answer.
- [ ] On finish, build per-topic results: `{topic, correct, total}` for each `topic_tag`.
- [ ] Tests: a generated set scores correctly; a pasted answer scores the same way; topics are grouped.

**Done when:** a learner can finish a set from either path and see a score per topic. The only Worker calls are generation (Task 3) and saving results (Task 5). Scoring makes no call.

## Task 5: Per-topic results storage

**Files:** `migrations/0013_practice_attempts.sql`; `scripts/lib/move-db.js` (TABLES, ORDER_BY, LATEST_MIGRATION); `worker/study-ai.js` or the sync module; tests in `test/study-ai.test.js`.

- [ ] Option A (recommended, decision 2): a synced kind `practice` in `practice_attempts`, so results travel through the existing sync pipeline and are scoped per user like other rows. Needs the explicit kind list in `syncPageV3` and a test that it does not reach v3 (as in Stage 3). Confirm `syncPageV3`'s kind list when this task starts.
- [ ] Option B: `POST /api/study-ai/practice/results`, which validates `{topic, correct, total}[]`, checks the caller, and inserts rows. Simpler, but it is a second write path outside sync.
- [ ] Table columns: `id`, `user_id`, `run_id`, `topic`, `correct`, `total`, `at`. One row per topic per run. Do not store `wrong`: derive it as `total - correct` in the query, so there is one source of truth. `run_id` is made in the browser when the set is started, and the server only checks it.
- [ ] Validation: `correct ≤ total`, `total` between 1 and 30, topic text cut to 60 characters, at most 20 topics per run.

**Done when:** a run's topic rows are stored once, a repeat submit does not double them (`run_id` plus `topic` is unique per user), and another user cannot read them.

## Task 6: Weak topics and study-plan weighting

**Files:** `src/core/study-plan.ts`; tests in `test/study-plan.test.js` (it already has the `studyPlan` cases at lines 32 to 39, which must still pass).

**Verified (read this session):**
- `studyPlan(exam, today, rest)` takes topics from `exam.checklist`: entries not `done`, text trimmed, empty removed. It has no tags and no minutes.
- Dates: from `today` up to the day before the exam, skipping `rest` weekdays.
- Placement: topic `i` goes to day index `floor(i * k / n)`, where `k` is the number of days and `n` the number of open topics. So each topic lands on exactly one day, and days are spread evenly.
- Output: `{days: [{date, topics}], open, noStudyDays}`.
- Callers: `src/components/sheet/class-item-sheet.tsx` (line 95) and `src/components/sheet/item-sheet.tsx` (line 126), both passing `normalizePrefs(profile?.studyPrefs).rest`.

**Consequence:** the plan has no time per topic, so "1.5 times the share of days" can't be expressed exactly as written. Decision 6 picks how to represent weak topics. The steps below work for either option.

- [ ] Compute weak topics from the runs in the window (decision 3): a topic is weak when it has at least one wrong answer in those runs. Pure function, tested.
- [ ] Match `topic_tag` to checklist text with a normalized comparison: lowercase, collapsed whitespace, no punctuation. A tag with no matching checklist item changes nothing (it is not an error). Tests cover a tag that matches, one that doesn't, and a case difference.
- [ ] Implement the weak-topic weighting from decision 6, option (a): a weak topic is listed on its planned day and again on the next study day as a review. That is two listings, not 1.5 times, and the plan says so.
- [ ] With no weak topics, output must be identical to today's output (snapshot test).

**Done when:** a weak topic gets the extra listing; every open checklist item still appears at least once; days stay in date order; with no runs the output matches the old output in a snapshot test.

## Task 7: Buddy heal and damage for practice answers

**Files:** `src/core/buddy-rules.ts` (new `PRACTICE_*` constants beside the card ones); `worker/buddy.js` (`reads`, `healthOf`, a new `practiceHealthEvents`); tests in `src/core/buddy-rules.test.ts` and `test/buddy.test.js`.

**Verified (read this session), and it changes the design:**
- Health is **not stored**. `healthOf({window, minutesByDay, events})` starts at 100 and, for each day in order, applies that day's events, then the idle rule, then the minutes bonus, clamping to 0 to 100 after each step.
- `reconcile()` builds the event list from `healthEvents(...)` (labs and offices missed: `HEALTH.missed`) and `cardHeal` (`HEALTH.perCard * distinct cards reviewed that day`), then calls `healthOf`.
- Coins are the only thing written to `buddy_ledger`, and only for `session:*` and `cards:*` sources, with an upsert that keeps the max.

**Consequence:** practice health should be events on the read path, like `cardHeal`. There is nothing to write on save, so re-reading can't apply it twice. The "a second reconcile adds nothing" test becomes "reading twice gives the same health". The `healthOf` clamp must also be able to hold practice damage at a floor of 1 (below), which the current clamp (0 to 100) can't do.

**Rules (tracker numbers, decisions 4 and 5):**
- Gain: +1 health per correct answer, capped at +2 per day from practice in total. Cap reason: one run gives 4 to 10 answers; without the cap a single run could heal more than a full day of flashcards (+2 per card, per the Stage 3 rule).
- Loss: -1 health per wrong answer, capped at -2 per day from practice in total.
- Floor: practice losses never take health below 1. A buddy can't die from practice alone. Rule: `h = h <= floor ? h : Math.max(floor, h + change)`. A loss landing on health already at 0 (for example after missed labs) leaves it at 0, because the rule never raises health.
- Gameplay gating: practice has its own gate, which cards do not. `cardHeal` counts every review: `cardsByDay` in `worker/buddy.js` has no gameplay check, and only `paidReviews` checks `r.at >= s.on_at`. Practice rows count only when `at >= s.on_at`, so with gameplay off, or before it was switched on, they give neither gain nor loss. This plan does not change the card rule.

**Steps:**
- [ ] Add `PRACTICE_GAIN = 1`, `PRACTICE_GAIN_CAP = 2`, `PRACTICE_LOSS = 1`, `PRACTICE_LOSS_CAP = 2`, `PRACTICE_FLOOR = 1` to `src/core/buddy-rules.ts`. Check that `worker/buddy.js` imports them the same way it imports `HEALTH`.
- [ ] Write `practiceHealthEvents(rows, onAt, tz)` in `worker/buddy.js`: keep only rows with `at >= onAt`, where `onAt` is `s.on_at` (the same test `paidReviews` uses). Give each row a day with `dayOf(row.at, tz)`, group by day, and per day emit a gain `min(PRACTICE_GAIN_CAP, PRACTICE_GAIN * correct)` and a loss `-min(PRACTICE_LOSS_CAP, PRACTICE_LOSS * wrong)` carrying `floor: PRACTICE_FLOOR`. On a day with both, apply the gain first, then the loss, and say so in a test. Otherwise the floor result depends on order.
- [ ] Extend `healthOf` so an event with `floor` is applied as `h = h <= floor ? h : Math.max(floor, h + change)`. A loss can never raise health; events without `floor` keep the 0 to 100 clamp unchanged.
- [ ] Add a `practice_attempts` read to `reads(...)`, and pass `practiceHealthEvents(...)` into the `events` list in `reconcile()`.
- [ ] Practice health never writes to `buddy_ledger`. Practice coins come only from Task 8.
- [ ] Tests (write first, see them fail for the right reason):
  - gain cap: 20 correct in one day gives +2, not +20;
  - loss cap: 20 wrong in one day gives -2;
  - floor: health at 1 with a loss event stays at 1;
  - floor at 0: health already at 0 (from missed labs) when a practice loss lands stays at 0, not 1;
  - reading twice gives the same health;
  - gameplay off, or practice rows before `s.on_at`, give neither gain nor loss.

**Done when:** all six test groups pass, the gain, loss, floor and zero-floor tests failed before the rule was written, and `reads` has no new ledger write.

## Task 8: Quiz Magnet shop item

**Files:** `src/core/buddy-rules.ts` (the `magnet` row in `UPGRADES`; new `PRACTICE_COIN_CAP = 20` and `MAGNET_STEP = 5`); `worker/buddy.js` (`practiceAwards`, `reconcile`, the ledger GLOB); tests in `src/core/buddy-rules.test.ts` and `test/buddy.test.js`.

**Verified (read this session):** card coins are derived on read. `cardAwards(paidReviews, foundryOf)` is at `worker/buddy.js` line 124, and `foundryOf = levelAt(ledger, 'foundry', paid.get('cards:' + day)?.at ?? now)` is at line 247. `paidReviews` counts only rows with `at >= s.on_at` (line 244). The upsert at line 257 raises amounts only for `session:*` and `cards:*`. Spec line 138 sets correct-answer coins to `min(20 + 5 × Quiz Magnet level, correct that day)`.

**Naming:** the ledger source is `practice:<day>`, not `quiz:<day>`, so no new code uses `quiz`. The spec table row (line 138) must change to match.

**Steps:**
- [ ] Add `PRACTICE_COIN_CAP = 20` and `MAGNET_STEP = 5` to `src/core/buddy-rules.ts`. Set `open: true` on `magnet` and change its effect to "+5 practice coin cap".
- [ ] Test first: `practiceAwards` pays `min(cap + 5 × level, correct that day)` per day. At level 0 the cap is 20, at level 2 it is 30, at level 5 it is 45. A day with no correct answers pays nothing.
- [ ] Test first: a day first paid at magnet level 1 keeps its amount after the buyer reaches level 2, and a day first paid after the buy gets the new cap. This mirrors the Card Foundry rule.
- [ ] Test first: practice rows before `s.on_at` pay nothing, as `paidReviews` does.
- [ ] Add `practiceAwards(correctByDay, magnetOf)` beside `cardAwards`. In `reconcile()`, set `magnetOf = (day) => levelAt(ledger, 'magnet', paid.get('practice:' + day)?.at ?? now)`, count correct answers per day from the `practice_attempts` read (rows with `at >= s.on_at`), add the output to `pay`, and add `OR buddy_ledger.source GLOB 'practice:*'` to the upsert's GLOB at line 257. Without that GLOB change the amount never rises.
- [ ] Buying magnet uses the existing buy statement; the buy path does not change.

**Done when:** the tests pass, the shop lists Quiz Magnet as open, a level bought today raises the cap only for days first paid after the buy, and a repeat read pays nothing new.

---

## Verification

- Each task ends with `npm run check`. The full check runs once after Task 7 as well.
- Manual smoke test before the stage merges: generate a set through Generate here, paste a set through Use your own AI, score both, check the plan changes (decision 6), check that buddy health rises by one per correct answer until the daily cap, and falls by one per wrong answer until its daily cap, never below 1 from practice, and check that buying Quiz Magnet raises the practice coin cap (Task 8).

## Decisions

**Recorded:**
1. **Stage name:** Practice. Stage 5 is renamed; the UI says "Practice".
2. **Saving results:** a synced table (Option A). George's answer was "save the results", which matches it.
3. **Weak-topic window:** the last 3 runs. Within that window, a topic is weak when it has at least one miss (the source's rule, `count >= 1` in `routers/quiz.py`).
4. **Heal size:** +1 per correct answer, capped at +2 a day. George chose to keep the scaled version.
5. **Wrong answers:** -1 per wrong answer, capped at -2 a day, floor 1 from practice. George chose to keep the scaled version.

6. **Weak-topic weighting:** option (a). A weak topic is listed again on the next study day as a review (two listings, not 1.5 times). George chose this.
7. **Death penalty:** not ported. Practice cannot kill the buddy; the health floor stops it.
