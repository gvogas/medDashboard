// The theme (light, dark or the system's) and the Med or CS background art; both are
// saved to the profile so they follow the account to other devices.

import * as store from "@/core/store"
import { data } from "@/core/store"
import { notify } from "@/bridge"
import { redrawOrnament as drawOrnament } from "./ornament"
import { ui, rememberUi } from "./ui"

export function setTheme(choice: string, { persist = true }: { persist?: boolean } = {}) {
    ui.theme = choice === "light" || choice === "dark" ? choice : "system"
    window.__roundsApplyTheme?.(ui.theme)
    rememberUi()
    /* a failed save shows its own toast */
    if (persist && data.profile && data.profile.theme !== ui.theme) store.saveProfile({ theme: ui.theme }).catch(() => {})
    notify()                           /* Settings shows the choice */
    drawOrnament()                     /* the ornament layer is drawn in the theme's teal */
}
export function followSystem() { if (ui.theme === "system") setTheme("system", { persist: false }) }

/* ═════════ background: Med or CS art, independent of light/dark ═════════ */
export function setBg(choice: string, { persist = true }: { persist?: boolean } = {}) {
    ui.bg = choice === "cs" ? "cs" : "med"
    document.documentElement.setAttribute("data-bg", ui.bg)
    rememberUi()
    if (persist && data.profile && data.profile.bg !== ui.bg) store.saveProfile({ bg: ui.bg }).catch(() => {})
    notify()                           /* the sidebar, stats and type lists change with it */
    drawOrnament()
}
