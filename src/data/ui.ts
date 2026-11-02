// UI state: what is open, what is filtered, how the table is sorted. Never synced. The
// view, the week and month's schedule and the Study page's tab are remembered per browser
// as a convenience, and the theme and background too, for index.html's script to apply
// before the first paint. It is one object changed in place, with no events: everything
// that changes it then calls the bridge's notify(), whose counter is the snapshot useUi()
// reads.

import { useSyncExternalStore } from "react"
import { today } from "@/core/dates"
import { getVersion, subscribe } from "@/bridge"
import type { Ui } from "./types"
import { toBg } from "./themes"

const KEY = "rounds.ui"

/* The day the Week and the Month last followed as today. */
let followedDay = today()
/**
 * A page left open past midnight: when the day has moved on and the Week or the Month still
 * stands on the old today, it moves to the new one; one you had moved to another date stays.
 * True when the anchor moved.
 */
export function followToday(now = today()): boolean {
    if (now === followedDay) return false
    const was = followedDay
    followedDay = now
    if (ui.anchor !== was) return false
    ui.anchor = now
    return true
}

export const ui: Ui = {
    view: "week", anchor: today(), search: "", course: "all",
    sem: null,               /* the sidebar's semester; null follows the current one */
    types: {}, show: "all",  /* the All items table's type and status chips */
    source: "all",           /* the All items table's Source filter: 'all', 'personal' or 'space:<id>' */
    listFrom: null,          /* 'tile' while the table shows a stat tile's list, course and search aside */
    settingsTab: "you",      /* the Settings tab last shown */
    sort: { key: "date", dir: 1 },
    theme: (typeof window !== "undefined" && window.__roundsTheme) || "system",
    bg: toBg(typeof window !== "undefined" ? window.__roundsBg : undefined),     /* the theme */
    quoteIx: 0,
    schedule: "all",         /* the week and month show 'all', 'deadlines' or 'classes' */
    importNote: null,        /* the last import's result or error, shown once in Settings */
    outlineBusy: false,      /* a course outline is being read */
    spotifyNote: null,       /* 'connected' | 'error' | 'denied' after the Spotify round trip, shown once in Settings */
    /* the music (the Music page, the focus screen's): which list is open, and the filter inside it */
    spotify: { pane: "home", playlistId: null, albumId: null, artistId: null, q: "", filter: "" },
    focus: false,            /* the focus screen is up: the study clock and Spotify, nothing else */
    focusMusic: false,       /* the focus screen's music panel is open */
    study: { courseId: null, itemId: null },   /* what the next study run is logged against */
    studyTab: "timer",       /* the Study page's tab: Timer, Cards, History, Achievements, Leaderboard or Friends */
    /* the Study page's History card: which week and month are shown, the Week, Month or
       Term tab, the day picked on the month's calendar or the heatmap, and a deleted
       session that can still be undone */
    hist: { weekOffset: 0, tab: "week", monthOffset: 0, focusDay: null, undo: null },
    lb: null,                /* the leaderboard from the server, or loading/offline/error */
    lbTab: "week",           /* the leaderboard's This week / All-time switch */
    schoolBusy: false,       /* a school calendar is being read */
    schoolNote: null,        /* the last school calendar read, in Settings */
    schoolAsk: false,        /* Settings is asking before removing the school calendar */
    scheduleBusy: false,     /* a class schedule is being read */
    aiLeft: null,            /* the AI reads left today, as the Worker last said */
    aiLimit: null,           /* the AI reads a day, as the Worker last said */
    aiNote: null,            /* the Import with AI card's last word */
    signoutAsk: null,        /* sign-out waits on a warning about unsynced edits */
    feed: null,              /* the calendar feed as Settings last heard it, once a session */
}

try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "{}") as { view?: string; schedule?: string; monthDeadlines?: boolean; studyTab?: string }
    if (["week", "month", "table", "spotify", "study", "buddy", "admin"].includes(saved.view!)) ui.view = saved.view as Ui["view"]
    if (["all", "deadlines", "classes"].includes(saved.schedule!)) ui.schedule = saved.schedule as Ui["schedule"]
    else if (saved.monthDeadlines === false) ui.schedule = "classes"   /* the month's old Deadlines toggle */
    if (["timer", "cards", "history", "achievements", "leaderboard", "friends"].includes(saved.studyTab!)) ui.studyTab = saved.studyTab as Ui["studyTab"]
} catch {}

export function rememberUi() {
    try { localStorage.setItem(KEY, JSON.stringify({ view: ui.view, schedule: ui.schedule, studyTab: ui.studyTab })) } catch {}
    try { localStorage.setItem("rounds.theme", ui.theme) } catch {}
    try { localStorage.setItem("rounds.bg", ui.bg) } catch {}
}

/**
 * Read from the UI state. The component redraws when the selected value changes, not on
 * every notify(): `ui` is changed in place, so a primitive is compared as it is. A selected
 * object may have been changed in place too, so it redraws after every notify() as it did.
 */
export function useUi<T>(select: (ui: Ui) => T): T {
    useSyncExternalStore(subscribe, () => {
        const v: unknown = select(ui)
        return v !== null && typeof v === "object" ? getVersion() : v
    })
    return select(ui)
}

/** Redraws after every notify(), for a component that reads state `ui` does not hold. */
export function useNotified(): void {
    useSyncExternalStore(subscribe, getVersion)
}
