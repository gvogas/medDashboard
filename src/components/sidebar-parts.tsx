// Small pieces the sidebar's sections share: the section heading, a filter row with its
// colour pip and count chip, a row's eye, and what counts as an open item. All items' type
// chips and type editor use the heading and the pip too.

import type { ReactNode } from "react"
import { isOpen } from "@/core/model"
import { cn } from "@/lib/utils"
import { toggleSource } from "@/data/sources"
import type { Item } from "@/data/types"

/** Open, or a weekly class-like item that is always on the board. */
export const counts = (it: Item) => it.recur === "weekly" || isOpen(it)

export function Heading({ children, action }: { children: ReactNode; action?: ReactNode }) {
    return (
        <div className="flex min-h-6 items-center justify-between gap-2 px-2 pb-1">
            <h2 className="m-0 text-[12px] font-semibold text-muted-foreground">{children}</h2>
            {action}
        </div>
    )
}

/** A quiet text button for a heading: ✎, Done. */
export const headingButton = "rounded-md border-0 bg-transparent px-1.5 py-0.5 text-[12px] font-semibold text-muted-foreground hover:text-primary pointer-coarse:min-h-10 pointer-coarse:min-w-10"

export function Pip({ color, hollow = false, className }: { color: string; hollow?: boolean; className?: string }) {
    return (
        <span
            aria-hidden="true"
            className={cn("size-2 shrink-0 rounded-[3px]", className)}
            style={hollow ? { boxShadow: `inset 0 0 0 1.5px ${color}` } : { background: color }}
        />
    )
}

export function Count({ n }: { n: number }) {
    return (
        <span className="ml-auto shrink-0 rounded-md bg-[var(--chip-bg)] px-1.5 py-px font-mono text-[11px] font-medium text-[var(--chip-ink)] tabular-nums">
            {n}
        </span>
    )
}

interface RowProps {
    pressed: boolean
    dim?: boolean
    onClick: () => void
    children: ReactNode
    className?: string
}

/** A filter: a type or a course. Pressed is shown by the accent when `dim` is not in use. */
export function Row({ pressed, dim, onClick, children, className }: RowProps) {
    return (
        <button
            type="button"
            aria-pressed={pressed}
            onClick={onClick}
            className={cn(
                "flex w-full min-w-0 items-center gap-2.5 rounded-[9px] border-0 bg-transparent px-2 py-1.5 text-left text-[13px] font-medium text-ink-2 hover:bg-muted hover:text-foreground",
                dim === undefined && pressed && "bg-accent font-semibold text-accent-foreground hover:bg-accent hover:text-accent-foreground",
                dim && "text-muted-foreground [&_[data-label]]:line-through [&_[data-label]]:decoration-current/45",
                className,
            )}
        >
            {children}
        </button>
    )
}

/** A row's eye (spec §9): hide its items and classes from your Week and Month, or show them again. A hidden row stays listed, dimmed. */
export function Eye({ source, name, off }: { source: string; name: string; off: boolean }) {
    return (
        <button
            type="button"
            aria-pressed={off}
            aria-label={(off ? "Show " : "Hide ") + name + " on your calendar"}
            title={off ? "Hidden from your Week and Month" : "Hide from your Week and Month"}
            onClick={() => void toggleSource(source)}
            className={cn(
                "shrink-0 rounded-md border-0 bg-transparent px-1.5 py-1 text-muted-foreground hover:text-primary pointer-coarse:min-h-10 pointer-coarse:min-w-10",
                off ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100",
            )}
        >
            <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" className="size-3.5">
                {off
                    ? <path d="M2 2l12 12M6.6 6.7a2 2 0 0 0 2.7 2.7M4.2 4.6C2.9 5.5 2 7 2 7s2.2 4 6 4c1 0 1.9-.3 2.7-.7M7 3.1c.3 0 .7-.1 1-.1 3.8 0 6 4 6 4s-.5 1-1.5 2" />
                    : <><path d="M2 8s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4z" /><circle cx="8" cy="8" r="1.8" /></>}
            </svg>
        </button>
    )
}
