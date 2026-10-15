// A space's history (spec §12, §15): the Activity tab of a class's sheet, and from Stage 9 a
// project's. Fetched when the tab opens, 30 rows at a time; it needs a connection. A row opens
// the item it is about while that is on this device; the rest only read.

import { useEffect, useRef, useState } from "react"
import { ago } from "@/core/dates"
import { data } from "@/core/store"
import { describe, loadActivity, openable, openRow } from "@/data/inbox"
import type { ActivityRow } from "@/data/types"
import { Button, Note } from "./fields"

const ROW = "flex flex-col gap-0.5 rounded-lg bg-muted px-2.5 py-1.5 text-[12.5px]"

export function ActivityList({ spaceId }: { spaceId: string }) {
    const [rows, setRows] = useState<ActivityRow[] | null>(null)
    const [more, setMore] = useState(false)
    const [offline, setOffline] = useState(false)
    const [busy, setBusy] = useState(false)
    /* the space the shown rows belong to: a page that comes back for another one is dropped */
    const live = useRef(spaceId)
    const me = data.profile?.id ?? ""

    const load = async (before?: number) => {
        const sid = spaceId
        setBusy(true)
        const page = await loadActivity(sid, before)
        if (live.current !== sid) return
        setBusy(false)
        if (!page) { setOffline(true); return }
        setOffline(false)
        setRows((r) => (before ? [...(r ?? []), ...page.items] : page.items))
        setMore(page.more)
    }
    useEffect(() => {
        live.current = spaceId
        setRows(null); setMore(false); setOffline(false)
        void load()
        return () => { live.current = "" }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [spaceId])

    if (offline && !rows) return <Note>Connect to see activity.</Note>
    if (!rows) return <Note>Loading…</Note>
    if (!rows.length) return <Note>Nothing has happened here yet.</Note>
    return (
        <>
            <ul aria-label="Activity" className="m-0 flex list-none flex-col gap-1 p-0">
                {rows.map((r) => {
                    const body = (
                        <>
                            <span>{describe(r, me)}</span>
                            <span className="text-[11px] text-muted-foreground">{ago(r.at)}</span>
                        </>
                    )
                    if (!openable(r, spaceId)) return <li key={r.seq} className={ROW}>{body}</li>
                    return (
                        <li key={r.seq}>
                            <button type="button" onClick={() => openRow(r, spaceId)} className={ROW + " w-full cursor-pointer border-0 text-left font-[inherit] text-foreground hover:bg-accent"}>
                                {body}
                            </button>
                        </li>
                    )
                })}
            </ul>
            {offline && <Note>Connect to see older activity.</Note>}
            {more && <Button variant="ghost" className="self-start" disabled={busy} onClick={() => void load(rows[rows.length - 1].seq)}>Show older</Button>}
        </>
    )
}
