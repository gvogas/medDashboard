// The two-person glyph of a shared class (spec §15), as the prototype draws it.

import { cn } from "@/lib/utils"

export const SharedGlyph = ({ className }: { className?: string }) => (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className={cn("size-3.5 shrink-0", className)}>
        <circle cx="5.5" cy="5.5" r="2.3" />
        <circle cx="11" cy="6" r="1.9" />
        <path d="M1.5 13.5c.4-2.4 2-3.7 4-3.7s3.6 1.3 4 3.7M10 10c2 0 3.6.9 4.2 3.3" />
    </svg>
)
