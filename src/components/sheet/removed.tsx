// Class items an editor removed (spec §13, §15). The list in the class sheet: the ones you hold
// something on (Keep as mine / Dismiss), hidden from you or not, since the server keeps them for
// you either way; and, for the owner and editors, every one (Restore). The card a removed item
// opens comes in RemovedCard.

import { useState } from "react"
import { useMarks, useProfile, useRemovedItems } from "@/data/store"
import { meaningful } from "@/data/effective"
import { markIdOf } from "@/data/marks"
import { dismissItem, keepItem, removedLine, restoreItem } from "@/data/leave"
import { messageFor } from "@/data/classes"
import type { Space } from "@/data/types"
import { Button, Note, Section } from "./fields"

const LIST = "m-0 flex list-none flex-col gap-1 p-0"
const ROW = "flex flex-wrap items-center gap-2 rounded-lg bg-muted px-2.5 py-1.5 text-[12.5px]"

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
