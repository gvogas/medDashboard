# Term Stage 3: Semesters and repeats — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A course belongs to one semester of the school calendar (or all year) and its classes show only inside that semester; the sidebar picks which semester's courses it lists; tutorials, labs and office hours repeat "Just once" or "Every week" until the end of a semester or of the school year.

**Architecture:** No database change. The course's existing `term` text (≤ 40) holds a semester's name, or `''` for all year; a term that matches no semester counts as all year. Five small pure helpers go in `src/core/school.ts` (`courseTerm`, `courseRunsOn`, `inTerm`, `pickedTerm`, `repeatEnds`), and every place that lays classes onto dates calls `courseRunsOn`: the week, the month, lecture reviews, exam topics and the calendar feed. The sidebar's pick lives in the UI state (`ui.sem`, not synced, not remembered). The item card's repeat uses the items' existing `recur` / `recurUntil`; the server already accepts a weekly item of any type.

**Tech Stack:** Vite, React 19, TypeScript, Tailwind 4, Vitest (jsdom + Workers pool), Cloudflare Workers + D1.

**Spec:** `docs/superpowers/specs/2026-09-29-term-redesign-design.md` §6. **Prototype:** `design/term-prototype.dc.html` (read, don't open): the sidebar's semester select and "Both" tag lines 49–55 and 2207–2226; the item card's Repeat and Until lines 940–953 and 2271–2275. The import's semester pickers (lines 1290, 1323) belong to Stage 7: not here.

**Branch:** `term-3-semesters` off `term`, after bringing `term` up to `main`:
`git switch term && git merge --ff-only main && git switch -c term-3-semesters`.

**What the owner sees at the end:** With a school calendar of Fall 2026 and Winter 2027, the course sheet shows a Semester switch (Fall 2026 · Winter 2027 · Both semesters) with "Classes run 8 Sep – 18 Dec." under it. A Winter course's classes are gone from the week and month in the fall and appear from the first day of Winter; the calendar feed and lecture reviews agree. The sidebar's Courses heading has a semester select (today's semester first); it lists that semester's courses and the all-year ones, marked "Both". A lab, tutorial or office hour has Repeat: Just once / Every week; Every week picks "Until the end of Fall 2026 · 18 Dec" by default, with Winter and the school year offered. Without a school calendar everything looks as it does today.

**Not in this stage:** weekly items skipping breaks and days off (the prototype's note says so, the spec does not; ask the owner before adding it); the import's semester pickers (Stage 7); the item card's new look (Stage 4).

---

## How to work in this repo (read before any task)

1. **Checks:** `npm run typecheck`, `npm test`, `npm run build` (CSP checks). `npm run check` runs all three. One file: `npx vitest run test/school.test.js`.
2. **Dev server:** `npm run dev` → http://127.0.0.1:8787. First run `Get-NetTCPConnection -LocalPort 8787 -State Listen` in PowerShell and stop any leftover `vite.js` on it. Don't run `npm run build` while it runs. If the page is blank and titled "Rounds", an old service worker is serving its cache: DevTools → Application → Service workers → Unregister, then reload. Local user: `termqa` / `termqa-local-1`.
3. **Line endings:** keep every file LF.
4. **Commits:** end each message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Commit only on `term-3-semesters`. Never push without the owner's yes (Task 9 asks). This stage touches no database.
5. **Tests find text.** When a task changes a word, `rg -n "<old word>" src test` and update the tests in the same commit.
6. **Dates** are `YYYY-MM-DD` strings compared as strings. `dayMonth("2026-12-18")` is `"18 Dec"`, `shortDate` is `"Fri 18 Dec"` (both in `src/core/dates.ts`).

---

## File structure

| File | Change | Responsibility |
|---|---|---|
| `src/core/school.ts` | modify | `courseTerm`, `courseRunsOn`, `inTerm`, `pickedTerm`, `repeatEnds` |
| `src/data/views.ts` | modify | week and month lay a class only on days in its course's semester |
| `src/core/reviews.ts`, `src/core/prep.ts` | modify | lecture dates (reviews, exam topics) respect the semester |
| `worker/calendar.js` | modify | the feed repeats a class only through its course's semester |
| `src/data/course-edit.ts`, `src/components/sheet/course-sheet.tsx` | modify | the Semester switch and its note |
| `src/data/types.ts`, `src/data/ui.ts`, `src/data/actions.ts`, `src/components/sidebar.tsx` | modify | `ui.sem`, `setSem`, the sidebar's semester select and "Both" tag |
| `src/data/item-edit.ts`, `src/components/sheet/item-sheet.tsx` | modify | Repeat for labs too; Just once / Every week; Until from the semesters |
| `docs/DATA-MODEL.md` | modify | what `courses.term` now means |
| tests | modify | `test/school.test.js`, `src/data/views.test.ts`, `src/data/item-edit.test.ts`, `src/components/sheet/sheet.test.tsx`, `src/components/sidebar.test.tsx` |

---

### Task 1: The semester helpers

**Files:**
- Modify: `src/core/school.ts` (append after `currentTerm`, around line 129)
- Test: `test/school.test.js`

- [ ] **Step 1: Write the failing tests**

In `test/school.test.js`, add `courseTerm, courseRunsOn, inTerm, pickedTerm, repeatEnds` to the import from `'../src/core/school.ts'` (line 2). Then, after the `describe('a school calendar', …)` block (it ends after `'keeps lecture reviews to days with classes'`, around line 89), add:

```js
describe("a course's semester", () => {
  it('is the semester its term names, else all year', () => {
    expect(courseTerm(cal, 'Winter 2027')).toBe(cal.terms[1]);
    expect(courseTerm(cal, '  winter   2027 ')).toBe(cal.terms[1]);
    expect(courseTerm(cal, '')).toBeNull();
    expect(courseTerm(cal, '2026 Autumn')).toBeNull();   /* free text from before */
    expect(courseTerm(null, 'Winter 2027')).toBeNull();
  });

  it('has classes only inside it; all-year courses always', () => {
    expect(courseRunsOn(cal, 'Autumn 2026', '2026-12-10')).toBe(true);
    expect(courseRunsOn(cal, 'Autumn 2026', '2027-01-19')).toBe(false);
    expect(courseRunsOn(cal, 'Winter 2027', '2026-09-14')).toBe(false);
    expect(courseRunsOn(cal, '', '2027-01-19')).toBe(true);
    expect(courseRunsOn(null, 'Winter 2027', '2026-09-14')).toBe(true);
  });

  it('is listed under its own semester, all-year courses under every one', () => {
    expect(inTerm(cal, 'Autumn 2026', cal.terms[0])).toBe(true);
    expect(inTerm(cal, 'Autumn 2026', cal.terms[1])).toBe(false);
    expect(inTerm(cal, '', cal.terms[1])).toBe(true);
    expect(inTerm(null, 'Autumn 2026', null)).toBe(true);
  });

  it('the sidebar shows the semester picked while it exists, else the current one', () => {
    expect(pickedTerm(cal, 'Winter 2027', '2026-09-23')).toBe(cal.terms[1]);
    expect(pickedTerm(cal, null, '2026-09-23')).toBe(cal.terms[0]);
    expect(pickedTerm(cal, 'Gone 2025', '2027-02-01')).toBe(cal.terms[1]);
    expect(pickedTerm(null, 'Winter 2027', '2026-09-23')).toBeNull();
  });

  it('gives the ends a weekly item can repeat until', () => {
    expect(repeatEnds(cal, '2026-09-23')).toEqual([
      { end: '2026-12-10', term: cal.terms[0] },
      { end: '2027-05-14', term: cal.terms[1] },
    ]);
    expect(repeatEnds(cal, '2027-02-01')).toEqual([{ end: '2027-05-14', term: cal.terms[1] }]);
    expect(repeatEnds(cal, '2027-06-01')).toEqual([]);
    expect(repeatEnds(null, '2026-09-23')).toEqual([]);
    /* exams after the last semester make the school year end later */
    const one = normalizeSchool({ terms: [VANIER.terms[0]], days: [{ from: '2026-12-11', to: '2026-12-22', kind: 'exams', label: '' }] });
    expect(repeatEnds(one, '2026-09-23')).toEqual([
      { end: '2026-12-10', term: one.terms[0] },
      { end: '2026-12-22', term: null },
    ]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run test/school.test.js`
Expected: FAIL, `courseTerm is not a function` (and the others).

- [ ] **Step 3: Write the helpers**

In `src/core/school.ts`, after `currentTerm` (before `termStartFor`), add:

```ts
/** The semester a course's `term` names, matched by name with case and spacing aside. Null
    means all year: an empty term, one that names no semester, or no calendar. */
export function courseTerm(cal: SchoolCalendar | null, text: string | null | undefined): Term | null {
  const want = (text || '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!cal || !want) return null;
  return cal.terms.find((t) => t.name.toLowerCase() === want) || null;
}

/** Whether a course of semester `text` can have classes on `date`: all-year courses always. */
export function courseRunsOn(cal: SchoolCalendar | null, text: string | null | undefined, date: string): boolean {
  const t = courseTerm(cal, text);
  return !t || (t.start <= date && date <= t.end);
}

/** Whether a course goes under semester `term` in the sidebar: its own, or all year. */
export function inTerm(cal: SchoolCalendar | null, text: string | null | undefined, term: Term | null): boolean {
  const t = courseTerm(cal, text);
  return !t || !term || t === term;
}

/** The semester the sidebar shows: the one picked while the calendar still has it, else the current one. */
export function pickedTerm(cal: SchoolCalendar | null, picked: string | null, today: string): Term | null {
  if (!cal) return null;
  return cal.terms.find((t) => t.name === picked) || currentTerm(cal, today);
}

/**
 * When a weekly item can repeat until, for an item dated `date`: the end of each semester
 * still to end, then the school year's last day (its last exam day) when that is later.
 * The first is the default. Empty without a calendar.
 */
export function repeatEnds(cal: SchoolCalendar | null, date: string): { end: string; term: Term | null }[] {
  if (!cal) return [];
  const out: { end: string; term: Term | null }[] = cal.terms.filter((t) => t.end >= date).map((t) => ({ end: t.end, term: t }));
  const last = cal.days.filter((d) => d.kind === 'exams').map((d) => d.to)
    .reduce((a, b) => (b > a ? b : a), cal.terms[cal.terms.length - 1].end);
  if (last >= date && !out.some((o) => o.end === last)) out.push({ end: last, term: null });
  return out;
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `npx vitest run test/school.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/school.ts test/school.test.js
git commit -m "A course's semester: the school calendar term its term names, else all year

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The week and the month show classes only in their semester

**Files:**
- Modify: `src/data/views.ts` (imports line 9; `byWeekday` around line 80; `weekDays` around line 153; `monthCells` around lines 228–231)
- Test: `src/data/views.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/data/views.test.ts`, after the `phys` constant (around line 30), add:

```ts
/* Fall ends on Tuesday 22 September 2026 so the test week holds both semesters. */
const TWO = normalizeSchool({ terms: [
    { name: "Fall 2026", start: "2026-09-01", end: "2026-09-22" },
    { name: "Winter 2027", start: "2026-09-23", end: "2026-12-18" },
] })
```

Inside `describe("the week", …)`, after the school calendar test, add:

```ts
    it("shows a course's classes only in its semester; all-year courses in both", () => {
        const fall = course({ ...anat, term: "Fall 2026" }), winter = course({ ...phys, term: "winter 2027" }, 1)
        const w = weekDays(input([], [fall, winter], { cal: TWO }))
        const ids = (i: number) => w.days[i].entries.map((e) => e.kind === "class" && e.slot.mtg.id)
        expect(ids(0)).toEqual(["m1"])          /* Monday is still Fall */
        expect(ids(2)).toEqual(["m3"])          /* Wednesday is Winter: Anatomy's Wednesday class is gone */
        const both = course({ ...anat, term: "" })
        expect(weekDays(input([], [both], { cal: TWO })).days[2].entries).toHaveLength(1)
    })
```

Inside `describe("the month", …)`, add:

```ts
    it("puts a course's classes only on days in its semester", () => {
        const fall = course({ ...anat, term: "Fall 2026" })
        const m = monthCells(input([], [fall], { cal: TWO, schedule: "classes" }))
        const cell = (date: string) => m.cells.find((c) => c.date === date)!
        expect(cell("2026-09-16").classes).toBe(1)   /* a Wednesday in Fall */
        expect(cell("2026-09-30").classes).toBe(0)   /* a Wednesday in Winter */
    })
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/data/views.test.ts`
Expected: the two new tests FAIL (Wednesday shows `["m3", "m2"]`; the Winter cell counts 1).

- [ ] **Step 3: Filter the slots per date**

In `src/data/views.ts`, change the school import (line 9) to:

```ts
import { classWeekday, courseRunsOn, dayInfo, weekOf } from "@/core/school"
```

After `byWeekday` (around line 84), add:

```ts
/** The classes of a weekday that run on `date`: a course set to one semester has none outside it. */
const runningOn = (list: ClassSlot[] | undefined, cal: SchoolCal, date: string) =>
    (list || []).filter((slot) => courseRunsOn(cal, slot.course.term, date))
```

(`SchoolCal` is declared a few lines further down; a type used before its declaration is fine in TypeScript.)

In `weekDays`, replace

```ts
            ...(wd === null ? [] : slots.get(wd) || []).map((slot) => ({ at: slot.mtg.start, entry: { kind: "class" as const, key: "c" + slot.course.id + slot.mtg.id, slot } })),
```

with

```ts
            ...(wd === null ? [] : runningOn(slots.get(wd), cal, date)).map((slot) => ({ at: slot.mtg.start, entry: { kind: "class" as const, key: "c" + slot.course.id + slot.mtg.id, slot } })),
```

In `monthCells`, replace

```ts
        const cls = schedule === "deadlines" || wd === null ? [] : slots.get(wd) || []
```

with

```ts
        const cls = schedule === "deadlines" || wd === null ? [] : runningOn(slots.get(wd), cal, date)
```

and replace

```ts
        const off = schedule !== "deadlines" && info && ["off", "break", "exams"].includes(info.kind) ? (slots.get(d.getDay()) || []).length : 0
```

with

```ts
        const off = schedule !== "deadlines" && info && ["off", "break", "exams"].includes(info.kind) ? runningOn(slots.get(d.getDay()), cal, date).length : 0
```

- [ ] **Step 4: Run them to see them pass**

Run: `npx vitest run src/data/views.test.ts`
Expected: PASS, the older tests too.

- [ ] **Step 5: Commit**

```bash
git add src/data/views.ts src/data/views.test.ts
git commit -m "The week and the month show a course's classes only in its semester

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Lecture reviews and exam topics respect the semester

**Files:**
- Modify: `src/core/reviews.ts` (import line 10; `Timetabled` line 22; `lectureDates` around line 66)
- Modify: `src/core/prep.ts` (`fillTopics`'s `course` parameter type)
- Test: `test/school.test.js`

- [ ] **Step 1: Write the failing test**

In `test/school.test.js`, inside `describe('a school calendar', …)`, after `'keeps lecture reviews to days with classes'`, add:

```js
  it("keeps lecture reviews to the course's semester", () => {
    const course = { id: 'w', code: 'NEURO', term: 'Winter 2027', meetings: [{ id: 'm', kind: 'Lecture', weekday: 2 }] };
    const dates = lectureDates([course], '2026-12-01', '2027-01-26', cal).map((x) => x.date);
    expect(dates).toEqual(['2027-01-19', '2027-01-26']);   /* not the Autumn Tuesdays 1 and 8 Dec */
  });
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run test/school.test.js`
Expected: FAIL, the dates start with `'2026-12-01', '2026-12-08'`.

- [ ] **Step 3: Skip the days outside the course's semester**

In `src/core/reviews.ts`, change line 10 to:

```ts
import { classWeekday, courseRunsOn } from './school.ts';
```

Change `Timetabled` (line 22) to:

```ts
type Timetabled = Pick<Course, 'id' | 'code' | 'archived' | 'meetings'> & { term?: string };
```

In `lectureDates`, replace

```ts
      if (c.archived) continue;
```

with

```ts
      if (c.archived || !courseRunsOn(cal, c.term, date)) continue;
```

In `src/core/prep.ts`, in `fillTopics`'s signature, change

```ts
course: Pick<Course, 'id' | 'code' | 'archived' | 'meetings'>,
```

to

```ts
course: Pick<Course, 'id' | 'code' | 'archived' | 'meetings'> & { term?: string },
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run test/school.test.js && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/core/reviews.ts src/core/prep.ts test/school.test.js
git commit -m "Lecture reviews and exam topics keep to the course's semester

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The calendar feed repeats a class only through its semester

**Files:**
- Modify: `worker/calendar.js` (import line 18; the courses query line 75; `schoolClasses` around line 163)
- Test: `test/school.test.js`

- [ ] **Step 1: Write the failing test**

In `test/school.test.js`, inside `describe('the calendar feed with a school calendar', …)`, after the existing test, add:

```js
  it('repeats a one-semester course through that semester only', () => {
    const ics = unfold(buildCalendar({ courses: [{ ...course, term: 'Winter 2027' }], items: [], school: cal, now: Date.UTC(2026, 8, 26) }));
    expect(ics).not.toContain('UID:class-n-m-2026-08-24@rounds');
    expect(ics).toContain('UID:class-n-m-2027-01-19@rounds');
    expect(ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20270514T235959');
  });
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run test/school.test.js`
Expected: FAIL, the Autumn event is there.

- [ ] **Step 3: Read the term and skip the other semesters**

In `worker/calendar.js`, change line 18 to:

```js
import { normalizeSchool, classWeekday, courseTerm, dayInfo, weekdayOf } from '../src/core/school.ts';
```

In the courses query (line 75), add `term` to the columns:

```js
    env.DB.prepare('SELECT id, code, name, term, archived, meetings, created_at FROM courses WHERE user_id = ? AND deleted_at IS NULL').bind(userId),
```

In `schoolClasses`, replace

```js
  for (const term of school.terms) {
    const first = onOrAfter(term.start, m.weekday), id = 'class-' + c.id + '-' + bare(m.id) + '-' + term.start;
```

with

```js
  const only = courseTerm(school, c.term);
  for (const term of school.terms) {
    if (only && term !== only) continue;
    const first = onOrAfter(term.start, m.weekday), id = 'class-' + c.id + '-' + bare(m.id) + '-' + term.start;
```

and update the comment above `schoolClasses` to begin: `/* One class meeting through each semester (only its own, for a course set to one): …`.

- [ ] **Step 4: Run it to see it pass, the feed's endpoint tests too**

Run: `npx vitest run test/school.test.js test/calendar.test.js`
Expected: PASS (`test/calendar.test.js` runs the real query against D1, so a wrong column name fails there).

- [ ] **Step 5: Commit**

```bash
git add worker/calendar.js test/school.test.js
git commit -m "The calendar feed repeats a class only through its course's semester

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The course sheet's Semester switch

**Files:**
- Modify: `src/data/course-edit.ts` (add two helpers)
- Modify: `src/components/sheet/course-sheet.tsx` (imports; the Term row, line 82–83)
- Modify: `docs/DATA-MODEL.md` (the `term` row, line 130)
- Test: `src/components/sheet/sheet.test.tsx`

- [ ] **Step 1: Let the sheet tests set a school calendar**

In `src/components/sheet/sheet.test.tsx`:
- in the `vi.hoisted` return (line 13), add `cal: null as unknown` next to `ui`:
  `return { data, listeners, put, cal: null as unknown, ui: { bg: "med", view: "week", course: "all", search: "", types: {} } }`
- change the query mock (line 25) to
  `vi.mock("@/data/query", () => ({ schoolCal: () => fake.cal, termStart: () => "2026-09-01" }))`
- add `import { normalizeSchool } from "@/core/school"` with the other imports
- in `afterEach`, add `fake.cal = null` as its first line
- after the `item` helper (line 50), add:

```tsx
const TWO_TERMS = normalizeSchool({ terms: [
    { name: "Fall 2026", start: "2026-09-08", end: "2026-12-18" },
    { name: "Winter 2027", start: "2027-01-11", end: "2027-04-23" },
] })
```

- [ ] **Step 2: Write the failing tests**

Inside `describe("the course sheet", …)`, add:

```tsx
    it("picks a semester from the school calendar, or both", async () => {
        fake.cal = TWO_TERMS
        show()
        open({ kind: "course", id: "anat" })
        const sem = screen.getByRole("group", { name: "Semester" })
        expect(within(sem).getByRole("button", { name: "Both semesters" }).getAttribute("aria-pressed")).toBe("true")
        expect(screen.getByText("Classes run in every semester.")).toBeTruthy()
        fireEvent.click(within(sem).getByRole("button", { name: "Winter 2027" }))
        expect(screen.getByText("Classes run 11 Jan – 23 Apr.")).toBeTruthy()
        await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save course" })))
        expect(fake.data.courses[0]).toMatchObject({ term: "Winter 2027" })
    })

    it("keeps the free-text term without a school calendar", () => {
        show()
        open({ kind: "course", id: "anat" })
        expect(screen.getByRole("textbox", { name: "Term" })).toBeTruthy()
        expect(screen.queryByRole("group", { name: "Semester" })).toBeNull()
    })
```

- [ ] **Step 3: Run them to see them fail**

Run: `npx vitest run src/components/sheet/sheet.test.tsx`
Expected: the first FAILS (no group "Semester"); the second passes already.

- [ ] **Step 4: Add the helpers**

In `src/data/course-edit.ts`, add the imports

```ts
import { courseTerm, type SchoolCalendar } from "@/core/school"
import { dayMonth } from "@/core/dates"
```

(merge with an existing `@/core/dates` import if there is one), and at the end of the file:

```ts
/** The course sheet's semester choices: each semester of the calendar, then all year ('' is stored). */
export const semesterOptions = (cal: SchoolCalendar): [string, string][] =>
    [...cal.terms.map((t): [string, string] => [t.name, t.name]), ["", cal.terms.length === 2 ? "Both semesters" : "All year"]]

/** What the semester picked means for the classes: "Classes run 8 Sep – 18 Dec." */
export function semesterNote(cal: SchoolCalendar, term: string): string {
    const t = courseTerm(cal, term)
    return t ? "Classes run " + dayMonth(t.start) + " – " + dayMonth(t.end) + "." : "Classes run in every semester."
}
```

- [ ] **Step 5: Show the switch when there is a school calendar**

In `src/components/sheet/course-sheet.tsx`:
- add `semesterNote, semesterOptions` to the `@/data/course-edit` import;
- add `import { schoolCal } from "@/data/query"` and `import { courseTerm } from "@/core/school"`;
- add `Segmented` to the `./fields` import list;
- in `CourseSheet`, after `const changed = …`, add `const cal = schoolCal()`;
- replace the two Term lines

```tsx
                    <Label htmlFor={f + "term"}>Term</Label>
                    <TextInput id={f + "term"} value={draft.term || ""} maxLength={40} placeholder="2026 Autumn" onChange={(e) => edit({ term: e.target.value })} />
```

with

```tsx
                    {cal ? <>
                        <Label htmlFor={f + "term"}>Semester</Label>
                        <Segmented id={f + "term"} label="Semester" value={courseTerm(cal, draft.term)?.name ?? ""} options={semesterOptions(cal)} onChange={(term) => edit({ term })} />
                        <span className="col-start-2"><Note>{semesterNote(cal, draft.term || "")}</Note></span>
                    </> : <>
                        <Label htmlFor={f + "term"}>Term</Label>
                        <TextInput id={f + "term"} value={draft.term || ""} maxLength={40} placeholder="2026 Autumn" onChange={(e) => edit({ term: e.target.value })} />
                    </>}
```

- [ ] **Step 6: Say what the column means now**

In `docs/DATA-MODEL.md`, replace the `term` row (line 130)

```
| `term` | text | ≤ 40 | `2026 Autumn`. Used later for archiving. |
```

with

```
| `term` | text | ≤ 40 | The school calendar semester the course runs in, by name (`Winter 2027`); its classes show only between that semester's first and last day. `''`, or a name no semester has, means all year. |
```

- [ ] **Step 7: Run the tests to see them pass**

Run: `npx vitest run src/components/sheet/sheet.test.tsx && npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/data/course-edit.ts src/components/sheet/course-sheet.tsx src/components/sheet/sheet.test.tsx docs/DATA-MODEL.md
git commit -m "The course sheet picks a semester of the school calendar, or both

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The sidebar's semester select

**Files:**
- Modify: `src/data/types.ts` (`Ui`, line 40), `src/data/ui.ts` (the `ui` object), `src/data/actions.ts` (`setSem`), `src/components/sidebar.tsx` (`CourseList`)
- Test: `src/components/sidebar.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `src/components/sidebar.test.tsx`:
- add `beforeAll, afterAll` to the vitest import;
- in the hoisted `ui`, add `sem: null as string | null`;
- in the top `beforeEach`, add `fake.ui.sem = null`;
- after `describe("the courses", …)`, add:

```tsx
describe("the semester select", () => {
    const TERMS = [{ name: "Fall 2026", start: "2026-09-08", end: "2026-12-18" }, { name: "Winter 2027", start: "2027-01-11", end: "2027-04-23" }]
    beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 8, 23, 12)) })
    afterAll(() => { vi.useRealTimers() })
    beforeEach(() => {
        fake.data.profile = { ...(fake.data.profile as object), schoolCalendar: { name: "", terms: TERMS, days: [] } }
        fake.data.courses = [
            { id: "f", name: "Fall course", color: "#C2571A", archived: false, term: "Fall 2026", meetings: [] },
            { id: "w", name: "Winter course", color: "#1E628F", archived: false, term: "Winter 2027", meetings: [] },
            { id: "b", name: "Year course", color: "#3F7A2E", archived: false, term: "", meetings: [] },
        ]
    })

    it("lists the current semester's courses and the all-year ones, marked Both", () => {
        render(<Sidebar />)
        expect((coursesNav().getByRole("combobox", { name: "Semester" }) as HTMLSelectElement).value).toBe("Fall 2026")
        expect(coursesNav().getByRole("button", { name: /^Fall course/ })).toBeTruthy()
        expect(coursesNav().queryByRole("button", { name: /^Winter course/ })).toBeNull()
        expect(coursesNav().getByRole("button", { name: /^Year course/ }).textContent).toContain("Both")
        expect(coursesNav().getByRole("button", { name: /^Fall course/ }).textContent).not.toContain("Both")
    })

    it("switches semester; a course picked outside it goes back to All courses", () => {
        fake.ui.course = "f"
        render(<Sidebar />)
        fireEvent.change(coursesNav().getByRole("combobox", { name: "Semester" }), { target: { value: "Winter 2027" } })
        expect(fake.ui.sem).toBe("Winter 2027")
        expect(fake.ui.course).toBe("all")
        expect(coursesNav().getByRole("button", { name: /^Winter course/ })).toBeTruthy()
        expect(coursesNav().queryByRole("button", { name: /^Fall course/ })).toBeNull()
    })

    it("is not there with one semester", () => {
        fake.data.profile = { ...(fake.data.profile as object), schoolCalendar: { name: "", terms: TERMS.slice(0, 1), days: [] } }
        render(<Sidebar />)
        expect(coursesNav().queryByRole("combobox", { name: "Semester" })).toBeNull()
        expect(coursesNav().queryByText("Both")).toBeNull()
    })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/components/sidebar.test.tsx`
Expected: the three new tests FAIL (no combobox "Semester").

- [ ] **Step 3: Add `ui.sem`**

In `src/data/types.ts`, inside `interface Ui`, after `course: string`, add:

```ts
    /* the sidebar's semester: a school calendar semester's name, or null for the current one */
    sem: string | null
```

In `src/data/ui.ts`, in the `ui` object after `course: "all",` on the first line, add a line:

```ts
    sem: null,               /* the sidebar's semester; null follows the current one */
```

- [ ] **Step 4: Add `setSem`**

In `src/data/actions.ts`:
- change `import { typeOn } from "@/data/query"` to `import { schoolCal, typeOn } from "@/data/query"`;
- add `import { inTerm, pickedTerm } from "@/core/school"`;
- after `setCourse`, add:

```ts
/** The sidebar's semester. A course picked that is not in it goes back to All courses. */
export function setSem(name: string) {
    ui.sem = name
    const cal = schoolCal(), term = pickedTerm(cal, name, today())
    const c = ui.course === "all" ? null : (data.courses as Course[]).find((x) => x.id === ui.course)
    if (c && !inTerm(cal, c.term, term)) { ui.course = "all"; ui.listFrom = null }
    notify()
}
```

- [ ] **Step 5: Draw the select and filter the list**

In `src/components/sidebar.tsx`:
- change the actions import to `import { openCourse, setCourse, setSem } from "@/data/actions"`;
- add:

```tsx
import { today } from "@/core/dates"
import { courseTerm, inTerm, pickedTerm, type SchoolCalendar } from "@/core/school"
import { schoolCal } from "@/data/query"
import { headingButton } from "./sidebar-parts"
import { cn } from "@/lib/utils"
```

(merge `headingButton` into the existing `./sidebar-parts` import instead of a second line);
- in `CourseList`, replace the first line

```tsx
    const courses = useCourses().filter((c) => !c.archived)       // legacy activeCourses()
```

with

```tsx
    const cal = schoolCal()
    const sem = useUi((ui) => ui.sem)
    const term = pickedTerm(cal, sem, today())
    /* the select shows with two semesters or more; a course goes under its own or every one */
    const picker = !!cal && cal.terms.length > 1
    const courses = useCourses().filter((c) => !c.archived && inTerm(cal, c.term, picker ? term : null))
    const yearTag = cal && cal.terms.length === 2 ? "Both" : "All year"
```

- replace `<Heading>Courses</Heading>` with

```tsx
            <Heading action={picker && term ? <SemesterSelect cal={cal!} value={term.name} /> : undefined}>Courses</Heading>
```

- inside each course row, between `<span className="min-w-0 truncate">{c.name}</span>` and `<Count n={n[c.id] || 0} />`, add:

```tsx
                            {picker && !courseTerm(cal, c.term) && <span className="shrink-0 text-[11px] text-muted-foreground">{yearTag}</span>}
```

- after `CourseList`, add:

```tsx
/** Which semester's courses the list shows. */
function SemesterSelect({ cal, value }: { cal: SchoolCalendar; value: string }) {
    return (
        <select aria-label="Semester" value={value} onChange={(e) => setSem(e.target.value)} className={cn(headingButton, "cursor-pointer font-medium text-foreground")}>
            {cal.terms.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
        </select>
    )
}
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `npx vitest run src/components/sidebar.test.tsx src/data/ui.test.ts && npm run typecheck`
Expected: PASS. If `ui.test.ts` lists the `ui` object's keys, add `sem: null` there.

- [ ] **Step 7: Commit**

```bash
git add src/data/types.ts src/data/ui.ts src/data/actions.ts src/components/sidebar.tsx src/components/sidebar.test.tsx src/data/ui.test.ts
git commit -m "The sidebar picks a semester and lists its courses, all-year ones marked Both

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Repeat in the item card: labs too, Just once / Every week, until a semester's end

**Files:**
- Modify: `src/data/item-edit.ts` (`deriveEdit`; add `REPEATS`, `REPEAT_CHOICES`, `untilLabel`)
- Modify: `src/components/sheet/item-sheet.tsx` (the `set` helper line 60; the repeat rows lines 158–169)
- Test: `src/data/item-edit.test.ts`, `src/components/sheet/sheet.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `src/data/item-edit.test.ts`, add `import { normalizeSchool } from "@/core/school"` and, after the test that checks `"recur", true` (around line 52), a new test:

```ts
    it("repeats until the end of the item's semester by default", () => {
        const cal = normalizeSchool({ terms: [
            { name: "Fall 2026", start: "2026-09-08", end: "2026-12-18" },
            { name: "Winter 2027", start: "2027-01-11", end: "2027-04-23" },
        ] })
        expect(deriveEdit(item({}), "recur", true, courseOf, cal)).toMatchObject({ recur: "weekly", weekday: 3, recurUntil: "2026-12-18" })
        expect(deriveEdit(item({ recurUntil: "2026-11-01" }), "recur", true, courseOf, cal).recurUntil).toBe("2026-11-01")
        expect(deriveEdit(item({}), "recur", true, courseOf).recurUntil).toBeNull()
    })
```

In `src/components/sheet/sheet.test.tsx` (Task 5 added `fake.cal` and `TWO_TERMS`), inside `describe("the item sheet", …)`, add:

```tsx
    it("repeats a lab every week until the end of its semester, or later", async () => {
        fake.cal = TWO_TERMS
        fake.data.items = [item({ id: "l1", type: "lab", title: "Histology lab" })]
        show()
        open({ kind: "item", id: "l1" })
        const rep = screen.getByRole("group", { name: "Repeat" })
        expect(within(rep).getByRole("button", { name: "Just once" }).getAttribute("aria-pressed")).toBe("true")
        await act(async () => fireEvent.click(within(rep).getByRole("button", { name: "Every week" })))
        expect(fake.data.items[0]).toMatchObject({ recur: "weekly", weekday: 3, recurUntil: "2026-12-18" })
        const until = screen.getByRole("combobox", { name: "Until" }) as HTMLSelectElement
        expect(Array.from(until.options).map((o) => o.text)).toEqual(["the end of Fall 2026 · 18 Dec", "the end of Winter 2027 · 23 Apr", "no end"])
        await act(async () => fireEvent.change(until, { target: { value: "2027-04-23" } }))
        expect(fake.data.items[0]).toMatchObject({ recurUntil: "2027-04-23" })
        await act(async () => fireEvent.click(within(rep).getByRole("button", { name: "Just once" })))
        expect(fake.data.items[0]).toMatchObject({ recur: null, weekday: null, recurUntil: null })
    })

    it("offers no repeat on an assignment", () => {
        show()
        open({ kind: "item", id: "i1" })
        expect(screen.queryByRole("group", { name: "Repeat" })).toBeNull()
    })
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/data/item-edit.test.ts src/components/sheet/sheet.test.tsx`
Expected: the item-edit test FAILS (`recurUntil` null); the lab test FAILS (no group "Repeat"); "offers no repeat" passes already.

- [ ] **Step 3: Default the end and add the shared bits**

In `src/data/item-edit.ts`:
- change the dates import to `import { dayMonth, diffDays, parse, today, DOW } from "@/core/dates"`;
- add `import { repeatEnds, type SchoolCalendar, type Term } from "@/core/school"`;
- before `deriveEdit`, add:

```ts
/** The types whose card offers Repeat. */
export const REPEATS = ["office", "tutoring", "lab"]
export const REPEAT_CHOICES = [["once", "Just once"], ["weekly", "Every week"]] as const

/** "the end of Fall 2026 · 18 Dec", or "the end of the school year · 22 Dec". */
export const untilLabel = (x: { end: string; term: Term | null }) =>
    "the end of " + (x.term ? x.term.name : "the school year") + " · " + dayMonth(x.end)
```

- give `deriveEdit` a fifth parameter and use it for the end. Its signature becomes:

```ts
export function deriveEdit(it: Item, field: ItemField, value: unknown, courseOf: (id: string | null) => Course | null, cal: SchoolCalendar | null = null): Partial<Item> {
```

and its `recur` branch becomes:

```ts
    if (field === "recur") {
        const on = !!value
        /* switched on, it repeats until the end of the item's semester unless an end was set */
        const until = it.recurUntil || repeatEnds(cal, it.date)[0]?.end || null
        Object.assign(patch, { recur: on ? "weekly" : null, weekday: on ? parse(it.date).getDay() : null, recurUntil: on ? until : null })
```

- add to the doc comment above `deriveEdit`: `a weekly item ends with its semester by default;`.

- [ ] **Step 4: Draw Repeat and Until**

In `src/components/sheet/item-sheet.tsx`:
- add `REPEATS, REPEAT_CHOICES, untilLabel` to the `@/data/item-edit` import;
- add `import { repeatEnds } from "@/core/school"`;
- add `shortDate` to the `@/core/dates` import;
- after `const c = courseOf(it.courseId)`, add:

```tsx
    const cal = schoolCal()
    const ends = repeatEnds(cal, it.date)
```

- in `set`, pass the calendar: `const patch = deriveEdit(it, field, value, courseOf, cal)`;
- replace the block that starts `{(it.type === "office" || it.type === "tutoring") && <>` and its `Repeats` and `Until` rows, up to (not including) `{it.type === "office" && <>`, with:

```tsx
                    {REPEATS.includes(it.type) && <>
                        <Label htmlFor={f + "recur"}>Repeat</Label>
                        <Segmented id={f + "recur"} label="Repeat" value={it.recur === "weekly" ? "weekly" : "once"} options={REPEAT_CHOICES} onChange={(v) => set("recur", v === "weekly")} />
                        {it.recur === "weekly" && <>
                            <Label htmlFor={f + "until"}>Until</Label>
                            {ends.length
                                ? <Select id={f + "until"} value={it.recurUntil ?? ""} onChange={(e) => set("recurUntil", e.target.value)}>
                                    {ends.map((x) => <option key={x.end} value={x.end}>{untilLabel(x)}</option>)}
                                    {it.recurUntil && !ends.some((x) => x.end === it.recurUntil) && <option value={it.recurUntil}>{shortDate(it.recurUntil)}</option>}
                                    <option value="">no end</option>
                                </Select>
                                : <DateInput id={f + "until"} value={it.recurUntil ?? ""} onChange={(e) => set("recurUntil", e.target.value)} />}
                        </>}
```

Leave the `{it.type === "office" && <> … Dept … </>}` block and the closing `</>}` after it as they are. If `DOW` and the `weekday` constant are no longer used in the file, remove them (`rg -n "DOW|weekday" src/components/sheet/item-sheet.tsx`).

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx vitest run src/data/item-edit.test.ts src/components/sheet/sheet.test.tsx && npm run typecheck`
Expected: PASS. If a test still looks for "Repeats" or "every week on", it was the old checkbox: update it to the group "Repeat".

- [ ] **Step 6: Commit**

```bash
git add src/data/item-edit.ts src/data/item-edit.test.ts src/components/sheet/item-sheet.tsx src/components/sheet/sheet.test.tsx
git commit -m "Labs repeat too: Just once or Every week, until the end of a semester or the year

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: All checks and a browser pass

**Files:** none unless the pass finds something.

- [ ] **Step 1: Run every check**

Run: `npm run check`
Expected: typecheck clean, every test passes, the build passes its CSP checks.

- [ ] **Step 2: Browser pass on the dev server**

Start `npm run dev` (see "How to work", 2) and sign in as `termqa`. Then:
1. Settings → School calendar: set two semesters, Fall 2026 (8 Sep – 18 Dec) and Winter 2027 (11 Jan – 23 Apr), if the local profile has none.
2. Open a course (✎): the Term row is now **Semester** with Fall 2026 · Winter 2027 · Both semesters and the "Classes run …" note. Pick Winter 2027 and save.
3. Week view this week: that course's classes are gone. Go forward to the week of 11 Jan 2027: they are there. The month view agrees.
4. Sidebar: the Courses heading has the semester select on Fall 2026; the Winter course is not listed and all-year courses say "Both". Pick Winter 2027: the list changes; with that course selected first, the selection goes back to All courses when you switch to Fall.
5. New item → Lab: Repeat shows Just once / Every week; Every week sets Until to "the end of Fall 2026 · 18 Dec" and offers Winter and "no end". The lab shows every week in the week view until 18 Dec.
6. Dark mode and a phone width (≤ 900px, the sidebar slides over): the select and the switch read and fit.
7. Remove the school calendar in Settings: the course sheet shows the plain Term text box again, the sidebar has no select, and every class shows all year.

- [ ] **Step 3: Fix and commit what the pass finds**

Each fix gets a test where it can, then:

```bash
git add <files>
git commit -m "<what was fixed>

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Release (each remote step needs the owner's yes)

**Files:** none.

- [ ] **Step 1: Show the owner and ask**

Tell the owner what changed (the "What the owner sees" paragraph) and ask whether to release. This stage has **no database step**: confirm with `git diff main --stat -- migrations` (expect no output).

- [ ] **Step 2: Merge (on the owner's yes)**

```bash
git switch term
git merge --no-ff term-3-semesters -m "Merge term-3-semesters: Stage 3, semesters and repeats

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git switch main
git merge --no-ff term -m "Merge term: Stage 3, semesters and repeats

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
npm run check
```

- [ ] **Step 3: Push (on the owner's yes)**

Run: `git push origin main`
The Cloudflare Git build deploys it. Check with `npx wrangler deployments list` that a new version appeared, and that `https://rounds.termanitor07.workers.dev/` returns 200.
