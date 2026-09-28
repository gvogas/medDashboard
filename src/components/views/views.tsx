// The week, month, table or Spotify page, in index.html's #views. Study and the focus
// screen are still drawn by the legacy code into #viewRoot beside it; each container has
// one owner, and the one not in use is hidden.

import { useEffect } from "react"
import { useUi } from "@/data/ui"
import { SpotifyPage } from "@/components/spotify/spotify-page"
import { WeekView } from "./week"
import { MonthView } from "./month"
import { TableView } from "./table"

const OURS = ["week", "month", "table", "spotify"]

export function Views() {
    const view = useUi((u) => (u.focus ? null : OURS.includes(u.view) ? u.view : null))

    /* the table and the Spotify page scroll their own rows, as #viewRoot's own-scroll did */
    useEffect(() => {
        const host = document.getElementById("views")
        if (!host) return
        host.hidden = view === null
        host.classList.toggle("own-scroll", view === "table" || view === "spotify")
    }, [view])

    if (view === "week") return <WeekView />
    if (view === "month") return <MonthView />
    if (view === "table") return <TableView />
    if (view === "spotify") return <SpotifyPage />
    return null
}
