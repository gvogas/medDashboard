// The Admin page, in #views, for accounts with users.is_admin: six tabs. Overview is
// the free-tier meters, traffic and health; Accounts creates and manages accounts and
// lifts sign-in locks; Errors and Audit log read the Worker's logs; Announcement puts a
// banner in front of everyone; Maintenance switches features off while you fix them. Only the open tab is drawn, and it loads when it opens.
// The Worker refuses every call to anyone else, whatever this page shows.

import { useState } from "react"
import { cn } from "@/lib/utils"
import { useProfile } from "@/data/store"
import { tabKeys } from "@/components/sheet/radio-keys"
import { Empty } from "@/components/views/bits"
import { Overview } from "./overview"
import { Accounts } from "./accounts"
import { Errors } from "./errors"
import { AuditLog } from "./audit"
import { AnnouncementTab } from "./announcement"
import { MaintenanceTab } from "./maintenance"
import { StudyAiTab } from "./study-ai"

type Tab = "overview" | "accounts" | "errors" | "audit" | "announcement" | "maintenance" | "studyai"
const TABS: readonly [Tab, string][] = [["overview", "Overview"], ["accounts", "Accounts"], ["errors", "Errors"], ["audit", "Audit log"], ["announcement", "Announcement"], ["maintenance", "Maintenance"], ["studyai", "Study AI"]]
const KEY = "rounds.adminTab"

function savedTab(): Tab {
    try {
        const t = localStorage.getItem(KEY)
        if (TABS.some(([id]) => id === t)) return t as Tab
    } catch {}
    return "overview"
}

export function AdminPage() {
    const admin = !!useProfile()?.isAdmin
    const [open, setOpen] = useState<Tab>(savedTab)
    const pick = (t: Tab) => {
        setOpen(t)
        try { localStorage.setItem(KEY, t) } catch {}
    }
    if (!admin) return <Empty title="Admins only">This page is for admin accounts.</Empty>
    return (
        <div className="grid gap-4 pb-1.5">
            <div role="tablist" aria-label="Admin" onKeyDown={tabKeys}
                className="flex gap-1 overflow-x-auto border-b border-border [scrollbar-width:none]">
                {TABS.map(([id, label]) => (
                    <button
                        key={id}
                        type="button"
                        role="tab"
                        id={"admin-tab-" + id}
                        aria-selected={open === id}
                        aria-controls={open === id ? "admin-panel" : undefined}
                        tabIndex={open === id ? 0 : -1}
                        onClick={() => pick(id)}
                        className={cn(
                            "h-[42px] flex-none cursor-pointer border-0 bg-transparent px-3.5 font-[inherit] outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--accent)] text-[13.5px] max-[520px]:px-2.5",
                            open === id ? "font-semibold text-foreground shadow-[inset_0_-2px_0_var(--primary)] focus-visible:shadow-[inset_0_0_0_2px_var(--accent),inset_0_-2px_0_var(--primary)]" : "font-medium text-muted-foreground hover:text-foreground",
                        )}
                    >
                        {label}
                    </button>
                ))}
            </div>
            <div role="tabpanel" id="admin-panel" aria-labelledby={"admin-tab-" + open} tabIndex={0} className="min-w-0 rounded-[var(--radius)] outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--accent)]">
                {open === "overview" && <Overview />}
                {open === "accounts" && <Accounts />}
                {open === "errors" && <Errors />}
                {open === "audit" && <AuditLog />}
                {open === "announcement" && <AnnouncementTab />}
                {open === "maintenance" && <MaintenanceTab />}
                {open === "studyai" && <StudyAiTab />}
            </div>
        </div>
    )
}
