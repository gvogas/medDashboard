// Leaving and removal on this device (spec §13, §15): leave a class (with a copy or without),
// remove a member, archive, delete; a removed class item kept as yours, dismissed, or restored
// for everyone; one item of yours shared with its class. Every call but Dismiss and Restore
// needs a connection; what changed arrives by sync like everything else.

import { api } from "@/core/api"
import * as store from "@/core/store"
import { syncNow } from "@/core/sync"
import { REVIEW_ID } from "@/core/shared"
import { closeSheet } from "./overlay"
import { toast } from "./toast"
import { ago } from "./marks"
import { splitKey } from "./refs"
import type { Item, SharedItem, Space } from "./types"

/* Your edits upload before the server copies or shares. syncNow hands back a cycle already
   running, which may have uploaded before your last edit was saved: an edit still waiting
   gets a second sync. If it is still waiting after that (offline, refused), the call goes
   ahead; an edit refused later goes to Saved copies, as any other. */
async function uploadFirst(): Promise<void> {
    await syncNow()
    if (store.pendingCount()) await syncNow()
}

/** Leave a class: your edits upload first, so the copy holds them. */
export async function leaveClass(spaceId: string, keepCopy: boolean, name: string): Promise<void> {
    await uploadFirst()
    await api.spaces.leave(spaceId, keepCopy)
    closeSheet()
    toast(keepCopy ? `You left ${name}. Your copy is in your courses.` : `You left ${name}.`)
    await syncNow()
}

/** The owner removes someone; they keep a copy of the class. */
export async function removeMember(spaceId: string, userId: string): Promise<void> {
    await api.spaces.remove(spaceId, userId)
    await syncNow()
}

/** The owner archives a class, or unarchives it. */
export async function setArchived(spaceId: string, archived: boolean): Promise<void> {
    await api.spaces.archive(spaceId, archived)
    await syncNow()
}

/** Delete a class only you are in; a copy by default. */
export async function deleteClass(spaceId: string, keepCopy: boolean, name: string): Promise<void> {
    await uploadFirst()
    await api.spaces.del(spaceId, keepCopy)
    closeSheet()
    toast(keepCopy ? `${name} is deleted. Your copy is in your courses.` : `${name} is deleted.`)
    await syncNow()
}

/** Keep as mine: a removed item becomes yours, filed under the class. The item's card closes; the class sheet's list passes `close: false`. */
export async function keepItem(key: string, { close = true } = {}): Promise<void> {
    const k = splitKey(key)
    await api.spaces.keep(k.spaceId!, k.id)
    if (close) closeSheet()
    await syncNow()
}

/** Dismiss: your mark on a removed item goes; the item leaves your views. Closes as keepItem does. */
export async function dismissItem(key: string, { close = true } = {}): Promise<void> {
    const k = splitKey(key)
    await store.deleteMark(k.spaceId + ":" + k.id)
    if (close) closeSheet()
}

/** Restore for everyone (owner, editors). */
export async function restoreItem(key: string): Promise<void> {
    const k = splitKey(key)
    await store.restoreShared(k.scope!, k.id)
    void syncNow()
}

/** Whether an item of yours filed under a class can become the class's: you edit it, it isn't archived, the type is built in, it isn't a lecture review. */
export function canShareItem(it: Pick<Item, "id" | "type" | "classId">, space: Pick<Space, "id" | "kind" | "role" | "archived"> | null): boolean {
    return !!space && it.classId === space.id && space.kind === "class" && space.role !== "member" && !space.archived
        && !it.type.startsWith("c-") && !(it.type === "task" && REVIEW_ID.test(it.id))
}

/** Share an item of yours with its class: your edits upload first. */
export async function shareItem(itemId: string, spaceId: string, name: string): Promise<void> {
    await uploadFirst()
    await api.spaces.share(spaceId, [itemId])
    closeSheet()
    toast(`Shared with ${name}. Your status, grade and notes stay yours.`)
    await syncNow()
}

/** "Removed from Web Services by Alex · 2h ago": "you" for your own, "a former member" for an account gone. */
export function removedLine(row: Pick<SharedItem, "updatedBy" | "deletedAt">, space: Pick<Space, "members"> | null, course: string, me: string | undefined, now = Date.now()): string {
    const who = row.updatedBy === me ? "you" : space?.members.find((m) => m.userId === row.updatedBy)?.name ?? "a former member"
    const when = ago(row.deletedAt, now)
    return `Removed from ${course} by ${who}` + (when ? " · " + when : "")
}
