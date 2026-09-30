// The bottom of the sidebar: your quote (a click turns to the next), then your name, the
// sync state and Settings. The quote was a tile above the week; the name, sync and
// Settings were in the top bar.

import { useEffect, useRef } from "react"
import { useProfile } from "@/data/store"
import { useStats } from "@/data/views"
import { ui, useUi } from "@/data/ui"
import { THEMES } from "@/data/themes"
import { nextQuote, toggleSettings } from "@/data/actions"
import { SyncStatus } from "@/components/sync-status"

/** How often the quote turns by itself, unless it is being read, the focus screen is up
    or motion is reduced. */
export const QUOTE_EVERY_MS = 25_000

const gear = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
)

export function SideFoot() {
    const profile = useProfile()
    const { quote, quoteCount } = useStats()
    const bg = useUi((u) => u.bg)
    const q = quote ? quote.quote : THEMES[bg].quote
    const box = useRef<HTMLDivElement>(null)

    /* the quote turns by itself while nobody is reading it */
    useEffect(() => {
        const id = setInterval(() => {
            if (document.visibilityState !== "visible" || ui.focus) return
            if (box.current?.matches(":hover, :focus-within") || box.current?.closest("[inert]")) return
            if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return
            nextQuote()
        }, QUOTE_EVERY_MS)
        return () => clearInterval(id)
    }, [])

    return (
        <div className="flex flex-col gap-3">
            <div ref={box} className="border-t border-border px-2.5 pt-3.5">
                {/* with fewer than two quotes, nextQuote opens Settings at the quote field */}
                <button
                    type="button"
                    onClick={(e) => nextQuote(e.currentTarget)}
                    title={quoteCount > 1 ? "Next quote" : "Add your own quotes in Settings"}
                    className="flex w-full cursor-pointer flex-col gap-1.5 border-0 bg-transparent p-0 text-left font-[inherit]"
                >
                    <span className="line-clamp-4 font-serif text-[14.5px] leading-[1.45] text-[color:color-mix(in_srgb,var(--ink)_85%,transparent)] italic">“{q.text}”</span>
                    <span className="text-[12px] text-muted-foreground">{q.source || "Unattributed"}</span>
                </button>
            </div>
            <div className="flex items-center gap-2.5 border-t border-border pt-3 pl-2.5">
                <div className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
                    <span className="truncate font-medium text-foreground">{profile?.displayName || profile?.username || ""}</span>
                    <SyncStatus className="border-0 bg-transparent px-0 py-0 text-[12px]" />
                </div>
                <button type="button" aria-label="Settings" title="Settings" onClick={toggleSettings}
                    className="grid size-9 cursor-pointer place-items-center rounded-[6px] border-0 bg-transparent text-ink-2 hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] hover:text-foreground">
                    {gear}
                </button>
            </div>
        </div>
    )
}
