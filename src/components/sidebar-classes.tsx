// The sidebar's shared-class parts (spec §15): a row for the invites
// waiting, and + New as a menu: a course, a shared class, or joining with a code. The menu
// follows the ARIA menu pattern. Classes themselves are rows of the course list (sidebar.tsx).

import { useEffect, useRef, useState, type KeyboardEvent } from "react"
import { openInvites, openJoin, openNewClass, useInvites } from "@/data/classes"
import { openCourse } from "@/data/actions"
import { Count } from "./sidebar-parts"

const ROW = "flex w-full min-w-0 items-center gap-2.5 rounded-[9px] border-0 bg-transparent px-2 py-1.5 text-left text-[13px] font-medium text-ink-2 hover:bg-muted hover:text-foreground"

/** The invites waiting for you; with none, no row. */
export function InvitesRow() {
    const n = useInvites().filter((i) => !i.expired).length
    if (!n) return null
    return (
        <button type="button" className={ROW} onClick={openInvites}>
            <span className="min-w-0 truncate">Invites</span>
            <Count n={n} />
        </button>
    )
}

const ITEMS: readonly [string, string, () => void][] = [
    ["New course", "Only you", () => openCourse(null)],
    ["New shared class", "Blank, or convert a course", openNewClass],
    ["Join with code", "8 characters from a classmate", () => openJoin()],
]

/** + New: a course, a shared class, or joining with a code. */
export function NewMenu() {
    const [open, setOpen] = useState(false)
    const wrap = useRef<HTMLDivElement>(null)
    const button = useRef<HTMLButtonElement>(null)
    const menu = useRef<HTMLDivElement>(null)

    /* open, the first item takes focus; a click anywhere else closes */
    useEffect(() => {
        if (!open) return
        menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
        const away = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false) }
        document.addEventListener("mousedown", away)
        return () => document.removeEventListener("mousedown", away)
    }, [open])

    const close = () => { setOpen(false); button.current?.focus() }
    const keys = (e: KeyboardEvent<HTMLDivElement>) => {
        const opts = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'))
        const at = opts.indexOf(document.activeElement as HTMLElement), n = opts.length
        const to = e.key === "ArrowDown" ? (at + 1) % n : e.key === "ArrowUp" ? (at + n - 1) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1
        if (to >= 0) { e.preventDefault(); opts[to].focus() }
        /* the narrow sidebar must not close on this Escape */
        else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close() }
        else if (e.key === "Tab") setOpen(false)
    }

    return (
        <div ref={wrap} className="relative mt-1.5">
            <button
                ref={button}
                type="button"
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={() => setOpen((o) => !o)}
                className="w-full rounded-[9px] border border-dashed border-border bg-transparent px-2 py-1.5 text-left text-[12px] text-ink-2 hover:border-primary hover:text-primary"
            >
                + New
            </button>
            {open && (
                <div ref={menu} role="menu" aria-label="New" onKeyDown={keys}
                    className="absolute bottom-full left-0 z-50 mb-1 w-[230px] rounded-[10px] border border-border bg-card p-1 shadow-[var(--shadow-2)]">
                    {ITEMS.map(([label, sub, act]) => (
                        <button
                            key={label}
                            type="button"
                            role="menuitem"
                            tabIndex={-1}
                            onClick={() => { setOpen(false); act() }}
                            className="flex w-full cursor-pointer flex-col items-start gap-px rounded-md border-0 bg-transparent px-2.5 py-1.5 text-left font-[inherit] text-[12.5px] text-foreground outline-none hover:bg-muted focus-visible:bg-muted"
                        >
                            {label}
                            <span className="text-[11px] text-muted-foreground">{sub}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}
