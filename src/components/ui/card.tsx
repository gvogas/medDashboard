// A card: white on the paper, a 1px rule, an 8px corner. What the Texture card was.

import * as React from "react"
import { cn } from "@/lib/utils"

export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
    ({ className, ...props }, ref) => (
        <div ref={ref} className={cn("rounded-[var(--radius)] border border-border bg-card", className)} {...props} />
    ),
)
Card.displayName = "Card"
