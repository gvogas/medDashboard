// Settings, Connections: the calendar feed, reminders, Spotify.

import { useEffect, useState, type ReactNode } from "react"
import { cn } from "@/lib/utils"
import { normalizePrefs } from "@/core/model"
import { state as spotify } from "@/data/spotify/player"
import { state as web } from "@/data/spotify/web-player"
import { api, spotifyRetryAt } from "@/core/api"
import { savePrefs } from "@/data/study-controller"
import { pushState, testPush, turnOff, turnOn, type PushState } from "@/data/push"
import { notify } from "@/bridge"
import { SpotifyMark } from "@/components/spotify/mark"
import { useProfile } from "@/data/store"
import { ui, useUi } from "@/data/ui"
import { feedLink, timeZone } from "@/data/settings"
import { disconnectSpotify } from "@/data/actions"
import type { Feed, Profile } from "@/data/types"
import { Button, CONTROL } from "./fields"
import { Group, Hint, Row } from "./settings-parts"

/* ── Connections ── */

export function ConnectionsTab() {
    const profile = useProfile() as Profile | null
    return (
        <>
            <FeedGroup />
            {profile && <RemindersGroup profile={profile} />}
            <SpotifyGroup />
        </>
    )
}

/* Reminders: alarms in the calendar feed (an account setting), and the morning digest on
   this device (data/push.ts). The device's state is asked for when the group opens. */
const PUSH_SAYS: Record<PushState, string> = {
    unsupported: "This browser cannot show reminders. Chrome, Edge, Firefox and Safari can.",
    "ios-install": "On an iPhone or iPad, add Term to your Home Screen first (Share, then Add to Home Screen), and turn this on there.",
    disabled: "Morning reminders are not set up on this site yet.",
    blocked: "Notifications are blocked for this site. Allow them in the browser’s site settings, then come back.",
    on: "A note at about 7 am when something is due today or tomorrow, or overdue. Nothing on a quiet day.",
    off: "A note at about 7 am when something is due today or tomorrow, or overdue. Nothing on a quiet day.",
}

function RemindersGroup({ profile }: { profile: Profile }) {
    const p = normalizePrefs(profile.studyPrefs)
    const [state, setState] = useState<PushState | null>(null)
    const [busy, setBusy] = useState(false)
    const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null)
    useEffect(() => {
        let live = true
        pushState().then((s) => { if (live) setState(s) }, () => { if (live) setState(null) })
        return () => { live = false }
    }, [])
    const run = async (work: () => Promise<void>) => {
        setBusy(true)
        setNote(null)
        try { await work() }
        catch { setNote({ text: "That did not work. Check your connection and try again.", error: true }) }
        finally { setBusy(false) }
    }
    const canSwitch = state === "on" || state === "off"
    return (
        <Group title="Reminders" state={state === "on" ? "on this device" : null} id="remindersGrp">
            <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
                <input type="checkbox" checked={p.alarms} className="accent-[var(--accent)]" onChange={(e) => void savePrefs({ alarms: e.target.checked })} />
                <span>Alerts in the calendar feed: a day and an hour before each exam, quiz and deadline</span>
            </label>
            <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
                <input type="checkbox" checked={state === "on"} disabled={!canSwitch || busy} className="accent-[var(--accent)]"
                    onChange={(e) => {
                        const on = e.target.checked
                        void run(async () => {
                            const next = on ? await turnOn() : await turnOff()
                            setState(next)
                            if (on && next === "off") setNote({ text: "Notifications were not allowed, so reminders stay off." })
                        })
                    }} />
                <span>Morning reminders on this device</span>
            </label>
            {state && <Hint>{PUSH_SAYS[state]}</Hint>}
            {state === "on" && (
                <Row><Button variant="ghost" disabled={busy} onClick={() => void run(async () => {
                    const r = await testPush()
                    if (r === "gone") setState("off")
                    setNote(r === "ok" ? { text: "Sent. It should show in a few seconds." } : { text: "The test could not be delivered. Turn reminders off and on again.", error: true })
                })}>Send a test</Button></Row>
            )}
            {note && <Hint error={note.error}>{note.text}</Hint>}
        </Group>
    )
}

/* The calendar feed: a private link Google or Apple Calendar subscribes to. Asked about
   once a session, the first time the Connections tab opens; kept in ui.feed across tabs. */
function FeedGroup() {
    const f = useUi((u) => u.feed)
    const set = (next: Feed | null) => { ui.feed = next; notify() }
    useEffect(() => {
        if (ui.feed) return
        set({ loading: true })
        api.calendarFeed().then(
            (r: Feed) => set({ ...r }),
            () => set({ on: false, error: "Could not check the calendar feed. Try again when you are online." }),
        )
    }, [])
    const change = async (call: () => Promise<unknown>, off: boolean) => {
        const was = ui.feed || {}
        set({ ...was, busy: true, error: null, confirm: null })
        try {
            const r = await call()
            set(off ? { on: false } : { ...(r as Feed) })
        } catch {
            set({ ...was, busy: false, confirm: null, error: "That did not go through. Try again when you are online." })
        }
    }
    const copy = async (link: string) => {
        try { await navigator.clipboard.writeText(link) } catch { (document.getElementById("feedUrl") as HTMLInputElement | null)?.select() }
        const now = ui.feed
        set({ ...now, copied: true })
        setTimeout(() => { if (ui.feed && ui.feed.url === now?.url) set({ ...ui.feed, copied: false }) }, 2000)
    }

    const state = !f || f.loading ? "checking" : f.on ? "on" : "off"
    let body: ReactNode
    if (!f || f.loading) body = <Hint>Checking…</Hint>
    else if (f.on && f.url) {
        const link = feedLink(f.url, timeZone()), webcal = link.replace(/^https?:/, "webcal:")
        body = <>
            <div className="flex gap-1.5">
                <input id="feedUrl" type="text" readOnly value={link} aria-label="Calendar feed link" className={cn(CONTROL, "border-border font-mono text-[12px]")} />
                <Button variant="ghost" onClick={() => void copy(link)}>{f.copied ? "Copied" : "Copy"}</Button>
            </div>
            <Row>
                <a className="inline-flex items-center rounded-[10px] border border-border bg-[linear-gradient(var(--panel),var(--panel-2))] px-3.5 py-[7px] text-[12.5px] text-ink-2 no-underline hover:text-foreground"
                    href={"https://calendar.google.com/calendar/render?cid=" + encodeURIComponent(webcal)} target="_blank" rel="noopener noreferrer">Add to Google Calendar</a>
                <a className="inline-flex items-center rounded-[10px] border border-border bg-[linear-gradient(var(--panel),var(--panel-2))] px-3.5 py-[7px] text-[12.5px] text-ink-2 no-underline hover:text-foreground"
                    href={webcal}>Add to Apple Calendar</a>
            </Row>
            {f.confirm ? (
                <div className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-ink-2">
                    <span className="flex-[1_1_200px]">{f.confirm === "renew"
                        ? "Make a new link? Calendars using the old one stop updating until you add the new one."
                        : "Turn the feed off? Calendars using this link stop updating."}</span>
                    <Button variant="ghost" onClick={() => set({ ...f, confirm: null })}>Keep</Button>
                    <Button variant="danger" onClick={() => void (f.confirm === "renew" ? change(() => api.calendarRenew(), false) : change(() => api.calendarStop(), true))}>
                        {f.confirm === "renew" ? "New link" : "Turn off"}
                    </Button>
                </div>
            ) : (
                <Row>
                    <Button variant="ghost" onClick={() => set({ ...f, confirm: "renew" })}>New link</Button>
                    <Button variant="ghost" onClick={() => set({ ...f, confirm: "stop" })}>Turn off</Button>
                </Row>
            )}
            <Hint>Deadlines, exams, quizzes and your weekly classes. Keep the link private: anyone who has it can see your schedule. Google refreshes it every few hours, so changes can take up to a day to show there.</Hint>
        </>
    } else {
        body = <>
            <Hint>See your deadlines, exams, quizzes and classes in Google or Apple Calendar. It updates by itself as you change things here.</Hint>
            <Row><Button disabled={!!f.busy} onClick={() => void change(() => api.calendarRenew(), false)}>Create a calendar link</Button></Row>
        </>
    }
    return (
        <Group title="Calendar feed" state={state} id="feedGrp">
            {body}
            {f?.error && <Hint error>{f.error}</Hint>}
        </Group>
    )
}

function SpotifyGroup() {
    const note = useUi((u) => u.spotifyNote)
    useUi((u) => u.view)   /* redrawn as the player's state changes (boot.ts notifies) */
    const on = spotify.connected, retry = spotifyRetryAt()
    let who: ReactNode, action: ReactNode = null
    if (!spotify.loaded) {
        who = <><b>Checking connection</b><span>{spotify.stale ? "Connection status is unavailable. Try again when you are online." : "Checking your saved Spotify connection…"}</span></>
    } else if (on) {
        who = <><b>Connected</b><span>{spotify.device ? <>Playing on <b className="inline font-medium">{spotify.device}</b>.</> : spotify.stale ? "Playback status is temporarily unavailable." : spotify.track ? "Paused." : "Nothing playing right now."}</span></>
        action = <Button variant="ghost" onClick={() => void disconnectSpotify()}>Disconnect</Button>
    } else {
        who = <><b>Not connected</b><span>Show what you are listening to at the bottom of the sidebar.</span></>
        action = <a href="/api/spotify/connect" className="inline-flex items-center rounded-[10px] border border-[color-mix(in_srgb,var(--accent)_72%,#000)] bg-[linear-gradient(color-mix(in_srgb,var(--accent)_90%,#fff),color-mix(in_srgb,var(--accent)_92%,#000))] px-3 py-[5px] text-[12px] font-[650] text-primary-foreground no-underline">Connect</a>
    }
    return (
        <Group title="Spotify" state={!spotify.loaded ? "Checking connection" : on ? "Connected" : "Not connected"} id="spotifyGrp">
            <div className="flex items-center gap-2.5 text-[12.5px]">
                <SpotifyMark className="size-4" />
                <div className="flex min-w-0 flex-1 flex-col [&>b]:font-semibold [&>b]:text-foreground [&>span]:text-[11px] [&>span]:text-muted-foreground">{who}</div>
                {action}
            </div>
            {on && retry > 0 && <Hint>Your account is connected. Spotify requests are paused until {new Date(retry).toLocaleString()}.</Hint>}
            {on && web.status === "needs_reconnect" && <Hint error>Reconnect Spotify to play in this browser. <a href="/api/spotify/connect">Reconnect</a></Hint>}
            {on && web.status === "ready" && <Hint>This tab is a Spotify device called <b>Term</b>: press play here and it plays here.</Hint>}
            {note === "error" && <Hint error>Spotify did not connect. Try again.</Hint>}
            {note === "connected" && <span className="text-[11.5px] text-[var(--good)]">Connected. The badge on the coat shows what is playing.</span>}
            <Hint>Controls need Spotify Premium; free accounts still see what is playing.{on ? "" : " The owner of the Term app has to add your Spotify email to it first, so ask before connecting."}</Hint>
        </Group>
    )
}
