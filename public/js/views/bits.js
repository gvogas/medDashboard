// Small HTML fragments shared by the week board, the table and the drawers.

import { esc } from '../dom.js';
import { isOverdue, statusLabel } from '../model.js';

/* checklist progress — the bar fills in pink as steps get ticked */
export function stepsHtml(it) {
  const cl = it.checklist || [];
  if (!cl.length) return '';
  const done = cl.filter((x) => x.done).length;
  return '<span class="steps"><span class="stepbar"><i class="' + (done === cl.length ? 'full' : '') + '" data-width="'
    + Math.round(done / cl.length * 100) + '"></i></span>'
    + (done === cl.length ? 'all ' + cl.length + ' steps done' : done + ' of ' + cl.length + ' steps') + '</span>';
}

export function statusChip(it) {
  if (isOverdue(it)) return '<span class="chip overdue">Overdue</span>';
  return '<span class="chip st-' + it.status + '">' + esc(statusLabel(it))
    + (it.status === 'graded' && typeof it.grade === 'number' ? ' ' + it.grade + '%' : '') + '</span>';
}

export const CHECK_SVG = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M2 6.5l2.6 2.6L10 3.5"/></svg>';

export const TUCK_SVG = '<svg class="tuck" viewBox="0 0 60 34" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">'
  + '<path d="M4 6c0 9 7 8 9 14s7 9 14 8 12-6 18-6"/><path d="M11 4c0 7 4 8 6 12"/>'
  + '<circle cx="50" cy="20" r="6"/><circle cx="50" cy="20" r="2.6"/><path d="M44.6 21.6 42 23"/></svg>';
