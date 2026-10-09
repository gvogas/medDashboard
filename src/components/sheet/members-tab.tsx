// A class's Members tab (spec §11, §15): who is in it, invites by username, the join code,
// roles, removing someone, and handing the class on. Owners and editors invite. Only the owner
// gives another role, makes a code, changes roles, removes someone (who keeps a copy) and hands
// the class on. While the class is archived roles, removing and handing on still work; inviting,
// the code and withdrawing an invite do not, so the tab leaves them out. Leaving is in Details.
// Everything here needs a connection.

import { useCallback, useEffect, useState } from "react"
import { api } from "@/core/api"
import { syncNow } from "@/core/sync"
import { dayMonth, iso } from "@/core/dates"
import { useProfile } from "@/data/store"
import { formatCode, joinLink, messageFor } from "@/data/classes"
import { toast } from "@/data/toast"
import { removeMember } from "@/data/leave"
import type { JoinCode, SpaceDetails, SpaceInvite, SpaceMember } from "@/data/types"
import { Button, Note, Section, Select, TextInput } from "./fields"

type Reload = () => Promise<void>
const ROLE: Record<SpaceMember["role"], string> = { owner: "Owner", editor: "Editor", member: "Member" }
const STATUS: Record<SpaceInvite["status"], string> = { pending: "Pending", declined: "Declined", expired: "Expired" }
const day = (ms: number) => dayMonth(iso(new Date(ms)))
const LIST = "m-0 flex list-none flex-col gap-1 p-0"
const ROW = "flex items-center gap-2 rounded-lg bg-muted px-2.5 py-1.5 text-[12.5px]"

export function MembersTab({ spaceId }: { spaceId: string }) {
    const me = useProfile()?.id ?? ""
    const [info, setInfo] = useState<SpaceDetails | null>(null)
    const [error, setError] = useState("")
    const load = useCallback(async () => {
        try { setInfo(await api.spaces.get(spaceId)); setError("") } catch (e) { setError(messageFor(e)) }
    }, [spaceId])
    useEffect(() => { void load() }, [load])

    if (!info) return error ? <Note tone="bad">{error}</Note> : <Note>Loading the members…</Note>
    const owner = info.role === "owner", editor = info.role !== "member"
    const ownerName = info.members.find((m) => m.role === "owner")?.name ?? "the owner"
    const others = info.members.filter((m) => m.userId !== me)
    return (
        <>
            {/* the Worker refuses invites, codes, withdrawing, joining and accepting while the class is archived */}
            {info.archived
                ? <Note>The class is archived: nobody can join it, by invite or code. {owner ? "Unarchive it" : ownerName + " can unarchive it"} to invite people or make a join code.</Note>
                : editor
                    ? <InviteBox spaceId={spaceId} owner={owner} standard={info.kind === "class" ? "member" : "editor"} reload={load} />
                    : <Note>Owners and editors invite people. Ask {ownerName} for a join code.</Note>}
            {editor && info.invites.length > 0 && <InviteList spaceId={spaceId} invites={info.invites} owner={owner} me={me} archived={info.archived} reload={load} />}
            {owner && !info.archived && <CodeBox spaceId={spaceId} code={info.code} reload={load} />}
            <MemberList spaceId={spaceId} members={info.members} owner={owner} me={me} reload={load} />
            {owner && others.length > 0 && <HandOn spaceId={spaceId} members={others} reload={load} />}
            {error && <Note tone="bad">{error}</Note>}
        </>
    )
}

function InviteBox({ spaceId, owner, standard, reload }: { spaceId: string; owner: boolean; standard: "member" | "editor"; reload: Reload }) {
    const [name, setName] = useState("")
    const [role, setRole] = useState<"member" | "editor">(standard)
    const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null)
    const [busy, setBusy] = useState(false)
    const send = async () => {
        const username = name.trim().toLowerCase().replace(/^@/, "")
        if (!username) { setSaid({ ok: false, text: "Type a username." }); return }
        setBusy(true)
        try {
            const sent = await api.spaces.invite(spaceId, username, role)
            setSaid({ ok: true, text: "Invited " + sent.name + ". They'll see it under Invites in Term." })
            setName("")
            await reload()
        } catch (e) { setSaid({ ok: false, text: messageFor(e, username) }) }
        finally { setBusy(false) }
    }
    return (
        <Section title="Invite by username">
            <div className="flex gap-2">
                <TextInput aria-label="Username" className="min-w-0 flex-1" value={name} maxLength={33} placeholder="e.g. morgan" autoComplete="off"
                    onChange={(e) => { setName(e.target.value); setSaid(null) }}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void send() } }} />
                {owner && (
                    <Select aria-label="Invite as" value={role} className="w-auto" onChange={(e) => setRole(e.target.value as "member" | "editor")}>
                        <option value="member">Member</option>
                        <option value="editor">Editor</option>
                    </Select>
                )}
                <Button disabled={busy} onClick={() => void send()}>Invite</Button>
            </div>
            {said ? <Note tone={said.ok ? "ok" : "bad"}>{said.text}</Note> : <Note>Accounts are made by the admin; invites never send email.</Note>}
        </Section>
    )
}

function InviteList({ spaceId, invites, owner, me, archived, reload }: { spaceId: string; invites: SpaceInvite[]; owner: boolean; me: string; archived: boolean; reload: Reload }) {
    const [err, setErr] = useState("")
    const withdraw = async (userId: string) => {
        try { await api.spaces.revokeInvite(spaceId, userId); setErr(""); await reload() } catch (e) { setErr(messageFor(e)) }
    }
    return (
        <Section title="Invited">
            <ul className={LIST}>
                {invites.map((v) => (
                    <li key={v.userId} className={ROW}>
                        <span className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate">{v.name}</span>
                            <span className="text-[11px] text-muted-foreground">Invited {day(v.createdAt)} · as {v.role}</span>
                        </span>
                        <span className="text-[11px] text-muted-foreground">{STATUS[v.status]}</span>
                        {!archived && (owner || v.invitedBy === me) && (
                            <Button variant="ghost" aria-label={"Withdraw the invite to " + v.name} onClick={() => void withdraw(v.userId)}>Withdraw</Button>
                        )}
                    </li>
                ))}
            </ul>
            {err && <Note tone="bad">{err}</Note>}
        </Section>
    )
}

function CodeBox({ spaceId, code, reload }: { spaceId: string; code: SpaceDetails["code"]; reload: Reload }) {
    const [made, setMade] = useState<JoinCode | null>(null)
    const [err, setErr] = useState("")
    const make = async () => {
        try { setMade(await api.spaces.makeCode(spaceId)); setErr(""); await reload() } catch (e) { setErr(messageFor(e)) }
    }
    const drop = async () => {
        try { await api.spaces.dropCode(spaceId); setMade(null); setErr(""); await reload() } catch (e) { setErr(messageFor(e)) }
    }
    const copy = (text: string) => {
        void navigator.clipboard?.writeText(text).then(() => toast("Copied."), () => toast("Copying failed: select it instead."))
    }
    return (
        <Section title="Join code">
            {made ? <>
                <Note>Valid 7 days, for up to 10 people. It shows only now: copy it.</Note>
                <span className="font-mono text-[20px] font-semibold tracking-[.12em]">{formatCode(made.code)}</span>
                <span className="font-mono text-[11px] break-all text-muted-foreground">{joinLink(made.code)}</span>
                <div className="flex flex-wrap gap-2">
                    <Button variant="ghost" onClick={() => copy(formatCode(made.code))}>Copy code</Button>
                    <Button variant="ghost" onClick={() => copy(joinLink(made.code))}>Copy link</Button>
                    <Button variant="ghost" onClick={() => void make()}>Make a new one</Button>
                    <Button variant="ghost" onClick={() => void drop()}>Turn off</Button>
                </div>
            </> : code ? <>
                <Note>A join code works until {day(code.expires)}, for {code.usesLeft} more {code.usesLeft === 1 ? "person" : "people"}. Only its hash is kept: make a new one to see a code again.</Note>
                <div className="flex flex-wrap gap-2">
                    <Button variant="ghost" onClick={() => void make()}>Make a new one</Button>
                    <Button variant="ghost" onClick={() => void drop()}>Turn off</Button>
                </div>
            </> : <>
                <Note>Anyone with the code can join as a member for 7 days. A new code retires the old one.</Note>
                <Button variant="ghost" className="self-start" onClick={() => void make()}>Make a join code</Button>
            </>}
            {err && <Note tone="bad">{err}</Note>}
        </Section>
    )
}

function MemberList({ spaceId, members, owner, me, reload }: { spaceId: string; members: SpaceMember[]; owner: boolean; me: string; reload: Reload }) {
    const [err, setErr] = useState("")
    const [removing, setRemoving] = useState<SpaceMember | null>(null)
    const [busy, setBusy] = useState(false)
    const remove = async (m: SpaceMember) => {
        setBusy(true)
        try { await removeMember(spaceId, m.userId); setRemoving(null); setErr(""); await reload() } catch (e) { setErr(messageFor(e)) } finally { setBusy(false) }
    }
    const change = async (userId: string, role: string) => {
        try { await api.spaces.setRole(spaceId, userId, role); setErr(""); await reload(); void syncNow() } catch (e) { setErr(messageFor(e)) }
    }
    return (
        <Section title="Members" note={String(members.length)}>
            <ul className={LIST}>
                {members.map((m) => (
                    <li key={m.userId} className={ROW}>
                        <span className="min-w-0 flex-1 truncate">{m.name}{m.userId === me && <span className="text-muted-foreground"> (you)</span>}</span>
                        {owner && m.role !== "owner" ? (
                            <Select aria-label={"Role for " + m.name} value={m.role} className="w-auto" onChange={(e) => void change(m.userId, e.target.value)}>
                                <option value="editor">Editor</option>
                                <option value="member">Member</option>
                            </Select>
                        ) : <span className="text-[11px] font-semibold text-muted-foreground">{ROLE[m.role]}</span>}
                        {owner && m.role !== "owner" && m.userId !== me && (
                            <Button variant="ghost" aria-label={"Remove " + m.name} onClick={() => setRemoving(m)}>Remove</Button>
                        )}
                    </li>
                ))}
            </ul>
            {removing && (
                <div className="flex flex-wrap items-center gap-2">
                    <Note>Remove {removing.name}? They keep a copy of the class as their own course.</Note>
                    <Button variant="ghost" onClick={() => setRemoving(null)}>Cancel</Button>
                    <Button variant="danger" disabled={busy} onClick={() => void remove(removing)}>Remove {removing.name} from the class</Button>
                </div>
            )}
            {err && <Note tone="bad">{err}</Note>}
        </Section>
    )
}

function HandOn({ spaceId, members, reload }: { spaceId: string; members: SpaceMember[]; reload: Reload }) {
    const [to, setTo] = useState("")
    const [asking, setAsking] = useState(false)
    const [err, setErr] = useState("")
    const who = members.find((m) => m.userId === to)
    const go = async () => {
        try { await api.spaces.transfer(spaceId, to); setAsking(false); setErr(""); await reload(); void syncNow() } catch (e) { setErr(messageFor(e)) }
    }
    return (
        <Section title="Hand the class on">
            <div className="flex gap-2">
                <Select aria-label="New owner" value={to} className="min-w-0 flex-1" onChange={(e) => { setTo(e.target.value); setAsking(false) }}>
                    <option value="">Choose a member…</option>
                    {members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
                </Select>
                <Button variant="ghost" disabled={!who} onClick={() => setAsking(true)}>Make owner</Button>
            </div>
            {asking && who && (
                <div className="flex flex-wrap items-center gap-2">
                    <Note>Make {who.name} the owner? You become an editor.</Note>
                    <Button variant="ghost" onClick={() => setAsking(false)}>Cancel</Button>
                    <Button variant="danger" onClick={() => void go()}>Make {who.name} owner</Button>
                </div>
            )}
            {err && <Note tone="bad">{err}</Note>}
        </Section>
    )
}
