// The term recap, under History: a semester's hours (in all and per course), sessions, best
// day, longest streak, what was completed and each course's grade (core/recap.ts). The
// semesters come from the school calendar; without one it is the last 16 weeks.

import { useState, type ReactNode } from "react"
import { cn } from "@/lib/utils"
import { duration } from "@/lib/time"
import { shortDate, today } from "@/core/dates"
import { tmeta } from "@/core/model"
import { gpa, letterFor, normalizeGrading } from "@/core/grades"
import { courseByKey } from "@/data/effective"
import { projectCourse } from "@/data/projects"
import { leftSpaceLabel } from "@/data/refs"
import { schoolCal } from "@/data/query"
import { recapRanges, useRecap } from "@/data/study"
import { useProfile } from "@/data/store"
import { accent, Panel } from "@/components/views/bits"
import type { Course } from "@/data/types"

const courseOf = (id: string | null) => (id ? ((courseByKey(id) ?? projectCourse(id)) as Course | null) : null)
const courseName = (id: string | null) => (id ? courseOf(id)?.code || courseOf(id)?.name || leftSpaceLabel(id) || "A course since removed" : "No course")
const plural = (n: number, one: string, many = one + "s") => n + " " + (n === 1 ? one : many)

export function RecapCard() {
    const profile = useProfile()   /* the school calendar and the grading scale live on the profile */
    const ranges = recapRanges(schoolCal(), today())
    const [picked, setPicked] = useState<string | null>(null)
    const range = ranges.find((r) => r.id === picked) ?? ranges[ranges.length - 1]
    const r = useRecap(range.from, range.to)
    const top = r.byCourse[0]?.minutes || 1

    return (
        <Panel label="Term recap" title="Term recap" className="mt-[13px]" head={ranges.length > 1 && (
            <label className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                <span className="sr-only">Semester</span>
                <select value={range.id} onChange={(e) => setPicked(e.target.value)}
                    className="min-h-9 cursor-pointer rounded-lg border border-border bg-card px-2 font-[inherit] text-[12.5px] text-foreground">
                    {ranges.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                </select>
            </label>
        )}>
            <div className="grid gap-4 px-5 py-4">
                <p className="m-0 text-[12.5px] text-muted-foreground">{shortDate(range.from)} to {shortDate(range.to)}{range.to > today() ? ", so far" : ""}</p>
                <div className="grid grid-cols-4 gap-2 max-[700px]:grid-cols-2">
                    <Fig label="Studied" value={duration(r.minutes)} sub={plural(r.sessions, "session")} />
                    <Fig label="Days studied" value={String(r.daysStudied)} sub={r.best ? "Best: " + shortDate(r.best.date) + ", " + duration(r.best.minutes) : "No study yet"} />
                    <Fig label="Longest streak" value={plural(r.longestStreak, "day")} />
                    <Fig label="Completed" value={String(r.completedTotal)} sub={plural(r.tests, "exam or quiz", "exams and quizzes") + " taken"} />
                </div>

                {r.byCourse.length > 0 && (
                    <Part title="Study by course">
                        <ul className="m-0 grid list-none gap-1.5 p-0">
                            {r.byCourse.map((c) => (
                                <li key={c.courseId ?? "none"} style={accent(courseOf(c.courseId)?.color ?? "#9a9a9a")}
                                    className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-2.5 text-[13px]">
                                    <span className="truncate">{courseName(c.courseId)}</span>
                                    <span aria-hidden="true" className="h-2 rounded-full bg-line-2">
                                        <span className="block h-full rounded-full bg-[var(--c)]" style={{ width: Math.max(4, Math.round((c.minutes / top) * 100)) + "%" }} />
                                    </span>
                                    <span className="font-mono text-[12px] text-muted-foreground">{duration(c.minutes)}</span>
                                </li>
                            ))}
                        </ul>
                    </Part>
                )}

                {r.completed.length > 0 && (
                    <Part title="Completed">
                        <p className="m-0 text-[13px] text-ink-2">{r.completed.map((c) => c.count + " " + tmeta(c.type).label.toLowerCase()).join(" · ")}</p>
                    </Part>
                )}

                {r.grades.length > 0 && <Grades grades={r.grades} grading={profile?.grading} />}

                {!r.minutes && !r.completedTotal && <p className="m-0 text-[13px] text-muted-foreground">Nothing studied or completed in this range yet.</p>}
            </div>
        </Panel>
    )
}

/* The grade line, kept in one place: each course's weighted average so far with its letter on
   your scale, and the range's GPA weighted by credits (core/grades.ts). */
function Grades({ grades, grading }: { grades: { courseId: string; current: number | null }[]; grading: unknown }) {
    const { scale } = normalizeGrading(grading)
    const total = gpa(grades.map((g) => ({ credits: (courseOf(g.courseId) as { credits?: number | null } | null)?.credits, percent: g.current })), scale)
    return (
        <Part title={"Grades so far" + (total ? " · GPA " + total.gpa.toFixed(2) : "")}>
            <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-[13px]">
                {grades.map((g) => <li key={g.courseId}><span className="text-ink-2">{courseName(g.courseId)}</span> <b className="font-semibold">{g.current}%</b>{letterFor(g.current, scale) && <span className="text-muted-foreground"> {letterFor(g.current, scale)!.letter}</span>}</li>)}
            </ul>
        </Part>
    )
}

function Fig({ label, value, sub }: { label: string; value: string; sub?: string }) {
    return (
        <div className="min-w-0 rounded-lg border border-border bg-card px-3 py-2.5">
            <div className="text-[11.5px] text-muted-foreground">{label}</div>
            <div className="font-serif text-[22px] leading-tight">{value}</div>
            {sub && <div className="text-[11.5px] leading-snug text-muted-foreground">{sub}</div>}
        </div>
    )
}

const Part = ({ title, children, className }: { title: string; children: ReactNode; className?: string }) => (
    <section className={cn("grid gap-1.5", className)}>
        <h3 className="m-0 text-[12px] font-semibold tracking-[.03em] text-muted-foreground uppercase">{title}</h3>
        {children}
    </section>
)
