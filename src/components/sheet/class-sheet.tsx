// A shared class in the sheet (spec §15). **Details**: the class's
// facts and its items (each opening in the item card), with Edit class details for the owner
// and editors; **Yours**: your colour, semester and sidebar archive for it, your grade so far
// over its items with your marks on top, and the items you hid, to show again; a banner while
// a course of yours looks like the class and is not merged, and one while the class is
// archived; the items removed from it, and the class's own controls (leave, archive, delete).
// **Members**: who is in it, invites, the join code, roles, removing someone. **Activity**:
// what happened in the class (90 days).

import { useId, useState } from "react"
import { cn } from "@/lib/utils"
import { PALETTE, tmeta } from "@/core/model"
import { shortDate } from "@/core/dates"
import { useCourses, useItems, useMarks, useSharedCourses, useSharedItems, useSpacePrefs, useSpaces } from "@/data/store"
import { closeSheet, openSheet, replaceSheet, type ClassTab } from "@/data/overlay"
import { courseKeyOf, keyOf, type EffectiveCourse } from "@/data/effective"
import { keyedItems } from "@/data/refs"
import { hiddenIn, setHidden } from "@/data/marks"
import { matchFor, openMerge } from "@/data/merge"
import { savePref } from "@/data/classes"
import { schoolCal } from "@/data/query"
import { semesterOptions } from "@/data/course-edit"
import type { SharedCourse, SharedItem, Space, SpacePref } from "@/data/types"
import { SharedGlyph } from "@/components/shared-glyph"
import { MaintenanceBar } from "@/components/maintenance"
import { tabKeys } from "./radio-keys"
import { Button, Checkbox, Fields, Label, Note, Section, Select, SheetBody, SheetFoot, SheetHead, Swatches } from "./fields"
import { ClassesGate } from "./gate"
import { Grades } from "./grades"
import { MembersTab } from "./members-tab"
import { ActivityList } from "./activity-list"
import { ArchivedBanner, ClassActions } from "./class-actions"
import { RemovedList } from "./removed"

const TABS: readonly [ClassTab, string][] = [["details", "Details"], ["members", "Members"], ["activity", "Activity"]]
const TITLE = "m-0 text-[22px] leading-[1.22] font-[750] tracking-[-.02em] text-foreground"
const KEY = "text-muted-foreground"
const LIST = "m-0 flex list-none flex-col gap-1 p-0"
const ROW = "flex items-baseline gap-2 rounded-lg bg-muted px-2.5 py-1.5 text-[12.5px]"

/* While the admins have shared classes switched off, everyone else gets the maintenance page instead. */
export function ClassSheet({ spaceId, tab }: { spaceId: string; tab: ClassTab }) {
    return <ClassesGate kind="Class">{(bar) => <ClassCard spaceId={spaceId} tab={tab} bar={bar} />}</ClassesGate>
}

function ClassCard({ spaceId, tab, bar }: { spaceId: string; tab: ClassTab; bar: boolean }) {
    const scope = "c:" + spaceId
    const space = useSpaces().find((s) => s.id === spaceId) ?? null
    const course = useSharedCourses().find((c) => c.scope === scope) ?? null
    const items = useSharedItems().filter((it) => it.scope === scope).sort((a, b) => a.date.localeCompare(b.date))
    const f = useId()

    if (!space || !course) return (
        <>
            <SheetHead kind="Class" onClose={closeSheet} />
            <SheetBody><Note>This class isn't on this device yet. It arrives with the next sync.</Note></SheetBody>
            <SheetFoot hint=""><Button onClick={closeSheet}>Done</Button></SheetFoot>
        </>
    )
    const n = space.members.length
    return (
        <>
            <SheetHead color={course.color} kind="Class" onClose={closeSheet}>
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-px text-[10.5px] font-semibold text-ink-2">
                    <SharedGlyph className="size-3" /> Shared · {space.role}
                </span>
            </SheetHead>
            <div className="px-[18px] pt-4"><h2 className={TITLE}>{course.name}</h2></div>
            <div role="tablist" aria-label="Class" onKeyDown={tabKeys} className="flex gap-1 border-b border-border px-3">
                {TABS.map(([id, label]) => (
                    <button
                        key={id}
                        type="button"
                        role="tab"
                        id={f + id}
                        aria-selected={tab === id}
                        aria-controls={tab === id ? f + "panel" : undefined}
                        tabIndex={tab === id ? 0 : -1}
                        onClick={() => replaceSheet({ kind: "class", spaceId, tab: id })}
                        className={cn(
                            "h-10 flex-none cursor-pointer border-0 bg-transparent px-3 font-[inherit] text-[13px] outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--accent)]",
                            tab === id ? "font-semibold text-foreground shadow-[inset_0_-2px_0_var(--primary)]" : "font-medium text-muted-foreground hover:text-foreground",
                        )}
                    >
                        {label}
                    </button>
                ))}
            </div>
            <SheetBody>
                {bar && <MaintenanceBar className="mb-0" />}
                <div role="tabpanel" id={f + "panel"} aria-labelledby={f + tab} className="flex flex-col gap-3.5">
                    {tab === "details" ? <Details space={space} course={course} items={items} /> : tab === "members" ? <MembersTab spaceId={spaceId} /> : <ActivityList spaceId={spaceId} />}
                </div>
            </SheetBody>
            <SheetFoot hint={n + (n === 1 ? " member" : " members")}>
                <Button onClick={closeSheet}>Done</Button>
            </SheetFoot>
        </>
    )
}

function Details({ space, course, items }: { space: Space; course: SharedCourse; items: SharedItem[] }) {
    const scope = space.scope, classKey = scope + "/" + course.id
    const editor = space.role !== "member" && !space.archived
    const pref = useSpacePrefs().find((p) => p.id === space.id) ?? null
    const marks = useMarks()
    const courses = useCourses() as EffectiveCourse[]
    const all = useItems()
    const [whatIf, setWhatIf] = useState<Record<string, number>>({})
    const hidden = hiddenIn(scope, items, marks)
    const off = new Set(hidden.map((it) => it.id))
    const shown = items.filter((it) => !off.has(it.id))
    /* your grade over the class's items with your marks on top, and your items filed under it */
    const mine = keyedItems(all.filter((it) => courseKeyOf(it) === classKey))
    const yours = courses.find((c) => keyOf(c) === classKey) ?? course
    const match = matchFor(space.id, courses.filter((c) => !c.source), [course])

    return (
        <>
            <ArchivedBanner space={space} />
            {match && (
                <div role="note" className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--warn-line)] bg-[var(--warn-bg)] px-2.5 py-2 text-[12px] text-[var(--warn-ink)]">
                    <span className="min-w-0 flex-1">Your own course {match.name} looks like this class. Merge it, so your grades and notes sit on the class's items.</span>
                    <Button variant="ghost" onClick={() => openMerge(space.id, match.id, true)}>Merge…</Button>
                </div>
            )}
            <Section title={<><SharedGlyph /> Class</>} note={editor ? "You change these for everyone" : "The owner and editors keep it"}>
                <dl className="m-0 grid grid-cols-[86px_minmax(0,1fr)] gap-x-2.5 gap-y-1.5 text-[12.5px]">
                    <dt className={KEY}>Code</dt><dd className="m-0">{course.code || "—"}</dd>
                    <dt className={KEY}>Teacher</dt><dd className="m-0">{course.instructor || "—"}</dd>
                    <dt className={KEY}>Semester</dt><dd className="m-0">{course.term || "—"}</dd>
                    <dt className={KEY}>Classes</dt><dd className="m-0">{course.meetings.length ? course.meetings.length + " a week" : "—"}</dd>
                    <dt className={KEY}>Members</dt><dd className="m-0">{space.members.length}</dd>
                </dl>
                {editor && <Button variant="ghost" className="self-start" onClick={() => openSheet({ kind: "course", id: classKey })}>Edit class details</Button>}
            </Section>
            <Section title="Items" note={String(shown.length)}>
                {shown.length === 0 ? <Note>No items in this class yet.</Note> : (
                    <ul aria-label="Class items" className={LIST}>
                        {shown.map((it) => (
                            <li key={it.id} className={ROW}>
                                <button type="button" onClick={() => openSheet({ kind: "item", id: scope + "/" + it.id })}
                                    className="min-w-0 flex-1 cursor-pointer truncate border-0 bg-transparent p-0 text-left font-[inherit] text-foreground hover:underline">{it.title}</button>
                                <span className="shrink-0 text-[11px] text-muted-foreground">
                                    {tmeta(it.type).label} · {shortDate(it.date)}{it.weight != null ? " · " + it.weight + "%" : ""}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </Section>
            <Yours space={space} pref={pref} />
            <Grades title="Your grade so far" course={yours} items={mine} whatIf={whatIf} setWhatIf={setWhatIf} onTarget={(target) => void savePref(space.id, { target })} />
            {hidden.length > 0 && (
                <Section title="Hidden from you" note={String(hidden.length)}>
                    <ul aria-label="Hidden from you" className={LIST}>
                        {hidden.map((it) => (
                            <li key={it.id} className={cn(ROW, "items-center")}>
                                <span className="min-w-0 flex-1 truncate text-muted-foreground">{it.title}</span>
                                <Button variant="ghost" aria-label={"Show " + it.title + " again"} onClick={() => void setHidden(scope + "/" + it.id, false)}>Show again</Button>
                            </li>
                        ))}
                    </ul>
                </Section>
            )}
            <RemovedList space={space} course={course.name} />
            <ClassActions space={space} name={course.name} />
        </>
    )
}

/* Your settings for the class: only you see them (spec §4). */
function Yours({ space, pref }: { space: Space; pref: SpacePref | null }) {
    const f = useId(), cal = schoolCal()
    if (!pref) return <Section title="Yours"><Note>Your colour and semester for this class arrive with the next sync.</Note></Section>
    const set = (patch: Partial<SpacePref>) => void savePref(space.id, patch)
    const terms = cal ? semesterOptions(cal) : []
    return (
        <Section title="Yours" note="Only you see these">
            <Fields>
                <Label>Colour</Label>
                <Swatches value={pref.color} colors={PALETTE} onChange={(color) => set({ color })} />
                {cal && <>
                    <Label htmlFor={f + "term"}>Semester</Label>
                    <Select id={f + "term"} value={pref.term} onChange={(e) => set({ term: e.target.value })}>
                        {terms.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                        {pref.term && !terms.some(([v]) => v === pref.term) && <option value={pref.term}>{pref.term}</option>}
                    </Select>
                </>}
                <Label htmlFor={f + "arch"}>Archived</Label>
                <Checkbox id={f + "arch"} checked={pref.archived} onChange={(archived) => set({ archived })}>hidden from your sidebar, items kept</Checkbox>
            </Fields>
        </Section>
    )
}
