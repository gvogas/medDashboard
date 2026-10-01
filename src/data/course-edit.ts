// Editing a course. Unlike an item, a course is a draft until Save: its classes are
// entered together, and a half-edited timetable should not reach the board. From legacy
// views/drawer-course.js.

import { HEXES, normalizeCourse, uid } from "@/core/model"
import { courseTerm, type SchoolCalendar } from "@/core/school"
import { dayMonth } from "@/core/dates"
import type { Course, Meeting } from "./types"

export const MAX_CLASSES = 12

/** A new course's draft, in the next colour along. */
export const newCourse = (count: number): Course =>
    normalizeCourse({ id: uid(), code: "", name: "", color: HEXES[count % HEXES.length], instructor: "", meetings: [] }) as Course

/** A class to add: a lecture, Monday 0900–1000. */
export const newClass = (): Meeting => ({ id: uid(), kind: "Lecture", weekday: 1, start: "09:00", end: "10:00", room: "" })

/** The draft holds edits not yet saved: it differs from the stored course, or, new, has anything in it. */
export function courseChanged(draft: Course, stored: Course | null): boolean {
    if (!stored) return !!(draft.name.trim() || draft.code.trim() || (draft.instructor || "").trim() || (draft.meetings || []).length)
    return JSON.stringify(normalizeCourse(draft)) !== JSON.stringify(normalizeCourse(stored))
}

/** The course as it is saved: a missing code becomes the name's first four letters. */
export const forSaving = (draft: Course): Course =>
    ({ ...draft, code: draft.code.trim() || draft.name.trim().slice(0, 4).toUpperCase() })

/** The course sheet's semester choices: each semester of the calendar, then all year ('' is stored). */
export const semesterOptions = (cal: SchoolCalendar): [string, string][] =>
    [...cal.terms.map((t): [string, string] => [t.name, t.name]), ["", cal.terms.length === 2 ? "Both semesters" : "All year"]]

/** What the semester picked means for the classes: "Classes run 8 Sep – 18 Dec." */
export function semesterNote(cal: SchoolCalendar, term: string): string {
    const t = courseTerm(cal, term)
    return t ? "Classes run " + dayMonth(t.start) + " – " + dayMonth(t.end) + "." : "Classes run in every semester."
}
