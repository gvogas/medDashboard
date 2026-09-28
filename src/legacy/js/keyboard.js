// The keyboard: single-key shortcuts, Escape closing whatever is on top, Enter in the
// small add-a-thing boxes.

import { ui } from './state.js';
import { uid, httpUrl } from './model.js';
import { $, isTyping } from './dom.js';
import { renderView } from './views/render.js';
import { drawerOpen, setSide } from './views/drawer-base.js';
import { current, saveDraft, touch, renderItemDrawer } from './views/drawer-item.js';
import { leaveDrawer, saveCourseDraft } from './views/drawer-course.js';
import { addQuote } from './views/drawer-settings.js';
import { openKeys, closeKeys, keysOpen } from './views/keys.js';
import * as spotify from './spotify.js';
import * as web from './web-player.js';
import * as spotView from './views/spotify-view.js';
import { leaveFocus, setView } from './study-controller.js';
import { newItem, goToday, step } from '../../data/actions.ts';

/* Single keys, when nothing is being typed and no drawer or the focus screen is up:
   the list is views/keys.js. Each does what its top-bar button does; a number shows a view. */
const VIEW_KEYS = { 1: 'week', 2: 'month', 3: 'table', 4: 'spotify', 5: 'study' };
function shortcut(e) {
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || isTyping(e.target) || e.target.isContentEditable) return false;
  if (e.key === '?') { keysOpen() ? closeKeys() : openKeys(); e.preventDefault(); return true; }
  if (keysOpen() || ui.focus || drawerOpen() || $('app').hidden) return false;
  const run = (fn) => { e.preventDefault(); fn(); return true; };
  if (e.key === 'n') return run(newItem);
  if (e.key === 't') return run(goToday);
  if ((e.key === '[' || e.key === ']') && (ui.view === 'week' || ui.view === 'month')) return run(() => step(e.key === '[' ? -1 : 1));
  if (VIEW_KEYS[e.key]) return run(() => setView(VIEW_KEYS[e.key]));
  return false;
}

export async function onKeydown(e) {
  if (e.key === 'Escape') {
    if (e.defaultPrevented) return;   /* a field used it, like the time picker closing its list */
    if (keysOpen()) { closeKeys(); return; }
    if ($('side').classList.contains('on')) { setSide(false); return; }
    if (ui.view === 'spotify' && spotView.devicesOpen()) { spotView.closeDevices(); return; }
    if (drawerOpen()) { leaveDrawer(); return; }
    if (ui.focus) leaveFocus();
    return;
  }
  if (shortcut(e)) return;
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
  if (e.key === '/' && !/input|textarea|select/i.test(e.target.tagName)) {
    e.preventDefault(); $('search')?.focus(); return;   /* the top bar's search box */
  }
  if (e.key !== 'Enter') return;

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
  if (ui.draft && e.target.classList.contains('dtitle')) { e.preventDefault(); saveDraft(); return; }
  if (ui.courseDraft && e.target.classList.contains('dtitle')) { e.preventDefault(); saveCourseDraft(); return; }
}
