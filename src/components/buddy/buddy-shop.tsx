// The Buddy page's shop: upgrades (each level costs more and raises an earning rate), then the
// backgrounds and frames (bought once, then put on or taken off). The Worker keeps what you own
// and checks every buy (worker/buddy.js); this only shows GET /api/buddy/shop.

import { useCallback, useEffect, useState } from "react"
import { cn } from "@/lib/utils"
import { Panel } from "@/components/views/bits"
import { Button, Note } from "@/components/sheet/fields"
import type { Shown } from "@/core/buddy-art"
import type { CustomBuddy } from "@/core/buddy-rules"
import type { BuddyState, Shop, ShopItem } from "@/core/types"
import { buy, loadShop, setLook } from "@/data/buddy"
import { BuddySprite } from "./buddy-sprite"

const SMALL = "text-[12.5px] text-muted-foreground"
const ROW = "flex flex-wrap items-center gap-3 border-b border-line-2 py-2.5 last:border-b-0"

/** Why a buy button is off, or "" when it can be pressed. */
export function cannotBuy(item: ShopItem, coins: number): string {
    if (item.cost === null) return item.kind === "upgrade" ? "Top level" : ""
    if (coins < item.cost) return `${item.cost - coins} more coins`
    return ""
}

export function BuddyShop({ b, who, tier, custom }: { b: BuddyState; who: Shown; tier: number; custom: CustomBuddy | null }) {
    const [shop, setShop] = useState<Shop | null>(null)
    const [error, setError] = useState("")
    const [busy, setBusy] = useState("")
    const refresh = useCallback(async () => {
        const s = await loadShop()
        if (typeof s === "string") setError(s)
        else setShop(s)
    }, [])
    useEffect(() => { void refresh() }, [refresh])

    const act = async (key: string, run: () => Promise<string>) => {
        setBusy(key)
        const message = await run()
        setError(message)
        await refresh()
        setBusy("")
    }
    if (!shop) return <Panel title="Shop" label="Shop"><div className="p-4"><Note tone={error ? "bad" : undefined}>{error || "Loading the shop…"}</Note></div></Panel>

    const coins = b.coins
    const upgrades = shop.items.filter((i) => i.kind === "upgrade")
    const looks = shop.items.filter((i) => i.kind === "bg" || i.kind === "frame")
    /* an extra Generate here use (Stage 4): bought again each day, never worn */
    const ai = shop.items.find((i) => i.kind === "ai")
    const worn = (i: ShopItem) => (i.kind === "bg" ? b.look.bg : b.look.frame) === i.sku
    return (
        <Panel title="Shop" label="Shop">
            <div className="flex flex-col gap-1 px-4 py-2">
                {error && <Note tone="bad">{error}</Note>}
                <h3 className="m-0 pt-1 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Upgrades</h3>
                {upgrades.map((i) => {
                    const why = cannotBuy(i, coins)
                    return (
                        <div key={i.sku} className={ROW}>
                            <span className="flex min-w-[150px] flex-1 flex-col">
                                <b className="text-[13.5px] text-foreground">{i.name} <span className="font-normal text-muted-foreground">· level {i.level} of {i.max}</span></b>
                                <span className={SMALL}>{i.effect} per level</span>
                            </span>
                            {i.cost === null ? <span className={SMALL}>Top level</span> : (
                                <Button variant="study" disabled={!!busy || !!why} title={why || undefined}
                                    aria-label={`Buy ${i.name} level ${i.level + 1} for ${i.cost} coins`}
                                    onClick={() => void act(i.sku, () => buy(i.sku, i.level + 1))}>
                                    {busy === i.sku ? "Buying…" : `${i.cost} coins`}
                                </Button>
                            )}
                            {why && i.cost !== null && <span className={cn(SMALL, "basis-full")}>{why}</span>}
                        </div>
                    )
                })}
                {ai && (() => {
                    const why = ai.cost === null ? "" : cannotBuy(ai, coins)
                    return (
                        <div className={ROW}>
                            <span className="flex min-w-[150px] flex-1 flex-col">
                                <b className="text-[13.5px] text-foreground">{ai.name} <span className="font-normal text-muted-foreground">· {ai.level} of {ai.max} today</span></b>
                                <span className={SMALL}>{ai.effect}. Use your own AI is always free.</span>
                            </span>
                            {ai.cost === null ? <span className={SMALL}>All bought today</span> : (
                                <Button variant="study" disabled={!!busy || !!why} title={why || undefined}
                                    aria-label={`Buy an extra AI use for ${ai.cost} coins`}
                                    onClick={() => void act("ai", () => buy("ai", ai.level + 1))}>
                                    {busy === "ai" ? "Buying…" : `${ai.cost} coins`}
                                </Button>
                            )}
                        </div>
                    )
                })()}
                <h3 className="m-0 pt-3 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Backgrounds and frames</h3>
                <div className="grid grid-cols-2 gap-2 py-2 min-[420px]:grid-cols-4 min-[900px]:grid-cols-2">
                    {looks.map((i) => {
                        const owned = i.level >= 1, on = worn(i), why = owned ? "" : cannotBuy(i, coins)
                        const field = i.kind === "bg" ? "bg" : "frame"
                        return (
                            <div key={i.sku} className={cn("flex flex-col items-center gap-1.5 rounded-lg border bg-muted p-2 text-center", on ? "border-[var(--study)]" : "border-border")}>
                                <BuddySprite buddy={who} tier={tier} mood="happy" scale={2} animate={false} label="" custom={custom}
                                    bg={i.kind === "bg" ? i.sku : "none"} frame={i.kind === "frame" ? i.sku : "none"} />
                                <span className="text-[12px] font-semibold text-foreground">{i.name}</span>
                                {owned ? (
                                    <Button variant="ghost" disabled={!!busy} aria-pressed={on}
                                        onClick={() => void act(i.sku, () => setLook({ [field]: on ? "none" : i.sku }))}>
                                        {on ? "Take off" : "Use"}
                                    </Button>
                                ) : (
                                    <Button variant="study" disabled={!!busy || !!why} title={why || undefined}
                                        aria-label={`Buy ${i.name} for ${i.cost} coins`}
                                        onClick={() => void act(i.sku, () => buy(i.sku, 1))}>
                                        {busy === i.sku ? "Buying…" : `${i.cost} coins`}
                                    </Button>
                                )}
                            </div>
                        )
                    })}
                </div>
            </div>
        </Panel>
    )
}
