// Import with AI (spec §10), from the top bar: a class schedule, a course outline or a school
// calendar, each read by AI and shown in its preview before anything is saved; the reads left
// today; and a calendar or CSV, pasted or picked as a file, instead. Settings only shows and
// removes the school calendar.

import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"
import { ui, useUi } from "@/data/ui"
import { refreshReads } from "@/data/ai-read"
import { importFile, previewImport, readOutlineFile } from "@/data/import-edit"
import { readSchoolFile } from "@/data/school-edit"
import { readScheduleFile } from "@/data/schedule-edit"
import { beforeSheetClose, closeSheet } from "@/data/overlay"
import { useMaintenance } from "@/data/maintenance"
import { MaintenanceBar, MaintenancePage } from "@/components/maintenance"
import { Button, SheetBody, SheetHead, TextArea } from "./fields"

const KINDS = [
    {
        id: "schedule", title: "Class schedule", pick: "Choose a PDF or image", note: "PDF, PNG or JPG · read by AI",
        blurb: "Your timetable from the student portal, as a PDF or a screenshot. It sets up your courses with every lecture, lab and tutorial: day, time and room.",
        icon: "M4 5h16v15H4zM4 10h16M9 10v10M14.5 10v10M4 15h16",
        accept: ".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp",
        read: (f: File) => readScheduleFile(f, "aiNote"),
    },
    {
        id: "outline", title: "Course outline", pick: "Choose a file", note: "PDF, Word or text · read by AI",
        blurb: "The syllabus from your professor. It pulls out every quiz, exam, assignment and lab with its date and weight, and the class times.",
        icon: "M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5",
        accept: ".pdf,.docx,.doc,.txt,.md,.html,.odt,application/pdf",
        read: (f: File) => readOutlineFile(f, "aiNote"),
    },
    {
        id: "calendar", title: "School calendar", pick: "Choose a file", note: "PDF, Word or text · read by AI",
        blurb: "Your school’s academic calendar. It finds each semester, reading weeks, holidays and exam periods, so classes stop repeating all year.",
        icon: "M4 5h16v15H4zM4 10h16M9 3v4M15 3v4",
        accept: ".pdf,.docx,.txt,.html,application/pdf",
        read: (f: File) => readSchoolFile(f, "aiNote"),
    },
] as const

/** The card; while the admins have Import with AI switched off, their message instead
    (an admin keeps the card, under the bar). */
export function AiSheet() {
    const maintenance = useMaintenance("import")
    if (maintenance !== "blocked") return <Importer bar={maintenance === "admin"} />
    return (
        <>
            <SheetHead kind="Import with AI" onClose={closeSheet} />
            <SheetBody><MaintenancePage feature="import" inSheet /></SheetBody>
        </>
    )
}

function Importer({ bar }: { bar: boolean }) {
    const left = useUi((u) => u.aiLeft)
    /* the Worker's limit once it has said */
    const reads = useUi((u) => u.aiLimit) ?? 10
    const note = useUi((u) => u.aiNote)
    const [text, setText] = useState("")
    /* what Preview said about the pasted text, shown beside it */
    const [pasteError, setPasteError] = useState("")
    const none = left === 0

    useEffect(() => {
        void refreshReads()
        /* what the card said goes when it closes */
        const forget = () => { ui.aiNote = null }
        beforeSheetClose.add(forget)
        return () => { beforeSheetClose.delete(forget) }
    }, [])

    const paste = () => {
        if (!text.trim()) return
        setPasteError(previewImport(text))
    }

    return (
        <>
            <SheetHead kind="Import with AI" onClose={closeSheet} />
            <SheetBody className="gap-4">
                {bar && <MaintenanceBar className="mb-0" />}
                <p className="m-0 text-[13px] leading-normal text-ink-2">Give it a document and it finds the dates for you. You see everything before anything is saved.</p>
                {KINDS.map((k) => (
                    <section key={k.id} aria-labelledby={"ai-" + k.id + "-t"} className="flex flex-col gap-3 rounded-[10px] border border-border p-4 max-[420px]:p-3">
                        <div className="flex gap-3">
                            <span aria-hidden="true" className="grid size-10 flex-none place-items-center rounded-lg bg-secondary text-primary">
                                <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={k.icon} /></svg>
                            </span>
                            <span className="flex min-w-0 flex-col gap-[3px]">
                                <span id={"ai-" + k.id + "-t"} className="text-[14px] font-semibold text-foreground">{k.title}</span>
                                <span className="text-[12.5px] leading-[1.45] text-ink-2">{k.blurb}</span>
                            </span>
                        </div>
                        <label className={cn(
                            "relative flex h-[84px] flex-col items-center justify-center gap-1 rounded-lg border-[1.5px] border-dashed border-border bg-muted/40 text-[13px] text-foreground",
                            "focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--accent)]",
                            none ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-muted",
                        )}>
                            <span className="flex items-center gap-1.5 font-medium">
                                <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 11V3M4.5 6.5 8 3l3.5 3.5M3 13h10" /></svg>
                                {k.pick}
                            </span>
                            <span className="text-[11.5px] text-muted-foreground">{k.note}</span>
                            <input type="file" accept={k.accept} disabled={none} aria-label={k.title + ": " + k.pick}
                                className="absolute inset-0 w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
                                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void k.read(f) }} />
                        </label>
                    </section>
                ))}
                {left != null && (
                    <div className="flex items-center gap-2.5 rounded-lg bg-muted px-3 py-2.5 text-[12.5px] text-ink-2">
                        <span role="meter" aria-label="AI reads left today" aria-valuemin={0} aria-valuemax={reads} aria-valuenow={left}
                            className="block h-[5px] w-[60px] flex-none overflow-hidden rounded-[3px] bg-border">
                            <span style={{ width: Math.min(100, Math.round((left / reads) * 100)) + "%" }} className="block h-[5px] bg-primary" />
                        </span>
                        <span>{none ? "No AI reads left today. They come back within a day of the first one." : left + " of " + reads + " AI reads left today · pasting a calendar or CSV doesn’t count"}</span>
                    </div>
                )}
                {note && <p role={note.error ? "alert" : "status"} className={cn("m-0 text-[12.5px]", note.error ? "text-destructive" : "text-ink-2")}>{note.text}</p>}
                <details className="text-[12.5px] text-ink-2">
                    <summary className="min-h-7 cursor-pointer">Use a calendar or CSV instead</summary>
                    <p className="mt-2 mb-1.5">A .ics calendar, or CSV with the columns <span className="font-mono">type,course,title,date,start,end,room,weight</span>. Choose the file or paste its text.</p>
                    <label className="relative mb-1.5 inline-flex cursor-pointer items-center rounded-[10px] border border-border bg-[linear-gradient(var(--panel),var(--panel-2))] px-3.5 py-[7px] text-[12.5px] font-[550] text-ink-2 shadow-[var(--shadow-1),inset_0_1px_0_var(--rim-hi)] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--accent)] hover:text-foreground">
                        Choose a file…
                        <input type="file" accept=".ics,.csv,.txt,text/calendar,text/csv" aria-label="Calendar or CSV file" className="absolute inset-0 w-full cursor-pointer opacity-0"
                            onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) setPasteError(await importFile(f)) }} />
                    </label>
                    <TextArea rows={4} className="min-h-0 font-mono text-[12px]" value={text} aria-label="Calendar or CSV text" placeholder="Paste calendar or CSV text" onChange={(e) => { setText(e.target.value); setPasteError("") }} />
                    <div className="mt-1.5 flex flex-wrap items-center gap-2.5">
                        <Button variant="ghost" onClick={paste}>Preview</Button>
                        {pasteError && <p role="alert" className="m-0 min-w-0 flex-1 text-[12.5px] text-destructive">{pasteError}</p>}
                    </div>
                </details>
            </SheetBody>
        </>
    )
}
