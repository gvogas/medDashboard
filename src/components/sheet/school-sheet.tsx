// The school calendar, to check and fix before it is saved: its semesters and its
// special days (no classes, a break, exams, a day that runs another's timetable, markers).

import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { DOW, shortDate, today } from "@/core/dates"
import { KIND_LABELS, normalizeSchool, SCHOOL_KINDS, SCHOOL_LIMITS, weekOf } from "@/core/school"
import { closeSheet, replaceSheet } from "@/data/overlay"
import { dayOk, footHint, groupDays, moveFrom, saveSchool, termOk, valid, type DayKind, type SchoolDraft, type SpecialDay, type Term } from "@/data/school-edit"
import { Button, CONTROL, Note, RemoveButton, Section, SheetBody, SheetFoot, SheetHead } from "./fields"

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]
const KIND_TONE: Record<string, string> = { off: "text-ink-2", break: "text-[var(--good)]", exams: "text-[var(--amber-ink)]", swap: "text-accent-foreground" }
const SMALL = cn(CONTROL, "px-1.5 py-1 text-[12.5px]")
const BAD = "border-[var(--red-line)] bg-[var(--red-bg)]"

export function SchoolSheet({ draft }: { draft: SchoolDraft }) {
    const set = (change: Partial<SchoolDraft>) => replaceSheet({ kind: "school", draft: { ...draft, ...change } })
    const setTerm = (i: number, change: Partial<Term>) => set({ terms: draft.terms.map((t, j) => (j === i ? { ...t, ...change } : t)) })
    const setDay = (i: number, next: SpecialDay) => set({ days: draft.days.map((d, j) => (j === i ? next : d)) })
    /* a day just added gets the keyboard */
    const [added, setAdded] = useState<number | null>(null)
    const addedRef = useRef<HTMLInputElement>(null)
    useEffect(() => { if (added !== null) { addedRef.current?.focus(); setAdded(null) } }, [added])
    const ok = valid(draft)

    return (
        <>
            <SheetHead color="#0E7C74" kind="School calendar" onClose={closeSheet} />
            <SheetBody>
                <Note>
                    {draft.source ? <>Read from <b>{draft.source}</b>. Check the dates, then save. Nothing changes until you do.</> : "Your saved school calendar. Changes apply when you save."}
                    {draft.truncated && " The file was long, so its end was not read: check the last dates."}
                </Note>
                <Section title="Name">
                    <input value={draft.name} maxLength={SCHOOL_LIMITS.name} aria-label="Name" placeholder="Your school 2026–27" onChange={(e) => set({ name: e.target.value })}
                        className={cn(CONTROL, "text-[16px] font-bold")} />
                </Section>

                <Section title="Semesters" note={draft.terms.length}>
                    {draft.terms.map((t, i) => <TermCard key={i} term={t} i={i} draft={draft} onChange={(c) => setTerm(i, c)}
                        onRemove={draft.terms.length > 1 ? () => set({ terms: draft.terms.filter((_, j) => j !== i) }) : null} />)}
                    {draft.terms.length < SCHOOL_LIMITS.terms && (
                        <AddButton onClick={() => {
                            const last = draft.terms[draft.terms.length - 1]
                            set({ terms: [...draft.terms, { name: "Semester " + (draft.terms.length + 1), start: last?.end || today(), end: last?.end || today() }] })
                        }}>+ Add a semester</AddButton>
                    )}
                </Section>

                <Section title="Special days" note={draft.days.length}>
                    <Note>Only the kind changes what you see: <b>No classes</b>, <b>Study break</b> and <b>Exams</b> hide classes; <b>Follows another day</b> runs that day’s timetable; a <b>Marker</b> is just a label.</Note>
                    {groupDays(draft).map((g, k) => (
                        <div key={k}>
                            {g.term && <div className="mt-1.5 text-[12px] font-bold text-foreground">{g.term.name}</div>}
                            {g.days.map(([d, i]) => (
                                <DayRow key={i} day={d} inputRef={i === added ? addedRef : undefined}
                                    onChange={(next) => setDay(i, next)} onRemove={() => set({ days: draft.days.filter((_, j) => j !== i) })} />
                            ))}
                        </div>
                    ))}
                    {draft.days.length < SCHOOL_LIMITS.days && (
                        <AddButton onClick={() => { set({ days: [...draft.days, { from: today(), to: today(), kind: "off", label: "" }] }); setAdded(draft.days.length) }}>+ Add a day</AddButton>
                    )}
                </Section>
            </SheetBody>
            <SheetFoot hint={footHint(draft)}>
                <Button variant="ghost" onClick={closeSheet}>Cancel</Button>
                <Button disabled={!ok} onClick={() => void saveSchool(draft)}
                    className="border-[color-mix(in_srgb,var(--study)_72%,#000)] bg-[linear-gradient(color-mix(in_srgb,var(--study)_90%,#fff),color-mix(in_srgb,var(--study)_92%,#000))]">Save calendar</Button>
            </SheetFoot>
        </>
    )
}

const AddButton = (props: React.ComponentProps<"button">) => (
    <button type="button" {...props} className="cursor-pointer self-start rounded-lg border border-dashed border-border bg-transparent px-3 py-[5px] font-[inherit] text-[12px] font-semibold text-ink-2 hover:text-foreground" />
)

function TermCard({ term, i, draft, onChange, onRemove }: { term: Term; i: number; draft: SchoolDraft; onChange: (c: Partial<Term>) => void; onRemove: (() => void) | null }) {
    const good = termOk(term)
    const cal = good ? normalizeSchool({ terms: [term], days: draft.days.filter(dayOk) }) : null
    const w = cal ? (weekOf(cal, term.start) as { of?: number } | null) : null
    return (
        <div className={cn("grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-1.5 rounded-xl border border-border p-2.5", !good && BAD)}>
            <span className="col-span-2 flex gap-1.5">
                <input value={term.name} maxLength={SCHOOL_LIMITS.term} aria-label="Semester name" onChange={(e) => onChange({ name: e.target.value })} className={cn(SMALL, "flex-1 text-[13.5px] font-bold")} />
                {onRemove && <RemoveButton aria-label={"Remove " + (term.name || "this semester")} onClick={onRemove} />}
            </span>
            <label htmlFor={"sct-" + i} className="text-[11.5px] font-[550] text-muted-foreground">Classes</label>
            <span className="flex flex-wrap items-center gap-1.5">
                <input id={"sct-" + i} type="date" value={term.start} aria-label="First day of classes" onChange={(e) => onChange({ start: e.target.value })} className={cn(SMALL, "w-auto")} />
                <span className="text-muted-foreground">to</span>
                <input type="date" value={term.end} aria-label="Last day of classes" onChange={(e) => onChange({ end: e.target.value })} className={cn(SMALL, "w-auto")} />
            </span>
            <span className="col-span-2 text-[11.5px] text-ink-2">
                {w?.of ? w.of + " week" + (w.of === 1 ? "" : "s") + " of classes · " + shortDate(term.start) + " – " + shortDate(term.end) : "Check the dates"}
            </span>
        </div>
    )
}

function DayRow({ day, onChange, onRemove, inputRef }: { day: SpecialDay; onChange: (d: SpecialDay) => void; onRemove: () => void; inputRef?: React.Ref<HTMLInputElement> }) {
    const same = day.to === day.from
    return (
        <div className={cn("grid grid-cols-[128px_minmax(0,1fr)_26px] items-start gap-x-2 gap-y-1 border-t border-line-2 px-1 py-[7px]", !dayOk(day) && BAD)}>
            <span className="flex flex-col gap-[3px]">
                <input ref={inputRef} type="date" value={day.from} aria-label="From" onChange={(e) => onChange(moveFrom(day, e.target.value))} className={cn(SMALL, "font-mono text-[11px]")} />
                <input type="date" value={day.to} aria-label="To" onChange={(e) => onChange({ ...day, to: e.target.value })} className={cn(SMALL, "font-mono text-[11px]", same && "opacity-55")} />
            </span>
            <span className="flex min-w-0 flex-col gap-[3px]">
                <input value={day.label} maxLength={SCHOOL_LIMITS.label} aria-label="Label" placeholder={KIND_LABELS[day.kind]} onChange={(e) => onChange({ ...day, label: e.target.value })} className={SMALL} />
                <span className="flex flex-wrap gap-1">
                    <select aria-label="Kind" value={day.kind} className={cn(SMALL, "w-auto text-[11px]", KIND_TONE[day.kind])}
                        onChange={(e) => { const kind = e.target.value as DayKind; onChange({ ...day, kind, ...(kind === "swap" && day.follows === undefined ? { follows: 1 } : {}) }) }}>
                        {(SCHOOL_KINDS as DayKind[]).map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
                    </select>
                    {day.kind === "swap" && (
                        <select aria-label="Follows the timetable of" value={day.follows ?? 1} onChange={(e) => onChange({ ...day, follows: +e.target.value })} className={cn(SMALL, "w-auto text-[11px]")}>
                            {DAY_ORDER.map((w) => <option key={w} value={w}>{DOW[w]}’s classes</option>)}
                        </select>
                    )}
                </span>
            </span>
            <RemoveButton aria-label={"Remove " + (day.label || KIND_LABELS[day.kind])} onClick={onRemove} />
        </div>
    )
}
