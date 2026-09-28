// The week, month, table, Study or Spotify page, in <App>'s #views. On the focus
// screen (components/focus/, in #focus) nothing shows here. Each page loads on first
// use (lib/lazy.ts): the saved one at once, the others when the browser is idle.

import { Suspense } from "react"
import { ui, useUi } from "@/data/ui"
import { shownView } from "@/components/shell"
import { lazyNamed } from "@/lib/lazy"

const WeekView = lazyNamed(() => import("./week"), "WeekView")
const MonthView = lazyNamed(() => import("./month"), "MonthView")
const TableView = lazyNamed(() => import("./table"), "TableView")
const StudyView = lazyNamed(() => import("@/components/study/study-view"), "StudyView")
const SpotifyPage = lazyNamed(() => import("@/components/spotify/spotify-page"), "SpotifyPage")

const PAGES = { week: WeekView, month: MonthView, table: TableView, study: StudyView, spotify: SpotifyPage }
PAGES[ui.view]?.preload().catch(() => {})

export function Views() {
    const view = useUi(shownView)
    const Page = view && PAGES[view]
    return Page ? <Suspense fallback={null}><Page /></Suspense> : null
}
