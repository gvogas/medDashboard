// Settings in the sheet, in four tabs: You (theme, where you're headed, name, look, quotes), Study
// (the goal and streak, reviews, import, the school calendar, the calendar feed), Spotify,
// and Account (data, saved copies, signing out). Everything saves as it changes.

import { useEffect, useId, useRef, useState, type ReactNode } from "react"
import { cn } from "@/lib/utils"
import { COAT_PALETTE, colourName, normalizePrefs } from "@/core/model"
import { shortDate, today } from "@/core/dates"
import { schoolStatus } from "@/core/school"
import type { SchoolCalendar } from "@/core/school"
import { schoolCal } from "@/data/query"
import { status as syncStatus } from "@/core/sync"
import { state as spotify } from "@/data/spotify/player"
import { state as web } from "@/data/spotify/web-player"
import { api, spotifyRetryAt } from "@/core/api"
import { readSetting, writeSetting } from "@/core/reviews"
import { runReviews } from "@/data/sync-status"
import { savePrefs } from "@/data/study-controller"
import { setBg, setTheme } from "@/data/theme"
import { notify } from "@/bridge"
import { useConflicts, useItems, useCourses, useProfile, useQuotes } from "@/data/store"
import { useSyncStatus } from "@/data/sync"
import { ui, useUi } from "@/data/ui"
import { beforeSheetClose, closeSheet } from "@/data/overlay"
import { coatColour, feedLink, GOAL_MAX, GOALS, hm, REST_DAYS, savedValues, syncLine, TABS, themeLabel, timeZone, toggleRest, type SettingsTab } from "@/data/settings"
import { importFile, importPasted, readOutlineFile } from "@/data/import-edit"
import { refreshReads } from "@/data/ai-read"
import { openSchool, readSchoolFile, removeSchool } from "@/data/school-edit"
import {
    addQuote, disconnectSpotify, exportData, keepSignedIn, removeQuote, resolveConflict, saveCoat, setSettingsTab, showShortcuts, signOut,
} from "@/data/actions"
import { BGS, GOALS as THEME_GOALS, THEMES, goalFor, type Bg } from "@/data/themes"
import type { Feed, Profile } from "@/data/types"
import { radioKeys, rovingTab } from "./radio-keys"
import { Button, CONTROL, RemoveButton, SheetBody, SheetFoot, SheetHead, Swatches, TextArea, TextInput } from "./fields"

export function SettingsSheet({ tab, focus }: { tab: SettingsTab; focus: string | null }) {
    const profile = useProfile()
    const conflicts = useConflicts()
    const sync = useSyncStatus()

    /* what was said and asked goes when Settings closes */
    useEffect(() => {
        const forget = () => {
            ui.importNote = null; ui.schoolNote = null; ui.spotifyNote = null
            ui.signoutAsk = null; ui.schoolAsk = false
            if (ui.feed) ui.feed.confirm = null
        }
        beforeSheetClose.add(forget)
        return () => { beforeSheetClose.delete(forget) }
    }, [])

    /* a deep link: the field or group, focused and in view */
    useEffect(() => {
        if (!focus) return
        requestAnimationFrame(() => {
            const el = document.getElementById(focus)
            el?.focus({ preventScroll: true })
            el?.scrollIntoView?.({ block: "nearest" })
        })
    }, [focus, tab])

    if (!profile) return null
    const flag = conflicts.length
        ? <i className="min-w-[15px] rounded-lg bg-destructive px-1 text-[10px] leading-[15px] text-[var(--on-crit)] not-italic">{conflicts.length}</i>
        : sync.state === "error" ? <i aria-label="sync problem" className="size-1.5 rounded-full bg-destructive" /> : null

    return (
        <>
            <SheetHead kind="Settings" onClose={closeSheet}>
                <span className="text-[11px] text-muted-foreground">saved as you type</span>
            </SheetHead>
            <div role="group" aria-label="Settings sections" className="mx-4 mt-2.5 flex gap-0.5 rounded-[10px] bg-muted p-0.5">
                {TABS.map(([id, label]) => (
                    <button key={id} type="button" aria-pressed={tab === id} onClick={() => setSettingsTab(id)}
                        className={cn(
                            "inline-flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border-0 bg-transparent px-1.5 py-[5px] font-[inherit] text-[12px] font-semibold text-ink-2 hover:text-foreground",
                            tab === id && "bg-card text-accent-foreground shadow-[0_1px_2px_rgba(0,0,0,.1),inset_0_1px_0_var(--rim-hi)]",
                        )}>
                        {label}{id === "account" && flag}
                    </button>
                ))}
            </div>
            <SheetBody>
                {tab === "you" && <YouTab profile={profile} />}
                {tab === "study" && <StudyTab profile={profile} />}
                {tab === "spotify" && <SpotifyTab />}
                {tab === "account" && <AccountTab profile={profile} />}
            </SheetBody>
            <SheetFoot hint="Term">
                <Button variant="ghost" className="[@media(hover:none)]:hidden" onClick={showShortcuts}>
                    Keyboard shortcuts <kbd className="ml-1 rounded border border-border px-1.5 font-mono text-[11px]">?</kbd>
                </Button>
                <Button onClick={closeSheet}>Done</Button>
            </SheetFoot>
        </>
    )
}

/* ── parts ── */

/** A group of settings: a title, what it is set to, and its controls. */
function Group({ title, state, id, children }: { title: string; state?: ReactNode; id?: string; children: ReactNode }) {
    return (
        <section id={id} tabIndex={id ? -1 : undefined} className="flex flex-col gap-2 border-b border-line-2 pb-3.5 outline-none last:border-b-0 last:pb-0">
            <h4 className="m-0 flex items-center gap-2 text-[12.5px] font-[650] text-ink-2">
                {title}
                {state != null && <em className="ml-auto text-[11px] font-medium text-muted-foreground not-italic">{state}</em>}
            </h4>
            {children}
        </section>
    )
}
const Hint = ({ error, children }: { error?: boolean; children: ReactNode }) => (
    <span className={cn("text-[11.5px]", error ? "text-destructive" : "text-muted-foreground")}>{children}</span>
)
const Row = ({ children }: { children: ReactNode }) => <span className="flex flex-wrap gap-1.5">{children}</span>

/** A pressable chip: a goal preset, a rest day. */
const Chip = ({ on, tone = "accent", ...props }: React.ComponentProps<"button"> & { on: boolean; tone?: "accent" | "study" }) => (
    <button type="button" aria-pressed={on} {...props}
        className={cn(
            "min-w-11 cursor-pointer rounded-lg border border-border bg-muted px-3 py-1.5 font-[inherit] text-[12px] font-semibold text-ink-2 hover:text-foreground",
            on && (tone === "study"
                ? "border-[var(--study)] bg-[var(--study-soft)] font-bold text-[var(--study-ink)]"
                : "border-[var(--accent)] bg-accent font-bold text-accent-foreground"),
        )} />
)

/** A file picker that looks like a button. */
function FilePick({ id, label, busy = false, accept, onFile }: { id: string; label: string; busy?: boolean; accept: string; onFile: (f: File) => void }) {
    return (
        <label className={cn(
            "relative inline-flex cursor-pointer items-center rounded-[10px] border border-border bg-[linear-gradient(var(--panel),var(--panel-2))] px-3.5 py-[7px] text-[12.5px] font-[550] text-ink-2 shadow-[var(--shadow-1),inset_0_1px_0_var(--rim-hi)] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--accent)] hover:text-foreground",
            busy && "cursor-progress opacity-70",
        )}>
            {label}
            <input id={id} type="file" accept={accept} disabled={busy} className="absolute inset-0 w-full cursor-pointer opacity-0"
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onFile(f) }} />
        </label>
    )
}

/* ── You ── */

const LOOKS = [
    ["light", "Light", ["#EEF4F3", "#FFFFFF", "#0E7C74"]],
    ["dark", "Dark", ["#0A1214", "#111D1E", "#3FBFB2"]],
    ["system", "System", ["#EEF4F3", "#0A1214", "#3FBFB2"]],
] as const

function YouTab({ profile }: { profile: Profile }) {
    const theme = useUi((u) => u.theme)
    const bg = useUi((u) => u.bg)
    const dark = document.documentElement.getAttribute("data-app") === "dark"
    return (
        <>
            <Group title="Theme" state={THEMES[bg].label} id="themeGrp">
                <Hint>Changes the sidebar, colours and the next-exam animation.</Hint>
                <div role="radiogroup" aria-label="Theme" onKeyDown={radioKeys} className="flex flex-col gap-1.5">
                    {BGS.map((id, i) => {
                        const t = THEMES[id], on = bg === id
                        return (
                            <button key={id} type="button" role="radio" aria-checked={on} tabIndex={rovingTab(i, BGS.indexOf(bg))} onClick={() => setBg(id)}
                                className={cn(
                                    "grid min-h-[60px] cursor-pointer grid-cols-[44px_minmax(0,1fr)_20px] items-center gap-3.5 rounded-lg border px-3.5 py-2 text-left font-[inherit] text-[14px] text-foreground",
                                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]",
                                    on ? "border-foreground bg-[var(--bg)]" : "border-border bg-card",
                                )}>
                                <span aria-hidden="true" className="grid h-8 w-11 grid-cols-2 overflow-hidden rounded-[5px] shadow-[inset_0_0_0_1px_var(--line)]">
                                    <span style={{ background: t.accent }} /><span style={{ background: t.done }} />
                                </span>
                                <span className="flex flex-col gap-px"><span className="font-medium">{t.label}</span><span className="text-[12.5px] text-muted-foreground">{t.desc}</span></span>
                                <span aria-hidden="true" className={cn("size-[18px] rounded-full", on ? "border-[5px] border-foreground" : "border-[1.5px] border-[var(--box-line)]")} />
                            </button>
                        )
                    })}
                </div>
            </Group>
            <Headed key={bg} profile={profile} bg={bg} />
            <NameField profile={profile} />
            {bg === "med" && <CoatColour profile={profile} />}
            <Group title="Appearance" state={themeLabel(theme, dark)}>
                <div className="flex gap-1.5">
                    {LOOKS.map(([id, label, sw]) => (
                        <button key={id} type="button" aria-pressed={theme === id} onClick={() => setTheme(id)}
                            className={cn(
                                "flex flex-1 cursor-pointer flex-col items-center gap-1.5 rounded-[10px] border border-border bg-muted p-2 font-[inherit] text-[12px] text-ink-2",
                                theme === id && "border-[var(--accent)] bg-accent font-semibold text-accent-foreground",
                            )}>
                            <span className="flex h-5 w-full overflow-hidden rounded-[5px] border border-border">
                                {sw.map((c) => <i key={c} className="flex-1" style={{ background: c }} />)}
                            </span>
                            {label}
                        </button>
                    ))}
                </div>
            </Group>
            <Quotes />
        </>
    )
}

/** Where you're headed: one of the theme's six goals, or typed. Stored in coat.role; shown on the picture. */
function Headed({ profile, bg }: { profile: Profile; bg: Bg }) {
    const saved = (profile.coat?.role ?? "").trim()
    const [own, setOwn] = useState(saved && !THEME_GOALS[bg].includes(saved) ? saved : "")
    const now = goalFor(bg, saved)
    return (
        <Group title="Where you’re headed">
            <Hint>Goes on your {THEMES[bg].wear}, so you see what the work is for.</Hint>
            <div role="radiogroup" aria-label="Where you’re headed" onKeyDown={radioKeys} className="flex flex-wrap gap-1.5">
                {THEME_GOALS[bg].map((g, i) => (
                    <button key={g} type="button" role="radio" aria-checked={g === now} tabIndex={rovingTab(i, THEME_GOALS[bg].indexOf(now))}
                        onClick={() => { setOwn(""); void saveCoat({ role: g }) }}
                        className={cn(
                            "h-[34px] cursor-pointer rounded-full border px-3 font-[inherit] text-[13px]",
                            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]",
                            g === now ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--on-accent)]" : "border-border bg-card text-foreground",
                        )}>{g}</button>
                ))}
            </div>
            <TextInput id="o-goal" aria-label="Your own goal" placeholder="Or type your own" maxLength={22} value={own}
                /* an empty own goal falls back to the theme's first goal (goalFor), so that chip shows checked: intended */
                onChange={(e) => { setOwn(e.target.value); void saveCoat({ role: e.target.value.trim() }) }} />
        </Group>
    )
}

function NameField({ profile }: { profile: Profile }) {
    const [name, setName] = useState(profile.coat?.name ?? "")
    return (
        <Group title="Your name">
            <Hint>Shown on your coat, badge, name plate, jacket, jersey or vest.</Hint>
            <TextInput id="o-name" aria-label="Your name" value={name} maxLength={28} placeholder={profile.displayName || "Your name"}
                onChange={(e) => { setName(e.target.value); void saveCoat({ name: e.target.value }) }} />
        </Group>
    )
}

function CoatColour({ profile }: { profile: Profile }) {
    const colour = coatColour(profile)
    return (
        <Group title="Coat colour" state={colourName(colour)}>
            <Swatches value={colour} colors={COAT_PALETTE.map((p: { hex: string; name: string }) => ({ ...p, name: p.name + " coat" }))} onChange={(color) => void saveCoat({ color })} />
        </Group>
    )
}

function Quotes() {
    const quotes = useQuotes()
    const [text, setText] = useState("")
    const [source, setSource] = useState("")
    const add = async () => {
        if (await addQuote(text, source)) { setText(""); setSource(""); document.getElementById("qText")?.focus() }
    }
    const onEnter = (e: React.KeyboardEvent) => { if (e.key === "Enter") { e.preventDefault(); void add() } }
    return (
        <Group title="Quotes" state={quotes.length + " saved"}>
            <div className="flex flex-col gap-1.5">
                {quotes.length === 0 && <Hint>No quotes yet — the tile stays clear.</Hint>}
                {quotes.map((q) => (
                    <div key={q.id} className="flex items-start gap-2 rounded-lg bg-muted px-2.5 py-2">
                        <div className="min-w-0 flex-1">
                            <div className="font-serif text-[12.5px] [overflow-wrap:anywhere] text-foreground italic">“{q.text}”</div>
                            {q.source && <div className="mt-0.5 text-[10.5px] text-muted-foreground">— {q.source}</div>}
                        </div>
                        <RemoveButton aria-label="Remove quote" onClick={() => void removeQuote(q.id)} />
                    </div>
                ))}
            </div>
            <div className="flex flex-col gap-1.5">
                <TextInput id="qText" value={text} maxLength={300} aria-label="Quote" placeholder="Quote — press Enter to add" className="border-border" onChange={(e) => setText(e.target.value)} onKeyDown={onEnter} />
                <span className="flex gap-1.5">
                    <TextInput value={source} maxLength={80} aria-label="Source" placeholder="Who said it (optional)" className="border-border" onChange={(e) => setSource(e.target.value)} onKeyDown={onEnter} />
                    <Button variant="ghost" onClick={() => void add()}>Add</Button>
                </span>
            </div>
        </Group>
    )
}

/* ── Study ── */

function StudyTab({ profile }: { profile: Profile }) {
    return (
        <>
            <Goal profile={profile} />
            <Streak profile={profile} />
            <Reviews profile={profile} />
            <Import />
            <School />
            <FeedGroup />
        </>
    )
}

function Goal({ profile }: { profile: Profile }) {
    const p = normalizePrefs(profile.studyPrefs)
    const step = (by: number) => void savePrefs({ goal: Math.max(0, Math.min(GOAL_MAX, p.goal + by)) })
    return (
        <Group title="Daily goal" state={p.goal ? hm(p.goal) + " a day" : "off"} id="goalGrp">
            <div className="flex items-center gap-2.5">
                <Button variant="ghost" className="size-10 p-0 text-[18px] font-bold" aria-label="15 minutes less" disabled={!p.goal} onClick={() => step(-15)}>−</Button>
                <b aria-live="polite" className="flex-1 text-center font-mono text-[22px] font-bold text-foreground">{p.goal ? hm(p.goal) : "No goal"}</b>
                <Button variant="ghost" className="size-10 p-0 text-[18px] font-bold" aria-label="15 minutes more" onClick={() => step(15)}>+</Button>
            </div>
            <span role="group" aria-label="Pick a goal" className="flex flex-wrap gap-1.5">
                {GOALS.map((g) => <Chip key={g} tone="study" on={p.goal === g} className="rounded-full" onClick={() => void savePrefs({ goal: g })}>{g ? hm(g) : "Off"}</Chip>)}
            </span>
            <Hint>The Study tab and the corner clock show how far along today is.</Hint>
        </Group>
    )
}

function Streak({ profile }: { profile: Profile }) {
    const p = normalizePrefs(profile.studyPrefs)
    const [min, setMin] = useState(String(p.dayMin))
    useEffect(() => setMin(String(p.dayMin)), [p.dayMin])
    const f = useId()
    return (
        <Group title="Streak">
            <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
                <span>A day counts from</span>
                <input id={f} type="number" inputMode="numeric" min={1} max={240} value={min} className={cn(CONTROL, "w-20 border-border")}
                    onChange={(e) => setMin(e.target.value)}
                    onBlur={() => {
                        const v = Math.round(+min)
                        if (v >= 1 && v <= 240) void savePrefs({ dayMin: v }); else setMin(String(p.dayMin))
                    }} />
                <span>min</span>
            </label>
            <Hint>Rest days never break it: study on one and it counts, skip it and nothing resets.</Hint>
            <span role="group" aria-label="Rest days" className="flex flex-wrap gap-1.5">
                {REST_DAYS.map(([d, label]) => <Chip key={d} on={p.rest.includes(d)} onClick={() => void savePrefs({ rest: toggleRest(p.rest, d) })}>{label}</Chip>)}
            </span>
            <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
                <input type="checkbox" checked={p.celebrate} className="accent-[var(--accent)]" onChange={(e) => void savePrefs({ celebrate: e.target.checked })} />
                <span>Fireworks at the daily goal and at 7, 30, 100 and 365 days</span>
            </label>
        </Group>
    )
}

function Reviews({ profile }: { profile: Profile }) {
    const [on, setOn] = useState(() => readSetting(profile.id).on)
    return (
        <Group title="Reviews" state={on ? "on" : "off"}>
            <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
                <input type="checkbox" checked={on} className="accent-[var(--accent)]" onChange={async (e) => {
                    const next = e.target.checked, was = readSetting(profile.id)
                    writeSetting(profile.id, next ? { on: true, through: was.through && was.on ? was.through : null } : { on: false, through: null })
                    setOn(next)
                    await runReviews()
                }} />
                <span>Create review tasks after lectures</span>
            </label>
            <Hint>Days 1, 3, 7 and 21 after each lecture. This device only, from today.</Hint>
        </Group>
    )
}

function Import() {
    const busy = useUi((u) => u.outlineBusy)
    const note = useUi((u) => u.importNote)
    const left = useUi((u) => u.aiLeft)
    const [text, setText] = useState("")
    useEffect(() => { void refreshReads() }, [])
    return (
        <Group title="Import" state=".ics, CSV or outline" id="importGrp">
            <Row>
                <FilePick id="importFile" label="Calendar or CSV…" accept=".ics,.csv,.txt,text/calendar,text/csv" onFile={(f) => void importFile(f)} />
                <FilePick id="outlineFile" label={busy ? "Reading outline…" : "Course outline…"} busy={busy}
                    accept=".pdf,.docx,.doc,.txt,.md,.html,.odt,application/pdf" onFile={(f) => void readOutlineFile(f)} />
            </Row>
            <Hint>You see everything before it is saved. Outlines, timetables and calendars are read by AI, up to 10 a day{left != null ? " (" + left + " left today)" : ""}.</Hint>
            <details className="text-[11.5px]">
                <summary className="cursor-pointer text-muted-foreground">Paste instead</summary>
                <Hint>Calendar text, or CSV with the columns <span className="font-mono">type,course,title,date,start,end,room,weight</span>.</Hint>
                <TextArea rows={4} className="my-1.5 min-h-0" value={text} aria-label="Calendar or CSV text" placeholder="Paste calendar or CSV text" onChange={(e) => setText(e.target.value)} />
                <Button variant="ghost" onClick={() => importPasted(text)}>Preview</Button>
            </details>
            {note && <Hint error={note.error}>{note.text}</Hint>}
        </Group>
    )
}

function School() {
    const busy = useUi((u) => u.schoolBusy)
    const asking = useUi((u) => u.schoolAsk)
    const note = useUi((u) => u.schoolNote)
    useProfile()   /* the calendar lives on the profile */
    const cal = schoolCal() as SchoolCalendar | null
    const keep = useRef<HTMLButtonElement>(null)
    useEffect(() => { if (asking) keep.current?.focus() }, [asking])
    const ask = (on: boolean) => { ui.schoolAsk = on; notify() }
    const pick = (label: string) => (
        <FilePick id="schoolFile" label={busy ? "Reading calendar…" : label} busy={busy} accept=".pdf,.docx,.txt,.html,application/pdf" onFile={(f) => void readSchoolFile(f)} />
    )
    return (
        <Group title="School calendar" state={cal ? "on" : "off"} id="schoolGrp">
            {!cal ? <>
                <Hint>Upload your school’s academic calendar (PDF). Term marks days off, breaks and exams, skips classes when there are none, and numbers your weeks.</Hint>
                <Row>{pick("Upload calendar…")}</Row>
            </> : asking ? <>
                <Hint>Remove the school calendar? Classes show every week again, and the term start goes back to the one you had.</Hint>
                <Row>
                    <Button ref={keep} variant="ghost" onClick={() => ask(false)}>Keep</Button>
                    <Button variant="danger" onClick={async () => { ui.schoolAsk = false; await removeSchool() }}>Remove</Button>
                </Row>
            </> : <>
                <span className="flex flex-col gap-px text-[12.5px] text-ink-2">
                    <b className="text-[13.5px] text-foreground">{cal.name || "Your school"}</b>
                    <span>
                        {schoolStatus(cal, today(), shortDate)} · {cal.terms.length} semester{cal.terms.length === 1 ? "" : "s"}, {cal.days.length} special day{cal.days.length === 1 ? "" : "s"}
                    </span>
                </span>
                <Row>
                    <Button variant="ghost" onClick={() => openSchool(null)}>Review dates</Button>
                    {pick("Replace…")}
                    <Button variant="ghost" onClick={() => ask(true)}>Remove</Button>
                </Row>
            </>}
            {note && <Hint error={note.error}>{note.text}</Hint>}
        </Group>
    )
}

/* The calendar feed: a private link Google or Apple Calendar subscribes to. Asked about
   once a session, the first time the Study tab opens; kept in ui.feed across tabs. */
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

/* ── Spotify ── */

const SpotifyMark = () => (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4 flex-none text-[var(--spotify)]">
        <circle cx="12" cy="12" r="12" fill="currentColor" />
        <path d="M6.2 9.4c3.9-1.1 8.4-.8 11.7 1.2M6.9 12.5c3.2-.9 6.9-.6 9.7 1M7.5 15.4c2.5-.7 5.3-.5 7.6.8" fill="none" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
)

function SpotifyTab() {
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
                <SpotifyMark />
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

/* ── Account ── */

function AccountTab({ profile }: { profile: Profile }) {
    const items = useItems(), courses = useCourses()
    const conflicts = useConflicts()
    const status = useSyncStatus()
    const asking = useUi((u) => u.signoutAsk)
    return (
        <>
            <Group title="Data" state={items.length + " items · " + courses.length + " courses"}>
                <Hint>{syncLine({ ...status, lastPull: syncStatus.lastPull })}</Hint>
                <Row><Button variant="ghost" onClick={() => void exportData()}>Export data and saved copies</Button></Row>
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
