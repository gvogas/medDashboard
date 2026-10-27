// Settings, Account: data, saved copies, signing out.

import { status as syncStatus } from "@/core/sync"
import { useConflicts, useItems, useCourses } from "@/data/store"
import { useSyncStatus } from "@/data/sync"
import { useUi } from "@/data/ui"
import { savedValues, syncLine } from "@/data/settings"
import { exportData, keepSignedIn, resolveConflict, signOut } from "@/data/actions"
import type { Profile } from "@/data/types"
import { ExportData } from "./export-data"
import { Button } from "./fields"
import { Group, Hint, Row } from "./settings-parts"

/* ── Account ── */

export function AccountTab({ profile }: { profile: Profile }) {
    const items = useItems(), courses = useCourses()
    const conflicts = useConflicts()
    const status = useSyncStatus()
    const asking = useUi((u) => u.signoutAsk)
    return (
        <>
            <Group title="Data" state={items.length + " items · " + courses.length + " courses"}>
                <Hint>{syncLine({ ...status, lastPull: syncStatus.lastPull })}</Hint>
                <ExportData />
            </Group>
            {conflicts.length > 0 && (
                <Group title="Saved copies" state={conflicts.length}>
                    <Hint>Edits the server turned down. Restore one to try again, or discard it.</Hint>
                    {conflicts.map((c) => (
                        <details key={c.id} className="my-1.5 text-[12.5px]">
                            <summary className="cursor-pointer font-semibold text-foreground">{String(c.body?.title || c.body?.name || c.body?.text || c.key)}</summary>
                            <p className="my-1.5 text-muted-foreground">{c.reason}</p>
                            {c.op === "delete" && <p className="my-1.5 text-muted-foreground">Your saved action: delete this record.</p>}
                            <dl className="max-h-60 overflow-auto text-[12px] [overflow-wrap:anywhere]">
                                {savedValues(c.body ?? {}).map(([k, v], i) => <div key={i}><dt className="mt-1.5 font-semibold">{k}</dt><dd className="ml-0 whitespace-pre-wrap">{v}</dd></div>)}
                            </dl>
                            <Row>
                                <Button variant="ghost" onClick={() => void resolveConflict(c.id, true)}>Restore my edit</Button>
                                <Button variant="ghost" onClick={() => void resolveConflict(c.id, false)}>Discard saved copy</Button>
                            </Row>
                        </details>
                    ))}
                </Group>
            )}
            <Group title="Account" state={profile.username}>
                {asking ? <>
                    <div role="alert" className="rounded-lg border border-[var(--warn-line)] bg-[var(--warn-bg)] px-2.5 py-[7px] text-[11.5px] text-[var(--warn-ink)]">
                        This device has edits that have not synced, or saved copies. Signing out erases them. Export your data first to keep them.
                    </div>
                    <Row>
                        <Button variant="ghost" onClick={() => void exportData()}>Export data</Button>
                        <Button variant="ghost" onClick={keepSignedIn}>Stay signed in</Button>
                        <Button variant="danger" onClick={() => void signOut({ everywhere: asking.everywhere, force: true })}>Sign out and erase</Button>
                    </Row>
                </> : (
                    <Row>
                        <Button variant="ghost" onClick={() => void signOut()}>Sign out</Button>
                        <Button variant="ghost" title="Every phone and laptop signed in as you will need the password again" onClick={() => void signOut({ everywhere: true })}>Sign out everywhere</Button>
                    </Row>
                )}
            </Group>
        </>
    )
}
