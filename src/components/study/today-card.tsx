// The Timer tab's Today card: today's total against the daily goal, today's sessions
// newest first (when, the course's colour, what, how long), and Log study by hand, which
// opens the session sheet. Editing and deleting a session stay in History.

import { duration } from "@/lib/time"
import { accent, Panel } from "@/components/views/bits"
import { openSession } from "@/data/actions"
import { NO_COURSE, useTodayStudy } from "@/data/study"

export function TodayCard() {
    const t = useTodayStudy()
    return (
        <Panel
            label="Today"
            title="Today"
            head={
                <span className="text-[12.5px] text-ink-2 tabular-nums">
                    <b className="font-semibold text-foreground">{duration(t.total)}</b>{t.goal > 0 && " of " + duration(t.goal)}
                </span>
            }
        >
            <div className="flex flex-col px-5 pt-1 pb-2">
                {t.rows.length ? (
                    <ul aria-label="Sessions today" className="m-0 flex list-none flex-col p-0">
                        {t.rows.map((r) => (
                            <li key={r.id} className="grid h-10 grid-cols-[44px_8px_minmax(0,1fr)_auto] items-center gap-2.5 border-t border-line-2 text-[13px] text-foreground first:border-t-0">
                                <span className="font-mono text-[12px] text-muted-foreground">{r.at}</span>
                                <span aria-hidden="true" style={accent(r.color) ?? accent(NO_COURSE)} className="size-2 rounded-[2px] bg-[var(--c)]" />
                                <span className="truncate">{r.what}</span>
                                <span className="font-mono text-[12.5px]">{duration(r.minutes)}</span>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="m-0 py-2.5 text-[13px] text-ink-2">Nothing logged today yet.</p>
                )}
                <button
                    type="button"
                    onClick={() => openSession(null)}
                    className="mt-1 inline-flex h-9 cursor-pointer items-center gap-1.5 self-start border-0 bg-transparent p-0 font-[inherit] text-[13px] font-medium text-accent-foreground hover:underline hover:underline-offset-2"
                >
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true" className="size-[11px]"><path d="M8 3v10M3 8h10" /></svg>
                    Log study by hand
                </button>
            </div>
        </Panel>
    )
}
