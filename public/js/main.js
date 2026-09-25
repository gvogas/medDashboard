// Boot, sign-in, and every event handler. Views render; this file decides what happens.

import { api, ApiError, resetRequests, bindAccount } from './api.js';
import * as store from './store.js';
import { data, course } from './store.js';
import * as sync from './sync.js';
import { ui, rememberUi } from './state.js';
import { uid, isOpen, isComplete, normalizeItem, shiftEnd, useTypePrefs, typeList, typePrefsFrom, TYPE_COLOURS, MAX_CUSTOM_TYPES, statusesFor } from './model.js';
import { typeOn } from './query.js';
import { iso, parse, addDays, today } from './dates.js';
import { $, autoGrow, isTyping } from './dom.js';
import { render, renderView, renderHeader } from './views/render.js';
import { renderSidebar } from './views/sidebar.js';
import { renderStats, renderQuote, nextQuote } from './views/stats.js';
import { drawer, scrim, closeDrawer, drawerHasFocus, beforeClose } from './views/drawer-base.js';
import { openItem, newItem, current, saveDraft, touch, touchSoon, flushTouch, renderItemDrawer } from './views/drawer-item.js';
beforeClose.add(flushTouch);
let startBase = null;   /* the item's times when its start field took focus */
document.addEventListener('focusin', (e) => {
  if (e.target.dataset?.f !== 'start') return;
  const it = current();
  startBase = it ? { id: it.id, start: it.start, end: it.end } : null;
});
document.addEventListener('focusout', (e) => { if (drawer.contains(e.target)) flushTouch(); });
window.addEventListener('pagehide', flushTouch);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushTouch(); });
import { openCourse, renderCourseDrawer, saveCourseDraft, deleteCourseDraft } from './views/drawer-course.js';
import { openSettings, renderSettings, applyCoat, refreshSyncNote, refreshSpotifyGroup } from './views/drawer-settings.js';
import * as spotify from './spotify.js';
import * as web from './web-player.js';
import { renderPlayer } from './views/player.js';
import * as spotView from './views/spotify-view.js';
import { renderSignIn, hideSignIn } from './views/signin.js';
import { schedule as drawOrnament } from './ornament.js';
import { parseTime } from './timepicker.js';
import { launch as fireworks } from './fireworks.js';
import { readSetting, writeSetting, dueReviews, nextReview } from './reviews.js';
import { fillTopics } from './prep.js';
import { pdfText } from './pdftext.js';
import { previewImport, previewOutline, renderImport, editImport, commitImport } from './views/drawer-import.js';

/* ═════════ theme ═════════ */
useTypePrefs(() => data.profile?.types || []);

/* The Open items editor: every change saves the whole list to the profile. */
async function saveTypes(list) {
  await store.saveProfile({ types: typePrefsFrom(list) });
  render();
  renderSidebar(true);
}

function typesOnScreen() {
  const list = typeList(ui.bg, data.items);
  document.querySelectorAll('#typeNav [data-typelabel]').forEach((box) => {
    const t = list.find((x) => x.id === box.dataset.typelabel), label = box.value.trim().slice(0, 24);
    if (t && (label || !t.custom)) t.label = label;
  });
  return list;
}

/* Save a new order (ids top to bottom), then put the keyboard back on the handle. */
async function reorderTypes(ids, focusId) {
  const list = typesOnScreen();
  list.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  await saveTypes(list);
  if (focusId) document.querySelector('#typeNav [data-typegrip="' + focusId + '"]')?.focus();
}

const rowIds = () => [...document.querySelectorAll('#typeNav [data-typegrip]')].map((g) => g.dataset.typegrip);

/* Drag a ≡ handle (listening on the document: moving the row would drop a pointer capture): the row moves among the others as the pointer passes their middles; drop saves. */
function dragType(e, grip) {
  const row = grip.closest('.typerow'), nav = $('typeNav'), before = rowIds().join();
  e.preventDefault();
  row.classList.add('dragging');
  const move = (ev) => {
    const others = [...nav.querySelectorAll('.typerow')].filter((r) => r !== row);
    const next = others.find((r) => { const b = r.getBoundingClientRect(); return ev.clientY < b.top + b.height / 2; });
    if (next) { if (row.nextElementSibling !== next) nav.insertBefore(row, next); }
    else if (others.length) others[others.length - 1].after(row);
  };
  const drop = (ev) => {
    if (ev.type === 'pointerup') move(ev);   /* where it was let go, even if no move arrived */
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', drop);
    document.removeEventListener('pointercancel', drop);
    row.classList.remove('dragging');
    const ids = rowIds();
    if (ids.join() !== before) reorderTypes(ids);
  };
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', drop);
  document.addEventListener('pointercancel', drop);
}

async function editTypes(el) {
  const list = typesOnScreen(), i = list.findIndex((t) => t.id === (el.dataset.typecolour || el.dataset.typehide || el.dataset.typedel));
  if (i < 0) return;
  const t = list[i];
  if (el.dataset.typecolour) {
    t.color = TYPE_COLOURS[(TYPE_COLOURS.indexOf(t.color) + 1) % TYPE_COLOURS.length];
  } else if (el.dataset.typehide) {
    t.hidden = !t.hidden; t.hiddenSet = true;
  } else if (el.dataset.typedel) {
    if (!t.custom || data.items.some((it) => it.type === t.id)) return;
    list.splice(i, 1);
  }
  await saveTypes(list);
  /* keep the keyboard where it was after the redraw */
  const again = document.querySelector('#typeNav [data-' + Object.keys(el.dataset).find((k) => k.startsWith('type')) + '="' + t.id + '"]');
  if (again) again.focus();
}

async function addType() {
  const a = ui.typeAdd, label = a?.label.trim();
  if (!label) return;
  const list = typeList(ui.bg, data.items);
  if (list.filter((t) => t.custom).length >= MAX_CUSTOM_TYPES) return;
  list.push({ id: 'c-' + uid(), label: label.slice(0, 24), color: a.color, kind: a.kind, custom: true, hidden: false });
  ui.typeAdd = null;
  await saveTypes(list);
}

function setTheme(choice, { persist = true } = {}) {
  ui.theme = choice;
  if (window.__roundsApplyTheme) window.__roundsApplyTheme(choice);
  rememberUi();
  if (persist && data.profile && data.profile.theme !== choice) store.saveProfile({ theme: choice });
  if (ui.settings) renderSettings();
  drawOrnament();                     /* the ornament layer is drawn in the theme's teal */
}
function followSystem() { if (ui.theme === 'system') setTheme('system', { persist: false }); }

/* ═════════ background: Med or CS art, independent of light/dark ═════════ */
function setBg(choice, { persist = true } = {}) {
  ui.bg = choice === 'cs' ? 'cs' : 'med';
  document.documentElement.setAttribute('data-bg', ui.bg);
  rememberUi();
  if (persist && data.profile && data.profile.bg !== ui.bg) store.saveProfile({ bg: ui.bg });
  if (data.profile) render();          /* the sidebar, stats and type lists change with it */
  if (ui.settings) renderSettings();
  drawOrnament();
}
if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', followSystem);

/* ═════════ sync status pill ═════════ */
const LABELS = { idle: 'Synced', pending: 'Saving…', syncing: 'Syncing…', offline: 'Offline', error: 'Sync problem', 'signed-out': 'Signed out' };
sync.onStatus((s) => {
  const pill = $('syncPill');
  pill.dataset.state = s.state;
  pill.textContent = LABELS[s.state] + (s.state === 'offline' && s.pending ? ' · ' + s.pending : '');
  pill.title = s.message || (s.state === 'offline' ? 'Changes are kept on this device until you are back online' : 'Sync now');
  refreshSyncNote();
});
sync.onPulled(async () => {
  await runReviews();
  refreshAfterSync();
});

/* A redraw replaces every field, so one arriving from a sync while someone types would
   lose their text. Hold it until they leave the field, and until any click has landed:
   redrawing between press and release would swap the button out from under the pointer. */
let heldRefresh = false, pointerDown = false, searchTimer = null;
function refreshAfterSync() {
  if (isTyping(document.activeElement) || pointerDown) { heldRefresh = true; return; }
  heldRefresh = false;
  render(); if (ui.sel) renderItemDrawer(); if (ui.settings) renderSettings();
}
const runHeldRefresh = () => setTimeout(() => { if (heldRefresh) refreshAfterSync(); });
document.addEventListener('focusout', runHeldRefresh);
document.addEventListener('pointerdown', () => { pointerDown = true; }, true);
for (const type of ['pointerup', 'pointercancel']) document.addEventListener(type, () => { pointerDown = false; runHeldRefresh(); }, true);
sync.onUnauthenticated(() => showSignIn('Your session has ended. Sign in again.'));

/* ═════════ spaced review ═════════ */
/* After a pull, so this device already holds any review another device created:
   creating the same id twice would come back as a conflict. The pull on focus also
   covers the day rolling over. */
let reviewing = false;
async function runReviews() {
  if (reviewing || !data.profile) return;
  reviewing = true;
  try {
    const setting = readSetting();
    const { rows, through } = dueReviews(setting, data.courses, data.items, today());
    if (rows.length) await store.saveRows(rows.map((row) => ({ kind: 'items', row: normalizeItem(row) })));
    if (through !== setting.through) writeSetting({ ...setting, through });
  } finally { reviewing = false; }
}
/** A review step just finished: schedule the next one. */
async function chainReview(it) {
  if (it.status !== 'done') return;
  const next = nextReview(it, today(), data.items);
  if (next) await store.saveItem(normalizeItem(next));
}

/* ═════════ the Spotify badge on the coat ═════════ */
spotify.onState((s, kind) => {
  renderPlayer(s, kind);
  if (kind !== 'state') return;
  if (s.connected) web.start(); else if (s.loaded) web.stop();     /* the tab is a device only while connected */
  if (ui.settings && !drawerHasFocus()) refreshSpotifyGroup();
  if (ui.view === 'spotify') { spotView.onPlayerState(); renderHeader(); }
});
web.onChange(() => {
  renderPlayer(spotify.state);
  if (ui.settings && !drawerHasFocus()) refreshSpotifyGroup();
});
spotView.onChange(() => { if (ui.view === 'spotify') renderView(); });   /* the view keeps its own scroll and caret */
spotify.onUnauthenticated(() => showSignIn('Your session has ended. Sign in again.'));

/* Spotify's consent page sends the browser back to /#spotify=connected or =error. */
function spotifyReturn() {
  const m = location.hash.match(/^#spotify=(connected|error)$/);
  if (!m) return null;
  history.replaceState(null, '', location.pathname + location.search);
  return m[1];
}

/* ═════════ the quote tile turns its own page ═════════ */
const QUOTE_EVERY_MS = 25000;
setInterval(() => {
  if (document.visibilityState !== 'visible' || !data.profile) return;
  if (document.querySelector('.qcard:hover, .qcard:focus-within')) return;   /* being read: leave it */
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  nextQuote();
}, QUOTE_EVERY_MS);

/* ═════════ boot ═════════ */
function rememberedSession() {
  try { return JSON.parse(localStorage.getItem('rounds.session') || 'null'); } catch { return null; }
}

async function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  const profile = await sync.startingProfile(rememberedSession());
  if (profile) { try { await start(profile); } catch (e) { showSignIn(e.message); } } else showSignIn();
}

async function start(profile) {
  bindAccount(profile.id);
  await store.open(profile);
  hideSignIn();
  setTheme(data.profile.theme || ui.theme, { persist: false });
  setBg(data.profile.bg || ui.bg, { persist: false });
  applyCoat();
  ui.quoteIx = data.quotes.length ? Math.floor(Math.random() * data.quotes.length) : 0;
  render();
  drawOrnament();
  sync.init();
  sync.syncNow();
  spotify.start();
  const back = spotifyReturn();
  if (back) { ui.spotifyNote = back; openSettings('spotifyGrp'); }
}

store.subscribe((evt) => {
  if (evt.type === 'save-error') alert('The change could not be saved on this device. ' + evt.message);
  if (evt.type === 'signed-out') { sync.stop(); spotify.stop(); web.stop(); resetRequests(); location.reload(); }
  if (evt.type === 'remote' && data.profile) refreshAfterSync();
});
window.addEventListener('storage', (event) => {
  if (event.key !== 'rounds.session' || !data.profile) return;
  let id;
  try { id = JSON.parse(event.newValue || 'null')?.id; } catch {}
  if (id !== data.profile.id) {
    sync.stop(); spotify.stop(); web.stop(); resetRequests();
    store.close().finally(() => location.reload());
  }
});

function showSignIn(error, username = '') {
  renderSignIn({ error, username });
}

async function signOut({ everywhere = false } = {}) {
  await store.reload();
  if ((store.pendingCount() || store.conflicts.length) && !confirm('There are unsynced edits or saved conflict copies on this device. Export them from Settings before signing out. Sign out and erase them anyway?')) return;
  sync.stop();
  spotify.stop();
  resetRequests();
  try { await (everywhere ? api.revokeAll() : api.signOut()); }
  catch {
    sync.init();
    spotify.start();
    alert('Sign-out failed. Check your connection and try again.');
    return;
  }
  await sync.drain();
  const id = data.profile?.id;
  spotify.stop();
  web.stop();
  closeDrawer();
  if (id) {
    try { await store.wipe(id); }
    catch (e) { alert('You are signed out, but local cleanup is still pending. ' + e.message); }
  } else await store.close();
  location.reload(); // Clear every in-memory account cache at the session boundary.
}

document.addEventListener('submit', (e) => {
  if (!e.target.matches('[data-spot-form]')) return;
  e.preventDefault();
  spotView.typed('');                               /* no delayed search after this one */
  spotView.search(e.target.querySelector('[data-spot-q]').value);
});

$('signin').addEventListener('submit', async (e) => {
  if (e.target.id !== 'loginForm') return;
  e.preventDefault();
  const username = $('loginUser').value.trim(), password = $('loginPass').value;
  const btn = $('loginBtn'); btn.disabled = true; btn.textContent = 'Signing in…';
  try {
    sync.stop();
    spotify.stop();
    resetRequests();
    await api.login(username, password);
    location.reload();
  } catch (err) {
    showSignIn(!(err instanceof ApiError) ? 'You seem to be offline.'
      : err.status === 401 ? 'Wrong username or password.'
      : err.status === 429 ? 'Too many attempts. Try again in ' + Math.max(1, Math.ceil((err.body?.retryAfter || 60) / 60)) + ' min.'
      : err.status === 403 ? 'Sign in from the app itself, not from another site.'
      : 'Sign-in failed (' + (err.body?.error || err.status) + ').', username);
  }
});

/* ═════════ events ═════════ */
document.addEventListener('click', async (e) => {
  let el;
  if ((el = e.target.closest('[data-newcourse]'))) { openCourse(null); return; }
  if ((el = e.target.closest('[data-editcourse]'))) { openCourse(el.dataset.editcourse); return; }
  if ((el = e.target.closest('[data-color]'))) {
    if (ui.courseDraft) { ui.courseDraft.color = el.dataset.color; renderCourseDrawer(); }
    return;
  }
  if ((el = e.target.closest('[data-mx]'))) {
    if (ui.courseDraft) {
      ui.courseDraft.meetings = ui.courseDraft.meetings.filter((m) => m.id !== el.dataset.mx);
      renderCourseDrawer();
    }
    return;
  }
  if ((el = e.target.closest('[data-typeadd]'))) {
    const used = typeList(ui.bg, data.items).map((t) => t.color);
    ui.typeAdd = el.dataset.typeadd === '1' ? { label: '', color: TYPE_COLOURS.find((c) => !used.includes(c)) || TYPE_COLOURS[0], kind: 'todo' } : null;
    ui.typeEdit = false;
    renderSidebar(true);
    if (ui.typeAdd) $('typeName').focus();
    return;
  }
  if ((el = e.target.closest('[data-typeedit]'))) { ui.typeEdit = el.dataset.typeedit === '1'; ui.typeAdd = null; renderSidebar(true); return; }
  if ((el = e.target.closest('[data-typeaddcolour]'))) { ui.typeAdd.color = el.dataset.typeaddcolour; renderSidebar(true); return; }
  if ((el = e.target.closest('[data-typekind]'))) { ui.typeAdd.kind = el.dataset.typekind; renderSidebar(true); return; }
  if (e.target.closest('[data-typesave]')) { await addType(); return; }
  if ((el = e.target.closest('[data-typecolour], [data-typehide], [data-typedel]'))) { await editTypes(el); return; }
  if ((el = e.target.closest('[data-type]'))) {
    const all = typeList(ui.bg, data.items).map((x) => x.id), t = el.dataset.type, on = all.filter(typeOn).length;
    if (typeOn(t) && on === all.length) all.forEach((x) => { ui.types[x] = (x === t); });
    else if (typeOn(t) && on === 1) all.forEach((x) => { ui.types[x] = true; });
    else ui.types[t] = !typeOn(t);
    render(); return;
  }
  if ((el = e.target.closest('[data-course]'))) { ui.course = el.dataset.course; render(); return; }
  if ((el = e.target.closest('#viewSeg button'))) { ui.view = el.dataset.view; rememberUi(); render(); return; }
  if (e.target.closest('#menuBtn')) { setSide(!$('side').classList.contains('on')); return; }
  if (e.target.closest('#newBtn')) { newItem(ui.anchor); return; }
  if (e.target.closest('#today')) { ui.anchor = today(); render(); return; }
  if (e.target.closest('#prev') || e.target.closest('#next')) {
    const dir = e.target.closest('#prev') ? -1 : 1, a = parse(ui.anchor);
    ui.anchor = ui.view === 'month' ? iso(new Date(a.getFullYear(), a.getMonth() + dir, 1)) : iso(addDays(a, 7 * dir));
    render(); return;
  }
  if (e.target.closest('#syncPill')) { sync.syncNow(); return; }
  if (e.target.closest('#setBtn')) { ui.settings ? closeDrawer() : openSettings(); return; }
  if ((el = e.target.closest('[data-setopen]'))) { openSettings('o-name'); return; }
  if ((el = e.target.closest('[data-settab]'))) { ui.settingsTab = el.dataset.settab; renderSettings(); return; }
  if ((el = e.target.closest('[data-spotify]'))) {
    const act = el.dataset.spotify;
    if (act !== 'connect') web.activate();          /* inside the click, so the tab may make sound */
    if (act === 'connect') openSettings('spotifyGrp');
    else if (act === 'here') spotify.playHere();
    else if (act === 'previous') spotify.previous();
    else spotify.control(act);
    return;
  }
  if (spotView.devicesOpen() && !e.target.closest('.spot-devs, [data-spot-devices]')) spotView.closeDevices();
  if ((el = e.target.closest('[data-spot-pane]'))) { el.dataset.spotPane === 'queue' ? spotView.openQueue(true) : spotView.openHome(); return; }
  if ((el = e.target.closest('[data-spot-pl]'))) { spotView.openPlaylist(el.dataset.spotPl, el.dataset.spotName); return; }
  if ((el = e.target.closest('[data-spot-album]'))) { spotView.openAlbum(el.dataset.spotAlbum); return; }
  if ((el = e.target.closest('[data-spot-artist]'))) { spotView.openArtist(el.dataset.spotArtist); return; }
  if ((el = e.target.closest('[data-spot-refresh]'))) { spotView.refresh(el.dataset.spotRefresh); return; }
  if ((el = e.target.closest('[data-spot-more]'))) { spotView.more(el.dataset.spotMore); return; }
  if ((el = e.target.closest('[data-spot-play]'))) { web.activate(); spotView.play(el.dataset.spotPlay, el.dataset.spotCtx, el.dataset.spotList); return; }
  if ((el = e.target.closest('[data-spot-queue]'))) { spotView.queueAdd(el.dataset.spotQueue, el); return; }
  if (e.target.closest('[data-spot-shuffle]')) { spotView.toggleShuffle(); return; }
  if (e.target.closest('[data-spot-repeat]')) { spotView.cycleRepeat(); return; }
  if (e.target.closest('[data-spot-devices]')) { spotView.toggleDevices(); return; }
  if ((el = e.target.closest('[data-spot-device]'))) { web.activate(); spotView.pickDevice(el.dataset.spotDevice); return; }
  if ((el = e.target.closest('[data-quotenext]'))) {
    const r = el.getBoundingClientRect();
    fireworks(r.left + r.width / 2, r.top + 4);
    if (!nextQuote()) openSettings('qText');
    return;
  }
  if ((el = e.target.closest('[data-themeset]'))) { setTheme(el.dataset.themeset); return; }
  if ((el = e.target.closest('[data-bgset]'))) { setBg(el.dataset.bgset); return; }
  if ((el = e.target.closest('[data-coatcolor]'))) {
    await store.saveProfile({ coat: { color: el.dataset.coatcolor } });
    applyCoat(); renderSettings(); return;
  }
  if ((el = e.target.closest('[data-qx]'))) {
    await store.deleteQuote(el.dataset.qx);
    if (ui.quoteIx >= data.quotes.length) ui.quoteIx = 0;
    renderSettings(); renderQuote(); return;
  }
  if ((el = e.target.closest('[data-add]'))) { e.stopPropagation(); newItem(el.dataset.add); return; }
  if ((el = e.target.closest('[data-toggle]'))) {
    const it = store.item(el.dataset.toggle);
    if (it) {
      const finishing = isOpen(it);
      if (finishing) celebrate(el);
      setStatus(it, finishing ? 'done' : 'todo');
      await touch(it);
      await chainReview(it);
    }
    render(); return;
  }
  if ((el = e.target.closest('.row, tbody tr[data-id], .task .tx, .oh tbody tr'))) {
    const host = el.dataset.id ? el : el.closest('[data-id]');
    if (host && host.dataset.id) { openItem(host.dataset.id); return; }
  }
  if (e.target.closest('[data-monthdeadlines]')) { ui.monthDeadlines = !ui.monthDeadlines; rememberUi(); renderView(); return; }
  if ((el = e.target.closest('[data-day]'))) { ui.anchor = el.dataset.day; ui.view = 'week'; rememberUi(); render(); return; }
  if ((el = e.target.closest('[data-sort]'))) {
    const k = el.dataset.sort;
    if (ui.sort.key === k) ui.sort.dir *= -1; else { ui.sort.key = k; ui.sort.dir = 1; }
    renderView(); return;
  }

  if ((el = e.target.closest('[data-act]'))) {
    const act = el.dataset.act, it = current();
    if (act === 'close' || act === 'cancel') closeDrawer();
    else if (act === 'save') saveDraft();
    else if (act === 'delete') { ui.confirm = 'item'; renderItemDrawer(); }
    else if (act === 'keep') { ui.confirm = null; ui.courseDraft ? renderCourseDrawer() : renderItemDrawer(); }
    else if (act === 'delete-yes' && it) { await store.deleteItem(it.id); closeDrawer(); }
    else if (act === 'addmtg' && ui.courseDraft) {
      ui.courseDraft.meetings = ui.courseDraft.meetings || [];
      ui.courseDraft.meetings.push({ id: uid(), kind: 'Lecture', weekday: 1, start: '09:00', end: '10:00', room: '' });
      renderCourseDrawer();
    }
    else if (act === 'addquote') addQuote();
    else if (act === 'course-save') saveCourseDraft();
    else if (act === 'course-delete') { ui.confirm = 'course'; renderCourseDrawer(); }
    else if (act === 'course-delete-yes' && ui.courseDraft) deleteCourseDraft();
    else if (act === 'fill-topics' && it) {
      const c = course(it.courseId); if (!c) return;
      const r = fillTopics(it, c, data.items, data.profile?.termStart);
      it.checklist = r.checklist;
      if (r.added) await touch(it);
      ui.fillNote = r.added ? 'Added ' + r.added + ' lecture' + (r.added === 1 ? '' : 's') + '.' + (r.left ? ' ' + r.left + ' more did not fit under the 50-step limit.' : '')
        : r.left ? 'The list is full: 50 steps is the most an item can hold.' : 'Every lecture before this exam is already listed.';
      renderItemDrawer(); renderStats(); renderView();
    }
    else if (act === 'import-paste') {
      const box = $('importText');
      const text = box ? box.value : '';
      if (!text.trim()) return;
      const error = previewImport(text);
      if (error) { ui.importNote = { text: error, error: true }; renderSettings(); }
    }
    else if (act === 'import-cancel') openSettings('importGrp');
    else if (act === 'import-confirm') {
      el.disabled = true;
      let note;
      try { note = { text: await commitImport() }; }
      catch (error) { note = { text: 'The import stopped part-way: ' + error.message, error: true }; }
      render();
      openSettings('importGrp');
      ui.importNote = note;
      renderSettings();
    }
    else if (act === 'export-data') {
      await store.reload();
      const blob = new Blob([JSON.stringify({ ...store.data, pending: await store.pending(), conflicts: store.conflicts }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = 'rounds-backup.json'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    else if (act === 'conflict-restore' || act === 'conflict-dismiss') {
      try { await store.resolveConflict(el.dataset.conflict, act === 'conflict-restore'); renderSettings(); }
      catch (error) { alert(error.message); }
    }
    else if (act === 'signout') signOut();
    else if (act === 'signout-all') signOut({ everywhere: true });
    else if (act === 'spotify-disconnect') {
      try { await api.spotifyDisconnect(); }
      catch { alert('Spotify could not be disconnected. Try again when you are online.'); return; }
      location.reload();
    }
    return;
  }
  if ((el = e.target.closest('[data-cl]'))) {
    const s = current(); if (!s) return;
    s.checklist.forEach((x) => { if (x.id === el.dataset.cl) x.done = !x.done; });
    await touch(s);
    renderItemDrawer(); renderStats(); renderView(); return;
  }
  if ((el = e.target.closest('[data-clx]'))) {
    const s2 = current(); if (!s2) return;
    s2.checklist = s2.checklist.filter((x) => x.id !== el.dataset.clx);
    await touch(s2);
    renderItemDrawer(); renderView(); return;
  }
  if ((el = e.target.closest('[data-linkx]'))) {
    const s3 = current(); if (!s3) return;
    s3.links.splice(+el.dataset.linkx, 1);
    await touch(s3);
    renderItemDrawer(); return;
  }
  if (!e.target.closest('#side') && !e.target.closest('#menuBtn') && $('side').classList.contains('on')) setSide(false);
});

/* On narrow screens the sidebar slides over the page. Closed, it is inert, so Tab does
   not wander through it off-screen; open, it takes focus and Escape closes it. */
const narrow = window.matchMedia('(max-width:900px)');
function setSide(open) {
  const side = $('side'), btn = $('menuBtn');
  side.classList.toggle('on', open);
  side.inert = narrow.matches && !open;
  btn.setAttribute('aria-expanded', String(open));
  if (open) side.querySelector('button, input')?.focus();
  else if (side.contains(document.activeElement)) btn.focus();
}
narrow.addEventListener('change', () => setSide(false));
setSide(false);

scrim.addEventListener('click', closeDrawer);

/* Some items name themselves from the course: office hours after the teacher, exams
   and tutorials after the class. Picking a course (or switching type) fills the title in, unless
   the title was typed by hand. */
function autoTitleFor(type, c) {
  if (!c) return '';
  if (type === 'office') return c.instructor ? c.instructor + ' — office hours' : '';
  if (type === 'exam') return c.name ? 'Exam — ' + c.name : '';
  if (type === 'tutoring') return c.name ? c.name + ' — tutorial' : '';
  return '';
}
function autoTitle(it, prevCourseId) {
  const next = autoTitleFor(it.type, course(it.courseId));
  if (!next) return;
  const wasAuto = ['office', 'exam', 'tutoring'].some((t) => it.title === autoTitleFor(t, course(prevCourseId)) || it.title === autoTitleFor(t, course(it.courseId)));
  if (it.title.trim() && !wasAuto) return;
  it.title = next;
  const ta = drawer.querySelector('.dtitle');
  if (ta) { ta.value = next; autoGrow(ta); }
  if (ui.draft) {
    const b = drawer.querySelector('[data-act="save"]'), h = drawer.querySelector('.dfoot .hint');
    if (b) b.disabled = false;
    if (h) h.textContent = 'Ready to save';
  }
}

/* A small show from an element, for finishing something. */
function celebrate(el) {
  const r = el.getBoundingClientRect();
  fireworks(r.left + r.width / 2, r.top + r.height / 2, { rockets: 2 });
}

function setStatus(it, status) {
  it.status = status;
  it.completedAt = status === 'todo' ? null : (it.completedAt || Date.now());
}

async function addQuote() {
  const t = $('qText'), s = $('qSrc');
  if (!t || !t.value.trim()) return;
  await store.saveQuote({ id: uid(), text: t.value.trim().replace(/^[“"']|[”"']$/g, ''), source: s ? s.value.trim() : '' });
  ui.quoteIx = data.quotes.length - 1;
  ui.focusField = 'qText';
  renderSettings(); renderQuote();
}

document.addEventListener('input', async (e) => {
  const d = e.target.dataset || {};

  if ('reviews' in d) {
    const setting = readSetting();
    writeSetting(e.target.checked ? { on: true, through: setting.through && setting.on ? setting.through : null } : { on: false, through: null });
    await runReviews();
    renderSettings(); return;
  }
  if ('impM' in d || 'impI' in d || 'impType' in d || 'impWeek1' in d) { editImport(e.target); return; }

  if ('typename' in d && ui.typeAdd) {
    ui.typeAdd.label = e.target.value;
    const b = document.querySelector('[data-typesave]');
    if (b) b.disabled = !e.target.value.trim();
    return;
  }
  if ('spotVol' in d) { spotView.setVolume(+e.target.value); return; }
  if ('spotQ' in d) { spotView.typed(e.target.value); return; }
  if ('spotFilter' in d) { spotView.setFilter(e.target.value); return; }

  if (d.of) {                             /* what the coat says */
    await store.saveProfile({ coat: { [d.of]: e.target.value } });
    const prev = $(d.of === 'name' ? 'coatPrevName' : 'coatPrevRole');
    if (prev) prev.textContent = e.target.value;
    renderSidebar(); return;
  }

  if (d.cf && ui.courseDraft) {           /* course fields */
    ui.courseDraft[d.cf] = d.cf === 'archived' ? e.target.checked : e.target.value;
    if (d.cf === 'name') autoGrow(e.target);
    const hint = drawer.querySelector('.dfoot .hint'), btn = drawer.querySelector('[data-act="course-save"]');
    if (btn) btn.disabled = !ui.courseDraft.name.trim();
    if (hint) hint.textContent = ui.courseDraft.name.trim() ? (ui.courseMode === 'new' ? 'Ready to save' : 'Unsaved changes') : 'Give it a name to save';
    return;
  }
  if (d.mf && ui.courseDraft) {           /* class meeting fields */
    const wrap = e.target.closest('[data-mid]'); if (!wrap) return;
    ui.courseDraft.meetings.forEach((m) => {
      if (m.id !== wrap.dataset.mid) return;
      m[d.mf] = d.mf === 'weekday' ? +e.target.value
        : d.mf === 'start' || d.mf === 'end' ? (parseTime(e.target.value) || m[d.mf])
        : e.target.value;
    });
    return;
  }
  if (d.f) {                              /* item fields */
    const it = current(); if (!it) return;
    if (d.f === 'recur') {
      it.recur = e.target.checked ? 'weekly' : null;
      it.weekday = it.recur ? parse(it.date).getDay() : null;
      if (!it.recur) it.recurUntil = null;
    } else if (d.f === 'weight') {
      it.weight = e.target.value === '' || !(+e.target.value > 0) ? null : Math.min(100, +e.target.value);
    } else if (d.f === 'grade') {
      it.grade = e.target.value === '' ? null : Math.max(0, Math.min(100, +e.target.value));
    } else if (d.f === 'courseId' || d.f === 'recurUntil') {
      const before = it.courseId;
      it[d.f] = e.target.value || null;
      if (d.f === 'courseId') autoTitle(it, before);
    } else if (d.f === 'status') {
      const wasDone = isComplete(it);
      setStatus(it, e.target.value);
      if (!wasDone && isComplete(it)) celebrate(e.target);
    } else if (d.f === 'start' || d.f === 'end') {
      it[d.f] = parseTime(e.target.value) || '';      /* half-typed stays out of the model until it parses */
      if (d.f === 'start' && it.start && startBase?.id === it.id) {
        /* moving the start moves the end with it, measured from before this edit so
           half-typed times along the way do not stretch or shrink it */
        it.end = shiftEnd(startBase.start, startBase.end, it.start);
        const endBox = drawer.querySelector('[data-f="end"]');
        if (endBox) endBox.value = it.end;
      }
    } else {
      it[d.f] = e.target.value;
      if (d.f === 'date' && it.recur === 'weekly') it.weekday = parse(it.date).getDay();
      if (d.f === 'type') autoTitle(it, it.courseId);
      /* a status the new type does not have (Submitted on a Task) goes back to its first */
      if (d.f === 'type' && !statusesFor(it.type).some((x) => x[0] === it.status)) setStatus(it, 'todo');
    }
    if (d.f === 'title') {
      autoGrow(e.target);
      if (ui.draft) {
        const b = drawer.querySelector('[data-act="save"]'), h = drawer.querySelector('.dfoot .hint');
        if (b) b.disabled = !it.title.trim();
        if (h) h.textContent = it.title.trim() ? 'Ready to save' : 'Give it a name to save';
      }
    }
    if (!ui.draft) {
      /* notes show nowhere on the board except through the search, so typing them redraws nothing */
      const redraw = () => { if (d.f !== 'notes' || ui.search) { renderStats(); renderSidebar(); renderView(); } };
      /* only plain text waits: other fields change what is derived from them (the end
         follows the start, the weekday the date), and those must save together */
      if (d.f === 'title' || d.f === 'notes' || d.f === 'where') touchSoon(it, d.f, redraw);
      else {
        await touch(it);
        if (d.f === 'status') await chainReview(it);
        redraw();
      }
    }
    if (d.f === 'type' || d.f === 'status' || d.f === 'recur') renderItemDrawer();
    return;
  }
  if (d.cltext) {
    const s = current(); if (!s) return;
    s.checklist.forEach((x) => { if (x.id === d.cltext) x.text = e.target.value; });
    touchSoon(s, 'checklist');
    return;
  }
  if (e.target.id === 'search') {
    ui.search = e.target.value;
    clearTimeout(searchTimer);   /* redraw once typing pauses, not on every key */
    searchTimer = setTimeout(renderView, 120);
    return;
  }
});

const OUTLINE_ERRORS = {
  outline_unsupported: 'That kind of file cannot be read. Try a PDF or Word document.',
  outline_empty: 'No text was found in that file. A scanned outline needs to be a text PDF.',
  outline_unreadable: 'The outline could not be understood. Try again, or import a CSV instead.',
  outline_unavailable: 'The outline reader is not available right now. Try again later.',
  outline_limit: 'That is the limit of 10 outlines for today. Try again tomorrow.',
  outline_quota: 'The free AI allowance for today is used up. It resets at 8 pm Eastern (midnight UTC).',
  too_large: 'That file is over 5 MB.',
};
async function readOutlineFile(file) {
  if (file.size > 5 * 1024 * 1024) { ui.importNote = { text: OUTLINE_ERRORS.too_large, error: true }; renderSettings(); return; }
  ui.outlineBusy = true; ui.importNote = null; renderSettings();
  try {
    /* PDFs are read here: the Worker's converter drops the text of many tables. */
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    const body = isPdf ? new Blob([await pdfText(file)], { type: 'text/plain' }) : file;
    const outline = await api.readOutline(body, { name: file.name, today: today(), termStart: data.profile?.termStart || '' });
    ui.outlineBusy = false;
    previewOutline(outline, file.name);
  } catch (err) {
    ui.outlineBusy = false;
    const code = err instanceof ApiError ? err.body?.error : null;
    ui.importNote = { text: OUTLINE_ERRORS[code] || (err instanceof ApiError ? 'The outline could not be read (' + (code || err.status) + ').' : 'You seem to be offline. Reading an outline needs a connection.'), error: true };
    if (ui.settings) renderSettings();
  }
}

document.addEventListener('pointerdown', (e) => {
  const grip = e.target.closest?.('[data-typegrip]');
  if (grip && e.button === 0) dragType(e, grip);
});

document.addEventListener('change', async (e) => {
  const renamed = e.target.dataset?.typelabel;
  if (renamed) {
    const list = typesOnScreen(), t = list.find((x) => x.id === renamed);
    const label = e.target.value.trim().slice(0, 24);
    if (!t || (!label && t.custom)) { renderSidebar(true); return; }
    t.label = label;                       /* empty on a built-in: back to its own name */
    e.target.blur();
    await saveTypes(list);
    return;
  }
  if (e.target.id === 'outlineFile' && e.target.files?.[0]) { readOutlineFile(e.target.files[0]); return; }
  if (e.target.id !== 'importFile' || !e.target.files?.[0]) return;
  const file = e.target.files[0];
  if (file.size > 2_000_000) { ui.importNote = { text: 'That file is over 2 MB; export a single term instead.', error: true }; renderSettings(); return; }
  const error = previewImport(await file.text(), file.name);
  if (error) { ui.importNote = { text: error, error: true }; renderSettings(); }
});

document.addEventListener('keydown', async (e) => {
  if (e.key === 'Escape') {
    if (e.defaultPrevented) return;   /* a field used it, like the time picker closing its list */
    if ($('side').classList.contains('on')) { setSide(false); return; }
    if (e.target.closest?.('#typeNav')) { e.target.blur(); ui.typeAdd = null; ui.typeEdit = false; renderSidebar(true); return; }
    if (ui.view === 'spotify' && spotView.devicesOpen()) { spotView.closeDevices(); return; }
    if (ui.sel || ui.draft || ui.courseDraft || ui.settings) closeDrawer();
    return;
  }
  /* Rows that open an item (table and office-hour rows) take Enter and Space like a button. */
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('tr[data-id][tabindex]')) { e.preventDefault(); e.target.click(); return; }
  /* The Spotify view: / to search, space to play or pause, when not typing or on a button. */
  if (ui.view === 'spotify' && !e.ctrlKey && !e.metaKey && !e.altKey && !/^(input|textarea|select|button|a)$/i.test(e.target.tagName)
      && !e.target.isContentEditable && !ui.sel && !ui.draft && !ui.courseDraft && !ui.settings) {
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
    const lab = $('linkLabel').value.trim();
    it2.links.push({ label: lab || url.replace(/^https?:\/\//, ''), url: /^https?:\/\//.test(url) ? url : 'https://' + url });
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
});

boot();
