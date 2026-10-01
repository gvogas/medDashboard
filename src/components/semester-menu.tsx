// The sidebar's semester picker: a quiet button with the semester's name, opening a short
// list drawn like the time field's (a native select's list is the browser's own, and does
// not follow the theme). The ARIA listbox pattern: the arrow keys, Home and End move
// through the semesters, Enter or a click picks, Escape, Tab or a click outside closes.

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react"
import { cn } from "@/lib/utils"

export function SemesterMenu({ names, value, onPick }: { names: string[]; value: string; onPick: (name: string) => void }) {
    const [open, setOpen] = useState(false)
    const wrap = useRef<HTMLDivElement>(null)
    const button = useRef<HTMLButtonElement>(null)
    const list = useRef<HTMLDivElement>(null)
    const id = useId()

    /* open, the picked semester takes focus; a click anywhere else closes */
    useEffect(() => {
        if (!open) return
        list.current?.querySelector<HTMLElement>("[aria-selected=true]")?.focus()
        const away = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false) }
        document.addEventListener("mousedown", away)
        return () => document.removeEventListener("mousedown", away)
    }, [open])

    const close = () => { setOpen(false); button.current?.focus() }
    const pick = (name: string) => { if (name !== value) onPick(name); close() }

    const keys = (e: KeyboardEvent<HTMLDivElement>) => {
        const opts = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="option"]'))
        const at = opts.indexOf(document.activeElement as HTMLElement), n = opts.length
        const to = e.key === "ArrowDown" ? (at + 1) % n : e.key === "ArrowUp" ? (at + n - 1) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1
        if (to >= 0) { e.preventDefault(); opts[to].focus() }
        /* the narrow sidebar must not close on this Escape */
        else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close() }
        else if (e.key === "Tab") setOpen(false)
    }

    return (
        <div ref={wrap} className="relative">
            <button
                ref={button}
                type="button"
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-controls={open ? id : undefined}
                aria-label={"Semester: " + value}
                onClick={() => setOpen((o) => !o)}
                onKeyDown={(e) => { if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setOpen(true) } }}
                className={cn(
                    "flex cursor-pointer items-center gap-1 rounded-md border-0 bg-transparent px-1.5 py-0.5 font-[inherit] text-[12px] font-medium text-foreground hover:bg-muted pointer-coarse:min-h-10",
                    open && "bg-muted",
                )}
            >
                {value}
                <svg aria-hidden="true" viewBox="0 0 12 12" className={cn("size-3 text-muted-foreground transition-transform", open && "rotate-180")}>
                    <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            </button>
            {open && (
                <div
                    ref={list}
                    id={id}
                    role="listbox"
                    aria-label="Semester"
                    onKeyDown={keys}
                    className="absolute top-full right-0 z-50 mt-1 min-w-[148px] rounded-[10px] border border-border bg-card p-1 shadow-[var(--shadow-2)]"
                >
                    {names.map((name) => (
                        <button
                            key={name}
                            type="button"
                            role="option"
                            aria-selected={name === value}
                            tabIndex={name === value ? 0 : -1}
                            onClick={() => pick(name)}
                            className={cn(
                                "flex w-full cursor-pointer items-center justify-between gap-3 rounded-md border-0 bg-transparent px-2.5 py-1.5 text-left font-[inherit] text-[12.5px] whitespace-nowrap text-foreground outline-none hover:bg-muted focus-visible:bg-muted",
                                name === value && "font-semibold text-accent-foreground",
                            )}
                        >
                            {name}
                            {name === value && <span aria-hidden="true" className="text-[11px]">✓</span>}
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}
