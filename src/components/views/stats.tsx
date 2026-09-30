// The four boxes above the week, month and table: the next exam or quiz, open
// assignments, overdue, and today's study against the goal. They are about the whole
// of your work, so the filters leave them alone. (The quote is in the sidebar's foot.)

import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import { tmeta } from "@/core/model"
import { prepLabel } from "@/core/prep"
import { useUi } from "@/data/ui"
import { useStats } from "@/data/views"
import { statsShown } from "@/components/shell"
import { openItem, openStudy } from "@/data/actions"

/** "Cardiology midterm exam"; the type word only when the title doesn't already say it ("Final exam"). */
export const examName = (title: string, type: string) =>
    title.toLowerCase().includes(type.toLowerCase()) ? title : title + " " + type.toLowerCase()

/** "1h 20" or "45 min". */
export const studyTime = (min: number) => (min >= 60 ? Math.floor(min / 60) + "h" + (min % 60 ? " " + String(min % 60).padStart(2, "0") : "") : min + " min")

export function Stats() {
    const shown = useUi(statsShown)
    const s = useStats()

    /* <App> hides #stats with the tiles, so its gap goes too */
    if (!shown) return null

    const exam = s.nextExam, dd = s.daysTo
    const study = s.study, left = Math.max(0, study.goal - study.minutes)
    const when = dd === 0 ? "Today" : dd === 1 ? "Tomorrow" : "In " + dd + " days"

    return (
        <>
            <Box
                label="Next exam or quiz"
                onClick={exam ? () => openItem(exam.id) : undefined}
                title={exam ? "Open " + exam.title : undefined}
                value={<span className="block truncate text-[21px] leading-[1.15]">{exam ? examName(exam.title, tmeta(exam.type).label) : "Nothing scheduled"}</span>}
                foot={exam ? (
                    <>
                        {when}
                        {s.prep && <> · <span className={s.prep.hot ? "text-destructive" : undefined}>{prepLabel(s.prep)}</span></>}
                    </>
                ) : "Enjoy the quiet"}
            />
            <Box label="Open assignments" value={s.openAssignments} foot={s.dueThisWeek ? s.dueThisWeek + " due this week" : "None due this week"} />
            <Box label="Overdue" tone={s.overdue ? "crit" : "good"} value={s.overdue} foot={s.overdue ? "Needs attention today" : "All caught up"} />
            <Box
                label="Studied today"
                onClick={openStudy}
                title="Open Study"
                value={<>{studyTime(study.minutes)}{study.goal > 0 && <small> of {studyTime(study.goal)}</small>}</>}
                foot={study.goal > 0 ? (study.streak > 0 ? study.streak + "-day streak" : left ? left + " min to your goal" : "Daily goal reached") : "Set a daily goal"}
            >
                {study.goal > 0 && (
                    <span className="mt-auto block h-1 overflow-hidden rounded-full bg-line-2" role="meter" aria-label="Daily goal" aria-valuemin={0} aria-valuemax={study.goal} aria-valuenow={Math.min(study.minutes, study.goal)}>
                        <i className="block h-full rounded-full bg-primary" style={{ width: Math.min(100, Math.round((study.minutes / study.goal) * 100)) + "%" }} />
                    </span>
                )}
            </Box>
        </>
    )
}

function Box({ label, value, foot, tone, onClick, title, children }: {
    label: string; value: ReactNode; foot: ReactNode; tone?: "crit" | "good"
    onClick?: () => void; title?: string; children?: ReactNode
}) {
    const body = (
        <>
            <span className="text-[12.5px] text-muted-foreground">{label}</span>
            <span className={cn(
                "font-serif text-[34px] leading-[1.1] font-medium tabular-nums [&_small]:font-sans [&_small]:text-[15px] [&_small]:font-normal [&_small]:text-muted-foreground",
                tone === "crit" ? "text-destructive" : tone === "good" ? "text-[var(--done-ink)]" : "text-foreground",
            )}>{value}</span>
            {children}
            {/* the foot sits at the bottom, unless a goal bar is there already */}
            <span className={cn("truncate text-[12.5px] text-ink-2", !children && "mt-auto")}>{foot}</span>
        </>
    )
    const box = "flex h-[132px] w-full min-w-0 flex-col gap-1 rounded-[var(--radius)] border border-border bg-card px-[18px] pt-4 pb-3.5 text-left font-[inherit] max-[700px]:flex-[0_0_170px] max-[700px]:snap-start"
    return onClick
        ? <button type="button" onClick={onClick} title={title} className={cn(box, "cursor-pointer")}>{body}</button>
        : <div className={box}>{body}</div>
}
