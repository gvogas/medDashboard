// The sync pill and what a screen reader hears of it, redraws a sync brings in (held
// while someone types or clicks), and the spaced reviews a pull may bring due.

import * as store from './store.js';
import { data } from './store.js';
import { ui } from './state.js';
import { normalizeItem } from './model.js';
import { today } from './dates.js';
import { $, isTyping } from './dom.js';
import { render } from './views/render.js';
import { renderItemDrawer } from './views/drawer-item.js';
import { renderSettings, refreshSyncNote } from './views/drawer-settings.js';
import { readSetting, writeSetting, dueReviews } from './reviews.js';

/* ═════════ sync status pill ═════════ */
const LABELS = { idle: 'Synced', pending: 'Saving…', syncing: 'Syncing…', offline: 'Offline', error: 'Sync problem', 'signed-out': 'Signed out' };
export function showSyncStatus(s) {
  const pill = $('syncPill');
  pill.dataset.state = s.state;
  pill.textContent = LABELS[s.state] + (s.state === 'offline' && s.pending ? ' · ' + s.pending : '');
  pill.title = s.message || (s.state === 'offline' ? 'Changes are kept on this device until you are back online' : 'Sync now');
  sayTrouble(s);
  refreshSyncNote();
}
/* Screen readers hear sync trouble, and its end, not every save. */
let troubled = false;
function sayTrouble(s) {
  const bad = s.state === 'offline' || s.state === 'error' || s.state === 'signed-out';
  if (bad === troubled && !bad) return;
  const text = bad ? LABELS[s.state] + (s.message ? '. ' + s.message : '') : 'Synced again';
  if ($('syncSay').textContent !== text) $('syncSay').textContent = text;
  troubled = bad;
}

/* A redraw replaces every field, so one arriving from a sync while someone types would
   lose their text. Hold it until they leave the field, and until any click has landed:
   redrawing between press and release would swap the button out from under the pointer. */
let heldRefresh = false, pointerDown = false;
export function refreshAfterSync() {
  if (isTyping(document.activeElement) || pointerDown) { heldRefresh = true; return; }
  heldRefresh = false;
  render(); if (ui.sel) renderItemDrawer(); if (ui.settings) renderSettings();
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
    const setting = readSetting(data.profile.id);
    const { rows, through } = dueReviews(setting, data.courses, data.items, today());
    if (rows.length) await store.saveRows(rows.map((row) => ({ kind: 'items', row: normalizeItem(row) })));
    if (through !== setting.through) writeSetting(data.profile.id, { ...setting, through });
  } finally { reviewing = false; }
}
