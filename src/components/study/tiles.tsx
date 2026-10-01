// The Study page's three tiles: the streak, today against the daily goal, and the term
// so far (the last 12 weeks with no term start), the numbers in serif. With no goal,
// Today offers to set one.

import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import { duration } from "@/lib/time"
import { Card } from "@/components/ui/card"
import { useStudyTiles } from "@/data/study"
import { openSettings } from "@/data/actions"

export function StudyTiles() {
    const t = useStudyTiles()
    const goal = t.today.goal
    return (
        <div className="grid grid-cols-3 gap-[13px] max-[760px]:grid-cols-2 max-[520px]:grid-cols-1">
            <Tile
                label="Streak"
                icon={<Icon study><Flame /></Icon>}
                value={<>{t.streak.days} <small>{t.streak.days === 1 ? "day" : "days"}</small></>}
                sub={t.streak.sub}
            />
            <Tile
                label="Today"
                icon={goal ? <GoalRing part={t.today.minutes} whole={goal} className="size-12 max-[520px]:size-10" /> : <Icon><Calendar /></Icon>}
                value={<>{duration(t.today.minutes)}{goal > 0 && <small> of {duration(goal)}</small>}</>}
                sub={goal
                    ? t.today.sub
                    : (
                        <button type="button" onClick={() => openSettings("goalGrp")}
                            className="cursor-pointer border-0 bg-transparent px-0 py-0.5 font-[inherit] text-[12.5px] font-semibold text-accent-foreground underline underline-offset-2">
                            Set a daily goal
                        </button>
                    )}
            />
            <Tile
                label={t.term.label}
                icon={<Icon><Calendar /></Icon>}
                value={duration(t.term.minutes)}
                sub={t.term.sub}
                className="max-[760px]:col-span-2 max-[520px]:col-span-1"
            />
        </div>
    )
}

function Tile({ label, icon, value, sub, className }: { label: string; icon: ReactNode; value: ReactNode; sub: ReactNode; className?: string }) {
    return (
        <Card className={cn("min-w-0", className)}>
            <div role="group" aria-label={label} className="flex min-h-[84px] items-center gap-4 px-5 py-3 max-[520px]:min-h-0 max-[520px]:gap-3 max-[520px]:px-3.5 max-[520px]:py-2.5">
                {icon}
                <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-[12.5px] text-muted-foreground">{label}</span>
                    <b className="font-serif text-[28px] leading-none font-medium text-foreground tabular-nums max-[520px]:text-[24px] [&_small]:whitespace-nowrap [&_small]:text-[15px] [&_small]:font-normal [&_small]:text-muted-foreground">{value}</b>
                    <span className="text-[12px] text-ink-2">{sub}</span>
                </span>
            </div>
        </Card>
    )
}

/** The tile's picture in a soft square: the accent's, or the study colour's. */
const Icon = ({ study = false, children }: { study?: boolean; children: ReactNode }) => (
    <span aria-hidden="true" className={cn(
        "grid size-11 flex-none place-items-center rounded-[8px] max-[520px]:size-10 [&_svg]:size-5",
        study ? "bg-[var(--study-soft)] text-[var(--study-ink)]" : "bg-accent text-accent-foreground",
    )}>{children}</span>
)

const Flame = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
        <path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.2 1-3.6 2.2-4.8.3 1.6 1 2.6 2.3 3.1C11 8.5 11.3 5.5 12 3z" />
    </svg>
)

export const Calendar = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M9 3v4M15 3v4" />
    </svg>
)

const RING = 2 * Math.PI * 34

/** A ring filling toward the goal: `part` of `whole` minutes. On the dark study surfaces
    (`fx`: the focus screen, the dock) it takes the phase colour. `className` sets its size. */
export function GoalRing({ part, whole, tone = "page", className }: { part: number; whole: number; tone?: "page" | "fx"; className?: string }) {
    const f = whole ? Math.min(1, part / whole) : 0
    return (
        <svg viewBox="0 0 80 80" role="meter" aria-label="Daily goal" aria-valuemin={0} aria-valuemax={whole} aria-valuenow={Math.min(part, whole)}
            className={cn("flex-none", className ?? "size-14 max-[520px]:size-11")}>
            <circle cx="40" cy="40" r="34" fill="none" strokeWidth="9" className={tone === "fx" ? "stroke-white/15" : "stroke-line-2"} />
            <circle cx="40" cy="40" r="34" fill="none" strokeWidth="9" strokeLinecap="round" transform="rotate(-90 40 40)"
                strokeDasharray={(RING * f).toFixed(1) + " " + RING.toFixed(1)}
                className={cn(tone === "fx" ? "stroke-[var(--ph)]" : "stroke-[var(--study)]", "transition-[stroke-dasharray] duration-400 motion-reduce:transition-none")} />
        </svg>
    )
}
