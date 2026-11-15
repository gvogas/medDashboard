// The pages' pictures: one small line drawing per page, beside its name in the sidebar
// (side-nav.tsx) and over it in the phone's bottom bar (phone-nav.tsx). They are
// decoration, so each is hidden from screen readers; the name beside it is what is read.

import type { ReactNode } from "react"
import type { View } from "@/data/types"

const svg = (children: ReactNode) => (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="size-[17px] flex-none">
        {children}
    </svg>
)

export const NAV_ICON: Record<View, ReactNode> = {
    /* a week: the days side by side, as the Week lays them out */
    week: svg(<><rect x="3" y="3.5" width="14" height="13" rx="2" /><path d="M7.67 3.5v13M12.33 3.5v13M3 7.5h14" /></>),
    /* a month: the calendar's grid */
    month: svg(<><rect x="3" y="4.5" width="14" height="12" rx="2" /><path d="M3 8.5h14M7 3v3M13 3v3" /><path d="M6.5 11.5h.01M10 11.5h.01M13.5 11.5h.01M6.5 14h.01M10 14h.01" strokeWidth="2" /></>),
    /* every item: a list */
    table: svg(<path d="M7.5 5.5h9M7.5 10h9M7.5 14.5h9M3.75 5.5h.01M3.75 10h.01M3.75 14.5h.01" />),
    /* study: the timer */
    study: svg(<><circle cx="10" cy="11" r="6" /><path d="M10 7.5V11l2.25 1.5M8 2.75h4" /></>),
    /* music: a note */
    spotify: svg(<><path d="M8 14.5V5l8-1.75v9.5" /><circle cx="6" cy="14.5" r="2" /><circle cx="14" cy="12.75" r="2" /></>),
    /* the buddy: a little face */
    buddy: svg(<><path d="M4.5 9.5a5.5 5.5 0 0 1 11 0v3a4 4 0 0 1-4 4h-3a4 4 0 0 1-4-4z" /><path d="M5.5 6 4.25 3.5M14.5 6l1.25-2.5M8 10.5h.01M12 10.5h.01" /><path d="M8.5 13.25c.9.7 2.1.7 3 0" /></>),
    /* admin: a shield */
    admin: svg(<><path d="M10 2.75 4 5v4.75c0 3.5 2.5 6.25 6 7.5 3.5-1.25 6-4 6-7.5V5z" /><path d="m7.5 10 1.75 1.75L12.75 8" /></>),
}

/** The phone bar's last button, More: three lines, the sidebar's own picture. */
export const MORE_ICON = svg(<path d="M3.5 5.5h13M3.5 10h13M3.5 14.5h13" />)
