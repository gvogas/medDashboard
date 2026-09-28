// The week, month, table, Study or Spotify page, in index.html's #views. On the focus
// screen (components/focus/, in #focus) nothing shows here.

import { useEffect } from "react"
import { useUi } from "@/data/ui"
import { SpotifyPage } from "@/components/spotify/spotify-page"
import { WeekView } from "./week"
import { MonthView } from "./month"
import { TableView } from "./table"
import { StudyView } from "@/components/study/study-view"

const OURS = ["week", "month", "table", "study", "spotify"]

export function Views() {
    const view = useUi((u) => (u.focus ? null : OURS.includes(u.view) ? u.view : null))

    /* the table and the Spotify page scroll their own rows */
    useEffect(() => {
        const host = document.getElementById("views")
        if (!host) return
        host.hidden = view === null
        host.classList.toggle("own-scroll", view === "table" || view === "spotify")
    }, [view])

    if (view === "week") return <WeekView />
    if (view === "month") return <MonthView />
    if (view === "table") return <TableView />
    if (view === "study") return <StudyView />
    if (view === "spotify") return <SpotifyPage />
    return null
}
