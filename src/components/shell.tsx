// <App>'s containers whose attributes are state: shown or hidden, open, inert. What they
// hold is passed in, so the tests can draw one with only what they need. The ids and
// class names are styles/shell.css's and the tests'.

import type { MouseEvent, ReactNode } from "react"
import { useScreen } from "@/data/signin"
import { setSide, sideOpen, useSide } from "@/data/sidebar"
import { getSheet, requestCloseSheet, useCovered, useSheet } from "@/data/overlay"
import { useUi } from "@/data/ui"
import { pageFeature, useMaintenance } from "@/data/maintenance"
import type { Ui } from "@/data/types"

const PAGES = ["week", "month", "table", "study", "spotify", "buddy", "admin"]

/** The page shown, or null on the focus screen. #views is hidden without one. */
export const shownView = (u: Ui) => (u.focus ? null : PAGES.includes(u.view) ? u.view : null)

/** The tiles show above the week, month and table, off the focus screen. */
export const statsShown = (u: Ui) => !u.focus && u.view !== "spotify" && u.view !== "study" && u.view !== "buddy" && u.view !== "admin"

/** Shown until boot has opened an account, and after a session ends. */
export function SignInScreen({ children }: { children?: ReactNode }) {
    const screen = useScreen()
    return <div className="signin" id="signin" hidden={screen !== "signin"}>{children}</div>
}

/** The app, shown once signed in; inert while the sheet or an overlay is up. */
export function Page({ children }: { children?: ReactNode }) {
    const screen = useScreen()
    const sheet = useSheet(), covered = useCovered()
    return (
        <div className="app" id="app" hidden={screen !== "app"} inert={covered || sheet !== null}>
            {children}
        </div>
    )
}

/** The stat tiles; hidden with them, so the gap goes too, and over a page in maintenance. */
export function StatsHost({ children }: { children?: ReactNode }) {
    const shown = useUi(statsShown)
    const blocked = useMaintenance(pageFeature(useUi(shownView))) === "blocked"
    return <div id="stats" hidden={!shown || blocked}>{children}</div>
}

/** The week, month, table, Study, Music or Admin page. The table and the Music page scroll their own rows. */
export function ViewsHost({ children }: { children?: ReactNode }) {
    const view = useUi(shownView)
    return (
        <div id="views" hidden={view === null} className={view === "table" || view === "spotify" ? "own-scroll" : undefined}>
            {children}
        </div>
    )
}

/** The blurred scrim: the sheet's while it is open, else the phone sidebar's. A click
    closes whichever it belongs to. */
export function Scrim() {
    const sheet = useSheet(), side = useSide()
    const on = sheet !== null || (side.open && side.narrow)
    const click = (e: MouseEvent) => {
        if (getSheet()) {
            /* the sheet's alone: the page's click-outside handler would close the sidebar too */
            e.nativeEvent.stopImmediatePropagation()
            requestCloseSheet()
        } else if (sideOpen()) setSide(false)
    }
    return <div className={on ? "scrim on" : "scrim"} id="scrim" onClick={click} />
}

/** The sheet's host: inert while closed or under an overlay. */
export function SheetHost({ children }: { children?: ReactNode }) {
    const sheet = useSheet(), covered = useCovered()
    return <div id="sheet" inert={covered || sheet === null}>{children}</div>
}
