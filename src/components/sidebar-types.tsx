// "Open items": a filter per item type with its count, and the editor behind ✎ where
// types are reordered (drag, or ↑/↓ on the handle), renamed, recoloured, hidden, deleted
// and added. Every edit saves through the actions, which redraw the views.

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react"
import { Reorder, useDragControls } from "framer-motion"
import { TYPE_KINDS } from "@/core/model"
import { useItems, useProfile } from "@/data/store"
import { useUi } from "@/data/ui"
import {
    addType, canAddType, canDeleteType, deleteType, freeTypeColour, isTypeOn, itemTypes, recolourType,
    renameType, reorderTypes, toggleType, toggleTypeHidden, TYPE_LABEL_MAX, TYPE_PALETTE,
} from "@/data/actions"
import type { Item, ItemType } from "@/data/types"
import { cn } from "@/lib/utils"
import { Count, counts, Heading, headingButton, Pip, Row } from "./sidebar-parts"

const KIND_NOTE: Record<string, string> = {
    todo: "To do, then done, like Tasks.",
    event: "Scheduled, attended or missed, like Labs.",
    graded: "Open, submitted, graded, with a weight, like Assignments.",
}

const quietIcon = "grid size-6 shrink-0 place-items-center rounded-md border-0 bg-transparent p-0 text-muted-foreground hover:text-primary pointer-coarse:size-10"
const field = "min-w-0 rounded-md border border-border bg-card px-2 py-1 text-[12.5px] text-foreground"

export function TypeList() {
    const items = useItems()
    useProfile()                               // the type list lives on the profile
    const course = useUi((ui) => ui.course)
    const [editing, setEditing] = useState(false)
    const pen = useRef<HTMLButtonElement>(null)
    const back = useRef(false)

    useEffect(() => {
        if (!editing && back.current) pen.current?.focus()
        back.current = false
    }, [editing])

    const leave = () => { back.current = true; setEditing(false) }
    const types = itemTypes()
    const n: Record<string, number> = {}
    for (const it of items) {
        if (course !== "all" && it.courseId !== course) continue
        if (counts(it)) n[it.type] = (n[it.type] || 0) + 1
    }

    const onKeyDown = (e: KeyboardEvent) => {
        if (e.key !== "Escape" || !editing || e.isDefaultPrevented()) return
        e.preventDefault()                     // the page's Escape handler (keyboard.ts) stands aside
        leave()
    }

    return (
        <section aria-label="Open items" onKeyDown={onKeyDown}>
            <Heading
                action={editing
                    ? <button type="button" className={cn(headingButton, "text-primary")} onClick={leave}>Done</button>
                    : <button ref={pen} type="button" className={headingButton} aria-label="Edit item types" title="Rename, recolour, reorder or hide" onClick={() => setEditing(true)}>✎</button>}
            >
                Open items
            </Heading>
            {editing
                ? <TypeEditor types={types} items={items} />
                : (
                    <div className="flex flex-col gap-px">
                        {types.filter((t) => !t.hidden).map((t) => {
                            const on = isTypeOn(t.id)
                            return (
                                <Row key={t.id} pressed={on} dim={!on} onClick={() => toggleType(t.id)}>
                                    <Pip color={t.color} hollow={!on} />
                                    <span data-label className="min-w-0 truncate">{t.plural}</span>
                                    <Count n={n[t.id] || 0} />
                                </Row>
                            )
                        })}
                    </div>
                )}
        </section>
    )
}

/* ── the editor ── */

function TypeEditor({ types, items }: { types: ItemType[]; items: Item[] }) {
    const ids = types.map((t) => t.id), saved = ids.join()
    /* The order being dragged, until the saved list catches up with it. */
    const [local, setLocal] = useState<{ from: string; order: string[] } | null>(null)
    const order = local && local.from === saved ? local.order : ids
    const latest = useRef(order)
    latest.current = order
    const grips = useRef(new Map<string, HTMLButtonElement>())
    const refocus = useRef<string | null>(null)
    const [adding, setAdding] = useState(false)
    const addButton = useRef<HTMLButtonElement>(null)
    const wasAdding = useRef(false)

    const move = (next: string[]) => { latest.current = next; setLocal({ from: saved, order: next }) }
    const drop = () => { if (latest.current.join() !== saved) reorderTypes(latest.current) }

    /* ↑/↓ on a handle: the row moves and the keyboard stays on its handle. */
    const step = (id: string, e: KeyboardEvent) => {
        if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return
        e.preventDefault()
        const next = [...order], i = next.indexOf(id), j = i + (e.key === "ArrowUp" ? -1 : 1)
        if (j < 0 || j >= next.length) return
        ;[next[i], next[j]] = [next[j], next[i]]
        refocus.current = id
        move(next)
        reorderTypes(next)
    }

    useLayoutEffect(() => {
        if (!refocus.current) return
        grips.current.get(refocus.current)?.focus()
        refocus.current = null
    })

    useEffect(() => {
        if (wasAdding.current && !adding) addButton.current?.focus()
        wasAdding.current = adding
    }, [adding])

    const byId = new Map(types.map((t) => [t.id, t]))
    const used: Record<string, number> = {}
    for (const it of items) used[it.type] = (used[it.type] || 0) + 1

    return (
        <div className="flex flex-col gap-1">
            <Reorder.Group as="ul" axis="y" values={order} onReorder={move} className="m-0 flex list-none flex-col gap-px p-0">
                {order.map((id) => {
                    const t = byId.get(id)
                    return t ? (
                        <EditRow key={id} t={t} used={used[id] || 0} onDrop={drop} onKey={(e) => step(id, e)}
                            gripRef={(el) => { if (el) grips.current.set(id, el); else grips.current.delete(id) }} />
                    ) : null
                })}
            </Reorder.Group>
            <p className="m-0 px-2 pt-1 text-[11px] leading-snug text-muted-foreground">
                Hidden types leave the sidebar and the new-item list; their items stay.
            </p>
            {adding
                ? <AddForm onClose={() => setAdding(false)} />
                : canAddType() && (
                    <button ref={addButton} type="button" onClick={() => setAdding(true)}
                        className="mt-1 w-full rounded-[9px] border border-dashed border-border bg-transparent px-2 py-1.5 text-left text-[12px] text-ink-2 hover:border-primary hover:text-primary">
                        + Add a type
                    </button>
                )}
        </div>
    )
}

interface EditRowProps {
    t: ItemType
    used: number
    onDrop: () => void
    onKey: (e: KeyboardEvent) => void
    gripRef: (el: HTMLButtonElement | null) => void
}

function EditRow({ t, used, onDrop, onKey, gripRef }: EditRowProps) {
    const drag = useDragControls()
    const [dragging, setDragging] = useState(false)

    const onNameKey = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") e.currentTarget.blur()
        if (e.key === "Escape") {
            e.preventDefault()
            e.currentTarget.value = t.label
            e.currentTarget.blur()
        }
    }
    const onNameBlur = (box: HTMLInputElement) => {
        const name = box.value.trim()
        if (name === t.label) return
        if (!name && t.custom) { box.value = t.label; return }   // a type of your own keeps a name
        renameType(t.id, name)                                  // empty on a built-in: its own name back
    }

    return (
        <Reorder.Item
            as="li"
            value={t.id}
            dragListener={false}
            dragControls={drag}
            onDragStart={() => setDragging(true)}
            onDragEnd={() => { setDragging(false); onDrop() }}
            className={cn("relative flex items-center gap-1 rounded-[9px] py-1 pr-1 pl-0.5 hover:bg-muted", dragging && "z-10 bg-card shadow-md")}
        >
            <button
                ref={gripRef}
                type="button"
                className={cn(quietIcon, "cursor-grab touch-none", dragging && "cursor-grabbing")}
                aria-label={`Reorder ${t.plural}. Drag, or use the up and down arrow keys`}
                title="Drag to reorder"
                onPointerDown={(e) => { if (e.button === 0) drag.start(e) }}
                onKeyDown={onKey}
            >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true" className="size-3.5">
                    <path d="M3 4.5h10M3 8h10M3 11.5h10" />
                </svg>
            </button>
            <button
                type="button"
                className="grid size-5 shrink-0 place-items-center rounded-full border-0 bg-transparent p-0 pointer-coarse:size-10"
                aria-label={`Change colour of ${t.plural}`}
                title="Next colour"
                onClick={() => recolourType(t.id)}
            >
                <Pip color={t.color} hollow={t.hidden} className="size-3 rounded-full" />
            </button>
            <input
                key={t.label}
                type="text"
                defaultValue={t.label}
                maxLength={TYPE_LABEL_MAX}
                aria-label={`Name of ${t.plural}`}
                className={cn(field, "flex-1", t.hidden && "text-muted-foreground line-through")}
                onKeyDown={onNameKey}
                onBlur={(e) => onNameBlur(e.currentTarget)}
            />
            <button
                type="button"
                className={cn(quietIcon, t.hidden && "opacity-45")}
                aria-pressed={!t.hidden}
                aria-label={(t.hidden ? "Show " : "Hide ") + t.plural}
                title={t.hidden ? "Hidden. Click to show" : "Shown. Click to hide"}
                onClick={() => toggleTypeHidden(t.id)}
            >
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true" className="size-4">
                    <path d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10z" />
                    <circle cx="10" cy="10" r="2.4" />
                </svg>
            </button>
            {/* Only your own types can go: ✕, or "in use" while items still have the type. */}
            {t.custom && (canDeleteType(t)
                ? <button type="button" className={cn(quietIcon, "text-[11px] hover:text-destructive")} aria-label={`Delete ${t.plural}`} onClick={() => deleteType(t.id)}>✕</button>
                : (
                    <span className="shrink-0 text-[10px] text-muted-foreground" title={`${used} ${used === 1 ? "item uses" : "items use"} it. Hide it instead`}>
                        in use
                    </span>
                ))}
        </Reorder.Item>
    )
}

/* ── a new type: name, colour and how its items behave ── */

function AddForm({ onClose }: { onClose: () => void }) {
    const [label, setLabel] = useState("")
    const [color, setColor] = useState(freeTypeColour)
    const [kind, setKind] = useState("todo")
    const ready = label.trim() !== ""

    const save = async () => {
        if (!ready) return
        await addType(label, color, kind)
        onClose()
    }
    const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") { e.preventDefault(); save() }
    }
    const onFormKey = (e: KeyboardEvent) => {
        if (e.key !== "Escape" || e.isDefaultPrevented()) return
        e.preventDefault()
        onClose()
    }

    return (
        <div role="group" aria-label="New item type" onKeyDown={onFormKey}
            className="mt-1 flex flex-col gap-2.5 rounded-xl border border-dashed border-border bg-card/60 p-2.5">
            <input
                autoFocus
                type="text"
                value={label}
                maxLength={TYPE_LABEL_MAX}
                placeholder="Name, e.g. Quiz"
                aria-label="New type name"
                className={cn(field, "py-1.5")}
                onChange={(e) => setLabel(e.target.value)}
                onKeyDown={onKeyDown}
            />
            <div role="group" aria-label="Colour" className="flex flex-wrap gap-1.5">
                {TYPE_PALETTE.map((c) => (
                    <button
                        key={c}
                        type="button"
                        aria-pressed={c === color}
                        aria-label={"Colour " + c}
                        onClick={() => setColor(c)}
                        className={cn("size-5 rounded-md border-2 border-transparent p-0", c === color && "border-foreground shadow-[inset_0_0_0_2px_#fff]")}
                        style={{ backgroundColor: c }}
                    />
                ))}
            </div>
            <div role="group" aria-label="Kind" className="flex gap-0.5 rounded-lg bg-background p-0.5">
                {(TYPE_KINDS as [string, string, string][]).map(([k, name]) => (
                    <button
                        key={k}
                        type="button"
                        aria-pressed={k === kind}
                        onClick={() => setKind(k)}
                        className={cn("flex-1 rounded-md border-0 bg-transparent px-1.5 py-1 text-[11.5px] text-ink-2", k === kind && "bg-card font-semibold text-foreground shadow-sm")}
                    >
                        {name}
                    </button>
                ))}
            </div>
            <p className="m-0 text-[11px] leading-snug text-muted-foreground">{KIND_NOTE[kind]}</p>
            <div className="flex justify-end gap-1.5">
                <button type="button" onClick={onClose}
                    className="rounded-lg border border-border bg-card px-2.5 py-1 text-[12px] text-ink-2 hover:border-primary hover:text-primary">
                    Cancel
                </button>
                <button type="button" onClick={save} disabled={!ready}
                    className="rounded-lg border-0 bg-primary px-2.5 py-1 text-[12px] font-semibold text-primary-foreground disabled:cursor-default disabled:opacity-50">
                    Add type
                </button>
            </div>
        </div>
    )
}
