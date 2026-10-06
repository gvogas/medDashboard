// New shared class (spec §15, §20), for admins until Stage 6: blank, or from a course of
// yours (the item picker comes next). You become its owner. "From a course outline" comes
// with Stage 6. While the admins have shared classes switched off, everyone else gets the
// maintenance page instead.

import { useId, useState } from "react"
import { cn } from "@/lib/utils"
import { useCourses } from "@/data/store"
import { closeSheet } from "@/data/overlay"
import { makeBlank, messageFor, openConvert } from "@/data/classes"
import { useMaintenance } from "@/data/maintenance"
import { MaintenanceBar, MaintenancePage } from "@/components/maintenance"
import { Button, Fields, Label, Note, Select, SheetBody, SheetFoot, SheetHead, TextInput } from "./fields"

type Start = "blank" | "convert"
const OPTIONS: readonly [Start, string, string][] = [
    ["blank", "Blank", "Name it and add items as you go."],
    ["convert", "Convert a course you have", "Copies the course and the items you tick."],
]

export function NewClassSheet() {
    const maintenance = useMaintenance("classes")
    if (maintenance !== "blocked") return <NewClass bar={maintenance === "admin"} />
    return (
        <>
            <SheetHead kind="New shared class" onClose={closeSheet} />
            <SheetBody><MaintenancePage feature="classes" inSheet /></SheetBody>
        </>
    )
}

function NewClass({ bar }: { bar: boolean }) {
    const courses = useCourses().filter((c) => !c.archived)
    const [start, setStart] = useState<Start>("blank")
    const [name, setName] = useState("")
    const [code, setCode] = useState("")
    const [courseId, setCourseId] = useState(courses[0]?.id ?? "")
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState("")
    const f = useId()

    const go = async () => {
        if (start === "convert") { if (courseId) openConvert(courseId); return }
        if (!name.trim() || !code.trim()) { setErr("Give it a name and a code."); return }
        setBusy(true); setErr("")
        try { await makeBlank(name.trim(), code.trim()) } catch (e) { setErr(messageFor(e)); setBusy(false) }
    }

    return (
        <>
            <SheetHead kind="New shared class" onClose={closeSheet} />
            <SheetBody>
                {bar && <MaintenanceBar className="mb-0" />}
                <h2 className="m-0 text-[22px] leading-[1.22] font-[750] tracking-[-.02em]">New shared class</h2>
                <Note>You become its owner. Choose editors later; members read the class and keep their own layer.</Note>
                <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
                    <legend className="sr-only">How to start</legend>
                    {OPTIONS.map(([v, title, sub]) => (
                        <label key={v} className={cn("flex cursor-pointer items-start gap-2.5 rounded-[10px] border border-border px-3 py-2.5", start === v && "border-[var(--accent)] bg-accent")}>
                            <input type="radio" name={f + "start"} value={v} checked={start === v} onChange={() => { setStart(v); setErr("") }} className="mt-0.5 accent-[var(--accent)]" />
                            <span className="flex flex-col gap-0.5">
                                <span className="text-[13px] font-semibold">{title}</span>
                                <span className="text-[11.5px] text-muted-foreground">{sub}</span>
                            </span>
                        </label>
                    ))}
                </fieldset>
                {start === "blank" ? (
                    <Fields>
                        <Label htmlFor={f + "name"}>Name</Label>
                        <TextInput id={f + "name"} value={name} maxLength={80} placeholder="Class name, e.g. Operating Systems" onChange={(e) => setName(e.target.value)} />
                        <Label htmlFor={f + "code"}>Code</Label>
                        <TextInput id={f + "code"} value={code} maxLength={8} placeholder="CS 446" onChange={(e) => setCode(e.target.value)} />
                    </Fields>
                ) : courses.length ? (
                    <Fields>
                        <Label htmlFor={f + "course"}>Course</Label>
                        <Select id={f + "course"} value={courseId} onChange={(e) => setCourseId(e.target.value)}>
                            {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </Select>
                    </Fields>
                ) : <Note>You have no course to convert yet.</Note>}
                {err && <Note tone="bad">{err}</Note>}
            </SheetBody>
            <SheetFoot hint="Needs a connection">
                <Button variant="ghost" onClick={closeSheet}>Cancel</Button>
                <Button disabled={busy || (start === "convert" && !courseId)} onClick={() => void go()}>{busy ? "Making…" : "Continue"}</Button>
            </SheetFoot>
        </>
    )
}
