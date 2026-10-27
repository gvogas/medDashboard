import { useEffect, type ReactNode } from "react"
import { beforeSheetClose, closeSheet } from "@/data/overlay"
import { useMaintenance, type Feature } from "@/data/maintenance"
import { MaintenancePage } from "@/components/maintenance"
import { SheetBody, SheetHead } from "./fields"

/* While the admins have a feature switched off, everyone else gets the maintenance page in the
   sheet; an admin keeps the card, under the bar (`bar`). */
export function ClassesGate({ kind, feature = "classes", children }: { kind: string; feature?: Feature; children: (bar: boolean) => ReactNode }) {
    const maintenance = useMaintenance(feature)
    if (maintenance !== "blocked") return <>{children(maintenance === "admin")}</>
    return (
        <>
            <SheetHead kind={kind} onClose={closeSheet} />
            <SheetBody><MaintenancePage feature={feature} inSheet /></SheetBody>
        </>
    )
}

/** Run `fn` when the sheet closes or changes (what is typed saves, what was said goes): for the card's life. */
export function useFlushOnClose(fn: () => void) {
    useEffect(() => {
        beforeSheetClose.add(fn)
        return () => { beforeSheetClose.delete(fn) }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
}
