// The Study page, in #views: the three tiles, then six tabs. Timer is the Ready card large
// beside Your flow and Today (timer-cards.tsx); Cards is flashcards (cards.tsx); History and Achievements fill the width;
// the Leaderboard is a centred column; Friends is the friends list, Add friends and the two
// switches. Only the open tab is drawn, so the leaderboard loads when its tab opens. The tab is
// ui.studyTab, remembered on this browser; the arrow keys, Home and End move between tabs
// (radio-keys.ts).

import { useEffect } from "react"
import { cn } from "@/lib/utils"
import { useUi } from "@/data/ui"
import { setStudyTab } from "@/data/study"
import { STALE_MS, friendsStale, loadFriends, useFriends } from "@/data/friends"
import { maintenanceState, useMaintenance } from "@/data/maintenance"
import { useScreen } from "@/data/signin"
import { tabKeys } from "@/components/sheet/radio-keys"
import type { StudyTab } from "@/data/types"
import { StudyTiles } from "./tiles"
import { TimerCards } from "./timer-cards"
import { HistoryCard } from "./history"
import { RecapCard } from "./recap"
import { AchievementsCard } from "./achievements"
import { LeaderboardCard } from "./leaderboard"
import { FriendsCard } from "./friends"
import { CardsCard } from "./cards"
import { dueToday, useFlashcards } from "@/data/cards"

const TABS: readonly [StudyTab, string][] = [["timer", "Timer"], ["cards", "Cards"], ["history", "History"], ["achievements", "Achievements"], ["leaderboard", "Leaderboard"], ["friends", "Friends"]]

export function StudyView() {
    const open = useUi((u) => u.studyTab)
    const screen = useScreen()
    const list = useFriends().list
    const blocked = useMaintenance("friends") === "blocked"
    const waiting = blocked ? 0 : list?.incoming.length ?? 0
    const fresh = !blocked && !!list && list.friends.length === 0 && list.incoming.length === 0
    const due = dueToday(useFlashcards())
    /* loaded when the page shows, so the tab's count is there before the tab opens */
    useEffect(() => {
        if (screen !== "app") return
        const reload = () => { if (!document.hidden && maintenanceState("friends") !== "blocked" && friendsStale()) void loadFriends() }
        reload()
        /* nothing is pushed: ask again each minute while the page is open and seen. The list is
           a little under a minute old at a tick a minute after the last load, so tick twice as often */
        const timer = setInterval(reload, STALE_MS / 2)
        document.addEventListener("visibilitychange", reload)
        return () => { clearInterval(timer); document.removeEventListener("visibilitychange", reload) }
    }, [screen])
    return (
        <div className="grid gap-4 pb-1.5">
            <StudyTiles />
            <div role="tablist" aria-label="Study" onKeyDown={tabKeys}
                className="flex gap-1 overflow-x-auto border-b border-border [scrollbar-width:none]">
                {TABS.map(([id, label]) => (
                    <button
                        key={id}
                        type="button"
                        role="tab"
                        id={"study-tab-" + id}
                        aria-selected={open === id}
                        aria-controls={open === id ? "study-panel" : undefined}
                        tabIndex={open === id ? 0 : -1}
                        onClick={() => setStudyTab(id)}
                        className={cn(
                            "h-[42px] flex-none cursor-pointer border-0 bg-transparent px-3.5 font-[inherit] outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--accent)] text-[13.5px] max-[520px]:px-2.5",
                            open === id ? "font-semibold text-foreground shadow-[inset_0_-2px_0_var(--primary)] focus-visible:shadow-[inset_0_0_0_2px_var(--accent),inset_0_-2px_0_var(--primary)]" : "font-medium text-muted-foreground hover:text-foreground",
                        )}
                    >
                        {label}
                        {id === "cards" && due > 0 && (
                            <><span aria-hidden="true" className="ml-1.5 rounded-full bg-[var(--study)] px-1.5 text-[10.5px] leading-4 font-semibold text-primary-foreground">{due}</span><span className="sr-only">, {due} due</span></>
                        )}
                        {id === "friends" && waiting > 0 && (
                            <><span aria-hidden="true" className="ml-1.5 rounded-full bg-primary px-1.5 text-[10.5px] leading-4 font-semibold text-primary-foreground">{waiting}</span><span className="sr-only">, {waiting} waiting</span></>
                        )}
                        {id === "friends" && fresh && (
                            <><span aria-hidden="true" className="ml-1.5 rounded-full bg-muted px-1.5 text-[10.5px] leading-4 font-semibold text-muted-foreground">New</span><span className="sr-only">, new</span></>
                        )}
                    </button>
                ))}
            </div>
            <div role="tabpanel" id="study-panel" aria-labelledby={"study-tab-" + open} tabIndex={0} className="min-w-0 rounded-[var(--radius)] outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--accent)]">
                {open === "timer" && <TimerCards />}
                {open === "cards" && <CardsCard />}
                {open === "history" && <><HistoryCard /><RecapCard /></>}
                {open === "achievements" && <AchievementsCard />}
                {open === "leaderboard" && <LeaderboardCard className="mx-auto w-full max-w-[760px]" />}
                {open === "friends" && <FriendsCard />}
            </div>
        </div>
    )
}
