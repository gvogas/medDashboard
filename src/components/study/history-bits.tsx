// What the History card's tabs share: a course's colour and code, the heat tints, the small parts.

import { type CSSProperties, type ReactNode } from "react"
import { courseByKey } from "@/data/effective"
import { projectCourse } from "@/data/projects"
import { leftSpaceLabel } from "@/data/refs"
import { accent } from "@/components/views/bits"
import { NO_COURSE } from "@/data/study"
import type { Course } from "@/data/types"

/* a session's course: yours, a class's, or a team project's (projects.ts withProjects) */
export const courseOf = (id: string | null) => courseByKey(id) ?? projectCourse(id)
/* A course's colour for --c; sessions with none, or a course since deleted, are grey. */
export const courseColour = (id: string | null): CSSProperties | undefined => accent((courseOf(id) as Course | null)?.color) ?? accent(NO_COURSE)
export const courseCode = (id: string | null) => (courseOf(id) as Course | null)?.code || (leftSpaceLabel(id) ?? "No course")
export const plural = (n: number, one: string) => n + " " + one + (n === 1 ? "" : "s")
export const reduced = () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches

/** The level tints, 0 to 4, of the heatmap's squares and the month's days. */
export const HEAT = [
    "bg-line-2",
    "bg-[color-mix(in_srgb,var(--study)_28%,var(--panel-2))]",
    "bg-[color-mix(in_srgb,var(--study)_52%,var(--panel-2))]",
    "bg-[color-mix(in_srgb,var(--study)_76%,var(--panel-2))]",
    "bg-[var(--study)]",
]
export const DAY_TINT = [
    "bg-card",
    "bg-[color-mix(in_srgb,var(--study)_8%,var(--panel))]",
    "bg-[color-mix(in_srgb,var(--study)_16%,var(--panel))]",
    "bg-[color-mix(in_srgb,var(--study)_26%,var(--panel))]",
    "bg-[color-mix(in_srgb,var(--study)_36%,var(--panel))]",
]

export const NavButton = ({ label, disabled = false, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: ReactNode }) => (
    <button type="button" aria-label={label} disabled={disabled} onClick={onClick}
        className="grid size-[34px] cursor-pointer place-items-center rounded-[9px] border border-border bg-muted p-0 text-foreground hover:border-[color-mix(in_srgb,var(--accent)_50%,var(--line))] disabled:cursor-default disabled:opacity-35 max-[700px]:size-10">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="size-3.5">{children}</svg>
    </button>
)

export const SubHead = ({ children, note }: { children: ReactNode; note?: string }) => (
    <h3 className="m-0 flex items-baseline gap-2 text-[11px] font-semibold tracking-[.12em] text-ink-2 uppercase">
        {children}
        {note && <em className="text-[11px] font-medium tracking-normal text-muted-foreground not-italic normal-case">{note}</em>}
    </h3>
)

export const Hint = ({ children }: { children: ReactNode }) => <p className="m-0 px-0.5 py-2.5 text-[12.5px] text-ink-2">{children}</p>
