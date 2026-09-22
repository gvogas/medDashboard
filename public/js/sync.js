// Keeps the local store and D1 converged. Push dirty rows, pull what changed.
// Runs on load, on tab focus, when the network comes back, and after every save.

import { api, ApiError } from './api.js';
import * as store from './store.js';

export const status = { state: 'idle', pending: 0, lastPull: null, message: '' };
const statusListeners = new Set();
let onSignedOut = () => {};
let pushTimer = null;
let running = null;
let pulled = () => {};

export function onStatus(fn) { statusListeners.add(fn); }
export function onPulled(fn) { pulled = fn; }
export function onUnauthenticated(fn) { onSignedOut = fn; }

function setStatus(state, message = '') {
  status.state = state;
  status.message = message;
  status.pending = store.pendingCount();
  for (const fn of statusListeners) fn(status);
}

export function init() {
  store.subscribe((evt) => { if (evt.type === 'change') schedulePush(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
  window.addEventListener('online', syncNow);
  window.addEventListener('offline', () => setStatus('offline'));
  setInterval(() => { if (document.visibilityState === 'visible') pull(); }, 5 * 60 * 1000);
}

export function schedulePush() {
  setStatus(status.state === 'offline' ? 'offline' : 'pending');
  clearTimeout(pushTimer);
  pushTimer = setTimeout(push, 600);
}

function handleFailure(e) {
  if (e instanceof ApiError) {
    if (e.status === 401) { setStatus('signed-out'); onSignedOut(); return 'stop'; }
    setStatus('error', e.body?.field ? `${e.body.error}: ${e.body.field}` : e.message);
    return 'continue';
  }
  setStatus('offline');
  return 'stop';
}

/** Send every dirty row. Stops at the first network failure; retried later. */
export async function push() {
  if (running) return running;
  running = (async () => {
    try {
      setStatus('syncing');
      for (const key of Object.keys(store.dirty)) {
        const op = store.dirty[key];
        const v = store.version(key);
        try {
          if (key === 'profile') {
            const p = store.data.profile;
            const saved = await api.saveMe({ displayName: p.displayName, coat: p.coat, theme: p.theme, termStart: p.termStart });
            await store.settle(key, v, saved);
          } else {
            const [kind, id] = key.split(/:(.*)/s);
            if (op === 'delete') {
              try { await api.del(kind, id); } catch (e) { if (!(e instanceof ApiError && e.status === 404)) throw e; }
              await store.settle(key, v);
            } else {
              const row = store.data[kind].find((r) => r.id === id);
              if (!row) { await store.settle(key, v); continue; }
              const { createdAt, updatedAt, deletedAt, ...body } = row;
              const saved = await api.put(kind, id, body);
              await store.settle(key, v, saved);
            }
          }
        } catch (e) {
          if (handleFailure(e) === 'stop') return false;
          // A 4xx on one row (a bug in the client) must not block the rest: drop it.
          console.error('push rejected', key, e);
          await store.settle(key, v);
        }
      }
      if (status.state !== 'error') setStatus('idle');
      return true;
    } finally {
      running = null;
    }
  })();
  return running;
}

/** Fetch rows changed since the last pull and apply the ones we have not edited. */
export async function pull() {
  if (!store.data.profile) return false;
  try {
    const since = (await store.meta.get('lastSyncAt')) || 0;
    const [res, me] = await Promise.all([api.sync(since), api.me()]);
    let changed = await store.applyServerProfile(me);
    for (const kind of ['courses', 'items', 'quotes']) {
      for (const row of res[kind]) if (await store.applyServer(kind, row)) changed = true;
    }
    await store.meta.set('lastSyncAt', res.now);
    status.lastPull = Date.now();
    if (status.state !== 'error' && status.state !== 'pending') setStatus(navigator.onLine === false ? 'offline' : 'idle');
    if (changed) pulled();
    return changed;
  } catch (e) {
    handleFailure(e);
    return false;
  }
}

export async function syncNow() {
  if (await push()) await pull();
}
