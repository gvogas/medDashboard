// Converting a course of yours into a shared class (spec §13):
// tick the items the class takes. Tasks start unticked; lecture reviews and items of your
// own types cannot go. The course and the ticked items move into the class with your status,
// grades and notes on top (your marks); the rest stay yours, filed under the class. While the admins have shared
// classes switched off, everyone else gets the maintenance page instead.

import { useState } from "react"
import { cn } from "@/lib/utils"
import { tmeta } from "@/core/model"
import { shortDate } from "@/core/dates"
import { useCourses, useItems } from "@/data/store"
import { closeSheet } from "@/data/overlay"
import { convert, convertChoice, messageFor } from "@/data/classes"
import { MaintenanceBar } from "@/components/maintenance"
import { Button, Note, SheetBody, SheetFoot, SheetHead, Warning } from "./fields"
import { ClassesGate } from "./gate"

export function ConvertSheet({ courseId }: { courseId: string }) {
    return <ClassesGate kind="Convert to shared class">{(bar) => <Picker courseId={courseId} bar={bar} />}</ClassesGate>
}

function Picker({ courseId, bar }: { courseId: string; bar: boolean }) {
    const course = useCourses().find((c) => c.id === courseId) ?? null
    const items = useItems().filter((it) => it.courseId === courseId).sort((a, b) => a.date.localeCompare(b.date))
    const [ticked, setTicked] = useState<Record<string, boolean>>(() => Object.fromEntries(items.map((it) => [it.id, convertChoice(it).ticked])))
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState("")

    if (!course) return (
        <>
            <SheetHead kind="Convert to shared class" onClose={closeSheet} />
            <SheetBody><Note>That course is no longer here.</Note></SheetBody>
            <SheetFoot hint=""><Button onClick={closeSheet}>Done</Button></SheetFoot>
        </>
    )
    const chosen = items.filter((it) => ticked[it.id] && convertChoice(it).can)
    const go = async () => {
        setBusy(true); setErr("")
        try { await convert(courseId, chosen.map((it) => it.id)) } catch (e) { setErr(messageFor(e)); setBusy(false) }
    }

    return (
        <>
            <SheetHead color={course.color} kind="Convert to shared class" onClose={closeSheet} />
            <SheetBody>
                {bar && <MaintenanceBar className="mb-0" />}
                <h2 className="m-0 text-[22px] leading-[1.22] font-[750] tracking-[-.02em]">Share {course.name}</h2>
                <Note>Ticked items move into the class: everyone in it sees their dates, weights and class notes. Tasks start unticked.</Note>
                {items.length === 0 ? <Note>This course has no items. The class starts empty.</Note> : (
                    <ul className="m-0 flex list-none flex-col gap-1 p-0">
                        {items.map((it) => {
                            const c = convertChoice(it)
                            return (
                                <li key={it.id}>
                                    <label className={cn("flex items-center gap-2.5 rounded-lg bg-muted px-2.5 py-1.5 text-[12.5px]", c.can ? "cursor-pointer" : "opacity-70")}>
                                        <input type="checkbox" disabled={!c.can} checked={c.can && !!ticked[it.id]} className="size-3.5 accent-[var(--accent)]"
                                            onChange={(e) => setTicked({ ...ticked, [it.id]: e.target.checked })} />
                                        <span className="flex min-w-0 flex-1 flex-col">
                                            <span className="truncate">{it.title}</span>
                                            <span className="text-[11px] text-muted-foreground">
                                                {c.why || tmeta(it.type).label + " · " + shortDate(it.date) + (it.grade != null ? " · your grade " + it.grade + "% stays yours" : "")}
                                            </span>
                                        </span>
                                    </label>
                                </li>
                            )
                        })}
                    </ul>
                )}
                {chosen.some((it) => it.links.length > 0) && <Warning>Links on ticked items become visible to the class.</Warning>}
                <Note>Your status, grades and notes move with you and are never shared. Unticked items stay yours, filed under the class.</Note>
                {err && <Note tone="bad">{err}</Note>}
            </SheetBody>
            <SheetFoot hint={chosen.length + " of " + items.length + " items"}>
                <Button variant="ghost" onClick={closeSheet}>Cancel</Button>
                <Button disabled={busy} onClick={() => void go()}>{busy ? "Creating…" : "Create class"}</Button>
            </SheetFoot>
        </>
    )
}
