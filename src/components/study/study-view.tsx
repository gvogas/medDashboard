// The Study page, in #views: the three tiles, then five tabs. Timer is the Ready card large
// beside Your flow and Today (timer-cards.tsx); History and Achievements fill the width;
// the Leaderboard is a centred column; Friends is the friends list, Add friends and the two switches. Only the open tab is drawn, so the leaderboard
// loads when its tab opens. The tab is ui.studyTab, remembered on this browser; the arrow
// keys, Home and End move between tabs (radio-keys.ts).

import { useEffect } from "react"
import { cn } from "@/lib/utils"
import { useUi } from "@/data/ui"
import { setStudyTab } from "@/data/study"
import { friendsStale, loadFriends, useFriends } from "@/data/friends"
import { maintenanceState } from "@/data/maintenance"
import { useScreen } from "@/data/signin"
import { tabKeys } from "@/components/sheet/radio-keys"
import type { StudyTab } from "@/data/types"
import { StudyTiles } from "./tiles"
import { TimerCards } from "./timer-cards"
import { HistoryCard } from "./history"
import { AchievementsCard } from "./achievements"
import { LeaderboardCard } from "./leaderboard"
import { FriendsCard } from "./friends"

const TABS: readonly [StudyTab, string][] = [["timer", "Timer"], ["history", "History"], ["achievements", "Achievements"], ["leaderboard", "Leaderboard"], ["friends", "Friends"]]

export function StudyView() {
    const open = useUi((u) => u.studyTab)
    const screen = useScreen()
    const waiting = useFriends().list?.incoming.length ?? 0
    /* loaded when the page shows, so the tab's count is there before the tab opens */
    useEffect(() => { if (screen === "app" && maintenanceState("friends") !== "blocked" && friendsStale()) void loadFriends() }, [screen])
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
                        {id === "friends" && waiting > 0 && <span className="ml-1.5 rounded-full bg-primary px-1.5 text-[10.5px] leading-4 font-semibold text-primary-foreground" aria-label={waiting + " waiting"}>{waiting}</span>}
                    </button>
                ))}
            </div>
            <div role="tabpanel" id="study-panel" aria-labelledby={"study-tab-" + open} tabIndex={0} className="min-w-0 rounded-[var(--radius)] outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--accent)]">
                {open === "timer" && <TimerCards />}
                {open === "history" && <HistoryCard />}
                {open === "achievements" && <AchievementsCard />}
                {open === "leaderboard" && <LeaderboardCard className="mx-auto w-full max-w-[760px]" />}
                {open === "friends" && <FriendsCard />}
            </div>
        </div>
    )
}
