// A shared class in the sheet (spec §15), for admins until Stage 6: its facts and its items
// as the class keeps them, read-only until the split item card (Stage 4), and its members.
// What is yours about it (colour, semester, grades) arrives with Stage 4. While the admins
// have shared classes switched off, everyone else gets the maintenance page instead.

import { useId } from "react"
import { cn } from "@/lib/utils"
import { tmeta } from "@/core/model"
import { shortDate } from "@/core/dates"
import { useSharedCourses, useSharedItems, useSpaces } from "@/data/store"
import { closeSheet, replaceSheet, type ClassTab } from "@/data/overlay"
import type { SharedCourse, SharedItem, Space } from "@/data/types"
import { useMaintenance } from "@/data/maintenance"
import { SharedGlyph } from "@/components/shared-glyph"
import { MaintenanceBar, MaintenancePage } from "@/components/maintenance"
import { tabKeys } from "./radio-keys"
import { Button, Note, Section, SheetBody, SheetFoot, SheetHead } from "./fields"
import { MembersTab } from "./members-tab"

const TABS: readonly [ClassTab, string][] = [["details", "Details"], ["members", "Members"]]
const TITLE = "m-0 text-[22px] leading-[1.22] font-[750] tracking-[-.02em] text-foreground"

export function ClassSheet({ spaceId, tab }: { spaceId: string; tab: ClassTab }) {
    const maintenance = useMaintenance("classes")
    if (maintenance !== "blocked") return <ClassCard spaceId={spaceId} tab={tab} bar={maintenance === "admin"} />
    return (
        <>
            <SheetHead kind="Class" onClose={closeSheet} />
            <SheetBody><MaintenancePage feature="classes" inSheet /></SheetBody>
        </>
    )
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
                    {tab === "details" ? <Details space={space} course={course} items={items} /> : <MembersTab spaceId={spaceId} />}
                </div>
            </SheetBody>
            <SheetFoot hint={n + (n === 1 ? " member" : " members")}>
                <Button onClick={closeSheet}>Done</Button>
            </SheetFoot>
        </>
    )
}

const KEY = "text-muted-foreground"

function Details({ space, course, items }: { space: Space; course: SharedCourse; items: SharedItem[] }) {
    return (
        <>
            <Section title={<><SharedGlyph /> Class</>} note={space.role === "member" ? "The owner and editors keep it" : undefined}>
                <dl className="m-0 grid grid-cols-[86px_minmax(0,1fr)] gap-x-2.5 gap-y-1.5 text-[12.5px]">
                    <dt className={KEY}>Code</dt><dd className="m-0">{course.code || "—"}</dd>
                    <dt className={KEY}>Teacher</dt><dd className="m-0">{course.instructor || "—"}</dd>
                    <dt className={KEY}>Semester</dt><dd className="m-0">{course.term || "—"}</dd>
                    <dt className={KEY}>Classes</dt><dd className="m-0">{course.meetings.length ? course.meetings.length + " a week" : "—"}</dd>
                    <dt className={KEY}>Members</dt><dd className="m-0">{space.members.length}</dd>
                </dl>
            </Section>
            <Section title="Items" note={String(items.length)}>
                {items.length === 0 ? <Note>No items in this class yet.</Note> : (
                    <ul aria-label="Class items" className="m-0 flex list-none flex-col gap-1 p-0">
                        {items.map((it) => (
                            <li key={it.id} className="flex items-baseline gap-2 rounded-lg bg-muted px-2.5 py-1.5 text-[12.5px]">
                                <span className="min-w-0 flex-1 truncate">{it.title}</span>
                                <span className="shrink-0 text-[11px] text-muted-foreground">
                                    {tmeta(it.type).label} · {shortDate(it.date)}{it.weight != null ? " · " + it.weight + "%" : ""}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </Section>
        </>
    )
}
