// Joining a class (spec §11, §20), for admins until Stage 6: with a code (a /#join= link
// fills it in), or straight after accepting an invite. The class downloads onto this
// device, then the sheet says you are in. Your semester and colour for it come with
// Stage 4 (space_prefs), the school-calendar offer with Stage 6. While the admins have
// shared classes switched off, everyone else gets the maintenance page instead.

import { useEffect, useState } from "react"
import { normalizeCode } from "@/core/shared"
import { closeSheet } from "@/data/overlay"
import { download, joinWithCode, messageFor, openClass } from "@/data/classes"
import { useMaintenance } from "@/data/maintenance"
import { MaintenanceBar, MaintenancePage } from "@/components/maintenance"
import type { SpaceSummary } from "@/data/types"
import { Button, Note, SheetBody, SheetFoot, SheetHead, TextInput } from "./fields"

type Stage = { at: "code" } | { at: "loading"; space: SpaceSummary } | { at: "done"; space: SpaceSummary; here: boolean }
const TITLE = "m-0 text-[22px] leading-[1.22] font-[750] tracking-[-.02em] text-foreground"
const asRole = (role: string) => (role === "editor" ? "an editor" : "a " + role)

export function JoinSheet({ code, space }: { code: string; space: SpaceSummary | null }) {
    const maintenance = useMaintenance("classes")
    if (maintenance !== "blocked") return <Join given={code} space={space} bar={maintenance === "admin"} />
    return (
        <>
            <SheetHead kind="Join a class" onClose={closeSheet} />
            <SheetBody><MaintenancePage feature="classes" inSheet /></SheetBody>
        </>
    )
}

function Join({ given, space, bar }: { given: string; space: SpaceSummary | null; bar: boolean }) {
    const [code, setCode] = useState(given)
    const [stage, setStage] = useState<Stage>(space ? { at: "loading", space } : { at: "code" })
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState("")

    /* the class's rows download, then the sheet says so */
    useEffect(() => {
        if (stage.at !== "loading") return
        let live = true
        void download(stage.space.id).then((here) => { if (live) setStage({ at: "done", space: stage.space, here }) })
        return () => { live = false }
    }, [stage])

    const join = async () => {
        if (!normalizeCode(code)) { setErr("A code is 8 characters."); return }
        setBusy(true); setErr("")
        try { setStage({ at: "loading", space: await joinWithCode(code) }) }
        catch (e) { setErr(messageFor(e)) }
        finally { setBusy(false) }
    }

    const maintenanceBar = bar && <MaintenanceBar className="mb-0" />
    if (stage.at === "loading") return (
        <>
            <SheetHead kind="Joining" onClose={closeSheet} />
            <SheetBody>
                {maintenanceBar}
                <div role="status"><h2 className={TITLE}>Downloading {stage.space.name}…</h2></div>
                <Note>The class's course and items land on this device, so they work offline.</Note>
            </SheetBody>
        </>
    )
    if (stage.at === "done") {
        const { space: s, here } = stage
        return (
            <>
                <SheetHead kind="Joined" onClose={closeSheet} />
                <SheetBody>
                    {maintenanceBar}
                    <h2 className={TITLE}>You're in {s.name}</h2>
                    <Note>{s.members} {s.members === 1 ? "member" : "members"} · you joined as {asRole(s.role)}.</Note>
                    {!here && <Note>It hasn't finished downloading. It arrives with the next sync.</Note>}
                </SheetBody>
                <SheetFoot hint="">
                    <Button variant="ghost" onClick={closeSheet}>Done</Button>
                    <Button onClick={() => openClass(s.id)}>Open the class</Button>
                </SheetFoot>
            </>
        )
    }
    return (
        <>
            <SheetHead kind="Join a class" onClose={closeSheet} />
            <SheetBody>
                {maintenanceBar}
                <h2 className={TITLE}>Join with a code</h2>
                <Note>Eight characters from the class's owner. A link with #join= in it fills this in for you.</Note>
                <TextInput aria-label="Join code" value={code} maxLength={9} placeholder="7KQ2 M9XD" autoFocus spellCheck={false} autoComplete="off"
                    className="h-[46px] font-mono text-[18px] tracking-[.12em] uppercase"
                    onChange={(e) => { setCode(e.target.value); setErr("") }}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void join() } }} />
                {err && <Note tone="bad">{err}</Note>}
            </SheetBody>
            <SheetFoot hint="Needs a connection">
                <Button variant="ghost" onClick={closeSheet}>Cancel</Button>
                <Button disabled={busy} onClick={() => void join()}>Join</Button>
            </SheetFoot>
        </>
    )
}
