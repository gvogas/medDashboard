// Small pieces the sidebar's sections share: the section heading, a filter row with its
// colour pip and count chip, and what counts as an open item.

import type { ReactNode } from "react"
import { isOpen } from "@/core/model"
import { cn } from "@/lib/utils"
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
