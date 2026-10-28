// The History card on the Study page's History tab: Week, Month and Term. The week is a
// bar a day, split by course, against the goal, beside its sessions when the card is wide;
// the month a calendar whose days open their sessions; the term a heatmap from its start,
// whose picked day lists its sessions below. A deleted session waits in the card's foot for Undo,
// whichever tab is showing.

import { useEffect, useRef } from "react"
import { duration } from "@/lib/time"
import { dayOf } from "@/core/history"
import { shortDate } from "@/core/dates"
import { Panel } from "@/components/views/bits"
import { Button, Segmented } from "@/components/sheet/fields"
import { pickDay, setHistTab, stepHist, undoSessionDelete, useHistory } from "@/data/study"
import { deleteSession, openSession } from "@/data/actions"
import type { HistTab, SessionUndo } from "@/data/types"
import { courseCode, NavButton } from "./history-bits"
import { WeekPane } from "./history-week"
import { MonthPane } from "./history-month"
import { TermPane } from "./history-term"

const TABS = [["week", "Week"], ["month", "Month"], ["term", "Term"]] as const

export function HistoryCard() {
    const h = useHistory()
    const card = useRef<HTMLDivElement>(null)
    /* after ✕, focus goes to Undo; after Undo, to the session back in its place */
    const focusUndo = useRef(false)
    const restored = useRef<string | null>(null)

    useEffect(() => {
        const root = card.current
        if (!root) return
        if (focusUndo.current && h.undo) {
            focusUndo.current = false
            root.querySelector<HTMLElement>("[data-undo]")?.focus()
        }
        if (restored.current && h.undo?.session.id !== restored.current) {
            const id = restored.current
            restored.current = null
            root.querySelector<HTMLElement>('[data-session="' + CSS.escape(id) + '"] [data-edit]')?.focus()
        }
    })

    const remove = (id: string) => {
        focusUndo.current = true
        deleteSession(id)
    }
    const undo = () => {
        restored.current = h.undo?.session.id ?? null
        undoSessionDelete()
    }

    return (
        <div ref={card} className="min-w-0">
            <Panel
                label="History"
                title="History"
                head={<>
                    <Segmented label="Show history for" value={h.tab} options={TABS} onChange={(v: HistTab) => setHistTab(v)} />
                    {h.week && <Stepper unit="week" offset={h.week.offset} range={h.week.range} />}
                    {h.month && <Stepper unit="month" offset={h.month.offset} range={h.month.title} />}
                    {h.term && <span className="font-mono text-[12px] text-ink-2">{h.term.title} · {h.term.range}</span>}
                    <Button variant="ghost" onClick={() => openSession(null)} data-log
                        className="ml-auto gap-1.5 rounded-[9px] px-2.5 py-1 text-[12px] font-semibold hover:text-accent-foreground">
                        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true" className="size-3.5"><path d="M8 3v10M3 8h10" /></svg>
                        Log study
                    </Button>
                </>}
            >
                <div className="@container flex flex-col gap-3.5 p-3.5">
                    {h.week && <WeekPane w={h.week} goal={h.goal} onDelete={remove} />}
                    {h.month && <MonthPane m={h.month} onDelete={remove} />}
                    {h.term && <TermPane t={h.term} onPick={pickDay} onDelete={remove} />}
                </div>
                <div role="status">{h.undo && <UndoBar undo={h.undo} onUndo={undo} />}</div>
            </Panel>
        </div>
    )
}

/** ‹ the range › for the week or month shown; › stops at this one, and a chip comes back to it. */
function Stepper({ unit, offset, range }: { unit: "week" | "month"; offset: number; range: string }) {
    return (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <NavButton label={"Previous " + unit} onClick={() => stepHist(-1)}><path d="M10 3 5 8l5 5" /></NavButton>
            <span className="min-w-[96px] text-center font-mono text-[12.5px] text-foreground">{range}</span>
            <NavButton label={"Next " + unit} disabled={offset >= 0} onClick={() => stepHist(1)}><path d="M6 3l5 5-5 5" /></NavButton>
            {offset < 0 && (
                <button type="button" onClick={() => stepHist(0)}
                    className="cursor-pointer rounded-full border border-border bg-card px-2.5 py-1 font-[inherit] text-[12px] font-semibold text-ink-2 hover:text-foreground">
                    This {unit}
                </button>
            )}
        </span>
    )
}

function UndoBar({ undo, onUndo }: { undo: SessionUndo; onUndo: () => void }) {
    const s = undo.session
    return (
        <div className="mx-3.5 mb-3.5 flex items-center gap-2.5 rounded-[10px] bg-muted py-2 pr-2 pl-3.5 text-[13px] text-foreground">
            <span className="flex-1">Deleted <b>{courseCode(s.courseId)} · {duration(s.studyMinutes)}</b> from {shortDate(dayOf(s))}.</span>
            <button type="button" data-undo onClick={onUndo}
                className="cursor-pointer rounded-lg border-0 bg-transparent px-2.5 py-1.5 font-[inherit] text-[13px] font-bold text-accent-foreground hover:bg-accent">
                Undo
            </button>
        </div>
    )
}
