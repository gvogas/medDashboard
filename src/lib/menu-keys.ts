import type { KeyboardEvent } from "react"

/**
 * The keys of a drawn menu or listbox (ARIA): the arrows, Home and End move through the items
 * (`role`: "menuitem" or "option"), Escape calls `close` (it also keeps the narrow sidebar
 * from closing), Tab calls `dismiss`.
 */
export function useMenuKeys(role: "menuitem" | "option", close: () => void, dismiss: () => void) {
    return (e: KeyboardEvent<HTMLDivElement>) => {
        const opts = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(`[role="${role}"]`))
        const at = opts.indexOf(document.activeElement as HTMLElement), n = opts.length
        const to = e.key === "ArrowDown" ? (at + 1) % n : e.key === "ArrowUp" ? (at + n - 1) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1
        if (to >= 0) { e.preventDefault(); opts[to].focus() }
        /* the narrow sidebar must not close on this Escape */
        else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close() }
        else if (e.key === "Tab") dismiss()
    }
}
