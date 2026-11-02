// The Admin page's Audit log: what admins did, newest first; kept 90 days.

import { api } from "@/core/api"
import { Panel, HeadNote, Empty } from "@/components/views/bits"
import { Button } from "@/components/sheet/fields"
import { useLoad, when } from "./use-admin"
import type { AuditEntry as Entry } from "@/core/types"


const SAYS: Record<string, (e: Entry) => string> = {
    create: (e) => "created " + e.target + (e.detail ? " " + e.detail : ""),
    reset: (e) => "set a new password for " + e.target,
    revoke: (e) => "signed " + e.target + " out everywhere",
    delete: (e) => "deleted " + e.target,
    promote: (e) => "made " + e.target + " an admin",
    demote: (e) => "removed admin from " + e.target,
    unlock: (e) => "unlocked " + e.target + (e.detail ? " (" + e.detail + ")" : ""),
    announce: (e) => "announced “" + e.detail + "”",
    unannounce: () => "took the announcement down",
    grant: (e) => "granted " + e.target + " Study Buddy " + e.detail,
}

export function AuditLog() {
    const list = useLoad<{ entries: Entry[] }>(api.admin.audit)
    const head = <>
        {list.data && <HeadNote>last 90 days</HeadNote>}
        <Button variant="ghost" className="h-7 px-2.5 text-[12px]" onClick={() => void list.reload()} disabled={list.loading}>Refresh</Button>
    </>
    return (
        <Panel title="Audit log" head={head}>
            {list.error ? <Empty title="Couldn't load the log">{list.error}</Empty>
                : !list.data ? <Empty>Loading…</Empty>
                : !list.data.entries.length ? <Empty>No admin actions yet.</Empty>
                : (
                    <ul className="m-0 list-none p-0">
                        {list.data.entries.map((e, i) => (
                            <li key={e.at + ":" + i} className="flex flex-wrap gap-x-3 border-b border-border px-5 py-2.5 text-[13px] last:border-b-0">
                                <span className="w-[120px] flex-none text-[12px] text-muted-foreground">{when(e.at)}</span>
                                <span className="min-w-0 text-ink-2"><b className="font-semibold text-foreground">{e.admin}</b> {(SAYS[e.action] ?? ((x: Entry) => x.action + " " + x.target))(e)}</span>
                            </li>
                        ))}
                    </ul>
                )}
        </Panel>
    )
}
