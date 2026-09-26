// The database is authoritative; memory is a render cache, never the shared queue.
import { openDb, deleteDb } from './db.js';
import { normalizeItem, normalizeCourse, normalizeQuote, normalizeStudySession, normalizeAchievement, normalizeFlow, normalizePrefs, DEFAULT_COAT } from './model.js';
export const data = { profile: null, courses: [], items: [], quotes: [], study_sessions: [], achievements: [] };
export const dirty = {};
export const conflicts = [];
const listeners = new Set();
const normal = { items: normalizeItem, courses: normalizeCourse, quotes: normalizeQuote, study_sessions: normalizeStudySession, achievements: normalizeAchievement };
const stores = ['courses', 'items', 'quotes', 'study_sessions', 'achievements', 'meta', 'pending', 'conflicts'];
/* Which tab queued an edit. It lasts as long as the tab, reloads included: a new id on
   every load made an unsynced edit look like another tab's once the page reloaded. */
const owner = (() => {
  try {
    const kept = sessionStorage.getItem('rounds.tab');
    if (kept) return kept;
    const id = crypto.randomUUID();
    sessionStorage.setItem('rounds.tab', id);
    return id;
  } catch { return crypto.randomUUID(); }
})();
let db = null, channel = null, userId = null, localTail = Promise.resolve();
const dbName = (id) => `rounds:${id}`;
const notify = (evt) => { for (const fn of listeners) fn(evt); };
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
// Lookups by id run inside sorts and searches, so they use maps rebuilt on every reload.
let byId = { courses: new Map(), items: new Map() };
export const course = (id) => byId.courses.get(id) || null;
export const item = (id) => byId.items.get(id) || null;
const index = () => { byId = { courses: new Map(data.courses.map((r) => [r.id, r])), items: new Map(data.items.map((r) => [r.id, r])) }; };
const profile = (p) => ({ ...p, types: Array.isArray(p.types) ? p.types : [], studyFlow: normalizeFlow(p.studyFlow), studyPrefs: normalizePrefs(p.studyPrefs), coat: { name: '', role: '', color: DEFAULT_COAT, ...p.coat }, revision: p.revision || 0 });
const rowStore = (key) => key === 'profile' ? 'meta' : key.split(':')[0];
const rowId = (key) => key === 'profile' ? 'profile' : key.slice(key.indexOf(':') + 1);
const wrap = (key, row) => key === 'profile' ? { key: 'profile', value: row } : row;

/* Rows a delete is waiting on: gone from every view while Undo can still bring them back. */
const hidden = new Set();   /* 'items:id', 'courses:id' */
export async function hide(key, on = true) {
  if (on) hidden.add(key); else hidden.delete(key);
  await reload();
  notify({ type: 'hidden' });
}

export async function reload() {
  const handle = db;
  if (!handle) return;
  const snapshot = await handle.transaction(stores, 'readonly', async (a) => ({
    courses: await a('courses').all(), items: await a('items').all(), quotes: await a('quotes').all(), study_sessions: await a('study_sessions').all(), achievements: await a('achievements').all(),
    profile: (await a('meta').get('profile'))?.value,
    pending: await a('pending').all(), conflicts: await a('conflicts').all(),
  }));
  if (db !== handle) return;
  for (const kind of Object.keys(normal)) data[kind] = snapshot[kind].filter((r) => !hidden.has(kind + ':' + r.id)).map(normal[kind]);
  index();
  data.profile = snapshot.profile || null;
  for (const key of Object.keys(dirty)) delete dirty[key];
  for (const op of snapshot.pending) dirty[op.key] = op.op;
  conflicts.splice(0, conflicts.length, ...snapshot.conflicts);
}

export async function open(p) {
  await close();
  if (localStorage.getItem(`rounds.wipe:${p.id}`)) {
    await deleteDb(dbName(p.id));
    localStorage.removeItem(`rounds.wipe:${p.id}`);
  }
  userId = p.id;
  db = await openDb(dbName(p.id), () => { close().finally(() => notify({ type: 'signed-out' })); });
  await db.transaction(['meta', 'pending'], 'readwrite', async (a) => {
    const cached = (await a('meta').get('profile'))?.value;
    if (!cached || (!(await a('pending').get('profile')) && p.revision)) await a('meta').put(wrap('profile', profile(p)));
  });
  if (typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel(dbName(p.id));
    channel.onmessage = async ({ data: event }) => {
      if (event === 'close') { await close(); notify({ type: 'signed-out' }); }
      else { await reload(); notify({ type: 'remote' }); }
    };
  }
  await reload();
  localStorage.setItem('rounds.session', JSON.stringify({ id: p.id, username: p.username }));
}

export async function close() {
  await localTail.catch(() => {});
  db?.close(); db = null; userId = null; hidden.clear();
  channel?.close(); channel = null;
  data.profile = null;
  for (const kind of Object.keys(normal)) data[kind] = [];
  index();
  for (const key of Object.keys(dirty)) delete dirty[key];
  conflicts.length = 0;
}

export async function wipe(id) {
  localStorage.setItem(`rounds.wipe:${id}`, '1');
  localStorage.removeItem('rounds.session');
  channel?.postMessage('close');
  await close();
  await deleteDb(dbName(id));
  localStorage.removeItem(`rounds.wipe:${id}`);
}

// Serialize mutations in this tab; IndexedDB serializes transactions across tabs.
function mutate(fn, event = 'change') {
  const handle = db;
  const run = localTail.then(async () => {
    if (!handle || db !== handle) throw new Error('Sign in again before saving.');
    const value = await handle.transaction(stores, 'readwrite', fn);
    await reload();
    if (event === 'change' || value === true) channel?.postMessage('changed');
    notify({ type: event });
    return value;
  });
  localTail = run.catch((error) => { notify({ type: 'save-error', message: error.message }); });
  return run;
}

async function queue(a, key, op, body) {
  const previous = await a('pending').get(key);
  if (previous && previous.owner !== owner) {
    await a('conflicts').put({ id: crypto.randomUUID(), ...previous, reason: 'Another tab edited this record.', at: Date.now() });
  }
  const revision = previous?.revision ?? body?.revision ?? 0;
  await a('pending').put({ key, op, body, revision, reviewRequired: !!previous?.reviewRequired, token: crypto.randomUUID(), owner });
}

/* The server refuses an item with no title. A title cleared while editing keeps the
   one already stored, so the edit is never refused and moved to the conflicts. */
async function keepTitle(a, kind, row) {
  if (kind !== 'items' || row.title.trim()) return;
  row.title = (await a('items').get(row.id))?.title || 'Untitled';
}

function saveRow(kind, raw) {
  const clean = normal[kind](structuredClone(raw));
  return mutate(async (a) => {
    await keepTitle(a, kind, clean);
    await a(kind).put(clean);
    await queue(a, `${kind}:${clean.id}`, 'put', clean);
    return clean;
  });
}
function deleteRow(kind, id) {
  return mutate(async (a) => {
    const row = await a(kind).get(id);
    await queue(a, `${kind}:${id}`, 'delete', row || { id });
    await a(kind).del(id);
  });
}
/** Save many rows, `[{ kind, row }]`, as one change: one transaction, one reload, one broadcast. */
export function saveRows(rows) {
  const clean = rows.map(({ kind, row }) => ({ kind, row: normal[kind](structuredClone(row)) }));
  return mutate(async (a) => {
    for (const { kind, row } of clean) {
      await keepTitle(a, kind, row);
      await a(kind).put(row);
      await queue(a, `${kind}:${row.id}`, 'put', row);
    }
    return clean.map(({ row }) => row);
  });
}
export const saveItem = (row) => saveRow('items', row);
export const saveCourse = (row) => saveRow('courses', row);
export const saveQuote = (row) => saveRow('quotes', row);
export const saveStudySession = (row) => saveRow('study_sessions', row);
export const deleteStudySession = (id) => deleteRow('study_sessions', id);
export const saveAchievement = (row) => saveRow('achievements', row);
export const deleteAchievement = (id) => deleteRow('achievements', id);
export function deleteItem(id) {
  return mutate(async (a) => {
    const row = await a('items').get(id);
    await queue(a, `items:${id}`, 'delete', row || { id });
    await a('items').del(id);
    await unlinkSessions(a, 'itemId', id);
  });
}
/* The server clears a deleted course's or item's link on its sessions in the same
   change; this does the same on this device, pending uploads included. */
async function unlinkSessions(a, field, id) {
  for (const s of await a('study_sessions').all()) if (s[field] === id) {
    s[field] = null;
    await a('study_sessions').put(s);
    const pending = await a('pending').get(`study_sessions:${s.id}`);
    if (pending?.body) { pending.body[field] = null; await a('pending').put(pending); }
  }
}
export const deleteQuote = (id) => deleteRow('quotes', id);
export function deleteCourse(id) {
  return mutate(async (a) => {
    const row = await a('courses').get(id);
    await queue(a, `courses:${id}`, 'delete', row || { id });
    await a('courses').del(id);
    for (const it of await a('items').all()) if (it.courseId === id) {
      // Server clears this reference atomically with the course deletion.
      it.courseId = null;
      await a('items').put(it);
      const pending = await a('pending').get(`items:${it.id}`);
      if (pending?.body) { pending.body.courseId = null; await a('pending').put(pending); }
    }
    await unlinkSessions(a, 'courseId', id);
  });
}
export function saveProfile(patch) {
  const copy = structuredClone(patch);
  return mutate(async (a) => {
    const p = (await a('meta').get('profile')).value;
    if (copy.coat) Object.assign(p.coat, copy.coat);
    for (const key of ['displayName', 'theme', 'bg', 'termStart', 'types', 'studyFlow', 'studyPrefs']) if (key in copy) p[key] = copy[key];
    await a('meta').put(wrap('profile', p));
    await queue(a, 'profile', 'put', p);
  });
}
export const pendingCount = () => Object.keys(dirty).length;
export const pending = () => db.all('pending');
export const meta = {
  get: async (key) => (await db.get('meta', key))?.value,
  set: (key, value) => db.put('meta', { key, value }),
};

export function settleOperation(op, saved) {
  return mutate(async (a) => {
    const current = await a('pending').get(op.key);
    if (!current) return;
    if (current.token !== op.token) {
      // An edit made while uploading builds on the write we just acknowledged.
      if (saved) {
        current.revision = saved.revision;
        if (current.body) current.body.revision = saved.revision;
        await a('pending').put(current);
        const stored = await a(rowStore(op.key)).get(rowId(op.key));
        const local = op.key === 'profile' ? stored?.value : stored;
        if (local) {
          local.revision = saved.revision;
          await a(rowStore(op.key)).put(wrap(op.key, local));
        }
      }
      return !!saved;
    }
    await a('pending').del(op.key);
    if (saved) await a(rowStore(op.key)).put(wrap(op.key, saved));
    return true;
  }, 'synced');
}

/** Take the server's copy in place of a refused edit; unless `quiet`, the edit is kept for review. */
export function rejectOperation(op, current, reason, { quiet = false } = {}) {
  return mutate(async (a) => {
    if (!quiet) await a('conflicts').put({ ...op, id: crypto.randomUUID(), current, reason, at: Date.now() });
    if ((await a('pending').get(op.key))?.token !== op.token) return;
    await a('pending').del(op.key);
    if (current && !current.deletedAt) await a(rowStore(op.key)).put(wrap(op.key, current));
    else if (op.key !== 'profile') await a(rowStore(op.key)).del(rowId(op.key));
    return true;
  }, 'synced');
}

export function applyPage(page, reset = false) {
  return mutate(async (a) => {
    if (reset) for (const kind of Object.keys(normal)) {
      for (const row of await a(kind).all()) if (!(await a('pending').get(`${kind}:${row.id}`))) await a(kind).del(row.id);
    }
    for (const { kind, row } of page.changes) {
      if (await a('pending').get(`${kind}:${row.id}`)) continue;
      const local = await a(kind).get(row.id);
      if (local && local.revision > row.revision) continue;
      if (row.deletedAt) await a(kind).del(row.id);
      else await a(kind).put(normal[kind](row));
    }
    await a('meta').put({ key: 'syncCursor', value: page.cursor });
    return reset || page.changes.length > 0;
  }, 'synced');
}
export function applyServerProfile(p) {
  return mutate(async (a) => {
    if (!(await a('pending').get('profile'))) {
      const old = (await a('meta').get('profile'))?.value;
      if (!old || old.revision <= p.revision) await a('meta').put(wrap('profile', profile(p)));
    }
  }, 'synced');
}

export function resolveConflict(id, restore) {
  return mutate(async (a) => {
    const conflict = await a('conflicts').get(id);
    if (!conflict) return;
    if (restore) {
      const stored = await a(rowStore(conflict.key)).get(rowId(conflict.key));
      const local = conflict.key === 'profile' ? stored?.value : stored;
      // The saved copy may predate subsequent pulls. Restore against the latest
      // revision we know, while the server still checks for unseen changes.
      const current = (local?.revision || 0) >= (conflict.current?.revision || 0) ? local : conflict.current;
      const body = { ...conflict.body, revision: current?.revision || 0 };
      const existing = await a('pending').get(conflict.key);
      if (existing) throw new Error('Wait for the pending edit to sync before restoring this copy.');
      await queue(a, conflict.key, conflict.op, body);
      if (conflict.op === 'put') await a(rowStore(conflict.key)).put(wrap(conflict.key, body));
      else await a(rowStore(conflict.key)).del(rowId(conflict.key));
    }
    await a('conflicts').del(id);
  });
}

export async function withSyncLock(fn, { signal } = {}) {
  const id = userId;
  const run = async () => {
    signal?.throwIfAborted();
    if (id && id === userId) return fn();
    return false;
  };
  return navigator.locks ? navigator.locks.request(`rounds-sync:${id}`, { signal }, run) : run();
}
