// A space's history (spec §12, §15): the Activity tab of a class's sheet, and from Stage 9 a
// project's. Fetched when the tab opens, 30 rows at a time; it needs a connection. A row opens
// the item it is about while that is on this device; the rest only read.

import { useEffect, useRef, useState } from "react"
import { ago } from "@/core/dates"
import { data } from "@/core/store"
import { messageFor } from "@/data/classes"
import { describe, loadActivity, openable, openRow } from "@/data/inbox"
import type { ActivityRow } from "@/data/types"
import { Button, Note } from "./fields"

const ROW = "flex flex-col gap-0.5 rounded-lg bg-muted px-2.5 py-1.5 text-[12.5px] outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--accent)]"

export function ActivityList({ spaceId }: { spaceId: string }) {
    const [rows, setRows] = useState<ActivityRow[] | null>(null)
    const [more, setMore] = useState(false)
    const [offline, setOffline] = useState(false)
    const [error, setError] = useState("")
    const [busy, setBusy] = useState(false)
    /* the first row a Show older brought (0: the list itself, when it brought none), for focus to move to */
    const [landing, setLanding] = useState<number | null>(null)
    /* each request's number: an answer to any but the latest (another space, an unmounted tab) is dropped */
    const req = useRef(0)
    const list = useRef<HTMLUListElement>(null)
    const me = data.profile?.id ?? ""

    const load = async (before?: number) => {
        const n = ++req.current
        setBusy(true)
        let page: Awaited<ReturnType<typeof loadActivity>>
        try { page = await loadActivity(spaceId, before) } catch (e) {
            if (n !== req.current) return
            setBusy(false); setOffline(false); setError(messageFor(e))
            return
        }
        if (n !== req.current) return
        setBusy(false)
        setError("")
        if (!page) { setOffline(true); return }
        const { items, more: older } = page
        setOffline(false)
        setRows((r) => (before ? [...(r ?? []), ...items] : items))
        setMore(older)
        if (before) setLanding(items[0]?.seq ?? 0)
    }
    useEffect(() => {
        setRows(null); setMore(false); setOffline(false); setError(""); setLanding(null)
        void load()
        return () => { req.current++ }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [spaceId])

    /* Show older may unmount itself on the last page: focus goes on to what it brought */
    useEffect(() => {
        if (landing === null) return
        const li = landing ? list.current?.querySelector<HTMLElement>(`[data-seq="${landing}"]`) : null
        const to = li ? li.querySelector<HTMLElement>("button") ?? li : list.current
        to?.focus()
        setLanding(null)
    }, [landing])

    const note = error ? <Note tone="bad">{error}</Note>
        : offline ? <Note>{rows ? "Connect to see older activity." : "Connect to see activity."}</Note>
        : !rows ? <Note>Loading…</Note>
        : !rows.length ? <Note>Nothing has happened here yet.</Note>
        : null
    return (
        <>
            {rows && rows.length > 0 && (
                <ul ref={list} tabIndex={-1} aria-label="Activity" className="m-0 flex list-none flex-col gap-1 p-0 outline-none">
                    {rows.map((r) => {
                        const body = (
                            <>
                                <span>{describe(r, me)}</span>
                                <span className="text-[11px] text-muted-foreground">{ago(r.at)}</span>
                            </>
                        )
                        if (!openable(r, spaceId)) return <li key={r.seq} data-seq={r.seq} tabIndex={-1} className={ROW}>{body}</li>
                        return (
                            <li key={r.seq} data-seq={r.seq}>
                                <button type="button" onClick={() => openRow(r, spaceId)} className={ROW + " w-full cursor-pointer border-0 text-left font-[inherit] text-foreground hover:bg-accent"}>
                                    {body}
                                </button>
                            </li>
                        )
                    })}
                </ul>
            )}
            <div role="status">{note}</div>
            {!rows && (offline || error) && <Button variant="ghost" className="self-start" disabled={busy} onClick={() => void load()}>Try again</Button>}
            {rows && more && <Button variant="ghost" className="self-start" disabled={busy} onClick={() => void load(rows[rows.length - 1].seq)}>Show older</Button>}
        </>
    )
}
