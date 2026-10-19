// A team project's task in the card (spec §15). **Team**: the task as the whole team sees it:
// done, date, times, who has it, its checklist, notes and links, changed by the project's owner
// and editors for everyone (a member ticks done on their own or everyone's tasks, claims or
// unclaims, and reads the rest), with who changed it last. **Yours**: your notes and "not
// mine", which only you see. Opened by the task's key, '<scope>/<id>'. Text saves once typing
// pauses; leaving the card saves what is waiting. A project's own item opens the project sheet
// instead (actions.ts openItem). Delete for everyone asks first, in the foot.

import { useEffect, useId, useState } from "react"
import { cn } from "@/lib/utils"
import { httpUrl, tmeta } from "@/core/model"
import { shortDate } from "@/core/dates"
import { useItems, useMarks, useProfile, useSharedItems, useSpaces } from "@/data/store"
import { beforeSheetClose, closeSheet } from "@/data/overlay"
import { busyDays, celebrate, countdown } from "@/data/item-edit"
import { splitKey } from "@/data/refs"
import { editedBy, editRow, flushTyping, markIdOf, pendingMark, pendingRow, setHidden, typeMark, typeRow, useTyping } from "@/data/marks"
import { assigneeNames, canClaim, canEdit, canFinish, claim, deleteTask, openProject, setDone } from "@/data/projects"
import { toast } from "@/data/toast"
import { useMaintenance } from "@/data/maintenance"
import { StatusChip } from "@/components/views/bits"
import { TeamGlyph } from "@/components/shared-glyph"
import { MaintenanceBar, MaintenancePage } from "@/components/maintenance"
import type { Item, Mark, SharedItem } from "@/data/types"
import { Button, Note, Prop, Props, QUIET, Section, SheetBody, SheetFoot, SheetHead, TextArea, TitleArea } from "./fields"
import { TimeField } from "./time-field"
import { DatePicker } from "./date-picker"
import { ICONS } from "./prop-icons"
import { Checklist, Links } from "./item-parts"

const TITLE = "font-serif text-[30px] leading-[1.15] font-[500] tracking-[-.015em]"
const BOX = "size-3.5 shrink-0 accent-[var(--accent)]"

/* While the admins have shared classes switched off, everyone else gets the maintenance page
   (an admin keeps the card, under the bar), as for the project sheet. */
export function TaskSheet({ itemKey }: { itemKey: string }) {
    const maintenance = useMaintenance("classes")
    if (maintenance !== "blocked") return <TaskCard itemKey={itemKey} bar={maintenance === "admin"} />
    return (
        <>
            <SheetHead kind="Team task" onClose={closeSheet} />
            <SheetBody><MaintenancePage feature="classes" inSheet /></SheetBody>
        </>
    )
}

function TaskCard({ itemKey, bar }: { itemKey: string; bar: boolean }) {
    const { scope, id } = splitKey(itemKey)
    useTyping()
    const row = useSharedItems().find((it) => it.scope === scope && it.id === id && !it.deletedAt) ?? null
    const space = useSpaces().find((s) => s.scope === scope) ?? null
    const stored = useMarks().find((m) => m.id === markIdOf(itemKey)) ?? null
    const items = useItems()
    const me = useProfile()?.id ?? ""
    const f = useId()
    /* Delete for everyone asks first, in the foot (as a class item's card does) */
    const [asking, setAsking] = useState(false)

    /* closing, or switching to another item, saves what is being typed */
    useEffect(() => {
        const save = () => { void flushTyping() }
        beforeSheetClose.add(save)
        return () => { beforeSheetClose.delete(save) }
    }, [])
    /* deleted, or the project gone from this device, while open */
    useEffect(() => { if (!row || !space) closeSheet() }, [row, space])
    if (!row || !space) return null

    const t: SharedItem = { ...row, ...pendingRow(itemKey) }
    const mark: Partial<Mark> = { ...(stored ?? {}), ...pendingMark(itemKey) }
    const editor = canEdit(space)
    const m = tmeta("task")
    const done = t.status === "done"
    /* Claim is for open tasks; stepping off stays (task-row.tsx) */
    const can = canClaim(space, t, me)
    const claimAct = done && can === "claim" ? null : can
    const by = editedBy(row, space, me)

    const hide = async () => {
        await setHidden(itemKey, true)
        toast("Hidden from your views. Show it again from the project.")
        closeSheet()
    }
    const remove = () => {
        closeSheet()
        void deleteTask(row)
    }

    return (
        <>
            <SheetHead color={m.color} kind="Team task" onClose={closeSheet}>
                <StatusChip item={t as Item} />
                <span className="font-mono text-[11px] text-muted-foreground">{countdown(t as Item)}</span>
                <button type="button" onClick={() => openProject(space.id)}
                    className="inline-flex cursor-pointer items-center gap-1 rounded-full border-0 bg-muted px-2 py-px font-[inherit] text-[10.5px] font-semibold text-ink-2 hover:text-foreground">
                    <TeamGlyph className="size-3" /> {space.name}
                </button>
            </SheetHead>

            <SheetBody className="gap-[22px] px-6 pt-2 pb-7 max-[700px]:px-4">
                {bar && <MaintenanceBar className="mb-0" />}
                {editor
                    ? <TitleArea value={t.title} maxLength={140} aria-label="Title" placeholder="Untitled task" className={cn("shrink-0", TITLE)}
                        onChange={(e) => typeRow(itemKey, { title: e.target.value })} onBlur={() => void flushTyping()} />
                    : <h2 className={cn("m-0", TITLE)}>{t.title}</h2>}

                <Section title={<><TeamGlyph /> Team</>} note={by || "Everyone in the project sees these"}>
                    <Props>
                        <Prop icon={ICONS.status} label="Done" htmlFor={f + "done"}>
                            <input id={f + "done"} type="checkbox" aria-label="Done" checked={done} disabled={!canFinish(space, t, me)} className={BOX}
                                onChange={(e) => { if (e.target.checked) celebrate(e.currentTarget); void setDone(row, e.target.checked) }} />
                        </Prop>
                        {editor ? (
                            <>
                                <Prop icon={ICONS.date} label="Date" top>
                                    <DatePicker value={t.date} busy={busyDays(items, "")} onChange={(date) => void editRow(itemKey, { date })} />
                                </Prop>
                                <Prop icon={ICONS.time} label="Time" htmlFor={f + "start"}>
                                    <span className="flex items-center gap-1.5">
                                        <TimeField id={f + "start"} label="Start time" className={QUIET} value={t.start} onChange={(start) => void editRow(itemKey, { start })} />
                                        <span className="text-[12px] text-muted-foreground">to</span>
                                        <TimeField label="End time" className={QUIET} value={t.end} onChange={(end) => void editRow(itemKey, { end })} />
                                    </span>
                                </Prop>
                            </>
                        ) : (
                            <Prop icon={ICONS.date} label="When">
                                <span>{t.date ? shortDate(t.date) : "No date"}{t.start ? " · " + t.start + (t.end ? "–" + t.end : "") : ""}</span>
                            </Prop>
                        )}
                        <Prop icon={ICONS.course} label="Who">
                            <span className="flex flex-wrap items-center gap-2">
                                <span>{assigneeNames(t, space, me)}</span>
                                {claimAct && <Button variant="ghost" className="px-2.5 py-1" onClick={() => void claim(row, me, claimAct === "claim")}>{claimAct === "claim" ? "Claim" : "Unclaim"}</Button>}
                            </span>
                        </Prop>
                    </Props>
                    {editor ? (
                        <>
                            <Checklist item={t as Item} fill={null} fillNote="" onLeave={() => void flushTyping()}
                                onChange={(list, typing) => { if (typing) typeRow(itemKey, { checklist: list }); else void editRow(itemKey, { checklist: list }) }} />
                            <TextArea aria-label="Team notes" value={t.notes} maxLength={5000} placeholder="What the team should know about this task."
                                onChange={(e) => typeRow(itemKey, { notes: e.target.value })} onBlur={() => void flushTyping()} />
                            <Links item={t as Item} onChange={(links) => void editRow(itemKey, { links })} />
                        </>
                    ) : <TeamFacts t={t} archived={space.archived} />}
                </Section>

                <Section title="Yours" note="Only you see these">
                    <TextArea aria-label="Your notes" value={mark.notes ?? ""} maxLength={5000} placeholder="Only you see these."
                        onChange={(e) => typeMark(itemKey, { notes: e.target.value })} onBlur={() => void flushTyping()} />
                    <Button variant="ghost" className="self-start" onClick={() => void hide()}>Not mine · hide it</Button>
                </Section>
            </SheetBody>

            {asking && editor ? (
                <SheetFoot hint={"Delete it for everyone in " + space.name + "?"}>
                    <Button variant="ghost" onClick={() => setAsking(false)}>Keep it</Button>
                    <Button variant="danger" onClick={remove}>Delete it</Button>
                </SheetFoot>
            ) : (
                <SheetFoot hint="Edits save as you type">
                    {editor && <Button variant="ghost" aria-label="Delete task" onClick={() => setAsking(true)}>Delete for everyone</Button>}
                    <Button onClick={closeSheet}>Done</Button>
                </SheetFoot>
            )}
        </>
    )
}

/* The task's checklist, notes and links, for a member (or anyone, the project archived): read-only. */
function TeamFacts({ t, archived }: { t: SharedItem; archived: boolean }) {
    const list = t.checklist || [], links = t.links || []
    return (
        <>
            {list.length > 0 && (
                <ul aria-label="Checklist" className="m-0 flex list-none flex-col gap-0.5 p-0 text-[12.5px]">
                    {list.map((s) => (
                        <li key={s.id} className={cn(s.done && "text-muted-foreground line-through")}>
                            <span aria-hidden="true">{s.done ? "✓ " : "○ "}</span><span className="sr-only">{s.done ? "done: " : "to do: "}</span>{s.text}
                        </li>
                    ))}
                </ul>
            )}
            {t.notes && <p className="m-0 text-[12.5px] whitespace-pre-wrap text-ink-2">{t.notes}</p>}
            {links.length > 0 && (
                <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[12.5px]">
                    {links.map((l, i) => (
                        <li key={i}>
                            {/* only a web link becomes a link, however it got here */}
                            {httpUrl(l.url)
                                ? <a href={l.url} target="_blank" rel="noopener noreferrer" className="[overflow-wrap:anywhere] text-[var(--accent)] no-underline hover:underline">↗ {l.label || l.url}</a>
                                : <span>{l.label || l.url}</span>}
                        </li>
                    ))}
                </ul>
            )}
            <Note>{archived ? "This project is archived, so it is read-only." : "The project's owner and editors keep these."}</Note>
        </>
    )
}
