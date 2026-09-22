// Bring the prototype's localStorage blob across: {data:{courses,items,quotes,owner}, ui}.

import { normalizeItem, normalizeCourse, normalizeQuote, HEXES, DEFAULT_COAT } from './model.js';
import { api } from './api.js';
import * as store from './store.js';
import { pull } from './sync.js';

export function localPrototypeData() {
  try {
    const raw = localStorage.getItem('rounds.proto.v2');
    if (!raw) return null;
    const p = JSON.parse(raw);
    return p && p.data && p.data.items ? p : null;
  } catch {
    return null;
  }
}

/** Map the prototype's shape onto the API's. Throws with a readable message. */
export function toPayload(blob) {
  const d = blob && blob.data ? blob.data : blob;
  if (!d || !Array.isArray(d.items) || !Array.isArray(d.courses)) throw new Error('That does not look like the prototype’s data.');
  const owner = d.owner || {};
  const courses = d.courses.map((c, i) => {
    const { createdAt, updatedAt, ...row } = normalizeCourse(c, i);
    return row;
  });
  const ids = new Set(courses.map((c) => c.id));
  const items = d.items.map((it) => {
    const { createdAt, updatedAt, ...row } = normalizeItem(it);
    if (row.courseId && !ids.has(row.courseId)) row.courseId = null;
    return row;
  });
  const quotes = (d.quotes || []).map((q) => {
    const { createdAt, updatedAt, ...row } = normalizeQuote(q);
    return row;
  }).filter((q) => q.text);
  return {
    profile: {
      displayName: store.data.profile?.displayName || '',
      coat: { name: owner.name || '', role: owner.role || '', color: HEXES.includes(owner.coat) ? owner.coat : DEFAULT_COAT },
      theme: blob.ui && blob.ui.theme ? blob.ui.theme : 'system',
      termStart: null,
    },
    courses, items, quotes,
  };
}

export async function importText(text) {
  const payload = toPayload(JSON.parse(text));
  const res = await api.importAll(payload);
  await store.meta.set('lastSyncAt', 0);
  await pull();
  return res.imported;
}
