// A class's item in the card (spec §15). **Class**: the class's facts as everyone in it sees
// them, changed by its owner and editors for everyone; members read them, with who changed
// them last. **Yours**: what only you see: status, grade, your weight, exam prep's topics,
// your notes, and "not mine". Opened by the item's key, '<scope>/<id>'. Text saves once
// typing pauses; leaving the card saves what is waiting. An item an editor removed opens its
// removed card instead (removed.tsx).

import { useEffect, useId, useState } from "react"
import { cn } from "@/lib/utils"
import { baseOf, httpUrl, isOpen, isTest, normalizePrefs, statusesFor, tmeta, typeList } from "@/core/model"
import { shortDate, today, DOW } from "@/core/dates"
import { GRADABLE, shareOf } from "@/core/grades"
import { fillTopics, prepLabel, prepPace } from "@/core/prep"
import { studyPlan } from "@/core/study-plan"
import { repeatEnds } from "@/core/school"
import * as store from "@/core/store"
import { schoolCal, termStart } from "@/data/query"
import { duration } from "@/lib/time"
import { useItems, useMarks, useProfile, useRemovedItems, useSharedCourses, useSharedItems, useSpaces, useStudySessions } from "@/data/store"
import { useUi } from "@/data/ui"
import { closeSheet } from "@/data/overlay"
import { openGenerate, prepStart } from "@/data/cards"
import { busyDays, countdown, deriveEdit, REPEAT_CHOICES, REPEATS, untilLabel, type ItemField } from "@/data/item-edit"
import { courseByKey } from "@/data/effective"
import { keyedItems, keyedSessions, splitKey } from "@/data/refs"
import { studiedFor } from "@/data/study"
import { editedBy, editMark, editRow, flushTyping, hideAsks, markIdOf, markStatus, pendingMark, pendingRow, setHidden, typeMark, typeRow, useTyping } from "@/data/marks"
import { toast } from "@/data/toast"
import { StatusChip } from "@/components/views/bits"
import { SharedGlyph } from "@/components/shared-glyph"
import { MaintenanceBar } from "@/components/maintenance"
import type { Course, Item, Mark } from "@/data/types"
import { Button, Chips, DateInput, KeptNumberInput, Note, Prop, Props, QUIET, Section, Segmented, Select, SheetBody, SheetFoot, SheetHead, TextArea, TextInput, TitleArea } from "./fields"
import { ClassesGate, useFlushOnClose } from "./gate"
import { TimeField } from "./time-field"
import { DatePicker } from "./date-picker"
import { ICONS } from "./prop-icons"
import { Checklist, Links } from "./item-parts"
import { RemovedCard } from "./removed"
import { WeightProp } from "./grade-setup"
import { CHECKLIST_MAX } from "@/core/shared"

const TITLE = "font-serif text-[30px] leading-[1.15] font-[500] tracking-[-.015em]"
const KEY = "text-muted-foreground"

/* While the admins have shared classes switched off, everyone else gets the maintenance page
   (an admin keeps the card, under the bar), as for the class sheet. */
export function ClassItemSheet({ itemKey }: { itemKey: string }) {
    return <ClassesGate kind="Class item">{(bar) => <ClassItemCard itemKey={itemKey} bar={bar} />}</ClassesGate>
}

function ClassItemCard({ itemKey, bar }: { itemKey: string; bar: boolean }) {
    const { scope, id } = splitKey(itemKey)
    useTyping()
    const shared = useSharedItems()
    const row = shared.find((it) => it.scope === scope && it.id === id) ?? null
    const gone = useRemovedItems().find((it) => it.scope === scope && it.id === id) ?? null
    const courseName = useSharedCourses().find((c) => c.scope === scope)?.name ?? "the class"
    const space = useSpaces().find((s) => s.scope === scope) ?? null
    const stored = useMarks().find((m) => m.id === markIdOf(itemKey)) ?? null
    const items = useItems()
    const sessions = useStudySessions()
    const me = useProfile()?.id
    const bg = useUi((u) => u.bg)
    const [asking, setAsking] = useState<"hide" | "delete" | null>(null)
    const [fillNote, setFillNote] = useState("")
    const [weightNote, setWeightNote] = useState("")
    const f = useId()

    /* closing, or switching to another item, saves what is being typed */
    useFlushOnClose(() => { void flushTyping() })
    const profile = useProfile()
    /* deleted for good, or the class gone from this device, while open; a removed item keeps its card */
    useEffect(() => { if ((!row && !gone) || !space) closeSheet() }, [row, gone, space])

    if (!row && gone && space) return <RemovedCard row={gone} space={space} course={courseName} bar={bar} />
    if (!row || !space || !scope) return null

    const it: Item = { ...row, ...pendingRow(itemKey) }
    const mark: Partial<Mark> = { ...(stored ?? {}), ...pendingMark(itemKey) }
    const view: Item = {
        ...it, status: mark.status ?? "todo", grade: mark.grade ?? null, weight: mark.weight ?? it.weight,
        checklist: mark.checklist ?? [], notes: mark.notes ?? "", completedAt: mark.completedAt ?? null,
    }
    const editor = space.role !== "member" && !space.archived
    const courseKey = scope + "/" + row.courseId
    const course = courseByKey(courseKey)
    /* the class's items of this course: what each item of a grade category is worth */
    const siblings = shared.filter((x) => x.scope === scope && x.courseId === row.courseId) as Item[]
    const inCategory = shareOf(it, siblings, course?.gradeCategories).category
    const m = tmeta(it.type)
    const test = isTest(it.type)
    const lectures = !!course && (course.meetings || []).some((x) => x.kind === "Lecture")
    const prep = test && isOpen(view) ? prepPace(view, today()) : null
    const plan = test && isOpen(view) ? studyPlan(view, today(), normalizePrefs(profile?.studyPrefs).rest) : null
    const studied = studiedFor(keyedSessions(sessions), itemKey)
    const by = editedBy(row, space, me)

    const hide = async () => {
        await setHidden(itemKey, true)
        toast("Hidden from your views and grades. Show it again from the class.")
        closeSheet()
    }
    const remove = async () => {
        closeSheet()
        await store.removeShared("shared_items", scope, id)
    }
    const fill = () => {
        if (!course) return
        const r = fillTopics({ ...view, id: itemKey, courseId: courseKey }, course, keyedItems(items), termStart(), schoolCal())
        if (r.added) void editMark(itemKey, { checklist: r.checklist })
        setFillNote(r.added
            ? "Added " + r.added + " lecture" + (r.added === 1 ? "" : "s") + "." + (r.left ? " " + r.left + " more did not fit under the " + CHECKLIST_MAX + "-step limit." : "")
            : r.left ? "The list is full: " + CHECKLIST_MAX + " steps is the most an item can hold." : "Every lecture before this " + m.label.toLowerCase() + " is already listed.")
    }

    return (
        <>
            <SheetHead color={m.color} kind={m.label} onClose={closeSheet}>
                <StatusChip item={view} />
                <span className="font-mono text-[11px] text-muted-foreground">{countdown(view)}</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-px text-[10.5px] font-semibold text-ink-2">
                    <SharedGlyph className="size-3" /> {course?.name || "Class"}
                </span>
                {prep && (
                    <span className={cn("rounded-full bg-[var(--chip-bg)] px-2 py-px font-mono text-[10.5px] font-semibold tabular-nums", prep.hot ? "text-destructive" : "text-[var(--chip-ink)]")}>
                        {prepLabel(prep)}
                    </span>
                )}
            </SheetHead>

            <SheetBody className="gap-[22px] px-6 pt-2 pb-7 max-[700px]:px-4">
                {bar && <MaintenanceBar className="mb-0" />}
                {editor
                    ? <TitleArea value={it.title} maxLength={140} aria-label="Title" placeholder="Untitled item" className={cn("shrink-0", TITLE)}
                        onChange={(e) => typeRow(itemKey, { title: e.target.value })} onBlur={() => void flushTyping()} />
                    : <h2 className={cn("m-0", TITLE)}>{it.title}</h2>}

                <Section title={<><SharedGlyph /> Class</>} note={by || (editor ? "Everyone in the class sees these" : undefined)}>
                    {editor ? <ClassFields itemKey={itemKey} it={it} f={f} bg={bg} items={items} course={course} siblings={siblings} /> : <ClassFacts it={it} category={inCategory?.name ?? null} />}
                </Section>

                <Section title="Yours" note="Only you see these">
                    <Props>
                        <Prop icon={ICONS.status} label="Status">
                            <span className="flex">
                                <Segmented label="Status" value={view.status} options={statusesFor(it.type) as [string, string][]} onChange={(v) => void editMark(itemKey, markStatus(stored, v))} />
                            </span>
                        </Prop>
                        {view.status === "graded" && (
                            <Prop icon={ICONS.grade} label="Grade" htmlFor={f + "grade"}>
                                <span className="flex items-center gap-1">
                                    <KeptNumberInput id={f + "grade"} className={cn(QUIET, "w-16")} min={0} max={100} placeholder="—" value={view.grade ?? ""}
                                        onChange={(e) => void editMark(itemKey, { grade: e.target.value === "" ? null : Math.max(0, Math.min(100, Number(e.target.value))) })} />
                                    <span className="text-muted-foreground">%</span>
                                </span>
                            </Prop>
                        )}
                        {GRADABLE.includes(baseOf(it.type)) && !inCategory && (
                            <Prop icon={ICONS.weight} label="Your weight" htmlFor={f + "mine"}>
                                <span className="flex items-center gap-1">
                                    <KeptNumberInput id={f + "mine"} className={cn(QUIET, "w-16")} min={0} max={100} step="any" placeholder={it.weight == null ? "—" : String(it.weight)} value={mark.weight ?? ""}
                                        onChange={(e) => { const n = Number(e.target.value); setWeightNote(e.target.value !== "" && (!(n >= 0) || n > 100) ? "Weight must be between 0% and 100%." : ""); void editMark(itemKey, { weight: e.target.value === "" || !(n >= 0) ? null : Math.min(100, n) }) }} />
                                    <span className="text-muted-foreground">% · empty uses the class's</span>
                                </span>
                            </Prop>
                        )}
                        {studied > 0 && (
                            <Prop icon={ICONS.studied} label="Studied"><span className="font-mono text-[12.5px] text-ink-2">{duration(studied)}</span></Prop>
                        )}
                    </Props>
                    {weightNote && <span role="status" className="text-[12px] text-destructive">{weightNote}</span>}
                    {mark.weight != null && mark.weight !== it.weight && (
                        <div className="flex flex-wrap items-center gap-2">
                            <Note>The class weight is {it.weight == null ? "not set" : it.weight + "%"}.</Note>
                            <Button variant="ghost" onClick={() => void editMark(itemKey, { weight: null })}>Use class weight</Button>
                        </div>
                    )}
                    <Checklist item={view} fill={test && lectures ? fill : null} fillNote={fillNote} onLeave={() => void flushTyping()}
                        onChange={(list, typing) => { if (typing) typeMark(itemKey, { checklist: list }); else void editMark(itemKey, { checklist: list }) }} />

                {plan && plan.days.length > 0 && (
                    <Section title="Study plan" note={plan.days.length + " day" + (plan.days.length === 1 ? "" : "s") + " to go"}>
                        <ol className="flex flex-col gap-1 text-[13px]">
                            {plan.days.map((d) => (
                                <li key={d.date} className="flex gap-2">
                                    <span className="w-24 flex-none text-ink-2">{shortDate(d.date)}</span>
                                    <span>{d.topics.join("; ")}</span>
                                </li>
                            ))}
                        </ol>
                    </Section>
                )}
                {plan && plan.noStudyDays && (
                    <p className="text-[13px] text-ink-2">No study day is left before this exam. The open topics need today.</p>
                )}
                    <TextArea aria-label="My notes" value={view.notes} maxLength={5000} placeholder="Only you see these."
                        onChange={(e) => typeMark(itemKey, { notes: e.target.value })} onBlur={() => void flushTyping()} />
                    {asking === "hide" ? (
                        <div role="alert" className="flex flex-wrap items-center gap-2">
                            <Note>Hide it? {view.grade != null ? "Your grade of " + view.grade + "%" : "Your grade"} stops counting in {course?.name || "the class"}.</Note>
                            <Button variant="ghost" onClick={() => setAsking(null)}>Keep it</Button>
                            <Button variant="danger" onClick={() => void hide()}>Hide it</Button>
                        </div>
                    ) : (
                        <Button variant="ghost" className="self-start" onClick={() => { if (hideAsks(stored)) setAsking("hide"); else void hide() }}>Not mine · hide it</Button>
                    )}
                </Section>
            </SheetBody>

            {asking === "delete" ? (
                <SheetFoot hint={"Delete it for everyone in " + (course?.name || "the class") + "?"}>
                    <Button variant="ghost" onClick={() => setAsking(null)}>Keep it</Button>
                    <Button variant="danger" onClick={() => void remove()}>Delete it</Button>
                </SheetFoot>
            ) : (
                <SheetFoot hint="Edits save as you type">
                    {editor && <Button variant="ghost" onClick={() => setAsking("delete")}>Delete for everyone</Button>}
                    {test && <Button variant="ghost" onClick={() => { closeSheet(); openGenerate(prepStart(view, "class:" + space.id)) }}>Make cards</Button>}
                    <Button onClick={closeSheet}>Done</Button>
                </SheetFoot>
            )}
        </>
    )
}

/* The class's facts, for its owner and editors: each change saves for everyone. */
function ClassFields({ itemKey, it, f, bg, items, course, siblings }: { itemKey: string; it: Item; f: string; bg: string; items: Item[]; course: Course | null; siblings: Item[] }) {
    const cal = schoolCal()
    const ends = repeatEnds(cal, it.date)
    const types = typeList(bg, items).filter((t) => !t.custom && (t.id === it.type || !t.hidden))
    const set = (field: ItemField, value: unknown) => void editRow(itemKey, deriveEdit(it, field, value, () => course, cal))
    return (
        <>
            <Chips label="Type" value={it.type} options={types} onChange={(v) => set("type", v)} />
            <Props>
                <Prop icon={ICONS.date} label="Date" top>
                    <DatePicker value={it.date} busy={busyDays(items, it.id)} onChange={(d) => set("date", d)} />
                </Prop>
                <Prop icon={ICONS.time} label="Time" htmlFor={f + "start"}>
                    <span className="flex items-center gap-1.5">
                        <TimeField id={f + "start"} label="Start time" className={QUIET} value={it.start} onChange={(v) => set("start", v)} />
                        <span className="text-[12px] text-muted-foreground">to</span>
                        <TimeField label="End time" className={QUIET} value={it.end} onChange={(v) => set("end", v)} />
                    </span>
                </Prop>
                <Prop icon={ICONS.room} label="Room" htmlFor={f + "where"}>
                    <TextInput id={f + "where"} className={QUIET} value={it.where} maxLength={80} placeholder="Add a room or place"
                        onChange={(e) => typeRow(itemKey, { where: e.target.value })} onBlur={() => void flushTyping()} />
                </Prop>
                {GRADABLE.includes(baseOf(it.type)) && (
                    <WeightProp item={it} course={course} items={siblings} kept onWeight={(v) => set("weight", v)} onCategory={(cat) => set("category", cat)} />
                )}
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
            </Props>
            <TextArea aria-label="Class notes" value={it.notes} maxLength={5000} placeholder="What everyone should know: groups, format, what is allowed."
                onChange={(e) => typeRow(itemKey, { notes: e.target.value })} onBlur={() => void flushTyping()} />
            <Links item={it} onChange={(links) => void editRow(itemKey, { links })} />
        </>
    )
}

/* The class's facts, for a member: read-only. */
function ClassFacts({ it, category }: { it: Item; category: string | null }) {
    const when = it.recur === "weekly" ? "Every " + DOW[it.weekday ?? 0] : shortDate(it.date)
    return (
        <>
            <dl className="m-0 grid grid-cols-[86px_minmax(0,1fr)] gap-x-2.5 gap-y-1.5 text-[12.5px]">
                <dt className={KEY}>Type</dt><dd className="m-0">{tmeta(it.type).label}</dd>
                <dt className={KEY}>When</dt><dd className="m-0">{when}{it.start ? " · " + it.start + (it.end ? "–" + it.end : "") : ""}</dd>
                <dt className={KEY}>Room</dt><dd className="m-0">{it.where || "—"}</dd>
                <dt className={KEY}>Weight</dt><dd className="m-0">{category ? "Counts in " + category : it.weight == null ? "—" : it.weight + "%"}</dd>
            </dl>
            {it.notes && <p className="m-0 text-[12.5px] whitespace-pre-wrap text-ink-2">{it.notes}</p>}
            {it.links.length > 0 && (
                <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[12.5px]">
                    {it.links.map((l, i) => (
                        <li key={i}>
                            {/* only a web link becomes a link, however it got here */}
                            {httpUrl(l.url)
                                ? <a href={l.url} target="_blank" rel="noopener noreferrer" className="[overflow-wrap:anywhere] text-[var(--accent)] no-underline hover:underline">↗ {l.label || l.url}</a>
                                : <span>{l.label || l.url}</span>}
                        </li>
                    ))}
                </ul>
            )}
            <Note>The owner and editors keep these.</Note>
        </>
    )
}
