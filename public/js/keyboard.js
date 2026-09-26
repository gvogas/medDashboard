// The keyboard: single-key shortcuts, Escape closing whatever is on top, Enter in the
// small add-a-thing boxes, and moving an Open items type with the arrow keys.

import * as store from './store.js';
import { ui } from './state.js';
import { uid, normalizeItem, httpUrl } from './model.js';
import { today } from './dates.js';
import { $, isTyping } from './dom.js';
import { render, renderView } from './views/render.js';
import { renderSidebar } from './views/sidebar.js';
import { drawerOpen, setSide } from './views/drawer-base.js';
import { current, saveDraft, touch, renderItemDrawer } from './views/drawer-item.js';
import { leaveDrawer, saveCourseDraft } from './views/drawer-course.js';
import { addQuote } from './views/drawer-settings.js';
import { openKeys, closeKeys, keysOpen } from './views/keys.js';
import { rowIds, reorderTypes, addType } from './views/types-nav.js';
import * as spotify from './spotify.js';
import * as web from './web-player.js';
import * as spotView from './views/spotify-view.js';
import { leaveFocus } from './study-controller.js';

/* Single keys, when nothing is being typed and no drawer or the focus screen is up:
   the list is views/keys.js. Each presses the button it stands for. */
const VIEW_KEYS = { 1: 'week', 2: 'month', 3: 'table', 4: 'spotify', 5: 'study' };
function shortcut(e) {
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || isTyping(e.target) || e.target.isContentEditable) return false;
  if (e.key === '?') { keysOpen() ? closeKeys() : openKeys(); e.preventDefault(); return true; }
  if (keysOpen() || ui.focus || drawerOpen() || $('app').hidden) return false;
  const press = (sel) => { const b = document.querySelector(sel); if (!b) return false; e.preventDefault(); b.click(); return true; };
  if (e.key === 'n') return press('#newBtn');
  if (e.key === 't') return press('#today');
  if ((e.key === '[' || e.key === ']') && (ui.view === 'week' || ui.view === 'month')) return press(e.key === '[' ? '#prev' : '#next');
  if (VIEW_KEYS[e.key]) return press('#viewSeg [data-view="' + VIEW_KEYS[e.key] + '"]');
  return false;
}

export async function onKeydown(e) {
  if (e.key === 'Escape') {
    if (e.defaultPrevented) return;   /* a field used it, like the time picker closing its list */
    if (keysOpen()) { closeKeys(); return; }
    if ($('side').classList.contains('on')) { setSide(false); return; }
    if (e.target.closest?.('#typeNav')) { e.target.blur(); ui.typeAdd = null; ui.typeEdit = false; renderSidebar(true); return; }
    if (ui.view === 'spotify' && spotView.devicesOpen()) { spotView.closeDevices(); return; }
    if (drawerOpen()) { leaveDrawer(); return; }
    if (ui.focus) leaveFocus();
    return;
  }
  if (shortcut(e)) return;
  /* Rows that open an item (table and office-hour rows) take Enter and Space like a button. */
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('tr[data-id][tabindex]')) { e.preventDefault(); e.target.click(); return; }
  /* The Spotify view: / to search, space to play or pause, when not typing or on a button. */
  if (ui.view === 'spotify' && !e.ctrlKey && !e.metaKey && !e.altKey && !/^(input|textarea|select|button|a)$/i.test(e.target.tagName)
      && !e.target.isContentEditable && !drawerOpen()) {
    if (e.key === '/') {
      const box = document.querySelector('[data-spot-q]');
      if (box) { e.preventDefault(); box.focus(); box.select(); return; }
    }
    if (e.key === ' ' && spotify.state.connected && !e.repeat) {
      e.preventDefault();
      web.activate();
      spotify.control(spotify.state.playing ? 'pause' : 'play');
      return;
    }
  }
  if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.target.dataset?.typegrip) {
    e.preventDefault();
    const ids = rowIds(), i = ids.indexOf(e.target.dataset.typegrip), j = i + (e.key === 'ArrowUp' ? -1 : 1);
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await reorderTypes(ids, e.target.dataset.typegrip);
    return;
  }
  if (e.key === '/' && !/input|textarea|select/i.test(e.target.tagName)) {
    e.preventDefault(); $('search').focus(); return;
  }
  if (e.key !== 'Enter') return;

  if (e.target.id === 'typeName') { await addType(); return; }
  if (e.target.dataset?.typelabel) { e.target.blur(); return; }

  if (e.target.id === 'clAdd' && e.target.value.trim()) {
    const it = current(); if (!it) return;
    if (it.checklist.length >= 50) return;
    it.checklist.push({ id: uid(), text: e.target.value.trim(), done: false });
    await touch(it);
    renderItemDrawer(); renderView();
    const box = $('clAdd'); if (box) box.focus();
    return;
  }
  if (e.target.id === 'linkUrl' || e.target.id === 'linkLabel') {
    const url = $('linkUrl').value.trim(); if (!url) return;
    const it2 = current(); if (!it2 || it2.links.length >= 20) return;
    /* spaces after the host are written out as %20; one inside the host is a typo */
    const typed = /^https?:\/\//i.test(url) ? url : 'https://' + url;
    const full = typed.replace(/^(https?:\/\/[^/?#]*)(.*)$/is, (m, head, rest) => head + rest.replace(/\s/g, '%20'));
    const ok = httpUrl(full);
    $('linkUrl').setAttribute('aria-invalid', String(!ok));
    if (!ok) { $('linkUrl').focus(); return; }
    const lab = $('linkLabel').value.trim() || full.replace(/^https?:\/\//i, '');
    it2.links.push({ label: lab.slice(0, 60), url: full });
    await touch(it2);
    renderItemDrawer(); return;
  }
  if (e.target.id === 'qText' || e.target.id === 'qSrc') { e.preventDefault(); addQuote(); return; }
  if (e.target.id === 'quickTask' && e.target.value.trim()) {
    await store.saveItem(normalizeItem({ id: uid(), type: 'task', title: e.target.value.trim(), courseId: ui.course === 'all' ? null : ui.course, date: today(), status: 'todo' }));
    render();
    const q = $('quickTask'); if (q) q.focus();
    return;
  }
  if (ui.draft && e.target.classList.contains('dtitle')) { e.preventDefault(); saveDraft(); return; }
  if (ui.courseDraft && e.target.classList.contains('dtitle')) { e.preventDefault(); saveCourseDraft(); return; }
}
