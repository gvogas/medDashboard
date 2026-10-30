// The people panel on the focus screen in a study room (spec §2): who is in the room with what
// they are logging and their minutes so far (the host marked, someone away dimmed), the host's
// Invite more, and the activity (joined, left, paused, skipped). On a phone it is a short line
// of names under the controls instead (RoomLine).

import { useEffect, useRef, useState, type FormEvent } from "react"
import { cn } from "@/lib/utils"
import { duration, MINUTE_MS } from "@/lib/time"
import { data } from "@/core/store"
import { useFriends } from "@/data/friends"
import { inviteMore, isHost, localClock, memberMinutes, sendChat, useRoom } from "@/data/room"
import type { Run } from "@/data/study-timer"
import type { RoomEvent, RoomMember } from "@/data/types"

const H3 = "m-0 flex justify-between text-[11.5px] font-semibold tracking-[.08em] text-[var(--fx-ink-3)] uppercase"

/** Your minutes from the run itself (it ticks); everyone else's from the room's record. */
function useMinutes(run: Run) {
    const state = useRoom()
    const clock = localClock(state)
    const me = data.profile?.id ?? ""
    return (m: RoomMember) => m.userId === me
        ? Math.floor(((run.room?.earlierMs ?? 0) + Math.max(0, run.studyMs - (run.room?.joinedStudyMs ?? 0))) / MINUTE_MS)
        : clock ? memberMinutes(m, clock, run.at) : 0
}

export function RoomPanel({ run }: { run: Run }) {
    const state = useRoom()
    const minutes = useMinutes(run)
    const view = state.view
    const me = data.profile?.id ?? ""
    const inside = view?.members.filter((m) => m.state === "in") ?? []
    return (
        <aside aria-label="In the room" className="relative z-[1] flex w-[290px] flex-none flex-col gap-4 overflow-y-auto border-l border-white/10 px-5 py-6 text-[var(--fx-ink)] max-[900px]:hidden">
            <h3 className={H3}><span>In the room</span><span>{inside.length}</span></h3>
            {!view && <p className="m-0 text-[12.5px] text-[var(--fx-ink-3)]">Loading…</p>}
            <ul className="m-0 flex list-none flex-col p-0">
                {inside.map((m) => (
                    <li key={m.userId} className={cn("flex items-center gap-2.5 border-b border-white/10 py-2", m.away && "opacity-55")}>
                        <span className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate text-[13px]">
                                {m.userId === me ? "You" : m.name}
                                {m.userId === view!.room.hostId && <span className="ml-1.5 rounded-full bg-white/10 px-1.5 py-px text-[10.5px] font-semibold text-[var(--fx-ink-2)]">host</span>}
                                {m.away && <span className="ml-1.5 text-[11px] text-[var(--fx-ink-3)]">away</span>}
                            </span>
                            <span className="truncate text-[12px] text-[var(--fx-ink-3)]">{m.courseLabel || "No class picked"}</span>
                        </span>
                        <span className="text-[12.5px] text-[var(--fx-ink-2)] tabular-nums">{duration(minutes(m))}</span>
                    </li>
                ))}
            </ul>
            {view && isHost(state) && <InviteMore inside={view.members.filter((m) => m.state === "in").map((m) => m.userId)} />}
            {view && <RoomChat />}
            {view && view.room.feed.length > 0 && (
                <>
                    <h3 className={H3}><span>Activity</span></h3>
                    <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[12.5px] text-[var(--fx-ink-3)]">
                        {view.room.feed.map((e, i) => <li key={i}>{eventText(e, me, view.members)}</li>)}
                    </ul>
                </>
            )}
        </aside>
    )
}

/** On a phone: the people in the room in one line, under the controls. */
export function RoomLine({ run }: { run: Run }) {
    const state = useRoom()
    const minutes = useMinutes(run)
    const me = data.profile?.id ?? ""
    const inside = state.view?.members.filter((m) => m.state === "in") ?? []
    if (!inside.length) return null
    return (
        <p aria-label="In the room" className="m-0 hidden text-center text-[12.5px] text-[var(--fx-ink-3)] max-[900px]:block">
            {inside.map((m) => (m.userId === me ? "You" : m.name.split(" ")[0]) + " " + duration(minutes(m))).join(" · ")}
        </p>
    )
}

function InviteMore({ inside }: { inside: string[] }) {
    const { list } = useFriends()
    const [open, setOpen] = useState(false)
    const [sent, setSent] = useState<string[]>([])
    const [err, setErr] = useState("")
    const others = (list?.friends ?? []).filter((f) => !inside.includes(f.userId))
    const send = async (id: string) => {
        setErr("")
        const e = await inviteMore([id])
        if (e) setErr(e); else setSent((s) => [...s, id])
    }
    if (!open) {
        return (
            <button type="button" onClick={() => setOpen(true)}
                className="cursor-pointer self-start rounded-full border border-white/10 bg-white/5 px-3.5 py-1.5 font-[inherit] text-[12.5px] font-semibold text-[var(--fx-ink-2)] hover:text-[var(--fx-ink)]">
                Invite more
            </button>
        )
    }
    return (
        <div className="flex flex-col gap-1.5">
            {others.length === 0 && <p className="m-0 text-[12.5px] text-[var(--fx-ink-3)]">Everyone on your Friends list is here.</p>}
            {others.map((f) => (
                <div key={f.userId} className="flex items-center gap-2 text-[13px]">
                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                    {sent.includes(f.userId)
                        ? <span className="text-[12px] text-[var(--fx-ink-3)]">Invited</span>
                        : <button type="button" aria-label={"Invite " + f.name} onClick={() => void send(f.userId)}
                            className="cursor-pointer rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 font-[inherit] text-[12px] text-[var(--fx-ink-2)] hover:text-[var(--fx-ink)]">Invite</button>}
                </div>
            ))}
            {err && <p role="alert" className="m-0 text-[12px] text-[#F3A497]">{err}</p>}
        </div>
    )
}

/** The room's chat: the people in it talk to each other. In the panel, under the controls on a phone, and in the music sheet on a phone while music is open. */
export function RoomChat() {
    const state = useRoom()
    const me = data.profile?.id ?? ""
    const [draft, setDraft] = useState("")
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState("")
    const list = useRef<HTMLOListElement>(null)
    useEffect(() => { const el = list.current; if (el) el.scrollTop = el.scrollHeight }, [state.chat.length])
    if (!state.view) return null
    const send = async (e: FormEvent) => {
        e.preventDefault()
        if (busy || !draft.trim()) return
        setBusy(true); setErr("")
        const failed = await sendChat(draft)
        setBusy(false)
        if (failed) setErr(failed); else setDraft("")
    }
    return (
        <section aria-label="Room chat" className="flex flex-col gap-2">
            <h3 className={H3}><span>Chat</span></h3>
            <ol ref={list} aria-label="Messages" className="m-0 flex max-h-[220px] min-h-[40px] list-none flex-col gap-1.5 overflow-y-auto p-0 text-[13px]">
                {state.chat.length === 0 && <li className="text-[12.5px] text-[var(--fx-ink-3)]">No messages yet.</li>}
                {state.chat.map((m) => (
                    <li key={m.id} className="break-words">
                        <span className="font-semibold text-[var(--fx-ink-2)]">{m.userId === me ? "You" : m.name}: </span>
                        <span>{m.body}</span>
                    </li>
                ))}
            </ol>
            <form onSubmit={send} className="flex gap-2">
                <input aria-label="Message the room" value={draft} maxLength={500} onChange={(e) => setDraft(e.target.value)} placeholder="Say something"
                    className="min-w-0 flex-1 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 font-[inherit] text-[13px] text-[var(--fx-ink)]" />
                <button type="submit" disabled={busy || !draft.trim()}
                    className="cursor-pointer rounded-full border border-white/10 bg-white/5 px-3 py-1.5 font-[inherit] text-[12.5px] font-semibold text-[var(--fx-ink-2)] hover:text-[var(--fx-ink)] disabled:opacity-50">Send</button>
            </form>
            {err && <p role="alert" className="m-0 text-[12px] text-[#F3A497]">{err}</p>}
        </section>
    )
}

/** "Priya joined", "You paused", "Sam is the host now". */
export function eventText(e: RoomEvent, me: string, members: RoomMember[]): string {
    const myName = members.find((m) => m.userId === me)?.name
    const who = e.name && e.name === myName ? "You" : e.name || "Someone"
    switch (e.kind) {
        case "started": return who + " started the session"
        case "joined": return who + " joined"
        case "left": return who + " left"
        case "paused": return who + " paused"
        case "resumed": return who + " resumed"
        case "skipped": return who + " skipped ahead"
        case "ended": return "The session ended"
        case "host": return who === "You" ? "You're the host now" : who + " is the host now"
    }
}
