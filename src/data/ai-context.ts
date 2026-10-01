// What the app already knows that helps an AI read, sent with it: the school calendar's
// semester names (so a read's term matches one of them) and the codes of your courses (so a
// course found is written the way yours is). See worker/ai.js, knownContext.

import { data } from "@/core/store"
import { schoolCal } from "@/data/query"

export function readContext(): { terms?: string; codes?: string } {
    const cal = schoolCal()
    const terms = cal ? cal.terms.map((t) => t.name).join("|") : ""
    const codes = data.courses.filter((c) => !c.archived && c.code).map((c) => c.code).slice(0, 30).join(",")
    return { ...(terms ? { terms } : {}), ...(codes ? { codes } : {}) }
}
