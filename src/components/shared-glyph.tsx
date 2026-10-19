// The two-person glyph of a shared class and the team glyph of a project (spec §15), as the
// prototype draws them.

import { cn } from "@/lib/utils"

export const SharedGlyph = ({ className }: { className?: string }) => (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className={cn("size-3.5 shrink-0", className)}>
        <circle cx="5.5" cy="5.5" r="2.3" />
        <circle cx="11" cy="6" r="1.9" />
        <path d="M1.5 13.5c.4-2.4 2-3.7 4-3.7s3.6 1.3 4 3.7M10 10c2 0 3.6.9 4.2 3.3" />
    </svg>
)

/** The team glyph of a project (spec §9, §15): three heads. */
export const TeamGlyph = ({ className }: { className?: string }) => (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className={cn("size-3.5 shrink-0", className)}>
        <circle cx="8" cy="4.6" r="2" />
        <circle cx="3.6" cy="7" r="1.6" />
        <circle cx="12.4" cy="7" r="1.6" />
        <path d="M4.5 13.5c.4-2.2 1.8-3.4 3.5-3.4s3.1 1.2 3.5 3.4M1 12.6c.3-1.5 1.2-2.4 2.6-2.4M15 12.6c-.3-1.5-1.2-2.4-2.6-2.4" />
    </svg>
)
