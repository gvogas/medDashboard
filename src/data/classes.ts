// Shared classes on this device (spec §11, §13, §15): opening their sheets, your invites,
// making a class, and the words for what went wrong. Shown to admins only until classes
// open to everyone (Stage 6); the Worker refuses anyone else too. Every call needs a
// connection; the class itself arrives by sync like everything else, and its rows stay out
// of the views until Stage 4 (effective.ts, SHARED_IN_VIEWS).

import { useSyncExternalStore } from "react"
import { api, ApiError } from "@/core/api"
import { data } from "@/core/store"
import * as sync from "@/core/sync"
import { HEXES } from "@/core/model"
import { REVIEW_ID } from "@/core/shared"
import { openSheet, type ClassTab } from "./overlay"
import { toast } from "./toast"
import type { Course, Invite, Item, Space, SpaceSummary } from "./types"

/* ── the sheets ── */

export const openClass = (spaceId: string, tab: ClassTab = "details") => openSheet({ kind: "class", spaceId, tab })
export const openNewClass = () => openSheet({ kind: "new-class" })
export const openConvert = (courseId: string) => openSheet({ kind: "convert", courseId })
/** Join with a code (`code`, from a link, fills it in), or follow a class just joined (`space`) while it downloads. */
export const openJoin = (code = "", space: SpaceSummary | null = null) => openSheet({ kind: "join", code, space })
export const openInvites = () => openSheet({ kind: "invites" })

/* ── your invites ── */

let invites: Invite[] = []
const listeners = new Set<() => void>()
const emit = () => { for (const fn of listeners) fn() }
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }

/** Your invites as last fetched: pending ones, the expired marked. */
export const useInvites = () => useSyncExternalStore(subscribe, () => invites)
export const getInvites = () => invites

/** Fetch your invites; offline, the last list stays. Admins only until Stage 6. */
export async function refreshInvites(): Promise<void> {
    if (!data.profile?.isAdmin) return
    try { invites = (await api.invites.list()).invites; emit() } catch { /* offline or signed out: keep the last list */ }
}

let watching = false
/** Fetch your invites now, and again whenever Term comes back into view. */
export function watchInvites(): void {
    void refreshInvites()
    if (watching) return
    watching = true
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void refreshInvites() })
}

const answered = (spaceId: string) => { invites = invites.filter((i) => i.spaceId !== spaceId); emit() }

/** Accept an invite: the Worker makes you a member, and the class downloads with the next sync. */
export async function accept(spaceId: string): Promise<SpaceSummary> {
    const space = await api.invites.accept(spaceId)
    answered(spaceId)
    return space
}
export async function decline(spaceId: string): Promise<void> {
    await api.invites.decline(spaceId)
    answered(spaceId)
}
/** Join with a code; a pending invite to the same class is accepted with it. */
export async function joinWithCode(code: string): Promise<SpaceSummary> {
    const space = await api.join(code)
    answered(space.id)
    return space
}

/* ── a class arriving on this device ── */

/** The class and its course are on this device. */
export const landed = (id: string): boolean =>
    data.spaces.some((s) => s.id === id) && data.shared_courses.some((c) => c.scope === "c:" + id)

/** Sync until a class just made or joined is here, a few times at most: false if it has not
    come (offline); it then arrives with a later sync. */
export async function download(id: string, tries = 4): Promise<boolean> {
    for (let i = 0; i < tries && !landed(id); i++) await sync.syncNow()
    return landed(id)
}

/* ── making a class ── */

/** How an item of your course goes into a class made from it (spec §13): tasks start
    unticked; lecture reviews and items of your own types cannot go, and stay yours. */
export function convertChoice(it: Pick<Item, "id" | "type">): { can: boolean; ticked: boolean; why: string } {
    if (it.type === "task" && REVIEW_ID.test(it.id)) return { can: false, ticked: false, why: "A lecture review: stays yours" }
    if (it.type.startsWith("c-")) return { can: false, ticked: false, why: "Your own type: stays yours" }
    return { can: true, ticked: it.type !== "task", why: "" }
}

/** The class you own that was made from your course `courseId`, if any. */
export function classFrom(courseId: string, spaces: Space[], shared: { scope: string; id: string }[]): Space | null {
    return spaces.find((s) => s.kind === "class" && s.role === "owner" && shared.some((c) => c.scope === s.scope && c.id === courseId)) ?? null
}

/** A colour none of your courses uses yet, for a new class. */
export const freeColour = (courses: Pick<Course, "color">[]): string => HEXES.find((h) => !courses.some((c) => c.color === h)) ?? HEXES[0]

async function arrive(space: SpaceSummary): Promise<void> {
    await download(space.id)
    openClass(space.id, "members")
}

/** A blank class: its course has the name and code given, and a colour you do not use yet. */
export async function makeBlank(name: string, code: string): Promise<void> {
    const space = await api.spaces.create({ kind: "class", course: { code, name, color: freeColour(data.courses), instructor: "", term: "", meetings: [] } })
    await arrive(space)
}

/** A class from your course `courseId` with the items picked. Stage 3 copies: your own course stays as it is. */
export async function convert(courseId: string, items: string[]): Promise<void> {
    const space = await api.spaces.create({ kind: "class", convertCourseId: courseId, items })
    await arrive(space)
    toast(space.name + " is now a shared class too. Your own course stays as it is.")
}

/* ── words ── */

export const formatCode = (code: string) => code.slice(0, 4) + " " + code.slice(4)
export const joinLink = (code: string) => location.origin + "/#join=" + code

/** What a failed class call says; `name` is the username it was about. */
export function messageFor(e: unknown, name = ""): string {
    if (!(e instanceof ApiError)) return "You seem to be offline. This needs a connection."
    const code = e.body?.error
    if (code === "no_user") return `No Term account named '${name}'.`
    if (code === "member") return `${name} is already a member.`
    if (code === "not_admin") return `${name} can't join shared classes yet: they're open to admins only for now.`
    if (code === "limit") return "You're in 20 classes and projects, the most anyone can be in."
    if (code === "full") return "This class is full: 30 people is the most it holds."
    if (code === "expired") return "That has expired. Ask for a new code or invite."
    if (code === "not_found") return "That doesn't match a class. The code or invite may have been withdrawn."
    if (code === "forbidden") return "Only the class's owner can do that."
    if (code === "rate_limited") return "Too many tries. Wait a while, then try again."
    if (code === "invalid") return e.body?.field === "code" ? "A code is 8 characters." : "Something in that isn't valid."
    return "That didn't work (" + (code || e.status) + "). Try again."
}
