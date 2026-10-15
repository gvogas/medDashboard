// The bell in the top bar (spec §15): the inbox, with how much in it is unread. The count
// comes with each sync; nothing is pushed. While the admins have shared classes switched
// off, someone who is not an admin sees no count: the bell opens the maintenance page.

import { TextureButton } from "@/components/ui/texture-button"
import { openInbox, useUnread } from "@/data/inbox"
import { useMaintenance } from "@/data/maintenance"

export function InboxBell() {
    const unread = useUnread()
    const n = useMaintenance("classes") === "blocked" ? 0 : unread
    return (
        <TextureButton variant="minimal" size="sm" aria-label={n ? `Inbox, ${n} unread` : "Inbox"} title="Inbox" onClick={openInbox} className="relative">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="size-4">
                <path d="M4 11V7a4 4 0 0 1 8 0v4l1.5 1.5h-11zM6.5 14a1.5 1.5 0 0 0 3 0" />
            </svg>
            {n > 0 && (
                <span aria-hidden="true" className="absolute -top-1 -right-1 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] leading-4 font-semibold text-primary-foreground">
                    {n}
                </span>
            )}
        </TextureButton>
    )
}
