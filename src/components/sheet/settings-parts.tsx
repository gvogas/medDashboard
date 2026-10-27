// The parts every Settings tab is made of: a group, its hint, a row of chips.

import { type ReactNode } from "react"
import { cn } from "@/lib/utils"

/** A group of settings: a title, what it is set to, and its controls. */
export function Group({ title, state, id, children }: { title: string; state?: ReactNode; id?: string; children: ReactNode }) {
    return (
        <section id={id} tabIndex={id ? -1 : undefined} className="flex flex-col gap-2 border-b border-line-2 pb-3.5 outline-none last:border-b-0 last:pb-0">
            <h4 className="m-0 flex items-center gap-2 text-[12.5px] font-[650] text-ink-2">
                {title}
                {state != null && <em className="ml-auto text-[11px] font-medium text-muted-foreground not-italic">{state}</em>}
            </h4>
            {children}
        </section>
    )
}
export const Hint = ({ error, children }: { error?: boolean; children: ReactNode }) => (
    <span className={cn("text-[11.5px]", error ? "text-destructive" : "text-muted-foreground")}>{children}</span>
)
export const Row = ({ children }: { children: ReactNode }) => <span className="flex flex-wrap gap-1.5">{children}</span>

/** A pressable chip: a goal preset, a rest day. */
export const Chip = ({ on, tone = "accent", ...props }: React.ComponentProps<"button"> & { on: boolean; tone?: "accent" | "study" }) => (
    <button type="button" aria-pressed={on} {...props}
        className={cn(
            "min-w-11 cursor-pointer rounded-lg border border-border bg-muted px-3 py-1.5 font-[inherit] text-[12px] font-semibold text-ink-2 hover:text-foreground",
            on && (tone === "study"
                ? "border-[var(--study)] bg-[var(--study-soft)] font-bold text-[var(--study-ink)]"
                : "border-[var(--accent)] bg-accent font-bold text-accent-foreground"),
        )} />
)
