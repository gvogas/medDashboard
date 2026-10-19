// New team project (spec §10, §15, §20), for admins until Stage 10: a name, a due date, and
// optionally the class assignment it belongs to (its date fills in the due date). You become
// its owner; teammates you invite join as editors. While the admins have shared classes
// switched off, everyone else gets the maintenance page instead.

import { useId, useState } from "react"
import { today } from "@/core/dates"
import { closeSheet } from "@/data/overlay"
import { messageFor } from "@/data/classes"
import { linkable, makeProject } from "@/data/projects"
import { useSharedItems, useSpaces } from "@/data/store"
import { useMaintenance } from "@/data/maintenance"
import { MaintenanceBar, MaintenancePage } from "@/components/maintenance"
import type { ParentRef } from "@/data/types"
import { Button, DateInput, Fields, Label, Note, Select, SheetBody, SheetFoot, SheetHead, TextInput } from "./fields"

export function NewProjectSheet({ parent }: { parent: ParentRef | null }) {
    const maintenance = useMaintenance("classes")
    if (maintenance !== "blocked") return <NewProject parent={parent} bar={maintenance === "admin"} />
    return (
        <>
            <SheetHead kind="New team project" onClose={closeSheet} />
            <SheetBody><MaintenancePage feature="classes" inSheet /></SheetBody>
        </>
    )
}

const keyOf = (o: ParentRef) => o.space + "/" + o.item

function NewProject({ parent, bar }: { parent: ParentRef | null; bar: boolean }) {
    const options = linkable(useSharedItems(), useSpaces())
    const [title, setTitle] = useState("")
    const [of, setOf] = useState(parent ? keyOf(parent) : "")
    const picked = options.find((o) => keyOf(o) === of) ?? null
    const [date, setDate] = useState(() => picked?.date || today())
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState("")
    const f = useId()

    const go = async () => {
        if (!title.trim()) { setErr("Give it a name."); return }
        setBusy(true); setErr("")
        try { await makeProject(title.trim(), date, picked ? { space: picked.space, item: picked.item } : null) }
        catch (e) { setErr(messageFor(e, "", "project")); setBusy(false) }
    }

    return (
        <>
            <SheetHead kind="New team project" onClose={closeSheet} />
            <SheetBody>
                {bar && <MaintenanceBar className="mb-0" />}
                <h2 className="m-0 text-[22px] leading-[1.22] font-[750] tracking-[-.02em]">New team project</h2>
                <Note>You become its owner. Teammates you invite join as editors; anyone can claim a task nobody has.</Note>
                <Fields>
                    <Label htmlFor={f + "name"}>Name</Label>
                    <TextInput id={f + "name"} value={title} maxLength={140} placeholder="Fire Response API" autoFocus
                        onChange={(e) => { setTitle(e.target.value); setErr("") }}
                        onKeyDown={(e) => { if (e.key === "Enter" && !busy) { e.preventDefault(); void go() } }} />
                    <Label htmlFor={f + "of"}>Belongs to</Label>
                    <Select id={f + "of"} value={of} onChange={(e) => {
                        setOf(e.target.value)
                        const o = options.find((x) => keyOf(x) === e.target.value)
                        if (o?.date) setDate(o.date)
                    }}>
                        <option value="">No class assignment</option>
                        {options.map((o) => <option key={keyOf(o)} value={keyOf(o)}>{o.label}</option>)}
                    </Select>
                    <Label htmlFor={f + "due"}>Due</Label>
                    <DateInput id={f + "due"} value={date} onChange={(e) => setDate(e.target.value)} />
                </Fields>
                {picked && <Note>The team's own deadline. The assignment's date, weight and your grade stay on the class's item.</Note>}
                {err && <Note tone="bad">{err}</Note>}
            </SheetBody>
            <SheetFoot hint="Needs a connection">
                <Button variant="ghost" onClick={closeSheet}>Cancel</Button>
                <Button disabled={busy || !date} onClick={() => void go()}>{busy ? "Making…" : "Make the project"}</Button>
            </SheetFoot>
        </>
    )
}
