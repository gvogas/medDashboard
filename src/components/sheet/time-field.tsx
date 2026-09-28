// A time you type or pick, HH:MM. Typing "830", "8:30" or "8pm" lands on a valid time
// when it leaves the field; nonsense gets a red outline and is not kept. Focus opens a
// list of quarter hours; ↑/↓ nudge by fifteen minutes; Enter or Escape confirms. The
// list is drawn on <body>: the sheet's slide would otherwise clip and offset it.

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react"
import { createPortal } from "react-dom"
import { cn } from "@/lib/utils"
import { nearestSlot, parseTime, SLOTS, stepTime } from "@/lib/time"
import { CONTROL } from "./fields"

export function TimeField({ value, onChange, id, label, className }: {
    value: string; onChange: (v: string) => void; id?: string; label?: string; className?: string
}) {
    const [text, setShown] = useState(value)
    /* read on blur, which can follow a pick before React has redrawn */
    const typed = useRef(value)
    const setText = (v: string) => { typed.current = v; setShown(v) }
    const [open, setOpen] = useState(false)
    const [bad, setBad] = useState(false)
    const input = useRef<HTMLInputElement>(null)

    /* the stored time changed from elsewhere (a sync, the start moving the end) */
    useEffect(() => { if (document.activeElement !== input.current) { setText(value); setBad(false) } }, [value])

    const commit = (v: string) => {
        setText(v)
        setBad(false)
        if (v !== value) onChange(v)
    }
    /** What was typed, read: kept if it is a time (or blank), else marked. */
    const settle = () => {
        const v = parseTime(typed.current)
        if (v === null) { setBad(true); return }
        commit(v)
    }

    return (
        <>
            <input
                ref={input}
                id={id}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                placeholder="--:--"
                aria-label={label}
                aria-invalid={bad || undefined}
                value={text}
                onFocus={() => setOpen(true)}
                onBlur={() => { settle(); setOpen(false) }}
                onChange={(e) => { setText(e.target.value); setBad(false) }}
                onKeyDown={(e) => {
                    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                        e.preventDefault()
                        commit(stepTime(typed.current, e.key === "ArrowUp" ? 1 : -1))
                    } else if (e.key === "Enter" || e.key === "Escape") {
                        /* the sheet must not close on this Escape */
                        e.preventDefault()
                        e.stopPropagation()
                        e.currentTarget.blur()
                    }
                }}
                className={cn(CONTROL, "w-[72px] flex-none text-center font-mono tabular-nums tracking-[.02em]", bad && "border-destructive text-destructive", className)}
            />
            {open && input.current && createPortal(<Slots anchor={input.current} value={text} onPick={(v) => { commit(v); input.current?.blur() }} />, document.body)}
        </>
    )
}

function Slots({ anchor, value, onPick }: { anchor: HTMLInputElement; value: string; onPick: (v: string) => void }) {
    const list = useRef<HTMLDivElement>(null)
    const [place, setPlace] = useState<CSSProperties>({})
    const near = nearestSlot(value)

    /* under the field, kept there as the sheet scrolls or the window resizes */
    useLayoutEffect(() => {
        const put = () => {
            const r = anchor.getBoundingClientRect()
            setPlace({ left: r.left, top: r.bottom + 4, minWidth: Math.max(96, r.width), maxHeight: Math.max(120, Math.min(240, window.innerHeight - r.bottom - 8)) })
        }
        put()
        window.addEventListener("resize", put)
        document.addEventListener("scroll", put, true)
        return () => { window.removeEventListener("resize", put); document.removeEventListener("scroll", put, true) }
    }, [anchor])
    useEffect(() => { list.current?.querySelector("[aria-selected=true]")?.scrollIntoView?.({ block: "center" }) }, [near])

    return (
        <div
            ref={list}
            role="listbox"
            aria-label="Times"
            style={place}
            onMouseDown={(e) => e.preventDefault()}   /* keep the field focused */
            className="fixed z-[60] overflow-auto rounded-[10px] border border-border bg-card p-1 shadow-[var(--shadow-2)] [scrollbar-width:thin]"
        >
            {SLOTS.map((t) => (
                <button
                    key={t}
                    type="button"
                    role="option"
                    aria-selected={t === near}
                    tabIndex={-1}
                    onClick={() => onPick(t)}
                    className={cn(
                        "block w-full cursor-pointer rounded-md border-0 bg-transparent px-3 py-1.5 text-left font-mono text-[12.5px] leading-none text-foreground hover:bg-muted",
                        t === near && "bg-accent font-semibold text-accent-foreground",
                    )}
                >{t}</button>
            ))}
        </div>
    )
}
