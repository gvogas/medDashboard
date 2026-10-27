// Maintenance mode as the Worker sends it with GET /api/me (worker/maintenance.js): the
// features the admins have switched off while they work on them, and their message.

import { MESSAGE_MAX } from "./shared.ts"

/** A page (as in side-nav.tsx's PAGES), Import with AI, shared classes & projects, friends, or the whole app. */
export type Feature = "app" | "week" | "month" | "table" | "study" | "spotify" | "import" | "classes" | "friends"
export const FEATURES: readonly Feature[] = ["app", "week", "month", "table", "study", "spotify", "import", "classes", "friends"]

export interface Maintenance { features: Feature[]; message: string; updatedAt: number | null }

/** The server's value checked as other server data is: null when nothing is on or it is not readable. */
export function parseMaintenance(raw: unknown): Maintenance | null {
    if (!raw || typeof raw !== "object" || !Array.isArray((raw as Maintenance).features)) return null
    const m = raw as { features: unknown[]; message?: unknown; updatedAt?: unknown }
    const features = FEATURES.filter((f) => m.features.includes(f))
    if (!features.length) return null
    return {
        features,
        message: typeof m.message === "string" ? m.message.slice(0, MESSAGE_MAX) : "",
        updatedAt: Number.isSafeInteger(m.updatedAt) ? m.updatedAt as number : null,
    }
}
