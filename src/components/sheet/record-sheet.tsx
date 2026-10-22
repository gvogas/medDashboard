// A room's group record (study together, spec §3). At the end of a session it is the summary:
// "You studied 1h 40m with Priya and Sam", your minutes, the group's and how many, a bar each,
// and Add a note (your session's sheet). From History it is the record of that session. Only
// the people who were in the room can read it; each row is that person's own session.

import { useEffect } from "react"
import { duration } from "@/lib/time"
import { data } from "@/core/store"
import { closeSheet } from "@/data/overlay"
import { openSession } from "@/data/actions"
import { loadRecord, useRecord, withMine } from "@/data/record"
import { dayMonth, iso } from "@/core/dates"
import { clockTime } from "@/data/study-timer"
import { useStudySessions } from "@/data/store"
import { Button, Note, SheetBody, SheetFoot, SheetHead } from "./fields"

/** "Priya", "Priya and Sam", "Priya, Sam and Ana". */
export function names(list: string[]): string {
    const first = list.map((n) => n.split(/\s+/)[0] || n)
    return first.length < 2 ? first.join("") : first.slice(0, -1).join(", ") + " and " + first[first.length - 1]
}

export function RecordSheet({ roomId, summary }: { roomId: string; summary: boolean }) {
    const entry = useRecord(roomId)
    useStudySessions()   /* your own row follows your session */
    const me = data.profile?.id ?? ""
    /* the others' sessions may still be on their way up when the room ends: ask once more */
    useEffect(() => {
        if (!summary) return
        const t = setTimeout(() => void loadRecord(roomId, true), 8000)
        return () => clearTimeout(t)
    }, [roomId, summary])
    const record = entry?.record ? withMine(entry.record, me) : null
    const mine = record?.members.find((m) => m.userId === me)
    const others = record?.members.filter((m) => m.userId !== me) ?? []
    const total = record?.members.reduce((a, m) => a + m.minutes, 0) ?? 0
    const max = Math.max(1, ...(record?.members.map((m) => m.minutes) ?? [1]))
    const session = data.study_sessions.find((s) => s.id === "r-" + roomId)

    return (
        <>
            <SheetHead kind={summary ? "Session done" : "Group session"} onClose={closeSheet} />
            <SheetBody>
                {!record && <Note>{entry?.error ? "Could not load the group record. Try again when you're online." : "Loading…"}</Note>}
                {record && (
                    <>
                        <h2 className="m-0 text-[22px] leading-[1.22] font-[750] tracking-[-.02em]">
                            {summary
                                ? "You studied " + duration(mine?.minutes ?? 0) + (others.length ? " with " + names(others.map((m) => m.name)) : "")
                                : "Group session"}
                        </h2>
                        <p className="m-0 text-[12.5px] text-muted-foreground">
                            {summary
                                ? "Saved to your sessions. It counts toward today's goal, your streak and the leaderboard."
                                : dayMonth(iso(new Date(record.startedAt))) + ", " + clockTime(record.startedAt) + " · " + duration(total) + " together"}
                        </p>
                        <div className="grid grid-cols-3 gap-2.5 max-[520px]:grid-cols-1">
                            <Stat value={duration(mine?.minutes ?? 0)} label="You" />
                            <Stat value={duration(total)} label="Group total" />
                            <Stat value={String(record.members.length)} label={record.members.length === 1 ? "Person" : "People"} />
                        </div>
                        <ul aria-label="Minutes each" className="m-0 flex list-none flex-col gap-2 p-0">
                            {record.members.map((m) => (
                                <li key={m.userId} className="grid grid-cols-[110px_minmax(0,1fr)_64px] items-center gap-2.5 text-[13px]">
                                    <span className="truncate">{m.userId === me ? "You" : m.name}</span>
                                    <span aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-muted">
                                        <span className="block h-full rounded-full bg-[var(--study)]" style={{ width: (m.minutes / max * 100).toFixed(0) + "%" }} />
                                    </span>
                                    <span className="text-right font-mono tabular-nums">{duration(m.minutes)}</span>
                                </li>
                            ))}
                        </ul>
                        {!summary && <Note>Only the people in the session see this. Your row is your own session: editing or deleting it changes your time here too.</Note>}
                    </>
                )}
            </SheetBody>
            <SheetFoot hint="">
                {session && <Button variant="ghost" onClick={() => openSession(session.id)}>{summary ? "Add a note" : "Edit your session"}</Button>}
                <Button onClick={closeSheet}>Done</Button>
            </SheetFoot>
        </>
    )
}

const Stat = ({ value, label }: { value: string; label: string }) => (
    <div className="flex flex-col gap-0.5 rounded-lg border border-line-2 px-3 py-2.5">
        <b className="font-serif text-[22px] leading-tight font-medium tabular-nums">{value}</b>
        <span className="text-[12px] text-muted-foreground">{label}</span>
    </div>
)
