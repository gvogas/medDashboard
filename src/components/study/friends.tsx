// The Friends tab on the Study page (study together, spec §1): your friends, requests to and
// from you, Add friends (search), and the two switches. Loads when it opens and the list is
// missing or a minute old. While friends are switched off, the maintenance page.

import { useEffect, useId, useRef, useState, type ReactNode } from "react"
import { cn } from "@/lib/utils"
import { Panel } from "@/components/views/bits"
import { Button, Note, TextInput } from "@/components/sheet/fields"
import { MaintenanceBar, MaintenancePage } from "@/components/maintenance"
import { useMaintenance } from "@/data/maintenance"
import { useScreen } from "@/data/signin"
import { answerRequest, askFriend, friendsNow, friendsStale, loadFriends, removeFriend, saveFriendSettings, searchPeople, useFriends } from "@/data/friends"
import type { FriendMatch, FriendPerson, FriendState, Friends as FriendList } from "@/data/types"

const ROW = "flex flex-wrap items-center gap-3 border-b border-line-2 py-2.5 last:border-b-0"
const SMALL = "text-[12.5px] text-muted-foreground"
const SEARCH_WAIT_MS = 300

export function FriendsCard() {
    const maintenance = useMaintenance("friends")
    if (maintenance === "blocked") return <MaintenancePage feature="friends" />
    return <Friends bar={maintenance === "admin"} />
}

/** An error the screen reader hears when it appears. */
const Alert = ({ children }: { children: ReactNode }) => <div role="alert"><Note tone="bad">{children}</Note></div>

function Friends({ bar }: { bar: boolean }) {
    const { list, offline, error } = useFriends()
    const screen = useScreen()
    const [msg, setMsg] = useState("")
    const [busy, setBusy] = useState(false)
    /* the friend whose Remove is waiting for a yes */
    const [asking, setAsking] = useState<string | null>(null)
    useEffect(() => { if (screen === "app" && friendsStale()) void loadFriends() }, [screen])
    useEffect(() => {
        const online = () => { if (friendsNow().offline) void loadFriends() }
        window.addEventListener("online", online)
        return () => window.removeEventListener("online", online)
    }, [])

    /* one change at a time; its error shows below */
    const run = async (p: Promise<string>) => {
        setBusy(true); setMsg("")
        setMsg(await p)
        setBusy(false)
    }
    const off = busy || offline

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
                            {asking === f.userId ? (
                                <span className="flex flex-wrap items-center gap-1.5">
                                    <span className={SMALL}>Remove {f.name}?</span>
                                    <Button variant="danger" disabled={off} aria-label={"Confirm removing " + f.name}
                                        onClick={() => { setAsking(null); void run(removeFriend(f.userId)) }}>Remove</Button>
                                    <Button variant="ghost" onClick={() => setAsking(null)}>Keep</Button>
                                </span>
                            ) : (
                                <Button variant="ghost" disabled={off} aria-label={"Remove " + f.name} onClick={() => setAsking(f.userId)}>Remove</Button>
                            )}
                        </div>
                    ))}
                </div>
            </Panel>
            <div className="flex min-w-0 flex-col gap-4">
                <AddFriends list={list} off={off} run={run} />
                {(list.incoming.length > 0 || list.sent.length > 0) && (
                    <Panel title="Requests" label="Requests">
                        <div className="px-4 py-1.5">
                            {list.incoming.map((r) => (
                                <div key={r.userId} className={ROW}>
                                    <Avatar p={r} />
                                    <span className="flex min-w-[120px] flex-1 flex-col"><span>{r.name}</span><span className={SMALL}>Wants to be friends</span></span>
                                    <span className="flex gap-1.5">
                                        <Button disabled={off} aria-label={"Accept " + r.name} onClick={() => void run(answerRequest(r.userId, true))}>Accept</Button>
                                        <Button variant="ghost" disabled={off} aria-label={"Decline " + r.name} onClick={() => void run(answerRequest(r.userId, false))}>Decline</Button>
                                    </span>
                                </div>
                            ))}
                            {list.sent.map((r) => (
                                <div key={r.userId} className={ROW}>
                                    <Avatar p={r} />
                                    <span className="flex min-w-[120px] flex-1 flex-col"><span>{r.name}</span><span className={SMALL}>You asked</span></span>
                                    <Button variant="ghost" disabled={off} aria-label={"Cancel the request to " + r.name} onClick={() => void run(removeFriend(r.userId))}>Cancel</Button>
                                </div>
                            ))}
                        </div>
                    </Panel>
                )}
                <Panel title="Privacy" label="Privacy">
                    <div className="flex flex-col gap-3 p-4">
                        <Switch checked={list.settings.findable} disabled={off}
                            about={list.settings.findable ? "Your name and username show in Add friends." : "Only someone who types your exact username can find you."}
                            onChange={(on) => void run(saveFriendSettings({ ...list.settings, findable: on }))}>
                            Let people find me in search
                        </Switch>
                        <Switch checked={list.settings.showStudying} disabled={off}
                            about="They see the class you picked and how long you've been going."
                            onChange={(on) => void run(saveFriendSettings({ ...list.settings, showStudying: on }))}>
                            Show friends when I'm studying
                        </Switch>
                    </div>
                </Panel>
                {msg && <Alert>{msg}</Alert>}
            </div>
        </div>
    )
}

/** Where you stand with someone: what the list says when it has them, else what the search said. */
function stateOf(p: FriendMatch, list: FriendList): FriendState {
    if (list.friends.some((x) => x.userId === p.userId)) return "friends"
    if (list.sent.some((x) => x.userId === p.userId)) return "requested"
    if (list.incoming.some((x) => x.userId === p.userId)) return "asked"
    return "none"
}

function AddFriends({ list, off, run }: { list: FriendList; off: boolean; run: (p: Promise<string>) => Promise<void> }) {
    const [q, setQ] = useState("")
    const [people, setPeople] = useState<FriendMatch[]>([])
    const [err, setErr] = useState("")
    const asked = useRef(0)
    const word = q.trim()
    useEffect(() => {
        const n = ++asked.current
        if (word.length < 2) { setPeople([]); setErr(""); return }
        const t = setTimeout(() => {
            void searchPeople(word).then((r) => { if (n === asked.current) { setPeople(r.people); setErr(r.error) } })
        }, SEARCH_WAIT_MS)
        return () => clearTimeout(t)
    }, [word])

    /* none becomes requested and asked becomes friends, as the list now says */
    const add = (p: FriendMatch) => run(askFriend(p.username))

    return (
        <Panel title="Add friends" label="Add friends">
            <div className="flex flex-col gap-2.5 p-4">
                <TextInput type="search" aria-label="Name or username" placeholder="Name or username" value={q} maxLength={40}
                    autoComplete="off" onChange={(e) => setQ(e.target.value)} />
                {word.length === 1 && <p className={cn(SMALL, "m-0")}>Keep typing: at least 2 letters.</p>}
                {err && <Alert>{err}</Alert>}
                {word.length >= 2 && !err && people.length === 0 && <p className={cn(SMALL, "m-0")}>Nobody matches. People hidden from search show up only for their exact username.</p>}
                <div>
                    {people.map((p) => {
                        const state = stateOf(p, list)
                        return (
                            <div key={p.userId} className={ROW}>
                                <Avatar p={p} />
                                <span className="flex min-w-[110px] flex-1 flex-col"><span>{p.name}</span><span className={SMALL}>@{p.username}</span></span>
                                {state === "none" && <Button disabled={off} aria-label={"Add " + p.name} onClick={() => void add(p)}>Add</Button>}
                                {state === "asked" && <Button disabled={off} aria-label={"Accept " + p.name} onClick={() => void add(p)}>Accept</Button>}
                                {state === "requested" && <span className={SMALL}>Requested</span>}
                                {state === "friends" && <span className={SMALL}>Friends</span>}
                            </div>
                        )
                    })}
                </div>
            </div>
        </Panel>
    )
}

/* a checkbox the label names (fields.tsx's Checkbox has no label element), with its explanation */
function Switch({ checked, disabled, about, onChange, children }: { checked: boolean; disabled: boolean; about: string; onChange: (on: boolean) => void; children: ReactNode }) {
    const note = useId()
    return (
        <div className="flex flex-col gap-1">
            <label className="flex cursor-pointer items-center gap-2 text-[13px]">
                <input type="checkbox" checked={checked} disabled={disabled} aria-describedby={note} onChange={(e) => onChange(e.target.checked)} className="size-3.5 accent-[var(--accent)]" />
                {children}
            </label>
            <p id={note} className={cn(SMALL, "m-0 pl-6")}>{about}</p>
        </div>
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
