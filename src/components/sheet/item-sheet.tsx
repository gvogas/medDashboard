// An item in the card: its title, the type as buttons, the property rows (course, date,
// time, room, status, repeat, weight…), then the checklist (topics for an exam), notes and
// links, folded until wanted. A stored item saves as it is edited (text once typing
// pauses); a new one is a draft until Save. The rules for what an edit brings along are in
// data/item-edit.ts.

import { useEffect, useId, useState } from "react"
import { cn } from "@/lib/utils"
import { baseOf, isComplete, isOpen, isTest, normalizeItem, statusesFor, tmeta, typeList } from "@/core/model"
import { shortDate, today, DOW } from "@/core/dates"
import * as store from "@/core/store"
import { repeatEnds } from "@/core/school"
import { GRADABLE } from "@/core/grades"
import { fillTopics, prepLabel, prepPace } from "@/core/prep"
import { schoolCal, termStart } from "@/data/query"
import { duration } from "@/lib/time"
import { useCourses, useItems, useStudySessions } from "@/data/store"
import { studiedFor } from "@/data/study"
import { useUi } from "@/data/ui"
import { beforeSheetClose, closeSheet, updateDraft } from "@/data/overlay"
import { busyDays, celebrate, chainReview, countdown, deriveEdit, editNow, flush, REPEAT_CHOICES, REPEATS, typeInto, untilLabel, useItemView, type ItemField } from "@/data/item-edit"
import { deleteItem, openCourse } from "@/data/actions"
import { courseByKey, keyOf } from "@/data/effective"
import { itemCourseKey, keyedItems, placeCourse } from "@/data/refs"
import { addToClass, canAddToClass } from "@/data/marks"
import { hintFor } from "@/data/next"
import { toast } from "@/data/toast"
import { accent, StatusChip } from "@/components/views/bits"
import type { Item } from "@/data/types"
import {
    AddButton, Button, Checkbox, Chips, DateInput, IconButton, NumberInput, Prop, Props, QUIET, Section, Segmented, Select,
    SheetBody, SheetFoot, SheetHead, TextArea, TextInput, TitleArea,
} from "./fields"
import { TimeField } from "./time-field"
import { DatePicker } from "./date-picker"
import { ICONS } from "./prop-icons"
import { Checklist, Links } from "./item-parts"
import { ShareItem } from "./share-item"
import { WeightProp } from "./grade-setup"
import { CHECKLIST_MAX } from "@/core/shared"

/** Fields saved once typing pauses; the rest save at once. */
const TYPED: ItemField[] = ["title", "notes", "where", "dept", "checklist"]

/* A course by its key: one of yours by its id, a class's by '<scope>/<id>'. An item of yours
   filed under a class shows under the class's course (refs.ts itemCourseKey). */
const courseOf = (key: string | null) => courseByKey(key)

export function ItemSheet({ id, draft }: { id?: string; draft?: Item }) {
    const stored = useItemView(id ?? "")
    const it = draft ?? stored
    const isNew = !!draft
    const courses = useCourses()
    const items = useItems()   /* the type list counts items; topics and the date's dots read them */
    const sessions = useStudySessions()
    const bg = useUi((u) => u.bg)
    const [fillNote, setFillNote] = useState("")
    /* a new item with a class picked goes into the class, for its owner or an editor, unless unticked */
    const [shareNew, setShareNew] = useState(true)
    const f = useId()
    /* Checklist, Notes and Links start folded; one the item has opens by itself and stays
       open while the card is, even emptied. `focus` is the part a + just opened. */
    const [unfolded, setUnfolded] = useState(() => ({
        steps: !!it?.checklist?.length, notes: !!it?.notes, links: !!it?.links?.length,
    }))
    const [focus, setFocus] = useState<"steps" | "notes" | "links" | null>(null)
    /* autoFocus acts at mount, before this runs; clearing it keeps a remount from stealing focus */
    useEffect(() => { if (focus) setFocus(null) }, [focus])

    /* closing, or switching to another item, saves what is being typed */
    useEffect(() => {
        const save = () => { void flush() }
        beforeSheetClose.add(save)
        return () => { beforeSheetClose.delete(save) }
    }, [])
    /* deleted on another device while open */
    useEffect(() => { if (!it) closeSheet() }, [it])
    if (!it) return null

    const m = tmeta(it.type)
    const c = courseOf(itemCourseKey(it))
    const cal = schoolCal()
    const ends = repeatEnds(cal, it.date)

    /** An edit to a field, with what it brings along; `from` is what was pressed, for the show. */
    const set = (field: ItemField, value: unknown, from?: Element) => {
        /* the course picker works in keys: a class's course files the item under the class */
        let patch = deriveEdit({ ...it, courseId: itemCourseKey(it) }, field, value, courseOf, cal)
        if (field === "courseId") patch = { ...patch, ...placeCourse(patch.courseId ?? null) }
        if (isNew) { updateDraft(normalizeItem({ ...it, ...patch }) as Item); return }
        if (TYPED.includes(field)) { typeInto(it.id, patch); return }
        const finishing = field === "status" && !isComplete(it) && isComplete({ ...it, ...patch })
        if (finishing && from) celebrate(from)
        void editNow(it.id, patch).then(() => {
            const row = store.item(it.id) as Item | null
            if (field === "status" && row) return chainReview(row)
            /* moved onto a crowded day or week: say so, without stopping anything */
            const crunch = field === "date" && row ? hintFor(row) : null
            if (crunch) toast(crunch)
        })
    }

    const save = async () => {
        if (!it.title.trim()) return
        const row = normalizeItem(it)
        if (shareNew && canAddToClass(row)) await addToClass(row)
        else await store.saveItem(row)
        closeSheet()
    }

    const types = typeList(bg, items).filter((t: { id: string; hidden: boolean }) => t.id === it.type || !t.hidden)
    const statuses = statusesFor(it.type) as [string, string][]
    const prep = !isNew && isTest(it.type) && isOpen(it) ? prepPace(it, today()) : null
    const lectures = !!c && (c.meetings || []).some((x) => x.kind === "Lecture")
    const studied = isNew ? 0 : studiedFor(sessions, it.id)
    const next = c && (c.meetings || []).length ? [...c.meetings].sort((a, b) => (a.weekday + 6) % 7 - (b.weekday + 6) % 7)[0] : null

    const busy = busyDays(items, it.id)
    const gradable = GRADABLE.includes(baseOf(it.type))
    const show = {
        steps: unfolded.steps || (it.checklist || []).length > 0,
        notes: unfolded.notes || !!it.notes,
        links: unfolded.links || (it.links || []).length > 0,
    }
    const unfold = (part: "steps" | "notes" | "links") => { setUnfolded((u) => ({ ...u, [part]: true })); setFocus(part) }
    const test = isTest(it.type)
    /* a new item that would crowd a day or week says so beside Save */
    const crunch = isNew && it.date ? hintFor(it) : null

    return (
        <>
            <SheetHead color={m.color} kind={isNew ? "New " + m.label.toLowerCase() : m.label} onClose={closeSheet}>
                {!isNew && <StatusChip item={it} />}
                <span className="font-mono text-[11px] text-muted-foreground">{countdown(it)}</span>
                {prep && (
                    <span title="Topics done · topics a day to finish before the exam"
                        className={cn("rounded-full bg-[var(--chip-bg)] px-2 py-px font-mono text-[10.5px] font-semibold tabular-nums", prep.hot ? "text-destructive" : "text-[var(--chip-ink)]")}>
                        {prepLabel(prep)}
                    </span>
                )}
            </SheetHead>

            <SheetBody className="gap-[22px] px-6 pt-2 pb-7 max-[700px]:px-4">
                <div className="flex flex-col gap-1.5">
                    <TitleArea
                        value={it.title}
                        maxLength={140}
                        aria-label="Title"
                        placeholder={isNew ? "What is it called?" : "Untitled item"}
                        autoFocus={isNew}
                        onChange={(e) => set("title", e.target.value)}
                        onBlur={() => void flush()}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (isNew) void save() } }}
                        className="font-serif text-[30px] leading-[1.15] font-[500] tracking-[-.015em]"
                    />
                    {c && next && (
                        <div className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted-foreground">
                            {c.name} meets {DOW[next.weekday]} {next.start} · {next.room || "room not set"}
                            <IconButton className="px-1.5 py-px text-[11px]" onClick={() => openCourse(keyOf(c))}>{c.spaceId ? "Open the class" : "Edit course"}</IconButton>
                        </div>
                    )}
                </div>

                <Chips label="Type" value={it.type} options={types} onChange={(v) => set("type", v)} />

                <Props>
                    <Prop icon={ICONS.course} label="Course" htmlFor={f + "course"}>
                        <span style={accent(c?.color)} className="flex items-center gap-2">
                            <span aria-hidden="true" className="size-[9px] flex-none rounded-[3px] bg-[var(--c,var(--line))]" />
                            <Select id={f + "course"} className={QUIET} value={itemCourseKey(it) ?? ""} onChange={(e) => set("courseId", e.target.value)}>
                                <option value="">No course</option>
                                {courses.filter((x) => !x.archived || keyOf(x) === itemCourseKey(it)).map((x) => (
                                    <option key={keyOf(x)} value={keyOf(x)}>{x.name}{x.source === "class" ? " · shared class" : ""}</option>
                                ))}
                            </Select>
                        </span>
                    </Prop>

                    <Prop icon={ICONS.date} label="Date" top>
                        <DatePicker value={it.date} busy={busy} onChange={(d) => set("date", d)} />
                    </Prop>

                    <Prop icon={ICONS.time} label="Time" htmlFor={f + "start"}>
                        <span className="flex items-center gap-1.5">
                            <TimeField id={f + "start"} label="Start time" className={QUIET} value={it.start} onChange={(v) => set("start", v)} />
                            <span className="text-[12px] text-muted-foreground">to</span>
                            <TimeField label="End time" className={QUIET} value={it.end} onChange={(v) => set("end", v)} />
                        </span>
                    </Prop>

                    <Prop icon={ICONS.room} label="Room" htmlFor={f + "where"}>
                        <TextInput id={f + "where"} className={QUIET} value={it.where} maxLength={80} placeholder="Add a room or place" onChange={(e) => set("where", e.target.value)} onBlur={() => void flush()} />
                    </Prop>

                    <Prop icon={ICONS.status} label="Status">
                        <span className="flex"><Segmented label="Status" value={it.status} options={statuses} onChange={(v, el) => set("status", v, el)} /></span>
                    </Prop>

                    {REPEATS.includes(it.type) && (
                        <Prop icon={ICONS.repeat} label="Repeat" top>
                            <div className="flex flex-col items-start gap-2">
                                <Segmented label="Repeat" value={it.recur === "weekly" ? "weekly" : "once"} options={REPEAT_CHOICES} onChange={(v) => set("recur", v === "weekly")} />
                                {it.recur === "weekly" && (
                                    <span className="flex items-center gap-1.5 text-[13px] text-ink-2">
                                        <label htmlFor={f + "until"}>Until</label>
                                        {ends.length
                                            ? <Select id={f + "until"} className={cn(QUIET, "w-auto")} value={it.recurUntil ?? ""} onChange={(e) => set("recurUntil", e.target.value)}>
                                                {ends.map((x) => <option key={x.end} value={x.end}>{untilLabel(x)}</option>)}
                                                {it.recurUntil && !ends.some((x) => x.end === it.recurUntil) && <option value={it.recurUntil}>{shortDate(it.recurUntil)}</option>}
                                                <option value="">no end</option>
                                            </Select>
                                            : <DateInput id={f + "until"} className={cn(QUIET, "w-auto")} value={it.recurUntil ?? ""} onChange={(e) => set("recurUntil", e.target.value)} />}
                                    </span>
                                )}
                            </div>
                        </Prop>
                    )}

                    {it.type === "office" && (
                        <Prop icon={ICONS.dept} label="Dept" htmlFor={f + "dept"}>
                            <TextInput id={f + "dept"} className={QUIET} value={it.dept} maxLength={40} placeholder="Cardiology" onChange={(e) => set("dept", e.target.value)} onBlur={() => void flush()} />
                        </Prop>
                    )}

                    {gradable && (
                        <WeightProp item={it} course={c} items={items.filter((x) => itemCourseKey(x) === itemCourseKey(it))}
                            onWeight={(v) => set("weight", v)} onCategory={(id) => set("category", id)} />
                    )}

                    {it.status === "graded" && (
                        <Prop icon={ICONS.grade} label="Grade" htmlFor={f + "grade"}>
                            <span className="flex items-center gap-1">
                                <NumberInput id={f + "grade"} className={cn(QUIET, "w-16")} min={0} max={100} placeholder="—" value={it.grade ?? ""} onChange={(e) => set("grade", e.target.value)} />
                                <span className="text-muted-foreground">%</span>
                            </span>
                        </Prop>
                    )}

                    {studied > 0 && (
                        <Prop icon={ICONS.studied} label="Studied">
                            <span className="font-mono text-[12.5px] text-ink-2">{duration(studied)}</span>
                        </Prop>
                    )}
                </Props>

                {isNew && canAddToClass(it) && (
                    <Checkbox id={f + "share"} checked={shareNew} onChange={setShareNew}>Add it to the class for everyone (unticked, it stays yours, filed under the class)</Checkbox>
                )}

                {show.steps && (
                    <Checklist
                        item={it}
                        autoFocus={focus === "steps"}
                        /* a step typed waits for the pause like other text; a tick, an add or a remove saves at once */
                        onChange={(list, typing) => { if (typing || isNew) set("checklist", list); else void editNow(it.id, { checklist: list }) }}
                        fill={!isNew && test && lectures ? () => {
                            const r = fillTopics({ ...it, courseId: itemCourseKey(it) }, c, keyedItems(items), termStart(), schoolCal())
                            if (r.added) void editNow(it.id, { checklist: r.checklist })
                            setFillNote(r.added
                                ? "Added " + r.added + " lecture" + (r.added === 1 ? "" : "s") + "." + (r.left ? " " + r.left + " more did not fit under the " + CHECKLIST_MAX + "-step limit." : "")
                                : r.left ? "The list is full: " + CHECKLIST_MAX + " steps is the most an item can hold." : "Every lecture before this " + m.label.toLowerCase() + " is already listed.")
                        } : null}
                        fillNote={fillNote}
                    />
                )}

                {show.notes && (
                    <Section title="Notes">
                        <TextArea aria-label="Notes" autoFocus={focus === "notes"} value={it.notes} maxLength={5000} placeholder="What to revise, what the lecturer said, page numbers."
                            onChange={(e) => set("notes", e.target.value)} onBlur={() => void flush()} />
                    </Section>
                )}

                {show.links && <Links item={it} autoFocus={focus === "links"} onChange={(links) => set("links", links)} />}

                {!(show.steps && show.notes && show.links) && (
                    <div className="flex flex-wrap gap-2">
                        {!show.steps && <AddButton aria-label={test ? "Add topics" : "Add a checklist"} onClick={() => unfold("steps")}>{test ? "Topics" : "Checklist"}</AddButton>}
                        {!show.notes && <AddButton aria-label="Add notes" onClick={() => unfold("notes")}>Notes</AddButton>}
                        {!show.links && <AddButton aria-label="Add links" onClick={() => unfold("links")}>Links</AddButton>}
                    </div>
                )}

                {!isNew && it.classId && <ShareItem item={it} />}
            </SheetBody>

            {isNew ? (
                <SheetFoot hint={crunch ? <span role="status" className="text-[var(--warn)]">{crunch}</span> : it.title.trim() ? <span className="text-[var(--done-ink)]">Ready to save</span> : "Give it a name to save"}>
                    <Button variant="ghost" onClick={closeSheet}>Cancel</Button>
                    <Button disabled={!it.title.trim()} onClick={() => void save()}>Save item</Button>
                </SheetFoot>
            ) : (
                <SheetFoot hint="Edits save as you type">
                    <Button variant="ghost" onClick={() => void deleteItem(it.id)}>Delete</Button>
                    <Button onClick={closeSheet}>Done</Button>
                </SheetFoot>
            )}
        </>
    )
}
