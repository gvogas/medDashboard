// The admins' announcement, over the page for everyone signed in, from the profile the
// last sync brought (GET /api/me). Closing it is remembered on this browser by the
// announcement's id, so a new message shows again.

import { useState } from "react"
import { useProfile } from "@/data/store"

const KEY = "rounds.announcementClosed"
const closedId = () => { try { return Number(localStorage.getItem(KEY)) || 0 } catch { return 0 } }

export function AnnouncementBanner() {
    const a = useProfile()?.announcement
    const [closed, setClosed] = useState(closedId)
    if (!a || a.id === closed || a.until <= Date.now()) return null
    const close = () => {
        setClosed(a.id)
        try { localStorage.setItem(KEY, String(a.id)) } catch {}
    }
    return (
        <div role="status" className="mb-3 flex items-start gap-3 rounded-[var(--radius)] border border-[var(--warn-line)] bg-[var(--warn-bg)] px-4 py-2.5 text-[13px] text-[var(--warn-ink)]">
            <p className="m-0 min-w-0 flex-1 whitespace-pre-wrap">{a.text}</p>
            <button type="button" onClick={close} aria-label="Close the announcement"
                className="-my-0.5 flex-none cursor-pointer rounded-md border-0 bg-transparent px-1.5 text-[15px] leading-6 text-[var(--warn-ink)] hover:bg-[color-mix(in_srgb,var(--warn-ink)_12%,transparent)]">✕</button>
        </div>
    )
}
