// The ARIA radio-group keyboard pattern: one Tab stop (the checked option, or the first when
// none is), and the arrow keys, Home and End move to an option and select it.

import type { KeyboardEvent } from "react"

/** tabIndex for option `i`: the checked one, or the first when nothing is checked. */
export const rovingTab = (i: number, checked: number) => (i === (checked < 0 ? 0 : checked) ? 0 : -1)

/** onKeyDown for the role="radiogroup" element: focus and click the option the key points to. */
export function radioKeys(e: KeyboardEvent<HTMLElement>) {
    const opts = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]'))
    const at = opts.indexOf(document.activeElement as HTMLElement)
    if (at < 0 || !opts.length) return
    const n = opts.length
    const to = e.key === "ArrowDown" || e.key === "ArrowRight" ? (at + 1) % n
        : e.key === "ArrowUp" || e.key === "ArrowLeft" ? (at + n - 1) % n
        : e.key === "Home" ? 0
        : e.key === "End" ? n - 1
        : -1
    if (to < 0) return
    e.preventDefault()
    opts[to].focus()
    opts[to].click()
}
