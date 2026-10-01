// Every item that passes the filters, in a table you sort by clicking a column. The chips
// above it pick the status and the types (table-filters.tsx). It scrolls on its own; on a
// phone each row becomes a small card.

import { cn } from "@/lib/utils"
import { isComplete } from "@/core/model"
import { hhmm, parse, DOW, MON } from "@/core/dates"
import { course as courseOf } from "@/core/store"
import { useTable } from "@/data/views"
import { openItem, sortTable } from "@/data/actions"
import { TableFilters } from "./table-filters"
import type { Course, Item, SortKey } from "@/data/types"
import type { TableFilters as Filters } from "@/data/views"
import { itemTypes } from "@/data/actions"
import { accent, Empty, HeadNote, onActivate, Panel, StatusChip, Steps, TypeChip } from "./bits"

const when = (it: Item) => {
    if (it.recur === "weekly") return "Weekly · " + DOW[it.weekday ?? 0]
    const d = parse(it.date)
    return DOW[d.getDay()] + " " + d.getDate() + " " + MON[d.getMonth()].slice(0, 3)
}
/** What the empty table says is hiding things: the status, the types off, the course, the search. */
function hiddenBy(f: Filters): string {
    const off = itemTypes().filter((t) => !t.hidden && f.types[t.id] === false).length
    const c = f.course !== "all" ? (courseOf(f.course) as Course | null) : null
    const parts = [
        f.show === "open" ? "Open" : f.show === "overdue" ? "Overdue" : "",
        off ? off + (off === 1 ? " type" : " types") + " off" : "",
        f.course !== "all" ? (c ? c.name : "a course") : "",
        f.search ? "the search" : "",
    ].filter(Boolean)
    return parts.length ? "Hidden by " + parts.join(", ") + "." : ""
}

const time = (it: Item) => (it.start ? hhmm(it.start) + (it.end ? "–" + hhmm(it.end) : "") : it.end ? hhmm(it.end) : "")

export function TableView() {
    const { rows, total, sort, filters, overdue, perType } = useTable()
    const why = hiddenBy(filters)

    const Head = ({ k, label }: { k: SortKey; label: string }) => {
        const on = sort.key === k
        return (
            <th aria-sort={on ? (sort.dir > 0 ? "ascending" : "descending") : "none"} className="sticky top-0 z-[1] border-b border-border bg-card p-0 text-left">
                <button type="button" onClick={() => sortTable(k)}
                    className="flex w-full cursor-pointer items-center gap-1 border-0 bg-transparent px-3 py-2 font-[inherit] text-[10.5px] font-bold tracking-[.1em] text-ink-2 uppercase hover:text-foreground">
                    {label}{on && <span aria-hidden="true" className="text-[var(--accent)]">{sort.dir > 0 ? "↑" : "↓"}</span>}
                </button>
            </th>
        )
    }
    const plain = "sticky top-0 z-[1] border-b border-border bg-card px-3 py-2 text-left text-[10.5px] font-bold tracking-[.1em] text-ink-2 uppercase"
    const td = "border-b border-line-2 px-3 py-2 align-middle"

    return (
        <Panel label="All items" title="All items" head={<HeadNote>{rows.length} shown of {total}</HeadNote>} fill>
            <TableFilters overdue={overdue} perType={perType} />
            <div className="min-h-0 flex-1 overflow-auto max-[700px]:overflow-visible">
                <table className="w-full border-collapse text-[12.5px] max-[640px]:block">
                    <thead className="max-[640px]:hidden">
                        <tr>
                            <Head k="title" label="Item" />
                            <Head k="type" label="Type" />
                            <Head k="course" label="Course" />
                            <Head k="date" label="Date" />
                            <th className={plain}>Time</th>
                            <th className={plain}>Where</th>
                            <Head k="status" label="Status" />
                        </tr>
                    </thead>
                    <tbody className="max-[640px]:grid max-[640px]:gap-2 max-[640px]:p-2.5">
                        {rows.length === 0 && (
                            <tr><td colSpan={7}>
                                {total === 0 || !why
                                    ? <Empty title="No items yet">Add one with New item.</Empty>
                                    : <Empty title="Nothing matches the filters">{why}</Empty>}
                            </td></tr>
                        )}
                        {rows.map((it) => {
                            const c = courseOf(it.courseId) as Course | null
                            return (
                                <tr
                                    key={it.id}
                                    tabIndex={0}
                                    onClick={() => openItem(it.id)}
                                    onKeyDown={onActivate(() => openItem(it.id))}
                                    className={cn(
                                        "cursor-pointer hover:bg-muted focus-visible:bg-muted focus-visible:outline-2 focus-visible:outline-[var(--accent)]",
                                        "max-[640px]:grid max-[640px]:grid-cols-[1fr_auto] max-[640px]:gap-x-2 max-[640px]:gap-y-1 max-[640px]:rounded-lg max-[640px]:border max-[640px]:border-border max-[640px]:bg-card max-[640px]:p-2.5 max-[640px]:[&>td]:border-0 max-[640px]:[&>td]:p-0",
                                        isComplete(it) && "bg-[var(--done)] text-[var(--done-ink)] hover:bg-[var(--done)] hover:brightness-[.975]",
                                    )}
                                >
                                    <td className={td}>
                                        <b className={cn("font-semibold", isComplete(it) ? "text-[var(--done-ink)]" : "text-foreground")}>{it.title}</b>
                                        <Steps item={it} className="mt-1" />
                                    </td>
                                    <td className={cn(td, "max-[640px]:text-right")}><TypeChip type={it.type} /></td>
                                    <td className={td}>
                                        {c
                                            ? <span style={accent(c.color)} className="inline-flex items-center gap-1.5 text-[11.5px] whitespace-nowrap text-ink-2"><i aria-hidden="true" className="size-[7px] flex-none rounded-[2px] bg-[var(--c)]" />{c.code}</span>
                                            : <span className="text-muted-foreground max-[640px]:hidden">—</span>}
                                    </td>
                                    <td className={cn(td, "font-mono whitespace-nowrap text-ink-2 max-[640px]:text-right")}>{when(it)}</td>
                                    <td className={cn(td, "font-mono whitespace-nowrap", time(it) ? "text-ink-2" : "text-muted-foreground max-[640px]:hidden")}>{time(it) || "—"}</td>
                                    <td className={cn(td, it.where ? "text-ink-2" : "text-muted-foreground max-[640px]:hidden")}>{it.where || "—"}</td>
                                    <td className={cn(td, "max-[640px]:col-span-2")}><StatusChip item={it} /></td>
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            </div>
        </Panel>
    )
}
