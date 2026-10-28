// The Admin page's Maintenance tab: switch a feature off while you work on it. Everyone
// but admins then sees the maintenance page in its place (components/maintenance.tsx), from
// their next sync (GET /api/me); the Worker also refuses them Import with AI's reads and the
// shared classes' routes (worker/maintenance.js). Their data keeps syncing throughout.

import { useEffect, useId, useState } from "react"
import { api } from "@/core/api"
import { syncNow } from "@/core/sync"
import type { Feature } from "@/core/maintenance"
import { MESSAGE_MAX } from "@/core/shared"
import { toast } from "@/data/toast"
import { Panel, Empty } from "@/components/views/bits"
import { Button, Label, Note, TextArea } from "@/components/sheet/fields"
import { ago, problem, useLoad } from "./use-admin"
import type { MaintenanceState as Stored } from "@/core/types"

/* In the order the sidebar lists the pages; the whole app first. */
const SWITCHES: readonly [Feature, string, string][] = [
    ["app", "Whole app", "Every page and Import with AI. Signing in and Admin stay open."],
    ["week", "Week", ""],
    ["month", "Month", ""],
    ["table", "All items", ""],
    ["study", "Study", ""],
    ["spotify", "Music", ""],
    ["import", "Import with AI", "The sheet shows the message, and the AI reads are refused."],
    ["classes", "Shared classes & projects", "Their routes are refused; shared edits wait on each device and upload after."],
    ["friends", "Friends & study together", "The Friends tab shows the message, and its routes are refused."],
]
const NAME = Object.fromEntries(SWITCHES.map(([id, name]) => [id, name])) as Record<Feature, string>

export function MaintenanceTab() {
    const id = useId()
    const current = useLoad<{ maintenance: Stored }>(api.admin.maintenance)
    const stored = current.data?.maintenance
    const [on, setOn] = useState<Feature[]>([]), [message, setMessage] = useState("")
    const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null)
    /* the form starts from what is saved, and again after each save */
    useEffect(() => {
        if (!stored) return
        setOn(stored.features); setMessage(stored.message)
    }, [stored])

    const flip = (f: Feature, value: boolean) => setOn((list) => (value ? [...list, f] : list.filter((x) => x !== f)))
    const save = async () => {
        setBusy(true); setError(null)
        try {
            const order = SWITCHES.map(([f]) => f).filter((f) => on.includes(f))
            await api.admin.setMaintenance(order, message.trim())
            toast(order.length ? "Saved. Everyone else sees it within 5 minutes." : "Saved. Everything is back for everyone within 5 minutes.")
            await current.reload()
            void syncNow().catch(() => {})   /* your own bars, without waiting */
        } catch (e) { setError(problem(e)) }
        finally { setBusy(false) }
    }

    return (
        <div className="grid gap-4">
            <Panel title="In maintenance now">
                {current.error ? <Empty title="Couldn't load it">{current.error}</Empty>
                    : !stored ? <Empty>Loading…</Empty>
                    : !stored.features.length ? <Empty>Nothing is in maintenance.</Empty>
                    : (
                        <div className="grid gap-1.5 px-5 py-4">
                            <p className="m-0 text-[13.5px] font-medium text-foreground">On now: {stored.features.map((f) => NAME[f]).join(", ")}</p>
                            {stored.message && <p className="m-0 whitespace-pre-wrap text-[13px] text-ink-2">{stored.message}</p>}
                            {stored.updatedAt && <Note>Changed {ago(stored.updatedAt)}{stored.updatedBy ? " by " + stored.updatedBy : ""}</Note>}
                        </div>
                    )}
            </Panel>
            <Panel title="Switches">
                <form className="grid gap-3 px-5 py-4" onSubmit={(e) => { e.preventDefault(); void save() }}>
                    <p className="m-0 text-[12.5px] leading-normal text-ink-2">A feature switched on shows everyone else a maintenance page in its place. You keep using it, under a bar only admins see. Data keeps syncing. People already in the app see the change within 5 minutes.</p>
                    <ul className="m-0 grid list-none gap-0 p-0">
                        {SWITCHES.map(([f, name, hint]) => (
                            <li key={f} className="flex items-start gap-3 border-t border-border py-2.5 first:border-t-0">
                                <input id={id + f} type="checkbox" role="switch" checked={on.includes(f)} disabled={!stored}
                                    aria-describedby={hint ? id + f + "h" : undefined}
                                    onChange={(e) => flip(f, e.target.checked)}
                                    className={SWITCH} />
                                <span className="grid min-w-0 gap-0.5">
                                    <label htmlFor={id + f} className="cursor-pointer text-[13.5px] font-medium text-foreground">{name}</label>
                                    {hint && <span id={id + f + "h"} className="text-[12px] leading-snug text-muted-foreground">{hint}</span>}
                                </span>
                            </li>
                        ))}
                    </ul>
                    <div className="grid gap-1">
                        <Label htmlFor={id + "m"}>Message</Label>
                        <TextArea id={id + "m"} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={MESSAGE_MAX} rows={2}
                            placeholder="Optional. e.g. Music is getting a new player. Back by 9 pm." />
                        <Note>{message.length} / {MESSAGE_MAX} · empty shows “We’re fixing something here. Your data is safe and keeps syncing. Check back soon.”</Note>
                    </div>
                    {on.includes("app") && !stored?.features.includes("app") ? (
                        <div className="flex flex-wrap items-center gap-2">
                            <Note>Everyone except admins sees the maintenance page instead of the app, within 5 minutes.</Note>
                            <Button variant="danger" type="button" className="ml-auto h-8 px-3.5 text-[12.5px]" disabled={busy} onClick={() => void save()}>Turn on for everyone</Button>
                            <Button variant="ghost" type="button" className="h-8 px-3 text-[12.5px]" onClick={() => flip("app", false)}>Cancel</Button>
                        </div>
                    ) : (
                        <div className="flex items-center">
                            <Button type="submit" className="ml-auto h-8 px-3.5 text-[12.5px]" disabled={busy || !stored}>Save</Button>
                        </div>
                    )}
                    {error && <p role="alert" className="m-0 text-[12.5px] text-destructive">{error}</p>}
                </form>
            </Panel>
        </div>
    )
}

/* A toggle drawn from a checkbox: the track, and its knob that slides when on. */
const SWITCH = "relative mt-0.5 h-[18px] w-[30px] flex-none cursor-pointer appearance-none rounded-full bg-[color-mix(in_srgb,var(--ink)_18%,transparent)] transition-colors"
    + " before:absolute before:top-[2px] before:left-[2px] before:size-[14px] before:rounded-full before:bg-white before:shadow-[0_1px_2px_rgba(0,0,0,.25)] before:transition-transform before:content-['']"
    + " checked:bg-[var(--accent)] checked:before:translate-x-3 disabled:cursor-not-allowed disabled:opacity-50"
    + " focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
