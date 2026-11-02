// Maintenance mode, as the last sync brought it (GET /api/me, core/maintenance.ts): which
// features the admins have switched off. Everyone but an admin gets the maintenance page
// (components/maintenance.tsx) in place of a page, or of Import with AI, that is off; an
// admin keeps it, under a bar. The Worker refuses the AI reads and the shared routes too.

import { useSyncExternalStore } from "react"
import { data } from "@/core/store"
import { subscribe } from "@/bridge"
import type { Feature } from "@/core/maintenance"

export type { Feature }
export const DEFAULT_MESSAGE = "We’re fixing something here. Your data is safe and keeps syncing. Check back soon."

/** Whether `feature` is switched off, by itself or with the whole app; for admins too. */
export function inMaintenance(feature: Feature): boolean {
    const m = data.profile?.maintenance
    return !!m && (m.features.includes(feature) || m.features.includes("app"))
}

/** "blocked" for everyone but admins, "admin" for an admin using it anyway, null when it is on. */
export type MaintenanceState = "blocked" | "admin" | null
export function maintenanceState(feature: Feature | null): MaintenanceState {
    if (!feature || !inMaintenance(feature)) return null
    return data.profile?.isAdmin ? "admin" : "blocked"
}

/** A page's switch: every page has one but Admin. */
export const pageFeature = (view: string | null): Feature | null =>
    view && ["week", "month", "table", "study", "spotify", "buddy"].includes(view) ? view as Feature : null

/** The admins' message, or the default. */
export const maintenanceMessage = (): string => data.profile?.maintenance?.message || DEFAULT_MESSAGE
/** Whether the admins wrote their own message. */
export const customMessage = (): boolean => !!data.profile?.maintenance?.message

export const useMaintenance = (feature: Feature | null): MaintenanceState =>
    useSyncExternalStore(subscribe, () => maintenanceState(feature))
export const useMaintenanceMessage = (): string => useSyncExternalStore(subscribe, maintenanceMessage)
