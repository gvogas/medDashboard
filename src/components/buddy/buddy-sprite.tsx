// A study buddy on a <canvas>: the grid from core/buddy-art.ts, painted at a whole-number scale
// so the pixels stay square, over its background and inside its frame when it has them. One
// shared clock flips every sprite on screen between its two idle frames; it stops in hidden tabs
// and for people who ask for reduced motion.

import { useEffect, useRef, useSyncExternalStore } from "react"
import { FRAME_W, N, backdrop, framed, sprite, type Shown } from "@/core/buddy-art"
import { COSMETICS, type CustomBuddy, type Mood } from "@/core/buddy-rules"
import { cn } from "@/lib/utils"

export const FRAME_MS = 550

/* the shared frame: ticks only while some sprite is listening */
let frame: 0 | 1 = 0
let timer: ReturnType<typeof setInterval> | undefined
const listeners = new Set<() => void>()
const still = () => typeof window === "undefined" || !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
function subscribe(fn: () => void) {
    listeners.add(fn)
    if (!timer && !still()) timer = setInterval(() => {
        if (document.hidden) return
        frame = frame ? 0 : 1
        listeners.forEach((l) => l())
    }, FRAME_MS)
    return () => {
        listeners.delete(fn)
        if (!listeners.size && timer) { clearInterval(timer); timer = undefined; frame = 0 }
    }
}
const current = () => frame
const resting = () => 0 as const

/** Paint grids on a canvas at `scale` pixels per cell, each over the last, at a cell offset. */
export function paintSprite(canvas: HTMLCanvasElement, layers: { grid: (string | null)[][]; at?: number }[], scale: number, size = N) {
    if (canvas.width !== size * scale) { canvas.width = size * scale; canvas.height = size * scale }
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    for (const { grid, at = 0 } of layers) grid.forEach((row, y) => row.forEach((c, x) => {
        if (c) { ctx.fillStyle = c; ctx.fillRect((x + at) * scale, (y + at) * scale, scale, scale) }
    }))
}

export function BuddySprite({ buddy, tier, mood, scale = 4, label, animate = true, className, custom, bg = "none", frame: ring = "none" }: {
    buddy: Shown; tier: number; mood: Mood; scale?: number; label: string; animate?: boolean; className?: string
    custom?: CustomBuddy | null; bg?: string; frame?: string
}) {
    const ref = useRef<HTMLCanvasElement>(null)
    const f = useSyncExternalStore(animate ? subscribe : noop, animate ? current : resting, resting)
    /* a happy buddy hops on the beat */
    const lift = f && mood === "happy" && tier > 0 ? -1 : 0
    const edge = COSMETICS.some((c) => c.kind === "frame" && c.sku === ring) ? FRAME_W : 0
    const size = N + edge * 2
    useEffect(() => {
        if (!ref.current) return
        const grid = sprite(buddy, tier, mood, f, custom)
        const under = backdrop(bg)
        const layers = [
            ...(edge ? [{ grid: framed(Array.from({ length: N }, () => Array<string | null>(N).fill(null)), ring) }] : []),
            ...(under ? [{ grid: under, at: edge }] : []),
            { grid: lift ? [...grid.slice(1), Array(N).fill(null)] : grid, at: edge },
        ]
        paintSprite(ref.current, layers, scale, size)
    }, [buddy, tier, mood, f, scale, lift, custom, bg, ring, edge, size])
    return <canvas ref={ref} {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })} width={size * scale} height={size * scale}
        className={cn("[image-rendering:pixelated]", className)} style={{ width: size * scale, height: size * scale }} />
}
const noop = () => () => {}
