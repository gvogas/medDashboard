// One task in the project sheet (spec §10, §15): done, title, date, who has it, and Claim;
// owners and editors edit it in place (title, date, assignees, Delete). A write the Worker
// turns down later lands in Saved copies, as any shared row's does.

import { useId, useState } from "react"
import { cn } from "@/lib/utils"
import { dayMonth } from "@/core/dates"
import { assigneeNames, canClaim, canEdit, canFinish, claim, deleteTask, saveTask, setDone } from "@/data/projects"
import type { SharedItem, Space } from "@/data/types"
import { Button, DateInput, TextInput } from "./fields"

const BOX = "size-3.5 shrink-0 accent-[var(--accent)]"

export function TaskRow({ task, space, me }: { task: SharedItem; space: Space; me: string }) {
    const [editing, setEditing] = useState(false)
    const done = task.status === "done"
    const claimAct = canClaim(space, task, me)
    return (
        <li aria-label={task.title} className="flex flex-col gap-1 rounded-lg bg-muted px-2.5 py-1.5 text-[12.5px]">
            <span className="flex items-center gap-2">
                <input type="checkbox" aria-label={"Done: " + task.title} checked={done} disabled={!canFinish(space, task, me)}
                    onChange={(e) => void setDone(task, e.target.checked)} className={BOX} />
                <span className={cn("min-w-0 flex-1 truncate", done && "text-muted-foreground line-through")}>{task.title}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">{dayMonth(task.date)}</span>
            </span>
            <span className="flex items-center gap-2 pl-[22px] text-[11px] text-muted-foreground">
                <span className="min-w-0 flex-1 truncate">{assigneeNames(task, space, me)}</span>
                {claimAct && <Button variant="ghost" className="px-2.5 py-1" onClick={() => void claim(task, me, claimAct === "claim")}>{claimAct === "claim" ? "Claim" : "Unclaim"}</Button>}
                {canEdit(space) && !editing && <Button variant="ghost" className="px-2.5 py-1" aria-label={"Edit " + task.title} onClick={() => setEditing(true)}>Edit</Button>}
            </span>
            {editing && <TaskEditor task={task} space={space} close={() => setEditing(false)} />}
        </li>
    )
}

function TaskEditor({ task, space, close }: { task: SharedItem; space: Space; close: () => void }) {
    const [title, setTitle] = useState(task.title)
    const [date, setDate] = useState(task.date)
    const [who, setWho] = useState<string[]>(task.assignees)
    const f = useId()
    const everyone = who.includes("*")
    const toggle = (id: string) => setWho((w) => (w.includes(id) ? w.filter((x) => x !== id) : [...w.filter((x) => x !== "*"), id]))
    const save = () => { void saveTask(task, { title: title.trim() || task.title, date: date || task.date, assignees: who }); close() }
    return (
        <div className="flex flex-col gap-2 border-t border-border pt-2">
            <TextInput aria-label="Task" value={title} maxLength={140} onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save() } }} />
            <DateInput aria-label="Date" value={date} onChange={(e) => setDate(e.target.value)} />
            <fieldset className="m-0 flex flex-wrap gap-x-3 gap-y-1 border-0 p-0">
                <legend className="mb-1 text-[11px] text-muted-foreground">Assigned to</legend>
                <label htmlFor={f + "all"} className="flex cursor-pointer items-center gap-1.5">
                    <input id={f + "all"} type="checkbox" checked={everyone} onChange={() => setWho(everyone ? [] : ["*"])} className={BOX} />Everyone
                </label>
                {space.members.map((m) => (
                    <label key={m.userId} htmlFor={f + m.userId} className="flex cursor-pointer items-center gap-1.5">
                        <input id={f + m.userId} type="checkbox" checked={!everyone && who.includes(m.userId)} disabled={everyone} onChange={() => toggle(m.userId)} className={BOX} />{m.name}
                    </label>
                ))}
            </fieldset>
            <span className="flex gap-2">
                <Button variant="ghost" onClick={() => { void deleteTask(task); close() }}>Delete</Button>
                <span className="flex-1" />
                <Button variant="ghost" onClick={close}>Cancel</Button>
                <Button onClick={save}>Save</Button>
            </span>
        </div>
    )
}
