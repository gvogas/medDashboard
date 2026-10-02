// The whole page, in the order the stacking and the inert rules rely on: the sign-in
// screen or the app (the sidebar; the content with the top bar and the page; the study
// dock and the focus screen), then the scrim, the sheet, the overlays and the toaster.
// What is shown, open or inert comes from src/data/ (signin.ts, sidebar.ts, overlay.ts,
// the ui). The ids and class names are styles/shell.css's and the tests'.

import { useLayoutEffect } from "react"
import { focusAfterSide, useSide } from "@/data/sidebar"
import { Page, Scrim, SheetHost, SignInScreen, StatsHost, ViewsHost } from "./shell"
import { TopBar } from "@/components/top-bar"
import { Sidebar } from "@/components/sidebar"
import { SignIn } from "@/components/sign-in"
import { Toaster } from "@/components/toaster"
import { SyncAnnouncer } from "@/components/sync-status"
import { Stats } from "@/components/views/stats"
import { Views } from "@/components/views/views"
import { Sheet } from "@/components/sheet/sheet"
import { Overlays } from "@/components/overlays"
import { StudyDock } from "@/components/study/study-dock"
import { Focus } from "@/components/focus/focus-screen"
import { AnnouncementBanner } from "@/components/admin/announcement-banner"

export function App() {
    return (
        <>
            <SignInScreen><SignIn /></SignInScreen>
            <Page>
                <Side />
                <Content />
                {/* during a run: the corner dock off the focus screen, and the focus screen */}
                <div id="study-dock"><StudyDock /></div>
                <div id="focus"><Focus /></div>
            </Page>
            <Scrim />
            <SheetHost><Sheet /></SheetHost>
            {/* the shortcuts panel and the busy card: over everything, outside #app and #sheet */}
            <div id="overlays"><Overlays /></div>
            {/* outside #app, so the sheet that makes #app inert leaves the toast's buttons usable;
                the sync state's live region too, so it is heard while the sidebar is inert */}
            <div id="toaster"><Toaster /><SyncAnnouncer /></div>
        </>
    )
}

/** The sidebar: on a phone it slides over the page, and is inert while closed. */
function Side() {
    const side = useSide()
    useLayoutEffect(() => { focusAfterSide(side) }, [side])
    return (
        <aside className={side.open ? "side on" : "side"} id="side" inert={side.narrow && !side.open}>
            <Sidebar />
        </aside>
    )
}

function Content() {
    const side = useSide()
    return (
        <div className="content" inert={side.narrow && side.open}>
            <header className="bar"><TopBar /></header>
            <div className="scroll" id="scroll">
                <AnnouncementBanner />
                <StatsHost><Stats /></StatsHost>
                <ViewsHost><Views /></ViewsHost>
            </div>
        </div>
    )
}
