// A class's own controls at the foot of its Details (spec §13, §15): the archived banner;
// Leave (anyone but the owner), with Keep a copy on; Archive / Unarchive (the owner); Delete
// (the owner, while nobody else is in it), with Keep a copy on. Each asks once, inline.

import { useId, useState } from "react"
import { deleteClass, leaveClass, setArchived } from "@/data/leave"
import { messageFor } from "@/data/classes"
import type { Space } from "@/data/types"
import { Button, Note, Section } from "./fields"

export function ArchivedBanner({ space }: { space: Space }) {
    const [err, setErr] = useState("")
    if (!space.archived) return null
    return (
        <div role="note" className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--warn-line)] bg-[var(--warn-bg)] px-2.5 py-2 text-[12px] text-[var(--warn-ink)]">
            <span className="min-w-0 flex-1">Archived: read-only for everyone. Your own status, grades and settings still save.</span>
            {space.role === "owner" && <Button variant="ghost" onClick={() => void setArchived(space.id, false).then(() => setErr(""), (e) => setErr(messageFor(e)))}>Unarchive</Button>}
            {err && <Note tone="bad">{err}</Note>}
        </div>
    )
}

export function ClassActions({ space, name }: { space: Space; name: string }) {
    const f = useId()
    const [asking, setAsking] = useState<"leave" | "delete" | null>(null)
    const [keep, setKeep] = useState(true)
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState("")
    const owner = space.role === "owner", alone = space.members.length <= 1
    const run = async (fn: () => Promise<void>) => {
        setBusy(true)
        try { await fn(); setErr("") } catch (e) { setErr(messageFor(e)) } finally { setBusy(false) }
    }
    const ask = (what: "leave" | "delete") => { setKeep(true); setErr(""); setAsking(what) }
    const confirm = (what: "leave" | "delete") => (
        <div className="flex flex-col gap-2 rounded-lg bg-muted px-2.5 py-2">
            <Note>{what === "leave"
                ? `You stop seeing ${name}'s changes. With a copy, its course and items become your own, with your grades and notes.`
                : `${name} goes for good. With a copy, its course and items become your own.`}</Note>
            {/* the fields' Checkbox is named by a Label beside it; this one names itself */}
            <label htmlFor={f + "keep"} className="flex cursor-pointer items-center gap-1.5 text-[12px]">
                <input id={f + "keep"} type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} className="size-3.5 accent-[var(--accent)]" />
                Keep a copy as my own course
            </label>
            <span className="flex flex-wrap gap-2">
                <Button variant="ghost" onClick={() => setAsking(null)}>Cancel</Button>
                <Button variant="danger" disabled={busy} onClick={() => void run(() => (what === "leave" ? leaveClass(space.id, keep, name) : deleteClass(space.id, keep, name)))}>
                    {what === "leave" ? "Leave " + name : "Delete " + name}
                </Button>
            </span>
        </div>
    )
    return (
        <Section title="This class">
            {owner ? <>
                <span className="flex flex-wrap gap-2">
                    {!space.archived && <Button variant="ghost" disabled={busy} onClick={() => void run(() => setArchived(space.id, true))}>Archive the class</Button>}
                    {alone && <Button variant="ghost" onClick={() => ask("delete")}>Delete the class…</Button>}
                </span>
                {!alone ? <Note>Hand the class on in Members to leave it. A class can be deleted once nobody else is in it.</Note>
                    : !space.archived && <Note>Archiving makes it read-only for everyone until you unarchive it.</Note>}
            </> : (
                <Button variant="ghost" className="self-start" onClick={() => ask("leave")}>Leave the class…</Button>
            )}
            {asking && confirm(asking)}
            {err && <Note tone="bad">{err}</Note>}
        </Section>
    )
}
