// Joining a class (spec §11, §20): with a code (a /#join= link
// fills it in), or straight after accepting an invite. The class downloads onto this device;
// then you confirm your semester for it (with a school calendar) and your colour, and, when a
// course of yours matches the class, go on to merge it. Someone with no school calendar is
// offered the class's (its owner's snapshot), saved as their own. While the admins have
// shared classes switched off, everyone else gets the maintenance page instead.

import { useEffect, useId, useState } from "react"
import { normalizeCode } from "@/core/shared"
import { PALETTE } from "@/core/model"
import { currentTerm, normalizeSchool, type SchoolCalendar } from "@/core/school"
import { today } from "@/core/dates"
import { data } from "@/core/store"
import { api } from "@/core/api"
import { closeSheet } from "@/data/overlay"
import { download, joinWithCode, joinMessageFor, messageFor, openClass, savePref } from "@/data/classes"
import { matchFor, openMerge } from "@/data/merge"
import { schoolCal } from "@/data/query"
import { semesterOptions } from "@/data/course-edit"
import { adoptSchool } from "@/data/school-edit"
import { useMaintenance } from "@/data/maintenance"
import { MaintenanceBar, MaintenancePage } from "@/components/maintenance"
import type { SpaceSummary } from "@/data/types"
import { Button, Fields, Label, Note, Select, SheetBody, SheetFoot, SheetHead, Swatches, TextInput } from "./fields"

type Stage = { at: "code" } | { at: "loading"; space: SpaceSummary } | { at: "done"; space: SpaceSummary; here: boolean }
const TITLE = "m-0 text-[22px] leading-[1.22] font-[750] tracking-[-.02em] text-foreground"
const asRole = (role: string) => (role === "editor" ? "an editor" : "a " + role)

/** The semester offered for a class (spec §8): its own when your calendar has a semester of that name, else the one covering today. */
export function joinTerm(classTerm: string, cal: SchoolCalendar | null, day = today()): string {
    if (!cal) return classTerm
    return cal.terms.some((t) => t.name === classTerm) ? classTerm : currentTerm(cal, day)?.name ?? ""
}

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
        catch (e) { setErr(joinMessageFor(e)) }
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
    if (stage.at === "done") return <Joined space={stage.space} here={stage.here} bar={bar} />
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

/* In: your semester and colour for the class (your prefs, written by the Worker when you
   joined, adjusted here), then the class, or the merge sheet for a course of yours like it. */
function Joined({ space: s, here, bar }: { space: SpaceSummary; here: boolean; bar: boolean }) {
    const f = useId()
    const [cal, setCal] = useState(() => schoolCal())
    const pref = (data.space_prefs ?? []).find((p) => p.id === s.id) ?? null
    const classTerm = (data.shared_courses ?? []).find((c) => c.scope === s.scope)?.term ?? ""
    const [color, setColor] = useState(pref?.color ?? "")
    const [term, setTerm] = useState(() => joinTerm(pref?.term ?? classTerm, cal))
    const match = matchFor(s.id)
    const [err, setErr] = useState("")
    /* with no school calendar of your own, the class's is offered */
    const [offer, setOffer] = useState<SchoolCalendar | null>(null)
    useEffect(() => {
        if (cal) return
        let live = true
        api.spaces.get(s.id).then((d) => { if (live) setOffer(normalizeSchool(d.schoolCalendar)) }, () => {})
        return () => { live = false }
    }, [s.id, cal])
    const [taking, setTaking] = useState(false)
    const take = async (offered: SchoolCalendar) => {
        setTaking(true)
        try {
            await adoptSchool(offered)
            const now = schoolCal()
            setCal(now); setOffer(null)
            setTerm(joinTerm(pref?.term ?? classTerm, now))
        } catch { setErr("The school calendar didn't save. Try again.") } finally { setTaking(false) }
    }
    const go = async (next: () => void) => {
        try { if (pref && (color !== pref.color || term !== pref.term)) await savePref(s.id, { color, term }) }
        catch (e) { setErr(messageFor(e)); return }
        next()
    }
    const terms = cal ? semesterOptions(cal) : []
    return (
        <>
            <SheetHead kind="Joined" onClose={closeSheet} />
            <SheetBody>
                {bar && <MaintenanceBar className="mb-0" />}
                <h2 className={TITLE}>You're in {s.name}</h2>
                <Note>{s.members} {s.members === 1 ? "member" : "members"} · you joined as {asRole(s.role)}.</Note>
                {!here && <Note>It hasn't finished downloading. It arrives with the next sync.</Note>}
                {!cal && offer && (
                    <div role="note" className="flex flex-wrap items-center gap-2 rounded-lg bg-muted px-2.5 py-2 text-[12px]">
                        <span className="min-w-0 flex-1">{s.name} has a school calendar: semesters, breaks and days off. Use it as yours?</span>
                        <Button variant="ghost" disabled={taking} onClick={() => void take(offer)}>Use the class's school calendar</Button>
                    </div>
                )}
                {pref && (
                    <Fields>
                        {cal && <>
                            <Label htmlFor={f + "term"}>Your semester</Label>
                            <Select id={f + "term"} value={term} onChange={(e) => setTerm(e.target.value)}>
                                {terms.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                            </Select>
                        </>}
                        <Label>Your colour</Label>
                        <Swatches value={color} colors={PALETTE} onChange={setColor} />
                    </Fields>
                )}
                {match && <Note>You have a course of your own like it, {match.name}. Merge it next, so your grades and notes sit on the class's items.</Note>}
                {err && <Note tone="bad">{err}</Note>}
            </SheetBody>
            <SheetFoot hint="Only you see your colour and semester">
                <Button variant="ghost" onClick={() => void go(closeSheet)}>Done</Button>
                {match
                    ? <Button onClick={() => void go(() => openMerge(s.id, match.id, false))}>Merge my course</Button>
                    : <Button onClick={() => void go(() => openClass(s.id))}>Open the class</Button>}
            </SheetFoot>
        </>
    )
}
