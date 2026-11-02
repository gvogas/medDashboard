// The Admin page's Accounts tab: a form for a new account, every account with what it
// holds and when it was last seen, and the actions on one (a new password, sign out
// everywhere, admin on or off, delete). Delete asks for the username typed out. Below,
// the names locked by failed sign-ins, each with Unlock. The Worker keeps the guards
// (not yourself, never the last admin); this page only explains what it said.

import { useId, useState, type ComponentProps, type FormEvent, type ReactNode } from "react"
import { cn } from "@/lib/utils"
import { api } from "@/core/api"
import { useProfile } from "@/data/store"
import { toast } from "@/data/toast"
import { Panel, HeadNote, Empty } from "@/components/views/bits"
import { Button, Checkbox, Label, Note, TextInput } from "@/components/sheet/fields"
import { GRANT_MAX } from "@/core/buddy-rules"
import { problem, useLoad, when } from "./use-admin"
import type { AdminAccount as Account, AdminAccounts as List, AdminLock as Lock } from "@/core/types"

export type { Account }


export function Accounts() {
    const list = useLoad<List>(api.admin.accounts)
    const me = useProfile()?.id
    return (
        <div className="grid gap-4">
            <CreateAccount onCreated={list.reload} />
            <Panel title="Accounts" head={<>
                {list.data && <HeadNote>{list.data.accounts.length}</HeadNote>}
                <Button variant="ghost" className="h-7 px-2.5 text-[12px]" onClick={() => void list.reload()} disabled={list.loading}>Refresh</Button>
            </>}>
                {list.error ? <Empty title="Couldn't load accounts">{list.error}</Empty>
                    : !list.data ? <Empty>Loading…</Empty>
                    : <AccountTable accounts={list.data.accounts} me={me} onChanged={list.reload} />}
            </Panel>
            <Locks locks={list.data?.locks ?? null} onChanged={list.reload} />
        </div>
    )
}

/* ── a new account ── */

function CreateAccount({ onCreated }: { onCreated: () => Promise<void> }) {
    const id = useId()
    const [username, setUsername] = useState(""), [displayName, setDisplayName] = useState("")
    const [password, setPassword] = useState(""), [admin, setAdmin] = useState(false)
    const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [made, setMade] = useState<string | null>(null)
    const submit = async (e: FormEvent) => {
        e.preventDefault()
        setBusy(true); setError(null); setMade(null)
        try {
            const res = await api.admin.create({ username, displayName, password, admin })
            setMade(res.username)
            setUsername(""); setDisplayName(""); setPassword(""); setAdmin(false)
            await onCreated()
        } catch (err) {
            setError(problem(err))
        } finally {
            setBusy(false)
        }
    }
    return (
        <Panel title="New account">
            <form onSubmit={submit} className="grid gap-3 px-5 py-4">
                <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
                    <Field label="Username" htmlFor={id + "u"}>
                        <TextInput id={id + "u"} value={username} onChange={(e) => setUsername(e.target.value)} required autoComplete="off" spellCheck={false} maxLength={32} placeholder="e.g. sam.lee" />
                    </Field>
                    <Field label="Display name (optional)" htmlFor={id + "d"}>
                        <TextInput id={id + "d"} value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={60} />
                    </Field>
                    <Field label="Password" htmlFor={id + "p"}>
                        <TextInput id={id + "p"} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} maxLength={200} autoComplete="new-password" />
                    </Field>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    <Checkbox id={id + "a"} checked={admin} onChange={setAdmin}>Admin (can open this page)</Checkbox>
                    <Button type="submit" className="ml-auto h-8 px-3.5 text-[12.5px]" disabled={busy || !username || password.length < 8}>{busy ? "Creating…" : "Create account"}</Button>
                </div>
                {error && <p role="alert" className="m-0 text-[12.5px] text-destructive">{error}</p>}
                {made && <Note tone="ok">Created {made}. Share the password with them privately; they can sign in now.</Note>}
            </form>
        </Panel>
    )
}

const Field = ({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) => (
    <div className="grid gap-1"><Label htmlFor={htmlFor}>{label}</Label>{children}</div>
)

/* ── the list ── */

const hours = (min: number) => (min >= 60 ? Math.round(min / 6) / 10 + " h" : min + " min")
const today = () => new Date().toISOString().slice(0, 10)
function seen(day: string | null) {
    if (!day) return "never"
    if (day === today()) return "today"
    const days = Math.round((Date.parse(today()) - Date.parse(day)) / 86_400_000)
    return days === 1 ? "yesterday" : days + " days ago"
}

type Action = { id: string; kind: "password" | "delete" | "admin" | "revoke" | "grant" } | null

function AccountTable({ accounts, me, onChanged }: { accounts: Account[]; me: string | undefined; onChanged: () => Promise<void> }) {
    const [open, setOpen] = useState<Action>(null)
    const [busy, setBusy] = useState<string | null>(null)
    const run = async (key: string, call: () => Promise<unknown>, done: string) => {
        setBusy(key)
        try {
            await call()
            toast(done)
            setOpen(null)
            await onChanged()
        } catch (e) {
            toast(problem(e), { error: true })
        } finally {
            setBusy(null)
        }
    }
    if (!accounts.length) return <Empty>No accounts yet.</Empty>
    const TH = "px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[.04em] text-muted-foreground"
    return (
        <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-[13px]">
                <thead className="border-b border-border">
                    <tr>
                        <th scope="col" className={cn(TH, "pl-5")}>Account</th>
                        <th scope="col" className={TH}>Last seen</th>
                        <th scope="col" className={cn(TH, "text-right")}>Courses</th>
                        <th scope="col" className={cn(TH, "text-right")}>Items</th>
                        <th scope="col" className={cn(TH, "text-right")}>Studied</th>
                        <th scope="col" className={TH}>Using</th>
                        <th scope="col" className={cn(TH, "pr-5 text-right")}><span className="sr-only">Actions</span></th>
                    </tr>
                </thead>
                <tbody>
                    {accounts.map((a) => {
                        const self = a.id === me
                        const using = [a.spotify && "Spotify", a.feed && "Calendar feed", a.leaderboard && "Leaderboard"].filter(Boolean).join(", ")
                        return [
                            <tr key={a.id} className="border-b border-border last:border-b-0">
                                <td className="py-2.5 pl-5 pr-3">
                                    <div className="flex items-center gap-1.5">
                                        <span className="font-medium text-foreground">{a.username}</span>
                                        {a.admin && <span className="rounded-full bg-muted px-1.5 py-px text-[10.5px] font-semibold text-accent-foreground">admin</span>}
                                        {self && <span className="text-[11px] text-muted-foreground">(you)</span>}
                                    </div>
                                    {a.displayName && <div className="text-[11.5px] text-muted-foreground">{a.displayName}</div>}
                                </td>
                                <td className="px-3 py-2.5 text-ink-2" title={"Created " + when(a.createdAt)}>{seen(a.lastSeen)}</td>
                                <td className="px-3 py-2.5 text-right font-mono text-[12px]">{a.courses}</td>
                                <td className="px-3 py-2.5 text-right font-mono text-[12px]">{a.items}</td>
                                <td className="px-3 py-2.5 text-right font-mono text-[12px]">{hours(a.studyMinutes)}</td>
                                <td className="px-3 py-2.5 text-[12px] text-ink-2">{using || "—"}</td>
                                <td className="py-2 pl-3 pr-5">
                                    <div className="flex flex-wrap justify-end gap-1">
                                        {!self && <Small onClick={() => setOpen(open?.id === a.id && open.kind === "password" ? null : { id: a.id, kind: "password" })} aria-expanded={open?.id === a.id && open.kind === "password"} aria-label={"New password " + a.username}>New password</Small>}
                                        {!self && <Small onClick={() => setOpen(open?.id === a.id && open.kind === "revoke" ? null : { id: a.id, kind: "revoke" })} aria-expanded={open?.id === a.id && open.kind === "revoke"} aria-label={"Sign out " + a.username}>Sign out</Small>}
                                        {!self && <Small onClick={() => setOpen(open?.id === a.id && open.kind === "admin" ? null : { id: a.id, kind: "admin" })} aria-expanded={open?.id === a.id && open.kind === "admin"}>{a.admin ? "Remove admin" : "Make admin"}</Small>}
                                        <Small onClick={() => setOpen(open?.id === a.id && open.kind === "grant" ? null : { id: a.id, kind: "grant" })} aria-expanded={open?.id === a.id && open.kind === "grant"} aria-label={"Grant coins or XP to " + a.username}>Grant</Small>
                                        {!self && <Small danger onClick={() => setOpen(open?.id === a.id && open.kind === "delete" ? null : { id: a.id, kind: "delete" })} aria-expanded={open?.id === a.id && open.kind === "delete"} aria-label={"Delete " + a.username}>Delete</Small>}
                                    </div>
                                </td>
                            </tr>,
                            open?.id === a.id && (
                                <tr key={a.id + "-act"} className="border-b border-border bg-muted/40">
                                    <td colSpan={7} className="px-5 py-3">
                                        {open.kind === "password"
                                            ? <NewPassword account={a} busy={busy === a.id + "p"} onCancel={() => setOpen(null)}
                                                onSave={(pw) => run(a.id + "p", () => api.admin.resetPassword(a.id, pw), "New password set for " + a.username + ". They're signed out everywhere.")} />
                                            : open.kind === "delete"
                                            ? <ConfirmDelete account={a} busy={busy === a.id + "d"} onCancel={() => setOpen(null)}
                                                onDelete={(typed) => run(a.id + "d", () => api.admin.remove(a.id, typed), a.username + " and their data were deleted.")} />
                                            : open.kind === "grant"
                                            ? <Grant account={a} busy={busy === a.id + "g"} onCancel={() => setOpen(null)}
                                                onGrant={(g) => run(a.id + "g", () => api.buddy.grant(a.id, g), "Granted to " + a.username + ".")} />
                                            : open.kind === "admin"
                                            ? <Confirm busy={busy === a.id + "a"} onCancel={() => setOpen(null)} label={a.admin ? "Remove admin" : "Make admin"}
                                                text={a.admin ? a.username + " loses access to this Admin page and to changing accounts." : a.username + " can open this Admin page and change accounts."}
                                                onConfirm={() => run(a.id + "a", () => api.admin.setAdmin(a.id, !a.admin), a.admin ? a.username + " is no longer an admin." : a.username + " is now an admin.")} />
                                            : <Confirm busy={busy === a.id + "r"} onCancel={() => setOpen(null)} label="Sign out everywhere"
                                                text={a.username + " is signed out on every device. Their data stays."}
                                                onConfirm={() => run(a.id + "r", () => api.admin.revoke(a.id), a.username + " is signed out everywhere.")} />}
                                    </td>
                                </tr>
                            ),
                        ]
                    })}
                </tbody>
            </table>
        </div>
    )
}

const Small = ({ danger = false, className, ...props }: ComponentProps<"button"> & { danger?: boolean }) => (
    <button type="button" {...props} className={cn(
        "h-7 cursor-pointer rounded-md border border-border bg-transparent px-2 font-[inherit] text-[12px] text-ink-2 hover:bg-muted hover:text-foreground disabled:cursor-default disabled:opacity-50",
        danger && "text-destructive hover:text-destructive", className)} />
)

function NewPassword({ account, busy, onSave, onCancel }: { account: Account; busy: boolean; onSave: (pw: string) => Promise<void>; onCancel: () => void }) {
    const id = useId()
    const [pw, setPw] = useState("")
    return (
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void onSave(pw) }}>
            <div className="grid min-w-[220px] flex-1 gap-1">
                <Label htmlFor={id}>New password for {account.username}</Label>
                <TextInput id={id} type="password" value={pw} onChange={(e) => setPw(e.target.value)} minLength={8} maxLength={200} autoComplete="new-password" autoFocus />
                <Note>{pw.length < 8 ? `Set password stays off until it has at least 8 characters (${pw.length} so far).` : "8 to 200 characters."}</Note>
            </div>
            <Button type="submit" className="h-8 px-3 text-[12.5px]" disabled={busy || pw.length < 8}>Set password</Button>
            <Button variant="ghost" className="h-8 px-3 text-[12.5px]" onClick={onCancel}>Cancel</Button>
            <Note>This signs them out on every device.</Note>
        </form>
    )
}

/* Study Buddy, for testing: coins (1–5,000) and/or XP (0–10,000, replacing the last XP grant). */
function Grant({ account, busy, onGrant, onCancel }: { account: Account; busy: boolean; onGrant: (g: { coins?: number; xp?: number }) => Promise<void>; onCancel: () => void }) {
    const id = useId()
    const [coins, setCoins] = useState(""), [xp, setXp] = useState("")
    const whole = (v: string, min: number, max: number) => v === "" ? undefined : Number.isInteger(+v) && +v >= min && +v <= max ? +v : NaN
    const c = whole(coins, 1, GRANT_MAX.coins), x = whole(xp, 0, GRANT_MAX.xp)
    const ok = !Number.isNaN(c) && !Number.isNaN(x) && (c !== undefined || x !== undefined)
    return (
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (ok) void onGrant({ ...(c !== undefined ? { coins: c } : {}), ...(x !== undefined ? { xp: x } : {}) }) }}>
            <div className="grid w-32 gap-1">
                <Label htmlFor={id + "c"}>Coins</Label>
                <TextInput id={id + "c"} type="number" inputMode="numeric" min={1} max={GRANT_MAX.coins} value={coins} onChange={(e) => setCoins(e.target.value)} autoFocus />
            </div>
            <div className="grid w-32 gap-1">
                <Label htmlFor={id + "x"}>XP</Label>
                <TextInput id={id + "x"} type="number" inputMode="numeric" min={0} max={GRANT_MAX.xp} value={xp} onChange={(e) => setXp(e.target.value)} />
            </div>
            <Button type="submit" className="h-8 px-3 text-[12.5px]" disabled={busy || !ok}>Grant</Button>
            <Button variant="ghost" className="h-8 px-3 text-[12.5px]" onClick={onCancel}>Cancel</Button>
            <Note>For testing {account.username}'s Study Buddy: coins 1 to {GRANT_MAX.coins.toLocaleString()}; XP 0 to {GRANT_MAX.xp.toLocaleString()} replaces the last XP grant. Recorded in the audit log.</Note>
        </form>
    )
}

function ConfirmDelete({ account, busy, onDelete, onCancel }: { account: Account; busy: boolean; onDelete: (typed: string) => Promise<void>; onCancel: () => void }) {
    const id = useId()
    const [typed, setTyped] = useState("")
    return (
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void onDelete(typed) }}>
            <div className="grid min-w-[220px] flex-1 gap-1">
                <Label htmlFor={id}>Type <b>{account.username}</b> to delete the account and its {account.courses} courses, {account.items} items and study history. This can't be undone.</Label>
                <TextInput id={id} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} autoFocus />
            </div>
            <Button variant="danger" type="submit" className="h-8 px-3 text-[12.5px]" disabled={busy || typed !== account.username}>Delete forever</Button>
            <Button variant="ghost" className="h-8 px-3 text-[12.5px]" onClick={onCancel}>Cancel</Button>
        </form>
    )
}

function Confirm({ text, label, busy, onConfirm, onCancel }: { text: string; label: string; busy: boolean; onConfirm: () => Promise<void>; onCancel: () => void }) {
    return (
        <div className="flex flex-wrap items-center gap-2">
            <Note>{text}</Note>
            <Button type="button" className="ml-auto h-8 px-3 text-[12.5px]" disabled={busy} onClick={() => void onConfirm()}>{label}</Button>
            <Button variant="ghost" className="h-8 px-3 text-[12.5px]" onClick={onCancel}>Cancel</Button>
        </div>
    )
}

/* ── locked sign-ins ── */

function Locks({ locks, onChanged }: { locks: Lock[] | null; onChanged: () => Promise<void> }) {
    const [busy, setBusy] = useState<string | null>(null)
    if (!locks) return null
    const unlock = async (key: string) => {
        setBusy(key)
        try { await api.admin.unlock(key); toast("Unlocked."); await onChanged() }
        catch (e) { toast(problem(e), { error: true }) }
        finally { setBusy(null) }
    }
    return (
        <Panel title="Locked sign-ins" head={<HeadNote>after 5 wrong passwords</HeadNote>}>
            {!locks.length ? <Empty>No one is locked out.</Empty> : (
                <ul className="m-0 list-none p-0">
                    {locks.map((l) => (
                        <li key={l.key} className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-2.5 text-[13px] last:border-b-0">
                            <span className="font-medium text-foreground">{l.username}</span>
                            <span className="text-[12px] text-ink-2">{l.device ? "on one browser they used before" : "from anywhere new"} · {l.fails} tries · until {when(l.lockedUntil)}</span>
                            <Small className="ml-auto" disabled={busy === l.key} onClick={() => void unlock(l.key)}>Unlock</Small>
                        </li>
                    ))}
                </ul>
            )}
        </Panel>
    )
}

