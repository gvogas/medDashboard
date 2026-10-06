// Log study, or Edit session: time away from the timer typed in, or a logged session put
// right. Either way it counts toward the streak and the goal, which the line under the
// fields says as you type. The draft is the sheet's state until it is saved.

import { useId, useMemo } from "react"
import { cn } from "@/lib/utils"
import { isOpen, normalizePrefs } from "@/core/model"
import { today } from "@/core/dates"
import { duration } from "@/lib/time"
import { useCourses, useItems, useProfile, useStudySessions } from "@/data/store"
import { keyedCourses, keyedItems } from "@/data/refs"
import { closeSheet, replaceSheet } from "@/data/overlay"
import { impact, MAX_MINUTES, QUICK, saveSession, validSession, type SessionDraft } from "@/data/session-edit"
import { deleteSession } from "@/data/actions"
import type { StudyPrefs } from "@/data/types"
import { Button, DateInput, Fields, Label, NumberInput, Section, Select, SheetBody, SheetFoot, SheetHead, TextArea } from "./fields"
import { TimeField } from "./time-field"

export function SessionSheet({ draft: d }: { draft: SessionDraft }) {
    /* the draft holds keys (refs.ts): a class's course and items sit beside yours */
    const courses = keyedCourses(useCourses())
    const items = keyedItems(useItems())
    const sessions = useStudySessions()
    const profile = useProfile()
    const f = useId()
    const edit = (change: Partial<SessionDraft>) => replaceSheet({ kind: "session", draft: { ...d, ...change } })
    const now = today()
    const ok = validSession(d, now)

    const course = courses.find((c) => c.id === d.courseId) ?? null
    const shownCourses = courses.filter((c) => !c.archived || c.id === d.courseId)
    const forItems = useMemo(
        () => items.filter((it) => it.courseId === d.courseId && (isOpen(it) || it.id === d.itemId)).sort((a, b) => a.date.localeCompare(b.date)),
        [items, d.courseId, d.itemId],
    )
    const line = impact(d, sessions, normalizePrefs(profile?.studyPrefs) as StudyPrefs, now)

    return (
        <>
            <SheetHead color={course?.color || "#7D8A99"} kind={d.isNew ? "Log study" : "Edit session"} onClose={closeSheet}>
                {d.base && <span className="text-[11.5px] text-muted-foreground">{d.base.manual ? "logged by hand" : "recorded by the timer"}</span>}
            </SheetHead>

            <SheetBody>
                {d.isNew && (
                    <p className="m-0 text-[12.5px] leading-[1.5] text-ink-2">
                        Time away from the timer: the library, Anki on your phone, a study group. It counts toward your streak and goal like a timer session.
                    </p>
                )}
                <Fields>
                    <Label htmlFor={f + "date"}>Day</Label>
                    <DateInput id={f + "date"} value={d.date} max={now} onChange={(e) => edit({ date: e.target.value })} />
                    <Label htmlFor={f + "time"}>Started</Label>
                    <TimeField id={f + "time"} value={d.time} onChange={(time) => edit({ time })} />
                    <Label htmlFor={f + "min"}>How long</Label>
                    <span className="flex items-center gap-2">
                        <NumberInput id={f + "min"} inputMode="numeric" min={1} max={MAX_MINUTES} autoFocus className="w-24"
                            value={d.minutes || ""} onChange={(e) => edit({ minutes: e.target.value === "" ? 0 : Math.round(+e.target.value) })} />
                        <span className="text-muted-foreground">minutes</span>
                    </span>
                    <span className="col-start-2 flex flex-wrap gap-1.5" role="group" aria-label="Quick lengths">
                        {QUICK.map((m) => (
                            <button key={m} type="button" aria-pressed={d.minutes === m} onClick={() => edit({ minutes: m })}
                                className={cn(
                                    "cursor-pointer rounded-full border border-border bg-card px-2.5 py-[3px] font-[inherit] text-[11.5px] font-semibold text-ink-2 hover:text-foreground",
                                    d.minutes === m && "border-[var(--study)] bg-[var(--study-soft)] text-[var(--study-ink)]",
                                )}>{duration(m)}</button>
                        ))}
                    </span>
                    <Label htmlFor={f + "course"}>Course</Label>
                    <Select id={f + "course"} value={course ? d.courseId! : ""} onChange={(e) => edit({ courseId: e.target.value || null, itemId: null })}>
                        {!course && <option value="">No course</option>}
                        {shownCourses.map((c) => <option key={c.id} value={c.id}>{c.code + " · " + c.name}</option>)}
                    </Select>
                    <Label htmlFor={f + "item"}>For</Label>
                    <Select id={f + "item"} value={d.itemId ?? ""} onChange={(e) => edit({ itemId: e.target.value || null })}>
                        <option value="">Nothing in particular</option>
                        {forItems.map((it) => <option key={it.id} value={it.id}>{it.title}</option>)}
                    </Select>
                </Fields>
                <Section title={<label htmlFor={f + "note"}>What you covered</label>} note="optional">
                    <TextArea id={f + "note"} rows={3} maxLength={200} value={d.note} placeholder="Anki, 120 cards · chapters 3–4 · practice questions"
                        onChange={(e) => edit({ note: e.target.value })} className="min-h-[72px]" />
                </Section>
                <p role="status" className="m-0 rounded-[9px] bg-[var(--study-soft)] px-3 py-2.5 text-[12.5px] text-[var(--study-ink)]">{line}</p>
            </SheetBody>

            <SheetFoot hint={ok ? (d.isNew ? "Ready to log" : "Unsaved changes") : "Not ready yet"}>
                {!d.isNew && <Button variant="ghost" onClick={() => deleteSession(d.id)}>Delete</Button>}
                <Button variant="ghost" onClick={closeSheet}>Cancel</Button>
                <Button variant="study" disabled={!ok} onClick={() => void saveSession(d)}>{d.isNew ? "Log " + duration(d.minutes || 0) : "Save"}</Button>
            </SheetFoot>
        </>
    )
}
