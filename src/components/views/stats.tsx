// The stat tiles above the week, month and table: the next exam or quiz, open
// assignments, overdue, and today's study against the goal. They are about the whole
// of your work, so the filters leave them alone. (The quote is in the sidebar's foot.)

import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import { TextureCard } from "@/components/ui/texture-card"
import { tmeta } from "@/core/model"
import { prepLabel } from "@/core/prep"
import { useUi } from "@/data/ui"
import { useStats } from "@/data/views"
import { statsShown } from "@/components/shell"
import { openItem, openStudy } from "@/data/actions"

/** "1h 20" or "45 min". */
export const studyTime = (min: number) => (min >= 60 ? Math.floor(min / 60) + "h" + (min % 60 ? " " + String(min % 60).padStart(2, "0") : "") : min + " min")

export function Stats() {
    const shown = useUi(statsShown)
    const cs = useUi((u) => u.bg === "cs")
    const s = useStats()

    /* <App> hides #stats with the tiles, so its gap goes too */
    if (!shown) return null

    const exam = s.nextExam, dd = s.daysTo
    const study = s.study, left = Math.max(0, study.goal - study.minutes)

    return (
        <>
            <Tile
                label="Next exam / quiz"
                hot={!!exam}
                onClick={exam ? () => openItem(exam.id) : undefined}
                title={exam ? "Open " + exam.title : undefined}
                value={dd === null ? "—" : dd === 0 ? "Today" : dd === 1 ? "Tomorrow" : <>{dd} <small>days</small></>}
                art={<Pulse cs={cs} />}
                foot={exam ? (
                    <>
                        <span className="mr-1.5 text-[9.5px] font-bold tracking-[.08em] text-[var(--hot-lab)] uppercase">{tmeta(exam.type).label}</span>
                        {exam.title}
                        {s.prep && <span className={cn("ml-1.5 font-mono", s.prep.hot && "text-destructive")}>{prepLabel(s.prep)}</span>}
                    </>
                ) : "Nothing scheduled"}
            />
            <Tile
                label="Open assignments"
                value={s.openAssignments}
                foot={s.dueThisWeek ? s.dueThisWeek + " due this week" : "none due this week"}
            />
            <Tile
                label="Overdue"
                hot={s.overdue > 0}
                good={s.overdue === 0}
                value={s.overdue}
                foot={s.overdue ? "needs attention today" : "All caught up"}
            />
            <Tile
                label="Study today"
                onClick={openStudy}
                title="Open Study"
                value={<>{studyTime(study.minutes)}{study.goal > 0 && <small> of {studyTime(study.goal)}</small>}</>}
                foot={study.goal > 0
                    ? (study.streak > 0 ? "🔥 " + study.streak + "-day streak" : left ? left + " min to your goal" : "Daily goal reached")
                    : "Set a daily goal"}
            >
                {study.goal > 0 && (
                    <span className="mt-1 block h-[5px] overflow-hidden rounded-full bg-line-2" role="meter" aria-label="Daily goal" aria-valuemin={0} aria-valuemax={study.goal} aria-valuenow={Math.min(study.minutes, study.goal)}>
                        <i className="block h-full rounded-full bg-primary" style={{ width: Math.min(100, Math.round((study.minutes / study.goal) * 100)) + "%" }} />
                    </span>
                )}
            </Tile>
        </>
    )
}

function Tile({ label, value, foot, hot = false, good = false, onClick, title, art, children }: {
    label: string; value: ReactNode; foot: ReactNode; hot?: boolean; good?: boolean
    onClick?: () => void; title?: string; art?: ReactNode; children?: ReactNode
}) {
    const body = (
        <>
            <span className={cn("block text-[11px] tracking-[.1em] uppercase", hot ? "text-[var(--hot-lab)]" : "text-ink-2")}>{label}</span>
            <span className={cn(
                "block text-[22px] leading-tight font-bold tabular-nums [&_small]:text-[11px] [&_small]:font-medium [&_small]:text-ink-2",
                hot ? "text-destructive" : good ? "text-[var(--good)]" : "text-foreground",
            )}>{value}</span>
            {children}
            {art}
            <span className="mt-auto block truncate text-[10.5px] text-muted-foreground">{foot}</span>
        </>
    )
    const box = cn("flex h-full min-h-[92px] w-full flex-col gap-0.5 rounded-[calc(var(--radius)-4px)] px-3 py-2.5 text-left", hot && "bg-[var(--hot-bg)]")
    return (
        <TextureCard className="min-w-0 bg-card max-[700px]:flex-[0_0_150px] max-[700px]:snap-start">
            {onClick
                ? <button type="button" onClick={onClick} title={title} className={cn(box, "cursor-pointer border-0 bg-transparent font-[inherit]")}>{body}</button>
                : <div className={box}>{body}</div>}
        </TextureCard>
    )
}

/** Med: a heartbeat. CS: a clock signal with one glitch. */
const Pulse = ({ cs }: { cs: boolean }) => (
    <svg viewBox="0 0 120 16" preserveAspectRatio="none" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" aria-hidden="true" className="mt-px block h-4 w-full text-destructive">
        <path d={cs
            ? "M0 12h8V4h8v8h8V4h8v8h4V2h2v12h2V4h8v8h8V4h8v8h8V4h8v8h4V2h2v12h2V4h8v8h8V4h6"
            : "M0 11h13l2-2 3 5 3-3h9l3-7 3 13 3-6h11l2-2 3 5 3-3h10l3-7 3 13 3-6h13l2-2 3 5 3-3h9"} />
    </svg>
)
