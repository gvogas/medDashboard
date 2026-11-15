// <App>'s #focus: the focus screen while a run goes and ui.focus is on. The screen itself
// (the clock, the music browser, the room panel) loads on first use, so the first page
// parses none of it; lazyNamed fetches it when the browser is idle after the app shows.

import { Suspense, useEffect, useLayoutEffect } from "react"
import { lazyNamed } from "@/lib/lazy"
import { useUi } from "@/data/ui"
import { leaveFocus, useRun } from "@/data/study-timer"

const FocusScreen = lazyNamed(() => import("./focus-screen"), "FocusScreen")

export function Focus() {
    const run = useRun()
    const on = useUi((u) => u.focus)
    const showing = on && run !== null

    useLayoutEffect(() => {
        document.documentElement.classList.toggle("focusing", showing)
        return () => { document.documentElement.classList.remove("focusing") }
    }, [showing])

    /* The screen belongs to a run: one that ended unseen (another tab logged it) leaves it. */
    useEffect(() => { if (on && run === null) leaveFocus() }, [on, run])

    return showing ? <Suspense fallback={null}><FocusScreen run={run} /></Suspense> : null
}
