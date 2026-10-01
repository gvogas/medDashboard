// The class schedule preview (spec §10): each course the timetable has, "Matches your course"
// or "New course", its semester (with a school calendar) and a tick per class; "Add N
// classes" writes them. The planner already left out the classes a course has.

import { useState } from "react"
import { cn } from "@/lib/utils"
import { DOW, dayMonth } from "@/core/dates"
import type { SchoolCalendar } from "@/core/school"
import { schoolCal } from "@/data/query"
import { semesterOptions, semesterPicked } from "@/data/course-edit"
import { commitSchedule, plural, scheduleCount, semesterChanges } from "@/data/schedule-edit"
import { closeSheet, openSheet } from "@/data/overlay"
import type { ImportPlan } from "@/data/import-edit"
import { accent } from "@/components/views/bits"
import { Button, Segmented, SheetBody, SheetFoot, SheetHead, Warning } from "./fields"

/** "Fall 2026: 8 Sep – 18 Dec · Winter 2027: 11 Jan – 23 Apr · Both semesters: all year." */
const semesterLine = (cal: SchoolCalendar) =>
    [...cal.terms.map((t) => t.name + ": " + dayMonth(t.start) + " – " + dayMonth(t.end)), (cal.terms.length === 2 ? "Both semesters" : "All year") + ": all year"].join(" · ") + "."

export function ScheduleSheet({ plan: initial, name }: { plan: ImportPlan; name: string }) {
    /* the plan is changed in place by the ticks and the semesters; `v` redraws */
    const [plan] = useState(initial)
    const [, setV] = useState(0)
    const redraw = () => setV((n) => n + 1)
    const [busy, setBusy] = useState(false)
    const cal = schoolCal()
    const n = scheduleCount(plan)
    const found = plan.courses.reduce((k, c) => k + c.meetings.length, 0)
    const again = () => openSheet({ kind: "ai" })
    /* nothing ticked can still save a semester changed for a course of yours */
    const terms = semesterChanges(plan)
    /* on success the sheet closes, so only a failure gives the button back */
    const add = async () => { setBusy(true); if (!(await commitSchedule(plan))) setBusy(false) }

    return (
        <>
            <SheetHead kind="Read by AI" onClose={closeSheet}>
                <span className="max-w-[220px] truncate font-mono text-[11.5px] text-muted-foreground">{name}</span>
            </SheetHead>
            <SheetBody className="gap-4">
                <div className="flex flex-col gap-1">
                    <h2 className="m-0 font-serif text-[26px] leading-[1.15] font-medium text-foreground">Found {plural(plan.courses.length, "course")}</h2>
                    <span className="text-[13px] text-ink-2">
                        {found
                            ? "With " + plural(found, "new class", "new classes") + ". " + (cal ? "Set each course’s semester and untick" : "Untick") + " anything that’s wrong."
                            : "Their classes are already on your board."}
                    </span>
                </div>
                {plan.notes.length > 0 && <Warning>{plan.notes.slice(0, 6).map((t, i) => <div key={i}>{t}</div>)}</Warning>}
                {plan.courses.map((c) => (
                    <section key={c.id} aria-label={c.code + " · " + c.name} className="flex flex-col gap-1.5 rounded-[10px] border border-border px-3.5 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                            <i aria-hidden="true" style={accent(c.color)} className="size-2.5 flex-none rounded-[3px] bg-[var(--c,var(--ink-3))]" />
                            <span className="min-w-0 text-[14px] font-semibold text-foreground">{c.code} · {c.name}</span>
                            <span className={cn("inline-flex h-5 flex-none items-center rounded-full px-2 text-[11px] font-medium", c.isNew ? "bg-secondary text-accent-foreground" : "bg-muted text-ink-2")}>
                                {c.isNew ? "New course" : "Matches your course"}
                            </span>
                            {cal && (
                                <span className="ml-auto">
                                    <Segmented label={"Semester for " + c.code} value={semesterPicked(cal, c.term)} options={semesterOptions(cal)}
                                        onChange={(term) => { c.term = term; redraw() }} />
                                </span>
                            )}
                        </div>
                        {c.meetings.length === 0 && <span className="text-[12px] text-muted-foreground">Its classes are already on your board.</span>}
                        {c.meetings.map((m) => (
                            <label key={m.id} className={cn(ROW, !m.include && "opacity-50")}>
                                <input type="checkbox" checked={m.include} aria-label={"Add " + c.code + " " + m.kind + " " + DOW[m.weekday] + " " + m.start}
                                    onChange={(e) => { m.include = e.target.checked; redraw() }} className="m-0 size-[15px] accent-[var(--accent)]" />
                                <span className="truncate">{m.kind}</span>
                                <span className="text-ink-2">{DOW[m.weekday]}</span>
                                <span className="font-mono text-[12px] whitespace-nowrap">{m.start}–{m.end}</span>
                                <span className="truncate text-ink-2">{m.room}</span>
                            </label>
                        ))}
                    </section>
                ))}
                <span className="text-[12px] leading-normal text-muted-foreground">
                    {cal ? semesterLine(cal) + " " : ""}Classes already on your board aren’t added twice.
                </span>
            </SheetBody>
            <SheetFoot hint="Nothing is saved until you add them">
                <Button variant="ghost" onClick={again}>Another file</Button>
                <Button disabled={!(n || terms) || busy} onClick={() => void add()}>{n || !terms ? "Add " + plural(n, "class", "classes") : "Save semesters"}</Button>
            </SheetFoot>
        </>
    )
}

/* tick · kind · day · time · room (prototype 1330); at phone width the columns narrow and the room truncates */
const ROW = "grid min-h-9 cursor-pointer grid-cols-[18px_68px_34px_96px_minmax(0,1fr)] items-center gap-2.5 rounded-md px-1.5 text-[13px] text-foreground hover:bg-muted max-[420px]:grid-cols-[18px_60px_30px_90px_minmax(0,1fr)] max-[420px]:gap-2"
