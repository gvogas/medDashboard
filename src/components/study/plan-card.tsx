// The Timer tab's Study plan card: what to study today, and the days after it.
// Today is a target that stays put for the day (core/study-today.ts): each upcoming exam's
// topics for today as boxes to tick, the exam's name opening its card, and Study this,
// which points the timer at the exam. A ticked topic is the exam's own checklist step, so
// it is done on its card and on every device too. Below, Coming up: the next study days,
// the first few shown and the rest behind Show all. Class exams read through the effective
// list, so your mark (status, checklist) on them is what counts. With nothing to plan, the
// card says how a plan is made and offers the next exam that has no topics yet.

import { useState } from "react"
import { cn } from "@/lib/utils"
import { Panel, HeadNote } from "@/components/views/bits"
import { Meter } from "@/components/sheet/fields"
import { diffDays, shortDate, today as todayIso } from "@/core/dates"
import { TIMELINE_DAYS } from "@/core/study-timeline"
import type { TodayExam } from "@/core/study-today"
import { openItem } from "@/data/actions"
import { courseKeyOf, itemByKey } from "@/data/effective"
import { studyExam, tickTopic, usePlanView } from "@/data/study-plan"
import { toast } from "@/data/toast"

/** Study days shown under Coming up before Show all. */
const SHOWN = 4

const dayLabel = (date: string, today: string) => {
    const n = diffDays(today, date)
    return n === 1 ? "Tomorrow" : shortDate(date)
}
const until = (n: number) => (n === 1 ? "tomorrow" : "in " + n + " days")

export function PlanCard() {
    const plan = usePlanView()
    const today = todayIso()
    const [all, setAll] = useState(false)
    const days = (() => {
        const byDate = new Map<string, typeof plan.upcoming>()
        for (const e of plan.upcoming) byDate.set(e.date, [...(byDate.get(e.date) || []), e])
        return [...byDate.entries()]
    })()
    const shown = all ? days : days.slice(0, SHOWN)
    const empty = !plan.today.length && !days.length
    const done = plan.total - plan.left
    return (
        <Panel label="Study plan" title="Study plan"
            head={<HeadNote>{plan.total ? (plan.left ? `${plan.left} of ${plan.total} left today` : "Done for today") : `Next ${TIMELINE_DAYS} days`}</HeadNote>}>
            <div className="flex flex-col px-5 pt-3 pb-3.5">
                {empty ? <NoPlan bare={plan.bare} bareKey={plan.bareKey} /> : (
                    <>
                        <section aria-label="Today's topics" className="flex flex-col gap-2.5">
                            <div className="flex items-center gap-3">
                                <h3 className="m-0 text-[11px] font-semibold tracking-[.12em] text-ink-2 uppercase">Today</h3>
                                {plan.total > 0 && <span className="min-w-0 flex-1"><Meter part={done / plan.total} pink full={plan.left === 0} /></span>}
                            </div>
                            {plan.today.length
                                ? plan.today.map((e) => <ExamToday key={e.examKey} exam={e} />)
                                : <p className="m-0 text-[13px] text-ink-2">Nothing planned for today.</p>}
                            {plan.total > 0 && plan.left === 0 && (
                                <p role="status" className="rise-in m-0 rounded-md bg-[var(--done)] px-2.5 py-1.5 text-[12.5px] font-medium text-[var(--done-ink)]">Today's topics are done. Anything more is a head start.</p>
                            )}
                        </section>
                        {days.length > 0 && (
                            <section aria-label="Coming up" className="mt-3.5 flex flex-col border-t border-line-2 pt-3">
                                <h3 className="m-0 mb-0.5 text-[11px] font-semibold tracking-[.12em] text-ink-2 uppercase">Coming up</h3>
                                <ol aria-label="Study days" className="m-0 flex list-none flex-col p-0">
                                    {shown.map(([date, list]) => (
                                        <li key={date} className="grid grid-cols-[84px_minmax(0,1fr)] gap-2.5 border-t border-line-2 py-2 text-[13px] first:border-t-0">
                                            <span className="font-mono text-[12px] text-muted-foreground">{dayLabel(date, today)}</span>
                                            <ul className="m-0 flex min-w-0 list-none flex-col gap-1.5 p-0">
                                                {list.map((e) => (
                                                    <li key={e.examKey} className="min-w-0">
                                                        <span className="font-medium text-foreground">{e.exam}</span>
                                                        <span className="text-ink-2">: {e.topics.join(", ")}</span>
                                                    </li>
                                                ))}
                                            </ul>
                                        </li>
                                    ))}
                                </ol>
                                {days.length > SHOWN && (
                                    <button type="button" aria-expanded={all} onClick={() => setAll(!all)}
                                        className="hit mt-0.5 cursor-pointer self-start border-0 bg-transparent p-0 font-[inherit] text-[12.5px] font-medium text-accent-foreground hover:underline hover:underline-offset-2">
                                        {all ? "Show fewer days" : `Show all ${days.length} study days`}
                                    </button>
                                )}
                            </section>
                        )}
                    </>
                )}
            </div>
        </Panel>
    )
}

/** One exam's topics for today: its name (opens its card), how soon it is, Study this, and the boxes. */
function ExamToday({ exam }: { exam: TodayExam }) {
    const it = itemByKey(exam.examKey)
    const timed = !!it && !!courseKeyOf(it)
    const study = () => {
        if (!studyExam(exam.examKey)) return
        toast("The timer is set to " + exam.exam + ".")
        /* on a phone the Ready card is above this one: bring it back into sight */
        document.querySelector<HTMLElement>('section[aria-label="Ready"]')?.scrollIntoView?.({ block: "nearest", behavior: "smooth" })
    }
    return (
        <div role="group" aria-label={exam.exam} className="flex flex-col gap-1">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <button type="button" onClick={() => openItem(exam.examKey)} title="Open the exam"
                    className="min-w-0 cursor-pointer truncate border-0 bg-transparent p-0 text-left font-[inherit] text-[13.5px] font-semibold text-foreground hover:underline hover:underline-offset-2">
                    {exam.exam}
                </button>
                <span className={cn("text-[12px] tabular-nums", exam.daysLeft <= 2 ? "text-[var(--warn)]" : "text-muted-foreground")}>{until(exam.daysLeft)}</span>
                {timed && (
                    <button type="button" onClick={study} aria-label={"Study " + exam.exam + " with the timer"}
                        className="hit ml-auto cursor-pointer rounded-full border border-border bg-card px-2.5 py-0.5 font-[inherit] text-[11.5px] font-semibold text-ink-2 hover:border-[var(--study)] hover:text-[var(--study-ink)]">
                        Study this
                    </button>
                )}
            </div>
            <ul className="m-0 flex list-none flex-col p-0">
                {exam.topics.map((t) => {
                    const id = "plan-" + exam.examKey + "-" + t.text
                    return (
                        <li key={t.text}>
                            <label htmlFor={id} className="flex cursor-pointer items-start gap-2.5 rounded-[6px] px-1.5 py-1 hover:bg-muted">
                                <input id={id} type="checkbox" checked={t.done} onChange={(e) => void tickTopic(exam.examKey, t.text, e.target.checked)} className="peer sr-only" />
                                <span aria-hidden="true" className={cn(
                                    "mt-px grid size-[18px] flex-none place-items-center rounded-[5px] border-[1.5px] transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--accent)]",
                                    t.done ? "border-[var(--study)] bg-[var(--study)] text-primary-foreground" : "border-[var(--box-line)] bg-card text-transparent",
                                )}>
                                    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="size-3"><path d="M2 6.5l2.6 2.6L10 3.5" /></svg>
                                </span>
                                <span className={cn("min-w-0 text-[13px] transition-colors", t.done ? "text-muted-foreground line-through" : "text-foreground")}>{t.text}</span>
                            </label>
                        </li>
                    )
                })}
            </ul>
        </div>
    )
}

/** Nothing to plan: how a plan is made, and the next exam without topics when there is one. */
function NoPlan({ bare, bareKey }: { bare: number; bareKey: string | null }) {
    const exam = bareKey ? itemByKey(bareKey) : null
    return (
        <div className="flex flex-col items-start gap-2 py-1">
            <p className="m-0 text-[13px] text-ink-2">
                {bare
                    ? (bare === 1 ? "Your next exam has no topics yet." : `${bare} upcoming exams have no topics yet.`) + " Add the topics to an exam and they are spread over the days before it, a few each day."
                    : `No study days in the next ${TIMELINE_DAYS} days. Add an exam with its topics and they are spread over the days before it, a few each day.`}
            </p>
            {exam && (
                <button type="button" onClick={() => openItem(bareKey!)}
                    className="hit cursor-pointer border-0 bg-transparent p-0 font-[inherit] text-[13px] font-medium text-accent-foreground hover:underline hover:underline-offset-2">
                    Add topics to {exam.title.trim() || "the exam"}
                </button>
            )}
        </div>
    )
}
