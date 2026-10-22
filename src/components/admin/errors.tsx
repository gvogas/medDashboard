// The Admin page's Errors tab: everything in the error log (worker/errors.js) for the last 7
// days, in four kinds: server failures, refused requests (4xx), crashes in people's browsers
// and nightly jobs that failed. The same failure is grouped once with its count, then the
// latest ones one by one. Kept 30 days; each kind writes at most its cap a day, the rest only
// reach Workers Logs.

import { useState } from "react"
import { api } from "@/core/api"
import { cn } from "@/lib/utils"
import { Panel, HeadNote, Empty } from "@/components/views/bits"
import { Button } from "@/components/sheet/fields"
import { ago, useLoad, when } from "./use-admin"

type Kind = "server" | "request" | "browser" | "nightly"
interface Group { kind: Kind; method: string; route: string; status: number; message: string; count: number; last: number; first: number; users: number }
interface One { at: number; kind: Kind; method: string; route: string; status: number; message: string; username: string | null }

const KINDS: readonly [Kind | "all", string][] = [["all", "All"], ["server", "Server"], ["request", "Requests (4xx)"], ["browser", "Browser"], ["nightly", "Nightly jobs"]]
const EMPTY: Record<Kind | "all", string> = {
    all: "Nothing has failed in the last 7 days.",
    server: "No server failures in the last 7 days.",
    request: "No refused requests in the last 7 days.",
    browser: "No crashes in anyone's browser in the last 7 days.",
    nightly: "Every nightly job ran cleanly in the last 7 days.",
}
/* a 4xx is often expected (signed out, rate limited): amber, not red */
const tone = (k: Kind) => (k === "request" ? "var(--warn)" : "var(--crit)")
/* the badge: the status, or what caught it */
const badge = (e: { kind: Kind; status: number }) => (e.kind === "browser" ? "browser" : e.kind === "nightly" ? "nightly" : String(e.status))
const what = (e: { kind: Kind; method: string; route: string }) => (e.kind === "browser" ? "page " + (e.route || "—") : e.kind === "nightly" ? e.route : e.method + " " + (e.route || "—"))

export function Errors() {
    const list = useLoad<{ groups: Group[]; recent: One[] }>(api.admin.errors)
    const [kind, setKind] = useState<Kind | "all">("all")
    const refresh = <Button variant="ghost" className="h-7 px-2.5 text-[12px]" onClick={() => void list.reload()} disabled={list.loading}>Refresh</Button>
    if (list.error) return <Panel title="Errors" head={refresh}><Empty title="Couldn't load errors">{list.error}</Empty></Panel>
    if (!list.data) return <Panel title="Errors" head={refresh}><Empty>Loading…</Empty></Panel>
    const counts = Object.fromEntries(KINDS.map(([k]) => [k, list.data!.groups.filter((g) => k === "all" || g.kind === k).reduce((n, g) => n + g.count, 0)]))
    const groups = list.data.groups.filter((g) => kind === "all" || g.kind === kind)
    const recent = list.data.recent.filter((e) => kind === "all" || e.kind === kind).slice(0, 50)
    return (
        <div className="grid gap-4">
            <div role="group" aria-label="Kind" className="flex flex-wrap gap-1">
                {KINDS.map(([k, label]) => (
                    <Button key={k} variant="ghost" aria-pressed={kind === k} onClick={() => setKind(k)}
                        className={cn("h-7 px-2.5 text-[12px]", kind === k && "border-[var(--accent)] text-foreground")}>
                        {label} <span className="text-muted-foreground">{counts[k]}</span>
                    </Button>
                ))}
            </div>
            <Panel title="Errors, last 7 days" head={<><HeadNote>{groups.reduce((n, g) => n + g.count, 0)} in {groups.length} kinds</HeadNote>{refresh}</>}>
                {!groups.length ? <Empty title="No errors">{EMPTY[kind]}</Empty> : (
                    <ul className="m-0 list-none p-0">
                        {groups.map((g) => (
                            <li key={g.method + g.route + g.status + g.message} className="grid gap-0.5 border-b border-border px-5 py-2.5 last:border-b-0">
                                <div className="flex flex-wrap items-baseline gap-2 text-[13px]">
                                    <span className="rounded px-1.5 font-mono text-[11.5px] font-semibold"
                                        style={{ color: tone(g.kind), background: `color-mix(in srgb, ${tone(g.kind)} 14%, transparent)` }}>{badge(g)}</span>
                                    <span className="font-mono text-[12px] text-ink-2">{what(g)}</span>
                                    <span className="ml-auto text-[12px] font-semibold text-foreground">{g.count}×</span>
                                </div>
                                <div className="break-words font-mono text-[12px] text-foreground">{g.message || "(no message)"}</div>
                                <div className="text-[11.5px] text-muted-foreground">
                                    last {ago(g.last)}{g.count > 1 ? " · first " + when(g.first) : ""}{g.users ? " · " + g.users + (g.users === 1 ? " person" : " people") : ""}
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </Panel>
            {recent.length > 0 && (
                <Panel title="Latest">
                    <ul className="m-0 list-none p-0">
                        {recent.map((e, i) => (
                            <li key={e.at + ":" + i} className="flex flex-wrap gap-x-3 gap-y-0.5 border-b border-border px-5 py-2 text-[12px] last:border-b-0">
                                <span className="w-[120px] flex-none text-muted-foreground">{when(e.at)}</span>
                                <span className="font-mono text-ink-2">{badge(e)} {what(e)}</span>
                                {e.username && <span className="text-ink-2">· {e.username}</span>}
                                <span className="basis-full break-words font-mono text-foreground sm:basis-auto">{e.message}</span>
                            </li>
                        ))}
                    </ul>
                </Panel>
            )}
        </div>
    )
}
