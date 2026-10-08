// Term Pro (docs/MONETIZATION.md): what the plan allows, as the last GET /api/me said
// (worker/plans.js). The Worker enforces what costs money (AI reads); the rest is checked
// here. While the paywall is off, everyone has everything.

import { useSyncExternalStore } from "react"
import { api } from "@/core/api"
import { data } from "@/core/store"
import * as sync from "@/core/sync"
import { subscribe } from "@/bridge"
import { openSheet } from "./overlay"
import type { Plan } from "@/core/types"

/** Why the Pro sheet opened, so it can say what the person was reaching for. */
export type ProReason = "ai" | "themes" | "settings"

/** The free plan's theme, Notebook; the six by field come with Pro. */
export const FREE_THEMES: readonly string[] = ["note"]

const FREE_PLAN: Plan = { tier: "free", source: null, expiresAt: null, renews: false, paywall: false }

export const currentPlan = (): Plan => data.profile?.plan || FREE_PLAN

/** Pro's features are open: the person has Pro, or the paywall is off. */
export const hasPro = (): boolean => { const p = currentPlan(); return !p.paywall || p.tier === "pro" }
/** The person really pays for (or was given) Pro. */
export const isPro = (): boolean => currentPlan().tier === "pro"

export const usePro = (): boolean => useSyncExternalStore(subscribe, hasPro)
export const usePlan = (): Plan => useSyncExternalStore(subscribe, currentPlan)

/** May this theme be chosen? */
export const themeOpen = (bg: string): boolean => hasPro() || FREE_THEMES.includes(bg)

export function openPro(reason: ProReason = "settings") {
    openSheet({ kind: "pro", reason })
}

/**
 * After a purchase the store tells RevenueCat, which tells the Worker: usually within seconds.
 * Ask the Worker until it says Pro (about 30 s at most), then sync so the profile has it.
 */
export async function waitForPro(tries = 12, gapMs = 2500): Promise<boolean> {
    for (let i = 0; i < tries; i++) {
        try { if ((await api.plan()).tier === "pro") { await sync.syncNow(); return true } } catch {}
        await new Promise((r) => setTimeout(r, gapMs))
    }
    return false
}
