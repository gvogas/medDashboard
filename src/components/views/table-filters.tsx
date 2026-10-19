// All items' chips, above the table: the status (All, Open, Overdue), the Source select
// (Personal, a class or a project) when you are in any, and a chip per shown
// item type with its open items, which were the sidebar's "Open items" filters. Edit
// types opens the type editor under them. A stat tile's list says so here, with a way to
// put the course, the search and the source back.

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react"
import { useProfile, useSpaces } from "@/data/store"
import { useUi } from "@/data/ui"
import { pickedSource } from "@/data/views"
import { endTileList, isTypeOn, itemTypes, setShow, setSource, toggleType } from "@/data/actions"
import type { Show } from "@/data/types"
import { cn } from "@/lib/utils"
import { Heading, headingButton, Pip } from "@/components/sidebar-parts"
import { Select } from "@/components/sheet/fields"
import { TypeEditor } from "./type-editor"

const chip = "inline-flex min-h-7 cursor-pointer items-center gap-1.5 rounded-full border border-border px-2.5 py-0.5 font-[inherit] text-[11.5px] font-semibold whitespace-nowrap pointer-coarse:min-h-9"

function Chip({ on, onClick, children, dim = false }: { on: boolean; onClick: () => void; children: ReactNode; dim?: boolean }) {
    return (
        <button
            type="button"
            aria-pressed={on}
            onClick={onClick}
            className={cn(
                chip,
                dim
                    ? on ? "bg-card text-ink-2 hover:text-foreground" : "bg-transparent text-muted-foreground hover:text-foreground [&_[data-label]]:line-through [&_[data-label]]:decoration-current/45"
                    : on ? "border-[var(--accent)] bg-accent text-accent-foreground" : "bg-muted text-ink-2 hover:text-foreground",
            )}
        >
            {children}
        </button>
    )
}

const Count = ({ n, className }: { n: number; className?: string }) => (
    <span className={cn("rounded-md bg-[var(--chip-bg)] px-1.5 font-mono text-[10.5px] font-medium text-[var(--chip-ink)] tabular-nums", className)}>{n}</span>
)

const SHOW: [Show, string][] = [["all", "All"], ["open", "Open"], ["overdue", "Overdue"]]

/* "a and b", "a, b and c" */
const and = (parts: string[]) => parts.length < 3 ? parts.join(" and ") : parts.slice(0, -1).join(", ") + " and " + parts.at(-1)

interface Props {
    /** How many items the Overdue chip would show. */
    overdue: number
    /** Each type's open items, in the course the table goes by. */
    perType: Record<string, number>
}

export function TableFilters({ overdue, perType }: Props) {
    useProfile()                               // the type list lives on the profile
    const show = useUi((u) => u.show || "all")
    const spaces = useSpaces(), source = useUi((u) => pickedSource(u.source, spaces))
    /* a stat tile's list, and what it leaves out that you had picked */
    const tile = useUi((u) => u.listFrom === "tile")
    const course = useUi((u) => u.course !== "all"), searching = useUi((u) => u.search !== "")
    const set = [course && "course", source !== "all" && "source", searching && "search"].filter((x): x is string => !!x)
    const said = and(set.map((x) => (x === "search" ? "no search" : "every " + x)))
    const aside = !tile || !set.length ? null
        : [said[0].toUpperCase() + said.slice(1) + ", as on the tile.", set.length === 1 && set[0] !== "search" ? "Use the " + set[0] + " filter" : "Use the " + and(set)]
    /* the Source select: classes, then projects; an archived space only while it is picked */
    const listed = spaces.filter((s) => !s.archived || source === "space:" + s.id)
    const group = (kind: "class" | "project", label: string) => {
        const of = listed.filter((s) => s.kind === kind)
        return of.length > 0 && <optgroup label={label}>{of.map((s) => <option key={s.id} value={"space:" + s.id}>{s.name}</option>)}</optgroup>
    }
    const [editing, setEditing] = useState(false)
    const pen = useRef<HTMLButtonElement>(null)
    const back = useRef(false)

    useEffect(() => {
        if (!editing && back.current) pen.current?.focus()
        back.current = false
    }, [editing])

    const leave = () => { back.current = true; setEditing(false) }
    const onKeyDown = (e: KeyboardEvent) => {
        if (e.key !== "Escape" || !editing || e.isDefaultPrevented()) return
        e.preventDefault()                     // the page's Escape handler (keyboard.ts) stands aside
        leave()
    }

    return (
        <div className="flex flex-col gap-2 border-b border-border px-5 py-2.5 max-[640px]:px-3" onKeyDown={onKeyDown}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <div role="group" aria-label="Show" className="flex flex-wrap gap-1.5">
                    {SHOW.map(([id, label]) => (
                        <Chip key={id} on={show === id} onClick={() => setShow(id)}>
                            {label}
                            {id === "overdue" && <Count n={overdue} className={overdue ? "bg-[var(--red-bg)] text-[var(--red-ink)]" : undefined} />}
                        </Chip>
                    ))}
                </div>
                {spaces.length > 0 && (
                    <label className="flex min-w-0 max-w-full items-center gap-1.5 text-[12px] text-muted-foreground">
                        Source
                        <Select value={source} onChange={(e) => setSource(e.target.value)} aria-label="Source" className="w-auto min-w-0 max-w-full">
                            <option value="all">Everything</option>
                            <option value="personal">Personal</option>
                            {group("class", "Classes")}
                            {group("project", "Projects")}
                        </Select>
                    </label>
                )}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
                <div role="group" aria-label="Types" className="flex flex-wrap gap-1.5">
                    {itemTypes().filter((t) => !t.hidden).map((t) => {
                        const on = isTypeOn(t.id)
                        return (
                            <Chip key={t.id} on={on} dim onClick={() => toggleType(t.id)}>
                                <Pip color={t.color} hollow={!on} />
                                <span data-label>{t.plural}</span>
                                <Count n={perType[t.id] || 0} />
                            </Chip>
                        )
                    })}
                </div>
                <button
                    ref={pen}
                    type="button"
                    aria-label="Edit types"
                    aria-expanded={editing}
                    title="Rename, recolour, reorder or hide"
                    onClick={() => (editing ? leave() : setEditing(true))}
                    className={cn(chip, "border-dashed bg-transparent text-ink-2 hover:border-primary hover:text-primary", editing && "border-primary text-primary")}
                >
                    ✎ Edit types
                </button>
            </div>
            {editing && (
                <section aria-label="Item types" className="w-full max-w-[420px] rounded-xl border border-border bg-background p-2">
                    <Heading action={<button type="button" className={cn(headingButton, "text-primary")} onClick={leave}>Done</button>}>
                        Item types
                    </Heading>
                    <TypeEditor />
                </section>
            )}
            {aside && (
                <p className="m-0 flex flex-wrap items-center gap-x-2 text-[11.5px] text-muted-foreground">
                    {aside[0]}
                    <button type="button" onClick={endTileList} className="rounded-md border-0 bg-transparent p-0 font-[inherit] text-[11.5px] font-semibold text-primary underline-offset-2 hover:underline pointer-coarse:min-h-9">
                        {aside[1]}
                    </button>
                </p>
            )}
        </div>
    )
}
