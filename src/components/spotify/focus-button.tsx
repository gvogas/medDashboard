// The Music page's way to the focus screen: start a run on the saved flow, or go back to the
// one that is going. With nothing picked to study, the Study page's Timer opens to pick it.
import { openFocus, startRun, useRun } from "@/data/study-timer"
import { setView } from "@/data/study-controller"
import { setStudyTab } from "@/data/study"
import { Icon } from "./bits"

export function FocusButton() {
    const running = useRun() !== null
    return (
        <button
            type="button"
            onClick={() => {
                if (running) { openFocus(); return }
                /* inside the click, so full screen and sound are allowed */
                void startRun().then((ok) => {
                    if (!ok) { setStudyTab("timer"); setView("study") }
                })
            }}
            className="mt-4 inline-flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-full border border-border bg-transparent px-4 font-[inherit] text-[13px] font-semibold text-foreground hover:border-primary hover:text-primary"
        >
            {!running && <Icon name="play" className="size-3" />}
            {running ? "Back to focus" : "Start focus"}
        </button>
    )
}
