// All items' chips, above the table: the status (All, Open, Overdue) and a chip per shown
// item type with its open items, which were the sidebar's "Open items" filters. Edit
// types opens the type editor under them. A stat tile's list says so here, with a way to
// put the course and the search back.

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react"
import { useProfile } from "@/data/store"
import { useUi } from "@/data/ui"
import { endTileList, isTypeOn, itemTypes, setShow, toggleType } from "@/data/actions"
import type { Show } from "@/data/types"
import { cn } from "@/lib/utils"
import { Heading, headingButton, Pip } from "@/components/sidebar-parts"
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

interface Props {
    /** How many items the Overdue chip would show. */
    overdue: number
    /** Each type's open items, in the course the table goes by. */
    perType: Record<string, number>
}

export function TableFilters({ overdue, perType }: Props) {
    useProfile()                               // the type list lives on the profile
    const show = useUi((u) => u.show || "all")
    /* a stat tile's list, and what it leaves out that you had picked */
    const tile = useUi((u) => u.listFrom === "tile")
    const course = useUi((u) => u.course !== "all"), searching = useUi((u) => u.search !== "")
    const aside = !tile ? null
        : course && searching ? ["Every course and no search, as on the tile.", "Use the course and search"]
        : course ? ["Every course, as on the tile.", "Use the course filter"]
        : searching ? ["No search, as on the tile.", "Use the search"]
        : null
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
            <div role="group" aria-label="Show" className="flex flex-wrap gap-1.5">
                {SHOW.map(([id, label]) => (
                    <Chip key={id} on={show === id} onClick={() => setShow(id)}>
                        {label}
                        {id === "overdue" && <Count n={overdue} className={overdue ? "bg-[var(--red-bg)] text-[var(--red-ink)]" : undefined} />}
                    </Chip>
                ))}
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
