// Boot, sign-in, and every event handler. Views render; this file decides what happens.

import { api, ApiError, resetRequests, bindAccount } from './api.js';
import * as store from './store.js';
import { data, course } from './store.js';
import * as sync from './sync.js';
import { ui, rememberUi } from './state.js';
import { uid, isOpen, isComplete, normalizeItem, shiftEnd, tmeta, classRoom, useTypePrefs, typeList, typePrefsFrom, TYPE_COLOURS, MAX_CUSTOM_TYPES, statusesFor, normalizeFlow, normalizePrefs, FLOW_PRESETS } from './model.js';
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
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { flushTouch(); commitUndo(); } });
import { openKeys, closeKeys, keysOpen } from './views/keys.js';
import { openSession, renderSessionDrawer, refreshSessionDrawer, editSession, saveSessionDraft } from './views/drawer-session.js';
import { minutesByDay, streak } from './history.js';
import { launch as fireworks } from './fireworks.js';
import { openCourse, renderCourseDrawer, saveCourseDraft, deleteCourseDraft, refreshGrades } from './views/drawer-course.js';
import { openSettings, renderSettings, applyCoat, refreshSyncNote, refreshSpotifyGroup, feedAction } from './views/drawer-settings.js';
import * as spotify from './spotify.js';
import * as web from './web-player.js';
import { renderPlayer } from './views/player.js';
import * as spotView from './views/spotify-view.js';
import { renderSignIn, hideSignIn } from './views/signin.js';
import { schedule as drawOrnament } from './ornament.js';
import { parseTime } from './timepicker.js';
import { readSetting, writeSetting, dueReviews, nextReview } from './reviews.js';
import { fillTopics } from './prep.js';
import { pdfText } from './pdftext.js';
import { showBusy, hideBusy } from './views/busy.js';
import { previewImport, previewOutline, renderImport, editImport, commitImport } from './views/drawer-import.js';
import * as focus from './focus.js';
import { paint as paintStudy, clearRun, flow as studyFlow } from './views/study.js';

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
    const setting = readSetting(data.profile.id);
    const { rows, through } = dueReviews(setting, data.courses, data.items, today());
    if (rows.length) await store.saveRows(rows.map((row) => ({ kind: 'items', row: normalizeItem(row) })));
    if (through !== setting.through) writeSetting(data.profile.id, { ...setting, through });
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
  if (ui.view === 'spotify' || ui.focus) { spotView.onPlayerState(); renderHeader(); }
});
web.onChange(() => {
  renderPlayer(spotify.state);
  if (ui.settings && !drawerHasFocus()) refreshSpotifyGroup();
});
spotView.onChange(() => { if (ui.view === 'spotify' || ui.focus) renderView(); });   /* the view keeps its own scroll and caret */
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
  await focus.load();
  if (focus.active()) ui.focus = true;       /* a run this device was in the middle of */
  render();
  paintStudy(false);
  drawOrnament();
  celebrateStudy();                             /* the first look only records where today stands */
  sync.init();
  sync.syncNow();
  spotify.start();
  const back = spotifyReturn();
  if (back) { ui.spotifyNote = back; openSettings('spotifyGrp'); }
}

store.subscribe((evt) => {
  if (evt.type === 'change' && data.profile) celebrateStudy();
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
  focus.reset();
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

/* ═════════ the study timer ═════════ */
const drawerOpen = () => !!(ui.sel || ui.draft || ui.courseDraft || ui.settings || ui.sessionDraft);

focus.onTick((s, event) => {
  if (event === 'start') { ui.focus = true; render(); }
  else if (event === 'end') {
    ui.focus = false;
    ui.view = 'study'; rememberUi();
    clearRun();
    render();
    return;
  } else if (event === 'step' && s.kind === 'study' && !ui.focus && !drawerOpen()) {
    ui.focus = true;                       /* a new Study step pulls you back in */
    render();
  }
  paintStudy(event !== 'start');
});

function openFocus() {
  ui.focus = true;
  focus.fullscreen(true);
  render(); paintStudy(false);
}
function leaveFocus() {
  ui.focus = false;
  focus.fullscreen(false);
  if (ui.view === 'study') { ui.view = 'week'; rememberUi(); }
  render(); paintStudy(false);
}

/* ── the history: deletes that can be undone, a day picked on the heatmap, the goal ── */

/* A delete waits six seconds so Undo can take it back; the session is only hidden
   meanwhile. Another delete, or leaving the page, makes the waiting one final. */
const UNDO_MS = 6000;
function deleteWithUndo(id) {
  const session = data.study_sessions.find((x) => x.id === id);
  if (!session) return;
  commitUndo();
  ui.hist.undo = { session, timer: setTimeout(commitUndo, UNDO_MS) };
  renderView();
}
function commitUndo() {
  const u = ui.hist.undo;
  if (!u) return;
  clearTimeout(u.timer);
  ui.hist.undo = null;
  store.deleteStudySession(u.session.id).then(() => { if (ui.view === 'study') renderView(); });
}
function undoDelete() {
  const u = ui.hist.undo;
  if (!u) return;
  clearTimeout(u.timer);
  ui.hist.undo = null;
  renderView();
}

/** The heatmap: show that day's sessions, in its month. */
function showDay(day) {
  const d = parse(day), now = parse(today());
  ui.hist.range = 'month';
  ui.hist.monthOffset = (d.getFullYear() - now.getFullYear()) * 12 + d.getMonth() - now.getMonth();
  ui.hist.focusDay = day;
  renderView();
  /* after this click has finished with the page */
  requestAnimationFrame(() => document.getElementById('hday-' + day)?.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }));
}

const studyPrefs = () => normalizePrefs(data.profile?.studyPrefs);
async function savePrefs(patch) {
  await store.saveProfile({ studyPrefs: { ...studyPrefs(), ...patch } });
  if (ui.settings) renderSettings();
  renderView();
}

/* Fireworks when today's study crosses the goal, or the streak reaches a milestone,
   through something done on this device. The first look only records where it stands. */
let seen = null;
function celebrateStudy() {
  const p = studyPrefs(), now = today(), byDay = minutesByDay(data.study_sessions);
  const mins = byDay.get(now) || 0, days = streak(byDay, now, p).current;
  const was = seen;
  seen = { day: now, mins, days };
  if (!was || was.day !== now || !p.celebrate) return;
  const goal = p.goal && was.mins < p.goal && mins >= p.goal;
  const milestone = days > was.days && [7, 30, 100, 365].includes(days);
  if (goal || milestone) fireworks(window.innerWidth / 2, window.innerHeight * 0.7, { rockets: milestone ? 6 : 4 });
}

/* Every change to the flow saves it to the profile, so it follows you to other devices. */
async function saveFlow(next) {
  await store.saveProfile({ studyFlow: normalizeFlow(next) });
  renderView();
}

async function studyClick(e) {
  let el;
  if (e.target.closest('[data-study-start]')) {
    if (!ui.study.courseId || focus.active()) return true;
    await focus.begin(studyFlow(), ui.study.courseId, ui.study.itemId);
    return true;
  }
  if (e.target.closest('[data-study-pause]')) { await focus.togglePause(); return true; }
  if (e.target.closest('[data-study-skip]')) { await focus.skip(); return true; }
  if (e.target.closest('[data-study-stop]')) { await focus.stop(); return true; }
  if (e.target.closest('[data-study-leave]')) { leaveFocus(); return true; }
  if (e.target.closest('[data-study-back]')) { openFocus(); return true; }
  if ((el = e.target.closest('[data-study-sessdel]'))) { deleteWithUndo(el.dataset.studySessdel); return true; }
  if (e.target.closest('[data-hist-undo]')) { undoDelete(); return true; }
  if ((el = e.target.closest('[data-hist-edit]'))) { openSession(el.dataset.histEdit); return true; }
  if (e.target.closest('[data-hist-log]')) { openSession(null); return true; }
  if (e.target.closest('[data-hist-goal]')) { openSettings('goalGrp'); return true; }
  if ((el = e.target.closest('[data-hist-week]'))) {
    const n = +el.dataset.histWeek;
    ui.hist.weekOffset = n ? Math.min(0, ui.hist.weekOffset + n) : 0;
    renderView(); return true;
  }
  if ((el = e.target.closest('[data-hist-range]'))) { ui.hist.range = el.dataset.histRange; ui.hist.focusDay = null; renderView(); return true; }
  if ((el = e.target.closest('[data-hist-month]'))) {
    ui.hist.monthOffset = Math.min(0, ui.hist.monthOffset + +el.dataset.histMonth);
    ui.hist.focusDay = null;
    renderView(); return true;
  }
  if ((el = e.target.closest('[data-hist-pick]'))) { ui.hist.focusDay = el.dataset.histPick; renderView(); document.querySelector('[data-hist-pick="' + el.dataset.histPick + '"]')?.focus(); return true; }
  if ((el = e.target.closest('[data-hist-day]'))) { showDay(el.dataset.histDay); return true; }
  if ((el = e.target.closest('[data-sd-mins]'))) { editSession('minutes', el.dataset.sdMins); $('sd-min').value = el.dataset.sdMins; return true; }
  if ((el = e.target.closest('[data-goal-step]'))) { const p = studyPrefs(); await savePrefs({ goal: Math.max(0, Math.min(720, p.goal + +el.dataset.goalStep)) }); return true; }
  if ((el = e.target.closest('[data-goal-set]'))) { await savePrefs({ goal: +el.dataset.goalSet }); return true; }
  if ((el = e.target.closest('[data-rest]'))) {
    const d = +el.dataset.rest, rest = studyPrefs().rest;
    await savePrefs({ rest: rest.includes(d) ? rest.filter((x) => x !== d) : rest.length < 6 ? [...rest, d] : rest });
    return true;
  }
  const f = studyFlow();
  if ((el = e.target.closest('[data-study-kind]'))) {
    const step = f.steps[+el.dataset.studyKind];
    if (step) step[0] = step[0] === 'study' ? 'break' : 'study';
    /* a flow needs a Study step: switching the only one is refused by normalizeFlow */
    if (f.steps.some(([k]) => k === 'study')) await saveFlow(f);
    return true;
  }
  if ((el = e.target.closest('[data-study-del]'))) {
    f.steps.splice(+el.dataset.studyDel, 1);
    if (f.steps.some(([k]) => k === 'study')) await saveFlow(f);
    return true;
  }
  if ((el = e.target.closest('[data-study-add]'))) {
    if (f.steps.length < 12) { f.steps.push([el.dataset.studyAdd, el.dataset.studyAdd === 'study' ? 25 : 5]); await saveFlow(f); }
    return true;
  }
  if ((el = e.target.closest('[data-study-preset]'))) {
    const preset = FLOW_PRESETS[+el.dataset.studyPreset];
    if (preset) await saveFlow(structuredClone(preset[1]));
    return true;
  }
  return false;
}

async function studyChange(target) {
  if (target.id === 'studyCourse') { ui.study.courseId = target.value; ui.study.itemId = null; renderView(); return true; }
  if (target.id === 'studyItem') { ui.study.itemId = target.value || null; return true; }
  if (target.id === 'studyRounds' || target.dataset?.studyMin !== undefined) {
    const f = studyFlow();
    if (target.id === 'studyRounds') f.rounds = +target.value;
    else if (f.steps[+target.dataset.studyMin]) f.steps[+target.dataset.studyMin][1] = +target.value;
    await saveFlow(f);
    return true;
  }
  return false;
}

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
  if ((el = e.target.closest('#viewSeg button'))) {
    if (el.dataset.view === 'study' && focus.active()) { openFocus(); return; }
    ui.view = el.dataset.view; rememberUi(); render(); return;
  }
  if (await studyClick(e)) return;
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
    else if (act === 'keep') { ui.confirm = null; ui.sessionDraft ? renderSessionDrawer() : ui.courseDraft ? renderCourseDrawer() : renderItemDrawer(); }
    else if (act === 'session-save') saveSessionDraft();
    else if (act === 'session-delete') { ui.confirm = 'session'; renderSessionDrawer(); }
    else if (act === 'session-delete-yes' && ui.sessionDraft) { const id = ui.sessionDraft.id; closeDrawer(); deleteWithUndo(id); }
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
        : r.left ? 'The list is full: 50 steps is the most an item can hold.' : 'Every lecture before this ' + tmeta(it.type).label.toLowerCase() + ' is already listed.';
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
    else if (act === 'shortcuts') { closeDrawer(); openKeys(); }
    else if (act.startsWith('feed-')) feedAction(act);
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

/* Some items name themselves from the course: office hours after the teacher, exams,
   quizzes and tutorials after the class. Picking a course (or switching type) fills the title in, unless
   the title was typed by hand. */
function autoTitleFor(type, c) {
  if (!c) return '';
  if (type === 'office') return c.instructor ? c.instructor + ' — office hours' : '';
  if (type === 'exam') return c.name ? 'Exam — ' + c.name : '';
  if (type === 'quiz') return c.name ? 'Quiz — ' + c.name : '';
  if (type === 'tutoring') return c.name ? c.name + ' — tutorial' : '';
  return '';
}
function autoTitle(it, prevCourseId) {
  const next = autoTitleFor(it.type, course(it.courseId));
  if (!next) return;
  const wasAuto = ['office', 'exam', 'quiz', 'tutoring'].some((t) => it.title === autoTitleFor(t, course(prevCourseId)) || it.title === autoTitleFor(t, course(it.courseId)));
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
  if ('sd' in d) { editSession(d.sd, e.target.value); return; }     /* the Log study drawer */

  if ('reviews' in d) {
    const setting = readSetting(data.profile.id);
    writeSetting(data.profile.id, e.target.checked ? { on: true, through: setting.through && setting.on ? setting.through : null } : { on: false, through: null });
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

  if ('whatif' in d && ui.courseDraft) {  /* a what-if score, never saved */
    const v = e.target.value.trim() === '' ? NaN : +e.target.value;
    if (Number.isFinite(v) && v >= 0 && v <= 100) ui.whatIf[d.whatif] = v; else delete ui.whatIf[d.whatif];
    refreshGrades(); return;
  }
  if (d.cf && ui.courseDraft) {           /* course fields */
    const n = Math.round(+e.target.value);
    ui.courseDraft[d.cf] = d.cf === 'archived' ? e.target.checked
      : d.cf === 'target' ? (e.target.value.trim() !== '' && n >= 1 && n <= 100 ? n : null)
      : e.target.value;
    if (d.cf === 'target') refreshGrades();
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
    const ROOMED = d.f === 'date' || d.f === 'courseId' || d.f === 'type' || d.f === 'start';
    const roomWas = ROOMED ? classRoom(it, course(it.courseId)) : '';
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
    if (ROOMED) {
      /* an exam or quiz on a class day is held in that class's room, unless one was typed */
      if (!it.where || it.where === roomWas) it.where = classRoom(it, course(it.courseId));
      const whereBox = drawer.querySelector('[data-f="where"]');
      if (whereBox && whereBox.value !== it.where) whereBox.value = it.where;
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
    if (isPdf) showBusy(file.name, 'Pulling the text out of the PDF…');
    const body = isPdf ? new Blob([await pdfText(file)], { type: 'text/plain' }) : file;
    showBusy(file.name, 'Reading the dates and grades with AI…');
    const outline = await api.readOutline(body, { name: file.name, today: today(), termStart: data.profile?.termStart || '' });
    ui.outlineBusy = false; hideBusy();
    previewOutline(outline, file.name);
  } catch (err) {
    ui.outlineBusy = false; hideBusy();
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
  if (await studyChange(e.target)) return;
  if (e.target.id === 'goalDayMin') { const v = Math.round(+e.target.value); if (v >= 1 && v <= 240) await savePrefs({ dayMin: v }); else renderSettings(); return; }
  if (e.target.id === 'goalCelebrate') { await savePrefs({ celebrate: e.target.checked }); return; }
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

/* Single keys, when nothing is being typed and no drawer or the focus screen is up:
   the list is views/keys.js. Each presses the button it stands for. */
const VIEW_KEYS = { 1: 'week', 2: 'month', 3: 'table', 4: 'spotify', 5: 'study' };
function shortcut(e) {
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || isTyping(e.target) || e.target.isContentEditable) return false;
  if (e.key === '?') { keysOpen() ? closeKeys() : openKeys(); e.preventDefault(); return true; }
  if (keysOpen() || ui.focus || ui.sel || ui.draft || ui.courseDraft || ui.settings || ui.sessionDraft || $('app').hidden) return false;
  const press = (sel) => { const b = document.querySelector(sel); if (!b) return false; e.preventDefault(); b.click(); return true; };
  if (e.key === 'n') return press('#newBtn');
  if (e.key === 't') return press('#today');
  if ((e.key === '[' || e.key === ']') && (ui.view === 'week' || ui.view === 'month')) return press(e.key === '[' ? '#prev' : '#next');
  if (VIEW_KEYS[e.key]) return press('#viewSeg [data-view="' + VIEW_KEYS[e.key] + '"]');
  return false;
}

document.addEventListener('keydown', async (e) => {
  if (e.key === 'Escape') {
    if (e.defaultPrevented) return;   /* a field used it, like the time picker closing its list */
    if (keysOpen()) { closeKeys(); return; }
    if ($('side').classList.contains('on')) { setSide(false); return; }
    if (e.target.closest?.('#typeNav')) { e.target.blur(); ui.typeAdd = null; ui.typeEdit = false; renderSidebar(true); return; }
    if (ui.view === 'spotify' && spotView.devicesOpen()) { spotView.closeDevices(); return; }
    if (ui.sel || ui.draft || ui.courseDraft || ui.settings || ui.sessionDraft) { closeDrawer(); return; }
    if (ui.focus) leaveFocus();
    return;
  }
  if (shortcut(e)) return;
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
    const full = /^https?:\/\//i.test(url) ? url : 'https://' + url;
    let ok = full.length <= 500;
    try { new URL(full); } catch { ok = false; }
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
});

boot();
