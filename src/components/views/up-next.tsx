// Up next: what to do now, best first (core/next.ts), each with why. A task ticks off
// here as on the Week (a team task for the team); anything else opens its card. It folds
// away, and this browser remembers that. Standalone, so any view can put it on top.

import { useState } from "react"
import { cn } from "@/lib/utils"
import { isTest, tmeta } from "@/core/model"
import { useUpNext, type NextEntry } from "@/data/next"
import { openItem, toggleTask } from "@/data/actions"
import { keyOf } from "@/data/effective"
import { SourceMark } from "./source-mark"
import { accent, Empty, HeadNote, Panel } from "./bits"

const KEY = "rounds.upNext.folded"

const readFolded = () => { try { return localStorage.getItem(KEY) === "1" } catch { return false } }
const writeFolded = (on: boolean) => { try { if (on) localStorage.setItem(KEY, "1"); else localStorage.removeItem(KEY) } catch { /* private window: it just won't be remembered */ } }

export function UpNext({ className }: { className?: string }) {
    const rows = useUpNext()
    const [folded, setFolded] = useState(readFolded)
    const fold = () => { setFolded(!folded); writeFolded(!folded) }
    const late = rows.filter((r) => r.days < 0).length
    return (
        <Panel
            label="Up next"
            title="Up next"
            className={className}
            head={<>
                <HeadNote>{rows.length ? (late ? late + " overdue · " : "") + rows.length + " to do" : "all clear"}</HeadNote>
                <button type="button" onClick={fold} aria-expanded={!folded} aria-controls={folded ? undefined : "up-next-list"}
                    className="cursor-pointer rounded-md border-0 bg-transparent px-2 py-1 text-[11.5px] font-semibold text-ink-2 hover:text-foreground pointer-coarse:min-h-10">
                    {folded ? "Show" : "Hide"}
                </button>
            </>}
        >
            {!folded && (rows.length
                ? <ol id="up-next-list" className="m-0 list-none px-1.5 py-1">{rows.map((r) => <NextRowView key={keyOf(r.item)} row={r} />)}</ol>
                : <div id="up-next-list"><Empty title="Nothing urgent.">Good time to get ahead.</Empty></div>)}
        </Panel>
    )
}

function NextRowView({ row }: { row: NextEntry }) {
    const it = row.item, key = keyOf(it), m = tmeta(it.type)
    const task = it.type === "task"
    const tone = row.days < 0 ? "text-destructive" : row.days === 0 || row.prep?.hot ? "text-[var(--warn)]" : "text-muted-foreground"
    return (
        <li style={accent(m.color)} className="flex items-start gap-2.5 rounded-[6px] px-2.5 py-1.5 hover:bg-muted">
            {task
                ? <button
                    type="button"
                    aria-pressed={false}
                    aria-label={"Done: " + it.title}
                    onClick={(e) => { void toggleTask(key, e.currentTarget) }}
                    className="mt-0.5 grid size-[18px] flex-none cursor-pointer place-items-center rounded-[5px] border-[1.5px] border-line-2 bg-card p-0 text-transparent hover:border-[var(--accent)] hover:text-[var(--accent)] motion-safe:transition-colors"
                >
                    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="size-3" aria-hidden="true"><path d="M2 6.5l2.6 2.6L10 3.5" /></svg>
                </button>
                : <i aria-hidden="true" className="mt-[7px] size-2 flex-none rounded-[2px] bg-[var(--c)]" />}
            <button type="button" onClick={() => openItem(key)}
                className="min-w-0 flex-1 cursor-pointer border-0 bg-transparent p-0 text-left font-[inherit]">
                <span className="flex min-w-0 items-center gap-2">
                    <span className={cn("truncate text-[13px] text-foreground", isTest(it.type) && "font-semibold")}>{it.title}</span>
                    <SourceMark item={it} course={row.course} />
                    {row.course && <span className="flex-none text-[11px] text-muted-foreground">{row.course.code || row.course.name}</span>}
                </span>
                <span className={cn("block truncate text-[11.5px]", tone)}>{row.reason}</span>
            </button>
        </li>
    )
}
