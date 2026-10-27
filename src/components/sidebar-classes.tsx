// The sidebar's shared-class parts (spec §15): + New as a menu: a course, a shared class, a
// team project, or joining with a code. The menu follows the ARIA
// menu pattern. Classes themselves are rows of the course list (sidebar.tsx), projects are
// the Projects group (sidebar-projects.tsx); the invites are in the inbox, the top bar's bell.

import { useEffect, useRef, useState } from "react"
import { useMenuKeys } from "@/lib/menu-keys"
import { openJoin, openNewClass } from "@/data/classes"
import { openCourse } from "@/data/actions"
import { openNewProject } from "@/data/projects"

type Entry = [string, string, () => void]
const ITEMS: readonly Entry[] = [
    ["New course", "Only you", () => openCourse(null)],
    ["New shared class", "Blank, from a course, or an outline", openNewClass],
    ["New team project", "Tasks shared with a team", () => openNewProject()],
    ["Join with code", "8 characters from a classmate", () => openJoin()],
]

/** + New: a course, a shared class, a team project, or joining with a code. */
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
    const keys = useMenuKeys("menuitem", close, () => setOpen(false))

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
