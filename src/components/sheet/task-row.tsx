// One task in the project sheet (spec §10, §15): done, title (it opens the task's card), date, who has it, and Claim;
// owners and editors edit it in place (title, date, assignees, each with their open tasks in
// the next two weeks, Delete). A write the Worker turns down later lands in Saved copies, as
// any shared row's does. The editor takes the keyboard when it opens and gives it back to
// Edit when it closes; it closes by itself when you can no longer edit (the project archived,
// your role changed).

import { useEffect, useId, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { dayMonth } from "@/core/dates"
import { assigneeNames, canClaim, canEdit, canFinish, claim, deleteTask, saveTask, setDone } from "@/data/projects"
import { openItem } from "@/data/actions"
import type { SharedItem, Space } from "@/data/types"
import { Button, DateInput, TextInput } from "./fields"

const BOX = "size-3.5 shrink-0 accent-[var(--accent)]"

/** `load` is each member's workload (projects.ts workload); `gone` is called when the task is
 *  deleted here, to put the keyboard somewhere that stays. */
export function TaskRow({ task, space, me, load, gone }: { task: SharedItem; space: Space; me: string; load: Map<string, number>; gone: () => void }) {
    const [editing, setEditing] = useState(false)
    const edit = useRef<HTMLButtonElement>(null)
    const back = useRef(false)
    const editor = canEdit(space)
    const done = task.status === "done"
    /* claiming finished work reads oddly: Claim is for open tasks; stepping off stays */
    const can = canClaim(space, task, me)
    const claimAct = done && can === "claim" ? null : can
    useEffect(() => { if (!editor) setEditing(false) }, [editor])
    useEffect(() => { if (!editing && back.current) { back.current = false; edit.current?.focus() } }, [editing])
    const close = () => { back.current = true; setEditing(false) }
    return (
        <li aria-label={task.title} className="flex flex-col gap-1 rounded-lg bg-muted px-2.5 py-1.5 text-[12.5px]">
            <span className="flex items-center gap-2">
                <input type="checkbox" aria-label={"Done: " + task.title} checked={done} disabled={!canFinish(space, task, me)}
                    onChange={(e) => void setDone(task, e.target.checked)} className={BOX} />
                <button type="button" onClick={() => openItem(task.scope + "/" + task.id)}
                    className={cn("min-w-0 flex-1 cursor-pointer truncate border-0 bg-transparent p-0 text-left font-[inherit] text-[inherit] text-foreground outline-none hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]", done && "text-muted-foreground line-through")}>{task.title}</button>
                <span className="shrink-0 text-[11px] text-muted-foreground">{dayMonth(task.date)}</span>
            </span>
            <span className="flex items-center gap-2 pl-[22px] text-[11px] text-muted-foreground">
                <span className="min-w-0 flex-1 truncate">{assigneeNames(task, space, me)}</span>
                {claimAct && <Button variant="ghost" className="px-2.5 py-1" onClick={() => void claim(task, me, claimAct === "claim")}>{claimAct === "claim" ? "Claim" : "Unclaim"}</Button>}
                {editor && !editing && <Button ref={edit} variant="ghost" className="px-2.5 py-1" aria-label={"Edit " + task.title} onClick={() => setEditing(true)}>Edit</Button>}
            </span>
            {editing && editor && <TaskEditor task={task} space={space} load={load} close={close} remove={() => { void deleteTask(task); gone() }} />}
        </li>
    )
}

function TaskEditor({ task, space, load, close, remove }: { task: SharedItem; space: Space; load: Map<string, number>; close: () => void; remove: () => void }) {
    const [title, setTitle] = useState(task.title)
    const [date, setDate] = useState(task.date)
    /* everyone, or the people still in the project: someone who left is not offered again */
    const [who, setWho] = useState<string[]>(() => task.assignees.filter((u) => u === "*" || space.members.some((m) => m.userId === u)))
    const f = useId()
    const everyone = who.includes("*")
    const toggle = (id: string) => setWho((w) => (w.includes(id) ? w.filter((x) => x !== id) : [...w.filter((x) => x !== "*"), id]))
    const save = () => { void saveTask(task, { title: title.trim() || task.title, date: date || task.date, assignees: who }); close() }
    return (
        <div className="flex flex-col gap-2 border-t border-border pt-2">
            <TextInput aria-label="Task" value={title} maxLength={140} autoFocus onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save() } }} />
            <DateInput aria-label="Date" value={date} onChange={(e) => setDate(e.target.value)} />
            <fieldset className="m-0 flex flex-wrap gap-x-3 gap-y-1 border-0 p-0">
                <legend className="mb-1 text-[11px] text-muted-foreground">Assigned to</legend>
                <label htmlFor={f + "all"} className="flex cursor-pointer items-center gap-1.5">
                    <input id={f + "all"} type="checkbox" checked={everyone} onChange={() => setWho(everyone ? [] : ["*"])} className={BOX} />Everyone
                </label>
                {space.members.map((m) => (
                    <label key={m.userId} htmlFor={f + m.userId} className="flex cursor-pointer items-center gap-1.5">
                        <input id={f + m.userId} type="checkbox" aria-labelledby={f + m.userId + "n"} aria-describedby={f + m.userId + "w"} checked={!everyone && who.includes(m.userId)} disabled={everyone} onChange={() => toggle(m.userId)} className={BOX} />
                        <span id={f + m.userId + "n"}>{m.name}</span><span id={f + m.userId + "w"} className="text-muted-foreground"> · {load.get(m.userId) ?? 0} in the next 2 weeks</span>
                    </label>
                ))}
            </fieldset>
            <span className="flex gap-2">
                <Button variant="danger" onClick={remove}>Delete</Button>
                <span className="flex-1" />
                <Button variant="ghost" onClick={close}>Cancel</Button>
                <Button onClick={save}>Save</Button>
            </span>
        </div>
    )
}
