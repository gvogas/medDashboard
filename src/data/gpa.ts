// The GPA: each course's grade so far (core/grades.ts courseGrade, with its categories and
// your marks on a class's items), read off your grading scale and weighted by credits. "This
// term" is the semester the sidebar shows, or without a school calendar the courses not
// archived; "overall" is every course with a grade.

import { courseGrade, gpa, GRADABLE, normalizeGrading } from "@/core/grades"
import { baseOf } from "@/core/model"
import { courseTerm, type SchoolCalendar, type Term } from "@/core/school"
import { courseKeyOf, keyOf, type EffectiveCourse, type EffectiveItem } from "./effective"

export interface Gpa { gpa: number; credits: number; courses: number }
export interface GpaSummary { term: Gpa | null; overall: Gpa | null }

/** Each course's grade so far, by its key. */
export function courseGrades(courses: EffectiveCourse[], items: EffectiveItem[]): Map<string, number | null> {
    const by = new Map<string, EffectiveItem[]>()
    for (const it of items) {
        const key = courseKeyOf(it)
        if (key && GRADABLE.includes(baseOf(it.type))) by.set(key, [...(by.get(key) || []), it])
    }
    return new Map(courses.map((c) => [keyOf(c), courseGrade(by.get(keyOf(c)) || [], {}, c.gradeCategories).current]))
}

/** The term's GPA and the overall one; `term` is the semester picked, null without a calendar. */
export function gpaSummary(courses: EffectiveCourse[], items: EffectiveItem[], grading: unknown, cal: SchoolCalendar | null, term: Term | null): GpaSummary {
    const { scale } = normalizeGrading(grading)
    const grades = courseGrades(courses, items)
    const rows = (list: EffectiveCourse[]) => list.map((c) => ({ credits: c.credits, percent: grades.get(keyOf(c)) ?? null }))
    const now = cal && term ? courses.filter((c) => courseTerm(cal, c.term) === term) : courses.filter((c) => !c.archived)
    return { term: gpa(rows(now), scale), overall: gpa(rows(courses), scale) }
}
