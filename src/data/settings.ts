// What the Settings sheet says and where it goes: the sync line, the theme's line, which
// tab a deep link opens, the calendar feed's link, a saved copy's values, and the coat
// colour. From legacy views/drawer-settings.js.

import { DEFAULT_COAT } from "@/core/model"
import type { Profile } from "./types"

export type SettingsTab = "you" | "study" | "spotify" | "account"
export const TABS: readonly [SettingsTab, string][] = [["you", "You"], ["study", "Study"], ["spotify", "Spotify"], ["account", "Account"]]

/** Where a deep link lands: the field or group, and the tab it lives on. */
export const TAB_OF: Record<string, SettingsTab> = { "o-name": "you", "o-goal": "you", qText: "you", goalGrp: "study", importGrp: "study", schoolGrp: "study", spotifyGrp: "spotify" }

/** The sync status in a sentence, for the Account tab. */
export function syncLine(s: { state: string; pending: number; message: string; lastPull?: number | null }, now = Date.now()): string {
    const n = s.pending
    if (s.state === "offline") return "Offline — " + (n ? n + " change" + (n === 1 ? "" : "s") + " waiting to sync." : "everything is saved on this device.")
    if (s.state === "error") return "Sync problem: " + (s.message || "unknown") + "."
    if (s.state === "syncing" || s.state === "pending") return "Syncing…"
    return s.lastPull ? "Synced " + Math.max(0, Math.round((now - s.lastPull) / 60000)) + " min ago." : "Synced."
}

/** "following your device — currently dark", "always dark" or "always light". */
export function themeLabel(theme: string, dark: boolean): string {
    if (theme === "system") return "following your device — currently " + (dark ? "dark" : "light")
    return theme === "dark" ? "always dark" : "always light"
}

/** Minutes as "1h 30m", "2h" or "45m". */
export const hm = (m: number) => (m >= 60 ? Math.floor(m / 60) + "h" + (m % 60 ? " " + String(m % 60).padStart(2, "0") + "m" : "") : m + "m")

export const GOALS = [0, 60, 90, 120, 180, 240]
export const GOAL_MAX = 720
export const REST_DAYS: readonly [number, string][] = [[1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [0, "Sun"]]

/** A rest day switched on or off; at most six, so the streak can still grow. */
export const toggleRest = (rest: number[], day: number) => (rest.includes(day) ? rest.filter((x) => x !== day) : rest.length < 6 ? [...rest, day] : rest)

/** The feed's link as calendars get it: with the time zone, so Google places class times right. */
export const feedLink = (url: string, tz: string) => (tz ? url + "?tz=" + encodeURIComponent(tz) : url)

/** This browser's time zone, or "" when it cannot say. */
export function timeZone(): string {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "" } catch { return "" }
}

const LABELS: Record<string, string> = {
    title: "Title", text: "Quote", source: "Source", name: "Course", code: "Code", instructor: "Instructor", term: "Term", date: "Date",
    start: "Start", end: "End", where: "Location", status: "Status", grade: "Grade", weight: "Weight", notes: "Notes", dept: "Department",
    displayName: "Name", theme: "Theme", bg: "Background", termStart: "Term start",
}

type Row = Record<string, unknown> & {
    checklist?: { text: string; done: boolean }[]
    links?: { label: string; url: string }[]
    meetings?: { kind: string; start: string; end: string; room: string }[]
    coat?: { name: string; role: string }
}

/** A saved copy's values as label and text, in a fixed order. */
export function savedValues(row: Row = {}): [string, string][] {
    const out: [string, string][] = []
    for (const [key, label] of Object.entries(LABELS)) {
        const v = row[key]
        if (v !== undefined && v !== null && v !== "") out.push([label, String(v)])
    }
    for (const c of row.checklist || []) out.push(["Checklist", (c.done ? "Done: " : "To do: ") + c.text])
    for (const l of row.links || []) out.push(["Link", (l.label || l.url) + " " + l.url])
    for (const m of row.meetings || []) out.push(["Class", m.kind + " " + m.start + "-" + m.end + " " + m.room])
    if (row.coat) out.push(["Coat", row.coat.name + " " + row.coat.role])
    return out
}

export const coatColour = (profile: Profile | null) => profile?.coat?.color || DEFAULT_COAT

/** The coat colour tints the sidebar fabric, the pocket and the embroidery. */
export function applyCoat(profile: Profile | null) {
    document.documentElement.style.setProperty("--coat", coatColour(profile))
}
