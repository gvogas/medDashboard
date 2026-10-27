// Settings in the sheet, in four tabs: You (theme, where you're headed, name, look, quotes), Study
// (the goal and streak, reviews, the school calendar), Connections (the calendar feed, reminders, Spotify)
// and Account (data, saved copies, signing out). Files come in through Import with AI, not here.
// Everything saves as it changes.

import { useEffect } from "react"
import { cn } from "@/lib/utils"
import { useConflicts, useProfile } from "@/data/store"
import { useSyncStatus } from "@/data/sync"
import { ui } from "@/data/ui"
import { closeSheet } from "@/data/overlay"
import { TABS, type SettingsTab } from "@/data/settings"
import { setSettingsTab, showShortcuts } from "@/data/actions"
import { Button, SheetBody, SheetFoot, SheetHead } from "./fields"
import { useFlushOnClose } from "./gate"
import { YouTab } from "./settings-you"
import { StudyTab } from "./settings-study"
import { ConnectionsTab } from "./settings-connections"
import { AccountTab } from "./settings-account"

export function SettingsSheet({ tab, focus }: { tab: SettingsTab; focus: string | null }) {
    const profile = useProfile()
    const conflicts = useConflicts()
    const sync = useSyncStatus()

    /* what was said and asked goes when Settings closes */
    useFlushOnClose(() => {
        ui.schoolNote = null; ui.spotifyNote = null
        ui.signoutAsk = null; ui.schoolAsk = false
        if (ui.feed) ui.feed.confirm = null
    })

    /* a deep link: the field or group, focused and in view */
    useEffect(() => {
        if (!focus) return
        requestAnimationFrame(() => {
            const el = document.getElementById(focus)
            el?.focus({ preventScroll: true })
            el?.scrollIntoView?.({ block: "nearest" })
        })
    }, [focus, tab])

    if (!profile) return null
    const flag = conflicts.length
        ? <i className="min-w-[15px] rounded-lg bg-destructive px-1 text-[10px] leading-[15px] text-[var(--on-crit)] not-italic">{conflicts.length}</i>
        : sync.state === "error" ? <i aria-label="sync problem" className="size-1.5 rounded-full bg-destructive" /> : null

    return (
        <>
            <SheetHead kind="Settings" onClose={closeSheet}>
                <span className="text-[11px] text-muted-foreground">saved as you type</span>
            </SheetHead>
            <div role="group" aria-label="Settings sections" className="mx-4 mt-2.5 flex gap-0.5 rounded-[10px] bg-muted p-0.5">
                {TABS.map(([id, label]) => (
                    <button key={id} type="button" aria-pressed={tab === id} onClick={() => setSettingsTab(id)}
                        className={cn(
                            "inline-flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border-0 bg-transparent px-1.5 py-[5px] font-[inherit] text-[12px] font-semibold text-ink-2 hover:text-foreground",
                            tab === id && "bg-card text-accent-foreground shadow-[0_1px_2px_rgba(0,0,0,.1),inset_0_1px_0_var(--rim-hi)]",
                        )}>
                        {label}{id === "account" && flag}
                    </button>
                ))}
            </div>
            <SheetBody>
                {tab === "you" && <YouTab profile={profile} />}
                {tab === "study" && <StudyTab profile={profile} />}
                {tab === "connections" && <ConnectionsTab />}
                {tab === "account" && <AccountTab profile={profile} />}
            </SheetBody>
            <SheetFoot hint="Term">
                <Button variant="ghost" className="[@media(hover:none)]:hidden" onClick={showShortcuts}>
                    Keyboard shortcuts <kbd className="ml-1 rounded border border-border px-1.5 font-mono text-[11px]">?</kbd>
                </Button>
                <Button onClick={closeSheet}>Done</Button>
            </SheetFoot>
        </>
    )
}
