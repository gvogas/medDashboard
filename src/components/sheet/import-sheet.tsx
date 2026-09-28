// The import preview: what a calendar, CSV or course outline would add, one tick per row,
// grouped by course. Nothing is written until Import.

import { useState } from "react"
import { cn } from "@/lib/utils"
import { typeList } from "@/core/model"
import { DOW, shortDate } from "@/core/dates"
import { termStart } from "@/data/query"
import { planSummary, setWeek1 } from "@/core/importers/plan"
import { data } from "@/core/store"
import { notify } from "@/bridge"
import { useUi, ui } from "@/data/ui"
import { commitImport, importCount, type ImportPlan, type PlanItem } from "@/data/import-edit"
import { openSettings } from "@/data/actions"
import { accent } from "@/components/views/bits"
import { Button, CONTROL, Section, SheetBody, SheetFoot, SheetHead, Warning } from "./fields"

export function ImportSheet({ plan: initial, name }: { plan: ImportPlan; name: string }) {
    /* the plan is changed in place by the ticks, as the planner expects; `v` redraws */
    const [plan] = useState(initial)
    const [, setV] = useState(0)
    const redraw = () => setV((n) => n + 1)
    const [busy, setBusy] = useState(false)
    const bg = useUi((u) => u.bg)
    const types = typeList(bg, data.items) as { id: string; label: string; hidden: boolean }[]
    const n = importCount(plan)

    const kept = plan.courses.find((c) => c.keep && c.isNew && (c.instructor || c.term))
    const extra = [kept?.instructor, kept?.term, plan.termStart && !termStart() ? "term start " + shortDate(plan.termStart) : ""].filter(Boolean).join(" · ")
    const rows = plan.items.map((it, i) => ({ it, i }))
    const groups = plan.courses.map((c) => ({ c, items: rows.filter((x) => x.it.row.courseId === c.id) }))
    const loose = rows.filter((x) => !x.it.row.courseId)
    const cancel = () => openSettings("importGrp")

    const commit = async () => {
        setBusy(true)
        let note
        try { note = { text: await commitImport(plan), error: false } } catch (error) { note = { text: "The import stopped part-way: " + (error as Error).message, error: true } }
        notify()
        ui.importNote = note
        openSettings("importGrp")
    }

    return (
        <>
            <SheetHead kind="Import" onClose={cancel}>
                <span className="font-mono text-[11px] text-muted-foreground">{name || "pasted text"}</span>
            </SheetHead>
            <SheetBody>
                <div role="status" className="text-[13px] font-semibold text-foreground">{planSummary(plan)}</div>
                {extra && <span className="text-[11.5px] text-muted-foreground">{extra}</span>}
                {plan.items.some((i) => i.week) && <>
                    <label className="flex items-center gap-2.5 text-[12px] text-muted-foreground">
                        Week 1 starts
                        <input type="date" value={plan.week1 || ""} className={cn(CONTROL, "w-auto")} onChange={(e) => { setWeek1(plan, e.target.value); redraw() }} />
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
                    <Section key={c.id} title={<><i aria-hidden="true" style={accent(c.color)} className="inline-block size-2 rounded-full bg-[var(--c,var(--ink-3))]" />{c.code} · {c.name}</>} note={c.isNew ? "new course" : undefined}>
                        <div>
                            {c.meetings.map((m) => (
                                <label key={m.id} className={ROW}>
                                    <input type="checkbox" checked={m.include} onChange={(e) => { m.include = e.target.checked; redraw() }} />
                                    <span className="min-w-[62px] flex-none text-ink-2">{m.kind}</span>
                                    <span>{DOW[m.weekday]} {m.start}–{m.end}</span>
                                    <span className={WHERE}>{m.room}</span>
                                </label>
                            ))}
                            {items.map((x) => <ItemRow key={x.i} it={x.it} types={types} onChange={redraw} />)}
                        </div>
                    </Section>
                ))}
                {loose.length > 0 && <Section title="No course"><div>{loose.map((x) => <ItemRow key={x.i} it={x.it} types={types} onChange={redraw} />)}</div></Section>}
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

function ItemRow({ it, types, onChange }: { it: PlanItem; types: { id: string; label: string; hidden: boolean }[]; onChange: () => void }) {
    const r = it.row
    const when = r.recur === "weekly" ? "every " + DOW[r.weekday ?? 0] : r.date ? shortDate(r.date) + (it.week ? " · wk " + it.week : "") : "week " + it.week
    return (
        <div className={ROW}>
            <input type="checkbox" checked={it.include} disabled={!r.date} aria-label={"Import " + r.title} onChange={(e) => { it.include = e.target.checked; onChange() }} />
            <select aria-label="Type" value={r.type} onChange={(e) => { r.type = e.target.value; onChange() }}
                className="max-w-[110px] flex-none rounded-md border border-transparent bg-muted px-1 py-0.5 font-[inherit] text-[12px] text-foreground hover:border-border">
                {types.filter((t) => t.id === r.type || !t.hidden).map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
            <span className={cn("min-w-0 flex-1 truncate", it.duplicate ? "text-muted-foreground" : "text-foreground")}>
                {r.title}{it.duplicate && <em className="ml-1 text-[10.5px] text-[var(--amber-ink)] not-italic">already there</em>}
            </span>
            <span className={WHERE}>{when}{r.start ? " " + r.start : ""}</span>
        </div>
    )
}
