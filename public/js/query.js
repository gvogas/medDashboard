// Derived lists over the store, filtered by the UI state. Computed on every render.

import { data, course } from './store.js';
import { ui } from './state.js';
import { tmeta, occurrences } from './model.js';

/** A type filter is on unless it was switched off; new types start on. */
export const typeOn = (t) => ui.types[t] !== false;

export function matchSearch(it) {
  if (!ui.search) return true;
  const c = course(it.courseId);
  const hay = (it.title + ' ' + (it.where || '') + ' ' + (it.notes || '') + ' ' + (c ? c.name + ' ' + c.code : '') + ' ' + tmeta(it.type).label).toLowerCase();
  return hay.indexOf(ui.search.toLowerCase()) > -1;
}

export function passFilters(it) {
  return typeOn(it.type) && (ui.course === 'all' || it.courseId === ui.course) && matchSearch(it);
}

export function instances(from, to) {
  const out = [];
  data.items.forEach((it) => { if (passFilters(it)) out.push(...occurrences(it, from, to)); });
  out.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    const as = a.item.start || a.item.end || 'zz', bs = b.item.start || b.item.end || 'zz';
    return as < bs ? -1 : as > bs ? 1 : 0;
  });
  return out;
}

/** Courses shown in the sidebar and month view: the live ones. */
export function activeCourses() {
  return data.courses.filter((c) => !c.archived);
}

/** every class meeting, flattened with its course */
export function classes() {
  const out = [];
  activeCourses().forEach((c) => {
    if (ui.course !== 'all' && c.id !== ui.course) return;
    (c.meetings || []).forEach((m) => {
      if (ui.search) {
        const hay = (c.name + ' ' + c.code + ' ' + (c.instructor || '') + ' ' + (m.room || '') + ' ' + (m.kind || '')).toLowerCase();
        if (hay.indexOf(ui.search.toLowerCase()) < 0) return;
      }
      out.push({ course: c, mtg: m });
    });
  });
  out.sort((a, b) => {
    const da = (a.mtg.weekday + 6) % 7, db = (b.mtg.weekday + 6) % 7;
    return da - db || (a.mtg.start < b.mtg.start ? -1 : a.mtg.start > b.mtg.start ? 1 : 0);
  });
  return out;
}
