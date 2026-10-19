// A team project in the sheet (spec §10, §15), for admins until Stage 10. **Tasks**: add (owners
// and editors), done, claim, edit in place; below them the owner links the project to a class
// assignment, archives it or deletes it (typing its name), and anyone else leaves it.
// **Members**: who is in it, invites (they join as editors), the code, roles, removing, handing
// it on. **Activity**: what happened. Until the project's rows arrive (it was just made or
// joined) the sheet says it is on its way. Someone who is no longer an admin but still in a
// project sees it as before, with a line saying why it is not in their sidebar: the Worker
// gates only making, inviting and joining. Under the title: the due date and progress, and,
// for someone who holds the linked class, the assignment: its date when the two drift apart,
// with Use this date for owners and editors, or that it was removed. The assignee picker
// shows each member's workload.

import { useEffect, useId, useRef, useState, type RefObject } from "react"
import { cn } from "@/lib/utils"
import { dayMonth, today } from "@/core/dates"
import { useProfile, useSharedItems, useSpaces } from "@/data/store"
import { closeSheet, replaceSheet } from "@/data/overlay"
import { addTask, assignmentOf, canEdit, leaveProject, link, linkable, progress, projectItem, projectsShown, removeProject, takeAssignmentDate, tasksOf, workload, type ProjectTab } from "@/data/projects"
import { messageFor } from "@/data/classes"
import { setArchived } from "@/data/leave"
import { useMaintenance } from "@/data/maintenance"
import type { Space } from "@/data/types"
import { TeamGlyph } from "@/components/shared-glyph"
import { MaintenanceBar, MaintenancePage } from "@/components/maintenance"
import { tabKeys } from "./radio-keys"
import { Button, DateInput, Note, Section, Select, SheetBody, SheetFoot, SheetHead, TextInput } from "./fields"
import { MembersTab } from "./members-tab"
import { ActivityList } from "./activity-list"
import { TaskRow } from "./task-row"

const TABS: readonly [ProjectTab, string][] = [["tasks", "Tasks"], ["members", "Members"], ["activity", "Activity"]]
const TITLE = "m-0 text-[22px] leading-[1.22] font-[750] tracking-[-.02em] text-foreground"
const BANNER = "flex flex-wrap items-center gap-2 rounded-lg border border-[var(--warn-line)] bg-[var(--warn-bg)] px-2.5 py-2 text-[12px] text-[var(--warn-ink)]"

/* While the admins have shared classes switched off, everyone else gets the maintenance page instead. */
export function ProjectSheet({ spaceId, tab }: { spaceId: string; tab: ProjectTab }) {
    const maintenance = useMaintenance("classes")
    if (maintenance !== "blocked") return <ProjectCard spaceId={spaceId} tab={tab} bar={maintenance === "admin"} />
    return (
        <>
            <SheetHead kind="Project" onClose={closeSheet} />
            <SheetBody><MaintenancePage feature="classes" inSheet /></SheetBody>
        </>
    )
}

function ProjectCard({ spaceId, tab, bar }: { spaceId: string; tab: ProjectTab; bar: boolean }) {
    const spaces = useSpaces()
    const space = spaces.find((s) => s.id === spaceId) ?? null
    const items = useSharedItems()
    const project = projectItem(spaceId, items)
    const me = useProfile()?.id ?? ""
    const f = useId()

    if (!space || !project) return (
        <>
            <SheetHead kind="Project" onClose={closeSheet} />
            <SheetBody><Note>This project isn't on this device yet. It arrives with the next sync.</Note></SheetBody>
            <SheetFoot hint=""><Button onClick={closeSheet}>Done</Button></SheetFoot>
        </>
    )
    const n = space.members.length
    const p = progress(tasksOf(spaceId, items)), a = assignmentOf(space, project, items, spaces)
    return (
        <>
            <SheetHead kind="Project" onClose={closeSheet}>
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-px text-[10.5px] font-semibold text-ink-2">
                    <TeamGlyph className="size-3" /> Team · {space.role}
                </span>
            </SheetHead>
            <div className="flex flex-col gap-1 px-[18px] pt-4">
                <h2 className={TITLE}>{project.title}</h2>
            </div>
            <div className="flex flex-col gap-1 px-[18px] pt-1 text-[12.5px] text-ink-2">
                <span>Due {dayMonth(project.date)} · {p.label}</span>
                {a.state === "same" && <span className="text-muted-foreground">For {a.label}</span>}
                {a.state === "drift" && (
                    <span className="flex flex-wrap items-center gap-x-2 text-muted-foreground">
                        For {a.label} · Assignment due {dayMonth(a.date)}
                        {canEdit(space) && <Button variant="ghost" className="px-2.5 py-1" onClick={() => void takeAssignmentDate(project, a.date)}>Use this date</Button>}
                    </span>
                )}
                {a.state === "removed" && <span className="text-muted-foreground">Linked assignment removed{space.role === "owner" && !space.archived ? ". Relink it below." : ""}</span>}
            </div>
            <div role="tablist" aria-label="Project" onKeyDown={tabKeys} className="flex gap-1 border-b border-border px-3">
                {TABS.map(([id, label]) => (
                    <button
                        key={id}
                        type="button"
                        role="tab"
                        id={f + id}
                        aria-selected={tab === id}
                        aria-controls={tab === id ? f + "panel" : undefined}
                        tabIndex={tab === id ? 0 : -1}
                        onClick={() => replaceSheet({ kind: "project", spaceId, tab: id })}
                        className={cn(
                            "h-10 flex-none cursor-pointer border-0 bg-transparent px-3 font-[inherit] text-[13px] outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--accent)]",
                            tab === id ? "font-semibold text-foreground shadow-[inset_0_-2px_0_var(--primary)]" : "font-medium text-muted-foreground hover:text-foreground",
                        )}
                    >
                        {label}
                    </button>
                ))}
            </div>
            <SheetBody>
                {bar && <MaintenanceBar className="mb-0" />}
                {!projectsShown() && <Note>Team projects are open to admins only for now, so this one isn't in your sidebar. You're still in it: work in it or leave it here.</Note>}
                <div role="tabpanel" id={f + "panel"} aria-labelledby={f + tab} className="flex flex-col gap-3.5">
                    {tab === "tasks" ? <Tasks space={space} title={project.title} me={me} /> : tab === "members" ? <MembersTab spaceId={spaceId} kind="project" /> : <ActivityList spaceId={spaceId} />}
                </div>
            </SheetBody>
            <SheetFoot hint={n + (n === 1 ? " member" : " members")}>
                <Button onClick={closeSheet}>Done</Button>
            </SheetFoot>
        </>
    )
}

function Tasks({ space, title, me }: { space: Space; title: string; me: string }) {
    const tasks = tasksOf(space.id, useSharedItems())
    const editor = canEdit(space)
    const load = workload(tasks, space.members.map((m) => m.userId), today())
    /* a task deleted here takes the keyboard with it: it goes to the new task's box, else the list */
    const add = useRef<HTMLInputElement>(null)
    const list = useRef<HTMLUListElement>(null)
    const gone = () => (add.current ?? list.current)?.focus()
    return (
        <>
            <Archived space={space} />
            {editor && <NewTask spaceId={space.id} input={add} />}
            <Section title="Tasks" note={String(tasks.length)}>
                {tasks.length
                    ? <ul ref={list} tabIndex={-1} aria-label="Tasks" className="m-0 flex list-none flex-col gap-1 p-0 outline-none">{tasks.map((t) => <TaskRow key={t.id} task={t} space={space} me={me} load={load} gone={gone} />)}</ul>
                    : <Note>No tasks yet.{editor ? " Add the first above." : ""}</Note>}
            </Section>
            <ProjectActions space={space} title={title} />
        </>
    )
}

function Archived({ space }: { space: Space }) {
    const [err, setErr] = useState("")
    if (!space.archived) return null
    return (
        <div role="note" className={BANNER}>
            <span className="min-w-0 flex-1">Archived: read-only for everyone.</span>
            {space.role === "owner" && <Button variant="ghost" onClick={() => void setArchived(space.id, false).then(() => setErr(""), (e) => setErr(messageFor(e, "", "project")))}>Unarchive</Button>}
            {err && <Note tone="bad">{err}</Note>}
        </div>
    )
}

function NewTask({ spaceId, input }: { spaceId: string; input: RefObject<HTMLInputElement | null> }) {
    const [title, setTitle] = useState("")
    const [date, setDate] = useState(today())
    const ready = !!title.trim() && !!date
    /* the box clears as the save starts, so fast typing never joins two titles; Enter waits
       for the save, and a task not saved gets its title back */
    const saving = useRef(false)
    const add = async () => {
        if (!ready || saving.current) return
        const taken = title
        saving.current = true
        setTitle("")
        let ok = false
        try { ok = await addTask(spaceId, taken, date) } catch { ok = false } finally { saving.current = false }
        if (!ok) setTitle((t) => t || taken)
    }
    return (
        <span className="flex gap-2">
            <TextInput ref={input} aria-label="New task" placeholder="Add a task" value={title} maxLength={140} className="min-w-0 flex-1" onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void add() } }} />
            <DateInput aria-label="New task's date" value={date} onChange={(e) => setDate(e.target.value)} className="w-[140px] flex-none" />
            <Button disabled={!ready} onClick={() => void add()}>Add</Button>
        </span>
    )
}

/* The owner's link, archive and delete; anyone else's Leave. Each needs a connection. */
function ProjectActions({ space, title }: { space: Space; title: string }) {
    const options = linkable(useSharedItems(), useSpaces())
    const [asking, setAsking] = useState(false)
    const [typed, setTyped] = useState("")
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState("")
    const f = useId()
    const run = async (act: () => Promise<void>) => {
        setBusy(true)
        try { await act(); setErr("") } catch (e) { setErr(messageFor(e, "", "project")) } finally { setBusy(false) }
    }
    const ask = () => { setTyped(""); setErr(""); setAsking(true) }
    /* Cancel gives the keyboard back to the button that asked */
    const opener = useRef<HTMLButtonElement>(null)
    const back = useRef(false)
    const cancel = () => { back.current = true; setAsking(false) }
    useEffect(() => { if (!asking && back.current) { back.current = false; opener.current?.focus() } }, [asking])
    const linked = space.parent ? space.parent.space + "/" + space.parent.item : ""

    if (space.role !== "owner") return (
        <Section title="This project">
            {!asking ? <Button ref={opener} variant="ghost" className="self-start" onClick={ask}>Leave the project…</Button> : (
                <div className="flex flex-col gap-2 rounded-lg bg-muted px-2.5 py-2">
                    <Note>Your tasks become unassigned and your notes here go. Nothing is copied: the project is the team's.</Note>
                    <span className="flex flex-wrap gap-2">
                        <Button variant="ghost" autoFocus onClick={cancel}>Cancel</Button>
                        <Button variant="danger" disabled={busy} onClick={() => void run(() => leaveProject(space.id))}>Leave {title}</Button>
                    </span>
                </div>
            )}
            {err && <Note tone="bad">{err}</Note>}
        </Section>
    )
    return (
        <Section title="This project">
            {!space.archived && <>
                <label htmlFor={f + "link"} className="text-[12px] font-[550] text-muted-foreground">Belongs to</label>
                <Select id={f + "link"} value={linked} disabled={busy} onChange={(e) => {
                    const o = options.find((x) => x.space + "/" + x.item === e.target.value)
                    void run(() => link(space.id, o ? { space: o.space, item: o.item } : null))
                }}>
                    <option value="">No class assignment</option>
                    {options.map((o) => <option key={o.space + "/" + o.item} value={o.space + "/" + o.item}>{o.label}</option>)}
                    {linked && !options.some((o) => o.space + "/" + o.item === linked) && <option value={linked}>An assignment you can't see</option>}
                </Select>
                <Note>Linking sets the due date to the assignment's.</Note>
            </>}
            <span className="flex flex-wrap gap-2">
                {!space.archived && <Button variant="ghost" disabled={busy} onClick={() => void run(() => setArchived(space.id, true))}>Archive the project</Button>}
                <Button ref={opener} variant="ghost" onClick={ask}>Delete the project…</Button>
            </span>
            {space.members.length > 1 ? <Note>Hand the project on in Members to leave it.</Note>
                : !space.archived && <Note>Archiving makes it read-only for everyone until you unarchive it.</Note>}
            {asking && (
                <div className="flex flex-col gap-2 rounded-lg bg-muted px-2.5 py-2">
                    <Note>Deletes it for everyone: its tasks, and everyone's notes on them. Members are told.</Note>
                    <TextInput aria-label={"Type " + title + " to confirm"} placeholder={title} value={typed} autoComplete="off" autoFocus onChange={(e) => setTyped(e.target.value)} />
                    <span className="flex flex-wrap gap-2">
                        <Button variant="ghost" onClick={cancel}>Cancel</Button>
                        <Button variant="danger" disabled={busy || typed.trim() !== title.trim()} onClick={() => void run(() => removeProject(space.id, typed.trim()))}>Delete for everyone</Button>
                    </span>
                </div>
            )}
            {err && <Note tone="bad">{err}</Note>}
        </Section>
    )
}
