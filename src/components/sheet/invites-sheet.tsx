// Your invites to shared classes (spec §11), a plain list until the inbox (Stage 7): who
// sent each, with Accept or Decline. Accepting follows the class as it downloads. While the
// admins have shared classes switched off, everyone else gets the maintenance page instead.

import { useEffect, useState } from "react"
import { dayMonth, iso } from "@/core/dates"
import { closeSheet } from "@/data/overlay"
import { accept, decline, messageFor, openJoin, refreshInvites, useInvites } from "@/data/classes"
import { useMaintenance } from "@/data/maintenance"
import { MaintenanceBar, MaintenancePage } from "@/components/maintenance"
import type { Invite } from "@/data/types"
import { Button, Note, SheetBody, SheetFoot, SheetHead } from "./fields"

export function InvitesSheet() {
    const maintenance = useMaintenance("classes")
    if (maintenance !== "blocked") return <Invites bar={maintenance === "admin"} />
    return (
        <>
            <SheetHead kind="Invites" onClose={closeSheet} />
            <SheetBody><MaintenancePage feature="classes" inSheet /></SheetBody>
        </>
    )
}

function Invites({ bar }: { bar: boolean }) {
    const list = useInvites()
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState("")
    useEffect(() => { void refreshInvites() }, [])

    const yes = async (inv: Invite) => {
        setBusy(true); setErr("")
        try { openJoin("", await accept(inv.spaceId)) } catch (e) { setErr(messageFor(e)); setBusy(false) }
    }
    const no = async (inv: Invite) => {
        setBusy(true); setErr("")
        try { await decline(inv.spaceId) } catch (e) { setErr(messageFor(e)) } finally { setBusy(false) }
    }

    return (
        <>
            <SheetHead kind="Invites" onClose={closeSheet} />
            <SheetBody>
                {bar && <MaintenanceBar className="mb-0" />}
                <h2 className="m-0 text-[22px] leading-[1.22] font-[750] tracking-[-.02em]">Invites</h2>
                <Note>Invites to shared classes. Nothing is pushed: new ones show when Term opens or you come back to it.</Note>
                {list.length === 0 ? <Note>Nothing new.</Note> : (
                    <ul aria-label="Invites to you" className="m-0 flex list-none flex-col gap-1.5 p-0">
                        {list.map((inv) => (
                            <li key={inv.spaceId} className="flex flex-col gap-1.5 rounded-lg bg-muted px-3 py-2 text-[12.5px]">
                                <span><b>{inv.from}</b> invited you to the shared class <b>{inv.name}</b></span>
                                <span className="text-[11px] text-muted-foreground">As {inv.role} · {dayMonth(iso(new Date(inv.createdAt)))}</span>
                                {inv.expired ? <Note>This invite has expired. Ask for a new one.</Note> : (
                                    <span className="flex gap-2">
                                        <Button variant="ghost" disabled={busy} aria-label={"Decline the invite to " + inv.name} onClick={() => void no(inv)}>Decline</Button>
                                        <Button disabled={busy} aria-label={"Accept the invite to " + inv.name} onClick={() => void yes(inv)}>Accept</Button>
                                    </span>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
                {err && <Note tone="bad">{err}</Note>}
            </SheetBody>
            <SheetFoot hint="">
                <Button variant="ghost" onClick={closeSheet}>Close</Button>
            </SheetFoot>
        </>
    )
}
