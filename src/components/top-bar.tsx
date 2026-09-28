// The top bar: the sidebar button on narrow screens, the view's title, ‹ Today › in the
// week and month views, the view dock, search, sync status, Settings and New item.
// It renders inside <App>'s <header class="bar">, whose legacy CSS lays it out
// (and hides it on the focus screen).

import { useState, type ReactNode } from "react"
import { cn } from "@/lib/utils"
import { TextureButton } from "@/components/ui/texture-button"
import { ViewDock } from "@/components/view-dock"
import { viewHeading } from "@/components/view-heading"
import { ui, useUi } from "@/data/ui"
import { useSide } from "@/data/sidebar"
import { syncLabel, useSyncAnnouncement, useSyncStatus } from "@/data/sync"
import { goToday, newItem, setSearch, showSidebar, step, syncNow, toggleSettings } from "@/data/actions"
import type { SyncState } from "@/data/types"

const icon = (children: ReactNode, box = "0 0 16 16") => (
    <svg viewBox={box} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="size-4">
        {children}
    </svg>
)

const DOT: Record<SyncState, string> = {
    idle: "bg-[var(--good)]",
    pending: "bg-[var(--warn)]",
    syncing: "bg-[var(--warn)]",
    offline: "bg-muted-foreground",
    error: "bg-destructive",
    "signed-out": "bg-destructive",
}

export function TopBar() {
    const heading = useUi(viewHeading)
    const dated = useUi((ui) => ui.view === "week" || ui.view === "month")
    const open = useSide().open

    return (
        <>
            <button
                type="button"
                id="menuBtn"
                aria-label="Show sidebar"
                aria-controls="side"
                aria-expanded={open}
                onClick={() => showSidebar(!open)}
                className="hidden size-9 shrink-0 cursor-pointer place-items-center rounded-lg border border-border bg-card text-foreground max-[900px]:grid"
            >
                {icon(<path d="M2.5 4h11M2.5 8h11M2.5 12h11" />)}
            </button>

            <div className="min-w-0">
                <h1 className="m-0 whitespace-nowrap text-lg font-extrabold tracking-tight text-foreground">{heading.title}</h1>
                {heading.sub && <div className="truncate text-[11.5px] text-muted-foreground">{heading.sub}</div>}
            </div>

            {dated && (
                <div className="flex items-center gap-1">
                    <TextureButton variant="minimal" size="sm" className="w-auto" aria-label="Previous" onClick={() => step(-1)}>
                        {icon(<path d="M10 3 5 8l5 5" />)}
                    </TextureButton>
                    <TextureButton variant="minimal" size="sm" className="w-auto" onClick={goToday}>Today</TextureButton>
                    <TextureButton variant="minimal" size="sm" className="w-auto" aria-label="Next" onClick={() => step(1)}>
                        {icon(<path d="m6 3 5 5-5 5" />)}
                    </TextureButton>
                </div>
            )}

            <div><ViewDock /></div>
            <div className="flex-[1_1_20px]" />

            <Search />
            <SyncStatus />

            <TextureButton variant="minimal" className="w-auto" aria-label="Settings" title="Settings" onClick={toggleSettings}>
                {icon(
                    <>
                        <circle cx="12" cy="12" r="3" />
                        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
                    </>,
                    "0 0 24 24",
                )}
            </TextureButton>

            {/* Under 700px it floats, round, at the bottom right. */}
            <TextureButton
                variant="accent"
                onClick={newItem}
                className={cn(
                    "w-auto whitespace-nowrap font-semibold",
                    "max-[700px]:fixed max-[700px]:right-4 max-[700px]:bottom-[calc(16px+env(safe-area-inset-bottom))] max-[700px]:z-30",
                    "max-[700px]:rounded-full max-[700px]:shadow-[var(--shadow-2)] max-[700px]:[&>div]:rounded-full max-[700px]:[&>div]:px-5 max-[700px]:[&>div]:py-3",
                )}
            >
                {icon(<path d="M8 3v10M3 8h10" />)}
                New item
            </TextureButton>
        </>
    )
}

function Search() {
    // Kept here: ui.search changes at once, but the views redraw (and notify) only
    // once typing pauses, so reading it back would drop keys.
    const [text, setText] = useState(() => ui.search)
    return (
        <div className="relative min-w-[126px] flex-[0_1_220px] max-[700px]:order-last max-[700px]:basis-full">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground">
                <circle cx="7" cy="7" r="4.5" />
                <path d="M10.5 10.5 14 14" />
            </svg>
            {/* id="search": the / key focuses it (data/keyboard.ts). */}
            <input
                type="search"
                id="search"
                aria-label="Search"
                placeholder="Search everything"
                autoComplete="off"
                value={text}
                onChange={(e) => { setText(e.target.value); setSearch(e.target.value) }}
                className="peer w-full rounded-[10px] border border-border bg-card py-1.5 pl-8 pr-8 text-[12.5px] text-foreground shadow-[inset_0_1px_2px_rgba(0,0,0,.04)] placeholder:text-muted-foreground"
            />
            <kbd aria-hidden="true" className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded-[5px] border border-border bg-muted px-1.5 font-mono text-[10.5px] text-muted-foreground peer-focus:hidden">/</kbd>
        </div>
    )
}

function SyncStatus() {
    const s = useSyncStatus()
    const said = useSyncAnnouncement()
    const title = s.message || (s.state === "offline" ? "Changes are kept on this device until you are back online" : "Sync now")
    return (
        <>
            <button
                type="button"
                title={title}
                onClick={syncNow}
                data-state={s.state}
                className="flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-card px-2.5 py-1 text-[11.5px] text-ink-2 hover:text-foreground max-[700px]:py-1.5"
            >
                <i aria-hidden="true" className={cn("size-[7px] rounded-full", DOT[s.state])} />
                {syncLabel(s)}
            </button>
            <span className="sr-only" role="status">{said}</span>
        </>
    )
}
