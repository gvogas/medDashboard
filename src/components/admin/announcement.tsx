// The Admin page's Announcement tab: write a message everyone sees at the top of the app
// until it ends, or take the current one down. People reach it on their next sync
// (GET /api/me); each can close it on their own browser (announcement-banner.tsx).

import { useId, useState } from "react"
import { api } from "@/core/api"
import type { Announcement } from "@/core/types"
import { toast } from "@/data/toast"
import { Panel, Empty } from "@/components/views/bits"
import { Button, Label, Note, Select, TextArea } from "@/components/sheet/fields"
import { problem, useLoad, when } from "./use-admin"

const LASTS: [string, number][] = [["1 hour", 1], ["6 hours", 6], ["1 day", 24], ["3 days", 72], ["1 week", 168], ["30 days", 720]]
const MAX = 280

export function AnnouncementTab() {
    const id = useId()
    const current = useLoad<{ announcement: Announcement | null }>(api.admin.announcement)
    const [text, setText] = useState(""), [lasts, setLasts] = useState(24)
    const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null)
    const act = async (call: () => Promise<unknown>, done: string) => {
        setBusy(true); setError(null)
        try { await call(); toast(done); setText(""); await current.reload() }
        catch (e) { setError(problem(e)) }
        finally { setBusy(false) }
    }
    const live = current.data?.announcement
    return (
        <div className="grid gap-4">
            <Panel title="Showing now">
                {current.error ? <Empty title="Couldn't load it">{current.error}</Empty>
                    : !current.data ? <Empty>Loading…</Empty>
                    : !live ? <Empty>No announcement is showing.</Empty>
                    : (
                        <div className="grid gap-2 px-5 py-4">
                            <p className="m-0 whitespace-pre-wrap text-[13.5px] text-foreground">{live.text}</p>
                            <div className="flex flex-wrap items-center gap-3">
                                <Note>Until {when(live.until)}</Note>
                                <Button variant="ghost" className="ml-auto h-8 px-3 text-[12.5px]" disabled={busy}
                                    onClick={() => void act(() => api.admin.unannounce(), "The announcement is down.")}>Take down</Button>
                            </div>
                        </div>
                    )}
            </Panel>
            <Panel title={live ? "Replace it" : "New announcement"}>
                <form className="grid gap-3 px-5 py-4" onSubmit={(e) => {
                    e.preventDefault()
                    void act(() => api.admin.announce(text.trim(), Date.now() + lasts * 3_600_000), "Announced. Everyone sees it on their next sync.")
                }}>
                    <div className="grid gap-1">
                        <Label htmlFor={id + "t"}>Message</Label>
                        <TextArea id={id + "t"} value={text} onChange={(e) => setText(e.target.value)} maxLength={MAX} rows={3} placeholder="e.g. Term will be down for maintenance tonight from 9 to 10 pm." />
                        <Note>{text.length} / {MAX}</Note>
                    </div>
                    <div className="flex flex-wrap items-end gap-3">
                        <div className="grid gap-1">
                            <Label htmlFor={id + "l"}>Show for</Label>
                            <Select id={id + "l"} value={lasts} onChange={(e) => setLasts(Number(e.target.value))} className="w-[140px]">
                                {LASTS.map(([label, h]) => <option key={h} value={h}>{label}</option>)}
                            </Select>
                        </div>
                        <Button type="submit" className="ml-auto h-8 px-3.5 text-[12.5px]" disabled={busy || !text.trim()}>{live ? "Replace" : "Announce"}</Button>
                    </div>
                    {error && <p role="alert" className="m-0 text-[12.5px] text-destructive">{error}</p>}
                </form>
            </Panel>
        </div>
    )
}
