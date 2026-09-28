// The week, month or table, in index.html's #views. Spotify, Study and the focus screen
// are still drawn by the legacy code into #viewRoot beside it; each container has one
// owner, and the one not in use is hidden.

import { useEffect } from "react"
import { useUi } from "@/data/ui"
import { WeekView } from "./week"
import { MonthView } from "./month"
import { TableView } from "./table"

export function Views() {
    const view = useUi((u) => (u.focus ? null : u.view === "week" || u.view === "month" || u.view === "table" ? u.view : null))

    /* the table scrolls its own rows, as #viewRoot's own-scroll did */
    useEffect(() => {
        const host = document.getElementById("views")
        if (!host) return
        host.hidden = view === null
        host.classList.toggle("own-scroll", view === "table")
    }, [view])

    if (view === "week") return <WeekView />
    if (view === "month") return <MonthView />
    if (view === "table") return <TableView />
    return null
}
