// The week, month, table, Study or Spotify page, in <App>'s #views. On the focus
// screen (components/focus/, in #focus) nothing shows here.

import { useUi } from "@/data/ui"
import { shownView } from "@/components/shell"
import { SpotifyPage } from "@/components/spotify/spotify-page"
import { WeekView } from "./week"
import { MonthView } from "./month"
import { TableView } from "./table"
import { StudyView } from "@/components/study/study-view"

export function Views() {
    const view = useUi(shownView)

    if (view === "week") return <WeekView />
    if (view === "month") return <MonthView />
    if (view === "table") return <TableView />
    if (view === "study") return <StudyView />
    if (view === "spotify") return <SpotifyPage />
    return null
}
