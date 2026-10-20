// The GPA under the sidebar's courses: the semester shown, and overall when it differs.
// Nothing shows until a course has a grade (data/gpa.ts).

import { useMemo } from "react"
import { today } from "@/core/dates"
import { pickedTerm } from "@/core/school"
import { useCourses, useItems, useProfile } from "@/data/store"
import { schoolCal } from "@/data/query"
import { useUi } from "@/data/ui"
import { gpaSummary } from "@/data/gpa"

const fmt = (n: number) => n.toFixed(2)

export function SidebarGpa() {
    const courses = useCourses()
    const items = useItems()
    const grading = useProfile()?.grading
    const sem = useUi((ui) => ui.sem)
    const cal = schoolCal()
    const term = pickedTerm(cal, sem, today())
    const s = useMemo(() => gpaSummary(courses, items, grading, cal, term), [courses, items, grading, cal, term])
    if (!s.overall) return null
    const label = cal && term ? term.name : "This term"
    return (
        <p className="m-0 flex flex-wrap items-baseline gap-x-2 px-2 pt-1.5 text-[11.5px] text-muted-foreground" aria-label="Grade point average">
            {s.term && <span>GPA <b className="font-semibold text-ink-2 tabular-nums">{fmt(s.term.gpa)}</b> {label}</span>}
            {(!s.term || s.term.courses !== s.overall.courses) && <span>{s.term ? "· " : "GPA "}<b className="font-semibold text-ink-2 tabular-nums">{fmt(s.overall.gpa)}</b> overall</span>}
        </p>
    )
}
