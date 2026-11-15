# Audit Follow-up Plan

**Goal:** Close what the November 2026 audit left open. The audit (`docs/AUDIT-2026-11.md`)
confirmed 59 findings; 43 are fixed and merged. The 16 still open are here, with the
decision each one needs and the work that follows once it is made.

**Status:** George answered on 15 November: every question takes its recommended answer
(Q1a, Q2a, Q3a, Q4a, Q5b, Q6a, Q7a, Q8a, Q9b, Q10a, Q11a). Tasks 1 to 11 are done on
`claude/busy-cori-t91umd`, each with its test, and Part 3's L6, stale-draft and read-guard
items too. Still open: L14 (room minutes after going quiet), the two live-database queries
(they need George's yes), T24, and the efficiency pass's items below. Retiring sync v3 as well
was asked and not answered.

**Finding numbers** (S, F, T, L) are the audit's. Each finding there has the sequence that
reproduces it, and the audit's test sources are in the session that ran it; the tests to
write first are named below.

---

## How to work in this repo (read before any task)

1. **Checks:** `npm run check` (typecheck, tests, build). One file:
   `npx vitest run --project workers test/buddy.test.js`. The browser suite: `npm run e2e`.
2. **Tests first:** every change starts with a test that fails for the reason the audit gives.
3. **Line endings:** every file LF. **Non-ASCII** text goes in with the edit or write tools,
   not through a shell; run `npm run build` after.
4. **Commits:** no `Co-Authored-By` or other trailers. Never push, merge to `main` or touch
   remote D1 without George's yes.
5. None of these tasks needs a migration as written. If one turns out to, it needs
   `npm run db:remote` and `npm run db:check -- --remote` before its merge.

---

## Part 1: Open questions

Each has the options and a recommendation. Answer with the letter.

### Q1. Buddy coins when an item changes scope (L1, L2)

Converting a course into a class, absorbing, sharing items, or leaving a class with a copy
gives an item a new ledger key, so a finish already paid is paid again (15 coins became 65
with nothing new done), and a personal grade pays the class grade bonus.

- **(a)** A finish is paid once per item id, whatever scope it is in now; a move writes off
  the grade bonuses for the grades it carries. *Recommended:* it is what the spec says
  ("never again for that item", "a personal item's grade pays nothing").
- **(b)** Leave it. Moving items is rare and the amounts are small.

### Q2. The 240-minute day when sessions arrive out of order (L3)

A second device's earlier session arriving after a later one was paid takes the day to 98
coins where the cap allows 50, because a paid session row never shrinks.

- **(a)** Clamp when paying: the day's `session:` rows may sum to at most the cap.
  *Recommended.*
- **(b)** Leave it; it needs two devices and an unlucky sync order.

### Q3. Smaller buddy rules (L11, L12, L13)

- **L11**, saving settings from another time zone pays the same streak day again under its
  new date. **(a)** Pay only streak days later than the newest one already paid.
  *Recommended.* **(b)** Fix the zone once gameplay starts.
- **L12**, an open assignment costs health for 13 days, not the window's 14. **(a)** Read
  assignments from the day before the window. *Recommended; one line.* **(b)** Leave it.
- **L13**, a lecture review with an edited title is paid as a personal finish and tallied
  later as a review, so the day's five personal finishes can become ten. Which test is
  right: **(a)** the id alone (`rv…`), *recommended*, since the tally already uses it and a
  title can be edited; **(b)** the id and the title.

### Q4. One run open in two tabs (T1)

Pause in tab A for 20 minutes of a 60-minute run: tab B, whose clock is stale, logs 40
minutes at the hour and clears the run; tab A then logs nothing. The existing test "logs a
run's minutes as kept when another tab of this device paused it"
(`src/data/study-timer.test.ts`) pins today's behaviour.

- **(a)** The stale tab adopts the stored clock when it is not done, and carries on; the
  test is rewritten to say so. *Recommended:* the study is the person's, and losing 20
  minutes of it without a word is the worse outcome.
- **(b)** Keep today's behaviour and the test.

### Q5. "Logging to" in a study room (T6)

Changing the class mid-session moves every minute of it to the new class. The code's own
comment says "from here on".

- **(a)** Close the stint so far as its own session and start a new one, so each class gets
  its minutes. Needs a second session id per room.
- **(b)** Keep one session and reword the control so it says the whole session moves.
  *Recommended:* much smaller, and honest about what happens.

### Q6. A removed member and the old join code (S8)

Someone the owner removed can rejoin at once with the code they used before.

- **(a)** Removing a member clears the join code; the owner issues a new one.
  *Recommended.*
- **(b)** Leave it; the owner can clear the code by hand.

### Q7. The linked assignment's title in a project's activity (S7)

Linking a project to a class assignment shows that assignment's title to project members
who are not in the class. The shared-classes spec says class data shows only to people in
the class; the Stage 8 plan and DATA-MODEL describe what the code does.

- **(a)** Stop storing the title; the browser names the assignment only for a reader who
  holds the class. *Recommended.*
- **(b)** Keep it and correct the spec line.

### Q8. Generate here give-backs (S2, S4)

A failed run gives the person's use back. Its neurons now count toward the day's ceiling,
so one person whose answers keep failing can close Generate here for everyone that day. An
AI read that times out after a slow upload is also handed back (S4).

- **(a)** At most 3 give-backs a person a day; after that a failed run costs the use.
  Start the read's deadline after the upload, not before. *Recommended.*
- **(b)** Leave both; the ceiling is the backstop.

### Q9. Notes typed on a new class item (from F5)

A new item saved "to the class for everyone" puts the card's Notes into the class's notes,
which every member reads.

- **(a)** Notes typed on a new class item go to your own mark; class notes are edited on
  the class item's card afterwards.
- **(b)** Keep it, and label the box "Class notes (everyone sees these)" while the "for
  everyone" box is ticked. *Recommended:* smaller, and it removes the surprise.

### Q10. A full study room (L16)

Joining without an invite is not held to the 24 rows a room may have.

- **(a)** When a room is at 24, a new joiner replaces the oldest member row that has left.
  *Recommended.*
- **(b)** Answer `409 full`.

### Q11. Old v2 tabs (L8)

A v2 pull from 0 with more than 100 rows below the floor resets for ever.

- **(a)** Retire v2: answer it with the "reload" response old clients already understand.
  *Recommended;* check `test/old-clients.test.js` for what that response is.
- **(b)** Patch v2 to return every row up to the floor on a pull from 0.

---

## Part 2: Tasks that follow the answers

Each task: write the test, see it fail, make the change, run the file and its neighbours.

### Task 1 (Q1a): a finish is paid once per item

**Files:** `worker/buddy.js` (`reconcile`, `finishAwards`, the XP count); the batches that
move items: `worker/classes.js` (convert), `worker/layer.js` or wherever absorb and share
live, `worker/leaving.js` (the copy); tests in `test/buddy.test.js`.

- [x] Test: convert a course with three finished items and a graded exam; coins and XP are
      unchanged after the convert (audit L1's sequence, 15 coins stays 15).
- [x] Test: leave a class with a copy after seven class finishes; coins stay 35, XP stays 70
      (audit L2).
- [x] Treat a finish as paid when any `item:*` ledger row ends in the same item id; count XP
      finishes by item id.
- [x] The grade bonus: skip marks the convert, absorb and share batches created, or have
      those batches write 0-amount `grade80:` and `grade90:` rows.

### Task 2 (Q2a): the day's session coins hold to the cap

**Files:** `worker/buddy.js`; `test/buddy.test.js`.

- [x] Test: a 240-minute session at 04:00, read, then one at 00:00 the same day, read:
      50 coins, not 98 (audit L3).
- [x] When paying, clamp each new or raised `session:` amount so the day's rows sum to at
      most the cap. A row still never shrinks.

### Task 3 (Q3): streak day, health window, review finishes

**Files:** `worker/buddy.js`; `test/buddy.test.js`, `test/buddy-engine.test.js`.

- [x] L11: pay only streak days later than the newest paid `streak:` day. Test: a settings
      save from another zone adds no second row.
- [x] L12: read assignments from `addDays(startDay, -1)`. Test: one dated 14 days back
      costs the same 10 as one dated 13 back.
- [x] L13: classify a finish by its id alone in `finishAwards`. Test: five edited-title
      review tasks, a read, five ordinary tasks, a read: the personal limit holds.

### Task 4 (Q4a): the stale tab adopts the stored clock

**Files:** `src/data/run.ts` (`finish`); `src/data/study-timer.test.ts`.

- [x] Rewrite the pinned test to expect one 60-minute session after a 20-minute pause in
      the other tab (audit T1).
- [x] In `finish()` on a natural end, when the stored solo clock is not done, take it and
      keep ticking instead of logging and clearing.

### Task 5 (Q5b): say what "Logging to" does

**Files:** `src/components/focus/` (the room's class picker); its test.

- [x] Reword the control and its hint so it says the whole session is logged to the class
      picked. Fix the "from here on" comment in `src/data/study-room.ts`.

### Task 6 (Q6a): removal clears the join code

**Files:** `worker/leaving.js` (`removeMember`); `test/join-code.test.js`.

- [x] Test: join by code, be removed, join by the same code again: refused.
- [x] Clear `code_hash`, `code_expires` and `code_uses_left` in the removal batch, for
      classes and projects. Say so in the members tab where the owner removes someone.

### Task 7 (Q7a): no class title in a project's activity

**Files:** `worker/projects.js` (`linkProject`); the activity row's text in
`src/data/inbox.ts`; `test/projects.test.js`.

- [x] Test: a project member outside the class reads no `detail.assignment`.
- [x] Store `detail: {}`; the browser names the assignment from the parent item when the
      reader holds the class, else says "a class assignment".
- [x] Correct `docs/DATA-MODEL.md` to match.

### Task 8 (Q8a): give-backs are limited

**Files:** `worker/study-ai.js`, `worker/api.js` (the AI reads), `worker/limits.js`;
`test/study-ai.test.js`, `test/ai.test.js`.

- [x] Test: four failed runs in a day; the fourth costs the use.
- [x] Count give-backs per person per day in `request_limits`; refuse past 3.
- [x] Start an AI read's deadline after `readBytes`.

### Task 9 (Q9b): label class notes

**Files:** `src/components/sheet/item-sheet.tsx`; its test.

- [x] While "Add it to the class for everyone" is ticked, the Notes box is labelled as the
      class's, read by everyone.

### Task 10 (Q10a): a room holds 24 rows

**Files:** `worker/rooms.js` (`joinRoom`); `test/rooms.test.js`.

- [x] Test: 30 friends join and leave in turn: at most 24 rows.
- [x] With no row of your own and the room at `ROOM_ROWS`, replace the oldest row that has
      left and never studied; with none to replace, `409 full`.

### Task 11 (Q11a): retire sync v2

**Files:** `worker/api.js`, `worker/db.js` (`syncPage`); `test/old-clients.test.js`.

- [x] Test: a v2 pull answers the reload response and never loops.
- [x] Remove `syncPage` once nothing calls it.

---

## Part 3: Follow-ups that need no decision

- [x] **L6. Give a use back to the window it was claimed in.** `worker/study-ai.js`
      `giveBack` and `worker/limits.js` `giveBackOutline` decrement whatever window is
      open. Have the claim return its `reset_at` and add `AND reset_at = ?` to the
      give-back. Tests: the audit's two cases (a claim one second before the window ends,
      given back after the next has started; the new window keeps its count).
- [ ] **L14. Room minutes for someone taken out for going quiet.** Store the room's study
      time with each `last_seen` write and credit from that, so a pause after they left
      does not cost them (15 minutes credited for 20 studied). `worker/rooms.js`.
- [x] **The stale-draft pattern elsewhere.** The course sheet's fix (F1) was to save only
      what the draft changed onto the row as stored now. The audit read the same pattern,
      untested, in the inline task editor (`src/components/sheet/task-row.tsx`: `assignees`
      from when it opened) and in `src/data/achievement-edit.ts` and
      `src/data/session-edit.ts` (the old revision). Write the test for each first; fix the
      ones that fail.
- [x] **A read guard for bad dates.** New writes are refused (L4), but `countSessions` in
      `worker/buddy.js` should skip a stored row whose start cannot be a date, so one bad
      row cannot fail the Buddy page.
- [ ] **Two queries on the live database**, read-only, with George's yes:
      `SELECT scope, id, date FROM items WHERE date NOT GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]' OR substr(date, 6, 2) > '12' OR substr(date, 9, 2) > '31'`
      and `SELECT user_id, id, started_at FROM study_sessions WHERE started_at > 8640000000000000`.
      Any row found is fixed by hand.
- [ ] **T24.** A step over 99 minutes shows `99:xx`. Deliberate and pinned by tests; if it
      should show hours, that is a design change to the flip clock, not a fix.

## Efficiency pass, 15 November (done, and what was left)

Done: the nightly purge and autoKeep run on indexes; the Buddy's reconcile makes one round trip
fewer; `0013_leaderboard_indexes.sql`; the focus screen loads lazily (first-load JS 65 to 51 kB
gzip); the cards-due count is memoized; sync retries back off with jitter; dead code and copies
removed. Considered and left, each for a reason or a decision:

- **The store reloads all 19 IndexedDB stores after every write** (`src/core/store.ts` `mutate`),
  so every memo in the app recomputes on each save and each sync. The biggest front-end cost.
  Fix: re-read only the stores a transaction wrote, keep the other arrays' identity, and skip
  `applyPage`/`applyServerProfile` writes that change nothing. A store refactor: wants its own
  stage and tests.
- **Push uploads one edit per request** (`src/core/sync.ts` `pushAll`), with a full reload after
  each. A backlog of 50 is 50 round trips. Fix: settle all results in one transaction, or a batch
  endpoint.
- **Hourly digests loop over every push subscriber** (`worker/push.js`), 3 to 4 D1 calls each,
  capped by pushes sent, not by users read. On D1's free plan (50 queries an invocation) that
  fails at about 15 subscribers in one zone. Fix: a `next_digest_at` column and index, and a cap
  on users per run. Needs a migration.
- **The maintenance check reads `app_meta` on every guarded request.** A short isolate cache
  would save the read, but the Worker tests share the module and an admin's switch would lag.
- **Every tab syncs after an edit in any tab.** Kept: it is what uploads a tab's queued edit when
  that tab closes before syncing.
- **Friend search** (`LIKE '%q%'`) scans every user; **purgeRooms** is up to 400 sequential calls
  in the nightly invocation; **the purge** is one unchunked batch. Fine at today's size.
- **Bundle:** `tailwind-merge` (27 kB) and the buddy art (15 kB) are still on the first load.

## Suggestions from the Study review (for the Study Buddy stages, not tasks here)

- Time a card review so it counts toward the streak and the daily goal.
- Link a generated deck to the exam it came from, so the exam's card can show its due cards
  and the plan can schedule them.
- An undo for a mis-pressed grade in a review, and an Undo for deleting a card or a deck,
  as every other personal delete has.
- "Give me different cards": the same request always answers from the device's cache.

## Verification

Each task ends with `npm run check`. Before a merge: `npm run e2e`, and for Tasks 1 to 3 a
read of a real account's Buddy page before and after, to see no balance move.
