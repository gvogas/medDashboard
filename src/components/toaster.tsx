// The toasts at the foot of the screen (src/data/toast.ts holds them). Mounted outside #app,
// so they stay reachable while a drawer makes the page behind them inert. Bottom left; on
// phones, full width above the round New item button. The toasts with an Undo share one card.

import { hideToast, holdToasts, runToastAction, useToast, useUndoToasts, type Toast } from "@/data/toast"
import { Card } from "@/components/ui/card"
import { TextureButton } from "@/components/ui/texture-button"
import { cn } from "@/lib/utils"
import { TONE } from "@/components/study/achievements"

export function Toaster() {
    const notice = useToast()
    const undos = useUndoToasts()
    /* Both live regions stay on the page and the card appears inside one: screen readers
       announce content added to a region they already know more reliably than a new one. */
    const polite = notice && !notice.error ? [...undos, notice] : undos
    return (
        <>
            <div role="status" aria-live="polite">{polite.length > 0 && <ToastCard rows={polite} />}</div>
            <div role="alert" aria-live="assertive">{notice?.error && <ToastCard rows={[notice]} />}</div>
        </>
    )
}

function ToastCard({ rows }: { rows: Toast[] }) {
    /* the card springs up when a toast first appears (.toast-in, src/index.css): a CSS
       animation, so framer-motion stays out of the first load. The pointer on it, or focus
       inside, holds its toasts still, so an Undo can be read and reached before the time runs out. */
    return (
        <div
            className={cn(
                "toast-in fixed bottom-[calc(18px+env(safe-area-inset-bottom,0px))] left-[18px] z-[70] max-w-[min(440px,calc(100vw-36px))]",
                /* beside the sidebar on wide screens, not over the coat or badge */
                "min-[901px]:left-[240px]",
                "max-[640px]:right-3 max-[640px]:left-3 max-[640px]:bottom-[calc(84px+env(safe-area-inset-bottom,0px))] max-[640px]:max-w-none"
            )}
            onPointerEnter={() => holdToasts("pointer", true)}
            onPointerLeave={() => holdToasts("pointer", false)}
            onFocus={() => holdToasts("focus", true)}
            onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) holdToasts("focus", false) }}
        >
            <Card className="shadow-[var(--shadow-2)]">
                {rows.map((t) => (
                    <div key={t.id} className={cn("flex items-center gap-2 py-1.5 pr-1.5 pl-4 text-sm", t.error ? "text-destructive" : "text-foreground")}>
                        {t.error && <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-destructive" />}
                        {t.badge && (t.badge.sticker
                            ? <img src={t.badge.sticker} alt="" width={36} height={36} className="-ml-1.5 block size-9 flex-none drop-shadow-[0_2px_3px_rgba(0,0,0,.25)]" />
                            : <span aria-hidden="true" className={cn("-ml-1.5 grid size-8 flex-none place-items-center rounded-full bg-[var(--g-soft)] text-[10.5px] font-extrabold text-[var(--g-ink)] shadow-[inset_0_0_0_2px_var(--g)]", TONE[t.badge.group])}>{t.badge.tier}</span>)}
                        <span className="flex-1 leading-snug">{t.text}</span>
                        {t.undo && (
                            <TextureButton type="button" variant="minimal" size="sm" className="shrink-0" onClick={() => runToastAction(t.id)}>
                                <span className="font-semibold text-foreground">{t.label}</span>
                            </TextureButton>
                        )}
                        <button
                            type="button"
                            aria-label="Dismiss"
                            onClick={() => hideToast(t.id)}
                            className="grid size-10 shrink-0 cursor-pointer place-items-center rounded-lg border-0 bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                            ✕
                        </button>
                    </div>
                ))}
            </Card>
        </div>
    )
}
