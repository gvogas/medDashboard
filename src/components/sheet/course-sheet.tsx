// A course in the sheet: its name and code, teacher, term, colour, its weekly classes,
// and for a course with weighted items, the grades so far and what the rest needs. It is
// a draft until Save; leaving with changes asks first.
// Opened with a class's key (from the class sheet's Edit class details), it edits the
// class's shared facts for everyone: no grades, archive or delete, which are each member's;
// its credits and grade categories are the class's, and set here.

import { useEffect, useId, useMemo, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { colourName, KINDS, PALETTE } from "@/core/model"
import { dur, DOW } from "@/core/dates"
import * as store from "@/core/store"
import { useCourses, useItems, useSharedCourses } from "@/data/store"
import { courseKeyOf, type EffectiveCourse } from "@/data/effective"
import { isSharedKey, splitKey } from "@/data/refs"
import type { Row } from "@/core/db"
import { closeSheet, onRequestClose } from "@/data/overlay"
import { courseChanged, forSaving, MAX_CLASSES, newClass, newCourse, semesterNote, semesterOptions, semesterPicked } from "@/data/course-edit"
import { schoolCal } from "@/data/query"
import { deleteCourse } from "@/data/actions"
import { accent } from "@/components/views/bits"
import type { Course, Meeting } from "@/data/types"
import {
    Button, Checkbox, Fields, Label, Note, RemoveButton, Section, Segmented, SheetBody, SheetFoot, SheetHead, Swatches,
    TextInput, TitleArea, Warning, CONTROL,
} from "./fields"
import { TimeField } from "./time-field"
import { Grades } from "./grades"
import { GradeSetup } from "./grade-setup"
import { ShareCourse } from "./share-course"

const WEEK = [1, 2, 3, 4, 5, 6, 0]

export function CourseSheet({ id }: { id: string | null }) {
    const courses = useCourses() as EffectiveCourse[]
    const sharedRows = useSharedCourses()
    const items = useItems()
    /* a class's course by its key: the class's own row, saved for everyone */
    const shared = id && isSharedKey(id) ? splitKey(id) : null
    const stored = shared
        ? sharedRows.find((c) => c.scope === shared.scope && c.id === shared.id) ?? null
        : id ? courses.find((c) => !c.source && c.id === id) ?? null : null
    const [draft, setDraft] = useState<Course>(() => (stored ? structuredClone(stored) : newCourse(courses.length)))
    /* a class's course that lands after the sheet opened: edit it, never a new one in its scope */
    useEffect(() => { if (shared && stored && draft.id !== stored.id) setDraft(structuredClone(stored)) }, [shared, stored, draft.id])
    const [asking, setAsking] = useState(false)
    /* what-if scores: never saved, gone when the sheet closes */
    const [whatIf, setWhatIf] = useState<Record<string, number>>({})
    const f = useId()
    const keep = useRef<HTMLButtonElement>(null)
    const isNew = !stored
    const changed = courseChanged(draft, stored)
    const cal = schoolCal()

    /* ✕, Escape and the scrim ask before throwing changes away; asked, they discard */
    useEffect(() => {
        onRequestClose(() => { if (changed && !asking) setAsking(true); else closeSheet() })
        return () => onRequestClose(null)
    }, [changed, asking])

    /* asked, the keyboard goes to Keep editing */
    useEffect(() => { if (asking) keep.current?.focus() }, [asking])

    const edit = (change: Partial<Course>) => { setDraft((d) => ({ ...d, ...change })); setAsking(false) }
    const editClass = (mid: string, change: Partial<Meeting>) => edit({ meetings: draft.meetings.map((m) => (m.id === mid ? { ...m, ...change } : m)) })
    const save = async () => {
        if (!draft.name.trim()) return
        if (shared) await store.saveShared("shared_courses", { ...forSaving(draft), scope: shared.scope, target: null, archived: false } as unknown as Row & { scope: string })
        else await store.saveCourse(forSaving(draft))
        closeSheet()
    }

    /* by key: a class's items, whose course may have this id too, are not this course's */
    const mine = useMemo(() => items.filter((it) => courseKeyOf(it) === draft.id), [items, draft.id])
    const hours = Math.round((draft.meetings || []).reduce((s, m) => s + dur(m.start, m.end), 0) * 10) / 10

    if (shared && !stored) return (
        <>
            <SheetHead kind="Class details" onClose={closeSheet} />
            <SheetBody><Note>This class isn't on this device yet. It arrives with the next sync.</Note></SheetBody>
            <SheetFoot hint=""><Button onClick={closeSheet}>Done</Button></SheetFoot>
        </>
    )

    return (
        <>
            <SheetHead color={draft.color} kind={shared ? "Class details" : isNew ? "New course" : "Course"} onClose={() => { if (changed && !asking) setAsking(true); else closeSheet() }}>
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
                    {cal ? <>
                        <Label htmlFor={f + "term"}>Semester</Label>
                        <Segmented id={f + "term"} label="Semester" value={semesterPicked(cal, draft.term)} options={semesterOptions(cal)} onChange={(term) => edit({ term })} />
                        <span className="col-start-2"><Note>{semesterNote(cal, draft.term || "")}</Note></span>
                    </> : <>
                        <Label htmlFor={f + "term"}>Term</Label>
                        <TextInput id={f + "term"} value={draft.term || ""} maxLength={40} placeholder="2026 Autumn" onChange={(e) => edit({ term: e.target.value })} />
                    </>}
                    <Label>Colour</Label>
                    <Swatches value={draft.color} colors={PALETTE} onChange={(color) => edit({ color })} />
                    <span className="col-start-2 text-[11px] text-muted-foreground">{colourName(draft.color)}</span>
                    {!isNew && !shared && <>
                        <Label htmlFor={f + "arch"}>Archived</Label>
                        <Checkbox id={f + "arch"} checked={draft.archived} onChange={(archived) => edit({ archived })}>hidden from the sidebar, items kept</Checkbox>
                    </>}
                </Fields>
                {shared && <Note>Everyone in the class sees these; each member's colour and semester start from them. Yours are in the class's Yours.</Note>}

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

                <GradeSetup course={draft} shared={!!shared} onChange={edit} />
                {!isNew && !shared && <Grades course={draft} items={mine} whatIf={whatIf} setWhatIf={setWhatIf} onTarget={(target) => edit({ target })} />}
                {!isNew && !shared && <ShareCourse courseId={draft.id} dirty={changed} />}
                {!isNew && !shared && mine.length > 0 && (
                    <Warning>{mine.length} item{mine.length === 1 ? "" : "s"} {mine.length === 1 ? "is" : "are"} filed under this course. Deleting it leaves them without a course.</Warning>
                )}
            </SheetBody>

            {asking ? (
                <SheetFoot hint={"Discard your changes to " + (draft.name.trim() || "this course") + "?"}>
                    <Button ref={keep} variant="ghost" onClick={() => setAsking(false)}>Keep editing</Button>
                    <Button variant="danger" onClick={closeSheet}>Discard</Button>
                </SheetFoot>
            ) : (
                <SheetFoot hint={draft.name.trim() ? (isNew ? "Ready to save" : changed ? "Unsaved changes" : "No changes yet") : "Give it a name to save"}>
                    {!isNew && !shared && <Button variant="ghost" onClick={() => void deleteCourse(draft.id)}>Delete</Button>}
                    <Button variant="ghost" onClick={closeSheet}>Cancel</Button>
                    <Button disabled={!draft.name.trim()} onClick={() => void save()}>Save course</Button>
                </SheetFoot>
            )}
        </>
    )
}
