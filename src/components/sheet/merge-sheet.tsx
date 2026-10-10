// Merging a course of yours into a class (spec §11, §13). Your
// items are paired with the class's; "Not the same item" undoes a pair, and an unsure pair
// was never made. Merge moves your status, grades and notes onto the class's items and files
// the rest under the class; Skip changes nothing, and the class sheet offers it again. While
// the admins have shared classes switched off, everyone else gets the maintenance page instead.

import { useState } from "react"
import { tmeta } from "@/core/model"
import { shortDate } from "@/core/dates"
import { useCourses, useItems, useSharedItems, useSpaces } from "@/data/store"
import { closeSheet } from "@/data/overlay"
import { mergeCourse, pairItems } from "@/data/merge"
import { messageFor } from "@/data/classes"
import { useMaintenance } from "@/data/maintenance"
import type { EffectiveCourse, EffectiveItem } from "@/data/effective"
import { MaintenanceBar, MaintenancePage } from "@/components/maintenance"
import { Button, Note, Section, SheetBody, SheetFoot, SheetHead } from "./fields"

const TITLE = "m-0 text-[22px] leading-[1.22] font-[750] tracking-[-.02em] text-foreground"
const ROW = "flex items-center gap-2 rounded-lg bg-muted px-2.5 py-1.5 text-[12.5px]"

type Props = { spaceId: string; courseId: string; fromCourse: boolean }

export function MergeSheet(props: Props) {
    const maintenance = useMaintenance("classes")
    if (maintenance !== "blocked") return <Merge {...props} bar={maintenance === "admin"} />
    return (
        <>
            <SheetHead kind="Merge into the class" onClose={closeSheet} />
            <SheetBody><MaintenancePage feature="classes" inSheet /></SheetBody>
        </>
    )
}

function Merge({ spaceId, courseId, fromCourse, bar }: Props & { bar: boolean }) {
    const scope = "c:" + spaceId
    const space = useSpaces().find((s) => s.id === spaceId) ?? null
    const course = (useCourses() as EffectiveCourse[]).find((c) => !c.source && c.id === courseId) ?? null
    const mine = (useItems() as EffectiveItem[]).filter((it) => !it.source && it.courseId === courseId).sort((a, b) => a.date.localeCompare(b.date))
    const theirs = useSharedItems().filter((it) => it.scope === scope)
    const [chosen, setPairs] = useState(() => pairItems(mine, theirs).pairs)
    /* a pair whose item a sync took away while the sheet was open drops out of the count and the merge */
    const pairs = chosen.filter(([m, s]) => mine.some((it) => it.id === m) && theirs.some((it) => it.id === s))
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState("")

    if (!space || !course) return (
        <>
            <SheetHead kind="Merge into the class" onClose={closeSheet} />
            <SheetBody><Note>Nothing to merge: the course or the class is no longer on this device.</Note></SheetBody>
            <SheetFoot hint=""><Button onClick={closeSheet}>Done</Button></SheetFoot>
        </>
    )
    const paired = new Set(pairs.map(([m]) => m))
    const apart = mine.filter((it) => !paired.has(it.id))
    const merge = async () => {
        setBusy(true); setErr("")
        try { await mergeCourse(spaceId, courseId, pairs, fromCourse) } catch (e) { setErr(messageFor(e)); setBusy(false) }
    }

    return (
        <>
            <SheetHead color={course.color} kind="Merge into the class" onClose={closeSheet} />
            <SheetBody>
                {bar && <MaintenanceBar className="mb-0" />}
                <h2 className={TITLE}>Merge {course.name} into {space.name}</h2>
                <Note>Paired items become the class's, with your status, grade and notes on top, seen only by you. The rest stay yours, filed under the class. Your course goes once it is empty.</Note>
                <Section title="Pairs" note={String(pairs.length)}>
                    {pairs.length === 0 ? <Note>Nothing pairs up: every item stays yours.</Note> : (
                        <ul aria-label="Pairs" className="m-0 flex list-none flex-col gap-1 p-0">
                            {pairs.map(([m, s]) => {
                                const a = mine.find((x) => x.id === m), b = theirs.find((x) => x.id === s)
                                if (!a || !b) return null
                                return (
                                    <li key={m} className={ROW}>
                                        <span className="flex min-w-0 flex-1 flex-col">
                                            <span className="truncate">{a.title} <span className="text-muted-foreground">· {shortDate(a.date)}</span></span>
                                            <span className="truncate text-[11px] text-muted-foreground">→ {b.title} · {shortDate(b.date)}</span>
                                        </span>
                                        <Button variant="ghost" aria-label={"Not the same item: " + a.title} onClick={() => setPairs(pairs.filter(([x]) => x !== m))}>Not the same item</Button>
                                    </li>
                                )
                            })}
                        </ul>
                    )}
                </Section>
                {apart.length > 0 && (
                    <Section title="Stay yours, under the class" note={String(apart.length)}>
                        <ul aria-label="Stay yours" className="m-0 flex list-none flex-col gap-1 p-0">
                            {apart.map((it) => <li key={it.id} className={ROW}>{it.title} · {tmeta(it.type).label}</li>)}
                        </ul>
                    </Section>
                )}
                {err && <Note tone="bad">{err}</Note>}
            </SheetBody>
            <SheetFoot hint="Needs a connection">
                <Button variant="ghost" onClick={closeSheet}>Skip</Button>
                <Button disabled={busy} onClick={() => void merge()}>{busy ? "Merging…" : "Merge"}</Button>
            </SheetFoot>
        </>
    )
}
