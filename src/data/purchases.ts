// In-app purchases in the iPhone and Mac apps, through RevenueCat (docs/MONETIZATION.md).
// The App Store takes the payment; RevenueCat tells the Worker by webhook (worker/plans.js),
// and the Worker's plan is the one the app believes. Loaded only in the app build, on first use.

import { NATIVE } from "@/core/native"
import type { PurchasesPackage } from "@revenuecat/purchases-capacitor"

/** One way to pay, as the store prices it where the person is. */
export interface Offer { id: string; period: "monthly" | "yearly" | "lifetime" | "other"; price: string; pkg: PurchasesPackage }

const KEY = import.meta.env.VITE_REVENUECAT_IOS_KEY || ""
let ready: Promise<typeof import("@revenuecat/purchases-capacitor")> | null = null

/** Whether this build can sell Pro: the app, with a RevenueCat key built in. */
export const canBuy = (): boolean => NATIVE && !!KEY

/* RevenueCat knows the person by our user id, so its webhook names them to the Worker. */
function sdk(userId: string) {
    ready ||= import("@revenuecat/purchases-capacitor").then(async (m) => {
        await m.Purchases.configure({ apiKey: KEY, appUserID: userId })
        return m
    }).catch((e) => { ready = null; throw e })
    return ready
}

const PERIODS: Record<string, Offer["period"]> = { MONTHLY: "monthly", ANNUAL: "yearly", LIFETIME: "lifetime" }

/** The current offering's packages, yearly first. */
export async function offers(userId: string): Promise<Offer[]> {
    const { Purchases } = await sdk(userId)
    const current = (await Purchases.getOfferings()).current
    const order = { yearly: 0, monthly: 1, lifetime: 2, other: 3 }
    return (current?.availablePackages || [])
        .map((pkg) => ({ id: pkg.identifier, period: PERIODS[pkg.packageType] || "other", price: pkg.product.priceString, pkg }))
        .sort((a, b) => order[a.period] - order[b.period])
}

/** Buy: true when bought, false when the person cancelled at Apple's sheet. */
export async function buy(userId: string, offer: Offer): Promise<boolean> {
    const { Purchases } = await sdk(userId)
    try {
        await Purchases.purchasePackage({ aPackage: offer.pkg })
        return true
    } catch (e) {
        if ((e as { userCancelled?: boolean })?.userCancelled) return false
        throw e
    }
}

/** Restore purchases made on another device or before a reinstall; RevenueCat tells the Worker again. */
export async function restore(userId: string): Promise<void> {
    const { Purchases } = await sdk(userId)
    await Purchases.restorePurchases()
}
