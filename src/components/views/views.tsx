// The week, month, table, Study, Music or Admin page, in <App>'s #views. On the focus
// screen (components/focus/, in #focus) nothing shows here. Each page loads on first
// use (lib/lazy.ts): the saved one at once, the others when the browser is idle.
// A page the admins have switched off shows the maintenance page instead, however it was
// reached (the sidebar, a number key, the page saved from last time); an admin keeps the
// page, under a bar (components/maintenance.tsx).

import { Suspense } from "react"
import { ui, useUi } from "@/data/ui"
import { shownView } from "@/components/shell"
import { lazyNamed } from "@/lib/lazy"
import { pageFeature, useMaintenance } from "@/data/maintenance"
import { MaintenanceBar, MaintenancePage } from "@/components/maintenance"

const WeekView = lazyNamed(() => import("./week"), "WeekView")
const MonthView = lazyNamed(() => import("./month"), "MonthView")
const TableView = lazyNamed(() => import("./table"), "TableView")
const StudyView = lazyNamed(() => import("@/components/study/study-view"), "StudyView")
const SpotifyPage = lazyNamed(() => import("@/components/spotify/spotify-page"), "SpotifyPage")
/* admins only, so not fetched for everyone when the browser is idle */
const AdminPage = lazyNamed(() => import("@/components/admin/admin-page"), "AdminPage", { idle: false })

const PAGES = { week: WeekView, month: MonthView, table: TableView, study: StudyView, spotify: SpotifyPage, admin: AdminPage }
PAGES[ui.view]?.preload().catch(() => {})

export function Views() {
    const view = useUi(shownView)
    const maintenance = useMaintenance(pageFeature(view))
    const Page = view && PAGES[view]
    if (maintenance === "blocked") return <MaintenancePage feature={pageFeature(view)!} />
    const page = Page ? <Suspense fallback={null}><Page /></Suspense> : null
    return maintenance === "admin" ? <><MaintenanceBar />{page}</> : page
}
