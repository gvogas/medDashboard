// For tests: @/data/ui over a fake ui object, so a test sets only the fields it reads.
//   vi.mock("@/data/ui", async () => (await import("@/data/fake-ui")).fakeUi(fake.ui))

import { useSyncExternalStore } from "react"
import { getVersion, subscribe } from "@/bridge"
import type { Ui } from "./types"

export function fakeUi(fake: object) {
    const ui = fake as Ui
    return {
        ui,
        rememberUi: () => {},
        useUi<T>(select: (ui: Ui) => T): T {
            useSyncExternalStore(subscribe, getVersion)
            return select(ui)
        },
        useNotified() {
            useSyncExternalStore(subscribe, getVersion)
        },
    }
}
