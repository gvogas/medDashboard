// The local store. The UI renders from `data`; every change goes through the
// functions here, which write IndexedDB, mark the row dirty, and notify.
// sync.js pushes dirty rows to the API and pulls other devices' changes in.

import { openDb, deleteDb } from './db.js';
import { normalizeItem, normalizeCourse, normalizeQuote, DEFAULT_COAT } from './model.js';

export const data = { profile: null, courses: [], items: [], quotes: [] };
export const dirty = {};          // 'items:i1' → 'put' | 'delete'; 'profile' → 'put'
const versions = {};              // bumps on every local change to a key
const listeners = new Set();
let db = null;

const LIST = { courses: 'courses', items: 'items', quotes: 'quotes' };
const NORMALIZE = { courses: normalizeCourse, items: normalizeItem, quotes: normalizeQuote };

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function notify(evt) {
  for (const fn of listeners) fn(evt);
}

export function dbName(userId) {
  return `rounds:${userId}`;
}

/** Open this user's local database and load it into memory. */
export async function open(profile) {
  db = await openDb(dbName(profile.id));
  data.courses = (await db.all('courses')).map(normalizeCourse);
  data.items = (await db.all('items')).map(normalizeItem);
  data.quotes = (await db.all('quotes')).map(normalizeQuote);
  Object.keys(dirty).forEach((k) => delete dirty[k]);
  Object.assign(dirty, (await db.get('meta', 'dirty'))?.value || {});
  const localProfile = (await db.get('meta', 'profile'))?.value;
  data.profile = dirty.profile && localProfile ? localProfile : normalizeProfile(profile);
  await db.put('meta', { key: 'profile', value: data.profile });
  try { localStorage.setItem('rounds.session', JSON.stringify({ id: profile.id, email: profile.email })); } catch {}
}

export async function close() {
  if (db) db.close();
  db = null;
  data.profile = null;
  data.courses = [];
  data.items = [];
  data.quotes = [];
  Object.keys(dirty).forEach((k) => delete dirty[k]);
  try { localStorage.removeItem('rounds.session'); } catch {}
}

/** Forget everything cached for this user on this device. */
export async function wipe(userId) {
  await close();
  await deleteDb(dbName(userId));
}

function normalizeProfile(p) {
  return {
    id: p.id,
    email: p.email || '',
    displayName: p.displayName || '',
    coat: { name: p.coat?.name || '', role: p.coat?.role || '', color: p.coat?.color || DEFAULT_COAT },
    theme: p.theme || 'system',
    termStart: p.termStart || null,
    importedAt: p.importedAt ?? null,
    updatedAt: p.updatedAt ?? null,
  };
}

export const meta = {
  get: async (key) => (await db.get('meta', key))?.value,
  set: (key, value) => db.put('meta', { key, value }),
};

async function persistDirty() {
  await db.put('meta', { key: 'dirty', value: { ...dirty } });
}

function mark(key, op) {
  dirty[key] = op;
  versions[key] = (versions[key] || 0) + 1;
}

export function version(key) {
  return versions[key] || 0;
}

export function course(id) {
  return data.courses.find((c) => c.id === id) || null;
}
export function item(id) {
  return data.items.find((i) => i.id === id) || null;
}

async function saveRow(kind, raw) {
  const list = data[LIST[kind]];
  const clean = NORMALIZE[kind](raw, list.length);
  const existing = list.find((r) => r.id === clean.id);
  if (existing) Object.assign(existing, clean);
  else list.push(clean);
  const row = existing || clean;
  await db.put(kind, row);
  mark(`${kind}:${row.id}`, 'put');
  await persistDirty();
  notify({ type: 'change', kind, id: row.id });
  return row;
}

async function deleteRowLocal(kind, id) {
  const list = data[LIST[kind]];
  const ix = list.findIndex((r) => r.id === id);
  if (ix >= 0) list.splice(ix, 1);
  await db.del(kind, id);
  mark(`${kind}:${id}`, 'delete');
  await persistDirty();
  notify({ type: 'change', kind, id });
}

export const saveItem = (it) => saveRow('items', it);
export const saveCourse = (c) => saveRow('courses', c);
export const saveQuote = (q) => saveRow('quotes', q);
export const deleteItem = (id) => deleteRowLocal('items', id);
export const deleteQuote = (id) => deleteRowLocal('quotes', id);

export async function deleteCourse(id) {
  for (const it of data.items) if (it.courseId === id) { it.courseId = null; await saveRow('items', it); }
  await deleteRowLocal('courses', id);
}

export async function saveProfile(patch) {
  const p = data.profile;
  if (!p) return null;
  if (patch.coat) Object.assign(p.coat, patch.coat);
  for (const k of ['displayName', 'theme', 'termStart']) if (k in patch) p[k] = patch[k];
  await db.put('meta', { key: 'profile', value: p });
  mark('profile', 'put');
  await persistDirty();
  notify({ type: 'change', kind: 'profile' });
  return p;
}

// ── called by sync.js ─────────────────────────────────────────────────────

/** Apply a server row (or tombstone) unless the local copy has unpushed edits. */
export async function applyServer(kind, row) {
  const key = `${kind}:${row.id}`;
  if (dirty[key]) return false;
  const list = data[LIST[kind]];
  const ix = list.findIndex((r) => r.id === row.id);
  if (row.deletedAt) {
    if (ix < 0) return false;
    list.splice(ix, 1);
    await db.del(kind, row.id);
    return true;
  }
  const clean = NORMALIZE[kind](row, list.length);
  if (ix >= 0) Object.assign(list[ix], clean);
  else list.push(clean);
  await db.put(kind, ix >= 0 ? list[ix] : clean);
  return true;
}

export async function applyServerProfile(p) {
  if (dirty.profile || !data.profile) return false;
  Object.assign(data.profile, normalizeProfile(p));
  await db.put('meta', { key: 'profile', value: data.profile });
  return true;
}

/** After a successful push: clear the flag if nothing changed meanwhile. */
export async function settle(key, v, serverRow) {
  if (versions[key] !== v) return false;
  delete dirty[key];
  if (serverRow) {
    if (key === 'profile') {
      Object.assign(data.profile, normalizeProfile(serverRow));
      await db.put('meta', { key: 'profile', value: data.profile });
    } else {
      const [kind] = key.split(':');
      const list = data[LIST[kind]];
      const row = list.find((r) => r.id === serverRow.id);
      if (row) { Object.assign(row, NORMALIZE[kind](serverRow)); await db.put(kind, row); }
    }
  }
  await persistDirty();
  return true;
}

export function pendingCount() {
  return Object.keys(dirty).length;
}
