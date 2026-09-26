# School calendar

Upload the school's academic calendar once; the app then knows the semesters, the weeks,
the days off, the study break and the exams. Mockup: `design/mockup-school-calendar.html`.
Example: Vanier College 2026–27.

## Reading it

Settings → Study → **School calendar** → *Upload calendar…*. A PDF's text is pulled out
in the browser (PDF.js, like outlines) and sent to `POST /api/school-calendar`, where one
gpt-oss-120b call returns `{name, terms, days}` (`worker/school.js`). It shares the
outline reader's ten reads a day. Nothing is saved until the person has checked it in the
**review drawer** (`drawer-school.js`): the name, each semester's first and last day of
classes, and each special day's dates, kind, label and (for a swap) weekday. Rows can be
fixed, removed or added. Settings then shows the school, where today is ("Autumn 2026 ·
week 5 of 16"), and Review / Replace / Remove.

## The data

`users.school_calendar` (migration `0004`), a JSON object saved with the profile; `{}` is
none. 1–4 semesters `{name, start, end}`; up to 80 days `{from, to, kind, label, follows?}`:

| Kind | Classes | Shown as |
|---|---|---|
| `off` | none | hatched, with its label |
| `break` | none; the week is not numbered | green |
| `exams` | none | amber |
| `swap` | the `follows` weekday's | "Follows Mon" |
| `note` | as usual | a small dot label |

Outside every semester is "No school", with no classes.

## What it changes

- **Month view:** cells tinted and tagged; classes follow `classWeekday()`, with "N classes
  off" on a day off; the header shows "Weeks 6 – 11 · Autumn 2026".
- **Week board:** the subtitle adds "Week 7 of 16 · Autumn 2026" (or "Study break", "Exams");
  day headers are tagged and tinted; classes follow `classWeekday()`.
- **Term start:** `termStartFor()`: the latest semester to have started, else the next; the
  term start set by hand or by an outline import counts only without a calendar. Used by
  the heatmap, "This term", exam prep and outline imports.
- **Lecture reviews and exam prep** only count lectures on days with classes.
- **Calendar feed:** each class repeats per semester (`UNTIL` its last day), `EXDATE` on
  days its weekday has no classes, plus single events on the days that follow its weekday.

## Code

`public/js/school.js` is pure and time-zone free, shared by the app and the Worker's feed:
`normalizeSchool`, `dayInfo`, `classWeekday`, `weekOf`, `currentTerm`, `termStartFor`,
`schoolStatus`. Views: `views/school-bits.js` (tags, week labels). Tests:
`test/school.test.js` (the Vanier year: day kinds, swaps, week numbers around the break,
term start, reviews, model cleanup, validation, the profile round trip, the feed).
