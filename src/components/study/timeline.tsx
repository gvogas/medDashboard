// The Timer tab's Study timeline card: the next two weeks of study days across every open,
// upcoming exam (core/study-timeline.ts), one row per day, each exam's topics under its name.

import { useMemo } from "react"
import { Panel } from "@/components/views/bits"
import { shortDate, today } from "@/core/dates"
import { studyTimeline, TIMELINE_DAYS } from "@/core/study-timeline"
import { normalizePrefs } from "@/core/model"
import { useItems, useProfile } from "@/data/store"

export function TimelineCard() {
    const items = useItems()
    const profile = useProfile()
    const now = today()
    const rest = normalizePrefs(profile?.studyPrefs).rest
    const entries = useMemo(() => studyTimeline(items, now, rest), [items, now, rest])
    const days = useMemo(() => {
        const byDate = new Map<string, typeof entries>()
        for (const e of entries) byDate.set(e.date, [...(byDate.get(e.date) || []), e])
        return [...byDate.entries()]
    }, [entries])

    return (
        <Panel label="Study timeline" title="Study timeline" head={<span className="text-[12.5px] text-ink-2">Next {TIMELINE_DAYS} days</span>}>
            <div className="flex flex-col px-5 pt-1 pb-3">
                {days.length ? (
                    <ol aria-label="Study days" className="m-0 flex list-none flex-col p-0">
                        {days.map(([date, list]) => (
                            <li key={date} className="grid grid-cols-[84px_minmax(0,1fr)] gap-2.5 border-t border-line-2 py-2 text-[13px] first:border-t-0">
                                <span className="font-mono text-[12px] text-muted-foreground">{shortDate(date)}</span>
                                <ul className="m-0 flex min-w-0 list-none flex-col gap-1.5 p-0">
                                    {list.map((e) => (
                                        <li key={e.examId} className="min-w-0">
                                            <span className="font-medium text-foreground">{e.exam}</span>
                                            <span className="text-ink-2">: {e.topics.join(", ")}</span>
                                        </li>
                                    ))}
                                </ul>
                            </li>
                        ))}
                    </ol>
                ) : (
                    <p className="m-0 py-2.5 text-[13px] text-ink-2">No study days in the next {TIMELINE_DAYS} days. Open exams with unfinished topics show here.</p>
                )}
            </div>
        </Panel>
    )
}
