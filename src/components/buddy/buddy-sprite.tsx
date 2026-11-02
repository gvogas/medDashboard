// A study buddy on a <canvas>: the grid from core/buddy-art.ts, painted at a whole-number scale
// so the pixels stay square. One shared clock flips every sprite on screen between its two idle
// frames; it stops in hidden tabs and for people who ask for reduced motion.

import { useEffect, useRef, useSyncExternalStore } from "react"
import { N, sprite, type BuddyId } from "@/core/buddy-art"
import type { Mood } from "@/core/buddy-rules"
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

/** Paint one sprite grid on a canvas at `scale` pixels per cell. */
export function paintSprite(canvas: HTMLCanvasElement, grid: (string | null)[][], scale: number) {
    if (canvas.width !== N * scale) { canvas.width = N * scale; canvas.height = N * scale }
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const c = grid[y][x]
        if (c) { ctx.fillStyle = c; ctx.fillRect(x * scale, y * scale, scale, scale) }
    }
}

export function BuddySprite({ buddy, tier, mood, scale = 4, label, animate = true, className }: {
    buddy: BuddyId; tier: number; mood: Mood; scale?: number; label: string; animate?: boolean; className?: string
}) {
    const ref = useRef<HTMLCanvasElement>(null)
    const f = useSyncExternalStore(animate ? subscribe : noop, animate ? current : resting, resting)
    /* a happy buddy hops on the beat */
    const lift = f && mood === "happy" && tier > 0 ? -1 : 0
    useEffect(() => {
        if (!ref.current) return
        const grid = sprite(buddy, tier, mood, f)
        paintSprite(ref.current, lift ? [...grid.slice(1), Array(N).fill(null)] : grid, scale)
    }, [buddy, tier, mood, f, scale, lift])
    return <canvas ref={ref} {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })} width={N * scale} height={N * scale}
        className={cn("[image-rendering:pixelated]", className)} style={{ width: N * scale, height: N * scale }} />
}
const noop = () => () => {}
