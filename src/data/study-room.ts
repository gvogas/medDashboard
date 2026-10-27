// The study timer in a room (study together): the class picked as the room shows it, and the buttons
// that start, join and re-pick. room.ts holds the room itself.

import * as focus from "./run"
import * as room from "./room"
import { watchPresence } from "./presence"
import { openSheet } from "./overlay"
import { ui } from "./ui"
import type { Flow } from "./types"
import { pickFor, studyLists } from "./study-run"

/* ── study together: the class picked, as the room shows it ── */

/** "BIO 101 · Midterm": what the room sees you studying, from the course and item keys. */
export function labelOf(courseId: string | null, itemId: string | null): string {
    const [courses, items] = studyLists()
    const c = courses.find((x) => x.id === courseId), it = itemId ? items.find((x) => x.id === itemId) : null
    return ((c ? c.code || c.name : "") + (it ? " · " + it.title : "")).slice(0, 60)
}

/** The Study together sheet, with these friends ticked. */
export const openTogether = (invite: string[] = []) => openSheet({ kind: "together", invite })

/* friends see a solo run (presence.ts) */
watchPresence(labelOf)

/** Start a room on `flow` with your class picked for the timer, inviting `invite`. Inside the click. */
export async function startRoomRun(flow: Flow, invite: string[]): Promise<string> {
    const { courseId, itemId } = pickFor(...studyLists(), ui.study)
    if (!courseId) return "Add a course first; study time is logged against one."
    focus.prime()
    return room.startRoom(flow, courseId, itemId, labelOf(courseId, itemId), invite)
}

/* Join while another run is going asks first (as the Study together sheet does): the same Join
   again within JOIN_SURE_MS goes ahead and ends that run. */
export const JOIN_SURE_MS = 15_000
export const JOIN_ENDS_FIRST = "Your current session ends first. Its minutes are saved. Press Join again to go ahead."
let joinAsked: { id: string; at: number } | null = null

/** Join a room with your class picked for the timer. Inside the click. */
export async function joinRoomRun(id: string): Promise<string> {
    const { courseId, itemId } = pickFor(...studyLists(), ui.study)
    if (!courseId) return "Add a course first; study time is logged against one."
    if (focus.active() && room.roomId() !== id) {
        const sure = joinAsked?.id === id && Date.now() - joinAsked.at < JOIN_SURE_MS
        joinAsked = sure ? null : { id, at: Date.now() }
        if (!sure) return JOIN_ENDS_FIRST
    }
    focus.prime()
    const err = await room.joinRoom(id, courseId, itemId, labelOf(courseId, itemId))
    if (err) focus.fullscreen(false)
    return err
}

/** In a room: log to another class from here on. */
export function pickRoomClass(courseId: string, itemId: string | null): Promise<void> {
    ui.study.courseId = courseId
    ui.study.itemId = itemId
    return room.setRoomPick(courseId, itemId, labelOf(courseId, itemId))
}
