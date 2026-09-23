// One sync cycle per account across tabs. Every uploaded operation is persisted.
import { api, ApiError, retryDelayMs } from './api.js';
import * as store from './store.js';
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
        let current = e.body?.current;
        if (current === undefined) {
          try {
            const [kind, id] = op.key.split(/:(.*)/s);
            current = op.key === 'profile' ? await api.me() : await api.get(kind, id);
          } catch (readError) {
            if (!(readError instanceof ApiError && readError.status === 404)) throw readError;
            current = null;
          }
        }
        if (!active(cycle)) return false;
        await store.rejectOperation(op, current, e.body?.error === 'legacy_edit' ? 'This edit was saved before conflict protection. Review it before restoring.' : e.body?.error === 'conflict' ? 'A newer version was saved on another device.' : 'The server could not accept this edit.');
      } else throw e;
    }
  }
  return active(cycle);
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
  const cycle = { signal: controller.signal, account: store.data.profile.id };
  running = (async () => {
    try {
      return await store.withSyncLock(async () => {
        if (!active(cycle)) return false;
        state('syncing');
        if (!(await pushAll(cycle))) return false;
        const complete = await pullAll(cycle);
        if (!active(cycle)) return false;
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
export const push = syncNow;
export const pull = syncNow;
