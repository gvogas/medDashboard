// One sync cycle per account across tabs. Every uploaded operation is persisted.
import { api, ApiError, retryDelayMs } from './api.ts';
import * as store from './store.ts';
import { untouchedReview } from './reviews.ts';
import { changedFields, MARK_DEFAULTS, parseKey } from './shared.ts';
import type { PendingOp, Row } from './db.ts';
import type { Cursor, ServerProfile } from './store.ts';
import type { SyncState, SyncStatus } from './types.ts';

/** One sync cycle: its cancel signal, the account it is for, the edits it held back, the mark
    edits refused as not found (settled after the pull), and whether any waits on a feature in maintenance. */
interface Cycle { signal: AbortSignal; account: string; failed: PendingOp[]; deferred: PendingOp[]; waiting: boolean }
export const status: SyncStatus & { lastPull: number | null } = { state: 'idle', pending: 0, lastPull: null, message: '' };
const listeners = new Set<(s: typeof status) => void>();
let initialized = false, paused = false, running: Promise<boolean> | null = null, controller: AbortController | null = null, timer: ReturnType<typeof setTimeout> | undefined;
let signedOut: () => void = () => {}, pulled: () => unknown = () => {};
export const onStatus = (fn: (s: typeof status) => void) => listeners.add(fn);
export const onPulled = (fn: () => unknown): void => { pulled = fn; };
let unreadFn: (n: number) => void = () => {};
/** The inbox's unread count, as the last page of each complete pull carries it (spec §12). */
export const onUnread = (fn: (n: number) => void): void => { unreadFn = fn; };
export const onUnauthenticated = (fn: () => void): void => { signedOut = fn; };
function state(value: SyncState, message = '') {
  Object.assign(status, { state: value, message, pending: store.pendingCount() });
  for (const fn of listeners) fn(status);
}
function schedule(ms = 600) {
  if (paused) return;
  clearTimeout(timer);
  timer = setTimeout(syncNow, ms);
}
export function init(): void {
  paused = false;
  schedule(0);
  if (initialized) return;
  initialized = true;
  store.subscribe((evt) => {
    if (evt.type === 'signed-out') { stop(); signedOut(); return; }
    if (paused) return;
    if (evt.type === 'change' || evt.type === 'remote') { state('pending'); schedule(); }
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
  window.addEventListener('online', syncNow);
  window.addEventListener('offline', () => { if (!paused) state('offline'); });
  setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 300000);
}
export function stop(): void { paused = true; clearTimeout(timer); controller?.abort(); }
export async function drain(): Promise<void> { await running; }
const active = (cycle: Cycle) => !paused && !cycle.signal.aborted && store.data.profile?.id === cycle.account;
/* Answers that end the cycle: the next one retries every edit. Any other failure holds
   back only its own edit, so one edit the server keeps failing on cannot stop the rest
   from uploading, nor this device from downloading. */
const STOPS = [401, 408, 428, 429, 503];
/* An edit that failed this many cycles, each with a working download (so the server was
   up), is set aside with the saved copies. */
const MAX_TRIES = 3;
const tries = new Map<string, number>();   /* op token → cycles it failed in */
/* Answers no retry can change: the edit goes to the saved copies at once. A lost
   permission on a shared row (403) does not come back by retrying (spec §6). A personal
   write's 403 is the cross-site guard (or the like): that stays on the retry path. */
const REFUSED = [400, 404, 409, 413, 422];
const refused = (op: PendingOp, e: ApiError) => REFUSED.includes(e.status)
  || (e.status === 403 && (!!parseKey(op.key).scope || e.body?.error === 'forbidden' || e.body?.error === 'archived'));
/* 'shared_items' → 'items', for the shared routes. */
const sharedKind = (store: string) => store.slice('shared_'.length);
/* Why an edit was set aside, as Settings shows it; `op` names the class or project it was for. */
function reasonFor(e: ApiError, op: PendingOp): string {
  const body = e.body || {};
  if (body.error === 'legacy_edit') return 'This edit was saved before conflict protection. Review it before restoring.';
  if (body.error === 'conflict') return Array.isArray(body.fields) ? `Someone else changed ${(body.fields as string[]).join(', ')}.` : 'A newer version was saved on another device.';
  if (body.error === 'limit') return 'A project holds 200 tasks at most.';
  if (body.error === 'archived') return `This ${parseKey(op.key).scope?.startsWith('p:') ? 'project' : 'class'} is archived, so it is read-only.`;
  if (e.status === 403) return 'You no longer have permission to change this.';
  return 'The server could not accept this edit.';
}
async function serverCopy(op: PendingOp, e?: { body?: ApiError['body'] }): Promise<Row | null | undefined> {
  if (e?.body?.current !== undefined) return e.body.current;
  try {
    const k = parseKey(op.key);
    return op.key === 'profile' ? await api.me() : k.scope ? await api.shared.get(k.scope, sharedKind(k.store), k.id) : await api.get(k.store, k.id);
  } catch (readError) {
    if (!(readError instanceof ApiError && readError.status === 404)) throw readError;
    return null;
  }
}
async function pushAll(cycle: Cycle): Promise<boolean> {
  const operations = await store.pending();
  // New courses before items; course deletion after pending item writes.
  operations.sort((a, b) => rank(a) - rank(b));
  for (const op of operations) {
    if (!active(cycle)) return false;
    try {
      if (op.reviewRequired) throw new ApiError(409, { error: 'legacy_edit' });
      let saved: Row | undefined;
      if (op.key === 'profile') saved = await api.saveMe({ ...op.body, revision: op.revision });
      else {
        const k = parseKey(op.key);
        if (k.scope) {
          /* a shared row: a 404 may mean lost access, so a delete is not taken as done */
          if (op.op === 'delete') await api.shared.del(k.scope, sharedKind(k.store), k.id, op.revision);
          else saved = await api.shared.put(k.scope, sharedKind(k.store), k.id, { ...op.body, revision: op.revision }, changedFields(k.store, k.scope, op.body || {}, op.base));
        } else if (op.op === 'delete') {
          try { await api.del(k.store, k.id, op.revision); }
          catch (e) { if (!(e instanceof ApiError && e.status === 404)) throw e; }
        } else if (k.store === 'marks') {
          /* your mark merges field by field: two of your devices may both have made it (spec §6) */
          /* a first mark (no base) names only the fields it moved off the defaults */
          saved = await api.put(k.store, k.id, { ...op.body, revision: op.revision }, changedFields('marks', '', op.body || {}, op.base ?? MARK_DEFAULTS));
        } else saved = await api.put(k.store, k.id, { ...op.body, revision: op.revision });
      }
      if (!active(cycle)) return false;
      await store.settleOperation(op, saved);
      tries.delete(op.token);   /* it got through after all */
    } catch (e) {
      if (!active(cycle)) return false;
      /* a feature the admins are working on (shared classes): the edit stays pending as it
         is, with no try counted, and the rest still upload */
      if (e instanceof ApiError && e.status === 503 && e.body?.error === 'maintenance') { cycle.waiting = true; continue; }
      /* your mark refused as not found: you may have lost the class, and the pull that follows
         carries the edit onto your copy (store.applyRevoked); it is settled after the pull */
      if (e instanceof ApiError && e.status === 404 && op.op === 'put' && op.key.startsWith('marks:')) { cycle.deferred.push(op); continue; }
      if (e instanceof ApiError && refused(op, e)) {
        const current = await serverCopy(op, e);
        if (!active(cycle)) return false;
        // A review step another device made first, or already deleted: its copy stands.
        if (e.status === 409 && untouchedReview(op)) { await store.rejectOperation(op, current, '', { quiet: true }); continue; }
        await store.rejectOperation(op, current, reasonFor(e, op));
      } else if (e instanceof ApiError && !STOPS.includes(e.status)) {
        cycle.failed.push(op);
        // Items after a new course may belong to it: they wait for it.
        if (/^(shared_)?courses:/.test(op.key) && op.op === 'put') break;
      } else throw e;
    }
  }
  return active(cycle);
}
/** Count a failed cycle against each held-back edit; set aside those out of tries. */
async function holdBack(cycle: Cycle): Promise<void> {
  /* an edit the pull settled (a mark carried onto your copy) is no longer held back */
  const waiting = new Set((await store.pending()).map((op) => op.token));
  for (const op of cycle.failed) {
    if (!waiting.has(op.token)) { tries.delete(op.token); continue; }
    const n = (tries.get(op.token) || 0) + 1;
    if (n < MAX_TRIES) { tries.set(op.token, n); continue; }
    tries.delete(op.token);
    const current = await serverCopy(op);
    if (!active(cycle)) return;
    await store.rejectOperation(op, current, 'The server kept failing to save this edit.');
  }
}
/** After a complete pull: a deferred mark edit still waiting (nothing carried it) goes to the saved copies. */
async function settleDeferred(cycle: Cycle): Promise<boolean> {
  if (!cycle.deferred.length) return true;
  const waiting = new Set((await store.pending()).map((op) => op.token));
  for (const op of cycle.deferred) {
    if (!waiting.has(op.token)) continue;
    const current = await serverCopy(op);
    if (!active(cycle)) return false;
    await store.rejectOperation(op, current, 'This item was removed from the class, or you left it.');
  }
  return active(cycle);
}
/* Upload order (spec §6): course puts, then items, then your marks and prefs (a mark on an item
   made offline needs the item first), then course deletes. */
function rank(op: PendingOp): number {
  if (/^(shared_)?courses:/.test(op.key)) return op.op === 'put' ? 0 : 3;
  return /^(marks|space_prefs):/.test(op.key) ? 2 : 1;
}
/* The account whose member lists this tab holds: until its first complete pull after the
   app opens, `sv` is 0, so every list comes again (a renamed member shows on next open). */
let listsFor: string | null = null;
async function pullAll(cycle: Cycle): Promise<boolean> {
  const stored = await store.meta.get('cursors');
  let cursors: Record<string, Cursor> = stored && typeof stored === 'object' ? { ...(stored as Record<string, Cursor>) } : {};
  const sv = listsFor === cycle.account ? store.spaceRevision() : 0;
  /* a personal cursor of 0 or none while rows are held: wipe the clean ones and refill (as v2 did) */
  const own = 'u:' + cycle.account;
  let wipe: string[] = cursors[own] ? [] : [own], revoked: string[] = [], complete = false;
  let unread: number | undefined;
  // Bound resets as well as ordinary pages, then yield the account's sync lock.
  for (let pages = 0; pages < 20 && active(cycle); pages++) {
    const page = await api.syncV3(cursors, sv);
    if (!active(cycle)) return false;
    /* a scope that reset comes back with none of its rows, so it is wiped on this very page,
       in the transaction that stores its cursor 0: a failed next request cannot leave the
       cursor at 0 with the old rows still held */
    await store.applyPage(page, [...new Set([...wipe, ...(page.reset || [])])]);
    wipe = []; revoked = page.revoked || []; unread = page.unread;
    cursors = { ...cursors, ...page.cursors };
    if (!page.more) { complete = true; break; }
  }
  if (!active(cycle)) return false;
  /* after the last page, so a copy paged into your own scope is already here (spec §6 Revocation) */
  if (complete) {
    await store.applyRevoked(revoked);
    if (!active(cycle)) return false;
    listsFor = cycle.account;
    if (unread !== undefined) unreadFn(unread);
  }
  const profile = await api.me();
  if (!active(cycle)) return false;
  await store.applyServerProfile(profile);
  if (!active(cycle)) return false;
  if (complete) status.lastPull = Date.now();
  Promise.resolve().then(pulled).catch(() => {});   /* a failed save shows its own toast */
  return complete;
}
export async function syncNow(): Promise<boolean> {
  if (paused || !store.data.profile) return false;
  if (running) return running;
  clearTimeout(timer);
  controller = new AbortController();
  const cycle: Cycle = { signal: controller.signal, account: store.data.profile.id, failed: [], deferred: [], waiting: false };
  running = (async () => {
    try {
      return await store.withSyncLock(async () => {
        if (!active(cycle)) return false;
        state('syncing');
        if (!(await pushAll(cycle))) return false;
        const complete = await pullAll(cycle);
        if (!active(cycle)) return false;
        /* an incomplete pull leaves deferred edits pending: the next cycle tries them again */
        if (complete && !(await settleDeferred(cycle))) return false;
        if (cycle.failed.length) {
          await holdBack(cycle);
          if (!active(cycle)) return false;
          state('error', 'Some edits did not save yet. Trying again shortly.');
          schedule(30000);
          return false;
        }
        state(store.conflicts.length ? 'error' : store.pendingCount() || !complete ? 'pending' : 'idle',
          store.conflicts.length ? 'Saved copies need review in Settings.' : !complete ? 'Downloading remaining changes.'
            : cycle.waiting ? 'Shared edits are waiting: classes and projects are being worked on.' : '');
        if (!complete) schedule(1000);
        /* edits held back by maintenance are asked about again in a minute, not at once */
        else if (cycle.waiting) schedule(60000);
        else if (store.pendingCount()) schedule();
        return true;
      }, { signal: cycle.signal });
    } catch (e) {
      if (!active(cycle)) return false;
      if (e instanceof ApiError && e.status === 401) { stop(); state('signed-out'); signedOut(); }
      else if (e instanceof ApiError && e.status === 428) { state('error', 'Reload Term to finish the update. Your edits are saved.'); }
      else { state(e instanceof ApiError ? 'error' : 'offline', (e as Error).message); schedule(retryDelayMs(e)); }
      return false;
    }
  })();
  try { return await running; } finally {
    running = null; controller = null;
    // init() may have resumed while the cancelled cycle was still unwinding.
    if (cycle.signal.aborted && !paused) schedule(0);
  }
}
/* The account to open. The server is asked first, so an ended session (signed out
   everywhere, a reset password) never shows its data. A remembered account still opens
   from this device when offline, when the server fails, or when it is slow to answer. */
const BOOT_WAIT_MS = 1500;
export async function startingProfile(remembered: ServerProfile | null): Promise<ServerProfile | null> {
  if (!remembered) { try { return await api.me(); } catch { return null; } }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return remembered;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const slow = new Promise<ServerProfile>((resolve) => { timer = setTimeout(() => resolve(remembered), BOOT_WAIT_MS); });
  try { return await Promise.race([api.me(), slow]); }
  catch (e) { return e instanceof ApiError && e.status === 401 ? null : remembered; }
  finally { clearTimeout(timer); }
}
