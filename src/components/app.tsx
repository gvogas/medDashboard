// The whole page, in the order the stacking and the inert rules rely on: the sign-in
// screen or the app (the sidebar; the content with the ornament, the top bar and the
// page; the study dock and the focus screen), then the scrim, the sheet, the overlays and
// the toaster. What is shown, open or inert comes from src/data/ (signin.ts, sidebar.ts,
// overlay.ts, the ui). The ids and class names are styles/shell.css's and the tests'.

import { useLayoutEffect } from "react"
import { focusAfterSide, useSide } from "@/data/sidebar"
import { Page, Scrim, SheetHost, SignInScreen, StatsHost, ViewsHost } from "./shell"
import { Ornament } from "@/components/ornament"
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
            <Ornament />
            <header className="bar"><TopBar /></header>
            <div className="scroll" id="scroll">
                <Drape />
                <StatsHost><Stats /></StatsHost>
                <ViewsHost><Views /></ViewsHost>
            </div>
        </div>
    )
}

/* the stethoscope drawn over the top of the page */
const Drape = () => (
    <svg className="drape" viewBox="0 0 300 118" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
        <path d="M18 8c0 26 6 30 14 40" /><path d="M52 8c0 24-5 28-11 38" />
        <path d="M8 10h20M42 10h20" strokeWidth="5" />
        <path d="M32 48c7 10 3 24 16 32 16 10 40 6 58-2 22-10 38-24 60-28 20-4 36 2 44 14" />
        <circle cx="242" cy="86" r="17" /><circle cx="242" cy="86" r="8.5" /><path d="M228 74l-8-7" />
    </svg>
)
