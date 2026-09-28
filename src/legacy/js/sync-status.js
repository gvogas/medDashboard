// Redraws a sync brings in (held while someone types or clicks), and the spaced reviews
// a pull may bring due. The sync status itself is React's (src/components/top-bar.tsx).

import * as store from './store.js';
import { data } from './store.js';
import { ui } from './state.js';
import { normalizeItem } from './model.js';
import { today } from './dates.js';
import { schoolCal } from './query.js';
import { isTyping } from './dom.js';
import { render } from './views/render.js';
import { renderSettings } from './views/drawer-settings.js';
import { readSetting, writeSetting, dueReviews } from './reviews.js';

/* A redraw replaces every field, so one arriving from a sync while someone types would
   lose their text. Hold it until they leave the field, and until any click has landed:
   redrawing between press and release would swap the button out from under the pointer. */
let heldRefresh = false, pointerDown = false;
export function refreshAfterSync() {
  if (isTyping(document.activeElement) || pointerDown) { heldRefresh = true; return; }
  heldRefresh = false;
  render(); if (ui.settings) renderSettings();
}
export const runHeldRefresh = () => setTimeout(() => { if (heldRefresh) refreshAfterSync(); });
export function pointerPressed() { pointerDown = true; }
export function pointerReleased() { pointerDown = false; runHeldRefresh(); }

/* ═════════ spaced review ═════════ */
/* After a pull, so this device already holds any review another device created:
   creating the same id twice would come back as a conflict. The pull on focus also
   covers the day rolling over. */
let reviewing = false;
export async function runReviews() {
  if (reviewing || !data.profile) return;
  reviewing = true;
  try {
    const account = data.profile.id, setting = readSetting(account);
    const { rows, through } = dueReviews(setting, data.courses, data.items, today(), schoolCal());
    if (rows.length) await store.saveRows(rows.map((row) => ({ kind: 'items', row: normalizeItem(row) })));
    if (through !== setting.through) writeSetting(account, { ...setting, through });
  } finally { reviewing = false; }
}
