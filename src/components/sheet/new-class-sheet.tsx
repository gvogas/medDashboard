// New shared class (spec §15, §20): blank, from a course of yours
// (the item picker comes next), or from a course outline (read with AI, then the import
// preview). You become its owner. While the admins have shared classes switched off, everyone
// else gets the maintenance page instead.

import { useEffect, useId, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { useCourses } from "@/data/store"
import { closeSheet } from "@/data/overlay"
import { makeBlank, messageFor, openConvert } from "@/data/classes"
import { OUTLINE_ACCEPT, readOutlineFile } from "@/data/import-edit"
import { ui, useUi } from "@/data/ui"
import { useMaintenance } from "@/data/maintenance"
import { MaintenanceBar, MaintenancePage } from "@/components/maintenance"
import { Button, Fields, Label, Note, Select, SheetBody, SheetFoot, SheetHead, TextInput } from "./fields"

type Start = "blank" | "convert" | "outline"
const OPTIONS: readonly [Start, string, string][] = [
    ["blank", "Blank", "Name it and add items as you go."],
    ["convert", "Convert a course you have", "Moves the course and the items you tick into the class."],
    ["outline", "From a course outline", "Term reads the outline with AI; you tick what goes in before anything is made."],
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
    const file = useRef<HTMLInputElement>(null)
    /* why the last outline read failed (the read shares Import with AI's note) */
    const note = useUi((u) => u.aiNote)
    /* the outline is read with AI: closed while the admins have Import with AI switched off
       for you, or no reads are left today (the AI sheet's words) */
    const imports = useMaintenance("import")
    const left = useUi((u) => u.aiLeft)
    const outlineOff = imports === "blocked" ? "Import with AI is being worked on."
        : left === 0 ? "No AI reads left today. They come back within a day of the first one." : ""
    const f = useId()

    /* what it said goes when the sheet does */
    useEffect(() => () => { ui.aiNote = null }, [])

    const go = async () => {
        if (start === "convert") { if (courseId) openConvert(courseId); return }
        if (start === "outline") { file.current?.click(); return }
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
                    {OPTIONS.map(([v, title, sub]) => {
                        const off = v === "outline" ? outlineOff : ""
                        return (
                            <label key={v} className={cn("flex items-start gap-2.5 rounded-[10px] border border-border px-3 py-2.5", off ? "cursor-not-allowed opacity-60" : "cursor-pointer", start === v && "border-[var(--accent)] bg-accent")}>
                                <input type="radio" name={f + "start"} value={v} checked={start === v} disabled={!!off} onChange={() => { setStart(v); setErr("") }} className="mt-0.5 accent-[var(--accent)]" />
                                <span className="flex flex-col gap-0.5">
                                    <span className="text-[13px] font-semibold">{title}</span>
                                    <span className="text-[11.5px] text-muted-foreground">{off || sub}</span>
                                </span>
                            </label>
                        )
                    })}
                </fieldset>
                {start === "blank" ? (
                    <Fields>
                        <Label htmlFor={f + "name"}>Name</Label>
                        <TextInput id={f + "name"} value={name} maxLength={80} placeholder="Class name, e.g. Operating Systems" onChange={(e) => setName(e.target.value)} />
                        <Label htmlFor={f + "code"}>Code</Label>
                        <TextInput id={f + "code"} value={code} maxLength={8} placeholder="CS 446" onChange={(e) => setCode(e.target.value)} />
                    </Fields>
                ) : start === "outline" ? (
                    note && <Note tone={note.error ? "bad" : undefined}>{note.text}</Note>
                ) : courses.length ? (
                    <Fields>
                        <Label htmlFor={f + "course"}>Course</Label>
                        <Select id={f + "course"} value={courseId} onChange={(e) => setCourseId(e.target.value)}>
                            {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </Select>
                    </Fields>
                ) : <Note>You have no course to convert yet.</Note>}
                {err && <Note tone="bad">{err}</Note>}
                <input ref={file} type="file" accept={OUTLINE_ACCEPT} aria-label="Course outline file" className="hidden"
                    onChange={(e) => { const picked = e.target.files?.[0]; if (picked) void readOutlineFile(picked, "aiNote", { forNewClass: true }); e.target.value = "" }} />
            </SheetBody>
            <SheetFoot hint="Needs a connection">
                <Button variant="ghost" onClick={closeSheet}>Cancel</Button>
                <Button disabled={busy || (start === "convert" && !courseId) || (start === "outline" && !!outlineOff)} onClick={() => void go()}>
                    {busy ? "Making…" : start === "outline" ? "Choose the outline…" : "Continue"}
                </Button>
            </SheetFoot>
        </>
    )
}
