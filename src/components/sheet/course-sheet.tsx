// A course in the sheet: its name and code, teacher, term, colour, its weekly classes,
// and for a course with weighted items, the grades so far and what the rest needs. It is
// a draft until Save; leaving with changes asks first.

import { useEffect, useId, useMemo, useState } from "react"
import { cn } from "@/lib/utils"
import { colourName, KINDS, PALETTE } from "@/legacy/js/model.js"
import { dur, DOW } from "@/legacy/js/dates.js"
import * as store from "@/legacy/js/store.js"
import { courseGrade, neededLabel, targetsFor, ungraded } from "@/legacy/js/grades.js"
import { useCourses, useItems } from "@/data/store"
import { closeSheet, onRequestClose } from "@/data/overlay"
import { courseChanged, forSaving, MAX_CLASSES, newClass, newCourse } from "@/data/course-edit"
import { deleteCourse } from "@/data/actions"
import { accent } from "@/components/views/bits"
import type { Course, Item, Meeting } from "@/data/types"
import {
    Button, Checkbox, Fields, Label, Meter, Note, NumberInput, RemoveButton, Section, SheetBody, SheetFoot, SheetHead, Swatches,
    TextInput, TitleArea, Warning, CONTROL,
} from "./fields"
import { TimeField } from "./time-field"

const WEEK = [1, 2, 3, 4, 5, 6, 0]

export function CourseSheet({ id }: { id: string | null }) {
    const courses = useCourses()
    const items = useItems()
    const stored = id ? courses.find((c) => c.id === id) ?? null : null
    const [draft, setDraft] = useState<Course>(() => (stored ? structuredClone(stored) : newCourse(courses.length)))
    const [asking, setAsking] = useState(false)
    /* what-if scores: never saved, gone when the sheet closes */
    const [whatIf, setWhatIf] = useState<Record<string, number>>({})
    const f = useId()
    const isNew = !stored
    const changed = courseChanged(draft, stored)

    /* ✕, Escape and the scrim ask before throwing changes away; asked, they discard */
    useEffect(() => {
        onRequestClose(() => { if (changed && !asking) setAsking(true); else closeSheet() })
        return () => onRequestClose(null)
    }, [changed, asking])

    const edit = (change: Partial<Course>) => { setDraft((d) => ({ ...d, ...change })); setAsking(false) }
    const editClass = (mid: string, change: Partial<Meeting>) => edit({ meetings: draft.meetings.map((m) => (m.id === mid ? { ...m, ...change } : m)) })
    const save = async () => {
        if (!draft.name.trim()) return
        await store.saveCourse(forSaving(draft))
        closeSheet()
    }

    const mine = useMemo(() => items.filter((it) => it.courseId === draft.id), [items, draft.id])
    const hours = Math.round((draft.meetings || []).reduce((s, m) => s + dur(m.start, m.end), 0) * 10) / 10

    return (
        <>
            <SheetHead color={draft.color} kind={isNew ? "New course" : "Course"} onClose={() => { if (changed && !asking) setAsking(true); else closeSheet() }}>
                <span style={accent(draft.color)} className="rounded-full bg-[color-mix(in_srgb,var(--c)_14%,var(--panel))] px-2 py-px text-[10.5px] font-semibold tracking-[.06em] text-[color-mix(in_srgb,var(--c)_80%,var(--ink))] uppercase">
                    {draft.code || "code"}
                </span>
                <span className="font-mono text-[11px] text-muted-foreground">{hours} h/week</span>
            </SheetHead>

            <SheetBody>
                <TitleArea
                    value={draft.name}
                    maxLength={80}
                    aria-label="Course name"
                    placeholder="Course name"
                    autoFocus={isNew}
                    onChange={(e) => edit({ name: e.target.value })}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void save() } }}
                />
                <Fields>
                    <Label htmlFor={f + "code"}>Code</Label>
                    <TextInput id={f + "code"} value={draft.code} maxLength={8} placeholder="CVS, ANAT…" onChange={(e) => edit({ code: e.target.value })} />
                    <Label htmlFor={f + "inst"}>Teacher</Label>
                    <TextInput id={f + "inst"} value={draft.instructor || ""} maxLength={60} placeholder="Dr. Alvarez" onChange={(e) => edit({ instructor: e.target.value })} />
                    <Label htmlFor={f + "term"}>Term</Label>
                    <TextInput id={f + "term"} value={draft.term || ""} maxLength={40} placeholder="2026 Autumn" onChange={(e) => edit({ term: e.target.value })} />
                    <Label>Colour</Label>
                    <Swatches value={draft.color} colors={PALETTE} onChange={(color) => edit({ color })} />
                    <span className="col-start-2 text-[11px] text-muted-foreground">{colourName(draft.color)}</span>
                    {!isNew && <>
                        <Label htmlFor={f + "arch"}>Archived</Label>
                        <Checkbox id={f + "arch"} checked={draft.archived} onChange={(archived) => edit({ archived })}>hidden from the sidebar, items kept</Checkbox>
                    </>}
                </Fields>

                <Section title="Classes" note="time · room">
                    {draft.meetings.length === 0 && <Note>No classes yet — add the first one below.</Note>}
                    {draft.meetings.map((m) => (
                        <div key={m.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-[9px] border border-border bg-muted p-2">
                            <div className="flex flex-wrap items-center gap-1.5">
                                <select aria-label="Kind" value={m.kind} onChange={(e) => editClass(m.id, { kind: e.target.value })} className={cn(CONTROL, "min-w-0 flex-[1_1_92px] border-border bg-card")}>
                                    {KINDS.map((k: string) => <option key={k} value={k}>{k}</option>)}
                                </select>
                                <select aria-label="Day" value={m.weekday} onChange={(e) => editClass(m.id, { weekday: +e.target.value })} className={cn(CONTROL, "w-auto flex-none border-border bg-card")}>
                                    {WEEK.map((w) => <option key={w} value={w}>{DOW[w]}</option>)}
                                </select>
                                <TimeField label="Start" value={m.start} onChange={(v) => { if (v) editClass(m.id, { start: v }) }} className="border-border bg-card" />
                                <TimeField label="End" value={m.end} onChange={(v) => { if (v) editClass(m.id, { end: v }) }} className="border-border bg-card" />
                                <input aria-label="Room" value={m.room} maxLength={40} placeholder="Room number" onChange={(e) => editClass(m.id, { room: e.target.value })}
                                    className={cn(CONTROL, "min-w-0 flex-[1_1_104px] border-border bg-card")} />
                            </div>
                            <RemoveButton aria-label="Remove class" className="self-start" onClick={() => edit({ meetings: draft.meetings.filter((x) => x.id !== m.id) })} />
                        </div>
                    ))}
                    {draft.meetings.length < MAX_CLASSES
                        ? <Button variant="ghost" className="self-start" onClick={() => edit({ meetings: [...draft.meetings, newClass()] })}>+ Add a class</Button>
                        : <Note>Twelve classes is the most a course can hold.</Note>}
                </Section>

                {!isNew && <Grades course={draft} items={mine} whatIf={whatIf} setWhatIf={setWhatIf} onTarget={(target) => edit({ target })} />}
                {!isNew && mine.length > 0 && (
                    <Warning>{mine.length} item{mine.length === 1 ? "" : "s"} {mine.length === 1 ? "is" : "are"} filed under this course. Deleting it leaves them without a course.</Warning>
                )}
            </SheetBody>

            {asking ? (
                <SheetFoot hint={"Discard your changes to " + (draft.name.trim() || "this course") + "?"}>
                    <Button variant="ghost" autoFocus onClick={() => setAsking(false)}>Keep editing</Button>
                    <Button variant="danger" onClick={closeSheet}>Discard</Button>
                </SheetFoot>
            ) : (
                <SheetFoot hint={draft.name.trim() ? (isNew ? "Ready to save" : changed ? "Unsaved changes" : "No changes yet") : "Give it a name to save"}>
                    {!isNew && <Button variant="ghost" onClick={() => void deleteCourse(draft.id)}>Delete</Button>}
                    <Button variant="ghost" onClick={closeSheet}>Cancel</Button>
                    <Button disabled={!draft.name.trim()} onClick={() => void save()}>Save course</Button>
                </SheetFoot>
            )}
        </>
    )
}

/* Weighted grade so far, how much of the course it covers, what the rest needs to reach
   50, 60, 70 or the course's own target, and what-if scores for what is still to come. */
function Grades({ course, items, whatIf, setWhatIf, onTarget }: {
    course: Course; items: Item[]; whatIf: Record<string, number>; setWhatIf: (w: Record<string, number>) => void; onTarget: (t: number | null) => void
}) {
    const f = useId()
    const real = courseGrade(items)
    if (!real.total) return null
    const open = ungraded(items).sort((a: Item, b: Item) => a.date.localeCompare(b.date)) as Item[]
    const guessed = open.some((it) => typeof whatIf[it.id] === "number")
    const g = guessed ? courseGrade(items, whatIf) : real
    const targets: number[] = targetsFor(course.target)

    return (
        <Section title="Grades" note={real.graded + " of " + real.total + "% graded"}>
            <div className="flex items-baseline gap-2">
                <b className="text-[22px] font-semibold tabular-nums text-foreground">{real.current === null ? "—" : real.current + "%"}</b>
                <span className="text-[11.5px] text-muted-foreground">current weighted average</span>
            </div>
            {guessed && (
                <div className="flex items-baseline gap-2">
                    <b className="text-[17px] font-semibold tabular-nums text-[var(--accent)]">{g.current}%</b>
                    <span className="text-[11.5px] text-muted-foreground">{g.remaining <= 0 ? "your final grade with these scores" : "with your what-if scores"}</span>
                </div>
            )}
            <Meter part={real.graded / Math.max(100, real.total)} />
            {g.remaining > 0 ? <>
                <div className="grid grid-cols-[repeat(auto-fit,minmax(64px,1fr))] gap-1.5">
                    {targets.map((t) => {
                        const label = neededLabel(g.needed(t))
                        const mine = t === course.target
                        return (
                            <span key={t} className={cn(
                                "flex flex-col gap-px rounded-lg bg-muted px-2 py-1.5 text-[12px] tabular-nums",
                                label === "secured" && "text-[var(--good)]", label === "out of reach" && "text-destructive",
                                mine && "shadow-[inset_0_0_0_1.5px_var(--accent)]",
                            )}>
                                <em className={cn("text-[10px] tracking-[.1em] not-italic", mine ? "font-bold text-[var(--accent)]" : "text-muted-foreground")}>{mine ? "Target " + t : t}</em>
                                {label}
                            </span>
                        )
                    })}
                </div>
                <Note>What you need on the {guessed ? "other " : "remaining "}{g.remaining}% to finish at {targets.slice(0, -1).join(", ")} or {targets.at(-1)}.</Note>
            </> : course.target && g.current !== null && (
                <Note tone={g.current >= course.target ? "ok" : "bad"}>{g.current >= course.target ? "At or above" : "Below"} your target of {course.target}%.</Note>
            )}
            <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                <label htmlFor={f + "target"}>Your target</label>
                <NumberInput id={f + "target"} inputMode="numeric" min={1} max={100} step={1} placeholder="e.g. 75" className="w-20"
                    value={course.target ?? ""}
                    onChange={(e) => { const n = Math.round(+e.target.value); onTarget(e.target.value.trim() !== "" && n >= 1 && n <= 100 ? n : null) }} />
                <span>% final grade</span>
            </div>
            {open.length > 0 && (
                <details open={guessed || undefined} className="text-[12.5px]">
                    <summary className="cursor-pointer font-semibold text-ink-2">What if…</summary>
                    <div className="mt-2 flex flex-col gap-1.5">
                        {open.map((it) => (
                            <label key={it.id} className="flex items-center gap-2">
                                <span className="min-w-0 flex-1 truncate">{it.title}</span>
                                <em className="text-[11px] text-muted-foreground not-italic">{it.weight}%</em>
                                <NumberInput inputMode="decimal" min={0} max={100} step="any" placeholder="score" className="w-20"
                                    aria-label={"If I get this score on " + it.title}
                                    defaultValue={whatIf[it.id] ?? ""}
                                    onChange={(e) => {
                                        const v = e.target.value.trim() === "" ? NaN : +e.target.value
                                        const next = { ...whatIf }
                                        if (Number.isFinite(v) && v >= 0 && v <= 100) next[it.id] = v; else delete next[it.id]
                                        setWhatIf(next)
                                    }} />
                            </label>
                        ))}
                    </div>
                    <Note>Scores you might get. Not saved; they clear when you close the course.</Note>
                </details>
            )}
            {real.total !== 100 && <Warning>Weights add up to {real.total}%, not 100.</Warning>}
        </Section>
    )
}
