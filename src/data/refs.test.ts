import { describe, expect, it, vi } from "vitest"

vi.mock("@/core/store", () => ({
    data: { spaces: [{ id: "abcdefghij12", scope: "c:abcdefghij12" }, { id: "fire00000001", scope: "p:fire00000001" }], shared_courses: [{ scope: "c:abcdefghij12", id: "web" }] },
    subscribe: () => () => {},
}))

import { classCourseKey, courseRefKey, isSharedKey, itemCourseKey, itemRefKey, keyedAchievements, keyedCourses, keyedItems, keyedSessions, leftClass, leftSpaceLabel, placeCourse, refOf, splitKey } from "./refs"
import type { Achievement, Course, Item, StudySession } from "./types"

const WEB = "c:abcdefghij12"
const session = (over: Partial<StudySession>): StudySession => ({ id: "s", courseId: "bio", itemId: null, startedAt: 1, studyMinutes: 30, roundsDone: 0, note: "", manual: false, ...over })

describe("keys", () => {
    it("tell a shared row's key from a personal id, and split it", () => {
        expect(isSharedKey(WEB + "/a1")).toBe(true)
        expect(isSharedKey("a1")).toBe(false)
        expect(isSharedKey("c:short/a1")).toBe(false)
        expect(splitKey(WEB + "/a/1")).toEqual({ scope: WEB, spaceId: "abcdefghij12", id: "a/1" })
        expect(splitKey("bio")).toEqual({ scope: null, spaceId: null, id: "bio" })
    })

    it("give a session on a class its course and item keys, and split them back for saving", () => {
        const s = session({ courseId: "web", itemId: "a1", spaceId: "abcdefghij12" })
        expect([courseRefKey(s), itemRefKey(s)]).toEqual([WEB + "/web", WEB + "/a1"])
        expect([courseRefKey(session({})), itemRefKey(session({ itemId: "x" }))]).toEqual(["bio", "x"])
        expect(refOf(WEB + "/web", WEB + "/a1")).toEqual({ courseId: "web", itemId: "a1", spaceId: "abcdefghij12" })
        expect(refOf("bio", null)).toEqual({ courseId: "bio", itemId: null, spaceId: null })
        // an item of yours filed under the class, picked with the class course: the item wins
        expect(refOf(WEB + "/web", "rv1")).toEqual({ courseId: null, itemId: "rv1", spaceId: null })
        // a team project in the pickers (projects.ts withProjects): its own row is the course, a task the item
        const PRJ = "p:fire00000001"
        expect(refOf(PRJ + "/project", PRJ + "/t1")).toEqual({ courseId: "project", itemId: "t1", spaceId: "fire00000001" })
        const p = session({ courseId: "project", itemId: "t1", spaceId: "fire00000001" })
        expect([courseRefKey(p), itemRefKey(p)]).toEqual([PRJ + "/project", PRJ + "/t1"])
    })

    it("name a space you left: a project's sessions keep a project's key, and say so", () => {
        const p = session({ courseId: "project", itemId: "t1", spaceId: "gone00000001" })
        expect([courseRefKey(p), itemRefKey(p)]).toEqual(["p:gone00000001/project", "p:gone00000001/t1"])
        const c = session({ courseId: "web", itemId: "a1", spaceId: "gone00000002" })
        expect(courseRefKey(c)).toBe("c:gone00000002/web")
        expect(leftClass(courseRefKey(p))).toBe(true)
        expect(leftSpaceLabel(courseRefKey(p))).toBe("A project you left")
        expect(leftSpaceLabel(courseRefKey(c))).toBe("A class you left")
        expect(leftSpaceLabel(WEB + "/web")).toBeNull()
        expect(leftSpaceLabel("bio")).toBeNull()
        expect(leftSpaceLabel(null)).toBeNull()
    })

    it("file an item of yours under a class when a class course is picked", () => {
        expect(placeCourse(WEB + "/web")).toEqual({ courseId: null, classId: "abcdefghij12" })
        expect(placeCourse("bio")).toEqual({ courseId: "bio", classId: null })
        expect(placeCourse("")).toEqual({ courseId: null, classId: null })
        expect(classCourseKey("abcdefghij12")).toBe(WEB + "/web")
        expect(itemCourseKey({ courseId: null, classId: "abcdefghij12" })).toBe(WEB + "/web")
        expect(itemCourseKey({ courseId: "bio", classId: null })).toBe("bio")
    })
})

describe("keyed lists", () => {
    it("are the lists themselves when nothing in them is shared", () => {
        const sessions = [session({})], courses = [{ id: "bio" }] as Course[], items = [{ id: "a", courseId: "bio" }] as Item[], own = [{ id: "x", courseId: "bio" }] as Achievement[]
        expect(keyedSessions(sessions)).toBe(sessions)
        expect(keyedCourses(courses)).toBe(courses)
        expect(keyedItems(items)).toBe(items)
        expect(keyedAchievements(own)).toBe(own)
    })

    it("put shared rows in key space, the same list for the same input", () => {
        const sessions = [session({}), session({ id: "t", courseId: "web", spaceId: "abcdefghij12" })]
        expect(keyedSessions(sessions).map((s) => s.courseId)).toEqual(["bio", WEB + "/web"])
        expect(keyedSessions(sessions)).toBe(keyedSessions(sessions))
        const items = [{ id: "a", courseId: "bio" }, { id: "f", courseId: null, classId: "abcdefghij12", courseKey: WEB + "/web" }, { id: "a1", courseId: "web", key: WEB + "/a1", courseKey: WEB + "/web" }] as Item[]
        expect(keyedItems(items).map((it) => [it.id, it.courseId])).toEqual([["a", "bio"], ["f", WEB + "/web"], [WEB + "/a1", WEB + "/web"]])
        expect(keyedCourses([{ id: "bio" }, { id: "web", key: WEB + "/web" }] as Course[]).map((c) => c.id)).toEqual(["bio", WEB + "/web"])
    })
})
