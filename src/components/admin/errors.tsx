// The Admin page's Errors tab: what the Worker caught in the last 7 days (worker/errors.js),
// the same failure grouped once with its count, then the latest ones one by one. Kept
// 30 days; at most 500 are written a day, the rest only reach Workers Logs.

import { api } from "@/core/api"
import { Panel, HeadNote, Empty } from "@/components/views/bits"
import { Button } from "@/components/sheet/fields"
import { ago, useLoad, when } from "./use-admin"

interface Group { method: string; route: string; status: number; message: string; count: number; last: number; first: number; users: number }
interface One { at: number; method: string; route: string; status: number; message: string; username: string | null }

export function Errors() {
    const list = useLoad<{ groups: Group[]; recent: One[] }>(api.admin.errors)
    const refresh = <Button variant="ghost" className="h-7 px-2.5 text-[12px]" onClick={() => void list.reload()} disabled={list.loading}>Refresh</Button>
    if (list.error) return <Panel title="Errors" head={refresh}><Empty title="Couldn't load errors">{list.error}</Empty></Panel>
    if (!list.data) return <Panel title="Errors" head={refresh}><Empty>Loading…</Empty></Panel>
    const { groups, recent } = list.data
    return (
        <div className="grid gap-4">
            <Panel title="Errors, last 7 days" head={<><HeadNote>{groups.reduce((n, g) => n + g.count, 0)} in {groups.length} kinds</HeadNote>{refresh}</>}>
                {!groups.length ? <Empty title="No errors">Nothing has failed in the last 7 days.</Empty> : (
                    <ul className="m-0 list-none p-0">
                        {groups.map((g) => (
                            <li key={g.method + g.route + g.status + g.message} className="grid gap-0.5 border-b border-border px-5 py-2.5 last:border-b-0">
                                <div className="flex flex-wrap items-baseline gap-2 text-[13px]">
                                    <span className="rounded bg-[color-mix(in_srgb,var(--crit)_14%,transparent)] px-1.5 font-mono text-[11.5px] font-semibold text-[var(--crit)]">{g.status}</span>
                                    <span className="font-mono text-[12px] text-ink-2">{g.method} {g.route || "—"}</span>
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
                                <span className="font-mono text-ink-2">{e.status} {e.method} {e.route}</span>
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
