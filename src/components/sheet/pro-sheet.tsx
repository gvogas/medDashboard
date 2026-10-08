// Term Pro (docs/MONETIZATION.md): what it adds, the store's prices and Buy in the app, and
// Restore. Opened from Settings, or by reaching for something Pro has (the reason says what).
// The browser has no store: it says where to get Pro. Apple asks for the price, the period,
// that it renews, and links to the terms and the privacy policy next to the button.

import { useEffect, useState } from "react"
import { data } from "@/core/store"
import { closeSheet } from "@/data/overlay"
import { isPro, usePlan, waitForPro, type ProReason } from "@/data/plan"
import { canBuy, offers, buy, restore, type Offer } from "@/data/purchases"
import { dayMonth, iso } from "@/core/dates"
import { Button, Note, SheetBody, SheetFoot, SheetHead } from "./fields"

const WHY: Record<ProReason, string> = {
    ai: "You have used today's free AI reads.",
    themes: "That theme comes with Term Pro.",
    settings: "",
}

/* What Pro adds; the free plan keeps courses, items, the week and month, grades and the timer. */
export const PRO_FEATURES = [
    ["More AI imports", "10 reads a day of outlines, timetables and school calendars, instead of 3."],
    ["Every theme", "All six themes, each with its picture, wording and animation."],
    ["Support a small app", "Pro pays for the servers and the AI, and keeps Term free of ads."],
] as const

const PERIOD = { yearly: "a year", monthly: "a month", lifetime: "once", other: "" }
const TERMS = "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/"
const PRIVACY = "/privacy.html"

export function ProSheet({ reason }: { reason: ProReason }) {
    const plan = usePlan()
    const userId = data.profile?.id || ""
    const [list, setList] = useState<Offer[] | null>(null)
    const [busy, setBusy] = useState(false)
    const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null)

    useEffect(() => {
        if (!canBuy() || !userId) return
        offers(userId).then(setList).catch(() => setNote({ text: "The App Store could not be reached. Try again in a moment.", bad: true }))
    }, [userId])

    const settle = async (text: string) => {
        setNote({ text: "Confirming with the App Store…" })
        setNote(await waitForPro() ? { text } : { text: "The App Store has your purchase; Term will show Pro within a few minutes.", bad: false })
    }
    const purchase = async (offer: Offer) => {
        setBusy(true); setNote(null)
        try { if (await buy(userId, offer)) await settle("Welcome to Term Pro.") }
        catch { setNote({ text: "The purchase did not go through. You have not been charged.", bad: true }) }
        finally { setBusy(false) }
    }
    const restoreAll = async () => {
        setBusy(true); setNote(null)
        try { await restore(userId); await settle("Your purchase is restored.") }
        catch { setNote({ text: "Nothing to restore on this Apple account.", bad: true }) }
        finally { setBusy(false) }
    }

    return (
        <>
            <SheetHead kind="Term Pro" onClose={closeSheet} />
            <SheetBody>
                <h2 className="m-0 text-[22px] leading-[1.22] font-[750] tracking-[-.02em]">Term Pro</h2>
                {WHY[reason] && <Note>{WHY[reason]}</Note>}
                {isPro() ? (
                    <Note tone="ok">
                        You have Term Pro{plan.source === "comp" ? ", as a gift" : ""}
                        {plan.expiresAt ? `${plan.renews ? ", renewing" : ", until"} ${dayMonth(iso(new Date(plan.expiresAt)))}` : ""}. Thank you.
                    </Note>
                ) : !plan.paywall ? <Note>Everything is open while Term is in early access.</Note> : null}
                <ul aria-label="What Term Pro adds" className="m-0 flex list-none flex-col gap-2 p-0">
                    {PRO_FEATURES.map(([title, text]) => (
                        <li key={title} className="rounded-lg bg-muted px-3 py-2 text-[12.5px]">
                            <b className="block text-[13px]">{title}</b>
                            <span className="text-muted-foreground">{text}</span>
                        </li>
                    ))}
                </ul>
                {!isPro() && (canBuy() ? (
                    list === null ? <Note>Loading prices…</Note> : (
                        <div className="flex flex-col gap-2">
                            {list.map((o) => (
                                <Button key={o.id} disabled={busy} onClick={() => void purchase(o)}>
                                    {o.price} {PERIOD[o.period] && <span className="font-normal opacity-80">{PERIOD[o.period]}</span>}
                                </Button>
                            ))}
                            <p className="m-0 text-[11px] leading-snug text-muted-foreground">
                                Subscriptions renew until you cancel in your Apple account settings, at least a day before the period ends.{" "}
                                <a href={TERMS} target="_blank" rel="noreferrer">Terms of use</a> · <a href={PRIVACY} target="_blank" rel="noreferrer">Privacy</a>
                            </p>
                        </div>
                    )
                ) : plan.paywall && <Note>Get Term Pro in the Term app for iPhone, iPad and Mac. It works here too once you have it.</Note>)}
                {note && <Note tone={note.bad ? "bad" : "ok"}>{note.text}</Note>}
            </SheetBody>
            <SheetFoot hint="">
                {canBuy() && !isPro() && <Button variant="ghost" disabled={busy} onClick={() => void restoreAll()}>Restore purchases</Button>}
                {canBuy() && plan.source === "app_store" && <a className="text-[12px]" href="https://apps.apple.com/account/subscriptions" target="_blank" rel="noreferrer">Manage subscription</a>}
                <Button variant="ghost" onClick={closeSheet}>Close</Button>
            </SheetFoot>
        </>
    )
}
