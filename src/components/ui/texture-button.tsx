import * as React from "react"
import { cn } from "@/lib/utils"

type Variant = "primary" | "secondary" | "accent" | "destructive" | "minimal" | "icon"
type Size = "default" | "sm" | "lg" | "icon"

const VARIANT: Record<Variant, string> = {
    primary: "bg-foreground text-background hover:opacity-90",
    accent: "bg-foreground text-background hover:opacity-90",
    secondary: "border border-border bg-card text-foreground hover:bg-muted",
    minimal: "border border-border bg-card text-foreground hover:bg-muted",
    icon: "bg-transparent text-ink-2 hover:bg-muted hover:text-foreground",
    destructive: "bg-destructive text-[var(--on-crit)] hover:opacity-90",
}
const SIZE: Record<Size, string> = {
    default: "h-9 px-3.5 text-[13px]",
    sm: "h-8 px-2.5 text-[12.5px]",
    lg: "h-11 px-5 text-[14px]",
    icon: "size-9",
}

export interface TextureButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: Variant
    size?: Size
}

/** A plain button; the name is kept so its many callers don't change. */
export const TextureButton = React.forwardRef<HTMLButtonElement, TextureButtonProps>(
    ({ className, variant = "primary", size = "default", children, ...props }, ref) => (
        <button
            ref={ref}
            className={cn("inline-flex cursor-pointer items-center justify-center gap-2 rounded-[6px] font-medium whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50", VARIANT[variant], SIZE[size], className)}
            {...props}
        >
            {children}
        </button>
    ),
)
TextureButton.displayName = "TextureButton"
