# Achievements

Badges on the Study page for how much you study, what you finish, and how exams go, plus
achievements you make yourself, each with a sticker cut from a picture you upload.
Mockup: `design/mockup-achievements.html` (it shows emoji stickers; the build uses uploads).

## What you see

An **Achievements** panel on the Study page, full width, below the flow/week row and above
the term heatmap.

- **Header:** `ACHIEVEMENTS`, "12 of 25" (built-in + your own), and a progress line.
- **Next up:** the three locked built-in badges closest to done (highest progress fraction;
  grade badges and an unset goal left out), each with a medal, name, "31.5 / 50 h" and a
  bar. One column when the panel is under 640px wide (container query).
- **Groups**, in a grid (`auto-fit, minmax(min(310px,100%),1fr)`): Study hours, Streak,
  Big days, Tasks done, Exams, Grades, then **Your own** at full width.
- **Built-in badges are round medals** with the tier inside ("10h", "7d", "90+"). Earned:
  filled in the group colour with a check and the date. Locked: hollow, with a progress
  ring and a percentage (grades show "Best 92").
- **Your own are stickers**: the uploaded picture as a circle with a white die-cut edge,
  tilted a few degrees when earned (fixed per sticker), grey until then with progress under
  the name. The last tile is "+ New" (disabled at 30). A sticker opens it for editing.

Group colours come from existing tokens: hours = study pink, streak = amber, big days =
accent, tasks = good green, exams = break purple, grades = gold, your own = coat colour.

## Built-in achievements (24)

| Group | Badges | Measured from |
|---|---|---|
| Study hours | 1, 10, 25, 50, 100, 250 h | total `studyMinutes` of all sessions |
| Streak | 3, 7, 30, 100 days | longest streak ever, `streak()` rules (dayMin, rest days) |
| Big days | First session · Goal met · Marathon day (4 h in one day) | `minutesByDay`, `prefs.goal` |
| Tasks done | 1, 10, 50, 100 | non-test items with status done / submitted / graded |
| Exams | 1, 5, 10, 25 | exam + quiz items with status done / graded |
| Grades | 80+, 90+, 100 | exam/quiz items with `status == 'graded'` and `grade` ≥ tier |

**Earned date** is the local day the threshold was first crossed: hours, streak and big days
walk `minutesByDay` in date order; tasks, exams and grades use the item's `completedAt`
(fallback `updatedAt`, then `date`).

Built-ins are derived, never stored. Deleting the session or un-grading the exam that earned
one can un-earn it; that is accepted. Longest streak counts all history, so a broken streak
keeps its badges.

## Your own achievements

A synced table, `achievements` (migration `0003_achievements.sql`), one row each:
`{id, name, sticker, rule, courseId, itemId, target}`.

| Rule | Fields | Earned when | Earned date | Progress |
|---|---|---|---|---|
| `hours` | `courseId`, `target` 1–1000 | study minutes on that course ≥ target × 60 | day the course total crossed it | "12.5 / 20 h" |
| `grade` | `itemId` (exam or quiz), `target` 1–100 | that item is graded ≥ target | item's `completedAt` (fallback `updatedAt`) | "Got 71, need 85" / "Not graded yet" |

- **Sticker:** the picture itself, as a `data:image/{webp,png,jpeg};base64,` URL of at most
  90,000 characters. The browser cuts it to a 256px circle with a white edge and encodes
  WebP, falling back to PNG and smaller sizes until it fits (`public/js/sticker.js`).
  It lives in the row, so it syncs and works offline like every other record, and it is
  only ever served through `/api` to its owner, never from `public/`.
- **Name:** 1–40 characters. At most 30 live per account (`400 too_many`; an edit to one of
  the 30 still saves).
- A deleted course or item leaves the achievement locked ("Course removed" / "Exam removed").

**Editor drawer** (`drawer-achievement.js`): Sticker (Upload a picture → a round crop you
drag, or move with the arrow keys, and zoom 1–3×, then "Use this"), Name, "Earned when"
(Study hours on one course / A grade on one exam or quiz), then Course + Hours or Exam/quiz
+ Grade, a line with where it stands now, and Add/Save, Cancel, Delete (with Undo).

## Unlocking

`celebrateAchievements()` in `study-controller.js`, next to `celebrateStudy()` in
`session.js`. The first look, and every sync from elsewhere, only records the earned ids;
after a change made here, any newly earned id shows a toast ("Achievement unlocked: 50
hours", with the medal or the sticker in front, "and 2 more" when several) with a **See**
button that goes to the badge and pops it, plus fireworks when `prefs.celebrate` is on.
Making one that is already earned unlocks it at once.

## Code layout

- `public/js/achievements.js`: pure. `achievements(sessions, items, prefs, today)`,
  `ownAchievements(own, sessions, items, courses)`, `nextUp(list)`.
- `public/js/sticker.js`: reading, drawing, dragging and encoding a sticker.
- `public/js/views/achievements.js`: the panel. `public/js/views/drawer-achievement.js`: the editor.
- `public/css/study.css`: panel, medal, sticker and drawer styles (no inline styles).
- Worker: `validateAchievement`, the `achievements` table in `worker/db.js` (with the
  30-row guard in the upsert), route and tombstone purge. Client: IndexedDB version 4
  adds the store; `store.saveAchievement` / `deleteAchievement`.
- `scripts/lib/database-health.js` checks the new table; its per-table sums became scalar
  subqueries, since D1 refuses a compound SELECT of more than five terms.

## Tests

- `test/achievements.test.js`: built-in thresholds, earned dates, streak rules, tasks vs
  exams, grade tiers, Next up.
- `test/custom-achievements.test.js`: the API (save, feed, delete, ownership, bad shapes,
  the 30 limit) and the hours/grade rules, removed course/item included.
