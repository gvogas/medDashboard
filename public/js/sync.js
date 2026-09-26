// One sync cycle per account across tabs. Every uploaded operation is persisted.
import { api, ApiError, retryDelayMs } from './api.js';
import * as store from './store.js';
import { untouchedReview } from './reviews.js';
export const status = { state: 'idle', pending: 0, lastPull: null, message: '' };
const listeners = new Set();
let initialized = false, paused = false, running = null, controller = null, timer;
let signedOut = () => {}, pulled = () => {};
export const onStatus = (fn) => listeners.add(fn);
export const onPulled = (fn) => { pulled = fn; };
export const onUnauthenticated = (fn) => { signedOut = fn; };
function state(value, message = '') {
  Object.assign(status, { state: value, message, pending: store.pendingCount() });
  for (const fn of listeners) fn(status);
}
function schedule(ms = 600) {
  if (paused) return;
  clearTimeout(timer);
  timer = setTimeout(syncNow, ms);
}
export function init() {
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
export function stop() { paused = true; clearTimeout(timer); controller?.abort(); }
export async function drain() { await running; }
const active = (cycle) => !paused && !cycle.signal.aborted && store.data.profile?.id === cycle.account;
/* Answers that end the cycle: the next one retries every edit. Any other failure holds
   back only its own edit, so one edit the server keeps failing on cannot stop the rest
   from uploading, nor this device from downloading. */
const STOPS = [401, 408, 428, 429, 503];
/* An edit that failed this many cycles, each with a working download (so the server was
   up), is set aside with the saved copies. */
const MAX_TRIES = 3;
const tries = new Map();   /* op token → cycles it failed in */
async function serverCopy(op, e) {
  if (e?.body?.current !== undefined) return e.body.current;
  try {
    const [kind, id] = op.key.split(/:(.*)/s);
    return op.key === 'profile' ? await api.me() : await api.get(kind, id);
  } catch (readError) {
    if (!(readError instanceof ApiError && readError.status === 404)) throw readError;
    return null;
  }
}
async function pushAll(cycle) {
  const operations = await store.pending();
  // New courses before items; course deletion after pending item writes.
  operations.sort((a, b) => rank(a) - rank(b));
  for (const op of operations) {
    if (!active(cycle)) return false;
    try {
      if (op.reviewRequired) throw new ApiError(409, { error: 'legacy_edit' });
      let saved;
      if (op.key === 'profile') saved = await api.saveMe({ ...op.body, revision: op.revision });
      else {
        const [kind, id] = op.key.split(/:(.*)/s);
        if (op.op === 'delete') {
          try { await api.del(kind, id, op.revision); }
          catch (e) { if (!(e instanceof ApiError && e.status === 404)) throw e; }
        } else saved = await api.put(kind, id, { ...op.body, revision: op.revision });
      }
      if (!active(cycle)) return false;
      await store.settleOperation(op, saved);
    } catch (e) {
      if (!active(cycle)) return false;
      if (e instanceof ApiError && [400, 404, 409, 413, 422].includes(e.status)) {
        const current = await serverCopy(op, e);
        if (!active(cycle)) return false;
        // A review step another device made first, or already deleted: its copy stands.
        if (e.status === 409 && untouchedReview(op)) { await store.rejectOperation(op, current, '', { quiet: true }); continue; }
        await store.rejectOperation(op, current, e.body?.error === 'legacy_edit' ? 'This edit was saved before conflict protection. Review it before restoring.' : e.body?.error === 'conflict' ? 'A newer version was saved on another device.' : 'The server could not accept this edit.');
      } else if (e instanceof ApiError && !STOPS.includes(e.status)) {
        cycle.failed.push(op);
        // Items after a new course may belong to it: they wait for it.
        if (op.key.startsWith('courses:') && op.op === 'put') break;
      } else throw e;
    }
  }
  return active(cycle);
}
/** Count a failed cycle against each held-back edit; set aside those out of tries. */
async function holdBack(cycle) {
  for (const op of cycle.failed) {
    const n = (tries.get(op.token) || 0) + 1;
    if (n < MAX_TRIES) { tries.set(op.token, n); continue; }
    tries.delete(op.token);
    const current = await serverCopy(op);
    if (!active(cycle)) return;
    await store.rejectOperation(op, current, 'The server kept failing to save this edit.');
  }
}
function rank(op) { return op.key.startsWith('courses:') ? (op.op === 'put' ? 0 : 3) : 1; }
async function pullAll(cycle) {
  let cursor = (await store.meta.get('syncCursor')) || 0;
  let reset = cursor === 0;
  let complete = false;
  // Bound resets as well as ordinary pages, then yield the account's sync lock.
  for (let pages = 0; pages < 20 && active(cycle); pages++) {
    const page = await api.sync(cursor);
    if (!active(cycle)) return false;
    if (page.reset) { cursor = 0; reset = true; continue; }
    await store.applyPage(page, reset);
    reset = false; cursor = page.cursor;
    if (!page.more) { complete = true; break; }
  }
  if (!active(cycle)) return false;
  const profile = await api.me();
  if (!active(cycle)) return false;
  await store.applyServerProfile(profile);
  if (!active(cycle)) return false;
  if (complete) status.lastPull = Date.now();
  pulled();
  return complete;
}
export async function syncNow() {
  if (paused || !store.data.profile) return false;
  if (running) return running;
  clearTimeout(timer);
  controller = new AbortController();
  const cycle = { signal: controller.signal, account: store.data.profile.id, failed: [] };
  running = (async () => {
    try {
      return await store.withSyncLock(async () => {
        if (!active(cycle)) return false;
        state('syncing');
        if (!(await pushAll(cycle))) return false;
        const complete = await pullAll(cycle);
        if (!active(cycle)) return false;
        if (cycle.failed.length) {
          await holdBack(cycle);
          if (!active(cycle)) return false;
          state('error', 'Some edits did not save yet. Trying again shortly.');
          schedule(30000);
          return false;
        }
        state(store.conflicts.length ? 'error' : store.pendingCount() || !complete ? 'pending' : 'idle',
          store.conflicts.length ? 'Saved copies need review in Settings.' : !complete ? 'Downloading remaining changes.' : '');
        if (!complete) schedule(1000);
        else if (store.pendingCount()) schedule();
        return true;
      }, { signal: cycle.signal });
    } catch (e) {
      if (!active(cycle)) return false;
      if (e instanceof ApiError && e.status === 401) { stop(); state('signed-out'); signedOut(); }
      else if (e instanceof ApiError && e.status === 428) { state('error', 'Reload Rounds to finish the update. Your edits are saved.'); }
      else { state(e instanceof ApiError ? 'error' : 'offline', e.message); schedule(retryDelayMs(e)); }
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
export async function startingProfile(remembered) {
  if (!remembered) { try { return await api.me(); } catch { return null; } }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return remembered;
  let timer;
  const slow = new Promise((resolve) => { timer = setTimeout(() => resolve(remembered), BOOT_WAIT_MS); });
  try { return await Promise.race([api.me(), slow]); }
  catch (e) { return e instanceof ApiError && e.status === 401 ? null : remembered; }
  finally { clearTimeout(timer); }
}
