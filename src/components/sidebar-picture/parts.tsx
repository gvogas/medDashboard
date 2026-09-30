// The frame every picture shares: a 220×180 drawing, its words positioned over it as
// HTML (never SVG <text>), and one accessible name for the whole.

import type { CSSProperties, ReactNode } from "react"
import { cn } from "@/lib/utils"
import { THEMES, type Bg } from "@/data/themes"

/** The shoulders and body every jacket-like picture starts from. */
export const TORSO = "M18 180V70Q18 44 48 36L86 24L110 64L134 24L172 36Q202 44 202 70V180Z"

export interface PictureProps { name: string; goal: string; username: string }

export const Frame = ({ bg, name, goal, children }: { bg: Bg; name: string; goal: string; children: ReactNode }) => (
    <span role="img" aria-label={THEMES[bg].picture + (name.trim() ? ": " + name + ", headed" : ": headed") + " for " + goal} className="relative mx-auto block h-[180px] w-[220px]">
        {children}
    </span>
)

export const Drawing = ({ children }: { children: ReactNode }) => (
    <svg viewBox="0 0 220 180" width="220" height="180" aria-hidden="true" className="block">{children}</svg>
)

/** Words at (x, y) in the drawing's pixels, centred on x unless `left`. */
export const Tag = ({ x, y, left, className, style, children }: { x: number; y: number; left?: boolean; className?: string; style?: CSSProperties; children: ReactNode }) => (
    <span aria-hidden="true" className={cn("absolute leading-none whitespace-nowrap", className)}
        style={{ left: x, top: y, transform: left ? undefined : "translateX(-50%)", ...style }}>
        {children}
    </span>
)
