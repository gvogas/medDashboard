// The header badge while gameplay is on: the buddy at actual size and the coins. A tap opens
// the Buddy page. It pulses while a rank is reached but not yet claimed.

import { cn } from "@/lib/utils"
import { TextureButton } from "@/components/ui/texture-button"
import { BUDDIES, buddyFor } from "@/core/buddy-art"
import { TIERS } from "@/core/buddy-rules"
import { activeBuddy, useBuddy } from "@/data/buddy"
import { useMaintenance } from "@/data/maintenance"
import { useProfile } from "@/data/store"
import { setView } from "@/data/study-controller"
import { BuddySprite } from "./buddy-sprite"

export function BuddyBadge() {
    const b = activeBuddy(useBuddy())
    const bg = useProfile()?.bg ?? "med"
    const blocked = useMaintenance("buddy") === "blocked"
    if (!b || blocked) return null
    const who = buddyFor(b.look, bg)
    const name = b.look.name || BUDDIES[who].name
    const tier = Math.max(0, TIERS.findIndex((t) => t.id === b.tier))
    const toClaim = b.tiers.some((t) => t.reached && !t.claimed)
    return (
        <TextureButton variant="minimal" size="sm" onClick={() => setView("buddy")}
            aria-label={`${name}: ${b.coins.toLocaleString()} coins${toClaim ? ", a rank to claim" : ""}`}
            title={toClaim ? "A rank to claim" : name}
            className={cn("gap-1.5 pl-1", toClaim && "motion-safe:animate-pulse")}>
            <BuddySprite buddy={who} tier={tier} mood={b.mood} scale={1} label="" />
            <span className="font-mono text-[12px] tabular-nums">{b.coins.toLocaleString()}</span>
        </TextureButton>
    )
}
