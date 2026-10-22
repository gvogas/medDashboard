// A room's group record (study together, spec §3): who was there and each person's minutes, the
// sum of their own sessions in it. Fetched when the summary or a History row needs it and kept
// for this page's life; your own row is always your session as this device has it, so an edit
// shows at once and a session not yet uploaded still counts.

import { useEffect, useSyncExternalStore } from "react"
import { api } from "@/core/api"
import { data } from "@/core/store"
import { openSheet } from "./overlay"
import type { GroupRecord } from "./types"

type Entry = { record: GroupRecord | null; error: boolean; at: number }
const cache = new Map<string, Entry>()
const listeners = new Set<() => void>()
const emit = () => { for (const fn of listeners) fn() }
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }
const loading = new Set<string>()

/** Fetch a room's record (again, when `fresh`). */
export async function loadRecord(roomId: string, fresh = false): Promise<void> {
    if (loading.has(roomId) || (!fresh && cache.get(roomId)?.record)) return
    loading.add(roomId)
    try {
        cache.set(roomId, { record: await api.rooms.record(roomId), error: false, at: Date.now() })
    } catch {
        cache.set(roomId, { record: cache.get(roomId)?.record ?? null, error: true, at: Date.now() })
    } finally {
        loading.delete(roomId)
        emit()
    }
}

/** The record with your own minutes from your session here. */
export function withMine(record: GroupRecord, me: string): GroupRecord {
    const mine = data.study_sessions.find((s) => s.id === "r-" + record.roomId)
    if (!mine) return record
    const members = record.members.map((m) => (m.userId === me ? { ...m, minutes: mine.studyMinutes } : m))
    return { ...record, members: [...members].sort((a, b) => b.minutes - a.minutes) }
}

/** A room's record as far as it is known; fetched on first use. */
export function useRecord(roomId: string | null): Entry | null {
    const entry = useSyncExternalStore(subscribe, () => (roomId ? cache.get(roomId) ?? null : null))
    useEffect(() => { if (roomId) void loadRecord(roomId) }, [roomId])
    return entry
}

/** The end-of-session summary, or (from History) the record. */
export const openRecord = (roomId: string, summary = false) => openSheet({ kind: "record", roomId, summary })

/** For tests and sign-out. */
export function resetRecords() { cache.clear(); emit() }
