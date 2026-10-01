// The ARIA keyboard patterns for a row of options with one Tab stop: a radio group (the
// checked option, or the first when none is checked) and a tab list (the selected tab).
// The arrow keys, Home and End move to an option and select it.

import type { KeyboardEvent } from "react"

/** tabIndex for option `i`: the checked one, or the first when nothing is checked. */
export const rovingTab = (i: number, checked: number) => (i === (checked < 0 ? 0 : checked) ? 0 : -1)

/* onKeyDown for a group of `role` options: focus and click the one the key points to.
   With `upDown` the up and down arrows move too (a radio group); a row of tabs takes left and right only. */
function moveKeys(role: string, upDown: boolean) {
    return (e: KeyboardEvent<HTMLElement>) => {
        const opts = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="' + role + '"]'))
        const at = opts.indexOf(document.activeElement as HTMLElement)
        if (at < 0 || !opts.length) return
        const n = opts.length
        const to = e.key === "ArrowRight" || (upDown && e.key === "ArrowDown") ? (at + 1) % n
            : e.key === "ArrowLeft" || (upDown && e.key === "ArrowUp") ? (at + n - 1) % n
            : e.key === "Home" ? 0
            : e.key === "End" ? n - 1
            : -1
        if (to < 0) return
        e.preventDefault()
        opts[to].focus()
        opts[to].click()
    }
}

/** onKeyDown for the role="radiogroup" element: focus and click the option the key points to. */
export const radioKeys = moveKeys("radio", true)

/** onKeyDown for the role="tablist" element: left and right, Home and End open the tab they reach. */
export const tabKeys = moveKeys("tab", false)
