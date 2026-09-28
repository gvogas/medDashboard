// The Study page, in #views: the tiles across the top, then two columns. Left, the timer
// and the leaderboard; right, the History card and achievements. Under 900px, one column:
// tiles, timer, History, achievements, leaderboard. The timer is two cards: Ready and
// Your flow (timer-cards.tsx).

import { StudyTiles } from "./tiles"
import { TimerCards } from "./timer-cards"
import { HistoryCard } from "./history"
import { AchievementsCard } from "./achievements"
import { LeaderboardCard } from "./leaderboard"

export function StudyView() {
    return (
        <div className="grid gap-[13px] pb-1.5">
            <StudyTiles />
            {/* each column's cards join the page's one column when narrow, in their own order */}
            <div className="grid items-start gap-[13px] [grid-template-columns:minmax(0,1fr)_minmax(0,1.3fr)] max-[900px]:[grid-template-columns:minmax(0,1fr)]">
                <div className="flex min-w-0 flex-col gap-[13px] max-[900px]:contents">
                    <TimerCards className="max-[900px]:order-1" />
                    <LeaderboardCard className="max-[900px]:order-4" />
                </div>
                <div className="flex min-w-0 flex-col gap-[13px] max-[900px]:contents">
                    <HistoryCard className="max-[900px]:order-2" />
                    <AchievementsCard className="max-[900px]:order-3" />
                </div>
            </div>
        </div>
    )
}

