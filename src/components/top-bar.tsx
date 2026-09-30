// The top bar: the sidebar button on narrow screens, the date line over the view's title
// in the serif, ‹ Today › in the week and month views, search and New item. Sync and
// Settings are in the sidebar's foot.
// It renders inside <App>'s <header class="bar">, which styles/shell.css lays out
// (and hides it on the focus screen).

import { useState, type ReactNode } from "react"
import { cn } from "@/lib/utils"
import { TextureButton } from "@/components/ui/texture-button"
import { viewHeading } from "@/components/view-heading"
import { ui, useUi } from "@/data/ui"
import { useSide } from "@/data/sidebar"
import { useSyncStatus } from "@/data/sync"
import { DOT, syncTrouble } from "@/components/sync-status"
import { goToday, newItem, setSearch, showSidebar, step } from "@/data/actions"

const icon = (children: ReactNode, box = "0 0 16 16") => (
    <svg viewBox={box} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="size-4">
        {children}
    </svg>
)

export function TopBar() {
    const heading = useUi(viewHeading)
    const dated = useUi((ui) => ui.view === "week" || ui.view === "month")
    const open = useSide().open
    const sync = useSyncStatus().state

    return (
        <>
            <button
                type="button"
                id="menuBtn"
                aria-label="Show sidebar"
                aria-controls="side"
                aria-expanded={open}
                onClick={() => showSidebar(!open)}
                className="relative hidden size-9 shrink-0 cursor-pointer place-items-center rounded-lg border border-border bg-card text-foreground max-[900px]:grid"
            >
                {icon(<path d="M2.5 4h11M2.5 8h11M2.5 12h11" />)}
                {/* the sync state is in the sidebar, out of sight here: a dot when it needs you */}
                {syncTrouble(sync) && <i aria-hidden="true" data-sync-dot={sync} className={cn("absolute top-1 right-1 size-2 rounded-full ring-2 ring-card", DOT[sync])} />}
            </button>

            <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="truncate text-[13px] text-muted-foreground">{heading.sub || <>&nbsp;</>}</span>
                <h1 className="m-0 truncate font-serif text-[34px] leading-[1.1] font-medium tracking-[-.015em] text-foreground">{heading.title}</h1>
            </div>

            {dated && (
                <div className="flex items-center gap-1">
                    <TextureButton variant="minimal" size="sm" aria-label="Previous" onClick={() => step(-1)}>
                        {icon(<path d="M10 3 5 8l5 5" />)}
                    </TextureButton>
                    <TextureButton variant="minimal" size="sm" onClick={goToday}>Today</TextureButton>
                    <TextureButton variant="minimal" size="sm" aria-label="Next" onClick={() => step(1)}>
                        {icon(<path d="m6 3 5 5-5 5" />)}
                    </TextureButton>
                </div>
            )}

            <Search />
            {/* Under 700px it floats, round, at the bottom right. */}
            <TextureButton
                variant="accent"
                onClick={newItem}
                className={cn(
                    "font-semibold",
                    "max-[700px]:fixed max-[700px]:right-4 max-[700px]:bottom-[calc(16px+env(safe-area-inset-bottom))] max-[700px]:z-30",
                    "max-[700px]:rounded-full max-[700px]:shadow-[var(--shadow-2)] max-[700px]:h-auto max-[700px]:px-5 max-[700px]:py-3",
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
