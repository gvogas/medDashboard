// The import preview: what a calendar, CSV or course outline would add, one tick per row,
// grouped by course; an outline can go into a class you edit, or a new class
// (src/data/class-import.ts). Nothing is written until Import.

import { useState } from "react"
import { cn } from "@/lib/utils"
import { typeList } from "@/core/model"
import { DOW, shortDate } from "@/core/dates"
import { schoolCal, termStart } from "@/data/query"
import { semesterOptions, semesterPicked } from "@/data/course-edit"
import { planSummary } from "@/core/importers/plan"
import { notify } from "@/bridge"
import { useUi } from "@/data/ui"
import { effectiveItems } from "@/data/effective"
import { commitImport, importCount, type ImportPlan, type PlanItem } from "@/data/import-edit"
import { classRows, commitNewClass, commitToClass, importTargets, NotDownloaded, planForClass, planMine, setWeekOne, type Target } from "@/data/class-import"
import { ApiError } from "@/core/api"
import { download, messageFor, openClass } from "@/data/classes"
import { useMaintenance } from "@/data/maintenance"
import { closeSheet, openSheet } from "@/data/overlay"
import { toast } from "@/data/toast"
import { accent } from "@/components/views/bits"
import { MaintenanceBar, MaintenancePage } from "@/components/maintenance"
import { Button, CONTROL, Section, Segmented, SheetBody, SheetFoot, SheetHead, Warning } from "./fields"

export function ImportSheet({ plan: initial, name, target: given = { kind: "mine" } }: { plan: ImportPlan; name: string; target?: Target }) {
    /* the plan is changed in place by the ticks, as the planner expects; `v` redraws */
    const [plan, setPlan] = useState(initial)
    const [target, setTarget] = useState<Target>(given)
    const [, setV] = useState(0)
    const redraw = () => setV((n) => n + 1)
    const [busy, setBusy] = useState(false)
    /* a class made from the outline that hadn't downloaded: Import then puts the items into it */
    const [made, setMade] = useState<{ id: string; name: string } | null>(null)
    const [said, setSaid] = useState("")
    const maintenance = useMaintenance("classes")
    const bg = useUi((u) => u.bg)
    const types = typeList(bg, effectiveItems()) as { id: string; label: string; hidden: boolean }[]
    const n = importCount(plan)
    /* an outline for your own courses, or a new class, gets a semester picker when there is a
       school calendar; a class has its own semester already */
    const cal = plan.kind === "outline" && target.kind !== "class" ? schoolCal() : null
    /* only an outline for your courses picks a target: a class that has downloaded, and none
       while classes are switched off */
    const targets = initial.outline && given.kind === "mine" && maintenance !== "blocked" ? importTargets().filter((s) => classRows(s.id).course) : []

    /* a new target plans the outline afresh, keeping the week 1 picked */
    const retarget = (value: string) => {
        const outline = plan.outline!
        const next: Target = value === "mine" ? { kind: "mine" } : { kind: "class", spaceId: value.slice("class:".length) }
        let fresh: ImportPlan
        if (next.kind === "class") { const { course, items } = classRows(next.spaceId); fresh = planForClass(outline, course, items) }
        else fresh = planMine(outline)
        if (plan.week1 && plan.week1 !== fresh.week1 && fresh.items.some((i) => i.week)) setWeekOne(fresh, plan.week1, next)
        setTarget(next)
        setPlan(fresh)
    }

    const kept = plan.courses.find((c) => c.keep && c.isNew && (c.instructor || c.term))
    /* with a school calendar the picker shows the semester, so the line leaves it out */
    const extra = [kept?.instructor, cal ? "" : kept?.term, plan.termStart && !termStart() ? "term start " + shortDate(plan.termStart) : ""].filter(Boolean).join(" · ")
    const rows = plan.items.map((it, i) => ({ it, i }))
    const groups = plan.courses.map((c) => ({ c, items: rows.filter((x) => x.it.row.courseId === c.id) }))
    const loose = rows.filter((x) => !x.it.row.courseId)
    const cancel = () => openSheet({ kind: "ai" })

    const commit = async () => {
        setBusy(true)
        let note
        try {
            if (made && !(await download(made.id))) { setSaid(made.name + " still hasn't downloaded. Try again in a moment."); setBusy(false); return }
            const text = target.kind === "class" ? await commitToClass(plan, target.spaceId)
                : target.kind === "new-class" ? await commitNewClass(plan) : await commitImport(plan)
            note = { text, error: false }
        } catch (error) {
            if (error instanceof NotDownloaded) {
                /* the class is made, with the meetings ticked: keep the preview, to import its items into it */
                for (const c of plan.courses) { c.isNew = false; c.keep = false; for (const m of c.meetings) m.include = false }
                setMade({ id: error.spaceId, name: plan.courses[0]?.name ?? "The class" })
                setTarget({ kind: "class", spaceId: error.spaceId })
                setSaid(error.message)
                setBusy(false)
                return
            }
            if (target.kind === "mine") note = { text: "The import stopped part-way: " + (error as Error).message, error: true }
            else {
                /* the server's refusal or no connection, said as the class sheets say them; else what went wrong */
                const text = error instanceof ApiError || error instanceof TypeError ? messageFor(error) : (error as Error).message
                /* a new class that wasn't made: keep the preview, to try again */
                if (target.kind === "new-class") { setSaid(text); setBusy(false); return }
                note = { text, error: true }
            }
        }
        notify()
        /* a new class has opened its own sheet; one made here but downloaded late opens now */
        if (made && !note.error) openClass(made.id, "members")
        else if (target.kind !== "new-class") closeSheet()
        toast(note.text, { error: note.error })
    }

    if (maintenance === "blocked" && target.kind !== "mine") return (
        <>
            <SheetHead kind="Import" onClose={cancel} />
            <SheetBody><MaintenancePage feature="classes" inSheet /></SheetBody>
        </>
    )

    return (
        <>
            <SheetHead kind="Import" onClose={cancel}>
                <span className="font-mono text-[11px] text-muted-foreground">{name || "pasted text"}</span>
            </SheetHead>
            <SheetBody>
                {maintenance === "admin" && target.kind !== "mine" && <MaintenanceBar className="mb-0" />}
                {targets.length > 0 && (
                    <label className="flex items-center gap-2.5 text-[12px] text-muted-foreground">
                        Import into
                        <select aria-label="Import into" value={target.kind === "class" ? "class:" + target.spaceId : "mine"} onChange={(e) => retarget(e.target.value)} className={cn(CONTROL, "w-auto")}>
                            <option value="mine">My courses</option>
                            {targets.map((s) => <option key={s.id} value={"class:" + s.id}>{s.name} · shared class</option>)}
                        </select>
                    </label>
                )}
                {target.kind === "class" && <span className="text-[11.5px] text-muted-foreground">Everyone in the class gets what you import. Changed rows start unticked: tick the ones the outline gets right.</span>}
                {target.kind === "new-class" && <span className="text-[11.5px] text-muted-foreground">A new shared class, with you as its owner. Nothing is made until you import.</span>}
                {said && <Warning>{said}</Warning>}
                <div role="status" className="text-[13px] font-semibold text-foreground">{planSummary(plan)}</div>
                {extra && <span className="text-[11.5px] text-muted-foreground">{extra}</span>}
                {plan.items.some((i) => i.week) && <>
                    <label className="flex items-center gap-2.5 text-[12px] text-muted-foreground">
                        Week 1 starts
                        <input type="date" value={plan.week1 || ""} className={cn(CONTROL, "w-auto")} onChange={(e) => { setWeekOne(plan, e.target.value, target); redraw() }} />
                    </label>
                    <span className="text-[11.5px] text-muted-foreground">{plan.week1
                        ? "Items given only as “Week N” are placed on the Monday of that week."
                        : "This outline gives due dates as week numbers. Set the first day of week 1 to date them."}</span>
                </>}
                {plan.notes.length > 0 && (
                    <Warning>
                        {plan.notes.slice(0, 6).map((t, i) => <div key={i}>{t}</div>)}
                        {plan.notes.length > 6 && <div>…and {plan.notes.length - 6} more.</div>}
                    </Warning>
                )}
                {groups.map(({ c, items }) => (
                    <Section key={c.id} title={<><i aria-hidden="true" style={accent(c.color)} className="inline-block size-2 rounded-full bg-[var(--c,var(--ink-3))]" />{c.code} · {c.name}</>} note={c.isNew ? (target.kind === "new-class" ? "new shared class" : "new course") : undefined}>
                        <>
                            {cal && (
                                <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
                                    Semester
                                    <Segmented label={"Semester for " + c.code} value={semesterPicked(cal, c.term)} options={semesterOptions(cal)}
                                        onChange={(term) => { c.term = term; redraw() }} />
                                </div>
                            )}
                            <div>
                                {c.meetings.map((m) => (
                                    <label key={m.id} className={ROW}>
                                        <input type="checkbox" checked={m.include} onChange={(e) => { m.include = e.target.checked; redraw() }} />
                                        <span className="min-w-[62px] flex-none text-ink-2">{m.kind}</span>
                                        <span>{DOW[m.weekday]} {m.start}–{m.end}</span>
                                        <span className={WHERE}>{m.room}</span>
                                    </label>
                                ))}
                                {items.map((x) => <ItemRow key={x.i} it={x.it} types={types} onChange={redraw} toClass={target.kind !== "mine"} />)}
                            </div>
                        </>
                    </Section>
                ))}
                {loose.length > 0 && <Section title="No course"><div>{loose.map((x) => <ItemRow key={x.i} it={x.it} types={types} onChange={redraw} toClass={target.kind !== "mine"} />)}</div></Section>}
            </SheetBody>
            <SheetFoot hint="Nothing is saved until you import">
                <Button variant="ghost" onClick={cancel}>Cancel</Button>
                <Button disabled={!n || busy} onClick={() => void commit()}>Import {n}</Button>
            </SheetFoot>
        </>
    )
}

const ROW = "flex min-w-0 items-center gap-2 border-b border-line-2 py-1 text-[12.5px] last:border-b-0"
const WHERE = "ml-auto max-w-[40%] flex-none truncate text-[11px] text-muted-foreground"

/* a row's tag: against a class (or a new one) every row is New, Changed or Already there */
const TAG = "max-w-[45%] flex-none truncate text-[10.5px]"

function ItemRow({ it, types, onChange, toClass }: { it: PlanItem; types: { id: string; label: string; hidden: boolean }[]; onChange: () => void; toClass: boolean }) {
    const r = it.row
    const when = r.recur === "weekly" ? "every " + DOW[r.weekday ?? 0] : r.date ? shortDate(r.date) + (it.week ? " · wk " + it.week : "") : "week " + it.week
    return (
        <div className={ROW}>
            <input type="checkbox" checked={it.include} disabled={!r.date} aria-label={"Import " + r.title} onChange={(e) => { it.include = e.target.checked; onChange() }} />
            <select aria-label="Type" value={r.type} onChange={(e) => { r.type = e.target.value; onChange() }}
                className="max-w-[110px] flex-none rounded-md border border-transparent bg-muted px-1 py-0.5 font-[inherit] text-[12px] text-foreground hover:border-border">
                {types.filter((t) => t.id === r.type || !t.hidden).map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
            <span className={cn("min-w-0 flex-1 truncate", it.duplicate ? "text-muted-foreground" : "text-foreground")}>{r.title}</span>
            {/* outside the title, so a long title never hides it */}
            {it.duplicate ? <span className={cn(TAG, "text-[var(--amber-ink)]")}>already there</span>
                : it.was ? <span className={cn(TAG, "text-[var(--amber-ink)]")} title={"was " + it.was}>changed · was {it.was}</span>
                : toClass && <span className={cn(TAG, "text-[var(--accent)]")}>new</span>}
            <span className={WHERE}>{when}{r.start ? " " + r.start : ""}</span>
        </div>
    )
}
