// The inbox (spec §12, §15): invites to you, with Accept or Decline, then what others did in
// your classes and projects that concerns you, newest first. Opening it marks everything
// read. Offline it shows the copy kept from last time. While the admins have shared classes
// switched off, everyone else gets the maintenance page instead.

import { useEffect, useRef, useState } from "react"
import { ago, dayMonth, iso } from "@/core/dates"
import { data } from "@/core/store"
import { closeSheet } from "@/data/overlay"
import { accept, decline, joinMessageFor, messageFor, openJoin } from "@/data/classes"
import { describe, markSeen, openRow, refreshInbox, useInbox, useInboxOffline } from "@/data/inbox"
import { useMaintenance } from "@/data/maintenance"
import { MaintenanceBar, MaintenancePage } from "@/components/maintenance"
import type { ActivityRow, Invite } from "@/data/types"
import { Button, Note, SheetBody, SheetFoot, SheetHead } from "./fields"

export function InboxSheet() {
    const maintenance = useMaintenance("classes")
    if (maintenance !== "blocked") return <InboxCard bar={maintenance === "admin"} />
    return (
        <>
            <SheetHead kind="Inbox" onClose={closeSheet} />
            <SheetBody><MaintenancePage feature="classes" inSheet /></SheetBody>
        </>
    )
}

const LIST = "m-0 flex list-none flex-col gap-1.5 p-0"
const ROW = "flex flex-col gap-1 rounded-lg bg-muted px-3 py-2 text-[12.5px]"
const kindWord = (k: string) => (k === "project" ? "team project" : "shared class")

function InboxCard({ bar }: { bar: boolean }) {
    const box = useInbox()
    const offline = useInboxOffline()
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState("")
    useEffect(() => { void refreshInbox().then(markSeen) }, [])
    /* what was read when the sheet first had the list, so rows new on opening keep their "New" while it is open */
    const seenAtOpen = useRef<number | null>(null)
    if (box && seenAtOpen.current === null) seenAtOpen.current = box.seen
    const me = data.profile?.id ?? ""

    const yes = async (inv: Invite) => {
        setBusy(true); setErr("")
        try { openJoin("", await accept(inv.spaceId)) } catch (e) { setErr(joinMessageFor(e)); setBusy(false) }
    }
    const no = async (inv: Invite) => {
        setBusy(true); setErr("")
        try { await decline(inv.spaceId) } catch (e) { setErr(messageFor(e)) } finally { setBusy(false) }
    }

    return (
        <>
            <SheetHead kind="Inbox" onClose={closeSheet} />
            <SheetBody>
                {bar && <MaintenanceBar className="mb-0" />}
                <h2 className="m-0 text-[22px] leading-[1.22] font-[750] tracking-[-.02em]">Inbox</h2>
                {offline && <Note>You're offline. This is what the inbox held last time.</Note>}
                {!box ? <Note>Loading…</Note> : (
                    <>
                        {box.invites.length > 0 && (
                            <ul aria-label="Invites to you" className={LIST}>
                                {box.invites.map((inv) => (
                                    <li key={inv.spaceId} className={ROW}>
                                        <span><b>{inv.from}</b> invited you to the {kindWord(inv.kind)} <b>{inv.name}</b></span>
                                        <span className="text-[11px] text-muted-foreground">As {inv.role} · {dayMonth(iso(new Date(inv.createdAt)))}</span>
                                        {inv.expired ? <Note>This invite has expired. Ask for a new one.</Note> : (
                                            <span className="flex gap-2">
                                                <Button variant="ghost" disabled={busy || offline} aria-label={"Decline the invite to " + inv.name} onClick={() => void no(inv)}>Decline</Button>
                                                <Button disabled={busy || offline} aria-label={"Accept the invite to " + inv.name} onClick={() => void yes(inv)}>Accept</Button>
                                            </span>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        )}
                        {box.items.length === 0 && box.invites.length === 0 && <Note>Nothing new. News from your classes shows here.</Note>}
                        {box.items.length > 0 && (
                            <ul aria-label="News" className={LIST}>
                                {box.items.map((r) => <NewsRow key={r.seq} row={r} me={me} unread={r.seq > (seenAtOpen.current ?? box.seen)} />)}
                            </ul>
                        )}
                    </>
                )}
                {err && <Note tone="bad">{err}</Note>}
            </SheetBody>
            <SheetFoot hint="Nothing is pushed: news comes with each sync.">
                <Button variant="ghost" onClick={closeSheet}>Close</Button>
            </SheetFoot>
        </>
    )
}

function NewsRow({ row, me, unread }: { row: ActivityRow; me: string; unread: boolean }) {
    return (
        <li>
            <button type="button" onClick={() => openRow(row)} className={ROW + " w-full cursor-pointer border-0 text-left font-[inherit] text-foreground hover:bg-accent"}>
                <span>{unread && <span className="sr-only">New: </span>}{describe(row, me)}</span>
                <span className="text-[11px] text-muted-foreground">{row.space} · {ago(row.at)}</span>
            </button>
        </li>
    )
}
