// The Friends tab on the Study page (study together, spec §1): your friends, requests to and
// from you, Add friends (search), and the two switches. Loads when it opens and the list is
// missing or a minute old. While friends are switched off, the maintenance page.

import { useEffect, useRef, useState, type ReactNode } from "react"
import { cn } from "@/lib/utils"
import { Panel } from "@/components/views/bits"
import { Button, Note, TextInput } from "@/components/sheet/fields"
import { MaintenanceBar, MaintenancePage } from "@/components/maintenance"
import { useMaintenance } from "@/data/maintenance"
import { useScreen } from "@/data/signin"
import { answerRequest, askFriend, friendsStale, loadFriends, removeFriend, saveFriendSettings, searchPeople, useFriends } from "@/data/friends"
import type { FriendMatch, FriendPerson } from "@/data/types"

const ROW = "flex flex-wrap items-center gap-3 border-b border-line-2 py-2.5 last:border-b-0"
const SMALL = "text-[12.5px] text-muted-foreground"
const SEARCH_WAIT_MS = 300

export function FriendsCard() {
    const maintenance = useMaintenance("friends")
    if (maintenance === "blocked") return <MaintenancePage feature="friends" />
    return <Friends bar={maintenance === "admin"} />
}

function Friends({ bar }: { bar: boolean }) {
    const { list, offline, error } = useFriends()
    const screen = useScreen()
    const [msg, setMsg] = useState("")
    useEffect(() => { if (screen === "app" && friendsStale()) void loadFriends() }, [screen])

    const run = async (p: Promise<string>) => setMsg(await p)

    if (!list) return <Panel title="Friends" label="Friends"><div className="p-4"><Note>{offline ? "Friends need a connection." : error || "Loading…"}</Note></div></Panel>

    return (
        <div className="grid items-start gap-4 min-[900px]:grid-cols-[minmax(0,1fr)_320px]">
            {bar && <MaintenanceBar className="min-[900px]:col-span-2" />}
            <Panel title={<>Friends <span className="font-normal text-muted-foreground">{list.friends.length}</span></>} label="Friends">
                <div className="px-4 py-1.5">
                    {list.friends.length === 0 && <p className={cn(SMALL, "py-3")}>No friends yet. Find people with Add friends.</p>}
                    {list.friends.map((f) => (
                        <div key={f.userId} className={ROW}>
                            <Avatar p={f} />
                            <span className="flex min-w-[140px] flex-1 flex-col"><span>{f.name}</span><span className={SMALL}>@{f.username}</span></span>
                            <Button variant="danger" aria-label={"Remove " + f.name} onClick={() => void run(removeFriend(f.userId))}>Remove</Button>
                        </div>
                    ))}
                </div>
            </Panel>
            <div className="flex min-w-0 flex-col gap-4">
                <AddFriends onMessage={setMsg} />
                {(list.incoming.length > 0 || list.sent.length > 0) && (
                    <Panel title="Requests" label="Requests">
                        <div className="px-4 py-1.5">
                            {list.incoming.map((r) => (
                                <div key={r.userId} className={ROW}>
                                    <Avatar p={r} />
                                    <span className="flex min-w-[120px] flex-1 flex-col"><span>{r.name}</span><span className={SMALL}>Wants to be friends</span></span>
                                    <span className="flex gap-1.5">
                                        <Button aria-label={"Accept " + r.name} onClick={() => void run(answerRequest(r.userId, true))}>Accept</Button>
                                        <Button variant="ghost" aria-label={"Decline " + r.name} onClick={() => void run(answerRequest(r.userId, false))}>Decline</Button>
                                    </span>
                                </div>
                            ))}
                            {list.sent.map((r) => (
                                <div key={r.userId} className={ROW}>
                                    <Avatar p={r} />
                                    <span className="flex min-w-[120px] flex-1 flex-col"><span>{r.name}</span><span className={SMALL}>You asked</span></span>
                                    <Button variant="ghost" aria-label={"Cancel the request to " + r.name} onClick={() => void run(removeFriend(r.userId))}>Cancel</Button>
                                </div>
                            ))}
                        </div>
                    </Panel>
                )}
                <Panel title="Privacy" label="Privacy">
                    <div className="flex flex-col gap-3 p-4">
                        <Switch checked={list.settings.findable}
                            onChange={(on) => void run(saveFriendSettings({ ...list.settings, findable: on }))}>
                            Let people find me in search
                        </Switch>
                        <p className={cn(SMALL, "m-0 -mt-1.5 pl-6")}>{list.settings.findable ? "Your name and username show in Add friends." : "Only someone who types your exact username can find you."}</p>
                        <Switch checked={list.settings.showStudying}
                            onChange={(on) => void run(saveFriendSettings({ ...list.settings, showStudying: on }))}>
                            Show friends when I'm studying
                        </Switch>
                        <p className={cn(SMALL, "m-0 -mt-1.5 pl-6")}>They see the class you picked and how long you've been going.</p>
                    </div>
                </Panel>
                {msg && <Note tone="bad">{msg}</Note>}
            </div>
        </div>
    )
}

function AddFriends({ onMessage }: { onMessage: (m: string) => void }) {
    const [q, setQ] = useState("")
    const [people, setPeople] = useState<FriendMatch[]>([])
    const [err, setErr] = useState("")
    const asked = useRef(0)
    useEffect(() => {
        const n = ++asked.current
        if (q.trim().length < 2) { setPeople([]); setErr(""); return }
        const t = setTimeout(() => {
            void searchPeople(q).then((r) => { if (n === asked.current) { setPeople(r.people); setErr(r.error) } })
        }, SEARCH_WAIT_MS)
        return () => clearTimeout(t)
    }, [q])

    const add = async (p: FriendMatch) => {
        const m = await askFriend(p.username)
        onMessage(m)
        /* none becomes requested; asked (they asked you) becomes friends */
        if (!m) setPeople((all) => all.map((x) => (x.userId === p.userId ? { ...x, state: x.state === "asked" ? "friends" : "requested" } : x)))
    }

    return (
        <Panel title="Add friends" label="Add friends">
            <div className="flex flex-col gap-2.5 p-4">
                <TextInput type="search" aria-label="Name or username" placeholder="Name or username" value={q} maxLength={40}
                    autoComplete="off" onChange={(e) => setQ(e.target.value)} />
                {q.trim().length === 1 && <p className={cn(SMALL, "m-0")}>Keep typing: at least 2 letters.</p>}
                {err && <Note tone="bad">{err}</Note>}
                {q.trim().length >= 2 && !err && people.length === 0 && <p className={cn(SMALL, "m-0")}>Nobody matches. People hidden from search show up only for their exact username.</p>}
                <div>
                    {people.map((p) => (
                        <div key={p.userId} className={ROW}>
                            <Avatar p={p} />
                            <span className="flex min-w-[110px] flex-1 flex-col"><span>{p.name}</span><span className={SMALL}>@{p.username}</span></span>
                            {p.state === "none" && <Button aria-label={"Add " + p.name} onClick={() => void add(p)}>Add</Button>}
                            {p.state === "asked" && <Button aria-label={"Accept " + p.name} onClick={() => void add(p)}>Accept</Button>}
                            {p.state === "requested" && <span className={SMALL}>Requested</span>}
                            {p.state === "friends" && <span className={SMALL}>Friends</span>}
                        </div>
                    ))}
                </div>
            </div>
        </Panel>
    )
}

/* a checkbox the label names (fields.tsx's Checkbox has no label element) */
function Switch({ checked, onChange, children }: { checked: boolean; onChange: (on: boolean) => void; children: ReactNode }) {
    return (
        <label className="flex cursor-pointer items-center gap-2 text-[13px]">
            <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-3.5 accent-[var(--accent)]" />
            {children}
        </label>
    )
}

/* initials on a colour picked from the user id, so a person keeps theirs */
const COLORS = ["#4F74D9", "#8B5CC7", "#F08A6C", "#B8457E", "#4FBF8B", "#7D8A99", "#E8B33A", "#17B3AE"]
function Avatar({ p }: { p: FriendPerson }) {
    let h = 0
    for (const c of p.userId) h = (h * 31 + c.charCodeAt(0)) >>> 0
    const initials = p.name.split(/\s+/).map((w) => w[0] ?? "").join("").slice(0, 2).toUpperCase()
    return (
        <span aria-hidden="true" style={{ background: COLORS[h % COLORS.length] }}
            className="grid size-[30px] flex-none place-items-center rounded-full text-[12px] font-semibold text-white">
            {initials}
        </span>
    )
}
