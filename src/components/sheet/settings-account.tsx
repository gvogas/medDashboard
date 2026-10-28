// Settings, Account: data, saved copies, signing out.

import { useState } from "react"
import { status as syncStatus } from "@/core/sync"
import { useConflicts, useItems, useCourses } from "@/data/store"
import { useSyncStatus } from "@/data/sync"
import { useUi } from "@/data/ui"
import { savedValues, syncLine } from "@/data/settings"
import { reopenSetup } from "@/data/setup"
import { closeSheet } from "@/data/overlay"
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
    const [discarding, setDiscarding] = useState<string | null>(null)
    const [everywhereAsk, setEverywhereAsk] = useState(false)
    return (
        <>
            <Group title="Data" state={items.length + " items · " + courses.length + " courses"}>
                <Hint>{syncLine({ ...status, lastPull: syncStatus.lastPull })}</Hint>
                <ExportData />
                <Row>
                    <Button variant="ghost" onClick={() => { closeSheet(); void reopenSetup() }}>Set up Term again</Button>
                </Row>
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
                            {discarding === c.id ? <>
                                <Hint>Discard this saved copy? Your edit is erased from this device and will not be sent.</Hint>
                                <Row>
                                    <Button variant="ghost" onClick={() => setDiscarding(null)}>Keep copy</Button>
                                    <Button variant="danger" onClick={() => { setDiscarding(null); void resolveConflict(c.id, false) }}>Discard for good</Button>
                                </Row>
                            </> : (
                                <Row>
                                    <Button variant="ghost" onClick={() => void resolveConflict(c.id, true)}>Restore my edit</Button>
                                    <Button variant="ghost" onClick={() => setDiscarding(c.id)}>Discard saved copy</Button>
                                </Row>
                            )}
                        </details>
                    ))}
                </Group>
            )}
            <Group title="Account" state={profile.username}>
                {asking ? <>
                    <div role="alert" className="rounded-lg border border-[var(--warn-line)] bg-[var(--warn-bg)] px-2.5 py-[7px] text-[11.5px] text-[var(--warn-ink)]">
                        {asking.unsynced && <div>This device has edits that have not synced, or saved copies. Signing out erases them. Export your data first to keep them.</div>}
                        {asking.timer && <div>A study timer is running. Its time is saved and synced before you are signed out.</div>}
                    </div>
                    <Row>
                        {asking.unsynced && <Button variant="ghost" onClick={() => void exportData()}>Export data</Button>}
                        <Button variant="ghost" onClick={keepSignedIn}>Stay signed in</Button>
                        <Button variant="danger" onClick={() => void signOut({ everywhere: asking.everywhere, force: true })}>{asking.unsynced ? "Sign out and erase" : "Sign out"}</Button>
                    </Row>
                </> : everywhereAsk ? <>
                    <Hint>Every phone and laptop signed in as you will need the password again, this one included.</Hint>
                    <Row>
                        <Button variant="ghost" onClick={() => setEverywhereAsk(false)}>Keep signed in</Button>
                        <Button variant="danger" onClick={() => { setEverywhereAsk(false); void signOut({ everywhere: true }) }}>Sign out everywhere</Button>
                    </Row>
                </> : <>
                    <Row>
                        <Button variant="ghost" onClick={() => void signOut()}>Sign out</Button>
                        <Button variant="ghost" onClick={() => setEverywhereAsk(true)}>Sign out everywhere</Button>
                    </Row>
                    <Hint>Sign out everywhere also signs out every other phone and laptop signed in as you. Each needs the password again.</Hint>
                </>}
            </Group>
        </>
    )
}
