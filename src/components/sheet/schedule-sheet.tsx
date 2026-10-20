// The class schedule preview (spec §10): each course the timetable has, the course of yours it
// goes to (or a new one), whether its classes replace that course's, its semester (with a
// school calendar), and a row per class with a tick and its kind, day, times and room, all
// there to fix what the AI got wrong before "Add N classes" writes them.

import { useState } from "react"
import { cn } from "@/lib/utils"
import { DOW, dayMonth } from "@/core/dates"
import { data } from "@/core/store"
import { KINDS } from "@/core/model"
import { remapCourse, type PlanCourse, type PlanMeeting } from "@/core/importers/plan"
import type { SchoolCalendar } from "@/core/school"
import { schoolCal } from "@/data/query"
import { semesterOptions, semesterPicked } from "@/data/course-edit"
import { commitSchedule, plural, scheduleCount, semesterChanges } from "@/data/schedule-edit"
import { closeSheet, openSheet } from "@/data/overlay"
import type { ImportPlan } from "@/data/import-edit"
import { accent } from "@/components/views/bits"
import { Button, QUIET, Segmented, Select, SheetBody, SheetFoot, SheetHead, TextInput, Warning } from "./fields"
import { TimeField } from "./time-field"

/** "Fall 2026: 8 Sep – 18 Dec · Winter 2027: 11 Jan – 23 Apr · Both semesters: all year." */
const semesterLine = (cal: SchoolCalendar) =>
    [...cal.terms.map((t) => t.name + ": " + dayMonth(t.start) + " – " + dayMonth(t.end)), (cal.terms.length === 2 ? "Both semesters" : "All year") + ": all year"].join(" · ") + "."

export function ScheduleSheet({ plan: initial, name }: { plan: ImportPlan; name: string }) {
    /* the plan is changed in place by the ticks, the fixes and the semesters (`v` redraws); a course
       put on another of yours is a new plan */
    const [plan, setPlan] = useState(initial)
    const mine = (data.courses as { id: string; code: string; name: string; archived?: boolean }[]).filter((x) => !x.archived)
    const goTo = (i: number, id: string) => setPlan(remapCourse(plan, i, id || null, data) as ImportPlan)
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
                {plan.courses.map((c, i) => (
                    <section key={i} aria-label={(c.read ? c.read.code + " · " + c.read.name : c.code + " · " + c.name)} className="flex flex-col gap-1.5 rounded-[10px] border border-border px-3.5 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                            <i aria-hidden="true" style={accent(c.color)} className="size-2.5 flex-none rounded-[3px] bg-[var(--c,var(--ink-3))]" />
                            <span className="min-w-0 text-[14px] font-semibold text-foreground">{c.read ? c.read.code + " · " + c.read.name : c.code + " · " + c.name}</span>
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
                        <label className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-2">
                            <span>Goes to</span>
                            <Select aria-label={"Course for " + (c.read?.code ?? c.code)} value={c.isNew ? "" : c.id} onChange={(e) => goTo(i, e.target.value)} className="h-8 w-auto min-w-0 max-w-[260px] py-0 text-[13px]">
                                <option value="">New course{c.isNew ? " · " + c.code : ""}</option>
                                {mine.map((x) => <option key={x.id} value={x.id}>{x.code} · {x.name}</option>)}
                            </Select>
                        </label>
                        {!c.isNew && (c.had?.length ?? 0) > 0 && c.replace !== undefined && <Replace course={c} redraw={redraw} />}
                        {onBoard(c) && <span className="text-[12px] text-muted-foreground">Its classes are already on your board.</span>}
                        {c.meetings.map((m) => <ClassRow key={m.id} code={c.code} m={m} redraw={redraw} />)}
                    </section>
                ))}
                <span className="text-[12px] leading-normal text-muted-foreground">
                    {cal ? semesterLine(cal) + " " : ""}Fix anything the AI read wrong before you add it. Classes already on your board aren’t added twice.
                </span>
            </SheetBody>
            <SheetFoot hint="Nothing is saved until you add them">
                <Button variant="ghost" onClick={again}>Another file</Button>
                <Button disabled={!(n || terms) || busy} onClick={() => void add()}>{n || !terms ? "Add " + plural(n, "class", "classes") : "Save semesters"}</Button>
            </SheetFoot>
        </>
    )
}

/** A course of yours that already has every class the timetable gives it (as they read now). */
const onBoard = (c: PlanCourse) => !c.isNew && c.meetings.every((m) => (c.had || c.existing || []).some((h) => h.weekday === m.weekday && h.start === m.start && h.end === m.end))

/** Whether the ticked classes replace the course's own, and which of its classes would go. */
function Replace({ course: c, redraw }: { course: PlanCourse; redraw: () => void }) {
    const had = c.had || []
    return (
        <div className="flex flex-col gap-1 rounded-md bg-muted px-2.5 py-2 text-[12.5px]">
            <label className="flex cursor-pointer items-center gap-2 text-foreground">
                <input type="checkbox" checked={!!c.replace} onChange={(e) => { c.replace = e.target.checked; redraw() }} className="m-0 size-[15px] accent-[var(--accent)]" />
                Replace its {plural(had.length, "class", "classes")} with these
            </label>
            <span className={cn("leading-normal text-ink-2", c.replace && "line-through")} aria-label={c.replace ? "Classes that go" : "Classes it keeps"}>
                {had.map((m) => m.kind + " " + DOW[m.weekday] + " " + m.start + "–" + m.end).join(" · ")}
            </span>
        </div>
    )
}

/* the weekdays a class can be on, Monday first */
const WEEK = [1, 2, 3, 4, 5, 6, 0]

/** One class: its tick, then its kind, day, start, end and room, each one fixable. */
function ClassRow({ code, m, redraw }: { code: string; m: PlanMeeting; redraw: () => void }) {
    const what = code + " " + m.kind + " " + DOW[m.weekday] + " " + m.start
    const set = (patch: Partial<PlanMeeting>) => { Object.assign(m, patch); redraw() }
    return (
        <div role="group" aria-label={what} className={cn(ROW, !m.include && "opacity-50")}>
            <input type="checkbox" checked={m.include} aria-label={"Add " + what}
                onChange={(e) => set({ include: e.target.checked })} className="m-0 size-[15px] accent-[var(--accent)]" />
            <Select aria-label={"Kind of " + what} value={m.kind} onChange={(e) => set({ kind: e.target.value })} className={cn(QUIET, "h-8 px-1.5 py-0 text-[13px]")}>
                {KINDS.map((k) => <option key={k}>{k}</option>)}
            </Select>
            <Select aria-label={"Day of " + what} value={m.weekday} onChange={(e) => set({ weekday: Number(e.target.value) })} className={cn(QUIET, "h-8 px-1.5 py-0 text-[13px]")}>
                {WEEK.map((d) => <option key={d} value={d}>{DOW[d]}</option>)}
            </Select>
            <span className="flex items-center gap-1">
                <TimeField label={"Start of " + what} value={m.start} onChange={(start) => set({ start, end: m.end && m.end <= start ? "" : m.end })} className={cn(QUIET, "h-8 w-[62px] px-1 text-[12.5px]")} />
                <span aria-hidden="true" className="text-ink-3">–</span>
                <TimeField label={"End of " + what} value={m.end} onChange={(end) => set({ end })} className={cn(QUIET, "h-8 w-[62px] px-1 text-[12.5px]")} />
            </span>
            <TextInput aria-label={"Room of " + what} value={m.room} maxLength={40} onChange={(e) => set({ room: e.target.value })} placeholder="Room" className={cn(QUIET, "h-8 min-w-0 px-1.5 py-0 text-[13px]")} />
        </div>
    )
}

/* tick · kind · day · times · room; at phone width the room goes under the rest */
const ROW = "grid min-h-9 grid-cols-[18px_96px_64px_auto_minmax(0,1fr)] items-center gap-1.5 rounded-md px-1 text-[13px] text-foreground hover:bg-muted max-[520px]:grid-cols-[18px_minmax(0,1fr)_64px_auto] max-[520px]:[&>input:last-child]:col-start-2 max-[520px]:[&>input:last-child]:col-span-3"
