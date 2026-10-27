// History: a session's row, with who it was with, and the lists of them.

import { openRecord, useRecord } from "@/data/record"
import { data } from "@/core/store"
import { type ReactNode } from "react"
import { cn } from "@/lib/utils"
import { duration } from "@/lib/time"
import { DOW } from "@/core/dates"
import { itemByKey as itemOf } from "@/data/effective"
import { leftSpaceLabel } from "@/data/refs"
import { clockTime } from "@/data/study"
import { openSession } from "@/data/actions"
import type { Course, Item, StudySession } from "@/data/types"
import { courseOf, courseColour, courseCode, plural } from "./history-bits"

export function Sessions({ list, withDay, onDelete }: { list: StudySession[]; withDay: boolean; onDelete: (id: string) => void }) {
    return (
        <ul className="m-0 flex list-none flex-col p-0">
            {list.map((s) => <SessionRow key={s.id} s={s} withDay={withDay} onDelete={onDelete} />)}
        </ul>
    )
}

/** When, the course, what, how long, Timer or By hand, ✎ and ✕. Narrow, it takes two lines. */
function SessionRow({ s, withDay, onDelete }: { s: StudySession; withDay: boolean; onDelete: (id: string) => void }) {
    const it = s.itemId ? (itemOf(s.itemId) as Item | null) : null
    const note = s.note || (s.roundsDone ? plural(s.roundsDone, "round") : "")
    const at = new Date(s.startedAt)
    return (
        <li data-session={s.id} className={cn(
            "grid items-center gap-x-2.5 gap-y-1 border-t border-line-2 px-0.5 py-[7px] text-[13px] text-foreground",
            "[grid-template-columns:108px_72px_minmax(0,1fr)_56px_64px_auto]",
            "@max-[520px]:py-2.5 @max-[520px]:[grid-template-areas:'chip_what_mins'_'tm_src_acts'] @max-[520px]:[grid-template-columns:auto_minmax(0,1fr)_auto]",
        )}>
            <span className="font-mono text-[12px] whitespace-nowrap text-ink-2 @max-[520px]:[grid-area:tm]">
                {withDay && DOW[at.getDay()] + " " + at.getDate() + " · "}{clockTime(s.startedAt)}
            </span>
            <span style={courseColour(s.courseId)}
                className="inline-flex max-w-full items-center gap-1.5 justify-self-start overflow-hidden rounded-md bg-muted px-2 py-[3px] text-[11px] font-bold tracking-[.05em] whitespace-nowrap @max-[520px]:[grid-area:chip]">
                <i aria-hidden="true" className="size-[7px] flex-none rounded-full bg-[var(--c)]" />{courseCode(s.courseId)}
            </span>
            <span className="flex min-w-0 flex-col @max-[520px]:[grid-area:what]">
                <b className="truncate font-semibold">{it ? it.title : (courseOf(s.courseId) as Course | null)?.name || (leftSpaceLabel(s.courseId) ?? "No course")}</b>
                {note && <em className="truncate font-serif text-[12.5px] text-ink-2 italic">{note}</em>}
                {s.roomId && <WithRow roomId={s.roomId} />}
            </span>
            <span className="text-right font-mono font-semibold @max-[520px]:[grid-area:mins]">{duration(s.studyMinutes)}</span>
            <span className={cn(
                "justify-self-start rounded-full px-2 py-0.5 text-[11px] font-semibold @max-[520px]:[grid-area:src]",
                s.manual ? "bg-[var(--chip-bg)] text-[var(--chip-ink)]" : "bg-[var(--study-soft)] text-[var(--study-ink)]",
            )}>{s.manual ? "By hand" : "Timer"}</span>
            <span className="flex gap-0.5 @max-[520px]:justify-self-end @max-[520px]:[grid-area:acts]">
                <RowButton label="Edit this session" data-edit onClick={() => openSession(s.id)}>
                    <path d="M11 2.5l2.5 2.5L6 12.5 3 13l.5-3z" strokeWidth="1.6" strokeLinejoin="round" />
                </RowButton>
                <RowButton label="Delete this session" onClick={() => onDelete(s.id)}>
                    <path d="m4.5 4.5 7 7m0-7-7 7" strokeWidth="1.8" strokeLinecap="round" />
                </RowButton>
            </span>
        </li>
    )
}

/** A session studied in a room: the others as chips, and its Group record. */
function WithRow({ roomId }: { roomId: string }) {
    const entry = useRecord(roomId)
    const me = data.profile?.id ?? ""
    const others = entry?.record?.members.filter((m) => m.userId !== me) ?? []
    return (
        <span className="mt-0.5 flex flex-wrap items-center gap-1">
            <span className="text-[11.5px] text-muted-foreground">{others.length ? "with" : "group session"}</span>
            {others.slice(0, 4).map((m) => (
                <span key={m.userId} className="rounded-full bg-muted px-2 py-px text-[11.5px] text-ink-2">{m.name.split(/\s+/)[0]}</span>
            ))}
            {others.length > 4 && <span className="text-[11.5px] text-muted-foreground">+{others.length - 4}</span>}
            <button type="button" onClick={() => openRecord(roomId)}
                className="hit cursor-pointer border-0 bg-transparent px-1 py-0 font-[inherit] text-[11.5px] font-semibold text-accent-foreground underline underline-offset-2">
                Group record
            </button>
        </span>
    )
}

const RowButton = ({ label, onClick, children, ...rest }: { label: string; onClick: () => void; children: ReactNode; "data-edit"?: boolean }) => (
    <button type="button" aria-label={label} onClick={onClick} {...rest}
        className="grid size-8 cursor-pointer place-items-center rounded-md border-0 bg-transparent p-0 text-muted-foreground hover:bg-line-2 hover:text-foreground @max-[520px]:size-10">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true" className="size-3.5">{children}</svg>
    </button>
)

/** "Deleted ANAT · 45m from Tue 22 Sep." and Undo, until the delete is final. */
