// Study together (spec §2): start a room. The flow everyone follows (the Quick start presets
// or your own), your class (only your minutes go to it), and the friends to invite. Any friend
// of yours can join without an invite. A run already going is ended and logged first, after a yes.

import { useEffect, useId, useState } from "react"
import { cn } from "@/lib/utils"
import { duration } from "@/lib/time"
import { closeSheet } from "@/data/overlay"
import { useUi } from "@/data/ui"
import { useMaintenance } from "@/data/maintenance"
import { friendsStale, loadFriends, useFriends } from "@/data/friends"
import { ROOM_INVITES } from "@/data/room"
import {
    flowTotals, pickCourse, pickItem, presetsFor, sameFlow, startRoomRun, useFlow, useRun, useStudyPick,
} from "@/data/study-timer"
import { MaintenancePage } from "@/components/maintenance"
import { Avatar } from "@/components/study/friends"
import type { Flow } from "@/data/types"
import { Button, Note, Section, Select, SheetBody, SheetFoot, SheetHead } from "./fields"

export function TogetherSheet({ invite }: { invite: string[] }) {
    const maintenance = useMaintenance("friends")
    if (maintenance === "blocked") {
        return (
            <>
                <SheetHead kind="Study together" onClose={closeSheet} />
                <SheetBody><MaintenancePage feature="friends" inSheet /></SheetBody>
            </>
        )
    }
    return <Together initial={invite} />
}

const CHIP = "hit cursor-pointer rounded-full border px-[11px] py-1 font-[inherit] text-[12px] font-semibold outline-none focus-visible:shadow-[0_0_0_2px_var(--accent)]"

function Together({ initial }: { initial: string[] }) {
    const own = useFlow()
    const bg = useUi((u) => u.bg)
    const presets = presetsFor(bg)
    const [flow, setFlow] = useState<Flow>(own)
    const pick = useStudyPick()
    const { list, offline, error } = useFriends()
    const [ticked, setTicked] = useState<string[]>(initial)
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState("")
    /* a run going: Start asks first, as starting a new run does */
    const running = useRun() !== null
    const [sure, setSure] = useState(false)
    const ids = useId()
    useEffect(() => { if (friendsStale()) void loadFriends() }, [])

    const totals = flowTotals(flow)
    const ownIsPreset = presets.some(([, p]) => sameFlow(p, own))
    const tick = (id: string, on: boolean) => setTicked((t) => (on ? [...t, id].slice(0, ROOM_INVITES) : t.filter((x) => x !== id)))

    const start = async () => {
        if (running && !sure) { setSure(true); return }
        setBusy(true); setErr("")
        /* inside the click: full screen and sound are allowed (study-timer.ts) */
        const e = await startRoomRun(flow, ticked)
        if (e) { setErr(e); setBusy(false); return }
        closeSheet()
    }

    return (
        <>
            <SheetHead kind="Study together" onClose={closeSheet} />
            <SheetBody>
                <p className="m-0 text-[12.5px] leading-[1.5] text-ink-2">
                    One shared timer. You're the host: Pause, Skip and End act for everyone. Each person's minutes go into their own sessions.
                </p>
                <Section title="Flow" note={duration(totals.study) + " study · " + duration(totals.total) + " total"}>
                    <div role="group" aria-label="Flow" className="flex flex-wrap gap-1.5">
                        {!ownIsPreset && (
                            <button type="button" aria-pressed={sameFlow(flow, own)} onClick={() => setFlow(own)}
                                className={cn(CHIP, sameFlow(flow, own) ? "border-foreground bg-foreground text-background" : "border-border bg-card text-ink-2 hover:text-foreground")}>
                                Your flow
                            </button>
                        )}
                        {presets.map(([name, p], i) => (
                            <button key={i} type="button" aria-pressed={sameFlow(flow, p)} onClick={() => setFlow(p)}
                                className={cn(CHIP, sameFlow(flow, p) ? "border-foreground bg-foreground text-background" : "border-border bg-card text-ink-2 hover:text-foreground")}>
                                {name}
                            </button>
                        ))}
                    </div>
                </Section>
                <Section title="Your class" note="friends pick their own">
                    {pick.courses.length ? (
                        <div className="grid grid-cols-2 gap-2 max-[520px]:grid-cols-1">
                            <Select aria-label="Course" value={pick.courseId ?? ""} onChange={(e) => pickCourse(e.target.value)}>
                                {pick.courses.map((c) => <option key={c.id} value={c.id}>{c.code + " · " + c.name}</option>)}
                            </Select>
                            <Select aria-label="Item (optional)" value={pick.itemId ?? ""} onChange={(e) => pickItem(e.target.value || null)}>
                                <option value="">No item</option>
                                {pick.items.map((it) => <option key={it.id} value={it.id}>{it.title}</option>)}
                            </Select>
                        </div>
                    ) : <Note>Add a course first; study time is logged against one.</Note>}
                </Section>
                <Section title="Invite" note={ticked.length ? ticked.length + " picked" : undefined}>
                    {!list && <Note>{offline ? "Friends need a connection." : error || "Loading…"}</Note>}
                    {list && list.friends.length === 0 && <Note>No friends yet. Add some on the Friends tab, or start alone and invite them later.</Note>}
                    {list && list.friends.length > 0 && (
                        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                            {list.friends.map((f) => {
                                const on = ticked.includes(f.userId), id = ids + f.userId
                                return (
                                    <li key={f.userId}>
                                        <label htmlFor={id} className={cn("flex cursor-pointer items-center gap-2.5 rounded-lg border px-2.5 py-2 text-[13px]",
                                            on ? "border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]" : "border-line-2")}>
                                            <input id={id} type="checkbox" checked={on} disabled={!on && ticked.length >= ROOM_INVITES}
                                                onChange={(e) => tick(f.userId, e.target.checked)} className="size-3.5 accent-[var(--accent)]" />
                                            <Avatar p={f} />
                                            <span className="flex min-w-0 flex-1 flex-col">
                                                <span>{f.name}</span>
                                                <span className="text-[12px] text-muted-foreground">{f.room ? "In a room now" : "Gets an invite in their inbox"}</span>
                                            </span>
                                        </label>
                                    </li>
                                )
                            })}
                        </ul>
                    )}
                </Section>
                {sure && <Note tone="bad">Your current session ends first. Its minutes are saved.</Note>}
                {err && <div role="alert"><Note tone="bad">{err}</Note></div>}
            </SheetBody>
            <SheetFoot hint="Any friend of yours can join.">
                <Button variant="ghost" onClick={closeSheet}>Cancel</Button>
                <Button disabled={busy || !pick.courseId} onClick={() => void start()}>
                    {sure ? "End it and start" : "Start" + (ticked.length ? " and invite " + ticked.length : "")}
                </Button>
            </SheetFoot>
        </>
    )
}
