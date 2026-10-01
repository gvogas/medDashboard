// An item in the card: its title, the type as buttons, the property rows (course, date,
// time, room, status, repeat, weight…), then the checklist (topics for an exam), notes and
// links, folded until wanted. A stored item saves as it is edited (text once typing
// pauses); a new one is a draft until Save. The rules for what an edit brings along are in
// data/item-edit.ts.

import { useEffect, useId, useState } from "react"
import { cn } from "@/lib/utils"
import { baseOf, httpUrl, isComplete, isOpen, isTest, normalizeItem, statusesFor, tmeta, typeList, uid } from "@/core/model"
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
import { busyDays, celebrate, chainReview, countdown, deriveEdit, editNow, flush, linkUrl, REPEAT_CHOICES, REPEATS, typeInto, untilLabel, useItemView, type ItemField } from "@/data/item-edit"
import { deleteItem, openCourse } from "@/data/actions"
import { accent, StatusChip } from "@/components/views/bits"
import type { ChecklistEntry, Course, Item } from "@/data/types"
import {
    Button, Chips, DateInput, IconButton, Meter, Note, NumberInput, Prop, Props, QUIET, RemoveButton, Section, Segmented, Select,
    SheetBody, SheetFoot, SheetHead, TextArea, TextInput, TitleArea, CONTROL,
} from "./fields"
import { TimeField } from "./time-field"
import { DatePicker } from "./date-picker"
import { ICONS } from "./prop-icons"

/** Fields saved once typing pauses; the rest save at once. */
const TYPED: ItemField[] = ["title", "notes", "where", "dept", "checklist"]
const MAX_STEPS = 50, MAX_LINKS = 20

const courseOf = (id: string | null) => (id ? (store.course(id) as Course | null) : null)

export function ItemSheet({ id, draft }: { id?: string; draft?: Item }) {
    const stored = useItemView(id ?? "")
    const it = draft ?? stored
    const isNew = !!draft
    const courses = useCourses()
    const items = useItems()   /* the type list counts items; topics and the date's dots read them */
    const sessions = useStudySessions()
    const bg = useUi((u) => u.bg)
    const [fillNote, setFillNote] = useState("")
    const f = useId()

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
    const c = courseOf(it.courseId)
    const cal = schoolCal()
    const ends = repeatEnds(cal, it.date)

    /** An edit to a field, with what it brings along; `from` is what was pressed, for the show. */
    const set = (field: ItemField, value: unknown, from?: Element) => {
        const patch = deriveEdit(it, field, value, courseOf, cal)
        if (isNew) { updateDraft(normalizeItem({ ...it, ...patch }) as Item); return }
        if (TYPED.includes(field)) { typeInto(it.id, patch); return }
        const finishing = field === "status" && !isComplete(it) && isComplete({ ...it, ...patch })
        if (finishing && from) celebrate(from)
        void editNow(it.id, patch).then(() => {
            const row = store.item(it.id) as Item | null
            if (field === "status" && row) return chainReview(row)
        })
    }

    const save = async () => {
        if (!it.title.trim()) return
        await store.saveItem(normalizeItem(it))
        closeSheet()
    }

    const types = typeList(bg, store.data.items).filter((t: { id: string; hidden: boolean }) => t.id === it.type || !t.hidden)
    const statuses = statusesFor(it.type) as [string, string][]
    const prep = !isNew && isTest(it.type) && isOpen(it) ? prepPace(it, today()) : null
    const lectures = !!c && (c.meetings || []).some((x) => x.kind === "Lecture")
    const studied = isNew ? 0 : studiedFor(sessions, it.id)
    const next = c && (c.meetings || []).length ? [...c.meetings].sort((a, b) => (a.weekday + 6) % 7 - (b.weekday + 6) % 7)[0] : null

    const busy = busyDays(items, it.id)
    const gradable = GRADABLE.includes(baseOf(it.type))

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
                            <IconButton className="px-1.5 py-px text-[11px]" onClick={() => openCourse(c.id)}>Edit course</IconButton>
                        </div>
                    )}
                </div>

                <Chips label="Type" value={it.type} options={types} onChange={(v) => set("type", v)} />

                <Props>
                    <Prop icon={ICONS.course} label="Course" htmlFor={f + "course"}>
                        <span style={accent(c?.color)} className="flex items-center gap-2">
                            <span aria-hidden="true" className="size-[9px] flex-none rounded-[3px] bg-[var(--c,var(--line))]" />
                            <Select id={f + "course"} className={QUIET} value={it.courseId ?? ""} onChange={(e) => set("courseId", e.target.value)}>
                                <option value="">No course</option>
                                {courses.filter((x) => !x.archived || x.id === it.courseId).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
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
                        <Prop icon={ICONS.weight} label="Weight" htmlFor={f + "weight"}>
                            <span className="flex items-center gap-1">
                                <NumberInput id={f + "weight"} className={cn(QUIET, "w-16")} min={0} max={100} step="any" placeholder="—" value={it.weight ?? ""} onChange={(e) => set("weight", e.target.value)} />
                                <span className="text-muted-foreground">% of the course grade</span>
                            </span>
                        </Prop>
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

                <Section title="Notes">
                    <TextArea aria-label="Notes" value={it.notes} maxLength={5000} placeholder="What to revise, what the lecturer said, page numbers."
                        onChange={(e) => set("notes", e.target.value)} onBlur={() => void flush()} />
                </Section>

                <Checklist
                    item={it}
                    /* a step typed waits for the pause like other text; a tick, an add or a remove saves at once */
                    onChange={(list, typing) => { if (typing || isNew) set("checklist", list); else void editNow(it.id, { checklist: list }) }}
                    fill={!isNew && isTest(it.type) && lectures ? () => {
                        const r = fillTopics(it, c, store.data.items, termStart(), schoolCal())
                        if (r.added) void editNow(it.id, { checklist: r.checklist })
                        setFillNote(r.added
                            ? "Added " + r.added + " lecture" + (r.added === 1 ? "" : "s") + "." + (r.left ? " " + r.left + " more did not fit under the 50-step limit." : "")
                            : r.left ? "The list is full: 50 steps is the most an item can hold." : "Every lecture before this " + m.label.toLowerCase() + " is already listed.")
                    } : null}
                    fillNote={fillNote}
                />

                <Links item={it} onChange={(links) => set("links", links)} />
            </SheetBody>

            {isNew ? (
                <SheetFoot hint={it.title.trim() ? "Ready to save" : "Give it a name to save"}>
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

function Checklist({ item, onChange, fill, fillNote }: {
    item: Item; onChange: (list: ChecklistEntry[], typing: boolean) => void; fill: (() => void) | null; fillNote: string
}) {
    const list = item.checklist || []
    const done = list.filter((s) => s.done).length
    const [adding, setAdding] = useState("")
    const replace = (id: string, change: Partial<ChecklistEntry>) => list.map((s) => (s.id === id ? { ...s, ...change } : s))

    return (
        <Section title={isTest(item.type) ? "Topics" : "Checklist"} note={list.length ? done + " of " + list.length + " done" : undefined}>
            {fill && <Button variant="ghost" className="self-start" onClick={fill}>Fill topics from lectures</Button>}
            {fillNote && <Note>{fillNote}</Note>}
            {list.length > 0 && <Meter part={done / list.length} pink full={done === list.length} />}
            {list.length > 0 && (
                <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                    {list.map((s) => (
                        <li key={s.id} className="group flex items-start gap-2 rounded-md px-0.5 py-[3px] hover:bg-muted">
                            <button
                                type="button"
                                aria-pressed={s.done}
                                aria-label={"Done: " + (s.text || "step")}
                                onClick={() => onChange(replace(s.id, { done: !s.done }), false)}
                                className={cn(
                                    "mt-0.5 grid size-3.5 flex-none cursor-pointer place-items-center rounded border-[1.5px] p-0",
                                    s.done ? "border-[#D2748F] bg-[#D2748F] text-white" : "border-[var(--box-line)] bg-transparent text-transparent",
                                )}
                            >
                                <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="size-[9px]"><path d="M2 6.5l2.6 2.6L10 3.5" /></svg>
                            </button>
                            <input
                                value={s.text}
                                maxLength={140}
                                aria-label="Step"
                                onChange={(e) => onChange(replace(s.id, { text: e.target.value }), true)}
                                onBlur={() => void flush()}
                                className={cn("min-w-0 flex-1 border-0 bg-transparent p-px font-[inherit] text-[12.5px] outline-none", s.done ? "text-[var(--done-ink)] line-through" : "text-foreground")}
                            />
                            <RemoveButton aria-label="Remove step" className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
                                onClick={() => onChange(list.filter((x) => x.id !== s.id), false)} />
                        </li>
                    ))}
                </ul>
            )}
            {list.length < MAX_STEPS && (
                <input
                    type="text"
                    value={adding}
                    maxLength={140}
                    aria-label="Add a step"
                    placeholder="Add a step, press Enter"
                    onChange={(e) => setAdding(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key !== "Enter" || !adding.trim()) return
                        e.preventDefault()
                        onChange([...list, { id: uid(), text: adding.trim(), done: false }], false)
                        setAdding("")
                    }}
                    className={cn(CONTROL, "border-border")}
                />
            )}
        </Section>
    )
}

function Links({ item, onChange }: { item: Item; onChange: (links: Item["links"]) => void }) {
    const links = item.links || []
    const [label, setLabel] = useState("")
    const [url, setUrl] = useState("")
    const [bad, setBad] = useState(false)
    const add = () => {
        const full = linkUrl(url, httpUrl)
        if (!full) { setBad(!!url.trim()); return }
        onChange([...links, { label: (label.trim() || full.replace(/^https?:\/\//i, "")).slice(0, 60), url: full }])
        setLabel(""); setUrl(""); setBad(false)
    }
    const onEnter = (e: React.KeyboardEvent) => { if (e.key === "Enter") { e.preventDefault(); add() } }

    return (
        <Section title="Links">
            {links.map((l, i) => (
                <div key={i} className="flex items-center gap-1.5 text-[12.5px]">
                    <span aria-hidden="true" className="text-muted-foreground">↗</span>
                    {/* only a web link becomes a link: never a javascript: or data: URL, however it got here */}
                    {httpUrl(l.url)
                        ? <a href={l.url} target="_blank" rel="noopener noreferrer" className="[overflow-wrap:anywhere] text-[var(--accent)] no-underline hover:underline">{l.label || l.url}</a>
                        : <span>{l.label || l.url}</span>}
                    <RemoveButton aria-label="Remove link" className="ml-auto" onClick={() => onChange(links.filter((_, j) => j !== i))} />
                </div>
            ))}
            {links.length < MAX_LINKS && (
                <div className="flex gap-1.5">
                    <input type="text" value={label} maxLength={60} placeholder="Label" aria-label="Link label" onChange={(e) => setLabel(e.target.value)} onKeyDown={onEnter} className={cn(CONTROL, "flex-[0_0_96px] border-border")} />
                    <input type="url" value={url} maxLength={500} placeholder="https://…" aria-label="Link URL" aria-invalid={bad || undefined}
                        onChange={(e) => { setUrl(e.target.value); setBad(false) }} onKeyDown={onEnter} className={cn(CONTROL, "flex-1 border-border")} />
                </div>
            )}
        </Section>
    )
}
