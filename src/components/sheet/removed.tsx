// Class items an editor removed (spec §13, §15). The list in the class sheet: the ones you hold
// something on (Keep as mine / Dismiss), hidden from you or not, since the server keeps them for
// you either way; and, for the owner and editors, every one (Restore). And the card a removed
// item opens (RemovedCard): your layer on it is read-only, as the Worker refuses a mark there.

import { useState } from "react"
import { useMarks, useProfile, useRemovedItems } from "@/data/store"
import { meaningful } from "@/data/effective"
import { markIdOf } from "@/data/marks"
import { dismissItem, keepItem, removedLine, restoreItem } from "@/data/leave"
import { messageFor } from "@/data/classes"
import { closeSheet } from "@/data/overlay"
import { tmeta } from "@/core/model"
import { shortDate } from "@/core/dates"
import { MaintenanceBar } from "@/components/maintenance"
import type { SharedItem, Space } from "@/data/types"
import { Button, Note, Section, SheetBody, SheetFoot, SheetHead } from "./fields"

const LIST = "m-0 flex list-none flex-col gap-1 p-0"
const ROW = "flex flex-wrap items-center gap-2 rounded-lg bg-muted px-2.5 py-1.5 text-[12.5px]"
const TITLE = "m-0 font-serif text-[30px] leading-[1.15] font-[500] tracking-[-.015em]"

export function RemovedList({ space, course }: { space: Space; course: string }) {
    const me = useProfile()?.id
    const marks = useMarks()
    const removed = useRemovedItems()
    const editor = space.role !== "member" && !space.archived
    const [err, setErr] = useState("")
    /* the row whose Keep, Dismiss or Restore is on its way: its buttons wait, so a second click sends nothing */
    const [busy, setBusy] = useState<string | null>(null)
    const rows = removed.filter((it) => it.scope === space.scope).map((it) => {
        const key = it.scope + "/" + it.id, mark = marks.find((m) => m.id === markIdOf(key)) ?? null
        return { it, key, mark, mine: !!mark && meaningful(mark) }
    }).filter((r) => editor || r.mine)
    if (!rows.length) return null
    const act = (key: string, fn: () => Promise<void>) => () => {
        setBusy(key)
        void fn().then(() => setErr(""), (e) => setErr(messageFor(e))).finally(() => setBusy(null))
    }
    return (
        <Section title="Removed from the class" note={String(rows.length)}>
            <ul aria-label="Removed from the class" className={LIST}>
                {rows.map(({ it, key, mark, mine }) => (
                    <li key={key} className={ROW}>
                        <span className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate">{it.title}</span>
                            <span className="text-[11px] text-muted-foreground">{removedLine(it, space, course, me)}</span>
                        </span>
                        {editor && <Button variant="ghost" disabled={busy === key} aria-label={"Restore " + it.title} onClick={act(key, () => restoreItem(key))}>Restore</Button>}
                        {mark && <Button variant="ghost" disabled={busy === key} aria-label={"Dismiss " + it.title} onClick={act(key, () => dismissItem(key, { close: false }))}>Dismiss</Button>}
                        {mine && <Button variant="ghost" disabled={busy === key} aria-label={"Keep " + it.title + " as mine"} onClick={act(key, () => keepItem(key, { close: false }))}>Keep as mine</Button>}
                    </li>
                ))}
            </ul>
            {err && <Note tone="bad">{err}</Note>}
        </Section>
    )
}

/** A removed class item's card (spec §15): who removed it; Keep as mine and Dismiss when you hold something on it; Restore for the owner and editors. Read-only otherwise. */
export function RemovedCard({ row, space, course, bar }: { row: SharedItem; space: Space; course: string; bar: boolean }) {
    const me = useProfile()?.id
    const key = row.scope + "/" + row.id
    const mark = useMarks().find((m) => m.id === markIdOf(key)) ?? null
    const mine = !!mark && meaningful(mark)
    const editor = space.role !== "member" && !space.archived
    const [err, setErr] = useState("")
    /* Keep, Dismiss or Restore on its way: the buttons wait, so a second click sends nothing */
    const [busy, setBusy] = useState(false)
    const act = (fn: () => Promise<void>) => () => {
        setBusy(true)
        void fn().then(() => setErr(""), (e) => setErr(messageFor(e))).finally(() => setBusy(false))
    }
    const counts = mark?.grade != null ? "Your grade of " + mark.grade + "% still counts" : "What you added still counts"
    return (
        <>
            <SheetHead color={tmeta(row.type).color} kind={tmeta(row.type).label} onClose={closeSheet} />
            <SheetBody className="gap-[18px] px-6 pt-3 pb-7 max-[700px]:px-4">
                {bar && <MaintenanceBar className="mb-0" />}
                <div role="note" className="rounded-lg border border-[var(--warn-line)] bg-[var(--warn-bg)] px-2.5 py-2 text-[12px] text-[var(--warn-ink)]">
                    {removedLine(row, space, course, me)}
                </div>
                <h2 className={TITLE}>{row.title}</h2>
                <Note>{[tmeta(row.type).label, row.date ? shortDate(row.date) : "", row.weight != null ? row.weight + "%" : ""].filter(Boolean).join(" · ")}</Note>
                <Note>{mine ? counts + " until you choose. Keep it as your own item, or dismiss it." : "Nothing of yours is on it."}</Note>
                {err && <Note tone="bad">{err}</Note>}
            </SheetBody>
            <SheetFoot hint="">
                {editor && <Button variant="ghost" disabled={busy} onClick={act(() => restoreItem(key))}>Restore for everyone</Button>}
                {mark && <Button variant="ghost" disabled={busy} onClick={act(() => dismissItem(key))}>Dismiss</Button>}
                {mine ? <Button disabled={busy} onClick={act(() => keepItem(key))}>Keep as mine</Button> : <Button onClick={closeSheet}>Done</Button>}
            </SheetFoot>
        </>
    )
}
