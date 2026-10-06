import { describe, expect, it } from "vitest"
import { parseMaintenance } from "./maintenance"

describe("parseMaintenance", () => {
    it("keeps the known features and the message", () => {
        expect(parseMaintenance({ features: ["week", "import", "nope", 3], message: "Back soon.", updatedAt: 5 }))
            .toEqual({ features: ["week", "import"], message: "Back soon.", updatedAt: 5 })
    })

    it("is null for nothing on, or anything it cannot read", () => {
        for (const raw of [null, undefined, "week", 5, {}, { features: "week" }, { features: [] }, { features: ["nope"] }]) {
            expect(parseMaintenance(raw), JSON.stringify(raw)).toBeNull()
        }
    })

    it("drops a message that is not text, and cuts a long one", () => {
        expect(parseMaintenance({ features: ["app"], message: 7 })).toEqual({ features: ["app"], message: "", updatedAt: null })
        expect(parseMaintenance({ features: ["app"], message: "x".repeat(400) })!.message).toHaveLength(280)
    })
})
