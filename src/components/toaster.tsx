// The toast at the foot of the screen (src/data/toast.ts holds it). Mounted outside #app,
// so it stays reachable while a drawer makes the page behind it inert. Bottom left; on
// phones, full width above the round New item button.

import { motion, useReducedMotion } from "framer-motion"
import { hideToast, runToastAction, useToast, type Toast } from "@/data/toast"
import { TextureCard } from "@/components/ui/texture-card"
import { TextureButton } from "@/components/ui/texture-button"
import { cn } from "@/lib/utils"
import { TONE } from "@/components/study/achievements"

export function Toaster() {
    const t = useToast()
    /* Both live regions stay on the page and the card appears inside one: screen readers
       announce content added to a region they already know more reliably than a new one. */
    return (
        <>
            <div role="status" aria-live="polite">{t && !t.error && <Card t={t} />}</div>
            <div role="alert" aria-live="assertive">{t?.error && <Card t={t} />}</div>
        </>
    )
}

function Card({ t }: { t: Toast }) {
    const reduced = useReducedMotion()
    return (
        <motion.div
            key={t.id}
            initial={reduced ? false : { opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ type: "spring", stiffness: 520, damping: 32 }}
            className={cn(
                "fixed bottom-[calc(18px+env(safe-area-inset-bottom,0px))] left-[18px] z-[70] max-w-[min(440px,calc(100vw-36px))]",
                /* beside the sidebar on wide screens, not over the coat or badge */
                "min-[901px]:left-[240px]",
                "max-[640px]:right-3 max-[640px]:left-3 max-[640px]:bottom-[calc(84px+env(safe-area-inset-bottom,0px))] max-[640px]:max-w-none"
            )}
        >
            <TextureCard className="bg-card shadow-[var(--shadow-2)]">
                <div className={cn("flex items-center gap-2 py-1.5 pr-1.5 pl-4 text-sm", t.error ? "text-destructive" : "text-foreground")}>
                    {t.error && <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-destructive" />}
                    {t.badge && (t.badge.sticker
                        ? <img src={t.badge.sticker} alt="" width={36} height={36} className="-ml-1.5 block size-9 flex-none drop-shadow-[0_2px_3px_rgba(0,0,0,.25)]" />
                        : <span aria-hidden="true" className={cn("-ml-1.5 grid size-8 flex-none place-items-center rounded-full bg-[var(--g-soft)] text-[10.5px] font-extrabold text-[var(--g-ink)] shadow-[inset_0_0_0_2px_var(--g)]", TONE[t.badge.group])}>{t.badge.tier}</span>)}
                    <span className="flex-1 leading-snug">{t.text}</span>
                    {t.undo && (
                        <TextureButton type="button" variant="minimal" size="sm" className="w-auto shrink-0" onClick={runToastAction}>
                            <span className="font-semibold text-foreground">{t.label}</span>
                        </TextureButton>
                    )}
                    <button
                        type="button"
                        aria-label="Dismiss"
                        onClick={hideToast}
                        className="grid size-10 shrink-0 cursor-pointer place-items-center rounded-lg border-0 bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                        ✕
                    </button>
                </div>
            </TextureCard>
        </motion.div>
    )
}
