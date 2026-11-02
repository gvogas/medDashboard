// The header badge while gameplay is on: the buddy at actual size and the coins. A tap opens
// the Buddy page. It pulses while a rank is reached but not yet claimed.

import { cn } from "@/lib/utils"
import { TextureButton } from "@/components/ui/texture-button"
import { buddyName, shownFor } from "@/core/buddy-art"
import { TIERS } from "@/core/buddy-rules"
import { activeBuddy, useBuddy } from "@/data/buddy"
import { useMaintenance } from "@/data/maintenance"
import { useProfile } from "@/data/store"
import { setView } from "@/data/study-controller"
import { BuddySprite } from "./buddy-sprite"
import { dueToday, reviewedToday, useFlashcards } from "@/data/cards"

export function BuddyBadge() {
    const b = activeBuddy(useBuddy())
    const bg = useProfile()?.bg ?? "med"
    const blocked = useMaintenance("buddy") === "blocked"
    const cards = useFlashcards()
    if (!b || blocked) return null
    const who = shownFor(b.look, bg, b.custom)
    const name = b.look.name || buddyName(who)
    const tier = Math.max(0, TIERS.findIndex((t) => t.id === b.tier))
    const toClaim = b.tiers.some((t) => t.reached && !t.claimed)
    /* cards due and none reviewed today: a tired face, as a nudge (the look only; health is the Worker's) */
    const nudge = b.mood === "happy" && dueToday(cards) > 0 && !reviewedToday(cards)
    return (
        <TextureButton variant="minimal" size="sm" onClick={() => setView("buddy")}
            aria-label={`${name}: ${b.coins.toLocaleString()} coins${toClaim ? ", a rank to claim" : ""}${nudge ? ", cards due" : ""}`}
            title={toClaim ? "A rank to claim" : name}
            className={cn("gap-1.5 pl-1", toClaim && "motion-safe:animate-pulse")}>
            <BuddySprite buddy={who} tier={tier} mood={nudge ? "tired" : b.mood} scale={1} label="" custom={b.custom} />
            <span className="font-mono text-[12px] tabular-nums">{b.coins.toLocaleString()}</span>
        </TextureButton>
    )
}
