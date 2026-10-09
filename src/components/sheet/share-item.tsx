// "Share with the class" on an item of yours filed under a class (spec §13): for its owner and
// editors, while it isn't archived; a built-in type only, never a lecture review. Your status,
// grade and notes move into your own layer on the class's new item.

import { useState } from "react"
import { useSpaces } from "@/data/store"
import { useMaintenance } from "@/data/maintenance"
import { canShareItem, shareItem } from "@/data/leave"
import { messageFor } from "@/data/classes"
import { flush } from "@/data/item-edit"
import type { Item } from "@/data/types"
import { SharedGlyph } from "@/components/shared-glyph"
import { Button, Note, Section } from "./fields"

export function ShareItem({ item }: { item: Item }) {
    const space = useSpaces().find((s) => s.id === item.classId) ?? null
    const maintenance = useMaintenance("classes")
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState("")
    if (maintenance === "blocked" || !space || !canShareItem(item, space)) return null
    const go = async () => {
        setBusy(true)
        /* what is still being typed saves first, so the share carries it */
        try { await flush(); await shareItem(item.id, space.id, space.name); setErr("") } catch (e) { setErr(messageFor(e)) } finally { setBusy(false) }
    }
    return (
        <Section title={<><SharedGlyph /> Share with the class</>}>
            <Note>Make it a {space.name} item for everyone. Your status, grade and notes stay yours.{item.links?.length ? " Links become visible to the class." : ""}</Note>
            <Button variant="ghost" className="self-start" disabled={busy} onClick={() => void go()}>Share with the class</Button>
            {err && <Note tone="bad">{err}</Note>}
        </Section>
    )
}
