// A four-card flip clock, MM:SS. Each card flips when its digit changes: the old top half
// falls, then the new bottom half lands. With reduced motion the digits just change.
// Sizes and colours come from CSS variables (index.css, .fc-*): a parent may set
// --flip-w on the clock (the rest follows from it), and --clk-card/--clk-card-2 colour it.

import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"

export type ClockSize = "big" | "ready" | "mini"

const FLIP_MS = 500
const still = () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches

/** `ms` rounded up to the second, as minutes (at most 99) and seconds. */
export function clockParts(ms: number) {
    const t = Math.max(0, Math.ceil(ms / 1000)), m = Math.min(99, Math.floor(t / 60)), s = t % 60
    return { m, s, digits: String(m).padStart(2, "0") + String(s).padStart(2, "0") }
}

/* `was` differs from `now` while the card flips from one to the other; `n` counts the
   changes, so a digit that changes again mid-flip starts its animation over. */
interface Face { now: string; was: string; n: number }

function Card({ digit }: { digit: string }) {
    const [face, setFace] = useState<Face>({ now: digit, was: digit, n: 0 })
    if (face.now !== digit) setFace({ now: digit, was: still() ? digit : face.now, n: face.n + 1 })
    const flipping = face.was !== face.now

    useEffect(() => {
        if (!flipping) return
        const id = setTimeout(() => setFace((f) => ({ ...f, was: f.now })), FLIP_MS)
        return () => clearTimeout(id)
    }, [flipping, face.n])

    const half = (cls: string, v: string, key?: string) => (
        <span key={key} className={cn("fc-half", cls)}><span>{v}</span></span>
    )
    return (
        <span className={cn("fc-card", flipping && "fc-flipping")} data-digit={face.now}>
            {half("fc-top", face.now)}
            {half("fc-bot", face.was)}
            {half("fc-ftop", face.was, "f" + face.n)}
            {half("fc-fbot", face.now, "b" + face.n)}
        </span>
    )
}

export function FlipClock({ ms, running, size, className }: { ms: number; running: boolean; size: ClockSize; className?: string }) {
    const { m, s, digits } = clockParts(ms)
    return (
        <span className={cn("fc-clock", "fc-" + size, running && "fc-running", className)} role="timer" aria-live="off">
            <span className="fc-pair" aria-hidden="true"><Card digit={digits[0]} /><Card digit={digits[1]} /></span>
            <span className="fc-colon" aria-hidden="true"><i /><i /></span>
            <span className="fc-pair" aria-hidden="true"><Card digit={digits[2]} /><Card digit={digits[3]} /></span>
            <span className="sr-only">{m} minutes {s} seconds left</span>
        </span>
    )
}
